// Вода для «глиняного» этапа: спокойное стекло, сквозь которое видны отмели.
// Настоящий океан — шаг 1.5 дорожной карты.
shader_type spatial;
render_mode world_vertex_coords, cull_back, depth_draw_never;

uniform sampler2D height_map : filter_linear, repeat_disable;
uniform vec4 bake_rect;
uniform vec3 shallow_color : source_color = vec3(0.4, 0.62, 0.64);
uniform vec3 deep_color : source_color = vec3(0.08, 0.2, 0.3);
instance uniform float water_level = 0.0;

varying vec3 world_position;

void vertex() {
	world_position = VERTEX;
}

void fragment() {
	vec2 uv = (world_position.xz - bake_rect.xy) / bake_rect.zw;
	float bed = -30.0;
	float lake = -999.0;
	if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
		vec4 texel = textureLod(height_map, uv, 0.0);
		bed = texel.r;
		lake = texel.a;
	}
	// Вода озера рисуется только в своей котловине: там, где запечён именно её уровень.
	// Иначе круг воды залил бы соседнюю низину. Море (уровень 0) рисуется везде.
	if (water_level > 0.25 && abs(lake - water_level) > 0.05) {
		discard;
	}
	float depth = max(water_level - bed, 0.0);
	// Чем глубже, тем темнее и плотнее вода; у самого берега она сходит на нет.
	ALBEDO = mix(shallow_color, deep_color, 1.0 - exp(-depth * 0.14));
	ALPHA = mix(0.4, 1.0, 1.0 - exp(-depth * 0.28)) * smoothstep(0.0, 0.35, depth);
	ROUGHNESS = 0.16;
	SPECULAR = 0.5;
	METALLIC = 0.0;
}
