// Земля с поверхностями (шаг 1.3 дорожной карты). Требование владельца 11.11: «красочность, насыщенность,
// сочность и контрастность цветов… природа, максимально приближенная к реальности».
//
// Как устроено:
//   • что за земля в точке — запечено вместе с рельефом (bake_ground.gdshader): доли местностей, близость воды озера,
//     расстояние от уреза моря, камень. По ним, по крутизне склона, высоте и форме рельефа (ложбина или гребень)
//     считаются доли шестнадцати материалов: песок барханов, каменистая пустыня, сухая трава, плитняк, луг, скала…
//   • материалы — фотографии настоящей земли (Poly Haven и ambientCG, свободная лицензия; tools/surfaces/make.py):
//     цвет, высота фактуры, нормаль и шероховатость. В точке читаются три главных материала и смешиваются по высоте
//     фактуры — песок ложится между камнями, трава поверх земли, а не «туманом» один в другой;
//   • плитка не повторяется: у каждого материала две копии, обычная и повёрнутая, чередуются пятнами по крупному шуму;
//   • на крутых склонах скала ложится сбоку (проекция по вертикали), слои породы идут горизонтально и не тянутся;
//   • крупные пятна цвета (суше — зеленее, светлее — темнее) идут от шума на сотни метров: издалека земля не однотонная.
shader_type spatial;
render_mode world_vertex_coords;

#include "res://src/terrain/hex.gdshaderinc"
#include "res://src/terrain/surface_layers.gdshaderinc"

uniform sampler2D height_map : filter_linear_mipmap, repeat_disable;
uniform sampler2D normal_map : filter_linear_mipmap, repeat_disable; // та же текстура, со сглаживанием вдали
uniform sampler2D ground_a : filter_linear, repeat_disable; // доли местностей: пустыня, холмы, луга, горы
uniform sampler2D ground_b : filter_linear, repeat_disable; // озеро рядом, от уреза моря, камень, оазис
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

// Какая из двух копий плитки материала в точке (0 — обычная, 1 — повёрнутая): пятна в несколько плиток,
// у каждого материала свои. Шаг точки экрана передаётся явно: функция вызывается и внутри условий.
float patch_mask(int layer, vec2 p, vec2 dpx, vec2 dpy) {
	float scale = LAYER_TILE[layer] * 6.3;
	return smoothstep(0.42, 0.58, textureGrad(noise_map, p / scale + vec2(0.11 * float(layer), 0.5), dpx / scale, dpy / scale).g);
}

