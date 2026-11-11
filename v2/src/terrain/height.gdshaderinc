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
//   • вокруг главных островов — малые, свои (не по картинкам сайта, решение владельца 11.11): горный пик, плато
//     с обрывами, долина с озером, подкова, дюны, шхеры и другие — вылеплены заранее с размывом реками и дождём
//     (tools/islets) и ставятся на карту штампами разного размера; и дно: отмель неровной ширины (с одной стороны острова глубина подходит к берегу, с другой тянется мель),
//     глубина растёт постепенно, без полки и уступа; на отмели банки и протоки, на глубине гряды и впадины.
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
// x — половина стороны штампа острова на карте, м; y — номер острова в каталоге; z — поворот штампа; w — зеркало (±1).
uniform vec4 islet_frame[12];
uniform int islet_count = 0;
// Прямоугольник мира (главные и малые острова): x0, z0, x1, z1. Дальше него подводный рельеф затухает к ровной глубине.
uniform vec4 world_rect = vec4(-1.0e6, -1.0e6, 1.0e6, 1.0e6);
// Каталог малых островов (tools/islets/make.py): острова один под другим, по стороне штампа на остров.
// Штампы: высота (м при опорном размере) и расстояние до берега (в половинах стороны), по 2 байта, старший первым.
uniform sampler2D islet_stamps : filter_nearest, repeat_disable;
// Метки: «камень» (на суше — скалы и крутые склоны, в море — крутизна ближайшего берега) и вода озера.
uniform sampler2D islet_marks : filter_nearest, repeat_disable;
uniform int stamp_size = 512;
uniform float stamp_extent = 1.15; // штамп покрывает квадрат от −extent до extent половин стороны
uniform vec3 stamp_range = vec3(-30.0, 330.0, 1.6); // пределы высоты (м) и расстояния до берега в штампе
// По острову каталога: x — опорная половина стороны, м; y — ширина отмели, м при ней; z — уровень озера, м при ней
// (−999 — озера нет); w — дальше этого расстояния от центра (в половинах стороны) суши нет.
uniform vec4 design_info[16];
// Какая земля на острове каталога (для поверхностей, шаг 1.3): доли пустыни, холмов, лугов и гор.
uniform vec4 design_biome[16];
const int QUARRY_DESIGN = 12;

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

