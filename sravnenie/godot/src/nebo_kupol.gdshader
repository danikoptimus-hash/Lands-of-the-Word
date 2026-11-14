// Небо сцены сравнения, которое показывает готовую картинку купола с облаками (kupol.gdshader): фон неба
// считается по формуле в каждой точке экрана (это дёшево), облака берутся из картинки.
//
// Картинка снята в один момент из одной точки, а показывается несколько кадров и при движении камеры. Чтобы облака
// при этом плыли и смещались плавно, направление взгляда пересчитывается в каждом кадре: точка слоя облаков, на
// которую мы смотрим сейчас, — где она была на картинке (с учётом сноса облаков ветром и сдвига камеры).
// Общая часть — nebo_obshchee.gdshaderinc (основа — Godot Volumetric Cloud Demo, clayjohn, MIT).

shader_type sky;

#define SUN_DIR LIGHT0_DIRECTION
#define SUN_POWER LIGHT0_ENERGY
#define SUN_COLOR LIGHT0_COLOR
#include "res://src/nebo_obshchee.gdshaderinc"

uniform sampler2D dome : filter_linear, repeat_disable;
uniform vec2 snap_drift = vec2(0.0); // снос облаков, при котором снята картинка
uniform vec3 snap_place = vec3(0.0); // место камеры, из которого она снята
// Предыдущая картинка: несколько кадров после смены новая проявляется поверх неё, а не встаёт рывком.
uniform sampler2D dome_prev : filter_linear, repeat_disable;
uniform vec2 prev_drift = vec2(0.0);
uniform vec3 prev_place = vec3(0.0);
uniform float dome_blend = 1.0; // 0 — предыдущая картинка, 1 — новая
uniform float dome_size = 2048.0;
uniform float dome_on = 1.0; // 0 — небо без облаков (замер цены облаков)

vec2 dome_uv(vec3 d) {
	float r = acos(clamp(d.y, -1.0, 1.0)) / (PI * 0.5);
	float len = length(d.xz);
	vec2 side = len > 0.00001 ? d.xz / len : vec2(0.0);
	return 0.5 + 0.5 * r * side;
}

// Облака из картинки в направлении взгляда: картинка снята при сносе облаков taken_drift из точки taken_place.
vec4 dome_look(sampler2D picture, vec3 dir, vec2 taken_drift, vec3 taken_place) {
	// Слой облаков — как плоскость. Высота подобрана замером: при ней пересчитанная картинка смещается так же,
	// как посчитанная заново (при 0,2 толщины слоя пересчёт убегал вперёд на 6–16 %).
	float layer = cloud_bottom + 0.45 * (cloud_top - cloud_bottom);
	float top = cloud_bottom - 200.0;
	vec3 here = vec3(camera_place.x, clamp(camera_place.y, 0.0, top), camera_place.z);
	vec3 there = vec3(taken_place.x, clamp(taken_place.y, 0.0, top), taken_place.z);
	vec3 seen = here + dir * ((layer - here.y) / max(dir.y, 0.02));
	// С тех пор облака уплыли на разницу сносов: точка, которую видим сейчас, на картинке была раньше по ветру.
	seen.xz -= cloud_drift - taken_drift;
	vec2 uv = dome_uv(normalize(seen - there));
	// Четыре соседние точки картинки вместо одной: зерно расчёта не видно. Разброс мал — облака не мылятся.
	float texel = 0.4 / dome_size;
	return 0.25 * (texture(picture, uv + vec2(texel, texel)) + texture(picture, uv + vec2(-texel, texel))
			+ texture(picture, uv + vec2(texel, -texel)) + texture(picture, uv + vec2(-texel, -texel)));
}

void sky() {
	vec3 dir = EYEDIR;
	vec3 background = background_sky(dir);
	vec3 color = background;
	if (dir.y > 0.0 && dome_on > 0.5) {
		vec4 volume = dome_look(dome, dir, snap_drift, snap_place);
		if (dome_blend < 1.0) {
			volume = mix(dome_look(dome_prev, dir, prev_drift, prev_place), volume, dome_blend);
		}
		color = compose_sky(dir, background, volume);
	}
	COLOR = color;
}
