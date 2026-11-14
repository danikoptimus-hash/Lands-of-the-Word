// Камни и скальные выходы из файла модели (kamen.glb, v2/tools/models/make.py).
//
// Фактура и рельеф — фотоматериал, наложенный по трём осям мира: развёртки и швов нет, а зерно камня одного
// размера у булыжника и у скалы в четырнадцать метров (как на скалах самой земли). Цвет породы приходит с
// экземпляром — тот же, что у скал вокруг (flora.gd, _rock_color); в цвете вершин модели — затенение: у земли
// и во впадинах темнее. Дымка, дождь и тени облаков — как у остальной растительности. far_view — самый дальний
// уровень: камень уходит вдали на своём расстоянии, а не вся плитка разом.
shader_type spatial;
render_mode skip_vertex_transform;

#include "res://src/world/clouds.gdshaderinc"
#include "res://src/world/atmosphere.gdshaderinc"

uniform sampler2D albedo_map : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_map : filter_linear_mipmap_anisotropic, repeat_enable;
uniform float tile = 2.4; // метров мира на плитку фактуры
uniform float far_view = 0.0;
uniform vec2 vanish = vec2(1.0e9, 1.0e9);
uniform vec3 lod_tint = vec3(0.0);

varying vec3 world_position;
varying vec3 world_normal;
varying vec3 tint;

void vertex() {
	vec3 origin = MODEL_MATRIX[3].xyz;
	vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	if (far_view > 0.5) {
		float away = distance(origin, CAMERA_POSITION_WORLD);
		float from = mix(vanish.x, vanish.y - 120.0, INSTANCE_CUSTOM.y);
		world = origin + (world - origin) * (1.0 - smoothstep(from, from + 120.0, away));
	}
	world_position = world;
	world_normal = normalize(mat3(MODEL_MATRIX) * NORMAL);
	tint = COLOR.rgb; // цвет породы (экземпляр) × затенение (вершина)
	VERTEX = (VIEW_MATRIX * vec4(world, 1.0)).xyz;
	NORMAL = normalize((VIEW_MATRIX * vec4(world_normal, 0.0)).xyz);
}

vec3 relief(vec2 uv) {
	vec2 xy = texture(normal_map, uv).rg * 2.0 - 1.0;
	return vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
}

void fragment() {
	vec3 n = normalize(world_normal);
	vec3 weight = pow(abs(n), vec3(4.0));
	weight /= weight.x + weight.y + weight.z;
	vec3 p = world_position / tile;
	float detail = texture(albedo_map, p.zy).r * weight.x + texture(albedo_map, p.xz).r * weight.y + texture(albedo_map, p.xy).r * weight.z;
	// Рельеф по трём осям: нормаль каждой проекции поворачивается к поверхности и смешивается с соседними.
	vec3 tx = relief(p.zy);
	vec3 ty = relief(p.xz);
	vec3 tz = relief(p.xy);
	tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
	ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
	tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
	vec3 bumped = normalize(tx.zyx * weight.x + ty.xzy * weight.y + tz.xyz * weight.z);
	NORMAL = normalize((VIEW_MATRIX * vec4(bumped, 0.0)).xyz);
	vec3 albedo = tint * (0.5 + detail);
	albedo *= 1.0 - 0.3 * rain_wet;
	albedo *= cloud_shade(world_position);
	if (lod_tint.r + lod_tint.g + lod_tint.b > 0.0) {
		albedo = lod_tint * (0.3 + 0.7 * detail);
	}
	ALBEDO = albedo;
	ROUGHNESS = 0.92 * (1.0 - 0.3 * rain_wet);
	SPECULAR = 0.2;
	METALLIC = 0.0;
	FOG = air(CAMERA_POSITION_WORLD, world_position);
}
