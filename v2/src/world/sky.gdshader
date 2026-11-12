// Небо (шаги 1.4 «Свет и небо» и 1.6 «Атмосфера и погода»): плавный переход цвета от горизонта к зениту, дымка
// у горизонта, зарево со стороны солнца, солнце с ореолом, луна, звёзды и облака. Цветами управляет day_light.gd —
// у каждого времени суток свои числа, между временами суток они плавно перетекают; облаками — weather.gd.
//
// Облака — объёмные: луч взгляда идёт сквозь слой облаков шагами, в каждой точке по карте облаков известно,
// есть ли тут облако, и сколько облака между точкой и светилом (сторона к свету светлая, низ и дальняя сторона
// в тени). Края «обгрызает» объёмный шум. Считается это в половинном разрешении (облака мягкие — разницы не видно)
// и только для лучей выше горизонта; дальние облака тают в дымке.
//
// Времени (TIME) здесь нет намеренно: небо с временем движок пересчитывал бы для отражений и рассеянного света
// в каждом кадре.
shader_type sky;
render_mode use_half_res_pass;

#include "res://src/world/clouds.gdshaderinc"
#include "res://src/world/atmosphere.gdshaderinc"

uniform vec3 top_color : source_color = vec3(0.14, 0.34, 0.74);
uniform vec3 horizon_color : source_color = vec3(0.6, 0.76, 0.94);
uniform vec3 ground_color : source_color = vec3(0.3, 0.4, 0.52); // под горизонтом: море за краем света
uniform float curve = 0.12; // как быстро цвет горизонта переходит в цвет зенита (меньше — быстрее)
// Зарево: полоса тёплого цвета у горизонта, ярче в стороне солнца.
uniform vec3 glow_color : source_color = vec3(1.0, 0.6, 0.3);
uniform float glow = 0.0; // сила
uniform float glow_reach = 0.5; // насколько далеко зарево расходится по горизонту от солнца (0 — узко, 1 — на полнеба)
uniform float glow_height = 0.18; // высота полосы зарева над горизонтом
uniform vec3 sun_direction = vec3(-0.78, 0.58, 0.22); // на солнце
uniform vec3 sun_color : source_color = vec3(1.0, 0.95, 0.86);
uniform float sun_size = 0.022; // угловой радиус диска, радианы (настоящее солнце — 0,0047; крупнее — читается с высоты)
uniform float sun_strength = 1.0; // яркость диска и ореола
uniform vec3 moon_direction = vec3(0.6, 0.66, -0.45); // на луну
uniform vec3 moon_color : source_color = vec3(0.86, 0.9, 1.0);
uniform float moon_size = 0.034;
uniform float moon_strength = 0.0;
uniform float stars = 0.0; // 0 — звёзд нет, 1 — ясная ночь
// Облака: где они — общая карта облаков (clouds.gdshaderinc); здесь — их цвет и свет.
uniform vec3 cloud_lit : source_color = vec3(1.0, 0.97, 0.92); // сторона к светилу
uniform vec3 cloud_dark : source_color = vec3(0.55, 0.6, 0.68); // тень и низ
uniform vec3 cloud_light_direction = vec3(-0.78, 0.58, 0.22); // на светило, которое освещает облака (солнце или луна)

const int CLOUD_STEPS = 22; // крупных шагов сквозь слой облаков
const int CLOUD_FINE = 6; // мелких шагов в крупном — там, где рядом есть облако
const float CLOUD_FAR = 60000.0; // дальше облака не считаются: они уже в дымке
const float NOISE_TILE = 1700.0; // плитка объёмного шума, метры

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

float hash12(vec2 p) {
	vec3 q = fract(vec3(p.xyx) * 0.1031);
	q += dot(q, q.yzx + 33.33);
	return fract((q.x + q.y) * q.z);
}

// Плавный шум для пятен на луне.
float value_noise(vec2 p) {
	vec2 cell = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(cell), hash12(cell + vec2(1.0, 0.0)), f.x), mix(hash12(cell + vec2(0.0, 1.0)), hash12(cell + vec2(1.0, 1.0)), f.x), f.y);
}

