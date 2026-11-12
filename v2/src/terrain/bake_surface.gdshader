// Запекание картинки земли (шаг 1.3 «Поверхности»): один раз при постройке мира видеокарта решает для каждой точки
// земли (шаг 2 м), какие материалы на ней лежат, — по правилам ниже. В кадре шейдер земли только читает готовое
// (terrain_surface.gdshader). До сборки 0.5.2 эти правила считались для каждой точки экрана в каждом кадре:
// шестнадцать выборок географии и длинная арифметика раньше первой текстуры материала — замер владельца на 0.5.1
// показал 13–18 кадров в секунду вблизи.
//
// Два уровня (так их разделил владелец):
//   • ГЕОГРАФИЯ — что есть на земле, без единого цвета: высоты и уклон (bake.gdshader), доли местностей, близость
//     воды озёр, расстояние от уреза моря, камень (bake_ground.gdshader), сток воды по рельефу (drainage.gd). Из них
//     здесь одной формулой выводится ВЛАЖНОСТЬ точки: суше в пустыне, на гребнях, на высоте и на крутом; влажнее
//     у озёр, в ложбинах, по руслам стока; плюс природные отклонения на сотни и на десятки метров.
//   • КАРТИНКА — какие материалы лежат на такой земле. Правила, а не раскраска: чистый песок — где сухо; с ростом
//     влажности на нём появляются плотный грунт с камнями и редкая трава; на холмах в сухих местах открытый грунт,
//     во влажных ложбинах луговая трава; круче сорока градусов — скала у любой местности, под ней осыпь, по кромке
//     обрыва дёрн редеет; у воды — пляж, галька, зелень. Между пустыней и лугом сама собой получается переходная
//     земля: влажность меняется плавно, на сотню метров.
//
// Что запекается (номер — настройка part; одна текстура за проход):
//   0 — три главных материала точки (номера слоёв) и «песчаность» земли вокруг;
//   1 — доли этих трёх материалов и порода камня;
//   2 — тон: сухость, цветение, оттенок песка, мокрая полоса у воды (шаг 4 м — меняется плавно);
//   3 — затенение по форме рельефа и крупные пятна светлее-темнее (множитель цвета) и снег;
//   5–7 — растительность (шаг 1.8): густота по видам, 0…1 от наибольшей густоты вида. 5 — дуб, сосна, олива,
//       кипарис; 6 — пальма, тамариск, зелёный кустарник, сухой кустарник; 7 — камни, трава, сомкнутость крон, суша.
//       По этим картам flora.gd расставляет деревья, кусты и камни, а дальний вид земли (4) красится ими же:
//       лес с высоты — цельный массив, а не точки;
//   4 — готовая картинка дальнего вида: цвет природной зоны (средние цвета материалов по их долям) с рисунком
//       главного материала, с затенением и снегом. Мелкие пятна в ней приглушены: с высоты зоны читаются цельными.
shader_type canvas_item;
render_mode blend_disabled, unshaded;

#include "res://src/terrain/surface_layers.gdshaderinc"
#include "res://src/terrain/surface_tints.gdshaderinc"

uniform sampler2D height_map : filter_linear_mipmap, repeat_disable; // высота, наклон, уровень озера
uniform sampler2D ground_a : filter_linear_mipmap, repeat_disable; // доли местностей: пустыня, холмы, луга, горы
uniform sampler2D ground_b : filter_linear_mipmap, repeat_disable; // озеро рядом, от уреза моря, камень, оазис
uniform sampler2D ground_c : filter_linear_mipmap, repeat_disable; // сток воды по рельефу: 0 — водораздел, 1 — русло
uniform sampler2D noise_map : filter_linear_mipmap, repeat_enable; // четыре независимых шума, плитка без шва
uniform sampler2DArray layer_albedo : source_color, filter_linear_mipmap, repeat_enable; // цвет и высота фактуры
uniform vec4 bake_rect; // x, z левого верхнего угла и размеры в метрах — и у запекаемого, и у текстур географии
uniform float texel = 2.0; // метров на точку
uniform vec2 noise_shift; // сдвиг шума от зерна карты: у каждой карты свои пятна
// Снеговая линия, метры над морем: выше неё на вершинах лежит снег (решение владельца 11.11: у гор белые шапки;
// замечание к 0.5.0: не у всех).
uniform float snow_line = 120.0;
// Малые острова в этой области: центр (xy), досягаемость суши (z), порода (w): 0 — тёплый известняк, 1 — красный
// слоистый песчаник, 2 — серый гранит с лишайником, 3 — тёмная вулканическая. У малого острова весь «камень»
// каталога — скала. Остров узнаётся по месту, а не по области: остров на стыке двух областей в обеих красится
// одинаково (в 0.5.1 вулкан был разрезан прямой линией — половина своей породы, половина породы главных островов).
uniform vec4 islets[8];
uniform int islet_count = 0;
uniform int part = 0;
// Расчистки (шаг 1.8): города и точки старта — xy центр, z радиус, метры. Деревья и кусты там не растут.
uniform vec4 clearings[64];
uniform int clearing_count = 0;
// Для проверки географии (ключ запуска --debug-view): вместо картинки дальнего вида — 1 влажность, 2 сток,
// 3 крутизна, 4 ложбины и гребни.
uniform int debug_view = 0;

