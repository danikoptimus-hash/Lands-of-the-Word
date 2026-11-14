// Облака на кадре мира: прямоугольник во весь экран с картинкой прохода облаков (cloud_pass.gdshader).
//
// Глубина кадра шейдеру при сглаживании MSAA недоступна, и она не нужна: вся земля ниже слоя облаков. Камера под
// слоем — облака позади земли (прямоугольник стоит на дальней границе кадра и проходит обычную проверку
// глубины: где есть земля, его не видно). Камера в слое или над ним — облака перед землёй (прямоугольник
// стоит у ближней границы). Это и есть in_front.
//
// Картинка облаков — пониженного разрешения, шаги луча в ней дают зерно: читается девять соседних точек
// почти с равными весами (сдвиг шагов в проходе облаков подобран так, что в любом квадрате 3×3 он разный и
// равномерный) — зерно уходит, а облака и так мягкие.
shader_type spatial;
render_mode unshaded, blend_premul_alpha, cull_disabled, depth_draw_never, fog_disabled, shadows_disabled;

uniform sampler2D clouds : source_color, filter_linear, repeat_disable;
uniform vec2 texel = vec2(0.001); // размер точки картинки облаков в долях экрана
uniform float in_front = 0.0;
uniform float hidden = 0.0; // 1 — облака не показывать (проверка «сверху облака не закрывают карту»)

void vertex() {
	POSITION = vec4(VERTEX.xy, mix(0.0, 0.9999, in_front), 1.0);
}

void fragment() {
	vec2 uv = SCREEN_UV;
	vec2 d = texel;
	vec4 picture = texture(clouds, uv) * 0.16
			+ (texture(clouds, uv + vec2(d.x, 0.0)) + texture(clouds, uv - vec2(d.x, 0.0)) + texture(clouds, uv + vec2(0.0, d.y))
			+ texture(clouds, uv - vec2(0.0, d.y))) * 0.12
			+ (texture(clouds, uv + d) + texture(clouds, uv - d) + texture(clouds, uv + vec2(d.x, -d.y)) + texture(clouds, uv + vec2(-d.x, d.y))) * 0.09;
	ALBEDO = picture.rgb * 4.0 * (1.0 - hidden);
	ALPHA = picture.a * (1.0 - hidden);
}
