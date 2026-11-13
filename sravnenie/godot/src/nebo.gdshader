// Небо сцены сравнения с прямым расчётом облаков: облака считаются заново в каждом кадре, на половине
// разрешения (как в образце Godot Volumetric Cloud Demo, clayjohn, MIT). Дорого; оставлено для сравнения
// с куполом (nebo_kupol.gdshader). Общая часть — nebo_obshchee.gdshaderinc.

shader_type sky;
render_mode use_half_res_pass, use_quarter_res_pass;

#define SUN_DIR LIGHT0_DIRECTION
#define SUN_POWER LIGHT0_ENERGY
#define SUN_COLOR LIGHT0_COLOR
#include "nebo_obshchee.gdshaderinc"

// ПРАВКА: расчёт неба с облаками вынесен в функцию — так он заведомо не выполняется в проходе полного
// разрешения, где нужна только готовая картинка пониженного разрешения.
vec3 sky_with_clouds(vec3 dir) {
	vec3 background = background_sky(dir);
	if (dir.y <= 0.0) {
		return background;
	}
	return compose_sky(dir, background, cloud_volume(dir));
}

void sky() {
	// Draw to quarter res buffer for reflections
	// Draw to half res buffer for main sky
	if (AT_QUARTER_RES_PASS && AT_CUBEMAP_PASS) {
		COLOR = sky_with_clouds(EYEDIR);
		ALPHA = 1.0;
	} else if (AT_HALF_RES_PASS && !AT_CUBEMAP_PASS) {
		COLOR = sky_with_clouds(EYEDIR);
		ALPHA = 1.0;
	} else if (AT_CUBEMAP_PASS) {
		COLOR = QUARTER_RES_COLOR.rgb;
	} else {
		COLOR = HALF_RES_COLOR.rgb; // Change to col.rgb for full resolution
	}
}