// Оттенок материала: у скалы — порода области, у песка барханов и у травы — свои.
vec3 layer_tint(int layer, int rock_layer, vec3 rock_tint, vec3 sand_tint, vec3 grass_tint, vec3 meadow_tint) {
	if (layer == rock_layer) {
		return rock_tint;
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
// шероховатость (w). p — точка на земле, wp — точка мира, n — нормаль рельефа, side — доля боковой проекции
// (крутой склон скалы), patch — какая из двух копий плитки (0…1). dpx, dpy — шаг точки экрана по земле.
void fetch_layer(int layer, vec3 wp, vec3 n, float side, float patch, vec3 dpx, vec3 dpy, out vec4 color, out vec4 detail) {
	float tile = LAYER_TILE[layer];
	float index = float(layer);
	color = vec4(0.0);
	detail = vec4(0.0);
	float top = 1.0 - side;
	if (top > 0.01) {
		if (patch < 0.99) {
			vec2 uv = wp.xz / tile;
			vec4 a = textureGrad(layer_albedo, vec3(uv, index), dpx.xz / tile, dpy.xz / tile);
			vec3 b = textureGrad(layer_normal, vec3(uv, index), dpx.xz / tile, dpy.xz / tile).rgb;
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
			vec4 a = textureGrad(layer_albedo, vec3(uv, index), gx, gy);
			vec3 b = textureGrad(layer_normal, vec3(uv, index), gx, gy).rgb;
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
		if (az > 0.02) {
			vec2 uv = vec2(wp.x, -wp.y) / tile;
			vec2 gx = vec2(dpx.x, -dpx.y) / tile;
			vec2 gy = vec2(dpy.x, -dpy.y) / tile;
			vec4 a = textureGrad(layer_albedo, vec3(uv, index), gx, gy);
			vec3 b = textureGrad(layer_normal, vec3(uv, index), gx, gy).rgb;
			vec4 a2 = textureGrad(layer_albedo, vec3(uv / BIG + vec2(0.31, 0.17), index), gx / BIG, gy / BIG);
			vec3 b2 = textureGrad(layer_normal, vec3(uv / BIG + vec2(0.31, 0.17), index), gx / BIG, gy / BIG).rgb;
			float k = side * az;
			a.rgb *= mix(1.0, dot(a2.rgb, vec3(0.2126, 0.7152, 0.0722)) / average, 0.75);
			a.a = mix(a.a, a2.a, 0.5);
			color += a * k;
			vec2 t = (b.xy * 2.0 - 1.0) + (b2.xy * 2.0 - 1.0) * 1.4;
			detail += vec4(t.x, t.y, 0.0, b.z) * k;
		}
		if (ax > 0.02) {
			vec2 uv = vec2(wp.z, -wp.y) / tile + vec2(0.5, 0.0);
			vec2 gx = vec2(dpx.z, -dpx.y) / tile;
			vec2 gy = vec2(dpy.z, -dpy.y) / tile;
			vec4 a = textureGrad(layer_albedo, vec3(uv, index), gx, gy);
			vec3 b = textureGrad(layer_normal, vec3(uv, index), gx, gy).rgb;
			vec4 a2 = textureGrad(layer_albedo, vec3(uv / BIG + vec2(0.73, 0.41), index), gx / BIG, gy / BIG);
			vec3 b2 = textureGrad(layer_normal, vec3(uv / BIG + vec2(0.73, 0.41), index), gx / BIG, gy / BIG).rgb;
			float k = side * ax;
			a.rgb *= mix(1.0, dot(a2.rgb, vec3(0.2126, 0.7152, 0.0722)) / average, 0.75);
			a.a = mix(a.a, a2.a, 0.5);
			color += a * k;
			vec2 t = (b.xy * 2.0 - 1.0) + (b2.xy * 2.0 - 1.0) * 1.4;
			detail += vec4(0.0, t.y, t.x, b.z) * k;
		}
	}
}

void fragment() {
	vec2 p = world_position.xz;
	vec2 uv = (p - bake_rect.xy) / bake_rect.zw;
	vec4 baked = texture(normal_map, uv);
	vec3 n = vec3(baked.g, sqrt(max(1.0 - dot(baked.gb, baked.gb), 0.0)), baked.b);
	float h = textureLod(height_map, uv, 0.0).r;
	float steep = 1.0 - n.y; // 0 — ровно, 0,13 — склон 30°, 0,29 — 45°, 0,5 — 60°
	// Форма рельефа вокруг: ложбина (больше нуля, метры) или гребень (меньше нуля) — по сглаженным копиям высот.
	float cavity = textureLod(height_map, uv, 3.0).r - h;
	vec4 gb = texture(ground_b, uv);
	// Уровень воды озера — из ближайшей точки рельефа (между точками его усреднять нельзя: рядом «озера нет»).
	vec2 cells = vec2(textureSize(height_map, 0));
	float lake_level = textureLod(height_map, (floor(uv * cells) + 0.5) / cells, 0.0).a;
	float lake_depth = lake_level > -900.0 ? lake_level - h : -1.0;

	vec4 macro = texture(noise_map, p / 1700.0 + vec2(0.13, 0.71));
	vec4 meso = texture(noise_map, p / 310.0 + vec2(0.37, 0.09));
	vec4 fine = texture(noise_map, p / 61.0 + vec2(0.71, 0.23));
	vec4 micro = texture(noise_map, p / 13.0 + vec2(0.29, 0.83));
	// Границы местностей гуляют: доли читаются в точке, сдвинутой шумом на десятки метров, — местность не кончается
	// по стороне гекса. Берег моря и озёр не сдвигается: пляж и урез воды остаются на своих местах.
	vec2 drift = (meso.rg - 0.5) * 70.0 + (fine.ba - 0.5) * 26.0 + (micro.rg - 0.5) * 7.0;
	vec2 uv_drift = uv + drift / bake_rect.zw;
	vec4 ga = texture(ground_a, uv_drift);
	float oasis_drift = texture(ground_b, uv_drift).a;

	// Малый остров: весь «камень» каталога — скала; порода своя.
	bool islet = islet_region;
	int rock = rock_kind;
	for (int i = 0; i < inner_count; i++) {
		if (distance(p, inner_islets[i].xy) < inner_islets[i].z) {
			islet = true;
			rock = int(inner_islets[i].w + 0.5);
		}
	}

	// Доли местностей. Границы — не ровным туманом в 60 м, а пятнами: шум сдвигает их там, где местности встречаются.
	vec4 biome = ga;
	float oasis = oasis_drift;
	float biome_sum = biome.x + biome.y + biome.z + biome.w + oasis;
	vec4 mixing = 4.0 * biome * (1.0 - biome);
	biome = max(biome + (meso - 0.5) * 0.7 * mixing + (fine - 0.5) * 0.3 * mixing, 0.0);
	biome = biome * biome;
	float oasis_sharp = oasis * oasis;
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

	float w[LAYER_COUNT];
	for (int i = 0; i < LAYER_COUNT; i++) {
		w[i] = 0.0;
	}
	float flat_ground = 1.0 - smoothstep(0.03, 0.12, steep);
	float hollow = smoothstep(0.2, 1.1, cavity);
	float crest = smoothstep(0.4, 1.8, -cavity);

	// Пустыня: песок барханов; в ложбинах между грядами и на ровных пятнах — каменистая пустыня, в самых низких
	// местах — растрескавшаяся глина.
	float reg = clamp(hollow * 0.6 * smoothstep(0.3, 0.7, meso.r) + smoothstep(0.6, 0.76, macro.g + 0.25 * (meso.g - 0.5) + 0.12 * (fine.a - 0.5)) * 0.85, 0.0, 1.0) * flat_ground;
	float takyr = reg * smoothstep(0.9, 1.9, cavity) * smoothstep(0.3, 0.55, meso.b);
	w[L_SAND_DUNE] += desert * (1.0 - reg);
	w[L_DESERT_STONE] += desert * (reg - takyr);
	w[L_MUD_CRACKED] += desert * takyr;

	// Холмы: сухая трава с валунами; на гребнях и склонах — выходы плитняка; местами, мелкими рваными пятнами, —
	// красная почва. В ложбинах трава зеленее (оттенком, а не другим материалом: пятна «краской» не нужны).
	float outcrop = clamp(crest * 0.8 + smoothstep(0.09, 0.24, steep), 0.0, 1.0) * (0.45 + 0.55 * fine.r);
	float soil = smoothstep(0.8, 0.9, meso.g + 0.34 * (fine.r - 0.5) + 0.2 * (micro.g - 0.5)) * (1.0 - outcrop) * flat_ground * 0.58;
	w[L_HILL_STONE] += hills * outcrop;
	w[L_SOIL_RED] += hills * soil;
	w[L_DRY_GRASS] += hills * max(1.0 - outcrop - soil, 0.0);

	// Луга: густая трава сверху и сочная вблизи, вперемешку; суше и зеленее — оттенком.
	float lush = smoothstep(0.3, 0.7, meso.r + cavity * 0.08 + 0.2 * (micro.r - 0.5));
	w[L_MEADOW] += meadow * (1.0 - 0.5 * lush);
	w[L_GRASS_LUSH] += meadow * 0.5 * lush;

	// Горы: на пологом — трава с камнем; круче — она же вперемешку с осыпью; ещё круче — скала (добавляется ниже,
	// для всех местностей).
	float scree = smoothstep(0.1, 0.2, steep + (fine.g - 0.5) * 0.06) * smoothstep(0.35, 0.65, fine.b + 0.5 * (micro.b - 0.5)) * 0.55;
	w[L_MOUNTAIN_SLOPE] += mountains * (1.0 - scree);
	w[L_SCREE] += mountains * scree;

	// Оазис: влажная зелень и сочная трава.
	w[L_OASIS_GREEN] += oasis * 0.6;
	w[L_GRASS_LUSH] += oasis * 0.4;

	// Прибрежная полоса без местности: ниже — песок (добавляется ниже), выше — сухая трава.
	w[L_DRY_GRASS] += coast * step(0.0, h);

	// Берег озера и пруда: у воды — зелень; местами у самого уреза — полоска гальки и песка, местами трава до воды.
	// Под водой у берега галька, глубже — тёмный ил.
	float bank = smoothstep(0.3, 0.75, lake + (fine.b - 0.5) * 0.2);
	float bare = smoothstep(0.42, 0.6, meso.b + 0.4 * (fine.a - 0.5));
	float strand = smoothstep(0.93, 0.995, lake + (fine.b - 0.5) * 0.05) * bare;
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

	// Скала: круче ~40° — камень у любой местности; у обрыва берега и на малых островах порог ниже.
	// На малом острове «камень» каталога — скала и на пологом. У подножия скал — осыпь и галька.
	float cliff_zone = islet ? smoothstep(0.3, 0.7, stone) : stone * (1.0 - smoothstep(60.0, 64.0, shore));
	float rock_edge = mix(0.3, 0.17, clamp(max(cliff_zone, mountains), 0.0, 1.0));
	float rocky = smoothstep(rock_edge, rock_edge + 0.16, steep + (fine.g - 0.5) * 0.08);
	if (islet) {
		rocky = max(rocky, smoothstep(0.45, 0.8, stone + (fine.r - 0.5) * 0.25) * step(0.0, h));
	}
	rocky = max(rocky, under * reef * 0.65);
	float talus = (1.0 - rocky) * smoothstep(rock_edge - 0.12, rock_edge, steep) * 0.5 * smoothstep(0.3, 0.6, fine.b + 0.5 * (micro.b - 0.5));
	for (int i = 0; i < LAYER_COUNT; i++) {
		w[i] *= (1.0 - rocky) * (1.0 - talus);
	}
	w[L_SCREE] += talus;
	// Порода: известняк; на главных островах пятнами в сотни метров — красный слоистый песчаник.
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
		// Пласты: красный песчаник лежит слоями по высоте (ниже — он, выше — известняк), а где именно — решает
		// крупный шум: граница пород идёт вдоль склона, а не клиньями сверху вниз.
		float bed = textureLod(noise_map, vec2(h / 140.0 + 0.2, (p.x + p.y) / 3100.0), 1.0).b;
		strata = smoothstep(0.5, 0.58, 0.55 * macro.a + 0.45 * bed + 0.06 * (fine.r - 0.5));
	}
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

	vec3 dpx = dFdx(world_position);
	vec3 dpy = dFdy(world_position);
	float side = smoothstep(0.13, 0.36, steep);
	// Какая копия плитки: пятна в несколько плиток, у каждого материала свои.
	float patch0 = patch_mask(i0, p, dpx.xz, dpy.xz);
	vec4 c0;
	vec4 d0;
	fetch_layer(i0, world_position, n, is_rock(i0) ? side : 0.0, patch0, dpx, dpy, c0, d0);
	vec4 c1 = vec4(0.0);
	vec4 d1 = vec4(0.0);
	vec4 c2 = vec4(0.0);
	vec4 d2 = vec4(0.0);
	float e0 = w0 + 0.45 * c0.a;
	float e1 = -8.0;
	float e2 = -8.0;
	if (w1 > 0.015) {
		float patch1 = patch_mask(i1, p, dpx.xz, dpy.xz);
		fetch_layer(i1, world_position, n, is_rock(i1) ? side : 0.0, patch1, dpx, dpy, c1, d1);
		e1 = w1 + 0.45 * c1.a;
	}
	if (w2 > 0.015) {
		float patch2 = patch_mask(i2, p, dpx.xz, dpy.xz);
		fetch_layer(i2, world_position, n, is_rock(i2) ? side : 0.0, patch2, dpx, dpy, c2, d2);
		e2 = w2 + 0.45 * c2.a;
	}
	// Оттенки по материалам: тёмная порода вулкана; песок местами краснее; трава местами суше, кочками темнее
	// и светлее, пятнами — в жёлтом цвету.
	vec3 sand_tint = mix(vec3(1.0), vec3(1.07, 0.9, 0.76), smoothstep(0.35, 0.8, macro.b));
	float dryness = clamp(0.4 + 1.0 * (macro.r - 0.5) + 0.6 * (meso.a - 0.5) + 0.2 * (fine.g - 0.5) - cavity * 0.07 - lake * 0.7, 0.0, 1.0);
	vec3 grass_tint = mix(vec3(0.84, 1.0, 0.82), vec3(1.16, 1.04, 0.74), dryness);
	grass_tint *= 1.0 + 0.26 * (fine.r - 0.5) + 0.14 * (micro.b - 0.5);
	float bloom = smoothstep(0.74, 0.9, meso.b + 0.3 * (fine.b - 0.5) + 0.2 * (micro.a - 0.5)) * 0.55;
	vec3 meadow_tint = mix(grass_tint, grass_tint * vec3(1.42, 1.22, 0.62), bloom);
	c0.rgb *= layer_tint(i0, rock_layer, rock_tint, sand_tint, grass_tint, meadow_tint);
	c1.rgb *= layer_tint(i1, rock_layer, rock_tint, sand_tint, grass_tint, meadow_tint);
	c2.rgb *= layer_tint(i2, rock_layer, rock_tint, sand_tint, grass_tint, meadow_tint);

	// Смешение по высоте фактуры: выше тот материал, чья доля и высота больше; граница резкая, по камням и кочкам.
	float ceiling = max(e0, max(e1, e2)) - 0.16;
	float b0 = max(e0 - ceiling, 0.0);
	float b1 = max(e1 - ceiling, 0.0);
	float b2 = max(e2 - ceiling, 0.0);
	float b_sum = b0 + b1 + b2;
	vec4 color = (c0 * b0 + c1 * b1 + c2 * b2) / b_sum;
	vec4 detail = (d0 * b0 + d1 * b1 + d2 * b2) / b_sum;

	vec3 albedo = color.rgb;
	float roughness = detail.w;
	// Крупные пятна: светлее и темнее, теплее и холоднее — на сотни метров и на десятки.
	albedo *= 1.0 + 0.26 * (macro.r - 0.5) + 0.16 * (meso.a - 0.5);
	albedo *= mix(vec3(1.05, 1.0, 0.93), vec3(0.96, 1.0, 1.04), macro.g);
	// Форма рельефа: в ложбинах темнее, на гребнях светлее — объём читается и без теней.
	float shade = 1.0 - 0.3 * smoothstep(0.3, 4.0, cavity) + 0.08 * smoothstep(0.4, 3.0, -cavity);
	albedo *= shade;
	// Мокрая полоса у воды моря и озёр: песок темнее и глаже.
	float wet = max(smoothstep(0.55, 0.05, h) * step(shore, 40.0) * (1.0 - smoothstep(0.0, 6.0, shore)), smoothstep(-0.25, 0.2, lake_depth));
	wet = max(wet, under);
	albedo *= mix(1.0, 0.68, wet);
	roughness = mix(roughness, 0.3, wet * 0.8);
	// Ил на дне озера: тёмный, зеленоватый — сквозь воду озеро читается глубоким.
	albedo = mix(albedo, albedo * vec3(0.3, 0.4, 0.3), smoothstep(0.15, 1.6, lake_depth));

	if (grid_strength > 0.0) {
		float pixel = 0.7071 * length(vec2(length(dpx.xz), length(dpy.xz)));
		float half_width = max(0.8, 0.85 * pixel);
		float grid_line = 1.0 - smoothstep(half_width - 0.6 * pixel, half_width + 0.6 * pixel, land_edge_distance(p));
		albedo *= 1.0 - 0.5 * grid_strength * grid_line;
	}

	vec3 normal = normalize(n + detail.xyz * 0.85);
	NORMAL = normalize((VIEW_MATRIX * vec4(normal, 0.0)).xyz);
	ALBEDO = albedo;
	ROUGHNESS = clamp(roughness, 0.08, 1.0);
	SPECULAR = mix(0.28, 0.5, wet);
	AO = mix(0.6, 1.0, color.a) * (1.0 - 0.25 * smoothstep(0.5, 5.0, cavity));
	AO_LIGHT_AFFECT = 0.35;
}
