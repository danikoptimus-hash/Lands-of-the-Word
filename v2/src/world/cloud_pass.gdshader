// Проход облаков (шаг 1.6, третья переделка — задание владельца 13.11). Рисуется в своё окно (SubViewport в
// weather.gd) в пониженном разрешении, на кадр мира его кладёт cloud_composite.gdshader с лёгким размытием —
// зерно шагов луча в кадр не попадает.
//
// Облака — объём в координатах мира (где и насколько плотно — clouds.gdshaderinc). Луч взгляда идёт сквозь слой
// облаков шагами: крупными там, где по размытой карте пусто, мелкими — где облако есть; начало шагов у каждой
// точки экрана чуть своё. Камера может быть под слоем, в нём и над ним: считается отрезок луча внутри слоя.
//
// Свет. В каждой точке облака — сколько облака на пути к светилу (самозатенение): сторона к светилу светлая,
// дальняя сторона и глубина — в тени; сверху облако получает рассеянный свет неба, снизу — слабый отсвет земли
// и моря. Поэтому на закате облако не одного цвета: бок к солнцу тёплый, остальное — в холодном свете неба,
// низ тёмный. Тонкий край против светила светится насквозь. Дальние облака тают в той же дымке, что земля.
//
// Стратегический вид. Камере над слоем облака не должны закрывать карту: для взгляда вниз они прозрачнее
// (cloud_look.z), а облака рядом с камерой, когда она в слое, редеют — «молока» перед глазами нет.
shader_type spatial;
render_mode unshaded, cull_disabled, depth_test_disabled, depth_draw_never, fog_disabled, shadows_disabled;

#include "res://src/world/clouds.gdshaderinc"
#include "res://src/world/atmosphere.gdshaderinc"

uniform vec3 cloud_lit : source_color = vec3(1.0, 0.97, 0.92); // свет светила на облаке
uniform vec3 cloud_sky : source_color = vec3(0.5, 0.6, 0.75); // рассеянный свет неба — сверху
uniform vec3 cloud_low : source_color = vec3(0.3, 0.33, 0.38); // отсвет земли, моря и горизонта — снизу
uniform vec3 light_direction = vec3(-0.78, 0.58, 0.22); // на светило (солнце или луна)
// Проверочные виды (ключ --cloud-debug=N): 1 — плотность, 2 — высота, 3 — карта облаков, 4 — свет светила
// с самозатенением, 5 — число шагов луча.
uniform int debug = 0;

const int STEPS = 24; // крупных шагов сквозь слой облаков
const int FINE = 6; // мелких шагов в крупном — там, где рядом есть облако
const float FAR = 90000.0; // дальше облака не считаются: они уже в дымке
const vec3 FLASH = vec3(0.62, 0.72, 1.0);

void vertex() {
	POSITION = vec4(VERTEX.xy, 1.0, 1.0);
}

