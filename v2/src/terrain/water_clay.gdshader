// Вода для «глиняного» этапа: спокойное стекло, сквозь которое видны отмели.
// Настоящий океан — шаг 1.5 дорожной карты.
shader_type spatial;
render_mode world_vertex_coords, cull_back, depth_draw_never;

uniform sampler2D height_map : filter_linear, repeat_disable;
uniform vec4 bake_rect;
uniform vec3 shallow_color : source_color = vec3(0.47, 0.6, 0.63);
uniform vec3 deep_color : source_color = vec3(0.1, 0.19, 0.27);
instance uniform float water_level = 0.0;

varying vec3 world_position;

void vertex() {
	world_position = VERTEX;
}

void fragment() {
	vec2 uv = (world_position.xz - bake_rect.xy) / bake_rect.zw;
	float bed = -30.0;
	if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
		bed = textureLod(height_map, uv, 0.0).r;
	}
	float depth = max(water_level - bed, 0.0);
	float density = 1.0 - exp(-depth * 0.17);
	ALBEDO = mix(shallow_color, deep_color, density);
	ALPHA = mix(0.32, 1.0, smoothstep(0.0, 20.0, depth)) * smoothstep(0.0, 0.35, depth);
	ROUGHNESS = 0.16;
	SPECULAR = 0.5;
	METALLIC = 0.0;
}
