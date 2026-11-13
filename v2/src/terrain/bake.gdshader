// Запекание рельефа: один раз на карту видеокарта считает высоту и наклон каждой точки мира.
// Красный канал — высота в метрах, зелёный и синий — наклон поверхности (нормаль по x и z),
// альфа — уровень воды озера в этой точке (или −999, если озера нет).
shader_type canvas_item;
render_mode blend_disabled, unshaded;

#include "res://src/terrain/height.gdshaderinc"

uniform vec4 bake_rect; // x, z левого верхнего угла и размеры в метрах
uniform float texel = 2.0; // метров на точку

void fragment() {
	// Функция высот считает в координатах доски; мир — доска, увеличенная подобием (и в плане, и по высоте):
	// уклоны те же, высоты и уровни озёр — в WORLD_SCALE раз больше.
	vec2 p = (bake_rect.xy + UV * bake_rect.zw) / WORLD_SCALE;
	float step = texel / WORLD_SCALE;
	vec2 surface = world_surface(p);
	float dx = world_surface(p + vec2(step, 0.0)).x - world_surface(p - vec2(step, 0.0)).x;
	float dz = world_surface(p + vec2(0.0, step)).x - world_surface(p - vec2(0.0, step)).x;
	vec3 normal = normalize(vec3(-dx, 2.0 * step, -dz));
	COLOR = vec4(surface.x * WORLD_SCALE, normal.x, normal.z, surface.y > -900.0 ? surface.y * WORLD_SCALE : surface.y);
	// Проверочная точка в углу: по ней программа видит, что видеокарта отдала числа без искажений
	// (отрицательные, больше единицы, с четвёртым каналом). Сама точка затем заменяется соседней.
	if (FRAGCOORD.x < 1.0 && FRAGCOORD.y < 1.0) {
		COLOR = vec4(-1024.0, 0.25, -0.5, 2048.0);
	}
}
