// Ближний вид земли: материалы точки — цвет, мелкий рельеф, высота фактуры (шаг 1.3 «Поверхности»).
// Общий код для двух шейдеров: шейдера кадра (terrain_surface.gdshader — считает точку экрана напрямую) и запекания
// кэша ближнего вида вокруг камеры (bake_near.gdshader — считает ту же точку один раз в текстуру, а кадр её потом
// только читает). Один код — одна картинка: кэш не может выглядеть иначе, чем прямой расчёт.
//
// Какие материалы где лежат, решено при постройке мира (bake_surface.gdshader); здесь они только читаются:
//   • три главных материала точки и их доли (шаг 2 м) — в точке, сдвинутой мелким шумом на метр-другой:
//     границы пятен идут неровной кромкой, а не по клеткам;
//   • тон (сухость, цветение, оттенок песка) и затенение по форме рельефа.
// Материалы — фотографии настоящей земли (tools/surfaces/make.py) в едином масштабе. Три главных материала точки
// смешиваются по высоте фактуры — песок ложится между камнями, трава поверх земли; у каждого материала свой мелкий
// шум — на границе не контур, а россыпь пятен. Плитка не повторяется: у материала две копии, обычная и повёрнутая,
// чередуются пятнами. На крутом скала ложится сбоку (без растяжения), пласты идут горизонтально.

#include "res://src/terrain/surface_layers.gdshaderinc"
#include "res://src/terrain/surface_tints.gdshaderinc"

// Картинка земли, запечённая при постройке мира (bake_surface.gdshader). Лежит в том же прямоугольнике, что и рельеф.
uniform sampler2D splat_index : filter_nearest, repeat_disable; // три главных материала точки (номера слоёв), «песчаность»
uniform sampler2D splat_weight : filter_linear, repeat_disable; // их доли и порода камня
uniform sampler2D surface_tone : filter_linear, repeat_disable; // сухость, цветение, оттенок песка, мокрая полоса
uniform sampler2D surface_shade : filter_linear, repeat_disable; // затенение по форме рельефа (множитель цвета / 1,5) и снег
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

const mat2 TURN = mat2(vec2(0.7961, 0.6052), vec2(-0.6052, 0.7961)); // поворот второй копии плитки, ~37°

// Уровень уменьшенной копии текстуры по шагу точки экрана: gx и gy — на сколько меняются координаты текстуры
// на точку экрана вправо и вниз, pixels — сторона текстуры в точках. Это тот же расчёт, который видеокарта делает
// сама в textureGrad, но выборка с готовым уровнем (textureLod) дешевле выборки с шагами — на встроенных
// видеокартах Intel заметно (у владельца Arc 140V). Внутри условий шаги нужно задавать явно в любом случае.
float lod_of(vec2 gx, vec2 gy, float pixels) {
	return 0.5 * log2(max(max(dot(gx, gx), dot(gy, gy)) * pixels * pixels, 1.0e-12));
}

const float NOISE_PIXELS = 512.0; // сторона текстуры шума (assets/terrain/noise.png)

// Сторона одного слоя атласа материалов в точках.
float layer_pixels() {
	return float(textureSize(layer_albedo, 0).x);
}

