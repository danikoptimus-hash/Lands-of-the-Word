// Земля с поверхностями (шаг 1.3 дорожной карты). Требования владельца 11.11: красочность и сочность цвета, природа
// как настоящая; главное — целостность ландшафта: остров должен читаться единой природной территорией, а не
// геометрией с наложенными картинками.
//
// Два уровня (так их разделил владелец):
//   • ГЕОГРАФИЯ — что есть на земле, без единого цвета. Считается один раз при постройке мира: высоты и уклон
//     (bake.gdshader), доли местностей, близость воды озёр, расстояние от уреза моря, камень (bake_ground.gdshader),
//     сток воды по рельефу (drainage.gd). Из них здесь одной формулой выводится ВЛАЖНОСТЬ точки: суше в пустыне,
//     на гребнях, на высоте и на крутом; влажнее у озёр, в ложбинах, по руслам стока; плюс природные отклонения
//     на сотни и на десятки метров.
//   • КАРТИНКА — какие материалы лежат на такой земле. Правила, а не раскраска: чистый песок — где сухо; с ростом
//     влажности на нём появляются плотный грунт с камнями и редкая трава; на холмах в сухих местах открытый грунт,
//     во влажных ложбинах луговая трава; круче сорока градусов — скала у любой местности, под ней осыпь, по кромке
//     обрыва дёрн редеет; у воды — пляж, галька, зелень. Между пустыней и лугом сама собой получается переходная
//     земля: влажность меняется плавно, на сотню метров.
//
// Материалы — фотографии настоящей земли (Poly Haven и ambientCG, свободная лицензия; tools/surfaces/make.py) в едином
// масштабе: съёмки с воздуха — почти в настоящий размер, съёмки вблизи — втрое крупнее настоящего (иначе с высоты
// стратегической камеры их не видно). В точке читаются три главных материала и смешиваются по высоте фактуры —
// песок ложится между камнями, трава поверх земли. Плитка не повторяется: у материала две копии, обычная
// и повёрнутая, чередуются пятнами. На крутом скала ложится сбоку (без растяжения), пласты идут горизонтально.
shader_type spatial;
render_mode world_vertex_coords;

#include "res://src/terrain/hex.gdshaderinc"
#include "res://src/terrain/surface_layers.gdshaderinc"

uniform sampler2D height_map : filter_linear_mipmap, repeat_disable;
uniform sampler2D normal_map : filter_linear_mipmap, repeat_disable; // та же текстура, со сглаживанием вдали
uniform sampler2D ground_a : filter_linear_mipmap, repeat_disable; // доли местностей: пустыня, холмы, луга, горы
uniform sampler2D ground_b : filter_linear_mipmap, repeat_disable; // озеро рядом, от уреза моря, камень, оазис
uniform sampler2D ground_c : filter_linear_mipmap, repeat_disable; // сток воды по рельефу: 0 — водораздел, 1 — русло
uniform vec2 noise_shift; // сдвиг шума от зерна карты: у каждой карты свои пятна
// Снеговая линия, метры над морем: выше неё на вершинах лежит снег (решение владельца 11.11: у гор белые шапки).
uniform float snow_line = 92.0;
// Для проверки географии: 1 — влажность, 2 — сток, 3 — крутизна, 4 — ложбины и гребни (0 — обычная картинка).
uniform int debug_view = 0;
uniform vec4 bake_rect;
uniform sampler2DArray layer_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable; // цвет и высота фактуры
uniform sampler2DArray layer_normal : filter_linear_mipmap_anisotropic, repeat_enable; // нормаль и шероховатость
uniform sampler2D noise_map : filter_linear_mipmap, repeat_enable; // четыре независимых шума, плитка без шва
uniform float grid_strength : hint_range(0.0, 1.0) = 0.5;
uniform float skirt_depth = 24.0;
// Камень области: 0 — тёплый известняк (главные острова: местами красный песчаник), 1 — красный слоистый песчаник,
// 2 — серый гранит с лишайником, 3 — тёмная вулканическая порода. У малого острова весь «камень» каталога — скала.
uniform int rock_kind = 0;
uniform bool islet_region = false;
// Малые острова, запечённые внутри этой области: центр (xy), досягаемость суши (z), камень (w).
uniform vec4 inner_islets[4];
uniform int inner_count = 0;
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

