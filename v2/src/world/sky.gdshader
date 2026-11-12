// Небо (шаги 1.4 «Свет и небо» и 1.6 «Атмосфера и погода»): плавный переход цвета от горизонта к зениту, дымка
// у горизонта, зарево со стороны солнца, солнце с ореолом, луна, звёзды и облака. Цветами управляет day_light.gd —
// у каждого времени суток свои числа, между временами суток они плавно перетекают; облаками — weather.gd.
//
// Облака — объёмные: луч взгляда идёт сквозь слой облаков шагами. Карта облаков говорит, где облако есть
// и какой у него потолок; форму — округлые клубы разного размера — лепит объёмный шум; свет в каждой точке —
// по тому, сколько облака между ней и светилом. Считается это в половинном разрешении (облака мягкие — разницы
// не видно) и только для лучей выше горизонта; дальние облака тают в дымке.
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
const int CLOUD_FINE = 7; // мелких шагов в крупном — там, где рядом есть облако
const float CLOUD_FAR = 60000.0; // дальше облака не считаются: они уже в дымке
const float NOISE_TILE = 3400.0; // плитка объёмного шума для формы облака, метры: клубы от 200 до 850 м
const float DETAIL_TILE = 870.0; // и для мелких клочьев по краю
const float STORM_SWELL = 520.0; // настолько низ туч шторма провисает валами, метры
const float CIRRUS_ABOVE = 5200.0; // перистые облака — настолько выше низа кучевых, метры

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

// Плотность облака в точке мира, 0…1; level — высота точки внутри столба облака, 0 (низ) … 1 (потолок).
// Форму лепит объёмный шум — округлые клубы разного размера: в середине облачной массы шум заполняет её почти
// целиком, к краю («присутствие» падает) от него остаются отдельные клубы и клочья. Низ мягкий (плотность
// набирается первыми десятками метров), верх закруглён. fine — «обгрызть» край мелким шумом.
float cloud_density(vec3 p, float base, float lod, bool fine, out vec2 place) {
	vec3 column = cloud_column(textureLod(cloud_map, (p.xz - cloud_drift.xy) / CLOUD_TILE, lod));
	vec3 drift = vec3(cloud_drift.z, 0.0, cloud_drift.z * 0.6);
	// Низ туч шторма неровный: провисает крупными валами в сотни метров.
	if (cloud_look.y > 0.001) {
		column.y -= cloud_look.y * STORM_SWELL * textureLod(cloud_noise, vec3(p.x / 5600.0, 0.31, p.z / 5600.0) + drift, 0.0).r;
	}
	float level = (p.y - base - column.y) / max(column.x - column.y, 1.0);
	place = vec2(level, column.x);
	if (column.z <= 0.004 || level <= 0.0 || level >= 1.0) {
		return 0.0;
	}
	// Низ мягкий, верх тупой и округлый (острых вершин у облаков не бывает).
	// У туч шторма низ плотный и очерченный: по нему и читается их рельеф.
	float profile = smoothstep(0.0, mix(0.14, 0.04, cloud_look.y), level) * smoothstep(1.0, 0.64, level);
	float shape = textureLod(cloud_noise, p / NOISE_TILE + drift, lod * 0.6).r;
	float density = clamp((shape * profile * 1.9 - (1.0 - column.z)) / max(column.z, 0.08), 0.0, 1.0);
	if (fine && density > 0.0) {
		float detail = textureLod(cloud_noise, p / DETAIL_TILE - drift * 2.0, lod * 0.6).r;
		density = clamp((density - detail * 0.34 * (1.0 - density)) * 1.25, 0.0, 1.0);
	}
	return density;
}