void fragment() {
	vec4 view = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, 1.0, 1.0);
	vec3 direction = normalize((INV_VIEW_MATRIX * vec4(normalize(view.xyz / view.w), 0.0)).xyz);
	vec3 eye = CAMERA_POSITION_WORLD;
	float storm = cloud_look.y;
	vec2 slab = cloud_slab();
	if (abs(direction.y) < 1.0e-4) {
		direction.y = 1.0e-4;
	}
	float t_low = (slab.x - eye.y) / direction.y;
	float t_high = (slab.y - eye.y) / direction.y;
	float from = max(min(t_low, t_high), 40.0);
	float to = min(max(t_low, t_high), FAR);
	if (direction.y < 0.0) {
		to = min(to, eye.y / -direction.y);
	}
	vec3 to_light = normalize(light_direction);
	float toward = dot(direction, to_light);
	float glow_forward = pow(max(toward, 0.0), 6.0);
	// Камера в слое или над ним: облака у самой камеры редеют.
	float inside = smoothstep(slab.x - 300.0, slab.x, eye.y);
	float jitter = 0.5 + 0.46 * (fract(52.9829189 * fract(dot(FRAGCOORD.xy, vec2(0.06711056, 0.00583715)))) - 0.5);
	// Шаг проб к свету — один для всех точек экрана: свой у каждой точки давал зерно на облаке.
	float spread = 1.0;
	vec3 sum = vec3(0.0);
	float cover = 0.0;
	float mean_distance = 0.0;
	float mean_height = 0.0;
	float mean_light = 0.0;
	float taken = 0.0;
	bool was_empty = true;
	if (to > from) {
		float ratio = pow(to / from, 1.0 / float(STEPS));
		float at = from;
		float sigma = mix(0.02, 0.03, storm);
		for (int i = 0; i < STEPS; i++) {
			float next = at * ratio;
			float stride = next - at;
			vec3 centre = eye + direction * (at + stride * 0.5);
			float wide = clamp(log2(stride / 47.0) + 1.0, 0.0, 7.0);
			vec4 around = textureLod(cloud_map, (centre.xz - cloud_drift.xy) / CLOUD_TILE, wide);
			float present = max(around.r * cloud_look.x * (1.0 - smoothstep(0.3, 0.85, storm)), step(0.01, storm));
			if (present > 0.004) {
				float fine = stride / float(FINE);
				for (int j = 0; j < FINE; j++) {
					float middle = at + fine * (float(j) + jitter);
					vec3 p = eye + direction * middle;
					// Грубость чтения карты и шума — по расстоянию, плавно (по номеру шага она менялась скачком,
					// и на сплошных тучах проступали кольца).
					float lod = clamp(log2(middle / 5500.0), 0.0, 5.0);
					float level;
					float density = cloud_density(p, lod, middle < 32000.0, level);
					taken += 1.0;
					density *= mix(1.0, smoothstep(120.0, 1600.0, middle), inside);
					if (density <= 0.003) {
						was_empty = true;
						continue;
					}
					// Вход луча в облако: между прошлой (пустой) пробой и этой — граница облака. Три пробы между ними
					// уточняют, где она: без этого поверхность плотной тучи ложится «террасами» по шагам луча
					// (на тучах шторма это была «гребёнка»).
					float length_here = fine;
					if (was_empty) {
						float entered = 0.0;
						for (int k = 1; k <= 3; k++) {
							float ignored;
							float before = cloud_density(eye + direction * (middle - fine * 0.25 * float(k)), lod, middle < 32000.0, ignored);
							entered += before * mix(1.0, smoothstep(120.0, 1600.0, middle), inside);
						}
						length_here = fine * 0.625 + fine * 0.25 * entered / max(density, 0.05);
						was_empty = false;
					}
					float depth = cloud_light_depth(p, to_light, lod, spread);
					// Свет светила сквозь облако: закон Бера и добавка рассеяния (свет проходит глубже, чем по закону
					// Бера: без неё плотное облако со стороны тени чёрное).
					float sunlight = max(exp(-depth * 0.0105), 0.3 * exp(-depth * 0.0026));
					float edge = 1.0 - density;
					vec3 lit = cloud_lit * sunlight * (0.74 + 2.4 * glow_forward * edge * edge);
					// Рассеянный свет: сверху — небо, снизу — отсвет земли; в глубине облака его меньше.
					vec3 ambient = mix(cloud_low, cloud_sky, smoothstep(0.0, 0.9, level)) * mix(0.6, 1.0, edge);
					vec3 color = lit + ambient;
					if (storm > 0.001) {
						// Тучи шторма не однотонные: где слой тонкий, сквозь него пробивается свет неба — низ светлее;
						// под грозовыми башнями он почти чёрный. Клубы, что висят ниже, светлее впадин между ними.
						float above = cloud_above_depth(p, lod, spread);
						float through = exp(-above * 0.00075);
						float hang = clamp((STORM_BASE - p.y) / STORM_SAG + 0.35, 0.0, 1.0);
						color = mix(color, color * mix(0.45, 1.2, hang) * mix(0.5, 1.0, through) + cloud_sky * 2.6 * through * smoothstep(0.0, 0.5, density),
								storm * (1.0 - smoothstep(0.1, 0.5, level)));
					}
					// Молния подсвечивает тучи вокруг разряда.
					if (flash_at.w > 0.001) {
						vec3 away = p - flash_at.xyz;
						color += FLASH * flash_at.w * exp(-dot(away, away) / 5.0e6) * mix(0.3, 0.9, edge);
					}
					float opacity = (1.0 - exp(-density * length_here * sigma)) * (1.0 - cover);
					sum += color * opacity;
					mean_distance += middle * opacity;
					mean_height += p.y * opacity;
					mean_light += sunlight * opacity;
					cover += opacity;
					if (cover > 0.985) {
						break;
					}
				}
			}
			at = next;
			if (cover > 0.985) {
				break;
			}
		}
	}
	vec4 result = vec4(0.0);
	if (cover >= 0.002) {
		mean_distance /= cover;
		vec3 color = sum / cover;
		// Дальние облака тают в дымке (той же, что у земли и моря), а у края расчёта сходят на нет.
		vec4 mist = haze(eye, eye + direction * mean_distance);
		color = mix(color, mist.rgb, mist.a);
		cover *= 1.0 - smoothstep(FAR * 0.7, FAR, mean_distance);
		result = vec4(color * cover, cover);
	}
	// Перистые облака: тонкие вытянутые пряди на большой высоте — местами, не по всему небу; в шторм их закрывают
	// тучи. Это не объём, а тонкий слой: один срез шума, вытянутый по своему ветру.
	float reach = (CIRRUS_HEIGHT - eye.y) / direction.y;
	if (storm < 0.6 && reach > 0.0 && reach < 130000.0) {
		vec2 q = eye.xz + direction.xz * reach - cloud_drift.xy * 1.7;
		float where = smoothstep(0.56, 0.76, textureLod(cloud_noise, vec3(q.x / 43000.0, 0.77, q.y / 43000.0), 0.0).a);
		if (where > 0.0) {
			vec2 along = vec2(q.x * 0.906 + q.y * 0.423, q.y * 0.906 - q.x * 0.423);
			float lod = clamp(log2(reach / 9000.0), 0.0, 4.0);
			float strand = textureLod(cloud_noise, vec3(along.x / 12000.0, 0.13, along.y / 2300.0), lod).a * 0.6
					+ textureLod(cloud_noise, vec3(along.x / 4100.0, 0.41, along.y / 700.0), lod).a * 0.4;
			float thin = smoothstep(0.5, 0.82, strand) * where * (1.0 - storm / 0.6) * 0.5;
			vec4 mist = haze(eye, eye + direction * reach);
			thin *= (1.0 - smoothstep(70000.0, 130000.0, reach)) * (1.0 - 0.8 * mist.a);
			vec3 color = mix(cloud_lit * (0.8 + 0.5 * glow_forward) + cloud_sky * 0.35, mist.rgb, mist.a);
			if (eye.y < CIRRUS_HEIGHT) {
				// Камера ниже перистых: они за кучевыми.
				result = vec4(result.rgb + color * thin * (1.0 - result.a), 1.0 - (1.0 - result.a) * (1.0 - thin));
			} else {
				result = vec4(color * thin + result.rgb * (1.0 - thin), 1.0 - (1.0 - result.a) * (1.0 - thin));
			}
		}
	}
	// Стратегический вид: камере над слоем облака не закрывают карту.
	float seen = 1.0 - (1.0 - cloud_look.z) * smoothstep(slab.x - 200.0, slab.x + 2500.0, eye.y) * smoothstep(0.0, -0.25, direction.y);
	result *= seen;
	if (debug > 0) {
		vec3 shown = vec3(cover);
		if (debug == 2) {
			float height = cover > 0.002 ? mean_height / cover : 0.0;
			shown = mix(vec3(0.1, 0.2, 0.9), vec3(0.95, 0.2, 0.1), clamp((height - slab.x) / (slab.y - slab.x), 0.0, 1.0)) * step(0.002, cover);
		} else if (debug == 3) {
			float t = direction.y > 0.0 ? (CUMULUS_BASE + 400.0 - eye.y) / direction.y : -1.0;
			shown = t > 0.0 && t < FAR ? textureLod(cloud_map, (eye.xz + direction.xz * t - cloud_drift.xy) / CLOUD_TILE, 0.0).rgb : vec3(0.0);
		} else if (debug == 4) {
			shown = vec3(cover > 0.002 ? mean_light / cover : 0.0);
		} else if (debug == 5) {
			shown = mix(vec3(0.0, 0.3, 0.0), vec3(1.0, 0.1, 0.0), taken / float(STEPS * FINE));
		}
		result = vec4(shown * 4.0, 1.0);
	}
	// Цвет пишется в четверть яркости (окно — восемь бит на канал, а свет облака бывает ярче единицы);
	// cloud_composite.gdshader умножает обратно.
	ALBEDO = result.a > 1.0e-4 ? result.rgb / result.a * 0.25 : vec3(0.0);
	ALPHA = result.a;
}
