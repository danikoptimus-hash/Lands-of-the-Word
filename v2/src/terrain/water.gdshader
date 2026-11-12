// Вода (шаг 1.5 «Океан»): море, озёра и вода оазисов.
//
// Поверхность ровная (с высоты стратегии настоящих волн не видно, а стоят они дорого); жизнь воде дают:
//   рябь     — мелкие волны нормалями, два слоя навстречу друг другу, и крупная зыбь поверх;
//   большие волны шторма — гряды втрое шире зыби: ложбины темнее, гребни светлее и в пене, мелкая рябь на них
//              съезжает вслед за взглядом, как на настоящем горбе; в штиль их нет;
//   глубина  — цвет густеет с глубиной, у берега вода прозрачна и видно дно;
//   пена     — кромка у самой воды и полосы прибоя, бегущие к берегу (в море); барашки на глубине; в шторм —
//              взбитая вода у берега, полосы пены по ветру и накат: вода отходит от берега и возвращается;
//   блик     — дорожка от солнца и луны, рассыпанная рябью на искры. Блик считается здесь же (функция light),
//              а не движком: на ровной воде блик движка был белым столбом на треть экрана.
// Отражение неба добавляет движок — по шероховатости и нормали.
//
// Какова вода, задают числа вида (water_look.gd); шторм — те же числа, только другие, и между штилем
// и штормом они перетекают плавно. Время — параметр, а не TIME: его копит world_terrain.gd, умножая на скорость
// воды (иначе при смене скорости вся рябь прыгнула бы), а в кадрах проверок оно стоит.
shader_type spatial;
render_mode world_vertex_coords, cull_back, depth_draw_never;

uniform sampler2D height_map : filter_linear, repeat_disable;
uniform vec4 bake_rect;
// Открытое море: дно известно грубо (карта глубин), сама земля там не нарисована. Над областями суши
// своя вода, по точному рельефу; полотна стыкуются краями плиток (world_terrain.gd).
uniform bool open_sea = false;
instance uniform float water_level = 0.0;

uniform sampler2D wave_map : filter_linear_mipmap_anisotropic, repeat_enable; // наклон ряби (r, g), бесшовный
uniform sampler2D wave_heights : filter_linear_mipmap, repeat_enable; // высота той же поверхности (r)
uniform sampler2D foam_map : filter_linear_mipmap, repeat_enable; // пятна для пены и оттенков, бесшовный
uniform float water_time = 0.0; // накопленное время воды, секунды
uniform vec2 wind = vec2(0.87, 0.5); // куда идёт зыбь (единичный вектор по x и z): с запада-северо-запада

// ── Вид воды (water_look.gd) ──
uniform vec3 shallow_color : source_color = vec3(0.13, 0.66, 0.67); // над отмелью
uniform vec3 deep_color : source_color = vec3(0.015, 0.14, 0.38); // над глубиной
uniform vec3 lake_color : source_color = vec3(0.02, 0.2, 0.36); // глубина озера
uniform vec3 foam_color : source_color = vec3(0.93, 0.96, 0.97);
uniform vec3 bed_color : source_color = vec3(0.74, 0.62, 0.42); // песок под водой — там, где дно не нарисовано
uniform float deepening = 0.045; // как быстро цвет густеет с глубиной, 1/м
uniform float ripple = 0.5; // сила мелкой ряби
uniform float ripple_size = 14.0; // размер её рисунка, метры
uniform float swell = 0.3; // сила крупной зыби: длинные гряды, идущие по ветру
uniform float swell_size = 170.0; // расстояние между грядами, метры
uniform float relief = 0.4; // насколько рябь видна светом и тенью (0 — вода ровного цвета)
uniform float surge = 0.0; // большие волны шторма: 0 — их нет, 1 — в полную силу
uniform float surge_size = 330.0; // расстояние между их грядами, метры
uniform float swash = 0.06; // накат: на сколько метров глубины вода отходит от берега и возвращается
uniform float foam = 1.0; // сколько пены
uniform float foam_reach = 1.6; // до какой глубины доходит прибой, метры
uniform float foam_lines = 0.6; // полосы прибоя: 0 — только кромка, 1 — заметные валы
uniform float foam_wash = 0.0; // взбитая вода у берега в шторм: пена не полосами, а сплошной рваной каймой
uniform float whitecaps = 0.0; // барашки на гребнях зыби
uniform float streaks = 0.0; // полосы пены, вытянутые по ветру (шторм)
uniform float glitter = 1.0; // искры солнца
uniform float sheen = 0.25; // широкая мягкая дорожка к светилу
uniform float gloss = 0.18; // шероховатость воды для отражения неба (меньше — зеркальнее)

