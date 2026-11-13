// Деревья из файлов моделей (glTF, v2/assets/models): кора и листва с настоящими текстурами.
//
// Листва — карточки с рисунком ветки: что прозрачно в текстуре, не рисуется. Нормали карточек направлены «от кроны
// наружу» (так их отдаёт модель) — свет ложится на крону целиком, как на объём, а не на каждый листок отдельно.
// Цвет вершин модели: красный — гибкость для ветра (0 — основание ствола, 1 — концы веток и листва), зелёный —
// затенение в глубине кроны. Ветер, дымка, дождь и тени облаков — те же, что у остальной растительности
// (flora.gdshader). far_view — самый дальний уровень: не качается, дерево уходит вдали на своём расстоянии.
shader_type spatial;
render_mode skip_vertex_transform, cull_disabled;

#include "res://src/world/clouds.gdshaderinc"
#include "res://src/world/atmosphere.gdshaderinc"

global uniform vec4 wind_look; // xy — куда дует ветер; z — сила, 0…1; w — время ветра, секунды

uniform sampler2D albedo_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D noise_map : filter_linear_mipmap, repeat_enable;
uniform float leafy = 0.0;
uniform float far_view = 0.0;
uniform vec2 vanish = vec2(1.0e9, 1.0e9);
uniform vec3 lod_tint = vec3(0.0);

varying vec3 world_position;
varying float variation;
varying float depth_shade;

void vertex() {
	vec3 origin = MODEL_MATRIX[3].xyz;
	vec4 custom = INSTANCE_CUSTOM; // x — оттенок, y — фаза ветра и жребий дальнего вида
	variation = custom.x;
	depth_shade = COLOR.g;
	vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	if (far_view > 0.5) {
		float away = distance(origin, CAMERA_POSITION_WORLD);
		float from = mix(vanish.x, vanish.y - 260.0, custom.y);
		world = origin + (world - origin) * (1.0 - smoothstep(from, from + 260.0, away));
	}
	float strength = wind_look.z;
	float flex = COLOR.r;
	if (strength > 0.001 && flex > 0.001 && far_view < 0.5) {
		vec2 along = wind_look.xy;
		float t = wind_look.w;
		float gust = 0.5 + 0.5 * sin(t * 0.9 - dot(origin.xz, along) * 0.045 + 2.0 * sin(origin.x * 0.013 + origin.z * 0.007));
		float sway = strength * (0.3 + 0.7 * gust);
		float height = max(world.y - origin.y, 0.0);
		vec2 push = along * sway * flex * (0.045 * height + 0.2) * (1.0 + 0.5 * sin(t * 1.7 + custom.y * 6.283));
		float flutter = sin(t * 6.0 + world.x * 1.7 + world.z * 1.3 + custom.y * 20.0) * flex * flex * strength * 0.07;
		world.xz += push + vec2(-along.y, along.x) * flutter;
		world.y += flutter - length(push) * 0.15;
	}
	world_position = world;
	VERTEX = (VIEW_MATRIX * vec4(world, 1.0)).xyz;
	NORMAL = normalize((VIEW_MATRIX * vec4(mat3(MODEL_MATRIX) * NORMAL, 0.0)).xyz);
}

void fragment() {
	vec4 texel = texture(albedo_map, UV);
	bool leaf = leafy > 0.5;
	if (leaf && texel.a < 0.45) {
		discard;
	}
	vec3 albedo = texel.rgb;
	if (leaf) {
		// Карточка видна с обеих сторон, а свет на ней — как на кроне: нормаль «наружу» не переворачивается.
		if (!FRONT_FACING) {
			NORMAL = -NORMAL;
		}
		float spots = texture(noise_map, world_position.xz * 0.09 + world_position.y * 0.05).r;
		albedo *= mix(vec3(0.88, 0.93, 0.86), vec3(1.12, 1.07, 0.98), variation) * mix(0.5, 1.05, depth_shade) * (0.85 + 0.3 * spots);
	} else {
		albedo *= mix(0.9, 1.1, variation);
	}
	float soaked = rain_wet * (leaf ? 0.08 : 0.28);
	if (leaf) {
		float grey = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
		albedo = mix(vec3(grey), albedo, 1.0 + 0.12 * rain_wet);
	}
	albedo *= 1.0 - soaked;
	albedo *= cloud_shade(world_position);
	if (lod_tint.r + lod_tint.g + lod_tint.b > 0.0) {
		albedo = lod_tint * (0.4 + 0.6 * dot(texel.rgb, vec3(0.33)) * 2.0);
	}
	ALBEDO = albedo;
	ROUGHNESS = (leaf ? 0.72 : 0.9) * (1.0 - (leaf ? 0.14 : 0.1) * rain_wet);
	SPECULAR = leaf ? 0.2 : 0.12;
	METALLIC = 0.0;
	if (leaf) {
		BACKLIGHT = albedo * 0.5;
	}
	FOG = air(CAMERA_POSITION_WORLD, world_position);
}