// Расстояние до ближайшей стороны гекса суши, в метрах.
float land_edge_distance(vec2 p) {
	ivec2 h0 = hex_at(p);
	float nearest = 1.0e6;
	for (int dr = -1; dr <= 1; dr++) {
		for (int dq = -1; dq <= 1; dq++) {
			if (abs(dq + dr) > 1) {
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
// у каждого материала свои. Шаг точки экрана передаётся явно: функция вызывается и внутри условий.
float patch_mask(int layer, vec2 p, vec2 dpx, vec2 dpy) {
	float scale = LAYER_TILE[layer] * 6.3;
	return smoothstep(0.42, 0.58, textureGrad(noise_map, p / scale + vec2(0.11 * float(layer), 0.5), dpx / scale, dpy / scale).g);
}

// Доля площади под «крапом» (куртины травы, пятна грунта): вблизи — отдельные пятна по шуму, издалека — ровная доля.
// Вдали шум усредняется, и порог по нему дал бы один сплошной контур; поэтому чем дальше, тем шире порог.
float speckle(float density, float noise, float far) {
	float threshold = 1.1 - 1.2 * density;
	float width = mix(0.08, 0.6, far);
	return smoothstep(threshold - width, threshold + width, noise);
}

// Мелкий шум для крапа на границе материалов (−0,5…0,5), у каждого материала свой. Два масштаба, второй повёрнут:
// рисунок не повторяется рядами. Шаг точки экрана передаётся явно: функция вызывается и внутри условий.
float layer_jitter(int layer, vec2 pn, vec2 dpx, vec2 dpy) {
	vec2 shift = vec2(0.137, 0.731) * float(layer + 1);
	return 0.6 * textureGrad(noise_map, pn / 41.0 + shift, dpx / 41.0, dpy / 41.0).a
			+ 0.4 * textureGrad(noise_map, (TURN * pn) / 11.3 + shift.yx, (TURN * dpx) / 11.3, (TURN * dpy) / 11.3).a - 0.5;
}

// Высота фактуры для смешения материалов. У песка она ровная: песок заполняет низкое место между камнями и травой,
// а его собственная ветровая рябь в смешении не участвует (иначе чужой материал проступал бы ровными рядами
// по ложбинкам ряби).
float blend_height(int layer, float height) {
	return (layer == L_SAND_DUNE || layer == L_BEACH_SAND) ? 0.4 : height;
}

// Оттенок материала: у скалы — порода области, у песка барханов и у травы — свои.
vec3 layer_tint(int layer, int rock_layer, vec3 rock_tint, vec3 sand_tint, vec3 grass_tint, vec3 meadow_tint, vec3 stone_tint, vec3 strata_tint) {
	if (layer == rock_layer) {
		return rock_tint;
	}
	if (layer == L_ROCK_STRATA) {
		return strata_tint;
	}
	if (layer == L_DESERT_STONE) {
		return stone_tint;
	}
	if (layer == L_SAND_DUNE) {
		return sand_tint;
	}
	if (layer == L_MEADOW || layer == L_GRASS_LUSH) {
		return meadow_tint;
	}
	if (layer == L_DRY_GRASS || layer == L_MOUNTAIN_SLOPE || layer == L_OASIS_GREEN) {
		return grass_tint;
	}
	return vec3(1.0);
}

// Материал в точке. color.rgb — цвет, color.a — высота фактуры; detail — сдвиг нормали в мире (x, y, z) и
// шероховатость (w). wp — точка мира, n — нормаль рельефа, side — доля боковой проекции (крутой склон скалы),
// patch — какая из двух копий плитки (0…1), near — насколько близко камера (1 — вплотную): вблизи съёмкам
// с воздуха добавляется мелкая фактура. dpx, dpy — шаг точки экрана по земле.
void fetch_layer(int layer, vec3 wp, vec3 n, float side, float patch, float near, vec3 dpx, vec3 dpy, out vec4 color, out vec4 detail) {
	float tile = LAYER_TILE[layer];
	float index = float(layer);
	color = vec4(0.0);
	detail = vec4(0.0);
	float top = 1.0 - side;
	if (near > 0.01 && is_aerial(layer)) {
		// Мелкая фактура травы поверх съёмки с воздуха: только яркость, цвет остаётся от съёмки.
		float fine_tile = LAYER_TILE[L_GRASS_LUSH];
		vec3 grain = textureGrad(layer_albedo, vec3(wp.xz / fine_tile, float(L_GRASS_LUSH)), dpx.xz / fine_tile, dpy.xz / fine_tile).rgb;
		float lift = dot(grain, vec3(0.2126, 0.7152, 0.0722)) / dot(LAYER_COLOR[L_GRASS_LUSH], vec3(0.2126, 0.7152, 0.0722));
		color.rgb = vec3(mix(1.0, lift, 0.6 * near)); // множитель: применяется в конце
	} else {
		color.rgb = vec3(1.0);
	}
	vec3 gain = color.rgb;
	color = vec4(0.0);
	// Издалека, когда на плитку материала приходится всего несколько точек экрана, её рисунок складывается в ровную
	// сетку («ткань» на песке с высоты). Там материал плавно сходит к своему среднему цвету и ровной поверхности;
	// разнообразие вдали дают пятна от географии, а не плитка.
	float reach = length(dpx) + length(dpy);
	float flat_share = smoothstep(0.1, 0.45, reach / tile);
	vec4 flat_color = vec4(LAYER_COLOR[layer], 0.5);
	if (top > 0.01) {
		if (patch < 0.99) {
			vec2 uv = wp.xz / tile;
			vec4 a = mix(textureGrad(layer_albedo, vec3(uv, index), dpx.xz / tile, dpy.xz / tile), flat_color, flat_share);
			vec3 b = textureGrad(layer_normal, vec3(uv, index), dpx.xz / tile, dpy.xz / tile).rgb;
			b.xy = mix(b.xy, vec2(0.5), flat_share);
			float k = top * (1.0 - patch);
			color += a * k;
			vec2 t = b.xy * 2.0 - 1.0;
			detail += vec4(t.x, 0.0, -t.y, b.z) * k;
		}
		if (patch > 0.01) {
			float scale = tile * 1.31;
			vec2 uv = (TURN * wp.xz) / scale + vec2(0.37, 0.61);
			vec2 gx = (TURN * dpx.xz) / scale;
			vec2 gy = (TURN * dpy.xz) / scale;
			vec4 a = mix(textureGrad(layer_albedo, vec3(uv, index), gx, gy), flat_color, flat_share);
			vec3 b = textureGrad(layer_normal, vec3(uv, index), gx, gy).rgb;
			b.xy = mix(b.xy, vec2(0.5), flat_share);
			float k = top * patch;
			color += a * k;
			vec2 t = (b.xy * 2.0 - 1.0) * TURN; // обратно в оси мира
			detail += vec4(t.x, 0.0, -t.y, b.z) * k;
		}
	}
	if (side > 0.01) {
		// Сбоку: по вертикали и по горизонтали вдоль склона. Слои породы идут горизонтально.
		float ax = n.x * n.x;
		float az = n.z * n.z;
		float sum = max(ax + az, 1.0e-4);
		ax /= sum;
		az /= sum;
		// Две копии: мелкая — фактура камня, крупная (в 3,7 раза) — пласты и трещины, видные издалека.
		const float BIG = 3.7;
		float average = dot(LAYER_COLOR[layer], vec3(0.2126, 0.7152, 0.0722));
		float big_flat = smoothstep(0.1, 0.45, reach / (tile * BIG));
		if (az > 0.02) {
			vec2 uv = vec2(wp.x, -wp.y) / tile;
			vec2 gx = vec2(dpx.x, -dpx.y) / tile;
			vec2 gy = vec2(dpy.x, -dpy.y) / tile;
			vec4 a = mix(textureGrad(layer_albedo, vec3(uv, index), gx, gy), flat_color, flat_share);
			vec3 b = textureGrad(layer_normal, vec3(uv, index), gx, gy).rgb;
			b.xy = mix(b.xy, vec2(0.5), flat_share);
			vec4 a2 = mix(textureGrad(layer_albedo, vec3(uv / BIG + vec2(0.31, 0.17), index), gx / BIG, gy / BIG), flat_color, big_flat);
			vec3 b2 = textureGrad(layer_normal, vec3(uv / BIG + vec2(0.31, 0.17), index), gx / BIG, gy / BIG).rgb;
			b2.xy = mix(b2.xy, vec2(0.5), big_flat);
			float k = side * az;
			a.rgb *= mix(1.0, dot(a2.rgb, vec3(0.2126, 0.7152, 0.0722)) / average, 0.62);
			a.a = mix(a.a, a2.a, 0.5);
			color += a * k;
			vec2 t = (b.xy * 2.0 - 1.0) + (b2.xy * 2.0 - 1.0) * 1.4;
			detail += vec4(t.x, t.y, 0.0, b.z) * k;
		}
		if (ax > 0.02) {
			vec2 uv = vec2(wp.z, -wp.y) / tile + vec2(0.5, 0.0);
			vec2 gx = vec2(dpx.z, -dpx.y) / tile;
			vec2 gy = vec2(dpy.z, -dpy.y) / tile;
			vec4 a = mix(textureGrad(layer_albedo, vec3(uv, index), gx, gy), flat_color, flat_share);
			vec3 b = textureGrad(layer_normal, vec3(uv, index), gx, gy).rgb;
			b.xy = mix(b.xy, vec2(0.5), flat_share);
			vec4 a2 = mix(textureGrad(layer_albedo, vec3(uv / BIG + vec2(0.73, 0.41), index), gx / BIG, gy / BIG), flat_color, big_flat);
			vec3 b2 = textureGrad(layer_normal, vec3(uv / BIG + vec2(0.73, 0.41), index), gx / BIG, gy / BIG).rgb;
			b2.xy = mix(b2.xy, vec2(0.5), big_flat);
			float k = side * ax;
			a.rgb *= mix(1.0, dot(a2.rgb, vec3(0.2126, 0.7152, 0.0722)) / average, 0.62);
			a.a = mix(a.a, a2.a, 0.5);
			color += a * k;
			vec2 t = (b.xy * 2.0 - 1.0) + (b2.xy * 2.0 - 1.0) * 1.4;
			detail += vec4(0.0, t.y, t.x, b.z) * k;
		}
	}
	color.rgb *= gain;
}

void fragment() {
	vec2 p = world_position.xz;
	vec2 pn = p + noise_shift;
	vec2 uv = (p - bake_rect.xy) / bake_rect.zw;
	vec3 dpx = dFdx(world_position);
	vec3 dpy = dFdy(world_position);

	// ── География точки ────────────────────────────────────────────────────────
	vec4 baked = texture(normal_map, uv);
	vec3 n = vec3(baked.g, sqrt(max(1.0 - dot(baked.gb, baked.gb), 0.0)), baked.b);
	float h = textureLod(height_map, uv, 0.0).r;
	float steep = 1.0 - n.y; // 0 — ровно, 0,13 — склон 30°, 0,29 — 45°, 0,5 — 60°
	// Форма рельефа вокруг: ложбина (больше нуля, метры) или гребень (меньше нуля) — по сглаженной копии высот.
	float cavity = textureLod(height_map, uv, 3.0).r - h;
	vec4 gb = textureLod(ground_b, uv, 0.0);
	// Уровень воды озера — из ближайшей точки рельефа (между точками его усреднять нельзя: рядом «озера нет»).
	vec2 cells = vec2(textureSize(height_map, 0));
	float lake_level = textureLod(height_map, (floor(uv * cells) + 0.5) / cells, 0.0).a;
	float lake_depth = lake_level > -900.0 ? lake_level - h : -1.0;

	// Шум четырёх масштабов: сотни метров, десятки, метры. У каждой карты свой (сдвиг от зерна).
	vec4 macro = texture(noise_map, pn / 1700.0 + vec2(0.13, 0.71));
	vec4 meso = texture(noise_map, pn / 310.0 + vec2(0.37, 0.09));
	vec4 fine = texture(noise_map, pn / 61.0 + vec2(0.71, 0.23));
	vec4 micro = texture(noise_map, pn / 13.0 + vec2(0.29, 0.83));
	// Границы местностей гуляют: доли читаются в точке, сдвинутой шумом на десятки метров, — местность не кончается
	// по стороне гекса. Берег моря и озёр не сдвигается: пляж и урез воды остаются на своих местах.
	// Сдвиг четырёх масштабов: языками в две-три сотни метров и лопастями в сотню (стороны и углы гексов
	// не угадываются и с высоты: сдвиг меняется вдоль одной стороны гекса, а не двигает гекс целиком), зубцами
	// в десятки метров и мелкой бахромой.
	vec4 region = texture(noise_map, pn / 520.0 + vec2(0.53, 0.19));
	vec4 lobes = texture(noise_map, pn / 190.0 + vec2(0.21, 0.67));
	vec2 drift = (region.gb - 0.5) * 90.0 + (lobes.rg - 0.5) * 60.0 + (fine.ba - 0.5) * 26.0 + (micro.rg - 0.5) * 7.0;
	// Насколько точка далеко от камеры: 0 — точка экрана мельче 20 см земли, 1 — крупнее метра с лишним.
	float footprint = length(dpx.xz) + length(dpy.xz);
	float far = smoothstep(0.4, 2.5, footprint);
	vec4 ga = textureLod(ground_a, uv + drift / bake_rect.zw, 0.0);
	// Те же доли, усреднённые на сотню метров, — для влажности: она меняется плавнее, чем сама местность.
	vec4 wide_a = textureLod(ground_a, uv + 0.5 * drift / bake_rect.zw, 4.0);
	vec4 wide_b = textureLod(ground_b, uv, 4.5);
	float flow = textureLod(ground_c, uv + (fine.rg - 0.5) * 7.0 / bake_rect.zw, 0.0).r;

	// Пласты породы лежат не строго горизонтально: у острова общий наклон пластов (падение — несколько градусов),
	// и они плавно изгибаются. На столько метров сдвигается по высоте рисунок скалы в точке.
	const vec2 DIP = vec2(0.07, 0.04);
	float bend = dot(p, DIP) + 9.0 * (meso.r - 0.5) + 2.4 * (fine.r - 0.5);
	vec3 rock_position = world_position + vec3(0.0, bend, 0.0);
	vec3 rock_dpx = dpx + vec3(0.0, dot(dpx.xz, DIP), 0.0);
	vec3 rock_dpy = dpy + vec3(0.0, dot(dpy.xz, DIP), 0.0);

	// Малый остров: весь «камень» каталога — скала; порода своя.
	bool islet = islet_region;
	int rock = rock_kind;
	for (int i = 0; i < inner_count; i++) {
		if (distance(p, inner_islets[i].xy) < inner_islets[i].z) {
			islet = true;
			rock = int(inner_islets[i].w + 0.5);
		}
	}

	// Доли местностей: на стыке — пятнами, а не ровным туманом. Полоса стыка остаётся широкой (десятки метров):
	// в ней материалы двух местностей идут вперемешку — это и есть переходная земля.
	vec4 biome = ga;
	float oasis = gb.a;
	float biome_sum = biome.x + biome.y + biome.z + biome.w + oasis;
	vec4 mixing = 4.0 * biome * (1.0 - biome);
	biome = max(biome + (meso - 0.5) * 0.7 * mixing + (fine - 0.5) * 0.3 * mixing, 0.0);
	biome = pow(biome, vec4(1.4));
	float oasis_sharp = pow(oasis, 1.4);
	float sharp_sum = biome.x + biome.y + biome.z + biome.w + oasis_sharp;
	float fit = min(biome_sum, 1.0) / max(sharp_sum, 1.0e-4);
	biome *= fit;
	oasis = oasis_sharp * fit;
	float desert = biome.x;
	float hills = biome.y;
	float meadow = biome.z;
	float mountains = biome.w;
	// Суша без местности — прибрежная полоса за сторонами гексов (и дно): пляж или обрыв.
	float coast = clamp(1.0 - (desert + hills + meadow + mountains + oasis), 0.0, 1.0);

	float lake = gb.r;
	float shore = gb.g * 64.0; // метров от уреза моря вглубь суши
	float stone = gb.b;
	float flat_ground = 1.0 - smoothstep(0.03, 0.12, steep);
	float hollow = smoothstep(0.2, 1.1, cavity);
	float crest = smoothstep(0.4, 1.8, -cavity);
	float channel = smoothstep(0.36, 0.76, flow); // ложбина стока, русло

	// Влажность. Основа — от местности вокруг (пустыня сухая, луг и оазис влажные), усреднённой на сотню метров;
	// влажнее у озёр, в ложбинах и по руслам стока; суше на гребнях, на высоте и на крутом, где вода не держится.
	// Природные отклонения — на сотни метров (сухие и влажные края) и на десятки.
	float wide_sum = wide_a.x + wide_a.y + wide_a.z + wide_a.w + wide_b.a;
	float moisture = (wide_a.x * 0.05 + wide_a.y * 0.36 + wide_a.z * 0.66 + wide_a.w * 0.32 + wide_b.a * 0.95
			+ max(1.0 - wide_sum, 0.0) * 0.3) / max(wide_sum, 1.0);
	moisture += 0.4 * wide_b.r + 0.25 * lake + 0.28 * channel + 0.12 * hollow - 0.14 * crest
			- 0.12 * smoothstep(30.0, 110.0, h) - 0.2 * smoothstep(0.1, 0.4, steep)
			+ 0.36 * (macro.r - 0.5) + 0.18 * (meso.a - 0.5) + 0.08 * (fine.g - 0.5);
	moisture = clamp(moisture, 0.0, 1.0);

	// ── Картинка: какие материалы лежат на такой земле ─────────────────────────
	float w[LAYER_COUNT];
	for (int i = 0; i < LAYER_COUNT; i++) {
		w[i] = 0.0;
	}
	// Цвет открытого грунта — по большим территориям: где красная почва, где светлый щебнистый грунт.
	float red_soil = smoothstep(0.35, 0.65, macro.b + 0.2 * (meso.r - 0.5));

	// Пустыня. Чистый песок — где сухо. С ростом влажности (к границе луга, к озеру, по руслу) песок сменяется плотным
	// грунтом с камнями, потом появляется редкая сухая трава: переходная земля между пустыней и зеленью.
	// Пятнами в сотни метров — каменистая пустыня; по сухим руслам — щебень; в замкнутых низинах — глина.
	// Переходы — не контуром, а крапом: песок языками и пятнами заходит на плотный грунт, трава растёт отдельными
	// куртинами — чем влажнее, тем их больше, и только у самой зелени они смыкаются.
	float md = moisture + 0.2 * (fine.r - 0.5) + 0.14 * (micro.g - 0.5);
	float sandy = 1.0 - smoothstep(0.14, 0.4, md);
	float reg = clamp(smoothstep(0.52, 0.84, macro.g + 0.25 * (meso.g - 0.5) + 0.2 * (fine.a - 0.5)) * 0.8 + channel * 0.8, 0.0, 1.0) * flat_ground;
	float takyr = smoothstep(0.9, 1.9, cavity) * smoothstep(0.3, 0.55, meso.b) * flat_ground;
	float tufts = speckle(smoothstep(0.28, 0.62, moisture + 0.1 * (fine.g - 0.5)), 0.55 * micro.a + 0.45 * fine.a, far);
	float firm = sandy * reg + (1.0 - sandy);
	w[L_SAND_DUNE] += desert * sandy * (1.0 - reg) * (1.0 - tufts);
	w[L_DESERT_STONE] += desert * firm * (1.0 - takyr) * (1.0 - tufts);
	w[L_MUD_CRACKED] += desert * firm * takyr * (1.0 - tufts);
	w[L_DRY_GRASS] += desert * tufts;

	// Холмы. В сухих местах (гребни, сухие края) — открытый грунт и редкая трава; обычно — сухая трава с валунами;
	// во влажных ложбинах и по руслам — луговая. На гребнях и склонах выходит плитняк; мелкими пятнами — почва.
	float mh = moisture + 0.12 * (fine.b - 0.5) + 0.06 * (micro.r - 0.5);
	float open_ground = 1.0 - smoothstep(0.08, 0.26, mh);
	float green = smoothstep(0.44, 0.68, mh);
	float outcrop = clamp(crest * 0.8 + smoothstep(0.09, 0.24, steep), 0.0, 1.0) * (0.45 + 0.55 * fine.r);
	float soil_spot = smoothstep(0.7, 0.95, meso.g + 0.34 * (fine.r - 0.5) + 0.2 * (micro.g - 0.5)) * 0.52;
	float bare = clamp(open_ground * 0.5 + soil_spot, 0.0, 0.62) * (1.0 - outcrop) * (1.0 - 0.6 * smoothstep(0.08, 0.2, steep));
	float turf = max(1.0 - outcrop - bare, 0.0);
	w[L_HILL_STONE] += hills * outcrop;
	w[L_SOIL_RED] += hills * bare * red_soil;
	w[L_DESERT_STONE] += hills * bare * (1.0 - red_soil);
	w[L_MEADOW] += hills * turf * green;
	w[L_DRY_GRASS] += hills * turf * (1.0 - green);

	// Луга. Обычно — густая трава; в сухих местах выгорает; во влажных низинах сочная и тёмная.
	float mm = moisture + 0.12 * (fine.a - 0.5) + 0.06 * (micro.b - 0.5);
	float parched = 1.0 - smoothstep(0.34, 0.56, mm);
	float lush = smoothstep(0.62, 0.82, mm) * (1.0 - parched);
	float soaked = smoothstep(0.86, 1.0, mm) * hollow;
	w[L_DRY_GRASS] += meadow * parched;
	w[L_GRASS_LUSH] += meadow * lush * 0.6 * (1.0 - 0.5 * soaked);
	w[L_OASIS_GREEN] += meadow * lush * 0.6 * 0.5 * soaked;
	w[L_MEADOW] += meadow * (1.0 - parched - lush * 0.6);

	// Горы (там, где не скала: она добавляется ниже для всех местностей). На пологом — трава с камнем; круче —
	// вперемешку с осыпью; сухие высокие склоны — щебень и плитняк.
	float mt = moisture + 0.12 * (fine.g - 0.5);
	float scree = smoothstep(0.1, 0.2, steep + (fine.g - 0.5) * 0.06) * smoothstep(0.35, 0.65, fine.b + 0.5 * (micro.b - 0.5)) * 0.55;
	float barren = (1.0 - smoothstep(0.16, 0.3, mt)) * (1.0 - scree);
	w[L_MOUNTAIN_SLOPE] += mountains * (1.0 - scree - barren);
	w[L_SCREE] += mountains * (scree + 0.5 * barren);
	w[L_HILL_STONE] += mountains * 0.5 * barren;

	// Оазис: влажная зелень и сочная трава.
	w[L_OASIS_GREEN] += oasis * 0.6;
	w[L_GRASS_LUSH] += oasis * 0.4;

	// Прибрежная полоса без местности (ниже — песок пляжа, он добавляется ниже): сухая трава, в сухих местах грунт.
	float coast_turf = 0.45 + 0.55 * smoothstep(0.12, 0.3, moisture + 0.12 * (fine.b - 0.5));
	w[L_DRY_GRASS] += coast * step(0.0, h) * coast_turf;
	w[L_DESERT_STONE] += coast * step(0.0, h) * (1.0 - coast_turf);

	// Берег озера и пруда: у воды — зелень; местами у самого уреза — полоска гальки и песка, местами трава до воды.
	// Под водой у берега галька, глубже — тёмный ил.
	float bank = smoothstep(0.3, 0.75, lake + (fine.b - 0.5) * 0.2);
	float strand = smoothstep(0.93, 0.995, lake + (fine.b - 0.5) * 0.05) * smoothstep(0.42, 0.6, meso.b + 0.4 * (fine.a - 0.5));
	float drowned = smoothstep(-0.12, 0.08, lake_depth);
	float waterline = max(strand, drowned);
	float green_bank = 0.4 * bank * (1.0 - waterline);
	for (int i = 0; i < LAYER_COUNT; i++) {
		w[i] *= (1.0 - green_bank) * (1.0 - waterline);
	}
	w[L_OASIS_GREEN] += green_bank * 0.65;
	w[L_GRASS_LUSH] += green_bank * 0.35;
	float silt = drowned * smoothstep(0.25, 1.0, lake_depth);
	float lake_stones = smoothstep(0.3, 0.6, fine.a + 0.3 * (micro.a - 0.5));
	w[L_PEBBLES] += waterline * (1.0 - silt) * lake_stones;
	w[L_BEACH_SAND] += waterline * (1.0 - silt) * (1.0 - lake_stones);
	w[L_DESERT_STONE] += waterline * silt;

	// Морской берег. Пляж — где берег низкий и не обрыв: светлый песок у воды, дальше местность.
	float beach = (1.0 - smoothstep(12.0, 30.0, shore + (fine.b - 0.5) * 16.0 + (meso.a - 0.5) * 10.0))
			* smoothstep(5.0, 2.6, h) * (1.0 - smoothstep(0.25, 0.6, stone)) * step(0.0, h) * (1.0 - waterline);
	for (int i = 0; i < LAYER_COUNT; i++) {
		w[i] *= 1.0 - beach;
	}
	w[L_BEACH_SAND] += beach;

	// Дно моря: песок, у скалистых берегов — камень пятнами.
	float under = smoothstep(0.05, -0.35, h);
	float reef = clamp(smoothstep(0.3, 0.7, stone) * smoothstep(0.42, 0.62, fine.a + (meso.b - 0.5) * 0.3), 0.0, 1.0);
	for (int i = 0; i < LAYER_COUNT; i++) {
		w[i] *= 1.0 - under;
	}
	w[L_BEACH_SAND] += under * (1.0 - reef);
	w[L_PEBBLES] += under * reef * 0.35;

	// Скала: круче ~40° — камень у любой местности; у обрыва берега, в горах и на малых островах порог ниже.
	// На малом острове «камень» каталога — скала и на пологом.
	float cliff_zone = islet ? smoothstep(0.3, 0.7, stone) : stone * (1.0 - smoothstep(60.0, 64.0, shore));
	float rock_edge = mix(0.3, 0.17, clamp(max(cliff_zone, mountains), 0.0, 1.0));
	float rocky = smoothstep(rock_edge, rock_edge + 0.16, steep + (fine.g - 0.5) * 0.08 + (micro.r - 0.5) * 0.04);
	if (islet) {
		rocky = max(rocky, smoothstep(0.45, 0.8, stone + (fine.r - 0.5) * 0.25) * step(0.0, h));
	}
	rocky = max(rocky, under * reef * 0.65);
	// Полоса перед скалой. У подножия (вогнутый склон) — осыпь: обломки, скатившиеся со стены. У кромки обрыва
	// (выпуклый склон) дёрн редеет: трава уступает грунту и плитняку, и только потом открывается скала.
	// По руслам стока на склонах — промоины: грунт и щебень вместо травы.
	float near_rock = (1.0 - rocky) * smoothstep(rock_edge - 0.13, rock_edge, steep);
	float at_foot = smoothstep(-0.5, 0.5, cavity);
	float talus = near_rock * at_foot * 0.75 * smoothstep(0.25, 0.55, fine.b + 0.5 * (micro.b - 0.5));
	float rim = near_rock * (1.0 - at_foot) * 0.75 * step(0.0, h);
	float gully = channel * smoothstep(0.06, 0.2, steep) * (1.0 - rocky) * (1.0 - under) * 0.7;
	float worn = clamp(talus + rim + gully, 0.0, 0.92);
	for (int i = 0; i < LAYER_COUNT; i++) {
		w[i] *= (1.0 - rocky) * (1.0 - worn);
	}
	float share = worn / max(talus + rim + gully, 1.0e-4);
	w[L_SCREE] += (talus + 0.5 * gully) * share;
	w[L_HILL_STONE] += 0.5 * rim * share;
	w[L_SOIL_RED] += (0.5 * rim + 0.5 * gully) * share * red_soil;
	w[L_DESERT_STONE] += (0.5 * rim + 0.5 * gully) * share * (1.0 - red_soil);
	// Порода: известняк; на главных островах — красный песчаник пластами по высоте (ниже он, выше известняк),
	// а где именно — решает крупный шум: граница пород идёт вдоль склона, а не клиньями сверху вниз.
	int rock_layer = L_ROCK_CLIFF;
	vec3 rock_tint = vec3(1.0);
	float strata = 0.0;
	if (rock == 1) {
		rock_layer = L_ROCK_STRATA;
	} else if (rock == 2) {
		rock_layer = L_LICHEN_ROCK;
	} else if (rock == 3) {
		rock_layer = L_LICHEN_ROCK;
		rock_tint = vec3(0.46, 0.4, 0.38);
	} else if (!islet) {
		float bed = textureLod(noise_map, vec2((h + bend) / 140.0 + 0.2, (pn.x + pn.y) / 3100.0), 1.0).b;
		strata = smoothstep(0.54, 0.64, 0.55 * macro.a + 0.45 * bed + 0.06 * (fine.r - 0.5));
	}
	// Потёки воды на скале: по руслам стока камень темнее.
	rock_tint *= 1.0 - 0.2 * channel;
	w[rock_layer] += rocky * (1.0 - strata);
	w[L_ROCK_STRATA] += rocky * strata;

	// Три главных материала точки.
	int i0 = 0;
	int i1 = 0;
	int i2 = 0;
	float w0 = -1.0;
	float w1 = -1.0;
	float w2 = -1.0;
	for (int i = 0; i < LAYER_COUNT; i++) {
		float v = w[i];
		if (v > w0) {
			w2 = w1;
			i2 = i1;
			w1 = w0;
			i1 = i0;
			w0 = v;
			i0 = i;
		} else if (v > w1) {
			w2 = w1;
			i2 = i1;
			w1 = v;
			i1 = i;
		} else if (v > w2) {
			w2 = v;
			i2 = i;
		}
	}
	w0 = max(w0, 1.0e-4);
	w1 = max(w1, 0.0);
	w2 = max(w2, 0.0);
	float total = w0 + w1 + w2;
	w0 /= total;
	w1 /= total;
	w2 /= total;

	float side = smoothstep(0.13, 0.36, steep);
	// Вблизи (точка экрана меньше 20 см земли) съёмкам с воздуха добавляется мелкая фактура травы.
	float near = 1.0 - smoothstep(0.06, 0.2, footprint);
	// В переходной полосе материалы идут крапом — у каждого свой мелкий шум: граница не контур, а россыпь пятен
	// в метр-другой. Издалека крап сливается в плавный переход (шум усредняется сам).
	float patch0 = patch_mask(i0, p, dpx.xz, dpy.xz);
	vec4 c0;
	vec4 d0;
	fetch_layer(i0, rock_position, n, is_rock(i0) ? side : 0.0, patch0, near, rock_dpx, rock_dpy, c0, d0);
	vec4 c1 = vec4(0.0);
	vec4 d1 = vec4(0.0);
	vec4 c2 = vec4(0.0);
	vec4 d2 = vec4(0.0);
	float e0 = w0 + 0.45 * blend_height(i0, c0.a) + 0.34 * layer_jitter(i0, pn, dpx.xz, dpy.xz);
	float e1 = -8.0;
	float e2 = -8.0;
	if (w1 > 0.015) {
		float patch1 = patch_mask(i1, p, dpx.xz, dpy.xz);
		fetch_layer(i1, rock_position, n, is_rock(i1) ? side : 0.0, patch1, near, rock_dpx, rock_dpy, c1, d1);
		e1 = w1 + 0.45 * blend_height(i1, c1.a) + 0.34 * layer_jitter(i1, pn, dpx.xz, dpy.xz);
	}
	if (w2 > 0.015) {
		float patch2 = patch_mask(i2, p, dpx.xz, dpy.xz);
		fetch_layer(i2, rock_position, n, is_rock(i2) ? side : 0.0, patch2, near, rock_dpx, rock_dpy, c2, d2);
		e2 = w2 + 0.45 * blend_height(i2, c2.a) + 0.34 * layer_jitter(i2, pn, dpx.xz, dpy.xz);
	}
	// Оттенки — тоже от географии. Трава: чем суше, тем желтее, чем влажнее, тем гуще зелень; кочками темнее
	// и светлее; пятнами — в жёлтом цвету (там, где не сухо). Песок: большими территориями краснее или светлее.
	vec3 sand_tint = mix(vec3(1.0), vec3(1.07, 0.9, 0.76), smoothstep(0.35, 0.8, macro.b));
	sand_tint *= 1.0 + 0.1 * (meso.r - 0.5);
	float dryness = 1.0 - smoothstep(0.22, 0.8, moisture + 0.12 * (fine.r - 0.5));
	vec3 grass_tint = mix(vec3(0.8, 0.98, 0.78), vec3(1.18, 1.04, 0.72), dryness);
	grass_tint *= 1.0 + 0.24 * (fine.r - 0.5) + 0.12 * (micro.b - 0.5);
	float bloom = smoothstep(0.74, 0.9, meso.b + 0.3 * (fine.b - 0.5) + 0.2 * (micro.a - 0.5)) * 0.55 * (1.0 - dryness);
	vec3 meadow_tint = mix(grass_tint, grass_tint * vec3(1.42, 1.22, 0.62), bloom);
	// Каменистая пустыня — той же земли, что и песок вокруг: светлее и желтее, чем грунт холмов.
	vec3 stone_tint = mix(vec3(1.0), vec3(1.2, 1.27, 1.2) * sand_tint, clamp(desert * 1.5, 0.0, 1.0));
	// Красный песчаник пластов на главных островах — охристый, а не оранжевый: рядом с известняком он не «горит».
	vec3 strata_tint = vec3(1.0, 1.17, 1.3) * (1.0 - 0.2 * channel);
	c0.rgb *= layer_tint(i0, rock_layer, rock_tint, sand_tint, grass_tint, meadow_tint, stone_tint, strata_tint);
	c1.rgb *= layer_tint(i1, rock_layer, rock_tint, sand_tint, grass_tint, meadow_tint, stone_tint, strata_tint);
	c2.rgb *= layer_tint(i2, rock_layer, rock_tint, sand_tint, grass_tint, meadow_tint, stone_tint, strata_tint);

	// Смешение по высоте фактуры: выше тот материал, чья доля и высота больше; граница идёт по камням и кочкам.
	// Издалека фактура не видна — там переход шире и плавнее: вблизи россыпь пятен, вдали мягкая полоса.
	float ceiling = max(e0, max(e1, e2)) - mix(0.16, 0.42, far);
	float b0 = max(e0 - ceiling, 0.0);
	float b1 = max(e1 - ceiling, 0.0);
	float b2 = max(e2 - ceiling, 0.0);
	float b_sum = b0 + b1 + b2;
	vec4 color = (c0 * b0 + c1 * b1 + c2 * b2) / b_sum;
	vec4 detail = (d0 * b0 + d1 * b1 + d2 * b2) / b_sum;

	vec3 albedo = color.rgb;
	float roughness = detail.w;
	// Крупные пятна: светлее и темнее, теплее и холоднее — на сотни метров и на десятки.
	albedo *= 1.0 + 0.22 * (macro.a - 0.5) + 0.14 * (meso.a - 0.5);
	albedo *= mix(vec3(1.05, 1.0, 0.93), vec3(0.96, 1.0, 1.04), macro.g);
	// Форма рельефа: в ложбинах темнее, на гребнях светлее — объём читается и без теней. Во влажных низинах
	// земля темнее.
	albedo *= 1.0 - 0.3 * smoothstep(0.3, 4.0, cavity) + 0.08 * smoothstep(0.4, 3.0, -cavity);
	albedo *= 1.0 - 0.16 * smoothstep(0.7, 1.0, moisture) * hollow * step(0.0, h);
	// Снег на вершинах: выше снеговой линии; на северных склонах линия ниже, на южных выше; на крутом снег
	// не держится — там проступает скала; кромка снега идёт по неровностям камня, а не ровной чертой.
	float line = snow_line + 22.0 * n.z + 16.0 * (meso.g - 0.5) + 8.0 * (fine.a - 0.5);
	float snow = smoothstep(line - 4.0, line + 16.0, h) * (1.0 - 0.8 * smoothstep(0.36, 0.62, steep));
	float snow_cover = smoothstep(0.38, 0.6, snow + 0.3 * (color.a - 0.5) + 0.16 * (micro.g - 0.5));
	albedo = mix(albedo, vec3(0.9, 0.93, 0.98), snow_cover);
	detail.xyz *= 1.0 - 0.75 * snow_cover;
	roughness = mix(roughness, 0.6, snow_cover);
	// Мокрая полоса у воды моря и озёр: песок темнее и глаже.
	float wet = max(smoothstep(0.55, 0.05, h) * step(shore, 40.0) * (1.0 - smoothstep(0.0, 6.0, shore)), smoothstep(-0.25, 0.2, lake_depth));
	wet = max(wet, under);
	albedo *= mix(1.0, 0.68, wet);
	// Сухая земля матовая (иначе песок блестит, как пластик); мокрая — глаже.
	roughness = mix(max(roughness, 0.74), 0.3, wet * 0.8);
	// Ил на дне озера: тёмный, зеленоватый — сквозь воду озеро читается глубоким.
	albedo = mix(albedo, albedo * vec3(0.3, 0.4, 0.3), smoothstep(0.15, 1.6, lake_depth));

	if (debug_view == 1) {
		albedo = mix(vec3(0.85, 0.6, 0.25), vec3(0.1, 0.45, 0.2), moisture) * (h < 0.0 ? 0.4 : 1.0);
	} else if (debug_view == 2) {
		albedo = mix(vec3(0.7, 0.66, 0.6), vec3(0.05, 0.25, 0.9), flow) * (h < 0.0 ? 0.4 : 1.0);
	} else if (debug_view == 3) {
		albedo = mix(vec3(0.2, 0.6, 0.2), vec3(0.9, 0.2, 0.1), smoothstep(0.0, 0.5, steep));
	} else if (debug_view == 4) {
		albedo = vec3(0.5) + vec3(0.5, 0.1, -0.4) * clamp(-cavity / 3.0, -1.0, 1.0);
	}

	if (grid_strength > 0.0) {
		float pixel = 0.7071 * length(vec2(length(dpx.xz), length(dpy.xz)));
		float half_width = max(0.8, 0.85 * pixel);
		float grid_line = 1.0 - smoothstep(half_width - 0.6 * pixel, half_width + 0.6 * pixel, land_edge_distance(p));
		albedo *= 1.0 - 0.5 * grid_strength * grid_line;
	}

	vec3 normal = normalize(n + detail.xyz * 0.9);
	NORMAL = normalize((VIEW_MATRIX * vec4(normal, 0.0)).xyz);
	ALBEDO = albedo;
	ROUGHNESS = clamp(roughness, 0.08, 1.0);
	SPECULAR = mix(0.2, 0.5, wet);
	AO = mix(0.6, 1.0, color.a) * (1.0 - 0.25 * smoothstep(0.5, 5.0, cavity));
	AO_LIGHT_AFFECT = 0.35;
}
