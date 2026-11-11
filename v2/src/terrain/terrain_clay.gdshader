// Земля «в глине»: форма без цвета и материалов (шаг 1.2). Поверхности появятся на шаге 1.3.
shader_type spatial;
render_mode world_vertex_coords;

#include "res://src/terrain/hex.gdshaderinc"

uniform sampler2D height_map : filter_linear_mipmap, repeat_disable;
uniform sampler2D normal_map : filter_linear_mipmap, repeat_disable; // та же текстура, со сглаживанием вдали
uniform vec4 bake_rect;
uniform vec3 clay_color : source_color = vec3(0.67, 0.62, 0.56);
uniform float grid_strength : hint_range(0.0, 1.0) = 0.5;
uniform float skirt_depth = 24.0;
// Уровень детализации плитки: 0 — сетка с шагом 4 м, 1 — 8 м, 2 — 16 м. Высоты берутся из копии рельефа,
// сглаженной под шаг сетки: у редкой сетки вдали обрывы не идут «пилой».
instance uniform float height_lod = 0.0;
// Плавная смена детализации: откуда смотрит камера и на каких расстояниях меняются уровни (world_terrain.gd).
uniform vec3 viewer_position = vec3(0.0, 1.0e6, 0.0);
uniform vec2 lod_distance = vec2(2000.0, 4500.0);
uniform float morph_start = 0.7;

varying vec3 world_position;

// Какая детализация нужна в точке: 0 рядом с камерой, 2 вдали; между уровнями растёт плавно.
float detail_level(vec2 point) {
	float distance_to_viewer = length(vec3(point - viewer_position.xz, viewer_position.y));
	vec2 t = clamp((vec2(distance_to_viewer) / lod_distance - morph_start) / (1.0 - morph_start), 0.0, 1.0);
	return t.x + t.y;
}

void vertex() {
	// Перед сменой сетки на более редкую точки сами съезжаются в её положение, а высоты плавно переходят
	// к сглаженным: ко времени смены обе сетки совпадают, и рельеф не «перещёлкивает».
	float morph = clamp(detail_level(VERTEX.xz) - height_lod, 0.0, 1.0);
	VERTEX.xz -= UV2 * morph;
	vec2 uv = (VERTEX.xz - bake_rect.xy) / bake_rect.zw;
	float h = textureLod(height_map, uv, height_lod + morph).r;
	// «Юбка» по краю плитки закрывает щели между уровнями детализации.
	VERTEX.y = h - UV.x * skirt_depth;
	world_position = vec3(VERTEX.x, h, VERTEX.z);
}

// Расстояние до ближайшей стороны гекса суши, в метрах.
float land_edge_distance(vec2 p) {
	ivec2 h0 = hex_at(p);
	float nearest = 1.0e6;
	for (int dr = -1; dr <= 1; dr++) {
		for (int dq = -1; dq <= 1; dq++) {
			if (abs(dq + dr) > 1) {
				continue;
			}
			ivec2 h = h0 + ivec2(dq, dr);
			if (terrain_at(h) != T_SEA) {
				nearest = min(nearest, abs(sd_hex(p - hex_center(h))));
			}
		}
	}
	return nearest;
}

void fragment() {
	vec2 uv = (world_position.xz - bake_rect.xy) / bake_rect.zw;
	vec2 slope = texture(normal_map, uv).gb;
	vec3 normal = vec3(slope.x, sqrt(max(1.0 - dot(slope, slope), 0.0)), slope.y);
	NORMAL = normalize((VIEW_MATRIX * vec4(normal, 0.0)).xyz);

	vec3 color = clay_color;
	// Крутые склоны чуть темнее: объём читается и в тени.
	color *= mix(0.86, 1.0, smoothstep(0.55, 0.95, normal.y));

	if (grid_strength > 0.0) {
		vec2 p = world_position.xz;
		float pixel = 0.7071 * length(vec2(length(dFdx(p)), length(dFdy(p))));
		float half_width = max(0.8, 0.85 * pixel);
		float grid_line = 1.0 - smoothstep(half_width - 0.6 * pixel, half_width + 0.6 * pixel, land_edge_distance(p));
		color *= 1.0 - 0.42 * grid_strength * grid_line;
	}

	ALBEDO = color;
	ROUGHNESS = 0.94;
	SPECULAR = 0.15;
}