const float FAR_BED = -76.7; // дно далеко от суши ровное: столько даёт функция высот за краем мира

varying vec3 world_position;
varying vec3 level_normal; // нормаль ровной воды в координатах камеры — для света в толще
varying float foam_cover;

void vertex() {
	world_position = VERTEX;
}

void fragment() {
	vec2 uv = (world_position.xz - bake_rect.xy) / bake_rect.zw;
	float bed = FAR_BED;
	float lake = -999.0;
	if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
		vec4 baked = textureLod(height_map, uv, 0.0);
		bed = baked.r;
		lake = baked.a;
	}
	// Вода озера рисуется только в своей котловине: там, где запечён именно её уровень.
	// Иначе круг воды залил бы соседнюю низину. Море (уровень 0) рисуется везде.
	bool is_lake = water_level > 0.25;
	if (is_lake && abs(lake - water_level) > 0.05) {
		discard;
	}
	float depth = max(water_level - bed, 0.0);
	vec2 p = world_position.xz;
	float t = water_time;

	vec2 across = vec2(-wind.y, wind.x);
	// С какой высоты смотрим на эту точку: сколько метров воды на точку экрана.
	float footprint = length(fwidth(p));

	// ── Большие волны шторма ──
	// Высота волны в точке (0 — ложбина, 1 — гребень) и её наклон; гряды в два с половиной раза длиннее шага.
	float lift = 0.5;
	vec2 surge_lean = vec2(0.0);
	if (!is_lake && surge > 0.001) {
		vec2 qs = vec2(dot(p, wind), dot(p, across)) / vec2(surge_size, surge_size * 2.5) - vec2(0.021 * t, 0.0);
		lift = texture(wave_heights, qs).r;
		surge_lean = texture(wave_map, qs).rg * 2.0 - 1.0;
	}
	// Мелкая рябь и пена лежат на большой волне: при взгляде сбоку гребень заслоняет ложбину, и рисунок
	// съезжает вслед за взглядом. Так ровная поверхность читается как горбы высотой в несколько метров.
	vec3 eye = normalize(CAMERA_POSITION_WORLD - world_position);
	vec2 pd = p + eye.xz / max(eye.y, 0.3) * (lift - 0.5) * surge * 5.0;

	// Пятна: мелкие и крупные. Ими разбита пена и чуть тронут цвет открытого моря.
	float grain = texture(foam_map, pd / 11.0 + vec2(0.011, -0.007) * t).r;
	float breakup = texture(foam_map, p / 53.0 + vec2(-0.004, 0.003) * t).r;

	// ── Рябь и зыбь ──
	// Озёра спокойнее моря, у самого берега вода тише.
	float calm = (is_lake ? 0.4 : 1.0) * mix(0.3, 1.0, smoothstep(0.2, 4.0, depth));
	vec2 r1 = texture(wave_map, pd / ripple_size + vec2(0.023, 0.014) * t).rg * 2.0 - 1.0;
	vec2 r2 = texture(wave_map, pd.yx / (ripple_size * 2.3) + vec2(-0.012, 0.018) * t).gr * 2.0 - 1.0;
	vec2 slope = (r1 + r2) * ripple;
	// Зыбь: гряды втрое длиннее расстояния между ними, идут по ветру. Передний склон гряды — где быть барашкам.
	float front = 0.0;
	if (!is_lake) {
		vec2 q = vec2(dot(p, wind), dot(p, across)) / vec2(swell_size, swell_size * 3.0);
		vec2 lean = texture(wave_map, q - vec2(0.03 * t, 0.0)).rg * 2.0 - 1.0;
		slope += (wind * lean.x + across * (lean.y / 3.0)) * swell;
		slope += (wind * surge_lean.x + across * (surge_lean.y / 2.5)) * surge * 1.5;
		front = lean.x;
	}
	slope *= calm;
	vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));

	// ── Цвет по глубине ──
	// Море темнеет с глубиной медленно — светлый шельф тянется далеко от берега; у озёр цвет густеет быстрее.
	float dark = 1.0 - exp(-depth * (is_lake ? deepening * 3.0 : deepening));
	vec3 water = mix(shallow_color, is_lake ? lake_color : deep_color, dark);
	// Открытое море не ровная заливка: большие пятна чуть светлее и темнее.
	water *= mix(0.94, 1.06, texture(foam_map, p / 870.0 + vec2(0.0006, 0.0004) * t).r);
	// Большая волна: в ложбине темно, гребень светлее и просвечивает зеленью. Под пасмурным небом шторма
	// света и тени от светила почти нет — высоту волны показывает сам цвет воды.
	float crest_up = smoothstep(0.3, 0.8, lift);
	float deep_enough = smoothstep(1.0, 5.0, depth);
	// Склон, обращённый к ветру, светлее обратного — как под рассеянным светом неба.
	float wave_light = mix(0.5, 1.4, crest_up) * (1.0 + surge_lean.x * 0.3);
	water *= mix(1.0, wave_light, surge * deep_enough);
	water += vec3(0.012, 0.05, 0.045) * crest_up * crest_up * surge * deep_enough;

	// Накат: у берега вода то отходит, то возвращается — не вся разом, а участками. В штиль едва заметно,
	// в шторм обнажает полосу дна в полметра глубиной.
	float breath = 0.5 + 0.5 * sin(t * 0.6 + breakup * 6.3 + grain * 1.5);
	float shore_depth = max(depth - swash * (is_lake ? 0.3 : 1.0) * breath, 0.0);

	// Плотность: у самого берега вода сходит на нет, на метре глубины уже читается как вода.
	float cover = mix(0.55, 1.0, 1.0 - exp(-shore_depth * 0.25)) * smoothstep(0.0, 0.35, shore_depth);
	// Глубже нескольких метров дна сквозь воду почти не видно: там море рисуется непрозрачным и по одной формуле —
	// и над областями суши, и в открытом море, поэтому граница областей не видна. Озёра прозрачны всегда.
	// Под непрозрачной водой дно не строится (DEEP_CUTOFF в world_terrain.gd): глубины здесь и там меняются вместе.
	float solid = open_sea ? 1.0 : (is_lake ? 0.0 : smoothstep(2.0, 4.0, depth));

	// ── Пена ──
	// Кромка у самой воды: неровная, дышит.
	float lace = 1.0 - smoothstep(0.0, (is_lake ? 0.12 : 0.22) + 0.25 * breakup, shore_depth);
	float surf = lace;
	if (!is_lake) {
		// Полосы прибоя бегут к берегу: фаза растёт с глубиной и со временем, поэтому гребень идёт на мель.
		// Шаг полос по глубине постоянный: зависел бы от ширины прибоя — полосы съезжали бы, пока шторм
		// набирает силу.
		// В шторм полосы ломаются сильнее и тонут во взбитой воде у берега — иначе широкий прибой выходил
		// ровной «зеброй» вдоль всего берега.
		float roll = fract(depth / 0.9 + t * 0.11 + breakup * (0.7 + 1.6 * foam_wash));
		float crest = smoothstep(0.5, 0.92, roll) * (1.0 - smoothstep(0.92, 1.0, roll));
		float zone = 1.0 - smoothstep(0.0, foam_reach, depth);
		zone *= zone;
		surf = max(surf, min(crest * zone * foam_lines * 2.2, 1.0));
		surf = max(surf, zone * foam_wash * (0.3 + 0.95 * breakup));
	}
	float foam_cover_here = smoothstep(0.3, 0.7, surf * (0.55 + 0.9 * grain)) * smoothstep(0.0, 0.04, shore_depth);
	// Барашки: на передних склонах гряд зыби, рваные; чем сильнее волнение, тем их больше. Издалека склоны
	// сглаживаются, и барашки сходят на нет сами.
	float caps = smoothstep(1.02 - 0.5 * whitecaps, 1.12 - 0.5 * whitecaps, front * 0.9 + grain * 0.5 + breakup * 0.25);
	// С большой высоты (на точку экрана — метры воды) барашки — рябь из точек; там их нет.
	caps *= 1.0 - smoothstep(1.2, 2.6, footprint);
	foam_cover_here = max(foam_cover_here, caps * min(whitecaps * 2.0, 1.0) * smoothstep(3.0, 9.0, depth));
	if (!is_lake && surge > 0.001) {
		// Гребни больших волн ломаются: пена на самом верху и на переднем склоне, за гребнем — рваные пятна.
		// Пены немного: первая проба засыпала море белыми пятнами, как льдинами, — высоту волны показывает цвет,
		// а пена только отмечает гребни.
		float breaking = smoothstep(0.74, 0.86, lift + (grain - 0.5) * 0.22 + surge_lean.x * 0.28);
		float patches = smoothstep(0.62, 0.8, lift) * smoothstep(0.6, 0.78, breakup * 0.6 + grain * 0.4) * 0.4;
		// Полосы пены по ветру — едва заметные, мягкие.
		float streak = texture(foam_map, vec2(dot(pd, wind) / 70.0, dot(pd, across) / 12.0) - vec2(0.02 * t, 0.0)).r;
		float lines = smoothstep(0.64, 0.92, streak) * streaks * 0.22 * (1.0 - smoothstep(1.2, 3.0, footprint));
		float big = max(max(breaking, patches) * (1.0 - smoothstep(1.8, 4.0, footprint)), lines);
		foam_cover_here = max(foam_cover_here, big * surge * deep_enough);
	}
	foam_cover_here = clamp(foam_cover_here * foam, 0.0, 1.0);

	vec3 color = mix(water, mix(bed_color, water, cover), solid);
	ALBEDO = mix(color, foam_color, foam_cover_here);
	ALPHA = max(mix(cover, 1.0, solid), foam_cover_here);
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	ROUGHNESS = mix(gloss, 1.0, foam_cover_here);
	SPECULAR = mix(0.35, 0.05, foam_cover_here);
	METALLIC = 0.0;
	level_normal = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
	foam_cover = foam_cover_here;
}

void light() {
	// Толща воды освещена почти как ровная поверхность; доля света по наклону ряби (relief) делает волны
	// видимыми с любой стороны, а не только в дорожке к светилу.
	float lit = mix(max(dot(level_normal, LIGHT), 0.0), max(dot(NORMAL, LIGHT), 0.0), relief);
	DIFFUSE_LIGHT += lit * ATTENUATION * LIGHT_COLOR / PI;
	// Блик светила: острые искры там, где склон ряби смотрит точно между светилом и камерой, и широкая мягкая
	// дорожка. Искра узкая (пара градусов): вдали, где рябь уже не различить, от неё остаётся небольшое яркое
	// отражение самого светила, а не белое пятно на полэкрана. Яркость ограничена.
	float aim = max(dot(NORMAL, normalize(LIGHT + VIEW)), 0.0);
	float spark = min(pow(aim, 3000.0) * 14.0, 1.6) * glitter + pow(aim, 60.0) * sheen;
	SPECULAR_LIGHT += LIGHT_COLOR / PI * ATTENUATION * spark * (1.0 - foam_cover);
}
