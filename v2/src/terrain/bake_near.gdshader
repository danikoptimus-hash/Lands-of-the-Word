// Запекание кэша ближнего вида земли (near_cache.gd): та же точка, что шейдер кадра считает напрямую
// (surface_near.gdshaderinc — код общий), считается здесь один раз в клетку текстуры вокруг камеры, а кадр её потом
// только читает. Вопрос владельца на 0.5.3: «есть вариант всю карту предрассчитать и потом только читать?» — всю
// карту в подробности ближнего вида нельзя (десятки гигабайт), а землю вокруг камеры — можно.
//
// Текстура уровня — «по кругу»: клетка мира (x, z) всегда лежит в точке текстуры (x mod N, z mod N). Когда окно
// уровня сдвигается за камерой, старые клетки остаются на местах, а новые ложатся на место ушедших — досчитываются
// только полосы по краю окна.
shader_type canvas_item;
render_mode blend_disabled, unshaded;

// Холст кэша — обычный (не HDR: текстуры уровней занимали бы вдвое больше памяти), и цвет текстур материалов
// приходит сюда в кодировке sRGB; общий код переводит его в линейный сам.
#define LAYER_COLOR_IS_ENCODED
#include "res://src/terrain/surface_near.gdshaderinc"

uniform sampler2D height_map : filter_linear, repeat_disable; // высота (r) и наклон (g, b) — та же текстура, что у кадра
uniform ivec2 origin_cell; // клетка мира в углу окна уровня
uniform ivec2 origin_texel; // её место в текстуре: origin_cell mod cells
uniform int cells = 4096; // сторона текстуры уровня, клеток
uniform float cell_size = 0.0625; // метров на клетку
// Что пишем: 0 — цвет (корень из половины: цвет бывает ярче единицы) и высота фактуры; 1 — мелкий рельеф
// (сдвиг нормали по x и z), шероховатость и мокрота.
uniform int part = 0;

void fragment() {
	ivec2 shift = ivec2(FRAGCOORD.xy) - origin_texel;
	shift += cells * ivec2(lessThan(shift, ivec2(0)));
	vec2 p = (vec2(origin_cell + shift) + 0.5) * cell_size;
	vec4 baked = textureLod(height_map, (p - bake_rect.xy) / bake_rect.zw, 0.0);
	vec3 n = vec3(baked.g, sqrt(max(1.0 - dot(baked.gb, baked.gb), 0.0)), baked.b);
	vec3 wp = vec3(p.x, baked.r, p.y);
	// Шаг клетки по самой поверхности: на склоне клетка плана покрывает больше земли.
	float rise = 1.0 / max(n.y, 0.05);
	vec3 dpx = vec3(cell_size, -n.x * rise * cell_size, 0.0);
	vec3 dpy = vec3(0.0, -n.z * rise * cell_size, cell_size);

	vec3 albedo;
	vec4 detail;
	float texture_height;
	float wet;
	int lead_layer;
	float lead_share;
	near_surface(wp, n, dpx, dpy, albedo, detail, texture_height, wet, lead_layer, lead_share);
	if (part == 0) {
		COLOR = vec4(sqrt(clamp(albedo * 0.5, 0.0, 1.0)), texture_height);
	} else {
		// Готовая нормаль точки: в кэше хранится её отличие от нормали рельефа по x и z, третья координата
		// восстанавливается по длине (нормаль земли всегда смотрит вверх).
		vec3 normal = normalize(n + detail.xyz * 0.9);
		COLOR = vec4((normal.xz - n.xz) * 0.5 + 0.5, detail.w, wet);
	}
}