const mat2 TURN = mat2(vec2(0.7961, 0.6052), vec2(-0.6052, 0.7961)); // поворот второй копии плитки, как в кадре

vec3 to_srgb(vec3 c) {
	return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void fragment() {
	vec2 uv = UV;
	vec2 p = bake_rect.xy + UV * bake_rect.zw;
	vec2 pn = p + noise_shift;
	// Мелкие пятна (выходы грунта, цветение, камни) в готовой картинке дальнего вида приглушены: зона читается
	// цельной. В материалах для ближнего вида они в полную силу.
	float local = part == 4 ? 0.3 : 1.0;

	// ── География точки ────────────────────────────────────────────────────────
	vec4 baked = textureLod(height_map, uv, 0.0);
	vec3 n = vec3(baked.g, sqrt(max(1.0 - dot(baked.gb, baked.gb), 0.0)), baked.b);
	float h = baked.r;
	float steep = 1.0 - n.y; // 0 — ровно, 0,13 — склон 30°, 0,29 — 45°, 0,5 — 60°
	// Форма рельефа вокруг: ложбина (больше нуля, метры) или гребень (меньше нуля) — по сглаженной копии высот.
	float cavity = textureLod(height_map, uv, 3.0).r - h;
	vec4 gb = textureLod(ground_b, uv, 0.0);
	// Уровень воды озера — из ближайшей точки рельефа (между точками его усреднять нельзя: рядом «озера нет»).
	ivec2 cells = textureSize(height_map, 0);
	float lake_level = texelFetch(height_map, clamp(ivec2(uv * vec2(cells)), ivec2(0), cells - 1), 0).a;
	float lake_depth = lake_level > -900.0 ? lake_level - h : -1.0;

	// Шум трёх масштабов: сотни метров и десятки. У каждой карты свой (сдвиг от зерна). Самого мелкого (метры) здесь
	// нет: он мельче шага запекания, его добавляет шейдер земли в кадре — неровной кромкой пятен.
	vec4 macro = textureLod(noise_map, pn / 1700.0 + vec2(0.13, 0.71), 0.0);
	vec4 meso = textureLod(noise_map, pn / 310.0 + vec2(0.37, 0.09), 0.0);
	vec4 fine = textureLod(noise_map, pn / 61.0 + vec2(0.71, 0.23), 3.0);
	vec4 micro = vec4(0.5);
	// Границы местностей гуляют: доли читаются в точке, сдвинутой шумом, — местность не кончается по стороне гекса.
	// Сдвиг трёх масштабов: языками в две-три сотни метров и лопастями в сотню (стороны и углы гексов
	// не угадываются и с высоты: сдвиг меняется вдоль одной стороны гекса, а не двигает гекс целиком) и зубцами
	// в десятки метров. Берег моря и озёр не сдвигается: пляж и урез воды остаются на своих местах.
	vec4 region = textureLod(noise_map, pn / 520.0 + vec2(0.53, 0.19), 0.0);
	vec4 lobes = textureLod(noise_map, pn / 190.0 + vec2(0.21, 0.67), 0.0);
	vec2 drift = (region.gb - 0.5) * 90.0 + (lobes.rg - 0.5) * 60.0 + (fine.ba - 0.5) * 26.0;
	vec4 ga = textureLod(ground_a, uv + drift / bake_rect.zw, 0.0);
	// Те же доли, усреднённые на сотню метров, — для влажности: она меняется плавнее, чем сама местность.
	vec4 wide_a = textureLod(ground_a, uv + 0.5 * drift / bake_rect.zw, 4.0);
	vec4 wide_b = textureLod(ground_b, uv, 4.5);
	float flow = textureLod(ground_c, uv + (fine.rg - 0.5) * 7.0 / bake_rect.zw, 0.0).r;

	// Пласты породы лежат не строго горизонтально: у острова общий наклон пластов (падение — несколько градусов),
	// и они плавно изгибаются. На столько метров сдвигается по высоте рисунок скалы в точке.
	const vec2 DIP = vec2(0.07, 0.04);
	float bend = dot(p, DIP) + 9.0 * (meso.r - 0.5) + 2.4 * (fine.r - 0.5);

	// Малый остров: весь «камень» каталога — скала; порода своя.
	bool islet = false;
	int rock = 0;
	for (int i = 0; i < islet_count; i++) {
		if (distance(p, islets[i].xy) < islets[i].z) {
			islet = true;
			rock = int(islets[i].w + 0.5);
		}
	}

	// Доли местностей: на стыке — пятнами, а не ровным туманом. Полоса стыка остаётся широкой (десятки метров):
	// в ней материалы двух местностей идут вперемешку — это и есть переходная земля.
	vec4 biome = ga;
	float oasis = gb.a;
	float biome_sum = biome.x + biome.y + biome.z + biome.w + oasis;
	vec4 mixing = 4.0 * biome * (1.0 - biome);
	biome = max(biome + (vec4(meso.rgb, meso.g) - 0.5) * 0.7 * mixing + (fine - 0.5) * 0.3 * mixing * local, 0.0);
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
	// Природные отклонения — на сотни метров (сухие и влажные края) и на десятки; зернистых отклонений нет —
	// с высоты они давали пёструю рябь.
	float wide_sum = wide_a.x + wide_a.y + wide_a.z + wide_a.w + wide_b.a;
	float moisture = (wide_a.x * 0.05 + wide_a.y * 0.36 + wide_a.z * 0.66 + wide_a.w * 0.32 + wide_b.a * 0.95
			+ max(1.0 - wide_sum, 0.0) * 0.3) / max(wide_sum, 1.0);
	moisture += 0.4 * wide_b.r + 0.25 * lake + 0.28 * channel + 0.12 * hollow - 0.14 * crest
			- 0.12 * smoothstep(30.0, 110.0, h) - 0.2 * smoothstep(0.1, 0.4, steep)
			+ 0.34 * (macro.r - 0.5) + 0.14 * (meso.g - 0.5) + 0.08 * (fine.g - 0.5) * local;
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
	// Трава растёт куртинами — чем влажнее, тем их больше, и только у самой зелени они смыкаются: здесь запекается
	// доля травы, а сами куртины складывает шейдер земли в кадре (мелкий шум и высота фактуры).
	float md = moisture + (0.2 * (fine.r - 0.5) + 0.14 * (micro.g - 0.5)) * local;
	float sandy = 1.0 - smoothstep(0.14, 0.4, md);
	float reg = clamp(smoothstep(0.52, 0.84, macro.g + 0.25 * (meso.g - 0.5) + 0.2 * (fine.a - 0.5) * local) * 0.8 + channel * 0.8, 0.0, 1.0) * flat_ground;
	float takyr = smoothstep(0.9, 1.9, cavity) * smoothstep(0.3, 0.55, meso.b) * flat_ground;
	float tuft_edge = 1.1 - 1.2 * smoothstep(0.28, 0.62, moisture + 0.1 * (fine.g - 0.5));
	float tufts = smoothstep(tuft_edge - 0.6, tuft_edge + 0.6, 0.5);
	float firm = sandy * reg + (1.0 - sandy);
	w[L_SAND_DUNE] += desert * sandy * (1.0 - reg) * (1.0 - tufts);
	w[L_DESERT_STONE] += desert * firm * (1.0 - takyr) * (1.0 - tufts);
	w[L_MUD_CRACKED] += desert * firm * takyr * (1.0 - tufts);
	w[L_DRY_GRASS] += desert * tufts;

	// Холмы. В сухих местах (гребни, сухие края) — открытый грунт и редкая трава; обычно — сухая трава с валунами;
	// во влажных ложбинах и по руслам — луговая. На гребнях и склонах выходит плитняк; мелкими пятнами — почва.
	float mh = moisture + (0.12 * (fine.b - 0.5) + 0.06 * (micro.r - 0.5)) * local;
	float open_ground = 1.0 - smoothstep(0.08, 0.26, mh);
	float green = smoothstep(0.44, 0.68, mh);
	float outcrop = clamp(crest * 0.8 + smoothstep(0.09, 0.24, steep), 0.0, 1.0) * (0.45 + 0.55 * mix(0.5, fine.r, local));
	float soil_spot = smoothstep(0.7, 0.95, meso.g + 0.34 * (fine.r - 0.5) + 0.2 * (micro.g - 0.5)) * 0.52 * local;
	float bare = clamp(open_ground * 0.5 + soil_spot, 0.0, 0.62) * (1.0 - outcrop) * (1.0 - 0.6 * smoothstep(0.08, 0.2, steep));
	float turf = max(1.0 - outcrop - bare, 0.0);
	w[L_HILL_STONE] += hills * outcrop;
	w[L_SOIL_RED] += hills * bare * red_soil;
	w[L_DESERT_STONE] += hills * bare * (1.0 - red_soil);
	w[L_MEADOW] += hills * turf * green;
	w[L_DRY_GRASS] += hills * turf * (1.0 - green);

	// Луга. Обычно — густая трава; в сухих местах выгорает; во влажных низинах сочная и тёмная.
	float mm = moisture + (0.12 * (fine.a - 0.5) + 0.06 * (micro.b - 0.5)) * local;
	float parched = 1.0 - smoothstep(0.34, 0.56, mm);
	float lush = smoothstep(0.62, 0.82, mm) * (1.0 - parched);
	float soaked = smoothstep(0.86, 1.0, mm) * hollow;
	w[L_DRY_GRASS] += meadow * parched;
	w[L_GRASS_LUSH] += meadow * lush * 0.6 * (1.0 - 0.5 * soaked);
	w[L_OASIS_GREEN] += meadow * lush * 0.6 * 0.5 * soaked;
	w[L_MEADOW] += meadow * (1.0 - parched - lush * 0.6);

	// Горы (там, где не скала: она добавляется ниже для всех местностей). На пологом — трава с камнем; круче —
	// вперемешку с осыпью; сухие высокие склоны — щебень и плитняк.
	float mt = moisture + 0.12 * (fine.g - 0.5) * local;
	float scree = smoothstep(0.12, 0.24, steep + (fine.g - 0.5) * 0.06) * smoothstep(0.35, 0.65, fine.b + 0.5 * (micro.b - 0.5)) * 0.5;
	float barren = (1.0 - smoothstep(0.14, 0.28, mt)) * (1.0 - scree);
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
	float beach = (1.0 - smoothstep(12.0, 30.0, shore + (fine.b - 0.5) * 16.0 + (meso.b - 0.5) * 10.0))
			* smoothstep(5.0, 2.6, h) * (1.0 - smoothstep(0.25, 0.6, stone)) * step(0.0, h) * (1.0 - waterline);
	// Дно моря: песок, у скалистых берегов — камень пятнами.
	float under = smoothstep(0.05, -0.35, h);
	float reef = clamp(smoothstep(0.3, 0.7, stone) * smoothstep(0.42, 0.62, fine.a + (meso.b - 0.5) * 0.3), 0.0, 1.0);
	for (int i = 0; i < LAYER_COUNT; i++) {
		w[i] *= (1.0 - beach) * (1.0 - under);
	}
	w[L_BEACH_SAND] += beach * (1.0 - under) + under * (1.0 - reef);
	w[L_PEBBLES] += under * reef * 0.35;

	// Скала: круче ~40° — камень у любой местности; у обрыва берега и на малых островах порог ниже. В горах порог
	// почти тот же, что везде (замечание владельца к 0.5.0: скалы слишком массивные и подавляют остальное):
	// на склонах гор больше травы и осыпи, скала — только на крутом.
	// На малом острове «камень» каталога — скала и на пологом.
	float cliff_zone = islet ? smoothstep(0.3, 0.7, stone) : stone * (1.0 - smoothstep(60.0, 64.0, shore));
	float rock_edge = mix(0.3, 0.19, clamp(max(cliff_zone, 0.3 * mountains), 0.0, 1.0));
	float rocky = smoothstep(rock_edge, rock_edge + 0.16, steep + ((fine.g - 0.5) * 0.08 + (micro.r - 0.5) * 0.04) * local);
	if (islet) {
		rocky = max(rocky, smoothstep(0.45, 0.8, stone + (fine.r - 0.5) * 0.25) * step(0.0, h));
	}
	rocky = max(rocky, under * reef * 0.65);
	// Полоса перед скалой. У подножия (вогнутый склон) — осыпь: обломки, скатившиеся со стены. У кромки обрыва
	// (выпуклый склон) дёрн редеет: трава уступает грунту и плитняку, и только потом открывается скала.
	// По руслам стока на склонах — промоины: грунт и щебень вместо травы.
	float near_rock = (1.0 - rocky) * smoothstep(rock_edge - 0.13, rock_edge, steep);
	float at_foot = smoothstep(-0.5, 0.5, cavity);
	float talus = near_rock * at_foot * 0.6 * smoothstep(0.25, 0.55, fine.b + 0.5 * (micro.b - 0.5));
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
	float rock_tone = 0.75;
	float strata = 0.0;
	if (rock == 1) {
		rock_layer = L_ROCK_STRATA;
	} else if (rock == 2) {
		rock_layer = L_LICHEN_ROCK;
	} else if (rock == 3) {
		rock_layer = L_LICHEN_ROCK;
		rock_tone = 1.0;
	} else if (!islet) {
		rock_tone = 0.5 * mountains;
		if (rocky > 0.001) {
			float bed = textureLod(noise_map, vec2((h + bend) / 140.0 + 0.2, (pn.x + pn.y) / 3100.0), 1.0).b;
			strata = smoothstep(0.56, 0.68, 0.55 * macro.g + 0.45 * bed + 0.06 * (fine.r - 0.5)) * (1.0 - 0.5 * mountains);
		}
	}
	w[rock_layer] += rocky * (1.0 - strata);
	w[L_ROCK_STRATA] += rocky * strata;

	// ── Тон и затенение — тоже от географии ────────────────────────────────────
	// Трава: чем суше, тем желтее, чем влажнее, тем гуще зелень; пятнами — в жёлтом цвету (там, где не сухо).
	// Песок: большими территориями краснее или светлее. Сами цвета — в surface_tints.gdshaderinc.
	float dryness = 1.0 - smoothstep(0.22, 0.8, moisture + 0.12 * (fine.r - 0.5) * local);
	float bloom = smoothstep(0.74, 0.9, meso.b + 0.3 * (fine.b - 0.5) + 0.2 * (micro.a - 0.5)) * 0.55 * (1.0 - dryness) * local;
	float sand_tone = smoothstep(0.35, 0.8, macro.b);
	// Пустыня и земля рядом с ней (на полсотни метров за её краем): грунт и осыпь там песочного тона.
	float sandy_land = clamp(max(desert, wide_a.x) * 1.5, 0.0, 1.0);
	// Мокрая полоса у воды моря и озёр: песок темнее и глаже.
	float wet = max(smoothstep(0.55, 0.05, h) * step(shore, 40.0) * (1.0 - smoothstep(0.0, 6.0, shore)), smoothstep(-0.25, 0.2, lake_depth));
	wet = max(wet, under);
	// Множитель цвета. Крупные пятна: светлее и темнее, теплее и холоднее — на сотни метров и на десятки, плавные
	// (зернистые с высоты складывались в пёстрый рисунок). Форма рельефа: в ложбинах темнее, на гребнях светлее —
	// объём читается и без теней; во влажных низинах земля темнее; по руслам стока на скале — потёки.
	vec3 shade = vec3(1.0 + 0.14 * (macro.g - 0.5) + 0.08 * (meso.r - 0.5));
	shade *= mix(vec3(1.04, 1.0, 0.95), vec3(0.97, 1.0, 1.03), macro.r);
	shade *= 1.0 - 0.3 * smoothstep(0.3, 4.0, cavity) + 0.08 * smoothstep(0.4, 3.0, -cavity);
	shade *= 1.0 - 0.16 * smoothstep(0.7, 1.0, moisture) * hollow * step(0.0, h);
	shade *= 1.0 - 0.2 * channel * rocky;
	shade *= mix(1.0, 0.68, wet);
	// Ил на дне озера: тёмный, зеленоватый — сквозь воду озеро читается глубоким.
	shade = mix(shade, shade * vec3(0.3, 0.4, 0.3), smoothstep(0.15, 1.6, lake_depth));
	// Снег на самых высоких вершинах: выше снеговой линии; на северных склонах линия ниже, на южных выше; на крутом
	// снег не держится — там проступает скала. Кромку снега по неровностям камня дорисовывает шейдер земли в кадре.
	float line = snow_line + 22.0 * n.z + 16.0 * (meso.g - 0.5) + 8.0 * (fine.a - 0.5);
	float snow = smoothstep(line - 4.0, line + 16.0, h) * (1.0 - 0.8 * smoothstep(0.36, 0.62, steep));

	// ── Растительность (шаг 1.8): экологические правила ────────────────────────
	// Где какой вид растёт и насколько густо — от тех же местности, влажности, высоты, уклона, стока и берега,
	// что и материалы земли. Леса — не равномерная россыпь: крупное поле «лесистости» (волны в километр) вместе
	// с влажностью даёт массивы, поле помельче — поляны и зубчатые опушки, мелкое — отдельные деревья в поле.
	vec4 woods = textureLod(noise_map, pn / 1150.0 + vec2(0.61, 0.27), 0.0); // массивы, породы, рощи олив, пальмы у берега
	vec4 groves = textureLod(noise_map, pn / 230.0 + vec2(0.17, 0.83), 0.0); // опушки, поляны, заросли, группы кипарисов
	float dry_land = step(0.7, h) * step(lake_depth, -0.05);
	float off_beach = smoothstep(5.0, 16.0, shore + 6.0 * (fine.g - 0.5));
	float tree_slope = 1.0 - smoothstep(0.14, 0.32, steep);
	float bush_slope = 1.0 - smoothstep(0.26, 0.5, steep);
	float altitude = h / snow_line;
	float belt = 1.0 - smoothstep(0.5, 0.82, altitude + 0.12 * (meso.b - 0.5)); // выше пояса леса деревьев нет
	float open_land = 1.0;
	for (int i = 0; i < clearing_count; i++) {
		float away = distance(p, clearings[i].xy) + 22.0 * (fine.r - 0.5) + 30.0 * (groves.b - 0.5);
		open_land *= smoothstep(clearings[i].z * 0.8, clearings[i].z * 1.3, away);
	}
	float grow = dry_land * off_beach * (1.0 - snow) * open_land;
	float wooded = smoothstep(0.47, 0.6, woods.r + 0.7 * (moisture - 0.42) + 0.22 * (groves.r - 0.5) + 0.1 * (fine.r - 0.5));
	float glade = smoothstep(0.24, 0.4, groves.g + 0.25 * (fine.g - 0.5));
	float forest = wooded * glade * tree_slope * belt * grow;
	float broadleaf = smoothstep(0.4, 0.6, woods.g + 0.6 * (moisture - 0.5));
	float lone = smoothstep(0.86, 0.96, fine.b + 0.1 * (groves.b - 0.5)) * tree_slope * belt * grow;
	float oak = forest * broadleaf * (meadow + 0.6 * hills + 0.45 * mountains + 0.3 * oasis)
			+ lone * 0.25 * (meadow + 0.4 * hills) * smoothstep(0.35, 0.55, moisture);
	float pine = forest * (1.0 - broadleaf) * (0.85 * hills + mountains + 0.5 * coast + 0.25 * meadow)
			+ lone * 0.2 * (mountains + 0.3 * hills);
	// Оливы: сухие и умеренные холмы, невысоко; дикие — рощами, не сплошь.
	float olive_grove = smoothstep(0.5, 0.66, woods.b + 0.3 * (groves.b - 0.5));
	float olive = (hills + 0.35 * meadow + 0.2 * coast) * olive_grove * smoothstep(0.18, 0.32, moisture)
			* (1.0 - smoothstep(0.62, 0.8, moisture)) * (1.0 - smoothstep(55.0, 85.0, h)) * tree_slope * grow * (1.0 - forest)
			+ lone * 0.3 * hills;
	// Кипарисы: небольшими группами на холмах и у лугов.
	float cypress = smoothstep(0.87, 0.95, groves.a + 0.16 * (fine.a - 0.5)) * (0.9 * hills + 0.5 * meadow + 0.2 * coast)
			* smoothstep(0.2, 0.4, moisture) * tree_slope * grow * (1.0 - smoothstep(60.0, 90.0, h));
	// Пальмы: оазисы, берега озёр в сухих местах, русла пустыни, изредка — у пляжа.
	float palm = (oasis * 0.9 * smoothstep(0.1, 0.4, groves.g) + lake * (desert + 0.35 * hills + 0.2 * meadow) * 0.9
			+ desert * channel * 0.5 * smoothstep(0.5, 0.7, groves.r) + coast * smoothstep(0.82, 0.92, woods.a) * 0.5)
			* tree_slope * grow * (1.0 - smoothstep(40.0, 70.0, h));
	// Тамариск и акация: понижения и русла пустыни, сухие края холмов, берег.
	float tamarisk = (desert * (0.55 * channel + 0.3 * hollow + 0.1 * smoothstep(0.3, 0.45, moisture))
			+ coast * 0.12 + hills * (1.0 - smoothstep(0.2, 0.32, moisture)) * 0.15)
			* smoothstep(0.45, 0.7, groves.b + 0.3 * (fine.r - 0.5)) * tree_slope * grow;
	// Кустарник: зелёный — подлесок, опушки, влажные холмы, у воды; сухой — пустыня (редко), сухие склоны, берег.
	float thicket = smoothstep(0.4, 0.62, groves.b + 0.35 * (fine.g - 0.5));
	float edge_of_woods = 4.0 * wooded * (1.0 - wooded) + wooded * (1.0 - glade);
	float shrub_green = clamp(forest * 0.3 + edge_of_woods * 0.4 * (hills + meadow + mountains)
			+ hills * 0.4 * smoothstep(0.3, 0.5, moisture) * thicket + meadow * 0.22 * thicket + oasis * 0.6
			+ lake * 0.4 + channel * 0.35 * (1.0 - desert), 0.0, 1.0) * bush_slope * belt * grow;
	float shrub_dry = clamp(desert * (0.06 + 0.3 * hollow + 0.25 * channel) * smoothstep(0.5, 0.75, fine.a)
			+ (hills * (1.0 - smoothstep(0.25, 0.45, moisture)) * 0.45 + coast * 0.3 + mountains * 0.3) * thicket
			+ smoothstep(0.2, 0.4, steep) * 0.2, 0.0, 1.0) * (1.0 - smoothstep(0.34, 0.6, steep)) * dry_land * (1.0 - snow) * open_land
			* smoothstep(2.0, 9.0, shore);
	// Камни: крутые склоны, горы, каменистые места, сухие русла — пятнами, не ровным слоем; на отвесном не лежат.
	float rocks = clamp(smoothstep(0.1, 0.3, steep) * 0.55 + mountains * 0.3 + stone * 0.6 + desert * channel * 0.25 + rocky * 0.4, 0.0, 1.0)
			* smoothstep(0.35, 0.7, fine.a + 0.3 * (groves.r - 0.5)) * dry_land * (1.0 - smoothstep(0.55, 0.8, steep));
	// Трава (пучки вблизи): луга, влажные холмы, оазис; под пологом леса и в сухих местах реже.
	float grass = clamp(meadow * 0.9 + hills * 0.55 * smoothstep(0.25, 0.5, moisture) + oasis * 0.6 + mountains * 0.25 * belt + coast * 0.1, 0.0, 1.0)
			* (1.0 - 0.5 * forest) * (1.0 - smoothstep(0.2, 0.42, steep)) * dry_land * (1.0 - snow) * smoothstep(3.0, 10.0, shore);
	float canopy = clamp(oak + 0.9 * pine + 0.5 * olive + 0.25 * cypress + 0.35 * palm + 0.3 * tamarisk, 0.0, 1.0);
	// Под пологом земля темнее: тень крон читается и там, где самих теней уже не считают.
	shade *= 1.0 - 0.2 * canopy - 0.06 * shrub_green;

	// Три главных материала точки — и цвет природной зоны: средние цвета материалов по их долям.
	vec3 zone = vec3(0.0);
	float weight_sum = 0.0;
	int i0 = 0;
	int i1 = 0;
	int i2 = 0;
	float w0 = -1.0;
	float w1 = -1.0;
	float w2 = -1.0;
	for (int i = 0; i < LAYER_COUNT; i++) {
		float v = w[i];
		if (part == 4) {
			zone += LAYER_COLOR[i] * surface_tint(i, dryness, bloom, sand_tone, sandy_land, rock_tone, 1.0 + 0.24 * (fine.r - 0.5) * local) * v;
		}
		weight_sum += v;
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
	float top_sum = w0 + w1 + w2;

	if (part == 0) {
		// Номера слоёв — целые в восьмибитной текстуре; запас 0,4 — чтобы при любом округлении вышел тот же номер.
		COLOR = vec4((float(i0) + 0.4) / 255.0, (float(i1) + 0.4) / 255.0, (float(i2) + 0.4) / 255.0, sandy_land);
	} else if (part == 1) {
		COLOR = vec4(w0 / top_sum, w1 / top_sum, w2 / top_sum, rock_tone);
	} else if (part == 2) {
		COLOR = vec4(dryness, bloom, sand_tone, wet);
	} else if (part == 3) {
		COLOR = vec4(shade / 1.5, snow);
	} else if (part == 5) {
		COLOR = vec4(oak, pine, olive, cypress);
	} else if (part == 6) {
		COLOR = vec4(palm, tamarisk, shrub_green, shrub_dry);
	} else if (part == 7) {
		COLOR = vec4(rocks, grass, canopy, dry_land);
	} else {
		zone /= max(weight_sum, 1.0e-4);
		// Рисунок главного материала поверх цвета зоны — у съёмок с воздуха (плитка в десятки метров): их рисунок
		// виден и издалека. У остальных плитка с такого расстояния неразличима.
		vec3 pattern = vec3(1.0);
		float tile = LAYER_TILE[i0];
		if (tile > 40.0) {
			// Те же две копии плитки (обычная и повёрнутая), что и в кадре, — и там же, где в кадре.
			float lod = log2(texel * 1024.0 / tile);
			float value = (i0 & 1) == 0 ? meso.r : meso.g;
			if ((i0 & 2) != 0) {
				value = 1.0 - value;
			}
			float patch = smoothstep(0.42, 0.58, value);
			vec3 first = textureLod(layer_albedo, vec3(p / tile, float(i0)), lod).rgb;
			vec3 second = textureLod(layer_albedo, vec3((TURN * p) / (tile * 1.31) + vec2(0.37, 0.61), float(i0)), lod).rgb;
			pattern = mix(first, second, patch) / LAYER_COLOR[i0];
		}
		vec3 picture = zone * mix(vec3(1.0), pattern, 0.7 * w0 / max(weight_sum, 1.0e-4)) * shade;
		// Растительность в дальнем виде: лес — сомкнутый полог своего цвета с рябью крон, кустарник — крапом.
		// Те же числа, по которым расставлены деревья: издали массив там же, где вблизи стоят стволы.
		float crown = textureLod(noise_map, pn / 37.0 + vec2(0.5, 0.2), 1.0).r;
		vec3 leaf = (oak * vec3(0.085, 0.15, 0.05) + 0.9 * pine * vec3(0.065, 0.125, 0.06) + 0.5 * olive * vec3(0.19, 0.22, 0.13)
				+ 0.25 * cypress * vec3(0.05, 0.09, 0.045) + 0.35 * palm * vec3(0.12, 0.18, 0.06) + 0.3 * tamarisk * vec3(0.18, 0.2, 0.11))
				/ max(oak + 0.9 * pine + 0.5 * olive + 0.25 * cypress + 0.35 * palm + 0.3 * tamarisk, 1.0e-4);
		float crowns = clamp(canopy * 1.25, 0.0, 1.0) * smoothstep(0.25, 0.6, crown + canopy * 0.55);
		picture = mix(picture, leaf * (0.7 + 0.75 * crown), crowns * 0.92);
		float bushes = clamp(shrub_green * 0.6 + shrub_dry * 0.35, 0.0, 1.0) * smoothstep(0.55, 0.8, crown + 0.2 * shrub_green);
		picture = mix(picture, mix(vec3(0.24, 0.22, 0.12), vec3(0.1, 0.15, 0.06), shrub_green / max(shrub_green + shrub_dry, 1.0e-4)), bushes * 0.6);
		picture = mix(picture, vec3(0.9, 0.93, 0.98), smoothstep(0.38, 0.6, snow));
		if (debug_view == 21) {
			// Густота растительности: зелёное — деревья, жёлтое — кустарник, красное — камни.
			picture = vec3(0.12) + vec3(0.0, 0.8, 0.1) * canopy + vec3(0.7, 0.6, 0.0) * max(shrub_green, shrub_dry) * (1.0 - canopy) + vec3(0.8, 0.1, 0.1) * rocks * 0.6;
			picture *= h < 0.0 ? 0.3 : 1.0;
		} else if (debug_view == 22) {
			// Местности: пустыня — песочный, холмы — охра, луга — зелёный, горы — серый, оазис — бирюзовый.
			picture = desert * vec3(0.9, 0.75, 0.4) + hills * vec3(0.7, 0.5, 0.2) + meadow * vec3(0.3, 0.7, 0.2) + mountains * vec3(0.55, 0.55, 0.6)
					+ oasis * vec3(0.1, 0.7, 0.7) + coast * vec3(0.95, 0.9, 0.75);
			picture *= h < 0.0 ? 0.3 : 1.0;
		} else if (debug_view == 23) {
			// Лесные массивы по породам: дуб — зелёный, сосна — синеватый, олива — серебристый, кипарис — красный,
			// пальма — жёлтый, тамариск — оранжевый.
			picture = vec3(0.1) + oak * vec3(0.1, 0.8, 0.1) + pine * vec3(0.1, 0.5, 0.9) + olive * vec3(0.7, 0.8, 0.7) + cypress * vec3(0.9, 0.1, 0.1)
					+ palm * vec3(0.95, 0.9, 0.1) + tamarisk * vec3(0.95, 0.5, 0.1);
			picture *= h < 0.0 ? 0.3 : 1.0;
		} else if (debug_view == 24) {
			// Где деревьям нельзя по уклону: красное — круче предела, зелёное — можно.
			picture = mix(vec3(0.15, 0.6, 0.2), vec3(0.9, 0.15, 0.1), 1.0 - tree_slope) * (h < 0.0 ? 0.3 : 1.0);
		}
		if (debug_view == 1) {
			picture = mix(vec3(0.85, 0.6, 0.25), vec3(0.1, 0.45, 0.2), moisture) * (h < 0.0 ? 0.4 : 1.0);
		} else if (debug_view == 2) {
			picture = mix(vec3(0.7, 0.66, 0.6), vec3(0.05, 0.25, 0.9), flow) * (h < 0.0 ? 0.4 : 1.0);
		} else if (debug_view == 3) {
			picture = mix(vec3(0.2, 0.6, 0.2), vec3(0.9, 0.2, 0.1), smoothstep(0.0, 0.5, steep));
		} else if (debug_view == 4) {
			picture = vec3(0.5) + vec3(0.5, 0.1, -0.4) * clamp(-cavity / 3.0, -1.0, 1.0);
		}
		COLOR = vec4(to_srgb(clamp(picture, 0.0, 1.0)), wet);
	}
	// Проверочная точка в углу — как у рельефа (terrain_baker.gd).
	if (FRAGCOORD.x < 1.0 && FRAGCOORD.y < 1.0) {
		COLOR = vec4(-1024.0, 0.25, -0.5, 2048.0);
	}
}
