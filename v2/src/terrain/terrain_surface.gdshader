// Земля с поверхностями (шаг 1.3 дорожной карты). Требования владельца 11.11: красочность и сочность цвета, природа
// как настоящая; главное — целостность ландшафта: остров должен читаться единой природной территорией, а не
// геометрией с наложенными картинками.
//
// Какие материалы где лежат, решается один раз при постройке мира (bake_surface.gdshader — там правила: география,
// влажность, материалы). Этот шейдер в кадре только читает готовое:
//   • три главных материала точки и их доли (шаг 2 м) — читаются в точке, сдвинутой мелким шумом на метр-другой:
//     границы пятен идут неровной кромкой, а не по клеткам;
//   • тон (сухость, цветение, оттенок песка) и затенение по форме рельефа;
//   • готовую картинку дальнего вида.
// До сборки 0.5.2 правила считались здесь, для каждой точки экрана в каждом кадре — замер владельца на 0.5.1:
// 13–18 кадров в секунду вблизи.
//
// Материалы — фотографии настоящей земли (Poly Haven и ambientCG, свободная лицензия; tools/surfaces/make.py) в едином
// масштабе: съёмки с воздуха — почти в настоящий размер, съёмки вблизи — втрое крупнее настоящего (иначе с высоты
// стратегической камеры их не видно). Три главных материала точки смешиваются по высоте фактуры — песок ложится
// между камнями, трава поверх земли; у каждого материала свой мелкий шум — на границе не контур, а россыпь пятен.
// Плитка не повторяется: у материала две копии, обычная и повёрнутая, чередуются пятнами. На крутом скала ложится
// сбоку (без растяжения), пласты идут горизонтально.
//
// Подробность — по размеру точки экрана на земле, как у обычных текстур, а не по расстоянию до камеры. Пока на точку
// экрана приходится меньше четверти метра земли, материалы рисуются целиком; когда больше 0,65 м — готовая картинка
// дальнего вида (она того же цвета: считается по тем же долям и оттенкам); между ними — плавно. В 0.5.1 переход
// шёл по расстоянию до камеры (320–850 м) и между двумя разными расчётами цвета — владелец увидел его как
// «невидимую поверхность», которая при движении карты делит гору на подробную и сжатую части.
// Ради скорости: второй и третий материалы и нормали читаются только там, где заметны; скала читается с одной
// стороны (с двух — только на углах); вдали — одна выборка готовой картинки.
shader_type spatial;
render_mode world_vertex_coords;

#include "res://src/terrain/hex.gdshaderinc"
#include "res://src/terrain/surface_layers.gdshaderinc"
#include "res://src/terrain/surface_tints.gdshaderinc"

uniform sampler2D height_map : filter_linear_mipmap, repeat_disable;
uniform sampler2D normal_map : filter_linear_mipmap, repeat_disable; // та же текстура, со сглаживанием вдали
// Картинка земли, запечённая при постройке мира (bake_surface.gdshader). Лежит в том же прямоугольнике, что и рельеф.
uniform sampler2D splat_index : filter_nearest, repeat_disable; // три главных материала точки (номера слоёв), «песчаность»
uniform sampler2D splat_weight : filter_linear, repeat_disable; // их доли и порода камня
uniform sampler2D surface_tone : filter_linear, repeat_disable; // сухость, цветение, оттенок песка, мокрая полоса
uniform sampler2D surface_shade : filter_linear, repeat_disable; // затенение по форме рельефа (множитель цвета / 1,5) и снег
uniform sampler2D surface_color : source_color, filter_linear_mipmap_anisotropic, repeat_disable; // готовая картинка дальнего вида
uniform float splat_texel = 2.0; // шаг запечённых материалов, метры
uniform vec2 noise_shift; // сдвиг шума от зерна карты: у каждой карты свои пятна
// Проверочные виды (0 — обычная картинка). География — она запекается, поэтому задаётся только ключом запуска
// --debug-view: 1 — влажность, 2 — сток, 3 — крутизна, 4 — ложбины и гребни. Картинка (можно и для отдельного
// кадра: --view=…@N): 5 — подробность (зелёное — готовая картинка дальнего вида, красное — материалы целиком);
// 6 — скала (красное — главный материал скала, зелёное — боковая проекция, синее — крутизна); 7 — главный материал
// (номер, доля, высота фактуры); 10 — только готовая картинка дальнего вида; 11 — без мелкой фактуры травы;
// 12 — только главный материал точки. Виды 10–12 отключают части шейдера по одной: так нашлась порча атласа
// в 0.5.0 (см. tools/surfaces/make.py, check_saved).
uniform int debug_view = 0;
uniform vec4 bake_rect;
uniform sampler2DArray layer_albedo : source_color, filter_linear_mipmap, repeat_enable; // цвет и высота фактуры
uniform sampler2DArray layer_normal : filter_linear_mipmap, repeat_enable; // нормаль и шероховатость
uniform sampler2D noise_map : filter_linear_mipmap, repeat_enable; // четыре независимых шума, плитка без шва
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