// Уступы: высота «садится» на полки через каждые step метров; strength (0…1) — насколько полки выражены.
// Полки лежат на одних высотах вдоль всего склона — как пласты твёрдой породы.
float ledges(float z, float step_size, float strength) {
	float x = z / step_size;
	float k = floor(x);
	float f = x - k;
	return (k + f + (smoothstep(0.18, 0.82, f) - f) * strength) * step_size;
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
	m = m * (0.72 + 0.56 * ridged(n / 170.0 + vec2(3.0, 1.0), 5)) + 6.0 * fbm(n / 40.0, 3) * clamp(m / 40.0, 0.0, 1.0);
	// Уступы на склонах гор: пласты твёрдой породы выходят полками на одних высотах (замечание владельца 11.11:
	// скалы — геологические образования). Полки прерывистые — участками в сотню метров — и идут не по одной высоте,
	// а волной: ровные полки вокруг каждой вершины читались кольцами, как на слоёном пироге.
	float bench = 0.55 * smoothstep(0.42, 0.78, noise01(n / 95.0 + vec2(13.0, 47.0))) * smoothstep(16.0, 44.0, m);
	float step_size = 14.0 + 8.0 * noise01(n / 420.0 + vec2(3.0, 29.0));
	float shift = 5.0 * gnoise(n / 300.0 + vec2(7.0, 0.0)) + 6.0 * gnoise(n / 85.0 + vec2(0.0, 19.0));
	return ledges(m + shift, step_size, bench) - shift;
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
float lakes(vec2 p, vec2 n, float d_site, float h, out float level, out float nearness) {
	level = NO_WATER;
	nearness = 0.0;
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
	// Близость воды для поверхностей: единица в воде и у уреза, ноль дальше 45 м от берега.
	nearness = 1.0 - smoothstep(0.0, 45.0, dist);
	return mix(held, target, carve);
}

// ── Главные острова ─────────────────────────────────────────────────────────

// Суша главных островов: land — высота земли с учётом берега, shore — метров вглубь суши от уреза воды
// (меньше нуля — море), cliff — крутизна берега. p и n — точка после «стягивания» к площадке и точка шума:
// по ним же потом считаются озёра.
// biome — доли местностей для поверхностей (шаг 1.3): пустыня, холмы, луга (и берега озёр), горы; oasis — оазис.
// На прибрежной полосе за сторонами гексов все доли сходят на нет: там пляж или обрыв.
void field_surface(vec2 p0, out float shore, out float land, out float cliff, out vec2 p, out vec2 n, out float d_site, out vec4 biome, out float oasis) {
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
	float share = 1.0 / max(w_sum, 1.0);
	biome = vec4(w_desert, w_hills, w_meadow + w_water, w_mountains) * share;
	oasis = w_oasis * share;
	float relief = 0.0;
	if (w_desert > 0.001 || w_oasis > 0.001) {
		// Барханы: вытянутые гряды поперёк ветра, местами гуще, местами реже.
		vec2 dw = n + 26.0 * vec2(gnoise(n / 190.0 + vec2(0.0, 7.0)), gnoise(n / 190.0 + vec2(3.0, 0.0)));
		float ridge = 1.0 - abs(gnoise(vec2((dw.x * 0.94 + dw.y * 0.34) / 46.0, (-dw.x * 0.34 + dw.y * 0.94) / 150.0)));
		float patches = smoothstep(-0.25, 0.35, gnoise(n / 230.0 + vec2(9.0, 4.0)));
		// Высокие дюны — только в глубине большой пустыни и не везде (замечание владельца 11.11: не каждая песчаная
		// территория — высокие дюны); по краям и в малых пустынях — ровные пески с невысокими грядами.
		float deep = smoothstep(10.0, 150.0, inside[T_DESERT]);
		float dunes = -1.0 + 2.0 * fbm(n / 260.0 + vec2(11.0, 0.0), 3) + 5.5 * ridge * ridge * ridge * (0.12 + 0.88 * patches) * (0.25 + 0.75 * deep);
		// Мелкие неровности песка: невысокие гряды в десятки метров (на трети песков) и пологие бугры. Гряды
		// извилистые, сходятся и расходятся: ровные параллельные гряды издалека шли по песку «тканью». Частая рябь —
		// дело материала, а не рельефа.
		vec2 rw = dw + 17.0 * vec2(gnoise(n / 71.0 + vec2(31.0, 5.0)), gnoise(n / 71.0 + vec2(2.0, 47.0)));
		float ripple = 1.0 - abs(gnoise(vec2((rw.x * 0.94 + rw.y * 0.34) / 37.0 + 5.0, (-rw.x * 0.34 + rw.y * 0.94) / 83.0)));
		float sand = 0.9 * ripple * ripple * ripple * smoothstep(0.45, 0.8, noise01(n / 140.0 + vec2(23.0, 2.0))) + 0.45 * fbm(n / 27.0 + vec2(4.0, 31.0), 3);
		// Каждая добавка сходит на нет раньше, чем доля своей местности (она кончается в 30 м за стороной гекса):
		// сумма ниже делится на сумму долей, и там, где доля одна и почти нулевая, добавка иначе встала бы ступенькой.
		relief += w_desert * (dunes * smoothstep(-20.0, 30.0, inside[T_DESERT]) + sand * smoothstep(-26.0, 0.0, inside[T_DESERT]))
				+ w_oasis * dunes * 0.3 * smoothstep(-26.0, 0.0, inside[T_OASIS]);
	}
	if (w_hills > 0.001) {
		float f = clamp(0.5 + 0.75 * fbm(n / 135.0 + vec2(5.0, 9.0), 4), 0.0, 1.0);
		float hills = 1.5 + 40.0 * pow(f, 1.6) + 5.0 * fbm(n / 62.0 + vec2(13.0, 0.0), 2) + 2.2 * fbm(n / 38.0 + vec2(0.0, 20.0), 3);
		relief += w_hills * hills * smoothstep(-22.0, 72.0, inside[T_HILLS]);
	}
	if (w_meadow + w_water > 0.001) {
		relief += (w_meadow * smoothstep(-26.0, 0.0, inside[T_MEADOW]) + w_water * smoothstep(-26.0, 0.0, inside[T_WATER]))
				* (1.5 * fbm(n / 200.0, 3) + 0.8 * fbm(n / 60.0 + vec2(40.0, 0.0), 2));
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
		// Мелко — выступы и расщелины самой стены (замечание владельца 11.11: обрыв — не «край поднятой платформы»).
		float rugged = cliff * (10.0 * gnoise(n / 70.0 + vec2(0.0, 3.0)) + 4.0 * gnoise(n / 27.0 + vec2(7.0, 0.0))
				+ 7.0 * (abs(gnoise(n / 23.0 + vec2(3.0, 11.0))) - 0.35) + 1.6 * gnoise(n / 9.0 + vec2(0.0, 5.0)))
				* smoothstep(0.0, 12.0, shore);
		float beach = 2.4 * (1.0 - exp(-shore / 14.0));
		// Обрыв крутой, но не стена: чем выше берег, тем шире склон (гора сходит в море градусов под шестьдесят).
		float foot = 4.0 - cliff;
		float width = max(95.0 - 77.0 * cliff, foot + 0.6 * h);
		land = mix(beach, h, smoothstep(foot, width, shore + rugged));
		// Настоящий обрыв (cliff близко к единице) — геологическое образование, а не гладкая стена: у подножия осыпь
		// (склон около 33°), выше скала с уступами на высотах пластов, кромка скруглена. Полоса обрыва чуть шире
		// прежней, но не доходит до сторон гексов: дороги по берегу остаются на ровном.
		float rocky = smoothstep(0.45, 0.9, cliff);
		if (rocky > 0.0) {
			float wide = max(width, min(width * 1.35, 42.0));
			float u = clamp((shore + rugged - foot) / max(wide - foot, 1.0e-3), 0.0, 1.0);
			float rise = max(h - beach, 0.0);
			float talus = (0.1 + 0.34 * noise01(n / 190.0 + vec2(40.0, 7.0))) * smoothstep(8.0, 20.0, rise);
			float ut = clamp(talus * rise / (0.65 * max(wide - foot, 1.0e-3)), 0.02, 0.55);
			float share = ut * 0.65 * (wide - foot) / max(rise, 1.0e-3); // доля высоты, занятая осыпью
			float v = clamp((u - ut) / (1.0 - ut), 0.0, 1.0);
			float wall = 1.0 - pow(1.0 - v, 1.7); // скала: круто снизу, скруглена у кромки
			// Стык осыпи со стеной скруглён (на пару метров), подножие — без излома.
			float profile = mix(share * u / ut, share + (1.0 - share) * wall, smoothstep(ut - 0.04, ut + 0.04, u)) * smoothstep(0.0, 0.06, u);
			float z = beach + rise * profile;
			float step_size = 9.0 + 5.0 * noise01(n / 330.0 + vec2(17.0, 61.0));
			float bench = (0.3 + 0.5 * noise01(n / 110.0 + vec2(5.0, 29.0))) * smoothstep(0.0, 0.2, v) * (1.0 - smoothstep(0.75, 0.97, v));
			float shift = 6.0 * gnoise(n / 240.0 + vec2(9.0, 0.0));
			z = ledges(z + shift, step_size, bench) - shift;
			z = min(z, max(h, beach));
			land = mix(land, z, rocky);
		}
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

// 1 внутри мира, 0 — дальше 2,2 км от его края (там дно ровное, как за картой глубин в шейдере воды).
float far_fade(vec2 p) {
	vec2 outside = max(max(world_rect.xy - p, p - world_rect.zw), vec2(0.0));
	return 1.0 - smoothstep(600.0, 2200.0, length(outside));
}

// Сдвиг расстояния от берега, м: край отмели выдаётся лопастями и уходит заливами, отмель не повторяет берег.
// Крупно: с одной стороны острова глубина подходит почти к самому берегу, с другой тянется широкая мель на сотни
// метров. Мелко: край отмели не ровный. Сдвиг меняется медленнее самого расстояния (наклон везде меньше единицы),
// поэтому глубина растёт от берега без ям посреди отмели.
float shelf_warp(vec2 n) {
	return 420.0 * gnoise(n / 1300.0 + vec2(12.0, 3.0)) + 30.0 * gnoise(n / 300.0 + vec2(5.0, 21.0));
}

// Дно по доле ширины отмели t (0 — берег, 1 — край отмели), расстоянию от берега out_sea и крутизне берега cliff —
// как в природе (замечание владельца 11.11: «мазки кисточкой» под водой — вытянутые мели одного направления):
//   • профиль отмели вогнутый, как у песчаных берегов: у берега дно уходит быстрее, дальше всё положе;
//   • по отмели — пологие бугры и ложбины без общего направления (поле искажено шумом: ни полос, ни кругов);
//   • у скал глубина подходит ближе, дно каменистое — пятна рифов на 1–3 м выше;
//   • за краем отмели — широкий склон к глубине; на глубине плавные гряды и впадины, далеко за миром дно ровное.
float seabed(float t, float out_sea, float cliff, vec2 p, vec2 n) {
	float edge = 9.0 + 12.0 * noise01(n / 1400.0 + vec2(4.0, 44.0));
	float shelf = edge * pow(min(t, 1.0), 0.67) + 2.0 * smoothstep(0.0, 220.0, out_sea);
	vec2 q = n + 140.0 * vec2(gnoise(n / 760.0 + vec2(3.0, 9.0)), gnoise(n / 760.0 + vec2(17.0, 2.0)));
	shelf += 2.4 * fbm(q / 420.0 + vec2(8.0, 1.0), 3) * smoothstep(0.08, 0.4, t) * (1.0 - smoothstep(1.2, 2.0, t));
	float reef = cliff * 2.6 * smoothstep(0.42, 0.78, noise01(q / 85.0 + vec2(5.0, 12.0))) * (1.0 - smoothstep(50.0, 240.0, out_sea));
	shelf -= reef;
	float slope = 1.0 + 0.8 * noise01(n / 1600.0 + vec2(17.0, 61.0));
	float relief = 24.0 * fbm(q / 1500.0 + vec2(3.0, 3.0), 3) * far_fade(p);
	return shelf + max(70.0 + relief - edge, 4.0) * smoothstep(0.85, 1.0 + slope, t);
}

// ── Малые острова ───────────────────────────────────────────────────────────

// Штамп острова в точке uv (в половинах стороны, x — на восток, y — на юг): x — высота, м при опорном размере;
// y — расстояние до берега в половинах стороны (на суше меньше нуля); z — «камень»; w — 1, если здесь вода озера.
// Между точками штампа — кубический B-сплайн: поверхность гладкая, без граней сетки. Дальше круга радиусом extent —
// море: расстояние до берега продолжается от края круга по прямой от центра (у квадрата были бы изломы по
// диагоналям — по дну от острова шли лучи).
vec4 stamp_at(int design, vec2 uv) {
	float radius = length(uv);
	vec2 q = radius > stamp_extent ? uv * (stamp_extent / radius) : uv;
	vec2 t = (q / stamp_extent * 0.5 + 0.5) * float(stamp_size) - 0.5;
	vec2 base = floor(t);
	vec2 f = t - base;
	vec2 f2 = f * f;
	vec2 f3 = f2 * f;
	vec2 w[4] = vec2[4]((1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0,
			(1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, f3 / 6.0);
	int row = (design - 1) * stamp_size;
	vec3 sum = vec3(0.0);
	for (int j = 0; j < 4; j++) {
		for (int i = 0; i < 4; i++) {
			ivec2 c = clamp(ivec2(base) + ivec2(i - 1, j - 1), ivec2(0), ivec2(stamp_size - 1));
			c.y += row;
			vec4 raw = texelFetch(islet_stamps, c, 0);
			float stone = texelFetch(islet_marks, c, 0).r;
			sum += (w[i].x * w[j].y) * vec3(raw.r * 65280.0 + raw.g * 255.0, raw.b * 65280.0 + raw.a * 255.0, stone);
		}
	}
	ivec2 near = clamp(ivec2(floor(t + 0.5)), ivec2(0), ivec2(stamp_size - 1));
	float lake = texelFetch(islet_marks, ivec2(near.x, near.y + row), 0).g;
	return vec4(mix(stamp_range.x, stamp_range.y, sum.x / 65535.0),
			mix(-stamp_range.z, stamp_range.z, sum.y / 65535.0) + length(uv - q), sum.z, step(0.5, lake));
}

float sd_box(vec2 q, vec2 half_size) {
	vec2 d = abs(q) - half_size;
	return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0);
}

// Каменоломня: в южный склон холма врезана выработка уступами — ровное дно, проход к югу на плато, вокруг дна
// уступы по 6 м; за краем выработки склон холма как был. У юго-восточного берега — ровная площадка под причал.
// uv — точка штампа без мелкого искажения берега (уступы ровные), r — половина стороны острова на карте,
// k — множитель высот, h — высота земли.
float quarry_works(vec2 uv, float r, float k, float h) {
	float floor_distance = min(sd_box(uv - vec2(-0.05, -0.2), vec2(0.09, 0.05)), sd_box(uv - vec2(-0.05, -0.05), vec2(0.06, 0.13)));
	float x = max(floor_distance, 0.0) / 0.034;
	float whole = floor(x);
	float stairs = whole + smoothstep(0.75, 1.0, x - whole);
	float outside = smoothstep(-0.02, 0.0, sd_box(uv - vec2(-0.05, -0.13), vec2(0.2, 0.2)));
	h = mix(min(h, (11.5 + 6.0 * stairs) * k), h, outside);
	float pier = length(uv - vec2(0.64, 0.62)) * r;
	return mix(1.8, h, smoothstep(14.0, 40.0, pier));
}

// Малые острова в точке: s — расстояние до суши ближайшего (меньше нуля — суша), land — её высота,
// cliff — крутизна берега, shelf — место на отмели (доля её ширины), cap — предел глубины, level — уровень воды озера.
// biome — доли местностей ближайшего острова (по каталогу), для поверхностей.
void islet_surface(vec2 p, vec2 n, out float s, out float land, out float cliff, out float shelf, out float cap, out float level, out vec4 biome) {
	s = BIG;
	land = 0.0;
	cliff = 0.0;
	biome = vec4(0.0);
	shelf = BIG;
	cap = BIG;
	level = NO_WATER;
	for (int i = 0; i < islet_count; i++) {
		vec4 frame = islet_frame[i];
		float r = frame.x;
		int design = int(frame.y + 0.5);
		vec4 info = design_info[design - 1];
		vec2 centre = islet_centre[i];
		if (length(p - centre) > info.w * r + 1100.0) {
			continue;
		}
		// Берег гуляет: мелкие мысы и бухточки поверх штампа.
		float shift = 3.0 * float(i);
		vec2 w = p + vec2(
				4.0 * gnoise(n / 45.0 + vec2(shift, 0.0)) + 1.8 * gnoise(n / 17.0 + vec2(0.0, shift)),
				4.0 * gnoise(n / 45.0 + vec2(0.0, shift + 50.0)) + 1.8 * gnoise(n / 17.0 + vec2(shift + 50.0, 0.0)));
		vec2 d = (w - centre) / r;
		float ca = cos(frame.z);
		float sa = sin(frame.z);
		vec2 uv = vec2((ca * d.x + sa * d.y) * frame.w, -sa * d.x + ca * d.y);
		vec4 st = stamp_at(design, uv);
		// Высоты растут медленнее размера: большой остров не превращается в гору-башню, малый — не в лепёшку.
		float k = pow(r / info.x, 0.75);
		float sd = st.y * r;
		float shore = -sd;
		float h = st.x * k;
		if (design == QUARRY_DESIGN) {
			vec2 d0 = (p - centre) / r;
			h = quarry_works(vec2((ca * d0.x + sa * d0.y) * frame.w, -sa * d0.x + ca * d0.y), r, k, h);
		}
		// Мелкая фактура поверх штампа: на скалах — трещины и уступы, на лугах и пляжах — лёгкая волнистость.
		float detail = st.z * (1.6 * (ridged(n / 15.0 + vec2(4.0, 9.0), 3) - 0.42) + 0.45 * gnoise(n / 6.0 + vec2(2.0, 7.0)))
				+ (1.0 - st.z) * 0.4 * fbm(n / 26.0 + vec2(1.0, 5.0), 2);
		h += detail * smoothstep(0.0, 6.0, shore);
		// От кромки воды земля поднимается плавно (без уступа у самой воды): у пляжа — на 8 м вглубь,
		// у скалы — на 2,5 м. И нигде на суше земля не опускается к уровню моря.
		float rise = mix(8.0, 2.5, st.z);
		h = mix(0.06 * max(shore, 0.0), h, smoothstep(0.0, rise, shore));
		h = max(h, min(0.06 * max(shore, 0.0), 0.6));
		if (sd < s) {
			s = sd;
			land = h;
			cliff = st.z;
			biome = design_biome[design - 1];
		}
		// Отмель в долях своей ширины; ширина меняется вдоль берега, край гуляет (сдвиг — в меру ширины).
		float shelf_width = info.y * sqrt(r / info.x) * (0.6 + 0.8 * noise01(n / 260.0 + vec2(7.0 * float(i), 3.0 * float(i))));
		shelf = min(shelf, max(max(sd, 0.0) + shelf_warp(n) * (shelf_width / 400.0), 0.0) / shelf_width);
		if (st.w > 0.5 && info.z > -900.0) {
			level = info.z * k;
		}
	}
}

// ── Поверхность мира ────────────────────────────────────────────────────────

// x — высота земли (дна), y — уровень воды озера в этой точке или NO_WATER.
// Заодно — что за земля в точке (для поверхностей, шаг 1.3):
//   ground_a — доли местностей: пустыня, холмы, луга, горы (в море и на прибрежной полосе — нули);
//   ground_b — x: близость воды озера (1 у уреза и в воде, 0 дальше 45 м); y: метров вглубь суши от уреза моря
//              (0…64 м → 0…1); z: камень — обрыв у моря, скалы малых островов, в море крутизна ближайшего берега;
//              w: доля оазиса.
vec2 world_point(vec2 p0, out vec4 ground_a, out vec4 ground_b) {
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
	vec4 biome_field = vec4(0.0);
	float oasis_field = 0.0;
	if (near_field) {
		float shore;
		field_surface(p0, shore, land_field, cliff_field, p, n, d_site, biome_field, oasis_field);
		s_field = -shore;
	}
	float s_islet;
	float land_islet;
	float cliff_islet;
	float shelf_islet;
	float cap;
	float level;
	vec4 biome_islet;
	islet_surface(p0, n0, s_islet, land_islet, cliff_islet, shelf_islet, cap, level, biome_islet);

	float s = min(s_field, s_islet);
	float cliff = s_field <= s_islet ? cliff_field : cliff_islet;
	float out_sea = max(s, 0.0);
	// Отмель в долях своей ширины: у главных островов широкая, у малых — по характеру острова. Между близкими
	// островами отмели сливаются. Всё, от чего зависит ширина и глубина, меняется медленнее, чем расстояние
	// от берега: глубина растёт от берега без ям посреди отмели (проверка — tools/sandbox/check.py).
	float d_field = mix(max(s_field, 0.0), max(d_far - 60.0, 0.0), smoothstep(200.0, 330.0, d_far));
	float width = 450.0 + 300.0 * noise01(n0 / 2000.0 + vec2(7.0, 2.0));
	float t = smooth_min(max(d_field + shelf_warp(n0), 0.0) / width, shelf_islet, 0.35);
	// Расстояние от берега для плавного уклона дна: непрерывное везде (в отличие от out_sea, которое вдали от главных
	// островов не считается и скачет на границе расчёта, — там уклон уже набран не весь).
	float far_shore = max(min(d_field, s_islet), 0.0);
	float depth = near_shore(out_sea, cliff, n0) + seabed(t, far_shore, cliff, p0, n0) * smoothstep(0.0, 60.0, out_sea);
	float h = s_field < 0.0 ? land_field : (s_islet < 0.0 ? land_islet : -min(depth, cap));

	float lake_near = 0.0;
	if (near_field) {
		float lake_level;
		h = lakes(p, n, d_site, h, lake_level, lake_near);
		if (lake_level > -900.0) {
			level = lake_level;
		}
	}
	bool on_field = s_field < 0.0;
	bool on_islet = !on_field && s_islet < 0.0;
	ground_a = on_field ? biome_field : (on_islet ? biome_islet : vec4(0.0));
	ground_b = vec4(lake_near, clamp(-s / 64.0, 0.0, 1.0), cliff, on_field ? oasis_field : 0.0);
	return vec2(h, level);
}

vec2 world_surface(vec2 p0) {
	vec4 ground_a;
	vec4 ground_b;
	return world_point(p0, ground_a, ground_b);
}
