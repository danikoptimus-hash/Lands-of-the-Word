// Запекание рельефа: один раз на карту видеокарта считает высоту и наклон каждой точки мира.
// Красный канал — высота в метрах, зелёный и синий — наклон поверхности (нормаль по x и z).
shader_type canvas_item;
render_mode blend_disabled, unshaded;

#include "res://src/terrain/height.gdshaderinc"

uniform vec4 bake_rect; // x, z левого верхнего угла и размеры в метрах
uniform float texel = 2.0; // метров на точку

void fragment() {
	vec2 p = bake_rect.xy + UV * bake_rect.zw;
	float h = world_height(p);
	float dx = world_height(p + vec2(texel, 0.0)) - world_height(p - vec2(texel, 0.0));
	float dz = world_height(p + vec2(0.0, texel)) - world_height(p - vec2(0.0, texel));
	vec3 normal = normalize(vec3(-dx, 2.0 * texel, -dz));
	COLOR = vec4(h, normal.x, normal.z, 1.0);
}
