// Высота мира в метрах над уровнем моря — одна функция от точки (x, z) и данных партии (гексы и перекрёстки).
// Мир не рисуется картинкой: любая карта партии превращается в рельеф этой функцией.
//
// Вторая редакция (замечания владельца 11.11, «ближе к природе»):
//   • у материка разные уровни — низины и плато; где высокая земля выходит к морю, берег обрывается скалами,
//     где низкая — сходит пляжем и отмелью;
//   • горы — хребты через несколько гексов: гребень идёт по цепочке горных клеток вдоль общего простирания,
//     с перевалом там, где его пересекает дорога;
//   • озёра свободной формы: вытянутая чаша со смещённым центром и одним-двумя плёсами в соседних гексах;
//     соседние водные клетки сливаются в одно озеро с общим уровнем воды.
//   • вокруг главных островов — малые (те же, что на сайте: очертания сняты с их картинок, у каждого свой характер)
//     и дно: широкий светлый шельф с банками, свал и глубина с подводными грядами.
// Сетка гексов остаётся логикой игры. Обязательное одно: города, порты и точки старта стоят на суше, на ровной площадке.
// Числа подобраны в песочнице и принимаются владельцем на шаге 1.2 дорожной карты.

#include "res://src/terrain/hex.gdshaderinc"

uniform vec2 noise_offset; // сдвиг шума от зерна карты: у каждой карты свои детали
uniform int map_seed; // зерно карты: от него зависят случайные числа клеток (вершины, заливы, перевалы)

// Клетки суши у моря (центры): по ним считается расстояние до главных островов вдали от берега.
uniform vec2 coast_cells[160];
uniform int coast_count = 0;
// Малые острова: центр, затем половина стороны картинки (x) и номер картинки (y). Раскладка та же, что на сайте.
uniform vec2 islet_centre[12];
uniform vec2 islet_size[12];
uniform int islet_count = 0;
// Очертания островов: поля расстояний до берега по картинкам сайта, семь полей одно под другим (tools/islet-shapes.py).
uniform sampler2D islet_shapes : filter_linear, repeat_disable;
uniform float shape_extent = 1.3; // поле покрывает квадрат от −extent до extent (в половинах стороны картинки)
uniform float shape_size = 160.0; // сторона одного поля, точек
const float SHAPE_ROWS = 7.0;

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
	vec4 cell = texelFetch(hex_map, t, 0);
	return int((south ? cell.b : cell.g) * 255.0 + 0.5);
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

bool is_wet(ivec2 c) {
	int t = terrain_at(c);
	return t == T_WATER || t == T_OASIS;
}

// Уровень воды клетки. Соседние водные клетки — одно озеро: уровень у них общий, по самой низкой из них
// (смотрим на два шага — хватает цепочки из трёх клеток). Уровни разных озёр по соседству не совпадают:
// уровень идёт ступенями, и к нему добавлена «ячейка» от клетки — вода одного озера не рисуется в чаше другого.
float wet_level(ivec2 c) {
	float low = macro_height(hex_center(c) + noise_offset);
	ivec2 lowest = c;
	for (int k = 0; k < 6; k++) {
		ivec2 c1 = c + SIDES[k];
		if (!is_wet(c1)) {
			continue;
		}
		float m1 = macro_height(hex_center(c1) + noise_offset);
		if (m1 < low) {
			low = m1;
			lowest = c1;
		}
		for (int j = 0; j < 6; j++) {
			ivec2 c2 = c1 + SIDES[j];
			if (!is_wet(c2)) {
				continue;
			}
			float m2 = macro_height(hex_center(c2) + noise_offset);
			if (m2 < low) {
				low = m2;
				lowest = c2;
			}
		}
	}
	float slot = mod(float(lowest.x), 5.0) + 5.0 * mod(float(lowest.y), 5.0); // остаток от отрицательных — через mod
	float raw = max(low - 2.0, 2.0);
	return 2.0 + floor((raw - 2.0) / 3.125) * 3.125 + slot * 0.125;
}

