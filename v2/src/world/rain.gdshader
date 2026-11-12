// Дождь (шаг 1.6): штрихи поверх картинки мира — три слоя разной крупности и скорости, наклон по ветру.
// Время падения копит weather.gd (в кадрах проверок оно стоит).
shader_type canvas_item;
render_mode blend_mix, unshaded;

uniform sampler2D streaks : filter_linear_mipmap, repeat_enable; // бесшовный шум
uniform float amount = 0.0; // 0 — дождя нет, 1 — ливень
uniform float slant = 0.2; // наклон штрихов по ветру
uniform float fall = 0.0; // накопленное время падения, секунды
uniform vec3 tint : source_color = vec3(0.8, 0.86, 0.94);

void fragment() {
	vec2 size = 1.0 / SCREEN_PIXEL_SIZE;
	vec2 uv = vec2(UV.x * size.x / size.y, UV.y);
	float rain = 0.0;
	for (int i = 0; i < 3; i++) {
		float k = 1.0 + float(i) * 0.75;
		// Штрих тонкий (пара точек экрана) и недлинный (десятая часть высоты экрана); дальние слои мельче и медленнее.
		vec2 q = vec2((uv.x + uv.y * slant) * 11.0 * k + float(i) * 0.37, uv.y * 0.3 * k - fall * 0.55 / k + float(i) * 0.21);
		float n = texture(streaks, q).r;
		rain += smoothstep(0.7, 0.78, n) / k;
	}
	COLOR = vec4(tint, clamp(rain, 0.0, 1.0) * amount * 0.2);
}
