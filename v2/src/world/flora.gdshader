// Растительность и камни (шаг 1.8): один шейдер на деревья, кусты и камни.
//
// Цвет — из вершин модели (листва темнее снизу и в глубине кроны) и из экземпляра (у каждого дерева свой оттенок);
// поверх — пятна шума в мире: крона не выглядит гладким пластиком. У листвы край «обгрызен»: там, где поверхность
// клуба уходит от взгляда, часть точек не рисуется — силуэт кроны неровный, листвяной. Листья пальмы вырезаны
// гребёнкой. Свет сквозь листву (BACKLIGHT): против солнца крона светится, а не чернеет.
//
// Ветер — в вершинах, на видеокарте: дерево клонится по ветру и покачивается (ствол почти неподвижен, концы веток
// гибкие — гибкость записана в модели), листва мелко дрожит; порывы идут по миру волнами вдоль ветра, поэтому
// соседние деревья качаются не разом. Сила и время ветра — общие числа (wind_look), их ставит погода: в шторм
// качает сильнее. Дальний вид (far_view) не качается и не вырезается: с такого расстояния этого не видно.
shader_type spatial;
render_mode skip_vertex_transform;

#include "res://src/world/clouds.gdshaderinc"
#include "res://src/world/atmosphere.gdshaderinc"

global uniform vec4 wind_look; // xy — куда дует ветер; z — сила, 0…1; w — время ветра, секунды

uniform sampler2D noise_map : filter_linear_mipmap, repeat_enable;
uniform float far_view = 0.0;
uniform vec2 vanish = vec2(1.0e9, 1.0e9); // дальний вид: с какого расстояния дерево начинает уходить и на каком его уже нет
uniform vec3 lod_tint = vec3(0.0); // проверочный вид «уровни подробности»: не ноль — всё красится этим цветом

varying vec3 world_position;
varying float variation;

void vertex() {
	vec3 origin = MODEL_MATRIX[3].xyz;
	vec4 custom = INSTANCE_CUSTOM; // x — оттенок, y — фаза ветра
	variation = custom.x;
	vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	if (UV.x > 3.5) {
		// Пучок травы виден только вблизи: дальше он плавно уходит в землю (сама трава остаётся рисунком земли) —
		// каждый пучок по своему расстоянию, без общей границы и без мелькания точек вдали.
		float away = distance(origin, CAMERA_POSITION_WORLD);
		float shown = 1.0 - smoothstep(210.0 + 60.0 * custom.y, 300.0 + 60.0 * custom.y, away);
		world = origin + (world - origin) * shown;
	}
	if (far_view > 0.5) {
		// Дальние деревья уходят по одному, каждое на своём расстоянии: лес редеет к границе видимости деревьев и
		// переходит в рисунок земли без полосы «здесь деревья есть, а здесь нет».
		float away = distance(origin, CAMERA_POSITION_WORLD);
		float from = mix(vanish.x, vanish.y - 260.0, custom.y);
		world = origin + (world - origin) * (1.0 - smoothstep(from, from + 260.0, away));
	}
	float strength = wind_look.z;
	float flex = COLOR.a;
	if (strength > 0.001 && flex > 0.001 && far_view < 0.5) {
		vec2 along = wind_look.xy;
		float t = wind_look.w;
		// Порыв — волна вдоль ветра длиной в сотню метров, с изломом: рощи качаются перекатами.
		float gust = 0.5 + 0.5 * sin(t * 0.9 - dot(origin.xz, along) * 0.045 + 2.0 * sin(origin.x * 0.013 + origin.z * 0.007));
		float sway = strength * (0.3 + 0.7 * gust);
		float height = max(world.y - origin.y, 0.0);
		vec2 push = along * sway * flex * (0.045 * height + 0.2) * (1.0 + 0.5 * sin(t * 1.7 + custom.y * 6.283));
		float flutter = sin(t * 6.0 + world.x * 1.7 + world.z * 1.3 + custom.y * 20.0) * flex * flex * strength * 0.07;
		world.xz += push + vec2(-along.y, along.x) * flutter;
		world.y += flutter - length(push) * 0.15;
	}
	world_position = world;
	VERTEX = (VIEW_MATRIX * vec4(world, 1.0)).xyz;
	NORMAL = normalize((VIEW_MATRIX * vec4(mat3(MODEL_MATRIX) * NORMAL, 0.0)).xyz);
}

void fragment() {
	float kind = UV.x; // 0 — кора, 1 — листва, 2 — лист пальмы, 3 — камень, 4 — трава
	bool leafy = (kind > 0.5 && kind < 2.5) || kind > 3.5;
	vec3 albedo = COLOR.rgb;
	float spots = texture(noise_map, world_position.xz * 0.09 + world_position.y * 0.05).r;
	float speck = texture(noise_map, world_position.xz * 0.53 + world_position.y * 0.37).g;
	if (kind > 1.5 && kind < 2.5) {
		// Перистый лист: жилка посередине и листочки гребёнкой к краям.
		vec2 at = UV2;
		float teeth = abs(fract(at.y * 19.0 + abs(at.x) * 1.3) - 0.5) * 2.0;
		if (abs(at.x) > 0.14 && teeth < 0.36 + 0.3 * abs(at.x)) {
			discard;
		}
	} else if (leafy && far_view < 0.5 && kind < 3.5) {
		// Край кроны: где поверхность клуба уходит от взгляда, она рвётся пятнами.
		float facing = abs(dot(normalize(NORMAL), normalize(VIEW)));
		if (facing + (speck - 0.5) * 0.8 < 0.26) {
			discard;
		}
		// Листва не гладкая: свет ложится по клочьям листьев, а не по ровному шару.
		NORMAL = normalize(NORMAL + (vec3(spots, speck, texture(noise_map, world_position.xz * 0.31 - world_position.y * 0.19).b) - 0.5) * 0.9);
	}
	if (leafy) {
		albedo *= mix(vec3(0.84, 0.9, 0.82), vec3(1.16, 1.1, 0.98), variation) * (0.74 + 0.5 * spots) * (0.9 + 0.2 * speck);
	} else if (kind > 2.5) {
		albedo *= (0.8 + 0.4 * spots) * (0.88 + 0.24 * speck) * mix(0.9, 1.1, variation);
	} else {
		albedo *= 0.85 + 0.3 * speck;
	}
	// Под дождём: кора и камень темнеют заметно, листва — чуть и становится сочнее; глаже всё это почти не делается
	// (мокрый лист даёт слабый блик, но не лак).
	float soaked = rain_wet * (leafy ? 0.08 : (kind > 2.5 ? 0.22 : 0.28));
	if (leafy) {
		float grey = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
		albedo = mix(vec3(grey), albedo, 1.0 + 0.12 * rain_wet);
	}
	albedo *= 1.0 - soaked;
	albedo *= cloud_shade(world_position);
	if (lod_tint.r + lod_tint.g + lod_tint.b > 0.0) {
		albedo = lod_tint * (0.5 + 0.5 * COLOR.g / max(max(COLOR.r, COLOR.g), max(COLOR.b, 0.05)));
	}
	ALBEDO = albedo;
	ROUGHNESS = (leafy ? 0.72 : 0.88) * (1.0 - (leafy ? 0.14 : 0.1) * rain_wet);
	SPECULAR = leafy ? 0.22 : 0.12;
	METALLIC = 0.0;
	if (leafy) {
		BACKLIGHT = albedo * 0.55;
	}
	FOG = air(CAMERA_POSITION_WORLD, world_position);
}