// Озеро — вытянутая чаша со смещённым центром и одним-двумя плёсами за сторонами гекса: чаши поменьше, слитые
// с главной широкой протокой. Пруд оазиса — маленькая чаша. Возвращает высоту с учётом чаши и берегов;
// level — уровень воды или NO_WATER.
float lakes(vec2 p, vec2 n, float d_site, float h, out float level) {
	level = NO_WATER;
	ivec2 c0 = hex_at(p);
	bool found = false;
	for (int dr = -2; dr <= 2; dr++) {
		for (int dq = -2; dq <= 2; dq++) {
			if (abs(dq + dr) <= 2 && is_wet(c0 + ivec2(dq, dr))) {
				found = true;
			}
		}
	}
	if (!found) {
		return h;
	}
	// Берег гуляет: точка сдвигается шумом, прямые протоки становятся извилистыми.
	vec2 pl = p + vec2(
			22.0 * gnoise(n / 150.0 + vec2(60.0, 0.0)) + 8.0 * gnoise(n / 52.0 + vec2(0.0, 33.0)),
			22.0 * gnoise(n / 150.0 + vec2(0.0, 60.0)) + 8.0 * gnoise(n / 52.0 + vec2(33.0, 0.0)));
	float dist = BIG;
	float surface = 0.0;
	float weights = 0.0;
	float level_sum = 0.0;
	float band_sum = 0.0;
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
			float cell_level = wet_level(c);
			vec2 middle = centre + (vec2(cell_rand(c, 21), cell_rand(c, 22)) - 0.5) * (lake ? 44.0 : 36.0);
			float turn = cell_rand(c, 23) * PI;
			float ca = cos(turn);
			float sa = sin(turn);
			float ra = lake ? 52.0 + 20.0 * cell_rand(c, 24) : 20.0 + 6.0 * cell_rand(c, 24);
			float rb = lake ? 36.0 + 14.0 * cell_rand(c, 25) : 15.0 + 5.0 * cell_rand(c, 25);
			vec2 q = pl - middle;
			vec2 u = vec2(q.x * ca + q.y * sa, -q.x * sa + q.y * ca);
			float d = (length(u / vec2(ra, rb)) - 1.0) * rb;
			if (lake) {
				// Плёсов не больше двух: озеро остаётся цельным, а не «звездой». К соседнему озеру протока есть всегда.
				int k1 = int(floor(cell_rand(c, 30) * 6.0));
				int k2 = (k1 + 2 + int(floor(cell_rand(c, 31) * 3.0))) % 6;
				bool second = cell_rand(c, 32) < 0.55;
				for (int k = 0; k < 6; k++) {
					int tn = terrain_at(c + SIDES[k]);
					bool join = tn == T_WATER;
					bool arm = (tn == T_DESERT || tn == T_HILLS || tn == T_MEADOW) && (k == k1 || (k == k2 && second));
					if (!arm && !join) {
						continue;
					}
					vec2 v = normalize(hex_center(SIDES[k]));
					float side = join ? 0.0 : (cell_rand(c, 40 + k) - 0.5) * 80.0;
					float reach = join ? HEX_APOTHEM : HEX_APOTHEM - 14.0 + 52.0 * cell_rand(c, 50 + k);
					vec2 tip_point = centre + v * reach + vec2(-v.y, v.x) * side;
					vec2 dt = segment_distance(pl, middle, tip_point);
					float bulb = join ? 30.0 : 26.0 + 20.0 * cell_rand(c, 70 + k);
					float neck = join ? 30.0 : bulb * (0.55 + 0.3 * cell_rand(c, 60 + k));
					d = smooth_min(d, dt.x - mix(neck, bulb, smoothstep(0.5, 1.0, dt.y)), 34.0);
				}
			}
			if (d < dist) {
				dist = d;
				surface = cell_level;
			}
			// Между двумя близкими озёрами берег подстраивается под оба уровня плавно.
			float weight = exp(-clamp(d, 0.0, 200.0) / 14.0);
			weights += weight;
			level_sum += weight * cell_level;
			band_sum += weight * (lake ? 26.0 : 16.0);
		}
	}
	// Перекрёстки и города остаются на суше: вода обходит их пологим мысом, а не круглой выемкой.
	dist = smooth_max(dist, 24.0 - d_site, 18.0);
	dist += 7.0 * gnoise(n / 64.0 + vec2(0.0, 4.0)) + 3.5 * gnoise(n / 27.0 + vec2(8.0, 0.0)) + 1.5 * gnoise(n / 11.0 + vec2(0.0, 5.0));
	float soft = level_sum / max(weights, 1.0e-12);
	float band = band_sum / max(weights, 1.0e-12);
	float depth = min(min(0.22 * max(-dist, 0.0), 6.5), surface - 0.5);
	float target = dist < 0.0 ? soft - depth : soft + 0.1 * dist;
	// Берег не ниже уровня воды только рядом с озером; дальше земля свободна.
	float bank = 1.0 - smoothstep(band, band + 45.0, dist);
	float held = h + (max(h, soft + 1.5) - h) * bank;
	// Высокий берег сходит к воде склоном, а не стеной: чем выше земля над водой, тем шире склон.
	band = min(max(band, 2.4 * (held - soft)), 110.0);
	float carve = 1.0 - smoothstep(0.0, band, dist);
	if (dist < 4.0) {
		level = surface;
	}
	return mix(held, target, carve);
}