// Звёзды: небесная сфера режется на клетки, в части клеток — по звезде разной яркости и чуть разного цвета.
// Два слоя: редкие яркие и частые тусклые.
vec3 star_field(vec3 direction) {
	vec3 light = vec3(0.0);
	for (int layer = 0; layer < 2; layer++) {
		float scale = layer == 0 ? 70.0 : 150.0;
		float rare = layer == 0 ? 0.80 : 0.68;
		vec3 p = direction * scale;
		vec3 cell = floor(p);
		float seed = hash13(cell + float(layer) * 19.0);
		if (seed > rare) {
			vec3 offset = (vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 4.1)) - 0.5) * 0.5;
			float away = length(fract(p) - 0.5 - offset);
			float bright = (seed - rare) / (1.0 - rare);
			float size = layer == 0 ? mix(0.10, 0.2, bright) : mix(0.07, 0.13, bright);
			float star = smoothstep(size, 0.0, away);
			vec3 tint = mix(vec3(0.75, 0.84, 1.0), vec3(1.0, 0.9, 0.76), hash13(cell + 7.9));
			light += tint * star * star * (layer == 0 ? mix(0.5, 2.4, bright * bright) : mix(0.2, 0.8, bright));
		}
	}
	return light;
}

// Облака на луче взгляда: цвет (уже умноженный на плотность) и плотность — сколько неба они закрывают.
// Луч идёт сквозь слой облаков крупными шагами (шаг растёт с расстоянием — на экране он одного размера); где рядом
// по размытой карте есть облако, крупный шаг проходится мелкими: так край облака выходит чистым, без «ступенек»,
// а пустое небо почти ничего не стоит.
vec4 clouds(vec3 direction) {
	float up = direction.y;
	float base = cloud_look.x;
	float storm = cloud_look.y;
	float highest = max(CLEAR_DEPTH * cloud_look.z, STORM_DEPTH * storm);
	if (up < 0.012 || highest < 1.0) {
		return vec4(0.0);
	}
	float from = (base - STORM_SAG * storm - cloud_eye.y) / up;
	float to = min((base + highest - cloud_eye.y) / up, CLOUD_FAR);
	if (from >= to) {
		return vec4(0.0);
	}
	vec3 to_light = normalize(cloud_light_direction);
	float ratio = pow(to / from, 1.0 / float(CLOUD_STEPS));
	float toward = max(dot(direction, to_light), 0.0);
	vec3 lit = cloud_lit * (1.0 + 0.3 * toward * toward);
	vec3 sum = vec3(0.0);
	float cover = 0.0;
	float mean_distance = 0.0;
	float at = from;
	for (int i = 0; i < CLOUD_STEPS; i++) {
		float next = at * ratio;
		float stride = next - at;
		vec3 centre = cloud_eye + direction * (at + stride * 0.5);
		float wide = clamp(log2(stride / 47.0) + 1.0, 0.0, 7.0);
		vec2 around = cloud_column(textureLod(cloud_map, (centre.xz - cloud_drift.xy) / CLOUD_TILE, wide).rgb);
		if (around.x > 3.0) {
			float fine = stride / float(CLOUD_FINE);
			float lod = clamp(log2(fine / 47.0) - 0.5, 0.0, 5.0);
			for (int j = 0; j < CLOUD_FINE; j++) {
				float middle = at + fine * (float(j) + 0.5);
				vec3 p = cloud_eye + direction * middle;
				vec3 map = textureLod(cloud_map, (p.xz - cloud_drift.xy) / CLOUD_TILE, lod).rgb;
				vec2 column = cloud_column(map);
				float height = p.y - base;
				if (height <= column.y || height >= column.x) {
					continue;
				}
				// Плотность: в глубине облака полная, к краю сходит на нет, и край «обгрызен» объёмным шумом.
				float inside = min(height - column.y, column.x - height);
				float body = smoothstep(0.0, 380.0, inside);
				float near = 1.0 - smoothstep(16000.0, 40000.0, middle);
				float noise = textureLod(cloud_noise, p / NOISE_TILE + vec3(cloud_drift.z, 0.0, cloud_drift.z * 0.6), lod * 0.6).r;
				float density = clamp((body - noise * mix(0.35, 0.8, near)) * 2.6, 0.0, 1.0);
				if (density <= 0.0) {
					continue;
				}
				// Свет: сколько облака над точкой и сколько — на пути к светилу.
				vec3 q = p + to_light * 300.0;
				vec2 toward_light = cloud_column(textureLod(cloud_map, (q.xz - cloud_drift.xy) / CLOUD_TILE, lod + 1.0).rgb);
				float above = column.x - height;
				float sunward = clamp(toward_light.x - (q.y - base), 0.0, 1400.0);
				float light = exp(-(above * 0.4 + sunward * 0.9) / 460.0);
				float level = clamp((height - column.y) / max(column.x - column.y, 1.0), 0.0, 1.0);
				// Тень: низ темнее верха. У туч шторма низ — весь рисунок: под толстой тучей он почти чёрный,
				// под тонкой светлее (свет пробивается), свисающие клубы светлее впадин между ними.
				float thick = smoothstep(300.0, 2800.0, column.x);
				// Рельеф низа: клубы, что висят ниже, светлее впадин между ними.
				float recess = smoothstep(0.0, 300.0, height - column.y);
				vec3 shade = cloud_dark * mix(0.72, 1.0, level) * mix(1.0, mix(1.6, 0.3, thick) * mix(1.3, 0.72, recess), storm);
				vec3 color = mix(shade, lit, light);
				// Молния подсвечивает тучи вокруг разряда.
				if (flash_at.w > 0.001) {
					vec3 away = p - flash_at.xyz;
					color += FLASH_COLOR * flash_at.w * exp(-dot(away, away) / 5.0e6) * mix(0.25, 0.9, noise);
				}
				float opacity = (1.0 - exp(-density * fine * 0.007)) * (1.0 - cover);
				sum += color * opacity;
				mean_distance += middle * opacity;
				cover += opacity;
			}
		}
		at = next;
		if (cover > 0.985) {
			break;
		}
	}
	if (cover < 0.002) {
		return vec4(0.0);
	}
	// Дальние облака тают в дымке, а у края расчёта сходят на нет.
	mean_distance /= cover;
	vec3 color = sum / cover;
	float veil = 1.0 - exp(-haze_depth(cloud_eye.y, cloud_eye.y + up * mean_distance, mean_distance));
	color = mix(color, horizon_tint(horizon_color, glow_color, glow, glow_reach, normalize(sun_direction), direction), veil);
	cover *= 1.0 - smoothstep(CLOUD_FAR * 0.7, CLOUD_FAR, mean_distance);
	cover *= smoothstep(0.012, 0.03, up);
	return vec4(color * cover, cover);
}