// Цвет (rgb, линейный) и высота фактуры (a) слоя материала. Шейдеру кадра движок отдаёт цвет текстур уже
// линейным; в запекании кэша (обычный двумерный холст, bake_near.gdshader) текстуры приходят как записаны,
// в кодировке sRGB, — там цвет переводится в линейный здесь (иначе кэш выходит светлее и бледнее кадра).
vec4 layer_texel(vec3 place, float lod) {
	vec4 texel = textureLod(layer_albedo, place, lod);
#ifdef LAYER_COLOR_IS_ENCODED
	texel.rgb = mix(texel.rgb / 12.92, pow((texel.rgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), texel.rgb));
#endif
	return texel;
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

// Наибольшая высота фактуры материала в смешении (см. blend_height): выше неё материал подняться не может.
float blend_height_limit(int layer) {
	return (layer == L_SAND_DUNE || layer == L_BEACH_SAND) ? 0.4 : 1.0;
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
		color += layer_texel(vec3(xz / tile, index), lod_of(gx / tile, gy / tile, layer_pixels())) * (1.0 - patch);
	}
	if (patch > 0.01) {
		float scale = tile * 1.31;
		color += layer_texel(vec3((TURN * xz) / scale + vec2(0.37, 0.61), index), lod_of((TURN * gx) / scale, (TURN * gy) / scale, layer_pixels())) * patch;
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
		b = textureLod(layer_normal, vec3(xz / tile, index), lod_of(gx / tile, gy / tile, layer_pixels())).rgb;
		t = b.xy * 2.0 - 1.0;
	} else {
		float scale = tile * 1.31;
		b = textureLod(layer_normal, vec3((TURN * xz) / scale + vec2(0.37, 0.61), index), lod_of((TURN * gx) / scale, (TURN * gy) / scale, layer_pixels())).rgb;
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
		vec4 a = flat_share > 0.99 ? flat_color : mix(layer_texel(vec3(uv, index), lod_of(gx, gy, layer_pixels())), flat_color, max(flat_share, ROCK_CALM));
		if (big_flat < 0.99) {
			vec4 a2 = layer_texel(vec3(uv / BIG + vec2(0.31, 0.17), index), lod_of(gx / BIG, gy / BIG, layer_pixels()));
			a.rgb *= mix(1.0, dot(a2.rgb, vec3(0.2126, 0.7152, 0.0722)) / average, 0.4 * (1.0 - big_flat));
			a.a = mix(a.a, a2.a, 0.5 * (1.0 - big_flat));
		}
		color += a * az;
		if (with_normal) {
			vec3 b = textureLod(layer_normal, vec3(uv, index), lod_of(gx, gy, layer_pixels())).rgb;
			vec2 t = (b.xy * 2.0 - 1.0) * (1.0 - flat_share);
			detail += vec4(t.x, t.y, 0.0, b.z - 0.82) * az;
		}
	}
	if (ax > 0.01) {
		vec2 uv = vec2(wp.z, -wp.y) / tile + vec2(0.5, 0.0);
		vec2 gx = vec2(dpx.z, -dpx.y) / tile;
		vec2 gy = vec2(dpy.z, -dpy.y) / tile;
		vec4 a = flat_share > 0.99 ? flat_color : mix(layer_texel(vec3(uv, index), lod_of(gx, gy, layer_pixels())), flat_color, max(flat_share, ROCK_CALM));
		if (big_flat < 0.99) {
			vec4 a2 = layer_texel(vec3(uv / BIG + vec2(0.73, 0.41), index), lod_of(gx / BIG, gy / BIG, layer_pixels()));
			a.rgb *= mix(1.0, dot(a2.rgb, vec3(0.2126, 0.7152, 0.0722)) / average, 0.4 * (1.0 - big_flat));
			a.a = mix(a.a, a2.a, 0.5 * (1.0 - big_flat));
		}
		color += a * ax;
		if (with_normal) {
			vec3 b = textureLod(layer_normal, vec3(uv, index), lod_of(gx, gy, layer_pixels())).rgb;
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
			vec3 grain = layer_texel(vec3(wp.xz / fine_tile, float(L_GRASS_LUSH)), lod_of(dpx.xz / fine_tile, dpy.xz / fine_tile, layer_pixels())).rgb;
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

// Ближний вид точки земли. wp — точка мира, n — нормаль рельефа, dpx и dpy — на сколько точка мира сдвигается
// на точку экрана вправо и вниз (в запекании кэша — на клетку кэша). Возвращает цвет, мелкий рельеф (сдвиг нормали
// в мире и шероховатость), высоту фактуры и мокроту; lead_layer и lead_share — главный материал точки и его доля.
void near_surface(vec3 wp, vec3 n, vec3 dpx, vec3 dpy, out vec3 albedo, out vec4 detail, out float texture_height,
		out float wet, out int lead_layer, out float lead_share) {
	vec2 p = wp.xz;
	vec2 pn = p + noise_shift;
	vec2 uv = (p - bake_rect.xy) / bake_rect.zw;
	// Размер точки экрана меряется по самой поверхности, а не по её тени на плане: на крутом склоне план почти
	// не меняется от точки к точке, и по нему склон считался бы «снятым в упор».
	float footprint = length(dpx) + length(dpy);
	float far = smoothstep(0.4, 2.5, footprint);
	float steep = 1.0 - n.y; // 0 — ровно, 0,13 — склон 30°, 0,29 — 45°, 0,5 — 60°
	float side = smoothstep(0.13, 0.36, steep);
	// ── Вблизи: три главных материала точки ────────────────────────────────
	// Шум трёх масштабов (у каждой карты свой — сдвиг от зерна): по нему чередуются копии плиток, идёт
	// неровная кромка пятен и мелкая неровность травы. Шаг точки экрана передаётся явно: мы внутри условия.
	vec4 meso = textureLod(noise_map, pn / 310.0 + vec2(0.37, 0.09), lod_of(dpx.xz / 310.0, dpy.xz / 310.0, NOISE_PIXELS));
	vec4 fine = textureLod(noise_map, pn / 61.0 + vec2(0.71, 0.23), lod_of(dpx.xz / 61.0, dpy.xz / 61.0, NOISE_PIXELS));
	vec4 micro = textureLod(noise_map, pn / 13.0 + vec2(0.29, 0.83), lod_of(dpx.xz / 13.0, dpy.xz / 13.0, NOISE_PIXELS));
	// Материалы запечены по клеткам в два метра. Клетка читается в точке, сдвинутой шумом на метр-другой:
	// граница пятна идёт неровной кромкой с мелкой бахромой, а не по сторонам клеток. Номера материалов
	// берутся из ближайшей клетки, доли — плавно между клетками: там, где материалы у соседних клеток те же
	// (а это почти везде), доли меняются без ступенек, и кромку пятна рисует сама фактура — камни и кочки.
	// Сдвиг подобран для клетки в два метра; у клетки крупнее он растёт вместе с ней — иначе видны её стороны.
	vec2 wobble = ((micro.rg - 0.5) * 2.6 + (micro.ba - 0.5) * 1.4 + (fine.ba - 0.5) * 2.2) * (splat_texel / 2.0);
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
	vec3 rock_position = wp + vec3(0.0, bend, 0.0);
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
	// Смешение по высоте фактуры: выше тот материал, чья доля и высота больше; граница идёт по камням и кочкам.
	// В кадр попадают материалы, которые ниже самого высокого не больше чем на band. Чем крупнее точка экрана,
	// тем переход шире и плавнее: вблизи россыпь пятен, вдали мягкая полоса.
	float band = mix(0.16, 0.42, far);
	float e0 = w0 + 0.45 * blend_height(i0, c0.a) + 0.34 * layer_jitter(i0, micro, fine);
	float e1 = -8.0;
	float e2 = -8.0;
	// Второй и третий материалы читаются, только если их в точке заметная доля — и тем большая, чем крупнее
	// точка экрана; нормаль — только у первого и, если его много, у второго.
	// И только если материал может попасть в кадр: его доля и мелкий шум известны до чтения текстур, высота
	// фактуры не больше единицы — если и с наибольшей высотой он остаётся ниже полосы смешения, в картинке его
	// нет, и читать его незачем (картинка от этого не меняется ни на точку).
	int layers_read = 1;
	float j1 = 0.34 * layer_jitter(i1, micro, fine);
	if (w1 > mix(0.07, 0.3, far) && (debug_view == 13 || w1 + 0.45 * blend_height_limit(i1) + j1 > e0 - band)) {
		c1 = layer_color(i1, rock_position, n, is_rock(i1) ? side : 0.0, patch_share(i1, meso, fine), near, rock_dpx, rock_dpy, reach, normals && w1 > 0.3, d1);
		c1.rgb *= surface_tint(i1, tone.r, tone.g, tone.b, chosen.a, shares.a, grass_shade);
		e1 = w1 + 0.45 * blend_height(i1, c1.a) + j1;
		layers_read++;
	}
	float j2 = 0.34 * layer_jitter(i2, micro, fine);
	if (w2 > mix(0.14, 0.4, far) && (debug_view == 13 || w2 + 0.45 * blend_height_limit(i2) + j2 > max(e0, e1) - band)) {
		c2 = layer_color(i2, rock_position, n, is_rock(i2) ? side : 0.0, patch_share(i2, meso, fine), near, rock_dpx, rock_dpy, reach, false, d2);
		c2.rgb *= surface_tint(i2, tone.r, tone.g, tone.b, chosen.a, shares.a, grass_shade);
		e2 = w2 + 0.45 * blend_height(i2, c2.a) + j2;
		layers_read++;
	}
	float ceiling = max(e0, max(e1, e2)) - band;
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
	if (debug_view == 8) {
		// Сколько материалов прочитано в точке: один — синий, два — зелёный, три — красный.
		albedo = layers_read == 1 ? vec3(0.1, 0.25, 0.9) : (layers_read == 2 ? vec3(0.15, 0.75, 0.2) : vec3(0.9, 0.15, 0.1));
	}
}
