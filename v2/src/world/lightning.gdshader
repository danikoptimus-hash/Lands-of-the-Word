// Молния (шаг 1.6): лента вдоль ломаной разряда, всегда повёрнутая к камере. В середине ленты — тонкий яркий
// канал, вокруг — мягкое свечение. Лента не тоньше пары точек экрана, сколько бы до неё ни было: молнию видно
// и с другого конца мира. Вдали её гасят дымка и дождь.
//
// Сетка: в VERTEX — точка ломаной (в мире), в NORMAL — куда ломаная идёт в этой точке, в UV — край ленты (−1 или 1)
// и яркость ветви, в UV2 — её толщина (главный канал — 1) и место вдоль разряда (0 — у тучи).
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled, skip_vertex_transform;

#include "res://src/world/clouds.gdshaderinc"
#include "res://src/world/atmosphere.gdshaderinc"

uniform float power = 1.0; // яркость сейчас: разряд вспыхивает несколько раз и гаснет
uniform vec3 tint : source_color = vec3(0.78, 0.84, 1.0);
uniform float ribbon = 7.0; // полуширина ленты (со свечением) вблизи, метры
uniform float pixel = 0.0024; // и не уже этой доли расстояния до камеры

varying float bright;

void vertex() {
	vec3 world = VERTEX;
	vec3 to_eye = CAMERA_POSITION_WORLD - world;
	float distance = length(to_eye);
	vec3 across = normalize(cross(NORMAL, to_eye));
	vec4 mist = air(CAMERA_POSITION_WORLD, world);
	world += across * UV.x * UV2.x * max(ribbon, distance * pixel);
	VERTEX = (VIEW_MATRIX * vec4(world, 1.0)).xyz;
	// У самой тучи канал выходит из неё, а не начинается обрубком.
	bright = UV.y * (1.0 - 0.92 * mist.a) * smoothstep(0.0, 0.06, UV2.y);
}

void fragment() {
	float across = UV.x * UV.x;
	float channel = exp(-across / 0.014);
	float halo = exp(-across / 0.2) * 0.14;
	ALBEDO = tint * (channel * 16.0 + halo * 4.0) * bright * power;
}