void sky() {
	vec3 direction = normalize(EYEDIR);
	if (AT_HALF_RES_PASS) {
		// Половинное разрешение: облака и завесы дождя перед ними. В отражения и рассеянный свет они не идут
		// (небо шторма и так серое).
		vec4 layer = vec4(0.0);
		if (!AT_CUBEMAP_PASS) {
			layer = clouds(direction);
			// Дождь виден на фоне неба и у самого горизонта — над морем за краем света.
			if (rain_look.x > 0.004 && direction.y > -0.14) {
				float far = direction.y < -1.0e-4 ? max(cloud_eye.y, 2.0) / -direction.y : 1.0e6;
				vec3 mist = horizon_tint(horizon_color, glow_color, glow, glow_reach, normalize(sun_direction), direction);
				layer = under_rain(layer, mist, rain_veil(cloud_eye, direction, far));
			}
		}
		COLOR = layer.rgb;
		ALPHA = layer.a;
	} else {
		float below_horizon = direction.y;
		// Под горизонтом небо продолжается цветом самого горизонта (с заревом).
		float height = max(direction.y, 0.0);
		// Цвет неба: от горизонта к зениту — та же кривая, что была у временного неба шага 1.3.
		float angle = acos(clamp(height, -1.0, 1.0));
		float up = clamp(1.0 - angle / (PI * 0.5), 0.0, 1.0);
		vec3 color = mix(horizon_color, top_color, clamp(1.0 - pow(1.0 - up, 1.0 / curve), 0.0, 1.0));
		// Дымка: полоса у горизонта — чем ниже камера и чем ближе взгляд к горизонту, тем она плотнее.
		color = mix(color, horizon_color, haze_to_sky(cloud_eye.y, height));

		vec3 to_sun = normalize(sun_direction);
		float sun_angle = acos(clamp(dot(direction, to_sun), -1.0, 1.0));
		// Зарево у горизонта: в стороне солнца ярче и выше.
		if (glow > 0.001) {
			vec2 flat_view = normalize(direction.xz + vec2(1.0e-5));
			vec2 flat_sun = normalize(to_sun.xz + vec2(1.0e-5));
			float toward = dot(flat_view, flat_sun) * 0.5 + 0.5;
			float side = pow(toward, mix(6.0, 0.6, glow_reach));
			float band = exp(-height / (glow_height * mix(0.5, 1.4, side)));
			color = mix(color, glow_color, clamp(glow * band * mix(0.25, 1.0, side), 0.0, 1.0));
		}

		// В отражения и рассеянный свет диски и ореолы светил не идут: их отражение в воде рисует сама вода
		// (water.gdshader) — дорожкой и искрами, а не белым пятном на полэкрана. На свет в тенях суши это не влияет:
		// диск и ореол — доли процента света неба.
		float bodies = AT_CUBEMAP_PASS ? 0.0 : 1.0;

		// Звёзды и луна — за дымкой у горизонта их не видно.
		float clear = smoothstep(0.02, 0.22, height);
		vec3 to_moon = normalize(moon_direction);
		float moon_angle = acos(clamp(dot(direction, to_moon), -1.0, 1.0));
		if (stars > 0.001 && below_horizon > 0.0) {
			// У луны небо светлее — слабые звёзды там тонут.
			float veil = 1.0 - moon_strength * exp(-moon_angle * 5.0);
			color += star_field(direction) * stars * clear * veil;
		}
		if (moon_strength > 0.001) {
			// Ореол луны и сам диск: края темнее, по диску — «моря».
			color += moon_color * moon_strength * bodies * (0.22 * exp(-moon_angle * 14.0) + 0.05 * exp(-moon_angle * 3.5)) * clear;
			if (moon_angle < moon_size) {
				vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), to_moon));
				vec3 above = cross(to_moon, right);
				vec2 disc = vec2(dot(direction, right), dot(direction, above)) / sin(moon_size);
				float limb = sqrt(max(1.0 - dot(disc, disc), 0.0));
				float seas = smoothstep(0.42, 0.7, 0.6 * value_noise(disc * 2.3 + 4.0) + 0.4 * value_noise(disc * 5.1 + 9.0));
				float edge = smoothstep(moon_size, moon_size * 0.93, moon_angle);
				vec3 face = moon_color * (0.62 + 0.38 * limb) * mix(1.0, 0.7, seas) * 2.6;
				color = mix(color, face, edge * moon_strength * clear * bodies);
			}
		}

		// Солнце: диск и широкий ореол.
		if (sun_strength > 0.001) {
			float halo = sun_halo(sun_angle, to_sun.y);
			color += sun_color * sun_strength * bodies * halo * smoothstep(-0.08, 0.04, below_horizon);
			float disc_edge = smoothstep(sun_size, sun_size * 0.82, sun_angle);
			color = mix(color, sun_color * 6.0 * sun_strength, disc_edge * bodies * smoothstep(-0.02, 0.01, below_horizon));
		}

		// Под горизонтом — море за краем света: его цвет под той же дымкой, что и у настоящего моря (так край моря
		// не виден), — и он же идёт в отражения и рассеянный свет снизу.
		if (below_horizon < 0.0) {
			float far_sea = max(cloud_eye.y, 2.0) / -below_horizon;
			color = mix(ground_color, color, 1.0 - exp(-haze_depth(cloud_eye.y, 0.0, far_sea)));
		}

		// Облака и завесы дождя — поверх неба и светил.
		if (!AT_CUBEMAP_PASS) {
			vec4 layer = HALF_RES_COLOR;
			color = color * (1.0 - layer.a) + layer.rgb;
		}
		COLOR = color;
	}
}
