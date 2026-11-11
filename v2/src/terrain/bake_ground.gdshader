// Запекание описания земли (шаг 1.3 «Поверхности»): что за земля в каждой точке мира — по той же функции, что и
// рельеф. Две текстуры на область: part = 0 — доли местностей (пустыня, холмы, луга, горы); part = 1 — близость воды
// озера, расстояние от уреза моря, камень, доля оазиса (см. world_point в height.gdshaderinc).
shader_type canvas_item;
render_mode blend_disabled, unshaded;

#include "res://src/terrain/height.gdshaderinc"

uniform vec4 bake_rect; // x, z левого верхнего угла и размеры в метрах
uniform float texel = 4.0; // метров на точку
uniform int part = 0;

void fragment() {
	vec2 p = bake_rect.xy + UV * bake_rect.zw;
	vec4 ground_a;
	vec4 ground_b;
	world_point(p, ground_a, ground_b);
	COLOR = part == 0 ? ground_a : ground_b;
	// Проверочная точка в углу — как у рельефа (terrain_baker.gd).
	if (FRAGCOORD.x < 1.0 && FRAGCOORD.y < 1.0) {
		COLOR = vec4(-1024.0, 0.25, -0.5, 2048.0);
	}
}
