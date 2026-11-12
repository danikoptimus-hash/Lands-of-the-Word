// Вода (шаг 1.5 «Океан»): море, озёра и вода оазисов.
//
// Поверхность ровная (с высоты стратегии настоящих волн не видно, а стоят они дорого); жизнь воде дают:
//   рябь     — мелкие волны нормалями, два слоя, и крупная зыбь поверх; всё идёт по ветру;
//   глубина  — цвет густеет с глубиной; сквозь воду видно дно, пока его не скроет толща воды;
//   дно      — рисует сама вода: песок, глубже ил, пятна водорослей, камень на крутом, солнечная сетка
//              на мелководье. Землю под водой шейдер суши красит как сушу (тот же пляж), и сквозь воду она
//              смотрелась сушей — замечание владельца к 0.7.1: дно «не должно повторять сушу»;
//   накат    — уровень воды у берега ходит: вода взбегает на берег выше обычного уреза и откатывается ниже;
//   пена     — кромка у самой воды (идёт вместе с накатом), полосы прибоя, бегущие к берегу, барашки на гребнях
//              зыби; в шторм — взбитая вода у берега;
//   блик     — дорожка от солнца и луны, рассыпанная рябью на искры. Блик считается здесь же (функция light),
//              а не движком: на ровной воде блик движка был белым столбом на треть экрана.
// Отражение неба добавляет движок — по шероховатости и нормали.
//
// Без повтора. Рисунок ряби, зыби и пены берётся из текстур, а текстура повторяется плиткой. Чтобы плитка
// не читалась и с высоты (замечание владельца к 0.7.2: «когда отдаляю море, замечаю закономерность повторения
// рисунка моря»): в плитке текстуры — десятки волн, а не семь (плитка ряби — 64 м, а не 11; зыби — почти
// километр); слои повёрнуты друг к другу под «некруглыми» углами; точка, по которой читается текстура, плавно
// сдвинута шумом, который нигде не повторяется, — ряды плиток перестают быть рядами; всё крупное (луга водорослей
// на дне, оттенки открытого моря, очерёдность наката вдоль берега) задаёт тот же шум, а не текстура.
//
// Без полос. Волна, которая на экране тоньше нескольких точек, рисоваться не должна: гребни зыби с высоты (и рябь
// при пологом взгляде) сжимаются до двух-трёх точек и сливаются в ровные «строчные» полосы, особенно в блике, где
// малейший наклон меняет яркость (замечание владельца к 0.7.3: «полосы видны»). Поэтому текстуры волн читаются
// с уровнем подробности по ДЛИННОЙ стороне точки экрана и с запасом: всё, что мельче четырёх-шести точек, плавно
// гаснет. Заодно с высоты шире и мягче сам блик: мелкие волны, которых уже не видно, в жизни его и размывают.
//
// Какова вода, задают числа вида (water_look.gd); шторм — те же числа, только другие, и между штилем
// и штормом они перетекают плавно. Время — параметр, а не TIME: его копит world_terrain.gd, умножая на скорость
// воды (иначе при смене скорости вся рябь прыгнула бы), а в кадрах проверок оно стоит.
//
// Полотно воды поднято над её обычным уровнем на высоту наката (world_terrain.gd): иначе берег выше уреза
// закрывал бы воду, и взбежать на него она не могла бы.
shader_type spatial;
render_mode world_vertex_coords, cull_back, depth_draw_never;

#include "res://src/world/clouds.gdshaderinc"
#include "res://src/world/atmosphere.gdshaderinc"

uniform sampler2D height_map : filter_linear, repeat_disable;
uniform vec4 bake_rect;
// Куда накату моря хода нет (0): суша ниже его высоты, с морем не связанная (world_terrain.gd, _swash_mask).
uniform sampler2D swash_mask : filter_linear, repeat_disable, hint_default_white;
// Открытое море: дно известно грубо (карта глубин), сама земля там не нарисована. Над областями суши
// своя вода, по точному рельефу; полотна стыкуются краями плиток (world_terrain.gd).
uniform bool open_sea = false;
instance uniform float water_level = 0.0; // обычный уровень воды: море — 0, у озера свой

