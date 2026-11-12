// Слой облаков, видный с большой высоты (шаг 1.6): та же карта облаков, что на небе и в тенях, — полотно
// на высоте облаков. Когда камера опускается к нему, слой тает (пролетать сквозь плоское полотно незачем);
// снизу облака видны на небе (sky.gdshader).
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, world_vertex_coords;

#include "res://src/world/clouds.gdshaderinc"

uniform vec3 lit_color : source_color = vec3(1.0, 0.97, 0.92);
uniform float strength = 0.0; // 0 — слоя нет
uniform float reach = 30000.0; // половина стороны полотна, метры

varying vec3 world_position;

void vertex() {
	world_position = VERTEX;
}

void fragment() {
	float density = cloud_cover_at(world_position.xz);
	float above = CAMERA_POSITION_WORLD.y - world_position.y;
	float seen = smoothstep(500.0, 2600.0, above);
	float rim = 1.0 - smoothstep(0.7, 1.0, length(world_position.xz - CAMERA_POSITION_WORLD.xz) / reach);
	ALBEDO = lit_color * mix(1.25, 1.6, density);
	// Плотна только середина облака; края прозрачные — землю под слоем видно.
	ALPHA = density * density * strength * seen * rim;
}
