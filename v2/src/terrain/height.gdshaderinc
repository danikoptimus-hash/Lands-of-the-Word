// Высота мира в метрах над уровнем моря — одна функция от точки (x, z) и данных партии (гексы и перекрёстки).
// Мир не рисуется картинкой: любая карта партии превращается в рельеф этой функцией.
//
// Вторая редакция (замечания владельца 11.11, «ближе к природе»):
//   • у материка разные уровни — низины и плато; где высокая земля выходит к морю, берег обрывается скалами,
//     где низкая — сходит пляжем и отмелью;
//   • горы — хребты через несколько гексов: гребень идёт по цепочке горных клеток вдоль общего простирания,
//     с перевалом там, где его пересекает дорога;
//   • озёра свободной формы: вытянутая чаша со смещённым центром и заливами в соседние гексы.
// Сетка гексов остаётся логикой игры. Обязательное одно: города, порты и точки старта стоят на суше, на ровной площадке.
// Числа подобраны в песочнице и принимаются владельцем на шаге 1.2 дорожной карты.

#include "res://src/terrain/hex.gdshaderinc"

uniform vec2 noise_offset; // сдвиг шума от зерна карты: у каждой карты свои детали
uniform int map_seed; // зерно карты: от него зависят случайные числа клеток (вершины, заливы, перевалы)

const float FAR = 250.0; // дальше этого расстояния до суши и моря не различаем
const float BIG = 1.0e6;
const float NO_WATER = -999.0; // «здесь нет озера»

// Соседи клетки через стороны, по часовой стрелке от северо-восточной (как в packages/domain/src/coast.ts).
const ivec2 SIDES[6] = ivec2[6](ivec2(1, -1), ivec2(1, 0), ivec2(0, 1), ivec2(-1, 1), ivec2(-1, 0), ivec2(0, -1));
// Шесть углов гекса по часовой от северного: смещение от центра и вершина графа (клетка и признак «южная»),
// как в packages/domain/src/hexgraph.ts.
const vec2 CORNER_OFFSET[6] = vec2[6](vec2(0.0, -100.0), vec2(86.60254, -50.0), vec2(86.60254, 50.0), vec2(0.0, 100.0), vec2(-86.60254, 50.0), vec2(-86.60254, -50.0));
const ivec3 CORNER_SITE[6] = ivec3[6](ivec3(0, 0, 0), ivec3(1, -1, 1), ivec3(0, 1, 0), ivec3(0, 0, 1), ivec3(-1, 1, 0), ivec3(0, -1, 1));

// ── Шум и случайные числа ───────────────────────────────────────────────────

uint pcg(uint v) {
	uint state = v * 747796405u + 2891336453u;
	uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
	return (word >> 22u) ^ word;
}

// Случайное число клетки от 0 до 1: зависит от клетки, зерна карты и «соли» — что именно разыгрываем.
float cell_rand(ivec2 c, int salt) {
	uint s = uint(salt) * 2654435761u + uint(map_seed);
	uint h = pcg(pcg(uint(c.x) + s) + uint(c.y));
	return float(h >> 8u) / 16777216.0;
}

vec2 lattice_gradient(ivec2 p) {
	uint h = pcg(uint(p.x) + pcg(uint(p.y)));
	float a = float(h & 65535u) * (6.28318530718 / 65536.0);
	return vec2(cos(a), sin(a));
}

