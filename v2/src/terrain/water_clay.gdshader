// Вода для «глиняного» этапа: спокойное стекло, сквозь которое видны отмели, а глубина темнеет.
// Настоящий океан — шаг 1.5 дорожной карты.
shader_type spatial;
render_mode world_vertex_coords, cull_back, depth_draw_never;

uniform sampler2D height_map : filter_linear, repeat_disable;
uniform vec4 bake_rect;
// Цвета воды — временные, под поверхности (шаг 1.3): бирюза над песком отмели, синева над глубиной. Сама вода
// (волны, прозрачность, пена, отражения) — шаг 1.5.
uniform vec3 shallow_color : source_color = vec3(0.13, 0.66, 0.67);
uniform vec3 deep_color : source_color = vec3(0.015, 0.14, 0.38);
uniform vec3 bed_color : source_color = vec3(0.74, 0.62, 0.42); // песок под водой — там, где дно не нарисовано
// Открытое море: дно известно грубо (карта глубин), сама земля там не нарисована. Над областями суши
// своя вода, по точному рельефу; полотна стыкуются краями плиток (world_terrain.gd).
uniform bool open_sea = false;
instance uniform float water_level = 0.0;

const float FAR_BED = -76.7; // дно далеко от суши ровное: столько даёт функция высот за краем мира

varying vec3 world_position;

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
	// Цвет: море темнеет с глубиной медленно — светлый шельф тянется далеко от берега, глубина тёмная.
	// Озёра мельче, у них цвет густеет быстрее.
	vec3 water = mix(shallow_color, deep_color, 1.0 - exp(-depth * (is_lake ? 0.14 : 0.045)));
	// Плотность: у самого берега вода сходит на нет, на метре глубины уже читается как вода.
	float cover = mix(0.55, 1.0, 1.0 - exp(-depth * 0.25)) * smoothstep(0.0, 0.35, depth);
	// Глубже нескольких метров дна сквозь воду почти не видно: там море рисуется непрозрачным и по одной формуле —
	// и над областями суши, и в открытом море, поэтому граница областей не видна. Озёра прозрачны всегда.
	// Под непрозрачной водой дно не строится (DEEP_CUTOFF в world_terrain.gd): глубины здесь и там меняются вместе.
	float solid = open_sea ? 1.0 : (is_lake ? 0.0 : smoothstep(2.0, 4.0, depth));
	ALBEDO = mix(water, mix(bed_color, water, cover), solid);
	ALPHA = mix(cover, 1.0, solid);
	// Вода ровная: нормаль всегда вверх, какое бы полотно её ни рисовало.
	NORMAL = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
	// Вода пока ровная, как стекло: блик солнца на ней — большое белое пятно. До настоящей воды (шаг 1.5)
	// он приглушён.
	ROUGHNESS = 0.3;
	SPECULAR = 0.35;
	METALLIC = 0.0;
}
