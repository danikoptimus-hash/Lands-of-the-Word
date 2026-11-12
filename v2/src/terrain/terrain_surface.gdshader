// Земля с поверхностями (шаг 1.3 дорожной карты). Требования владельца 11.11: красочность и сочность цвета, природа
// как настоящая; главное — целостность ландшафта: остров должен читаться единой природной территорией, а не
// геометрией с наложенными картинками.
//
// Какие материалы где лежат, решается один раз при постройке мира (bake_surface.gdshader — там правила: география,
// влажность, материалы). В кадре точка земли берётся одним из трёх способов:
//   • вдали — готовая картинка дальнего вида (одна выборка);
//   • вблизи — из кэша ближнего вида вокруг камеры (near_cache.gd): точка посчитана заранее в текстуру;
//   • вблизи, где кэш не готов или не годится, — прямым расчётом (surface_near.gdshaderinc): три главных материала
//     точки смешиваются по высоте фактуры. Кэш считается этим же кодом, поэтому картинка одна.
// До сборки 0.5.2 правила материалов считались здесь, для каждой точки экрана в каждом кадре (замер владельца
// на 0.5.1: 13–18 кадров в секунду вблизи); до 0.5.4 вблизи всегда шёл прямой расчёт (замер на 0.5.3: 35–71).
//
// Подробность — по размеру точки экрана на земле, как у обычных текстур, а не по расстоянию до камеры. Пока на точку
// экрана приходится меньше четверти метра земли, материалы рисуются целиком; когда больше 0,65 м — готовая картинка
// дальнего вида (она того же цвета: считается по тем же долям и оттенкам); между ними — плавно. В 0.5.1 переход
// шёл по расстоянию до камеры (320–850 м) и между двумя разными расчётами цвета — владелец увидел его как
// «невидимую поверхность», которая при движении карты делит гору на подробную и сжатую части.
shader_type spatial;
render_mode world_vertex_coords;

#include "res://src/terrain/hex.gdshaderinc"
#include "res://src/terrain/surface_near.gdshaderinc"

uniform sampler2D height_map : filter_linear_mipmap, repeat_disable;
uniform sampler2D normal_map : filter_linear_mipmap, repeat_disable; // та же текстура, со сглаживанием вдали
uniform sampler2D surface_color : source_color, filter_linear_mipmap_anisotropic, repeat_disable; // готовая картинка дальнего вида
// Кэш ближнего вида вокруг камеры (near_cache.gd): та же точка, что считает near_surface, посчитана заранее
// в текстуру — здесь она только читается. Четыре уровня подробности; клетка следующего вдвое крупнее. Текстуры —
// «по кругу»: клетка мира лежит в точке (x mod N, z mod N), поэтому читаются с повтором по координатам мира.
uniform bool cache_on = false;
uniform float cache_cell = 0.0625; // метров на клетку самого подробного уровня
uniform vec4 cache_size = vec4(256.0, 512.0, 1024.0, 1024.0); // сторона окна каждого уровня, метры
uniform vec4 cache_valid[4]; // посчитанная область уровня: xy — меньший угол, zw — больший (метры мира)
uniform sampler2D cache_color_0 : filter_linear, repeat_enable; // цвет (корень из половины) и высота фактуры
uniform sampler2D cache_color_1 : filter_linear, repeat_enable;
uniform sampler2D cache_color_2 : filter_linear, repeat_enable;
uniform sampler2D cache_color_3 : filter_linear, repeat_enable;
uniform sampler2D cache_relief_0 : filter_linear, repeat_enable; // сдвиг нормали по x и z, шероховатость, мокрота
uniform sampler2D cache_relief_1 : filter_linear, repeat_enable;
uniform float grid_strength : hint_range(0.0, 1.0) = 0.5;
uniform float skirt_depth = 24.0;
// Уровень детализации плитки: 0 — сетка с шагом 4 м, 1 — 8 м, 2 — 16 м. Высоты берутся из копии рельефа,
// сглаженной под шаг сетки: у редкой сетки вдали обрывы не идут «пилой».
instance uniform float height_lod = 0.0;
// Плавная смена детализации: откуда смотрит камера и на каких расстояниях меняются уровни (world_terrain.gd).
uniform vec3 viewer_position = vec3(0.0, 1.0e6, 0.0);
uniform vec2 lod_distance = vec2(2000.0, 4500.0);
uniform float morph_start = 0.7;