uniform sampler2D wave_map : filter_linear_mipmap_anisotropic, repeat_enable; // наклон ряби (r, g), бесшовный
uniform sampler2D foam_map : filter_linear_mipmap, repeat_enable; // пятна для пены и дна, бесшовный
uniform float wave_cycles = 42.0; // сколько волн шума укладывается в плитку текстуры ряби
uniform float foam_cycles = 40.0; // и в плитку текстуры пятен
uniform float foam_gain = 1.0; // значения текстуры пятен приводятся к среднему и разбросу, с которыми принят вид воды
uniform float foam_bias = 0.0;
uniform float water_time = 0.0; // накопленное время воды, секунды
uniform float swash_time = 0.0; // время наката, секунды по часам: у наката свой ровный ритм, от скорости воды не зависит
uniform vec2 wind = vec2(0.87, 0.5); // куда идут рябь и зыбь (единичный вектор по x и z): с запада-северо-запада

// ── Вид воды (water_look.gd) ──
uniform vec3 shallow_color : source_color = vec3(0.13, 0.66, 0.67); // над отмелью
uniform vec3 deep_color : source_color = vec3(0.015, 0.14, 0.38); // над глубиной
uniform vec3 lake_color : source_color = vec3(0.02, 0.2, 0.36); // глубина озера
uniform vec3 foam_color : source_color = vec3(0.93, 0.96, 0.97);
uniform vec3 bed_sand : source_color = vec3(0.72, 0.65, 0.48); // дно: песок у берега
uniform vec3 bed_silt : source_color = vec3(0.33, 0.36, 0.3); // ил глубже
uniform vec3 bed_weed : source_color = vec3(0.09, 0.19, 0.12); // водоросли пятнами
uniform vec3 bed_rock : source_color = vec3(0.27, 0.27, 0.25); // камень на крутом дне
uniform float deepening = 0.045; // как быстро цвет густеет с глубиной, 1/м
uniform float murk = 0.35; // мутность: как быстро толща воды скрывает дно, 1/м (в шторм вода мутная)
uniform float ripple = 0.5; // сила мелкой ряби
uniform float ripple_size = 1.5; // длина её волны, метры
uniform float swell = 0.3; // сила крупной зыби: длинные гряды, идущие по ветру
uniform float swell_size = 21.0; // расстояние между грядами, метры (гряды втрое длиннее)
uniform float relief = 0.4; // насколько рябь видна светом и тенью (0 — вода ровного цвета)
uniform float swash = 0.3; // накат: на сколько метров по высоте вода взбегает на берег
uniform float foam = 1.0; // сколько пены
uniform float foam_reach = 1.6; // до какой глубины доходит прибой, метры
uniform float foam_lines = 0.6; // полосы прибоя: 0 — только кромка, 1 — заметные валы
uniform float foam_wash = 0.0; // взбитая вода у берега в шторм: пена не полосами, а сплошной рваной каймой
uniform float whitecaps = 0.0; // барашки на гребнях зыби
uniform float glitter = 1.0; // искры солнца
uniform float sheen = 0.25; // широкая мягкая дорожка к светилу
uniform float gloss = 0.18; // шероховатость воды для отражения неба (меньше — зеркальнее)

const float FAR_BED = -76.7; // дно далеко от суши ровное: столько даёт функция высот за краем мира
// Запас уровня подробности текстур волн (см. «без полос»): при нуле на экране остаются волны от двух точек,
// каждая единица вдвое грубее. Рябь — зерно без направления, ей хватает малого запаса; зыбь — длинные гряды,
// они и дают полосы.
const float RIPPLE_SOFTEN = 0.75;
const float SWELL_SOFTEN = 1.3;

varying vec3 world_position;
varying vec3 level_normal; // нормаль ровной воды в координатах камеры — для света в толще
varying float foam_cover;
varying float far_view; // 0 — волны видны все, 1 — смотрим с такой высоты, что волн уже не различить

void vertex() {
	world_position = VERTEX;
}

// Два случайных числа клетки, 0…1. Целочисленная смесь: одинакова на любой видеокарте и не теряет точности
// вдали от начала мира (море уходит за сто километров).
vec2 cell_random(ivec2 cell) {
	uint h = uint(cell.x) * 1597334677u ^ uint(cell.y) * 1103515245u;
	h ^= h >> 15u;
	h *= 668265263u;
	h ^= h >> 13u;
	h *= 374761393u;
	h ^= h >> 16u;
	return vec2(float(h & 65535u), float(h >> 16u)) / 65535.0;
}

// Плавный шум без повтора: два числа в точке, 0…1; at — в клетках шума.
vec2 drift(vec2 at) {
	vec2 cell = floor(at);
	vec2 f = at - cell;
	f = f * f * (3.0 - 2.0 * f);
	ivec2 c = ivec2(cell);
	return mix(mix(cell_random(c), cell_random(c + ivec2(1, 0)), f.x),
			mix(cell_random(c + ivec2(0, 1)), cell_random(c + ivec2(1, 1)), f.x), f.y);
}