const mat2 TURN = mat2(vec2(0.7961, 0.6052), vec2(-0.6052, 0.7961)); // поворот второй копии плитки, ~37°

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

bool is_rock(int layer) {
	return layer == L_ROCK_CLIFF || layer == L_ROCK_STRATA || layer == L_LICHEN_ROCK;
}

// Съёмка с воздуха: плитка в десятки метров; вблизи ей добавляется мелкая фактура травы.
bool is_aerial(int layer) {
	return layer == L_DRY_GRASS || layer == L_HILL_STONE || layer == L_MEADOW || layer == L_MOUNTAIN_SLOPE;
}

// Какая из двух копий плитки материала в точке (0 — обычная, 1 — повёрнутая): пятна в несколько плиток,
// у соседних по номеру материалов — разные. Берётся из уже прочитанного шума: у съёмок с воздуха (плитка
// в десятки метров) — из шума на сотни метров, у съёмок вблизи — из шума на десятки.
float patch_share(int layer, vec4 meso, vec4 fine) {
	vec4 source = LAYER_TILE[layer] > 40.0 ? meso : fine;
	float value = (layer & 1) == 0 ? source.r : source.g;
	if ((layer & 2) != 0) {
		value = 1.0 - value;
	}
	return smoothstep(0.42, 0.58, value);
}

// Мелкий шум для крапа на границе материалов (примерно −0,5…0,5), у каждого из шестнадцати материалов свой:
// четыре канала шума складываются со знаками по номеру материала. Два масштаба: рисунок не повторяется рядами.
float layer_jitter(int layer, vec4 micro, vec4 fine) {
	vec4 signs = vec4((layer & 1) == 0 ? 1.0 : -1.0, (layer & 2) == 0 ? 1.0 : -1.0, (layer & 4) == 0 ? 1.0 : -1.0, (layer & 8) == 0 ? 1.0 : -1.0);
	return 0.36 * dot(micro - 0.5, signs) + 0.36 * dot(fine.gbar - 0.5, signs);
}

// Высота фактуры для смешения материалов. У песка она ровная: песок заполняет низкое место между камнями и травой,
// а его собственная ветровая рябь в смешении не участвует (иначе чужой материал проступал бы ровными рядами
// по ложбинкам ряби).
float blend_height(int layer, float height) {
	return (layer == L_SAND_DUNE || layer == L_BEACH_SAND) ? 0.4 : height;
}

// Насколько плитка материала в точке уже неразличима (0 — видна, 1 — сошла к среднему цвету): когда на плитку
// приходится всего несколько точек экрана, её рисунок складывается в ровную сетку («ткань» на песке с высоты).
float flat_share_of(float tile, float reach) {
	return smoothstep(0.1, 0.45, reach / tile);
}

// Цвет (rgb) и высота фактуры (a) материала при взгляде сверху. patch — какая из двух копий плитки (0…1).
vec4 layer_top(int layer, vec2 xz, float patch, float flat_share, vec2 gx, vec2 gy) {
	vec4 flat_color = vec4(LAYER_COLOR[layer], 0.5);
	if (flat_share > 0.99) {
		return flat_color;
	}
	float tile = LAYER_TILE[layer];
	float index = float(layer);
	vec4 color = vec4(0.0);
	if (patch < 0.99) {
		color += textureGrad(layer_albedo, vec3(xz / tile, index), gx / tile, gy / tile) * (1.0 - patch);
	}
	if (patch > 0.01) {
		float scale = tile * 1.31;
		color += textureGrad(layer_albedo, vec3((TURN * xz) / scale + vec2(0.37, 0.61), index), (TURN * gx) / scale, (TURN * gy) / scale) * patch;
	}
	return mix(color, flat_color, flat_share);
}