// Градиентный шум, значения примерно от −1 до 1.
float gnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = p - i;
	ivec2 ip = ivec2(i);
	vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
	float a = dot(lattice_gradient(ip), f);
	float b = dot(lattice_gradient(ip + ivec2(1, 0)), f - vec2(1.0, 0.0));
	float c = dot(lattice_gradient(ip + ivec2(0, 1)), f - vec2(0.0, 1.0));
	float d = dot(lattice_gradient(ip + ivec2(1, 1)), f - vec2(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.41421356;
}

float fbm(vec2 p, int octaves) {
	float sum = 0.0;
	float amp = 0.5;
	float norm = 0.0;
	for (int i = 0; i < octaves; i++) {
		sum += amp * gnoise(p);
		norm += amp;
		p = p * 2.03 + vec2(17.3, -9.1);
		amp *= 0.5;
	}
	return sum / norm;
}

// Гребни: от 0 до 1, острые хребты там, где шум проходит через ноль.
float ridged(vec2 p, int octaves) {
	float sum = 0.0;
	float amp = 0.5;
	float norm = 0.0;
	float prev = 1.0;
	for (int i = 0; i < octaves; i++) {
		float r = 1.0 - abs(gnoise(p));
		r *= r;
		sum += amp * r * prev;
		norm += amp;
		prev = clamp(r * 1.6, 0.0, 1.0);
		p = p * 2.07 + vec2(5.2, 13.7);
		amp *= 0.5;
	}
	return sum / norm;
}

float noise01(vec2 p) {
	return clamp(0.5 + 0.625 * gnoise(p), 0.0, 1.0);
}

float smooth_min(float a, float b, float k) {
	float h = max(k - abs(a - b), 0.0) / k;
	return min(a, b) - h * h * k * 0.25;
}

float smooth_max(float a, float b, float k) {
	return -smooth_min(-a, -b, k);
}

// Соединение двух гребней: мягкий максимум, который не добавляет высоты там, где одного из гребней нет.
float ridge_join(float a, float b) {
	float k = min(10.0, min(a, b));
	float h = max(k - abs(a - b), 0.0) / max(k, 1.0e-6);
	return max(a, b) + h * h * k * 0.25;
}

// Расстояние до отрезка (x) и доля пути вдоль него (y).
vec2 segment_distance(vec2 p, vec2 a, vec2 b) {
	vec2 v = b - a;
	float t = clamp(dot(p - a, v) / max(dot(v, v), 1.0e-6), 0.0, 1.0);
	return vec2(length(p - (a + v * t)), t);
}

// ── Перекрёстки ─────────────────────────────────────────────────────────────

// Что стоит в вершине: 0 — ничего, 1 — развилка, 2 — город, 3 — порт, 4 — точка старта.
// Вершина — северный (зелёный канал) или южный (синий канал) угол клетки.
int site_kind(ivec2 c, bool south) {
	ivec2 t = c - hex_origin;
	if (t.x < 0 || t.y < 0 || t.x >= hex_dims.x || t.y >= hex_dims.y) {
		return 0;
	}
	vec4 texel = texelFetch(hex_map, t, 0);
	return int((south ? texel.b : texel.g) * 255.0 + 0.5);
}

// Площадка: у города, порта и точки старта земля ровная. Точка «стягивается» к вершине, и всё, что считается
// дальше (уровень материка, холмы, горы, берег), берётся в стянутой точке — в круге у вершины высота одна.
// Развилкам площадка не нужна: дорога сама ляжет по склону. d_site — расстояние до ближайшего перекрёстка.
vec2 pinch(vec2 p, out float d_site) {
	ivec2 c = hex_at(p);
	vec2 centre = hex_center(c);
	float best = BIG;
	vec2 site = p;
	int kind = 0;
	for (int i = 0; i < 6; i++) {
		vec2 v = centre + CORNER_OFFSET[i];
		float d = length(p - v);
		int k = site_kind(c + CORNER_SITE[i].xy, CORNER_SITE[i].z == 1);
		if (d < best && k > 0) {
			best = d;
			site = v;
			kind = k;
		}
	}
	if (kind == 0) {
		d_site = BIG;
		return p;
	}
	float s = kind >= 2 ? smoothstep(14.0, 50.0, best) : 1.0;
	d_site = best * s;
	return site + (p - site) * s;
}

// Расстояние до ближайшего порта: у порта берег опускается бухтой.
float port_distance(vec2 p) {
	ivec2 c0 = hex_at(p);
	float best = BIG;
	for (int dr = -2; dr <= 2; dr++) {
		for (int dq = -2; dq <= 2; dq++) {
			if (abs(dq + dr) > 2) {
				continue;
			}
			ivec2 c = c0 + ivec2(dq, dr);
			vec2 centre = hex_center(c);
			if (site_kind(c, false) == 3) {
				best = min(best, length(p - centre + vec2(0.0, HEX_SIZE)));
			}
			if (site_kind(c, true) == 3) {
				best = min(best, length(p - centre - vec2(0.0, HEX_SIZE)));
			}
		}
	}
	return best;
}

// ── Уровень материка ────────────────────────────────────────────────────────

// Крупная форма суши: низины около 5 м и плато до 55–60 м с уступами между ними.
float macro_height(vec2 n) {
	float e0 = noise01(n / 640.0 + vec2(13.0, 7.0));
	return 5.0 + 50.0 * smoothstep(0.34, 0.7, e0) + 9.0 * fbm(n / 260.0 + vec2(3.0, 77.0), 3);
}

// ── Горы ────────────────────────────────────────────────────────────────────

vec2 mountain_peak(ivec2 c) {
	return hex_center(c) + (vec2(cell_rand(c, 11), cell_rand(c, 12)) - 0.5) * 60.0;
}

float mountain_summit(ivec2 c) {
	return 62.0 + 70.0 * pow(cell_rand(c, 13), 1.5);
}

float mountain_width(ivec2 c) {
	return 82.0 + 30.0 * cell_rand(c, 14);
}

// Хребты: у каждой горной клетки своя вершина и короткий гребень вдоль общего простирания; соседние горные
// клетки, лежащие по простиранию, связаны гребнем с седловиной — перевалом. Поперёк простирания клетки не
// связаны: между параллельными хребтами остаются долины.
float mountains(vec2 p, vec2 n) {
	vec2 pm = p + vec2(
			30.0 * gnoise(n / 330.0 + vec2(21.0, 0.0)) + 8.0 * gnoise(n / 90.0 + vec2(0.0, 41.0)),
			30.0 * gnoise(n / 330.0 + vec2(0.0, 77.0)) + 8.0 * gnoise(n / 90.0 + vec2(41.0, 0.0)));
	ivec2 c0 = hex_at(pm);
	float m = 0.0;
	bool found = false;
	for (int dr = -2; dr <= 2; dr++) {
		for (int dq = -2; dq <= 2; dq++) {
			if (abs(dq + dr) > 2) {
				continue;
			}
			ivec2 c = c0 + ivec2(dq, dr);
			if (terrain_at(c) != T_MOUNTAINS) {
				continue;
			}
			found = true;
			vec2 centre = hex_center(c);
			float angle = float(map_seed % 628) / 100.0 + 2.2 * gnoise((centre + noise_offset) / 900.0);
			vec2 strike = vec2(cos(angle), sin(angle));
			vec2 a = mountain_peak(c);
			float ha = mountain_summit(c);
			float wa = mountain_width(c);
			float reach = 18.0 + 30.0 * cell_rand(c, 15);
			vec2 dt = segment_distance(pm, a - strike * reach, a + strike * reach);
			m = ridge_join(m, ha * pow(max(1.0 - dt.x / wa, 0.0), 1.5));

			float best = 0.25;
			ivec2 next = c;
			bool linked = false;
			for (int k = 0; k < 6; k++) {
				vec2 u = hex_center(SIDES[k]);
				float along = dot(u, strike) / length(u);
				if (along > best && terrain_at(c + SIDES[k]) == T_MOUNTAINS) {
					best = along;
					next = c + SIDES[k];
					linked = true;
				}
			}
			if (linked) {
				vec2 b = mountain_peak(next);
				float hb = mountain_summit(next);
				float wb = mountain_width(next);
				dt = segment_distance(pm, a, b);
				float dip = 0.3 + 0.35 * cell_rand(ivec2(c.x + next.x, c.y * 3 + next.y), 16);
				float saddle = (dt.y - 0.5) / 0.2;
				float crest = mix(ha, hb, dt.y) * (1.0 - dip * exp(-saddle * saddle));
				m = ridge_join(m, crest * pow(max(1.0 - dt.x / mix(wa, wb, dt.y), 0.0), 1.5));
			}
		}
	}
	if (!found) {
		return 0.0;
	}
	return m * (0.72 + 0.56 * ridged(n / 170.0 + vec2(3.0, 1.0), 5)) + 6.0 * fbm(n / 40.0, 3) * clamp(m / 40.0, 0.0, 1.0);
}

// ── Озёра и пруды ───────────────────────────────────────────────────────────

// Озеро — вытянутая чаша со смещённым центром; из неё в часть соседних гексов тянутся заливы, сужаясь к концу.
// Пруд оазиса — маленькая чаша. Возвращает высоту с учётом чаши и берегов; level — уровень воды или NO_WATER.
float lakes(vec2 p, vec2 n, float d_site, float h, out float level) {
	level = NO_WATER;
	ivec2 c0 = hex_at(p);
	float dist = BIG;
	float surface = 0.0;
	float band = 26.0;
	bool found = false;
	for (int dr = -2; dr <= 2; dr++) {
		for (int dq = -2; dq <= 2; dq++) {
			if (abs(dq + dr) > 2) {
				continue;
			}
			ivec2 c = c0 + ivec2(dq, dr);
			int t = terrain_at(c);
			if (t != T_WATER && t != T_OASIS) {
				continue;
			}
			bool lake = t == T_WATER;
			vec2 centre = hex_center(c);
			float cell_level = macro_height(centre + noise_offset) - (lake ? 2.5 : 1.0);
			vec2 middle = centre + (vec2(cell_rand(c, 21), cell_rand(c, 22)) - 0.5) * (lake ? 40.0 : 36.0);
			float turn = cell_rand(c, 23) * PI;
			float ca = cos(turn);
			float sa = sin(turn);
			float ra = lake ? 58.0 + 16.0 * cell_rand(c, 24) : 20.0 + 6.0 * cell_rand(c, 24);
			float rb = lake ? 40.0 + 12.0 * cell_rand(c, 25) : 15.0 + 5.0 * cell_rand(c, 25);
			vec2 q = p - middle;
			vec2 u = vec2(q.x * ca + q.y * sa, -q.x * sa + q.y * ca);
			float d = (length(u / vec2(ra, rb)) - 1.0) * rb;
			if (lake) {
				for (int k = 0; k < 6; k++) {
					int tn = terrain_at(c + SIDES[k]);
					bool join = tn == T_WATER;
					bool arm = (tn == T_DESERT || tn == T_HILLS || tn == T_MEADOW) && cell_rand(c, 30 + k) < 0.3;
					if (!arm && !join) {
						continue;
					}
					vec2 v = normalize(hex_center(SIDES[k]));
					float side = join ? 0.0 : (cell_rand(c, 40 + k) - 0.5) * 44.0;
					float reach = join ? HEX_APOTHEM : HEX_APOTHEM + 24.0 + 46.0 * cell_rand(c, 50 + k);
					vec2 tip_point = centre + v * reach + vec2(-v.y, v.x) * side;
					vec2 dt = segment_distance(p, middle, tip_point);
					float wide = 27.0 + 6.0 * cell_rand(c, 60 + k);
					float tip = join ? wide : 15.0 + 14.0 * cell_rand(c, 70 + k);
					d = smooth_min(d, dt.x - mix(wide, tip, dt.y), 24.0);
				}
			}
			if (d < dist) {
				dist = d;
				surface = cell_level;
				band = lake ? 26.0 : 14.0;
				found = true;
			}
		}
	}
	if (!found) {
		return h;
	}
	dist += 11.0 * gnoise(n / 64.0 + vec2(0.0, 4.0)) + 5.0 * gnoise(n / 27.0 + vec2(8.0, 0.0)) + 2.0 * gnoise(n / 11.0 + vec2(0.0, 5.0));
	// Перекрёстки и города остаются на суше.
	dist = smooth_max(dist, 16.0 - d_site, 8.0);
	surface = max(surface, 2.0);
	float depth = min(min(0.22 * max(-dist, 0.0), 6.5), surface - 0.5);
	float target = dist < 0.0 ? surface - depth : surface + 0.1 * dist;
	float carve = 1.0 - smoothstep(0.0, band, dist);
	// Берег не ниже уровня воды только рядом с озером; дальше земля свободна.
	float bank = 1.0 - smoothstep(band, band + 45.0, dist);
	float held = h + (max(h, surface + 1.5) - h) * bank;
	if (dist < 4.0) {
		level = surface;
	}
	return mix(held, target, carve);
}

// ── Поверхность мира ────────────────────────────────────────────────────────

// x — высота земли (дна), y — уровень воды озера в этой точке или NO_WATER.
vec2 world_surface(vec2 p0) {
	float harbor = 1.0 - smoothstep(40.0, 140.0, port_distance(p0));
	float d_site;
	vec2 p = pinch(p0, d_site);
	vec2 n = p + noise_offset;

	// Берег. Искажение слабое: стороны гексов всегда остаются сушей.
	vec2 pc = p + vec2(
			9.0 * gnoise(n / 85.0) + 3.0 * gnoise(n / 31.0 + vec2(5.0, 0.0)),
			9.0 * gnoise(n / 85.0 + vec2(37.0, 0.0)) + 3.0 * gnoise(n / 31.0 + vec2(0.0, 91.0)));
	ivec2 c0 = hex_at(pc);
	int t0 = terrain_at(c0);
	float d_sea = BIG;
	float d_hard = BIG;
	float d_soft = BIG;
	for (int dr = -2; dr <= 2; dr++) {
		for (int dq = -2; dq <= 2; dq++) {
			if (abs(dq + dr) > 2) {
				continue;
			}
			ivec2 c = c0 + ivec2(dq, dr);
			float s = sd_hex(pc - hex_center(c));
			if (terrain_at(c) == T_SEA) {
				d_sea = min(d_sea, s);
			} else {
				d_hard = min(d_hard, s);
				d_soft = smooth_min(d_soft, s, 95.0);
			}
		}
	}
	d_hard = min(d_hard, FAR);
	d_soft = min(d_soft, FAR);
	// Входящие углы берега заполняются плавно: у самой границы гексов заполнения нет, дальше оно нарастает.
	float fill = max(d_hard - d_soft, 0.0);
	float coast = (t0 != T_SEA) ? -min(d_sea, FAR) : d_hard - fill * smoothstep(0.0, 60.0, d_hard);

	// Местности. Границы областей гуляют сильно: местность не обязана кончаться на стороне гекса.
	vec2 pr = p + vec2(
			24.0 * gnoise(n / 210.0 + vec2(11.0, 0.0)) + 10.0 * gnoise(n / 70.0 + vec2(3.0, 0.0)),
			24.0 * gnoise(n / 210.0 + vec2(0.0, 53.0)) + 10.0 * gnoise(n / 70.0 + vec2(0.0, 17.0)));
	ivec2 c1 = hex_at(pr);
	int t1 = terrain_at(c1);
	float same[7];
	float other[7];
	for (int k = 0; k < 7; k++) {
		same[k] = BIG;
		other[k] = BIG;
	}
	float lake_weight = 0.0;
	float lake_height = 0.0;
	for (int dr = -2; dr <= 2; dr++) {
		for (int dq = -2; dq <= 2; dq++) {
			if (abs(dq + dr) > 2) {
				continue;
			}
			ivec2 c = c1 + ivec2(dq, dr);
			int t = terrain_at(c);
			vec2 centre = hex_center(c);
			float s = sd_hex(pr - centre);
			for (int k = 0; k < 7; k++) {
				if (t == k) {
					same[k] = min(same[k], s);
				} else {
					other[k] = min(other[k], s);
				}
			}
			if (t == T_WATER || t == T_OASIS) {
				// Земля вокруг озера выравнивается по его уровню: озеро лежит в своей котловине.
				float influence = 1.0 - smoothstep(70.0, 220.0, length(p - centre) + 30.0 * gnoise(n / 120.0 + vec2(15.0, 0.0)));
				lake_weight += influence;
				lake_height += influence * macro_height(centre + noise_offset);
			}
		}
	}
	// Знаковое расстояние до границы «своей» области каждой местности: внутри положительное.
	float inside[7];
	for (int k = 0; k < 7; k++) {
		inside[k] = (t1 == k) ? min(other[k], FAR) : -min(same[k], FAR);
	}

	float ground = macro_height(n);
	if (lake_weight > 0.0) {
		ground += (lake_height / max(lake_weight, 1.0e-6) - ground) * min(lake_weight, 1.0);
	}
	ground += (4.5 - ground) * 0.9 * harbor;

	float w_desert = smoothstep(-30.0, 30.0, inside[T_DESERT]);
	float w_hills = smoothstep(-30.0, 30.0, inside[T_HILLS]);
	float w_meadow = smoothstep(-30.0, 30.0, inside[T_MEADOW]);
	float w_mountains = smoothstep(-30.0, 30.0, inside[T_MOUNTAINS]);
	float w_water = smoothstep(-30.0, 30.0, inside[T_WATER]);
	float w_oasis = smoothstep(-30.0, 30.0, inside[T_OASIS]);
	float w_sum = w_desert + w_hills + w_meadow + w_mountains + w_water + w_oasis + 1.0e-5;
	float relief = 0.0;
	if (w_desert > 0.001 || w_oasis > 0.001) {
		// Барханы: вытянутые гряды поперёк ветра, местами гуще, местами реже.
		vec2 dw = n + 26.0 * vec2(gnoise(n / 190.0 + vec2(0.0, 7.0)), gnoise(n / 190.0 + vec2(3.0, 0.0)));
		float ridge = 1.0 - abs(gnoise(vec2((dw.x * 0.94 + dw.y * 0.34) / 46.0, (-dw.x * 0.34 + dw.y * 0.94) / 150.0)));
		float patches = smoothstep(-0.25, 0.35, gnoise(n / 230.0 + vec2(9.0, 4.0)));
		float dunes = -1.0 + 2.0 * fbm(n / 260.0 + vec2(11.0, 0.0), 3) + 5.5 * ridge * ridge * ridge * (0.35 + 0.65 * patches);
		relief += w_desert * dunes * smoothstep(-20.0, 30.0, inside[T_DESERT]) + w_oasis * dunes * 0.3;
	}
	if (w_hills > 0.001) {
		float f = clamp(0.5 + 0.75 * fbm(n / 135.0 + vec2(5.0, 9.0), 4), 0.0, 1.0);
		float hills = 1.5 + 40.0 * pow(f, 1.6) + 5.0 * fbm(n / 62.0 + vec2(13.0, 0.0), 2) + 2.2 * fbm(n / 38.0 + vec2(0.0, 20.0), 3);
		relief += w_hills * hills * smoothstep(-22.0, 72.0, inside[T_HILLS]);
	}
	if (w_meadow + w_water > 0.001) {
		relief += (w_meadow + w_water) * (1.5 * fbm(n / 200.0, 3) + 0.8 * fbm(n / 60.0 + vec2(40.0, 0.0), 2));
	}
	float h = ground + relief / w_sum + mountains(p, n);

	// Берег: высокая земля обрывается скалами, низкая сходит пляжем. Часть высоких берегов всё же пологая.
	float bulge = noise01(n / 520.0 + vec2(71.0, 13.0));
	float cliff = smoothstep(14.0, 32.0, h) * smoothstep(0.3, 0.55, noise01(n / 260.0 + vec2(31.0, 9.0)))
			* (1.0 - harbor) * (1.0 - smoothstep(120.0, 200.0, coast));
	float offset = max(30.0 + 16.0 * cliff,
			34.0 + 110.0 * bulge * bulge + 18.0 * gnoise(n / 170.0 + vec2(0.0, 50.0)) + 6.0 * gnoise(n / 60.0 + vec2(9.0, 0.0)));
	float shore = offset - coast; // > 0 — метров вглубь суши от уреза воды
	if (shore > 0.0) {
		float rugged = cliff * (7.0 * gnoise(n / 28.0 + vec2(0.0, 3.0)) + 3.5 * gnoise(n / 11.0 + vec2(7.0, 0.0)));
		float beach = 2.4 * (1.0 - exp(-shore / 14.0));
		h = mix(beach, h, smoothstep(4.0 - cliff, 95.0 - 77.0 * cliff, shore + rugged));
	} else {
		float out_sea = -shore;
		// У обрыва глубоко сразу, у пляжа — широкая отмель.
		float shelf = (38.0 + 50.0 * noise01(n / 380.0 + vec2(31.7, 8.0))) * (1.0 - 0.6 * cliff);
		float shallow = (0.1 + 0.5 * cliff) * min(out_sea, 12.0) + 3.5 * smoothstep(0.0, 0.6 * shelf, out_sea)
				+ 25.3 * smoothstep(0.5 * shelf, 1.6 * shelf, out_sea);
		h = -max(shallow, 30.0 * smoothstep(150.0, 245.0, coast));
	}

	float level;
	h = lakes(p, n, d_site, h, level);
	return vec2(h, level);
}