// Точка в повёрнутых осях: turn — косинус и синус угла.
vec2 turned(vec2 at, vec2 turn) {
	return vec2(at.x * turn.x + at.y * turn.y, at.y * turn.x - at.x * turn.y);
}

// Наклон ряби в точке: рисунок текстуры повёрнут на угол turn, плитка — tile метров, lod — уровень подробности.
vec2 ripples(vec2 at, vec2 turn, float tile, float lod) {
	vec2 lean = textureLod(wave_map, turned(at, turn) / tile, lod).rg * 2.0 - 1.0;
	return vec2(lean.x * turn.x - lean.y * turn.y, lean.x * turn.y + lean.y * turn.x);
}

// Значение текстуры пятен, приведённое к среднему и разбросу, с которыми принят вид воды.
float spots(vec2 uv) {
	return texture(foam_map, uv).r * foam_gain + foam_bias;
}

void fragment() {
	vec2 uv = (world_position.xz - bake_rect.xy) / bake_rect.zw;
	float bed = FAR_BED;
	float lake = -999.0;
	float bed_steep = 0.0;
	if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
		vec4 baked = textureLod(height_map, uv, 0.0);
		bed = baked.r;
		bed_steep = length(baked.gb);
		lake = baked.a;
	}
	// Вода озера рисуется только в своей котловине: там, где запечён именно её уровень.
	// Иначе круг воды залил бы соседнюю низину. Море (уровень 0) рисуется везде.
	bool is_lake = water_level > 0.25;
	if (is_lake && abs(lake - water_level) > 0.05) {
		discard;
	}
	// Море в котловины озёр не заходит. Его полотно поднято на высоту наката, а дно у глубоких озёр местами ниже
	// этой высоты — и вода моря «взбегала» посреди озера светлыми пятнами (замечание владельца к 0.7.4).
	if (!is_lake && lake > -998.0) {
		discard;
	}
	vec2 p = world_position.xz;
	vec2 across = vec2(-wind.y, wind.x);
	float t = water_time;
	// С какой высоты смотрим на эту точку: сколько метров воды на точку экрана.
	vec2 px = dFdx(p);
	vec2 py = dFdy(p);
	float footprint = length(abs(px) + abs(py));
	// Длинная сторона точки экрана на воде, метры: при пологом взгляде она в разы больше короткой.
	float major = max(length(px), length(py));
	float wave_texels = float(textureSize(wave_map, 0).x);
	far_view = smoothstep(-1.7, 1.6, log2(major));

	// ── Без повтора ──
	// Плавный шум, который нигде не повторяется: большой (километры), средний (сотни метров) и малый.
	vec2 wide = drift(p / 1300.0);
	vec2 mid = drift(p / 180.0);
	vec2 small = drift(p / 22.0);
	// Точки, по которым читаются текстуры, сдвинуты этим шумом: на десятки метров — для ряби и пены, на сотню —
	// для зыби. Сдвиг стоит на месте, рисунок плывёт сквозь него и чуть меняется по дороге.
	vec2 pr = p + (mid - 0.5) * 28.0 + (wide - 0.5) * 80.0;
	vec2 pz = p + (wide - 0.5) * 220.0 + (mid - 0.5) * 30.0;

	// Пятна: мелкие и средние — из текстуры, большие — из шума. Ими разбита пена и размечено дно.
	float grain = spots(turned(pr - wind * 0.1 * t, vec2(0.8253, 0.5646)) / (1.95 * foam_cycles));
	float breakup = spots((pr - wind * 0.2 * t) / (9.4 * foam_cycles));
	float patch = small.x * 0.6 + mid.y * 0.4;

	// ── Накат ──
	// Глубина при обычном уровне (у берега выше уреза — отрицательная) и уровень сейчас. Волна взбегает быстро,
	// откатывается медленно, раз в десять секунд. Очерёдность вдоль берега задаёт шум: на сотне метров берега
	// волна приходит почти разом, дальше — в свой черёд; по всему берегу разом (как в 0.7.2) она не ходит.
	// И каждая волна своей высоты — от двух третей до полной.
	float still_depth = water_level - bed;
	float depth = max(still_depth, 0.0);
	float turn_of_wave = swash_time / 10.0 + mid.x * 1.6 + wide.y * 4.0;
	float beat = fract(turn_of_wave);
	float surge = smoothstep(0.0, 0.3, beat) * (1.0 - smoothstep(0.3, 1.0, beat));
	surge *= 0.67 + 0.33 * cell_random(ivec2(int(floor(turn_of_wave)), 17)).x;
	// Озеро не взбегает на берег (его вода рисуется только в своей котловине) — оно едва дышит у кромки.
	float level = is_lake ? -0.15 * swash * surge : swash * (surge * 1.25 - 0.25);
	float shore_depth = max(still_depth + level, 0.0);
	// И в ложбины за берегом, с морем не связанные, накат не заходит: такая суша закрыта маской.
	if (!is_lake && still_depth < 0.0 && shore_depth > 0.0 && texture(swash_mask, uv).r < 0.5) {
		shore_depth = 0.0;
	}

	// ── Рябь и зыбь ──
	// Оба слоя ряби идут по ветру, под небольшим углом друг к другу и с разной скоростью: рисунок плывёт
	// и понемногу меняется. Навстречу друг другу слои «кипели» — море выглядело неестественно быстрым
	// (замечание владельца к 0.7.0 и 0.7.1). Рисунки слоёв повёрнуты на 24° и −52°: их плитки не совпадают.
	// Озёра спокойнее моря, у самого берега вода тише.
	float calm = (is_lake ? 0.4 : 1.0) * mix(0.3, 1.0, smoothstep(0.2, 4.0, depth));
	vec2 way1 = normalize(wind + across * 0.35);
	vec2 way2 = normalize(wind - across * 0.45);
	float ripple_tile = ripple_size * wave_cycles;
	float ripple_lod = log2(major * wave_texels / ripple_tile) + RIPPLE_SOFTEN;
	vec2 r1 = ripples(pr - way1 * 0.35 * t, vec2(0.9135, 0.4067), ripple_tile, ripple_lod);
	vec2 r2 = ripples(pr - way2 * 0.5 * t, vec2(0.6157, -0.788), ripple_tile * 2.37, ripple_lod - log2(2.37));
	vec2 slope = (r1 + r2) * ripple;
	// Зыбь: гряды втрое длиннее расстояния между ними, идут по ветру. Передний склон гряды — где быть барашкам.
	float front = 0.0;
	if (!is_lake) {
		float swell_tile = swell_size * wave_cycles;
		vec2 q = vec2(dot(pz, wind) - 4.5 * t, dot(pz, across)) / vec2(swell_tile, swell_tile * 3.0);
		vec2 lean = textureLod(wave_map, q, log2(major * wave_texels / swell_tile) + SWELL_SOFTEN).rg * 2.0 - 1.0;
		slope += (wind * lean.x + across * (lean.y / 3.0)) * swell;
		front = lean.x;
	}
	slope *= calm;
	vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));

	// ── Цвет воды по глубине ──
	// Море темнеет с глубиной медленно — светлый шельф тянется далеко от берега; у озёр цвет густеет быстрее.
	float dark = 1.0 - exp(-depth * (is_lake ? deepening * 3.0 : deepening));
	vec3 water = mix(shallow_color, is_lake ? lake_color : deep_color, dark);
	// Открытое море не ровная заливка: большие пятна чуть светлее и темнее.
	water *= mix(0.94, 1.06, mid.y * 0.6 + wide.x * 0.4);

	// ── Дно ──
	// Дно рисует сама вода — по глубине из запечённого рельефа (в открытом море — из грубой карты глубин), поэтому
	// видно оно, пока его не скроет толща воды, а не только там, где под водой построена земля (она строится
	// до глубины DEEP_CUTOFF, см. world_terrain.gd, и нужна лишь у самого уреза).
	vec3 color = water;
	float veil = 1.0 - exp(-shore_depth * (is_lake ? murk * 2.0 : murk));
	if (veil < 0.985) {
		// Светлый песок у берега, глубже — ил; граница неровная.
		vec3 floor_color = mix(bed_sand, bed_silt, smoothstep(1.2, 6.0, depth + (breakup - 0.5) * 2.0));
		// Водоросли: тёмные луга с мягким краем там, где уже не достаёт прибой; у озёр — от самого берега, слабее.
		float weed = smoothstep(0.46, 0.66, patch * 0.6 + breakup * 0.4) * smoothstep(is_lake ? 0.15 : 0.9, is_lake ? 0.8 : 2.2, depth);
		floor_color = mix(floor_color, bed_weed, weed * (is_lake ? 0.4 : 0.8));
		// На крутом дне — камень.
		floor_color = mix(floor_color, bed_rock, smoothstep(0.3, 0.55, bed_steep));
		floor_color *= 0.9 + 0.2 * grain;
		// Солнечная сетка на мелководье: два слоя пятен плывут навстречу, свет — где они сходятся.
		float net_tile = 0.89 * foam_cycles;
		float net = (textureGrad(foam_map, (p - wind * 0.25 * t) / net_tile, px / net_tile, py / net_tile).r * foam_gain + foam_bias)
				* (textureGrad(foam_map, (p.yx + across * 0.2 * t) / (net_tile * 1.26), px.yx / (net_tile * 1.26), py.yx / (net_tile * 1.26)).r * foam_gain + foam_bias);
		floor_color *= 1.0 + smoothstep(0.26, 0.42, net) * 0.3 * (1.0 - smoothstep(0.2, 2.6, depth));
		// Чем больше воды над дном, тем меньше его видно.
		color = mix(floor_color, water, veil);
	}

	// ── Пена ──
	// Кромка у самой воды: неровная, идёт вместе с накатом.
	float lace = 1.0 - smoothstep(0.0, (is_lake ? 0.12 : 0.22) + 0.25 * breakup, shore_depth);
	float surf = lace;
	if (!is_lake) {
		// Полосы прибоя бегут к берегу: фаза растёт с глубиной и со временем, поэтому гребень идёт на мель.
		// Шаг полос по глубине постоянный: зависел бы от ширины прибоя — полосы съезжали бы, пока шторм
		// набирает силу. В шторм полосы ломаются сильнее и тонут во взбитой воде у берега — иначе широкий
		// прибой выходил ровной «зеброй» вдоль всего берега.
		float roll = fract(depth / 0.9 + t * 0.11 + breakup * (0.7 + 1.6 * foam_wash));
		float crest = smoothstep(0.5, 0.92, roll) * (1.0 - smoothstep(0.92, 1.0, roll));
		float zone = 1.0 - smoothstep(0.0, foam_reach, depth);
		zone *= zone;
		surf = max(surf, min(crest * zone * foam_lines * 2.2, 1.0));
		surf = max(surf, zone * foam_wash * (0.3 + 0.95 * breakup));
	}
	float foam_cover_here = smoothstep(0.3, 0.7, surf * (0.55 + 0.9 * grain)) * smoothstep(0.0, 0.04, shore_depth);
	// Барашки: на передних склонах гряд зыби, рваные; чем сильнее волнение, тем их больше.
	float caps = smoothstep(1.02 - 0.5 * whitecaps, 1.12 - 0.5 * whitecaps, front * 0.9 + grain * 0.5 + breakup * 0.25);
	// С большой высоты (на точку экрана — метры воды) барашки — рябь из точек; там их нет.
	caps *= 1.0 - smoothstep(1.2, 2.6, footprint);
	foam_cover_here = max(foam_cover_here, caps * min(whitecaps * 2.0, 1.0) * smoothstep(3.0, 9.0, depth));
	foam_cover_here = clamp(foam_cover_here * foam, 0.0, 1.0);

	ALBEDO = mix(color, foam_color, foam_cover_here);
	// У самого уреза вода прозрачна — сквозь первые сантиметры виден песок берега; дальше дно рисует она сама.
	ALPHA = max(smoothstep(0.0, 0.22, shore_depth), foam_cover_here);
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	ROUGHNESS = mix(gloss, 1.0, foam_cover_here);
	SPECULAR = mix(0.35, 0.05, foam_cover_here);
	METALLIC = 0.0;
	level_normal = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
	foam_cover = foam_cover_here;
	// Дымка: море у горизонта уходит в цвет неба без линии.
	FOG = air(CAMERA_POSITION_WORLD, world_position);
}

void light() {
	// Толща воды освещена почти как ровная поверхность; доля света по наклону ряби (relief) делает волны
	// видимыми с любой стороны, а не только в дорожке к светилу.
	float lit = mix(max(dot(level_normal, LIGHT), 0.0), max(dot(NORMAL, LIGHT), 0.0), relief);
	DIFFUSE_LIGHT += lit * ATTENUATION * LIGHT_COLOR / PI;
	// Блик светила: острые искры там, где склон ряби смотрит точно между светилом и камерой, и широкая мягкая
	// дорожка. Искра узкая (пара градусов): вдали, где рябь уже не различить, от неё остаётся небольшое яркое
	// отражение самого светила, а не белое пятно на полэкрана. Яркость ограничена.
	// С высоты, где волн уже не различить, искра шире и слабее: невидимые мелкие волны размывают отражение светила.
	float aim = max(dot(NORMAL, normalize(LIGHT + VIEW)), 0.0);
	float spark = min(pow(aim, mix(3000.0, 320.0, far_view)) * mix(14.0, 0.4, far_view), 1.6) * glitter + pow(aim, 60.0) * sheen;
	SPECULAR_LIGHT += LIGHT_COLOR / PI * ATTENUATION * spark * (1.0 - foam_cover);
}