// Облака на луче взгляда: цвет (уже умноженный на плотность) и плотность — сколько неба они закрывают.
// Луч идёт сквозь слой облаков крупными шагами (шаг растёт с расстоянием — на экране он одного размера); где рядом
// по размытой карте есть облако, крупный шаг проходится мелкими. Начало луча у каждой точки экрана чуть своё
// (jitter): так шаги не складываются в полосы. Свет в каждой точке — по тому, сколько облака на пути к светилу
// (три пробы): сторона к свету светлая, низ и дальняя сторона в тени.
vec4 clouds(vec3 direction, float jitter) {
	float up = direction.y;
	float base = cloud_look.x;
	float storm = cloud_look.y;
	float highest = max(CLEAR_DEPTH * cloud_look.z, STORM_DEPTH * storm);
	if (up < 0.012 || highest < 1.0) {
		return vec4(0.0);
	}
	float from = (base - (STORM_SAG + STORM_SWELL) * storm - cloud_eye.y) / up;
	float to = min((base + highest - cloud_eye.y) / up, CLOUD_FAR);
	if (from >= to) {
		return vec4(0.0);
	}
	vec3 to_light = normalize(cloud_light_direction);
	float ratio = pow(to / from, 1.0 / float(CLOUD_STEPS));
	float toward = dot(direction, to_light);
	// Рассеяние: к светилу облако светится насквозь (край «серебрится»), от светила — мягкий обратный отсвет.
	float glow_forward = pow(max(toward, 0.0), 6.0);
	vec3 sum = vec3(0.0);
	float cover = 0.0;
	float mean_distance = 0.0;
	float at = from;
	for (int i = 0; i < CLOUD_STEPS; i++) {
		float next = at * ratio;
		float stride = next - at;
		vec3 centre = cloud_eye + direction * (at + stride * 0.5);
		float wide = clamp(log2(stride / 47.0) + 1.0, 0.0, 7.0);
		vec3 around = cloud_column(textureLod(cloud_map, (centre.xz - cloud_drift.xy) / CLOUD_TILE, wide));
		if (around.z > 0.004 && around.x > 3.0) {
			float fine = stride / float(CLOUD_FINE);
			float lod = clamp(log2(fine / 47.0) - 0.5, 0.0, 5.0);
			for (int j = 0; j < CLOUD_FINE; j++) {
				float middle = at + fine * (float(j) + jitter);
				vec3 p = cloud_eye + direction * middle;
				vec2 place;
				float density = cloud_density(p, base, lod, middle < 30000.0, place);
				if (density <= 0.002) {
					continue;
				}
				float level = place.x;
				// Свет: три пробы к светилу — ближняя, средняя и дальняя.
				vec2 ignored;
				float shade = cloud_density(p + to_light * 70.0, base, lod, false, ignored) * 110.0
						+ cloud_density(p + to_light * 220.0, base, lod + 0.5, false, ignored) * 220.0
						+ cloud_density(p + to_light * 560.0, base, lod + 1.0, false, ignored) * 440.0;
				float light = exp(-shade / 190.0);
				// Тонкий край светлее, глубина облака темнее; низ темнее верха.
				float edge = 1.0 - density;
				vec3 ambient = cloud_dark * mix(0.62, 1.05, level) * mix(0.82, 1.0, edge);
				vec3 lit = cloud_lit * (light * (0.74 + 0.5 * glow_forward * edge) + 0.08 * edge);
				vec3 color = ambient + lit;
				if (storm > 0.001) {
					// Тучи шторма: под толстой тучей низ почти чёрный, под тонкой светлее (свет пробивается);
					// клубы, что висят ниже, светлее впадин между ними.
					float thick = smoothstep(300.0, 2800.0, place.y);
					float hang = clamp((base - p.y) / STORM_SWELL + 0.25, 0.0, 1.0);
					color *= mix(1.0, mix(1.25, 0.32, thick) * mix(0.6, 1.3, hang) * mix(1.0, 0.8, edge), storm);
				}
				// Молния подсвечивает тучи вокруг разряда.
				if (flash_at.w > 0.001) {
					vec3 away = p - flash_at.xyz;
					color += FLASH_COLOR * flash_at.w * exp(-dot(away, away) / 5.0e6) * mix(0.3, 0.9, edge);
				}
				float opacity = (1.0 - exp(-density * fine * mix(0.011, 0.03, storm))) * (1.0 - cover);
				sum += color * opacity;
				mean_distance += middle * opacity;
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
	vec3 mist = horizon_tint(horizon_color, glow_color, glow, glow_reach, normalize(sun_direction), direction);
	vec4 result = vec4(0.0);
	if (cover >= 0.002) {
		// Дальние облака тают в дымке, а у края расчёта сходят на нет.
		mean_distance /= cover;
		vec3 color = sum / cover;
		float veil = 1.0 - exp(-haze_depth(cloud_eye.y, cloud_eye.y + up * mean_distance, mean_distance));
		color = mix(color, mist, veil);
		cover *= 1.0 - smoothstep(CLOUD_FAR * 0.7, CLOUD_FAR, mean_distance);
		cover *= smoothstep(0.012, 0.03, up);
		result = vec4(color * cover, cover);
	}
	// Перистые облака: тонкие вытянутые пряди высоко над кучевыми — местами, не по всему небу; в шторм их
	// закрывают тучи. Это не объём, а тонкий слой: один срез шума, вытянутый по своему ветру.
	if (storm < 0.6 && result.a < 0.98) {
		float reach = (base + CIRRUS_ABOVE - cloud_eye.y) / up;
		if (reach < 110000.0) {
			vec2 q = cloud_eye.xz + direction.xz * reach - cloud_drift.xy * 1.7;
			float where = smoothstep(0.5, 0.68, textureLod(cloud_noise, vec3(q.x / 43000.0, 0.77, q.y / 43000.0), 0.0).r);
			if (where > 0.0) {
				vec2 along = vec2(q.x * 0.906 + q.y * 0.423, q.y * 0.906 - q.x * 0.423);
				float lod = clamp(log2(reach / 9000.0), 0.0, 4.0);
				float strand = textureLod(cloud_noise, vec3(along.x / 11000.0, 0.13, along.y / 2100.0), lod).r * 0.62
						+ textureLod(cloud_noise, vec3(along.x / 3700.0, 0.41, along.y / 640.0), lod).r * 0.38;
				float thin = smoothstep(0.46, 0.8, strand) * where * (1.0 - storm / 0.6) * 0.5;
				float veil = 1.0 - exp(-haze_depth(cloud_eye.y, base + CIRRUS_ABOVE, reach));
				thin *= (1.0 - smoothstep(60000.0, 110000.0, reach)) * (1.0 - 0.8 * veil);
				vec3 color = mix(cloud_lit * 0.86 + cloud_dark * 0.3, mist, veil);
				result = vec4(result.rgb + color * thin * (1.0 - result.a), 1.0 - (1.0 - result.a) * (1.0 - thin));
			}
		}
	}
	return result;
}

void sky() {
	vec3 direction = normalize(EYEDIR);
	if (AT_HALF_RES_PASS) {
		// Половинное разрешение: облака и завесы дождя перед ними. В отражения и рассеянный свет они не идут
		// (небо шторма и так серое).
		vec4 layer = vec4(0.0);
		if (!AT_CUBEMAP_PASS) {
			// Сдвиг начала луча — свой у каждой точки экрана (плавный узор без повторов на глаз).
			float jitter = 0.5 + 0.44 * (fract(52.9829189 * fract(dot(FRAGCOORD.xy, vec2(0.06711056, 0.00583715)))) - 0.5);
			layer = clouds(direction, jitter);
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
