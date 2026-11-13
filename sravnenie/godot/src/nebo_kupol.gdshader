// Небо сцены сравнения, которое показывает готовую картинку купола с облаками (kupol.gdshader): фон неба
// считается по формуле в каждой точке экрана (это дёшево), облака берутся из картинки.
//
// Картинка снята в один момент из одной точки, а показывается несколько кадров и при движении камеры. Чтобы облака
// при этом плыли и смещались плавно, направление взгляда пересчитывается: точка слоя облаков, на которую мы
// смотрим сейчас, — где она была на картинке (с учётом ветра за прошедшее время и сдвига камеры).
// Общая часть — nebo_obshchee.gdshaderinc (основа — Godot Volumetric Cloud Demo, clayjohn, MIT).

shader_type sky;

#define SUN_DIR LIGHT0_DIRECTION
#define SUN_POWER LIGHT0_ENERGY
#define SUN_COLOR LIGHT0_COLOR
#include "nebo_obshchee.gdshaderinc"

uniform sampler2D dome : filter_linear, repeat_disable;
uniform float dome_size = 2048.0;
uniform float dome_on = 1.0; // 0 — небо без облаков (замер цены облаков)
uniform float snap_time = 0.0; // время облаков, в которое снята картинка
uniform vec3 snap_place = vec3(0.0); // место камеры, из которого она снята

vec2 dome_uv(vec3 d) {
	float r = acos(clamp(d.y, -1.0, 1.0)) / (PI * 0.5);
	float len = length(d.xz);
	vec2 side = len > 0.00001 ? d.xz / len : vec2(0.0);
	return 0.5 + 0.5 * r * side;
}

void sky() {
	vec3 dir = EYEDIR;
	vec3 background = background_sky(dir);
	vec3 color = background;
	if (dir.y > 0.0 && dome_on > 0.5) {
		// Слой облаков — как плоскость на высоте, где их больше всего видно снизу.
		float layer = cloud_bottom + 0.3 * (cloud_top - cloud_bottom);
		float top = cloud_bottom - 200.0;
		vec3 here = vec3(camera_place.x, clamp(camera_place.y, 0.0, top), camera_place.z);
		vec3 there = vec3(snap_place.x, clamp(snap_place.y, 0.0, top), snap_place.z);
		vec3 seen = here + dir * ((layer - here.y) / max(dir.y, 0.02));
		// Облака плывут против сдвига шума в расчёте плотности: 12 м/с на единицу ветра.
		seen.xz += normalize(wind_direction) * wind_speed * 12.0 * (sky_time - snap_time);
		vec2 uv = dome_uv(normalize(seen - there));
		// Четыре соседние точки картинки вместо одной: зерно расчёта не видно.
		float texel = 0.75 / dome_size;
		vec4 volume = 0.25 * (texture(dome, uv + vec2(texel, texel)) + texture(dome, uv + vec2(-texel, texel))
				+ texture(dome, uv + vec2(texel, -texel)) + texture(dome, uv + vec2(-texel, -texel)));
		color = compose_sky(dir, background, volume);
	}
	COLOR = color;
}