// Сдвиг нормали в мире (xyz) и шероховатость (w) материала при взгляде сверху: читается одна копия плитки —
// та, которой в точке больше.
vec4 layer_top_normal(int layer, vec2 xz, float patch, float flat_share, vec2 gx, vec2 gy) {
	float tile = LAYER_TILE[layer];
	float index = float(layer);
	vec3 b;
	vec2 t;
	if (patch < 0.5) {
		b = textureGrad(layer_normal, vec3(xz / tile, index), gx / tile, gy / tile).rgb;
		t = b.xy * 2.0 - 1.0;
	} else {
		float scale = tile * 1.31;
		b = textureGrad(layer_normal, vec3((TURN * xz) / scale + vec2(0.37, 0.61), index), (TURN * gx) / scale, (TURN * gy) / scale).rgb;
		t = (b.xy * 2.0 - 1.0) * TURN; // обратно в оси мира
	}
	t *= 1.0 - flat_share;
	return vec4(t.x, 0.0, -t.y, b.z);
}

// Скала сбоку: по вертикали и по горизонтали вдоль склона — пласты породы идут вдоль склона, текстура не тянется.
// Читается с той стороны, к которой склон повёрнут сильнее; с двух сторон — только там, где он смотрит между осями.
// Две копии: мелкая — фактура камня, крупная (в 3,7 раза) — пласты и трещины, видные издалека.
// detail — сдвиг нормали в мире и шероховатость (читается, только если with_normal).
vec4 rock_side(int layer, vec3 wp, vec3 n, vec3 dpx, vec3 dpy, float reach, bool with_normal, out vec4 detail) {
	const float BIG = 3.7;
	// Рисунок камня приглушён — на столько он подмешан к своему среднему цвету (замечание владельца к 0.5.0:
	// «уменьшить чрезмерную контрастность каменных текстур»). У слоистого песчаника сильнее: его тёмные
	// полосы между пластами издалека читались «слоёным пирогом».
	float ROCK_CALM = layer == L_ROCK_STRATA ? 0.58 : 0.4;
	float tile = LAYER_TILE[layer];
	float index = float(layer);
	vec4 flat_color = vec4(LAYER_COLOR[layer], 0.5);
	float average = dot(LAYER_COLOR[layer], vec3(0.2126, 0.7152, 0.0722));
	float flat_share = flat_share_of(tile, reach);
	float big_flat = flat_share_of(tile * BIG, reach);
	detail = vec4(0.0, 0.0, 0.0, 0.82);
	vec4 color = vec4(0.0);
	float az = smoothstep(0.25, 0.75, n.z * n.z / max(n.x * n.x + n.z * n.z, 1.0e-4));
	float ax = 1.0 - az;
	if (az > 0.01) {
		vec2 uv = vec2(wp.x, -wp.y) / tile;
		vec2 gx = vec2(dpx.x, -dpx.y) / tile;
		vec2 gy = vec2(dpy.x, -dpy.y) / tile;
		vec4 a = flat_share > 0.99 ? flat_color : mix(textureGrad(layer_albedo, vec3(uv, index), gx, gy), flat_color, max(flat_share, ROCK_CALM));
		if (big_flat < 0.99) {
			vec4 a2 = textureGrad(layer_albedo, vec3(uv / BIG + vec2(0.31, 0.17), index), gx / BIG, gy / BIG);
			a.rgb *= mix(1.0, dot(a2.rgb, vec3(0.2126, 0.7152, 0.0722)) / average, 0.4 * (1.0 - big_flat));
			a.a = mix(a.a, a2.a, 0.5 * (1.0 - big_flat));
		}
		color += a * az;
		if (with_normal) {
			vec3 b = textureGrad(layer_normal, vec3(uv, index), gx, gy).rgb;
			vec2 t = (b.xy * 2.0 - 1.0) * (1.0 - flat_share);
			detail += vec4(t.x, t.y, 0.0, b.z - 0.82) * az;
		}
	}
	if (ax > 0.01) {
		vec2 uv = vec2(wp.z, -wp.y) / tile + vec2(0.5, 0.0);
		vec2 gx = vec2(dpx.z, -dpx.y) / tile;
		vec2 gy = vec2(dpy.z, -dpy.y) / tile;
		vec4 a = flat_share > 0.99 ? flat_color : mix(textureGrad(layer_albedo, vec3(uv, index), gx, gy), flat_color, max(flat_share, ROCK_CALM));
		if (big_flat < 0.99) {
			vec4 a2 = textureGrad(layer_albedo, vec3(uv / BIG + vec2(0.73, 0.41), index), gx / BIG, gy / BIG);
			a.rgb *= mix(1.0, dot(a2.rgb, vec3(0.2126, 0.7152, 0.0722)) / average, 0.4 * (1.0 - big_flat));
			a.a = mix(a.a, a2.a, 0.5 * (1.0 - big_flat));
		}
		color += a * ax;
		if (with_normal) {
			vec3 b = textureGrad(layer_normal, vec3(uv, index), gx, gy).rgb;
			vec2 t = (b.xy * 2.0 - 1.0) * (1.0 - flat_share);
			detail += vec4(0.0, t.y, t.x, b.z - 0.82) * ax;
		}
	}
	return color;
}

