// Запекание импосторов (ключ --bake-impostors): модель без света — только её цвет с затенением в глубине кроны,
// прозрачное в текстуре не рисуется. Снимок такого вида и есть изображение дерева для самого дальнего уровня.
shader_type spatial;
render_mode unshaded, cull_disabled;

uniform sampler2D albedo_map : source_color, filter_linear_mipmap;
uniform float leafy = 0.0;

void fragment() {
	vec4 texel = texture(albedo_map, UV);
	if (leafy > 0.5 && texel.a < 0.45) {
		discard;
	}
	ALBEDO = texel.rgb * (leafy > 0.5 ? mix(0.5, 1.05, COLOR.g) : 1.0);
}
