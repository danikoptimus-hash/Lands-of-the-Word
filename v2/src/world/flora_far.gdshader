// Самый дальний вид дерева — импостор: плоские изображения, снятые с той же полной модели (сбоку и сверху;
// их запекает ключ --bake-impostors в общую картинку assets/models/flora_far.png). На дерево — три четырёхугольника:
// два крест-накрест с видом сбоку и один плашмя с видом сверху. Силуэт и тон — те же, что у модели вблизи.
// Номер клетки картинки и высота «вида сверху» приходят с экземпляром (INSTANCE_CUSTOM: z и w), поэтому все породы
// плитки рисуются одной пачкой. Каждое дерево уходит вдали на своём расстоянии (vanish), как и прежний дальний вид.
shader_type spatial;
render_mode skip_vertex_transform, cull_disabled;

#include "res://src/world/clouds.gdshaderinc"
#include "res://src/world/atmosphere.gdshaderinc"

uniform sampler2D atlas : source_color, filter_linear_mipmap, repeat_disable;
uniform vec2 grid = vec2(8.0, 4.0);
uniform vec2 vanish = vec2(1.0e9, 1.0e9);
uniform vec3 lod_tint = vec3(0.0);

varying vec3 world_position;
varying float variation;
varying float cell;

void vertex() {
	vec3 origin = MODEL_MATRIX[3].xyz;
	vec4 custom = INSTANCE_CUSTOM; // x — оттенок, y — жребий, z — клетка вида сбоку (вид сверху — следующая), w — высота вида сверху
	variation = custom.x;
	cell = custom.z + UV2.x;
	vec3 local = VERTEX;
	if (UV2.x > 0.5) {
		local.y = custom.w;
	}
	vec3 world = (MODEL_MATRIX * vec4(local, 1.0)).xyz;
	float away = distance(origin, CAMERA_POSITION_WORLD);
	float from = mix(vanish.x, vanish.y - 260.0, custom.y);
	world = origin + (world - origin) * (1.0 - smoothstep(from, from + 260.0, away));
	world_position = world;
	VERTEX = (VIEW_MATRIX * vec4(world, 1.0)).xyz;
	// Свет — как на кроне сверху: изображение плоское, а освещено дерево целиком.
	NORMAL = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
}

void fragment() {
	float index = floor(cell + 0.5);
	vec2 at = vec2(mod(index, grid.x), floor(index / grid.x));
	vec4 texel = texture(atlas, (at + clamp(UV, 0.006, 0.994)) / grid);
	if (texel.a < 0.3) {
		discard;
	}
	if (!FRONT_FACING) {
		NORMAL = -NORMAL;
	}
	vec3 albedo = texel.rgb * mix(vec3(0.88, 0.93, 0.86), vec3(1.12, 1.07, 0.98), variation);
	float grey = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
	albedo = mix(vec3(grey), albedo, 1.0 + 0.12 * rain_wet) * (1.0 - 0.08 * rain_wet);
	albedo *= cloud_shade(world_position);
	if (lod_tint.r + lod_tint.g + lod_tint.b > 0.0) {
		albedo = lod_tint * (0.4 + 1.2 * grey);
	}
	ALBEDO = albedo;
	ROUGHNESS = 0.78;
	SPECULAR = 0.15;
	METALLIC = 0.0;
	BACKLIGHT = albedo * 0.4;
	FOG = air(CAMERA_POSITION_WORLD, world_position);
}