// Цвет и высота фактуры материала в точке: скала на крутом — сбоку, остальное — сверху. Вблизи съёмкам с воздуха
// добавляется мелкая фактура травы (только яркость, цвет остаётся от съёмки).
vec4 layer_color(int layer, vec3 wp, vec3 n, float side, float patch, float near, vec3 dpx, vec3 dpy, float reach, bool with_normal, out vec4 detail) {
	detail = vec4(0.0, 0.0, 0.0, 0.82);
	vec4 color = vec4(0.0);
	float flat_share = flat_share_of(LAYER_TILE[layer], reach);
	if (side < 0.99) {
		vec4 top = layer_top(layer, wp.xz, patch, flat_share, dpx.xz, dpy.xz);
		if (near > 0.01 && is_aerial(layer)) {
			float fine_tile = LAYER_TILE[L_GRASS_LUSH];
			vec3 grain = textureGrad(layer_albedo, vec3(wp.xz / fine_tile, float(L_GRASS_LUSH)), dpx.xz / fine_tile, dpy.xz / fine_tile).rgb;
			float lift = dot(grain, vec3(0.2126, 0.7152, 0.0722)) / dot(LAYER_COLOR[L_GRASS_LUSH], vec3(0.2126, 0.7152, 0.0722));
			top.rgb *= mix(1.0, lift, 0.6 * near);
		}
		color += top * (1.0 - side);
		if (with_normal && flat_share < 0.99) {
			vec4 d = layer_top_normal(layer, wp.xz, patch, flat_share, dpx.xz, dpy.xz);
			detail += vec4(d.xyz, d.w - 0.82) * (1.0 - side);
		}
	}
	if (side > 0.01) {
		vec4 side_detail;
		color += rock_side(layer, wp, n, dpx, dpy, reach, with_normal, side_detail) * side;
		detail += vec4(side_detail.xyz, side_detail.w - 0.82) * side;
	}
	return color;
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
	vec2 pn = p + noise_shift;
	vec2 uv = (p - bake_rect.xy) / bake_rect.zw;
	vec3 dpx = dFdx(world_position);
	vec3 dpy = dFdy(world_position);
	// Размер точки экрана меряется по самой поверхности, а не по её тени на плане: на крутом склоне план почти
	// не меняется от точки к точке, и по нему склон считался бы «снятым в упор».
	float footprint = length(dpx) + length(dpy);
	float far = smoothstep(0.4, 2.5, footprint);
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
	if (picture_share < 0.999) {
		// ── Вблизи: три главных материала точки ────────────────────────────────
		// Шум трёх масштабов (у каждой карты свой — сдвиг от зерна): по нему чередуются копии плиток, идёт
		// неровная кромка пятен и мелкая неровность травы. Шаг точки экрана передаётся явно: мы внутри условия.
		vec4 meso = textureGrad(noise_map, pn / 310.0 + vec2(0.37, 0.09), dpx.xz / 310.0, dpy.xz / 310.0);
		vec4 fine = textureGrad(noise_map, pn / 61.0 + vec2(0.71, 0.23), dpx.xz / 61.0, dpy.xz / 61.0);
		vec4 micro = textureGrad(noise_map, pn / 13.0 + vec2(0.29, 0.83), dpx.xz / 13.0, dpy.xz / 13.0);
		// Материалы запечены по клеткам в два метра. Клетка читается в точке, сдвинутой шумом на метр-другой:
		// граница пятна идёт неровной кромкой с мелкой бахромой, а не по сторонам клеток. Номера материалов
		// берутся из ближайшей клетки, доли — плавно между клетками: там, где материалы у соседних клеток те же
		// (а это почти везде), доли меняются без ступенек, и кромку пятна рисует сама фактура — камни и кочки.
		vec2 wobble = (micro.rg - 0.5) * 2.6 + (micro.ba - 0.5) * 1.4 + (fine.ba - 0.5) * 2.2;
		vec2 spot = (p + wobble - bake_rect.xy) / splat_texel;
		ivec2 cell = clamp(ivec2(floor(spot)), ivec2(0), textureSize(splat_index, 0) - 1);
		vec4 chosen = texelFetch(splat_index, cell, 0);
		vec4 shares = textureLod(splat_weight, spot / vec2(textureSize(splat_weight, 0)), 0.0);
		int i0 = int(chosen.r * 255.0 + 0.5);
		int i1 = int(chosen.g * 255.0 + 0.5);
		int i2 = int(chosen.b * 255.0 + 0.5);
		vec4 tone = textureLod(surface_tone, uv, 0.0);
		vec4 shade = textureLod(surface_shade, uv, 0.0);
		wet = tone.a;
		// Мелкая неровность травы: кочками темнее и светлее.
		float grass_shade = 1.0 + 0.24 * (fine.r - 0.5) + 0.12 * (micro.b - 0.5);

		// Доли возведены в квадрат: главный материал точки ведёт увереннее, а те, которых в точке немного,
		// не читаются вовсе (и пятна материалов цельнее, и выборок меньше).
		float w0 = max(shares.r, 1.0e-4);
		float w1 = shares.g;
		float w2 = shares.b;
		w0 *= w0;
		w1 *= w1;
		w2 *= w2;
		float total = w0 + w1 + w2;
		w0 /= total;
		w1 /= total;
		w2 /= total;
		// Совсем вблизи (точка экрана меньше 10 см земли) съёмкам с воздуха добавляется мелкая фактура травы.
		float near = 1.0 - smoothstep(0.06, 0.2, footprint);
		if (debug_view == 11) {
			near = 0.0;
		}
		if (debug_view == 12) {
			w0 = 1.0;
			w1 = 0.0;
			w2 = 0.0;
		}
		// Мелкий рельеф материалов (нормаль) виден, пока точка экрана мельче четверти метра.
		float bump_share = 1.0 - smoothstep(0.25, 0.5, footprint);
		bool normals = bump_share > 0.01;
		// Пласты породы лежат не строго горизонтально: у острова общий наклон пластов (падение — несколько
		// градусов), и они плавно изгибаются. На столько метров сдвигается по высоте рисунок скалы в точке.
		const vec2 DIP = vec2(0.07, 0.04);
		float bend = dot(p, DIP) + 9.0 * (meso.r - 0.5) + 2.4 * (fine.r - 0.5);
		vec3 rock_position = world_position + vec3(0.0, bend, 0.0);
		vec3 rock_dpx = dpx + vec3(0.0, dot(dpx.xz, DIP), 0.0);
		vec3 rock_dpy = dpy + vec3(0.0, dot(dpy.xz, DIP), 0.0);
		float reach = footprint;

		vec4 d0;
		vec4 d1 = vec4(0.0, 0.0, 0.0, 0.82);
		vec4 d2 = vec4(0.0, 0.0, 0.0, 0.82);
		vec4 c0 = layer_color(i0, rock_position, n, is_rock(i0) ? side : 0.0, patch_share(i0, meso, fine), near, rock_dpx, rock_dpy, reach, normals, d0);
		c0.rgb *= surface_tint(i0, tone.r, tone.g, tone.b, chosen.a, shares.a, grass_shade);
		vec4 c1 = vec4(0.0);
		vec4 c2 = vec4(0.0);
		float e0 = w0 + 0.45 * blend_height(i0, c0.a) + 0.34 * layer_jitter(i0, micro, fine);
		float e1 = -8.0;
		float e2 = -8.0;
		// Второй и третий материалы читаются, только если их в точке заметная доля — и тем большая, чем крупнее
		// точка экрана; нормаль — только у первого и, если его много, у второго.
		if (w1 > mix(0.07, 0.3, far)) {
			c1 = layer_color(i1, rock_position, n, is_rock(i1) ? side : 0.0, patch_share(i1, meso, fine), near, rock_dpx, rock_dpy, reach, normals && w1 > 0.3, d1);
			c1.rgb *= surface_tint(i1, tone.r, tone.g, tone.b, chosen.a, shares.a, grass_shade);
			e1 = w1 + 0.45 * blend_height(i1, c1.a) + 0.34 * layer_jitter(i1, micro, fine);
		}
		if (w2 > mix(0.14, 0.4, far)) {
			c2 = layer_color(i2, rock_position, n, is_rock(i2) ? side : 0.0, patch_share(i2, meso, fine), near, rock_dpx, rock_dpy, reach, false, d2);
			c2.rgb *= surface_tint(i2, tone.r, tone.g, tone.b, chosen.a, shares.a, grass_shade);
			e2 = w2 + 0.45 * blend_height(i2, c2.a) + 0.34 * layer_jitter(i2, micro, fine);
		}
		// Смешение по высоте фактуры: выше тот материал, чья доля и высота больше; граница идёт по камням и кочкам.
		// Чем крупнее точка экрана, тем переход шире и плавнее: вблизи россыпь пятен, вдали мягкая полоса.
		float ceiling = max(e0, max(e1, e2)) - mix(0.16, 0.42, far);
		float b0 = max(e0 - ceiling, 0.0);
		float b1 = max(e1 - ceiling, 0.0);
		float b2 = max(e2 - ceiling, 0.0);
		float b_sum = b0 + b1 + b2;
		vec4 color = (c0 * b0 + c1 * b1 + c2 * b2) / b_sum;
		vec4 bumps = (d0 * b0 + d1 * b1 + d2 * b2) / b_sum;
		// Затенение по форме рельефа и крупные пятна светлее-темнее — запечённый множитель цвета.
		albedo = color.rgb * shade.rgb * 1.5;
		texture_height = color.a;
		detail = vec4(bumps.xyz * bump_share, mix(0.82, bumps.w, bump_share));
		// Снег на самых высоких вершинах (где ему лежать — запечено); кромка снега идёт по неровностям камня,
		// а не ровной чертой.
		float snow_cover = smoothstep(0.38, 0.6, shade.a + 0.3 * (texture_height - 0.5) + 0.16 * (micro.g - 0.5));
		albedo = mix(albedo, vec3(0.9, 0.93, 0.98), snow_cover);
		detail.xyz *= 1.0 - 0.75 * snow_cover;
		detail.w = mix(detail.w, 0.6, snow_cover);
		lead_layer = i0;
		lead_share = w0;
	}
	if (picture_share > 0.001) {
		// ── Вдали: готовая картинка ────────────────────────────────────────────
		vec4 picture = textureGrad(surface_color, uv, dpx.xz / bake_rect.zw, dpy.xz / bake_rect.zw);
		albedo = mix(albedo, picture.rgb, picture_share);
		wet = mix(wet, picture.a, picture_share);
		detail = mix(detail, vec4(0.0, 0.0, 0.0, 0.82), picture_share);
		texture_height = mix(texture_height, 0.5, picture_share);
	}
	// Сухая земля матовая (иначе песок блестит, как пластик); мокрая у воды — глаже.
	float roughness = mix(max(detail.w, 0.74), 0.3, wet * 0.8);

	if (debug_view == 5) {
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
	NORMAL = normalize((VIEW_MATRIX * vec4(normal, 0.0)).xyz);
	ALBEDO = albedo;
	ROUGHNESS = clamp(roughness, 0.08, 1.0);
	SPECULAR = mix(0.2, 0.5, wet);
	AO = mix(0.6, 1.0, texture_height);
	AO_LIGHT_AFFECT = 0.35;
}