varying vec3 world_position;


// Какая детализация нужна в точке: 0 рядом с камерой, 2 вдали; между уровнями растёт плавно.
float detail_level(vec2 point) {
	float distance_to_viewer = length(vec3(point - viewer_position.xz, viewer_position.y));
	vec2 t = clamp((vec2(distance_to_viewer) / lod_distance - morph_start) / (1.0 - morph_start), 0.0, 1.0);
	return t.x + t.y;
}

void vertex() {
	// Перед сменой сетки на более редкую точки сами съезжаются в её положение, а высоты плавно переходят
	// к сглаженным: ко времени смены обе сетки совпадают, и рельеф не «перещёлкивает».
	float morph = clamp(detail_level(VERTEX.xz) - height_lod, 0.0, 1.0);
	VERTEX.xz -= UV2 * morph;
	vec2 uv = (VERTEX.xz - bake_rect.xy) / bake_rect.zw;
	float h = textureLod(height_map, uv, height_lod + morph).r;
	// «Юбка» по краю плитки закрывает щели между уровнями детализации.
	VERTEX.y = h - UV.x * skirt_depth;
	world_position = vec3(VERTEX.x, h, VERTEX.z);
}

// Расстояние до ближайшей стороны гекса суши, в метрах (дальше limit — можно не уточнять: линия сетки тоньше).
float land_edge_distance(vec2 p, float limit) {
	ivec2 h0 = hex_at(p);
	float own = abs(sd_hex(p - hex_center(h0)));
	if (terrain_at(h0) != T_SEA) {
		return own;
	}
	if (own > limit) {
		return 1.0e6;
	}
	// Точка моря у самой стороны гекса: сторона чертится, только если за ней суша.
	float nearest = 1.0e6;
	for (int dr = -1; dr <= 1; dr++) {
		for (int dq = -1; dq <= 1; dq++) {
			if (abs(dq + dr) > 1 || (dq == 0 && dr == 0)) {
				continue;
			}
			ivec2 h = h0 + ivec2(dq, dr);
			if (terrain_at(h) != T_SEA) {
				nearest = min(nearest, abs(sd_hex(p - hex_center(h))));
			}
		}
	}
	return nearest;
}

const float CACHE_BIAS = -0.5; // на сколько уровней подробнее точки экрана берётся кэш (то же число — в near_cache.gd)

bool cache_holds(int level, vec2 p) {
	vec4 area = cache_valid[level];
	return p.x > area.x && p.y > area.y && p.x < area.z && p.y < area.w;
}

vec4 cache_color(int level, vec2 p) {
	vec2 uv = p / cache_size[level];
	if (level == 0) {
		return textureLod(cache_color_0, uv, 0.0);
	} else if (level == 1) {
		return textureLod(cache_color_1, uv, 0.0);
	} else if (level == 2) {
		return textureLod(cache_color_2, uv, 0.0);
	}
	return textureLod(cache_color_3, uv, 0.0);
}

// Мелкий рельеф уровня: сдвиг нормали (xy, вокруг 0,5), шероховатость, мокрота. У грубых уровней рельефа нет:
// нормаль — как у земли, шероховатость обычная; мокрота для них берётся из картинки дальнего вида (вне этой функции).
vec4 cache_relief(int level, vec2 p) {
	vec2 uv = p / cache_size[level];
	if (level == 0) {
		return textureLod(cache_relief_0, uv, 0.0);
	} else if (level == 1) {
		return textureLod(cache_relief_1, uv, 0.0);
	}
	return vec4(0.5, 0.5, 0.82, -1.0);
}

