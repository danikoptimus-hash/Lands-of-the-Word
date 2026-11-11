// Запекание рельефа: один раз на карту видеокарта считает высоту и наклон каждой точки мира.
// Красный канал — высота в метрах, зелёный и синий — наклон поверхности (нормаль по x и z),
// альфа — уровень воды озера в этой точке (или −999, если озера нет).
shader_type canvas_item;
render_mode blend_disabled, unshaded;

#include "res://src/terrain/height.gdshaderinc"

uniform vec4 bake_rect; // x, z левого верхнего угла и размеры в метрах
uniform float texel = 2.0; // метров на точку

void fragment() {
	vec2 p = bake_rect.xy + UV * bake_rect.zw;
	vec2 surface = world_surface(p);
	float dx = world_surface(p + vec2(texel, 0.0)).x - world_surface(p - vec2(texel, 0.0)).x;
	float dz = world_surface(p + vec2(0.0, texel)).x - world_surface(p - vec2(0.0, texel)).x;
	vec3 normal = normalize(vec3(-dx, 2.0 * texel, -dz));
	COLOR = vec4(surface.x, normal.x, normal.z, surface.y);
}