// ── Главные острова ─────────────────────────────────────────────────────────

// Суша главных островов: land — высота земли с учётом берега, shore — метров вглубь суши от уреза воды
// (меньше нуля — море), cliff — крутизна берега. p и n — точка после «стягивания» к площадке и точка шума:
// по ним же потом считаются озёра.
void field_surface(vec2 p0, out float shore, out float land, out float cliff, out vec2 p, out vec2 n, out float d_site) {
	float harbor = 1.0 - smoothstep(40.0, 140.0, port_distance(p0));
	p = pinch(p0, d_site);
	n = p + noise_offset;

	// Берег. Искажение слабое: стороны гексов всегда остаются сушей.
	vec2 pc = p + vec2(
			9.0 * gnoise(n / 85.0) + 3.0 * gnoise(n / 31.0 + vec2(5.0, 0.0)),
			9.0 * gnoise(n / 85.0 + vec2(37.0, 0.0)) + 3.0 * gnoise(n / 31.0 + vec2(0.0, 91.0)));
	ivec2 c0 = hex_at(pc);
	int t0 = terrain_at(c0);
	float d_sea = BIG;
	float d_hard = BIG;
	float d_soft = BIG;
	// Три кольца клеток: заполнение входящих углов берега смотрит на сушу до 345 м, и клетка не должна
	// появляться в расчёте скачком (иначе на дне остаётся ступенька).
	for (int dr = -3; dr <= 3; dr++) {
		for (int dq = -3; dq <= 3; dq++) {
			if (abs(dq + dr) > 3) {
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
				lake_height += influence * (wet_level(c) + 2.0);
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
	// Суша не опускается ниже двух метров над морем: иначе в низине посреди острова проступило бы море.
	h = smooth_max(h, 2.0, 3.0);

	// Берег: высокая земля обрывается скалами, низкая сходит пляжем. Часть высоких берегов всё же пологая.
	float bulge = noise01(n / 520.0 + vec2(71.0, 13.0));
	// Обрыв — там, где высок сам материк (а не отдельный холм или бархан): берег рвётся скалой на сотни метров подряд.
	cliff = smoothstep(12.0, 30.0, ground) * smoothstep(0.3, 0.55, noise01(n / 260.0 + vec2(31.0, 9.0)))
			* (1.0 - harbor) * (1.0 - smoothstep(120.0, 200.0, coast));
	float offset = smooth_max(30.0 + 16.0 * cliff,
			34.0 + 110.0 * bulge * bulge + 18.0 * gnoise(n / 170.0 + vec2(0.0, 50.0)) + 6.0 * gnoise(n / 60.0 + vec2(9.0, 0.0)), 12.0);
	shore = offset - coast;
	land = h;
	if (shore > 0.0) {
		// Мысы и бухточки вдоль обрыва. У самой воды они сходят на нет: суша начинается от уреза без ступеньки.
		float rugged = cliff * (10.0 * gnoise(n / 70.0 + vec2(0.0, 3.0)) + 4.0 * gnoise(n / 27.0 + vec2(7.0, 0.0)))
				* smoothstep(0.0, 12.0, shore);
		float beach = 2.4 * (1.0 - exp(-shore / 14.0));
		// Обрыв крутой, но не стена: чем выше берег, тем шире склон (гора сходит в море градусов под шестьдесят).
		float foot = 4.0 - cliff;
		land = mix(beach, h, smoothstep(foot, max(95.0 - 77.0 * cliff, foot + 0.6 * h), shore + rugged));
	}
}

// ── Дно ─────────────────────────────────────────────────────────────────────

// Расстояние до ближайшей клетки суши главных островов (для точек моря — точное).
float far_coast(vec2 p) {
	float best = BIG;
	for (int i = 0; i < coast_count; i++) {
		best = min(best, sd_hex(p - coast_cells[i]));
	}
	return best;
}

// Дно у самого берега: у пляжа — отмель, у обрыва — сразу глубоко. Дальше 200 м от берега одинаково.
float near_shore(float out_sea, float cliff, vec2 n) {
	float shelf0 = (38.0 + 50.0 * noise01(n / 380.0 + vec2(31.7, 8.0))) * (1.0 - 0.6 * cliff);
	float edge = min(out_sea, 12.0);
	return 0.1 * edge + 0.5 * cliff * edge * (1.0 - smoothstep(60.0, 200.0, out_sea)) + 3.5 * smoothstep(0.0, 0.6 * shelf0, out_sea);
}

// Шельф, свал и глубина: d — расстояние от берега. Шельф светлый и широкий, с банками; за ним дно уходит
// на глубину с подводными грядами и впадинами. Далеко от суши дно ровное.
float shelf_slope(float d, vec2 n) {
	float width = 560.0 + 220.0 * gnoise(n / 700.0 + vec2(5.0, 9.0));
	float shelf = (9.0 + 3.0 * fbm(n / 260.0 + vec2(40.0, 2.0), 2)) * smoothstep(30.0, 420.0, d);
	float shoal = 4.5 * pow(max(gnoise(n / 170.0 + vec2(8.0, 60.0)), 0.0), 1.5) * smoothstep(60.0, 220.0, d)
			* (1.0 - smoothstep(width - 120.0, width + 60.0, d));
	float relief = 26.0 * fbm(n / 1500.0 + vec2(3.0, 3.0), 3) - 20.0 * (ridged(n / 900.0 + vec2(17.0, 5.0), 3) - 0.45);
	float deep = 70.0 + relief * (1.0 - smoothstep(1500.0, 2400.0, d));
	return shelf - shoal + max(deep - 16.0, 10.0) * smoothstep(width, width + 420.0, d);
}

// ── Малые острова ───────────────────────────────────────────────────────────

// Расстояние до берега островка по его картинке, в половинах стороны картинки (внутри острова — отрицательное).
float shape_distance(int picture, vec2 uv) {
	vec2 q = clamp(uv, vec2(-shape_extent), vec2(shape_extent));
	vec2 t = clamp(q / shape_extent * 0.5 + 0.5, vec2(0.5 / shape_size), vec2(1.0 - 0.5 / shape_size));
	float row = float(picture - 1);
	return textureLod(islet_shapes, vec2(t.x, (row + t.y) / SHAPE_ROWS), 0.0).r + length(uv - q);
}

// Скала или бугор на островке: вершина в точке c картинки, радиус в половинах стороны картинки.
float bump(vec2 uv, vec2 c, float radius, float height) {
	return height * pow(max(1.0 - length(uv - c) / radius, 0.0), 1.5);
}

float sd_box(vec2 q, vec2 half_size) {
	vec2 d = abs(q) - half_size;
	return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0);
}

// Характер островка по его картинке на сайте. uv — место на картинке (от −1 до 1, y вниз — на юг), sd — расстояние
// до очертания в метрах. s_land — расстояние до суши, h — высота земли без берега, cliff — крутизна берега,
// wide — ширина пляжного склона, narrow — во сколько раз уже шельф, cap — предел глубины (лагуна),
// level — уровень воды пруда.
void islet_kind(int picture, vec2 uv, float sd, float r, vec2 n,
		out float s_land, out float h, out float cliff, out float wide, out float narrow, out float cap, out float level) {
	float inland = -sd;
	float rocky = 0.75 + 0.5 * ridged(n / 80.0 + vec2(2.0, 6.0), 4);
	float roll = fbm(n / 75.0 + vec2(9.0, 1.0), 3);
	s_land = sd;
	cliff = 0.0;
	wide = 45.0;
	narrow = 2.2;
	cap = BIG;
	level = NO_WATER;
	if (picture == 1) {
		// Зелёный остров-звезда: луга и рощи, несколько скальных выходов.
		h = 3.5 + 6.5 * smoothstep(0.0, 110.0, inland) + 2.2 * roll * smoothstep(10.0, 60.0, inland);
		float rocks = bump(uv, vec2(0.375, -0.52), 0.27, 34.0) + bump(uv, vec2(-0.84, -0.46), 0.13, 13.0)
				+ bump(uv, vec2(-0.36, 0.30), 0.20, 19.0) + bump(uv, vec2(-0.25, -0.12), 0.10, 8.0) + bump(uv, vec2(0.14, 0.05), 0.10, 8.0);
		h += rocks * rocky;
	} else if (picture == 6) {
		// Зелёный остров с ручьём и прудом: ручей бежит с горки в пруд и из пруда к морю.
		h = 3.5 + 7.0 * smoothstep(0.0, 110.0, inland) + 2.2 * roll * smoothstep(10.0, 60.0, inland);
		float rocks = bump(uv, vec2(-0.46, -0.66), 0.22, 30.0) + bump(uv, vec2(0.50, 0.14), 0.13, 15.0)
				+ bump(uv, vec2(0.36, -0.22), 0.09, 8.0) + bump(uv, vec2(-0.30, 0.30), 0.08, 6.0);
		h += rocks * rocky;
		float stream = segment_distance(uv, vec2(-0.36, -0.50), vec2(-0.12, -0.20)).x;
		stream = min(stream, segment_distance(uv, vec2(-0.12, -0.20), vec2(0.07, 0.11)).x);
		stream = min(stream, segment_distance(uv, vec2(0.07, 0.11), vec2(0.29, 0.39)).x);
		stream = min(stream, segment_distance(uv, vec2(0.29, 0.39), vec2(0.42, 0.58)).x);
		h = max(h - 1.6 * (1.0 - smoothstep(0.0, 9.0, stream * r)), 1.2);
		float water = 8.0;
		float dp = (length(uv - vec2(0.07, 0.11)) - 0.14) * r + 5.0 * gnoise(n / 30.0 + vec2(4.0, 0.0));
		float held = h + (max(h, water + 1.2) - h) * (1.0 - smoothstep(16.0, 50.0, dp));
		float basin = dp < 0.0 ? water - min(0.22 * max(-dp, 0.0), 3.0) : water + 0.1 * dp;
		h = mix(held, basin, 1.0 - smoothstep(0.0, 16.0, dp));
		if (dp < 4.0) {
			level = water;
		}
	} else if (picture == 2) {
		// Вытянутый сухой остров со скалистым хребтом вдоль него.
		h = 3.0 + 5.0 * smoothstep(0.0, 70.0, inland) + 1.5 * roll;
		vec2 dt = segment_distance(uv, vec2(0.60, -0.65), vec2(0.25, -0.10));
		float ridge = mix(46.0, 56.0, dt.y) * pow(max(1.0 - dt.x / 0.30, 0.0), 1.5);
		dt = segment_distance(uv, vec2(0.25, -0.10), vec2(-0.15, 0.45));
		ridge = max(ridge, mix(56.0, 40.0, dt.y) * pow(max(1.0 - dt.x / 0.30, 0.0), 1.5));
		dt = segment_distance(uv, vec2(-0.15, 0.45), vec2(-0.50, 0.50));
		ridge = max(ridge, mix(40.0, 20.0, dt.y) * pow(max(1.0 - dt.x / 0.30, 0.0), 1.5));
		h += ridge * rocky;
		cliff = 0.4 * smoothstep(0.35, 0.6, noise01(n / 150.0 + vec2(2.0, 0.0)));
		wide = 35.0;
	} else if (picture == 5) {
		// Скалистый остров-столовая гора: уступы один над другим, наверху вершина; берег — обрывы.
		float t = inland / (0.40 * r) + 0.12 * fbm(n / 60.0 + vec2(5.0, 7.0), 2);
		float raw = 5.0 + 40.0 * smoothstep(0.0, 1.0, t);
		float g = raw / 11.0;
		float whole = floor(g);
		float stepped = (whole + smoothstep(0.35, 0.65, g - whole)) * 11.0;
		h = mix(raw, stepped, 0.72) + bump(uv, vec2(0.43, -0.32), 0.22, 16.0) * rocky;
		cliff = 0.15 + 0.85 * smoothstep(0.3, 0.6, noise01(n / 140.0 + vec2(12.0, 3.0)));
		wide = 30.0;
	} else if (picture == 3) {
		// Полумесяц с лагуной: суша — узкая дуга, внутри мелкая лагуна, от моря её отделяет подводная гряда.
		float lagoon = (0.68 - length(uv - vec2(0.03, -0.03))) * r + 5.0 * gnoise(n / 35.0 + vec2(6.0, 0.0));
		s_land = max(sd, lagoon);
		h = 2.2 + 4.5 * smoothstep(0.0, 28.0, -s_land) + 1.0 * fbm(n / 40.0 + vec2(2.0, 0.0), 2);
		float bed = 0.6 + 1.9 * smoothstep(0.0, 30.0, min(s_land, -sd)) - 1.2 * smoothstep(0.5, 0.8, gnoise(n / 16.0 + vec2(1.0, 8.0)));
		bed = (sd < 0.0 && lagoon > 0.0) ? max(bed, 0.25) : BIG;
		float bar = lagoon > 0.0 ? 0.7 + 0.12 * abs(sd) + 40.0 * (1.0 - smoothstep(0.0, 25.0, lagoon)) : BIG;
		cap = min(bed, bar);
		wide = 18.0;
	} else if (picture == 4) {
		// Песчаная банка: низкая, пологая, с рощицей; вокруг широкая отмель.
		h = 1.0 + 2.0 * smoothstep(0.0, 30.0, inland) + 0.5 * fbm(n / 30.0 + vec2(3.0, 3.0), 2)
				+ bump(uv, vec2(-0.07, 0.0), 0.12, 1.4) + bump(uv, vec2(0.60, -0.25), 0.05, 3.5);
		wide = 20.0;
		narrow = 1.3;
	} else {
		// Каменоломня: каменистое плато, к северу оно поднимается холмом со скалами; в склон холма врезан
		// карьер уступами, открытый к югу на плато; на юго-востоке у воды ровная площадка под причал.
		h = 4.0 + 8.0 * smoothstep(0.0, 60.0, inland) + 1.2 * roll + bump(uv, vec2(-0.14, -0.34), 0.62, 21.0);
		float rocks = bump(uv, vec2(0.25, -0.82), 0.30, 26.0) + bump(uv, vec2(-0.25, -0.72), 0.26, 20.0)
				+ bump(uv, vec2(0.02, -0.62), 0.22, 18.0) + bump(uv, vec2(-0.66, -0.36), 0.20, 15.0)
				+ bump(uv, vec2(0.62, -0.30), 0.20, 13.0) + bump(uv, vec2(-0.56, 0.36), 0.16, 11.0)
				+ bump(uv, vec2(0.47, 0.25), 0.14, 9.0) + bump(uv, vec2(-0.20, 0.76), 0.14, 9.0);
		h += rocks * rocky;
		vec2 pit_centre = vec2(-0.14, -0.16);
		float pit = min(sd_box(uv - pit_centre, vec2(0.15, 0.12)), sd_box(uv - pit_centre - vec2(0.0, 0.20), vec2(0.11, 0.20))) * r;
		float x = max(pit, 0.0) / (0.042 * r);
		float whole = floor(x);
		float stairs = whole + smoothstep(0.7, 1.0, x - whole);
		h = min(h, 11.5 + 5.0 * stairs);
		float pier = length(uv - vec2(0.50, 0.71)) * r;
		h = mix(1.8, h, smoothstep(14.0, 40.0, pier));
		cliff = 0.75 * (1.0 - smoothstep(-0.45, -0.05, uv.y)) * smoothstep(0.3, 0.55, noise01(n / 130.0 + vec2(4.0, 4.0)));
		wide = 40.0;
	}
}

// Малые острова в точке: s — расстояние до суши ближайшего (меньше нуля — суша), land — её высота,
// cliff — крутизна берега, shelf — расстояние «для шельфа», cap — предел глубины, level — уровень воды пруда.
void islet_surface(vec2 p, vec2 n, out float s, out float land, out float cliff, out float shelf, out float cap, out float level) {
	s = BIG;
	land = 0.0;
	cliff = 0.0;
	shelf = BIG;
	cap = BIG;
	level = NO_WATER;
	for (int i = 0; i < islet_count; i++) {
		vec2 centre = islet_centre[i];
		float r = islet_size[i].x;
		float away = length(p - centre);
		if (away > 1.45 * r + 1100.0) {
			continue;
		}
		int picture = int(islet_size[i].y + 0.5);
		// Берег гуляет: мелкие мысы и бухточки поверх очертания с картинки.
		float shift = 3.0 * float(i);
		vec2 w = p + vec2(
				6.0 * gnoise(n / 55.0 + vec2(shift, 0.0)) + 2.5 * gnoise(n / 21.0 + vec2(0.0, shift)),
				6.0 * gnoise(n / 55.0 + vec2(0.0, shift + 50.0)) + 2.5 * gnoise(n / 21.0 + vec2(shift + 50.0, 0.0)));
		vec2 uv = (w - centre) / r;
		float sd = max(shape_distance(picture, uv) * r, away - 1.05 * r);
		float s_land;
		float h;
		float c;
		float wide;
		float narrow;
		float cap_here;
		float level_here;
		islet_kind(picture, uv, sd, r, n, s_land, h, c, wide, narrow, cap_here, level_here);
		h = max(h, 1.0);
		float shore = -s_land;
		float rugged = c * (8.0 * gnoise(n / 60.0 + vec2(0.0, 3.0)) + 3.0 * gnoise(n / 24.0 + vec2(7.0, 0.0))) * smoothstep(0.0, 12.0, shore);
		float foot = 4.0 - c;
		float ramp = smoothstep(foot, max(wide - (wide - 18.0) * c, foot + 0.6 * h), shore + rugged);
		float beach = 2.4 * (1.0 - exp(-max(shore, 0.0) / 14.0));
		if (s_land < s) {
			s = s_land;
			land = beach + (h - beach) * ramp;
			cliff = c;
		}
		shelf = min(shelf, max(s_land, 0.0) * narrow);
		cap = min(cap, cap_here);
		if (level_here > -900.0) {
			level = level_here;
		}
	}
}

// ── Поверхность мира ────────────────────────────────────────────────────────

// x — высота земли (дна), y — уровень воды озера в этой точке или NO_WATER.
vec2 world_surface(vec2 p0) {
	vec2 n0 = p0 + noise_offset;
	float d_far = far_coast(p0);
	// Главные острова считаем только на их клетках и рядом с ними: дальше 380 м от берега это открытое море.
	// (Расстояние до берега считается по береговым клеткам, поэтому середина острова проверяется отдельно.)
	float s_field = 250.0;
	float land_field = 0.0;
	float cliff_field = 0.0;
	vec2 p = p0;
	vec2 n = n0;
	float d_site = BIG;
	bool near_field = d_far < 380.0 || terrain_at(hex_at(p0)) != T_SEA;
	if (near_field) {
		float shore;
		field_surface(p0, shore, land_field, cliff_field, p, n, d_site);
		s_field = -shore;
	}
	float s_islet;
	float land_islet;
	float cliff_islet;
	float shelf_islet;
	float cap;
	float level;
	islet_surface(p0, n0, s_islet, land_islet, cliff_islet, shelf_islet, cap, level);

	float s = min(s_field, s_islet);
	float cliff = s_field <= s_islet ? cliff_field : cliff_islet;
	float out_sea = max(s, 0.0);
	// Расстояние «для шельфа»: у главных островов он широкий, у малых — уже; между близкими островами шельфы сливаются.
	float d_field = mix(max(s_field, 0.0), max(d_far - 60.0, 0.0), smoothstep(200.0, 330.0, d_far));
	float d_shelf = smooth_min(d_field, shelf_islet, 160.0);
	float depth = near_shore(out_sea, cliff, n0) + shelf_slope(d_shelf, n0) * smoothstep(0.0, 60.0, out_sea);
	float h = s_field < 0.0 ? land_field : (s_islet < 0.0 ? land_islet : -min(depth, cap));

	if (near_field) {
		float lake_level;
		h = lakes(p, n, d_site, h, lake_level);
		if (lake_level > -900.0) {
			level = lake_level;
		}
	}
	return vec2(h, level);
}
