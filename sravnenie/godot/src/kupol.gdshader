// Картинка купола неба: облака над горизонтом, посчитанные в отдельную квадратную картинку. Она обновляется
// не целиком, а полосами — по одной за кадр (см. main.gd), поэтому цена облаков в кадре мала и не зависит
// от разрешения экрана, а сами облака гладкие. Небо (nebo_kupol.gdshader) эту картинку только показывает.
//
// Раскладка: центр картинки — зенит, край вписанного круга — горизонт; расстояние от центра пропорционально
// углу от зенита («рыбий глаз»), по кругу — стороны света (вправо +X, вниз +Z).
// Расчёт облаков — общая часть nebo_obshchee.gdshaderinc (основа — Godot Volumetric Cloud Demo, clayjohn, MIT).

shader_type canvas_item;
render_mode blend_disabled, unshaded;

uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);
uniform float sun_power = 1.0;
uniform vec3 sun_color = vec3(1.0);
uniform float dome_size = 2048.0;

#define SUN_DIR sun_dir
#define SUN_POWER sun_power
#define SUN_COLOR sun_color
#include "res://src/nebo_obshchee.gdshaderinc"

void fragment() {
	vec2 at = FRAGCOORD.xy / dome_size * 2.0 - 1.0;
	float r = length(at);
	vec4 volume = vec4(0.0);
	if (r < 1.0) {
		float angle = r * PI * 0.5;
		vec2 side = r > 0.00001 ? at / r : vec2(0.0);
		vec3 dir = vec3(sin(angle) * side.x, cos(angle), sin(angle) * side.y);
		if (dir.y > 0.004) {
			volume = cloud_volume(dir);
		}
	}
	COLOR = volume;
}
