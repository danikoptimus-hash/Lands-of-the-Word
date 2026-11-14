// Струи дождя (шаг 1.6): ближний, средний и дальний план — три «коробки» вокруг камеры, каждая со своим
// размером, длиной и яркостью струй. Капли живут в мире, а не на экране: камера движется — струи остаются
// на местах и проходят мимо, ближние быстрее дальних. Густота — по карте облаков: под толстыми тучами льёт,
// между ними реже. С высоты струи сходят на нет: там шторм виден завесами (rain_veil.gdshader), а не линиями.
//
// Сетка — набор полосок; у каждой в VERTEX — её случайное место в коробке (0…1), в UV — угол полоски,
// в COLOR — случайные числа (скорость, отклонение, яркость).
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled, skip_vertex_transform;

#include "res://src/world/clouds.gdshaderinc"
#include "res://src/world/atmosphere.gdshaderinc"

uniform vec3 box = vec3(48.0, 36.0, 48.0); // размер коробки вокруг камеры, метры
uniform float streak_length = 0.45; // длина струи, метры
uniform float streak_width = 0.018;
uniform float speed = 9.0; // скорость падения, м/с
uniform float strength = 0.5; // непрозрачность струи
uniform vec2 height_fade = vec2(300.0, 900.0); // с какой высоты камеры над землёй струи редеют и на какой пропадают
uniform float near_fade = 3.0; // ближе этого к камере струи не рисуются, метры

varying float shown;

void vertex() {
	vec3 eye = CAMERA_POSITION_WORLD;
	// Каждая капля летит чуть по-своему: скорость и направление слегка разные.
	vec3 fall = rain_fall();
	vec3 jitter = (COLOR.rgb - 0.5) * vec3(0.12, 0.0, 0.12);
	vec3 along = normalize(fall + jitter);
	vec3 velocity = along * speed * mix(0.78, 1.22, COLOR.a);
	vec3 place = VERTEX * box + velocity * rain_look.y;
	vec3 offset = mod(place - eye, box) - box * 0.5;
	vec3 centre = eye + offset;
	vec3 across = normalize(cross(along, -offset));
	vec3 world = centre + along * (UV.y - 0.5) * streak_length * mix(0.7, 1.3, COLOR.g) + across * UV.x * streak_width;
	VERTEX = (VIEW_MATRIX * vec4(world, 1.0)).xyz;
	float distance = length(offset);
	float edge = 0.5 * min(box.x, min(box.y, box.z));
	shown = smoothstep(edge, edge * 0.7, distance) * smoothstep(near_fade, near_fade * 2.5, distance);
	shown *= rain_at(rain_source(centre), 2.0) * rain_look.x * mix(0.6, 1.0, COLOR.r);
	shown *= 1.0 - smoothstep(height_fade.x, height_fade.y, rain_look.w);
	// Под землёй и под водой струй нет.
	shown *= step(0.0, centre.y);
}

void fragment() {
	// Струя светлее к середине и сходит на нет к концам.
	float across = 1.0 - abs(UV.x);
	float along = sin(UV.y * PI);
	ALBEDO = haze_color.rgb * 1.5 + FLASH_COLOR * flash_at.w * 0.2;
	ALPHA = shown * strength * across * along;
}