// Размер точки экрана на земле (сумма шагов по двум осям экрана, метры), с которого материалы начинают уступать
// готовой картинке дальнего вида, и с которого остаётся только она. Точка экрана — примерно половина этого числа.
// Подобрано по кадрам: готовая картинка (клетка 2 м) смотрится цельно и чётко, когда на точку экрана приходится
// от 0,65 м земли, а ближе четверти метра без материалов «мыльная». На экране 1600×900 это 350 и 900 м до камеры
// при взгляде сверху; чем больше точек на экране, тем дальше видны материалы.
const float PICTURE_FROM = 0.5;
const float PICTURE_TO = 1.3;

void fragment() {
	vec2 p = world_position.xz;
	vec2 uv = (p - bake_rect.xy) / bake_rect.zw;
	vec3 dpx = dFdx(world_position);
	vec3 dpy = dFdy(world_position);
	// Размер точки экрана меряется по самой поверхности, а не по её тени на плане: на крутом склоне план почти
	// не меняется от точки к точке, и по нему склон считался бы «снятым в упор».
	float footprint = length(dpx) + length(dpy);
	// Доля готовой картинки дальнего вида: 0 — материалы целиком, 1 — только картинка.
	float picture_share = smoothstep(PICTURE_FROM, PICTURE_TO, footprint);
	// Последние два процента материалов не видны, а стоят как все сто: дальше — только картинка.
	if (picture_share > 0.98) {
		picture_share = 1.0;
	}
	if ((debug_view >= 1 && debug_view <= 4) || debug_view == 10) {
		picture_share = 1.0;
	}

	vec4 baked = texture(normal_map, uv);
	vec3 n = vec3(baked.g, sqrt(max(1.0 - dot(baked.gb, baked.gb), 0.0)), baked.b);
	float steep = 1.0 - n.y; // 0 — ровно, 0,13 — склон 30°, 0,29 — 45°, 0,5 — 60°
	float side = smoothstep(0.13, 0.36, steep);

	vec3 albedo = vec3(0.0);
	vec4 detail = vec4(0.0, 0.0, 0.0, 0.82);
	float texture_height = 0.5;
	float wet = 0.0;
	int lead_layer = 0;
	float lead_share = 1.0;
	// Готовая нормаль точки из кэша (отличие от нормали рельефа по x и z); при прямом расчёте не используется.
	vec2 cached_tilt = vec2(0.0);
	bool cached = false;
	bool wet_known = true;
	if (picture_share < 0.999) {
		// ── Вблизи: три главных материала точки ────────────────────────────────
		// Сначала — из кэша вокруг камеры: уровень по размеру точки экрана (на склоне клетка плана покрывает
		// больше земли — уровень берётся подробнее), смесь двух соседних уровней. Отвесные склоны и приближение
		// ближе самого подробного уровня в кэш не идут.
		if (cache_on && debug_view != 14 && n.y > 0.35) {
			// Клетка кэша берётся мельче точки экрана (на полуровня): прямой расчёт рисует кромки пятен и камни
			// с точностью до точки экрана, и кэш «точка в клетку» рядом с ним выглядел бы мягче.
			float level_exact = log2(max(0.5 * footprint * n.y, 1.0e-5) / cache_cell) + CACHE_BIAS;
			if (level_exact > -0.65) {
				int level = clamp(int(floor(level_exact)), 0, 3);
				int upper = min(level + 1, 3);
				// У самых границ уровня читается он один: соседний почти ничего не добавляет, а требовать его
				// значило бы терять кэш по краям экрана (окно соседнего уровня вдвое меньше или вдвое грубее).
				float blend = smoothstep(0.1, 0.9, clamp(level_exact - float(level), 0.0, 1.0));
				if (blend > 0.999) {
					level = upper;
					blend = 0.0;
				}
				if (blend < 0.001) {
					upper = level;
				}
				if (cache_holds(level, p) && cache_holds(upper, p)) {
					vec4 color = cache_color(level, p);
					vec4 relief = cache_relief(level, p);
					if (upper != level) {
						color = mix(color, cache_color(upper, p), blend);
						vec4 relief_upper = cache_relief(upper, p);
						// У грубого уровня мокроты нет — оставляем ту, что есть.
						relief_upper.a = relief_upper.a < 0.0 ? relief.a : relief_upper.a;
						relief = mix(relief, relief_upper, blend);
					}
					albedo = color.rgb * color.rgb * 2.0;
					texture_height = color.a;
					cached_tilt = (relief.xy - 0.5) * 2.0;
					detail.w = relief.b;
					wet_known = relief.a >= 0.0;
					wet = max(relief.a, 0.0);
					cached = true;
				}
			}
		}
		// Кэш не готов или не годится — точка считается напрямую, тем же кодом (surface_near.gdshaderinc).
		if (!cached) {
			near_surface(world_position, n, dpx, dpy, albedo, detail, texture_height, wet, lead_layer, lead_share);
		}
	}
	if (picture_share > 0.001 || !wet_known) {
		// ── Вдали: готовая картинка ────────────────────────────────────────────
		vec4 picture = textureGrad(surface_color, uv, dpx.xz / bake_rect.zw, dpy.xz / bake_rect.zw);
		if (!wet_known) {
			wet = picture.a;
		}
		albedo = mix(albedo, picture.rgb, picture_share);
		wet = mix(wet, picture.a, picture_share);
		detail = mix(detail, vec4(0.0, 0.0, 0.0, 0.82), picture_share);
		cached_tilt *= 1.0 - picture_share;
		texture_height = mix(texture_height, 0.5, picture_share);
	}
	// Сухая земля матовая (иначе песок блестит, как пластик); мокрая у воды — глаже.
	float roughness = mix(max(detail.w, 0.74), 0.3, wet * 0.8);

	if (debug_view == 9) {
		// Откуда взята точка: зелёное — из кэша, красное — посчитана напрямую, серое — готовая картинка дальнего вида.
		vec3 mark = picture_share > 0.999 ? vec3(0.45) : (cached ? vec3(0.15, 0.7, 0.2) : vec3(0.85, 0.2, 0.15));
		albedo = mark * (0.6 + 0.4 * dot(albedo, vec3(0.33)));
	} else if (debug_view == 5) {
		albedo = mix(vec3(0.85, 0.2, 0.15), vec3(0.15, 0.6, 0.2), picture_share) * (0.6 + 0.4 * dot(albedo, vec3(0.33)));
	} else if (debug_view == 6) {
		albedo = vec3(is_rock(lead_layer) ? 1.0 : 0.0, side, steep);
	} else if (debug_view == 7) {
		albedo = vec3(float(lead_layer) / 15.0, lead_share, texture_height);
	}

	if (grid_strength > 0.0) {
		float pixel = 0.7071 * length(vec2(length(dpx.xz), length(dpy.xz)));
		float half_width = max(0.8, 0.85 * pixel);
		float grid_line = 1.0 - smoothstep(half_width - 0.6 * pixel, half_width + 0.6 * pixel, land_edge_distance(p, half_width + 0.6 * pixel));
		albedo *= 1.0 - 0.5 * grid_strength * grid_line;
	}

	vec3 normal = normalize(n + detail.xyz * 0.9);
	if (cached) {
		vec2 lean = n.xz + cached_tilt;
		normal = vec3(lean.x, sqrt(max(1.0 - dot(lean, lean), 0.01)), lean.y);
	}
	NORMAL = normalize((VIEW_MATRIX * vec4(normal, 0.0)).xyz);
	ALBEDO = albedo;
	ROUGHNESS = clamp(roughness, 0.08, 1.0);
	SPECULAR = mix(0.2, 0.5, wet);
	AO = mix(0.6, 1.0, texture_height);
	AO_LIGHT_AFFECT = 0.35;
}
