// Высота мира в метрах над уровнем моря — одна функция от точки (x, z) и данных гексов.
// Мир не рисуется картинкой: любая карта партии превращается в рельеф этой функцией.
// Числа подобраны в песочнице и принимаются владельцем на шаге 1.2 дорожной карты.

#include "res://src/terrain/hex.gdshaderinc"

uniform vec2 noise_offset; // сдвиг шума от зерна карты: у каждой карты свои мелкие детали

const float BLEND = 30.0; // полуширина перехода между местностями
const float WARP_A = 13.0; // искажение границ: местности и берег не идут по линейке
const float WARP_B = 5.0;
const float COAST_MIN = 34.0; // суша выходит за сторону гекса не меньше чем на столько (дороги по берегу остаются на суше)
const float COAST_BASE = 38.0;
const float COAST_BULGE = 85.0; // мысы и широкие пляжи
const float COAST_SMOOTH = 95.0; // сглаживание входящих углов берега
const float SHORE_RAMP = 80.0; // на таком расстоянии от воды суша набирает полную высоту
const float SEA_DEPTH = 30.0; // глубина открытого моря
const float FAR = 250.0; // дальше этого расстояния до суши и моря не различаем
const float BIG = 1.0e6;

// ── Шум ─────────────────────────────────────────────────────────────────────

uint pcg(uint v) {
	uint state = v * 747796405u + 2891336453u;
	uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
	return (word >> 22u) ^ word;
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

// ── Характер местностей: добавка к общей высоте суши ────────────────────────

float relief_meadow(vec2 n) {
	return 1.5 * fbm(n / 200.0, 3) + 0.8 * fbm(n / 60.0 + vec2(40.0, 0.0), 2);
}

float relief_desert(vec2 n, float mask) {
	vec2 w = n + 26.0 * vec2(gnoise(n / 190.0 + vec2(0.0, 7.0)), gnoise(n / 190.0 + vec2(3.0, 0.0)));
	vec2 uv = vec2((w.x * 0.94 + w.y * 0.34) / 46.0, (-w.x * 0.34 + w.y * 0.94) / 150.0);
	float ridge = 1.0 - abs(gnoise(uv));
	float patches = smoothstep(-0.25, 0.35, gnoise(n / 230.0 + vec2(9.0, 4.0)));
	return -1.0 + 2.0 * fbm(n / 260.0 + vec2(11.0, 0.0), 3) + 5.5 * ridge * ridge * ridge * mask * (0.35 + 0.65 * patches);
}

float relief_hills(vec2 n, float mask) {
	float f = clamp(0.5 + 0.62 * fbm(n / 135.0 + vec2(5.0, 9.0), 4), 0.0, 1.0);
	return mask * (1.5 + 30.0 * pow(f, 1.5) + 2.2 * fbm(n / 38.0 + vec2(0.0, 20.0), 3));
}

float relief_mountains(vec2 n, float rise, float valley) {
	float rid = ridged(n / 200.0 + vec2(3.0, 1.0), 5);
	return rise * (22.0 + (18.0 + 100.0 * rid) * valley + 3.0 * fbm(n / 26.0, 3));
}

// ── Высота ──────────────────────────────────────────────────────────────────

float world_height(vec2 p) {
	vec2 n = p + noise_offset;
	vec2 wp = p + vec2(
			WARP_A * gnoise(n / 85.0) + WARP_B * gnoise(n / 31.0 + vec2(5.0, 0.0)),
			WARP_A * gnoise(n / 85.0 + vec2(37.0, 0.0)) + WARP_B * gnoise(n / 31.0 + vec2(0.0, 91.0)));

	ivec2 h0 = hex_at(wp);
	int t0 = terrain_at(h0);

	// Для каждой местности: расстояние до ближайшей клетки той же местности и до ближайшей другой.
	float same[7];
	float other[7];
	for (int k = 0; k < 7; k++) {
		same[k] = BIG;
		other[k] = BIG;
	}
	float land_soft = BIG;
	float s_own = 0.0;
	for (int dr = -2; dr <= 2; dr++) {
		for (int dq = -2; dq <= 2; dq++) {
			if (abs(dq + dr) > 2) {
				continue;
			}
			ivec2 h = h0 + ivec2(dq, dr);
			int t = terrain_at(h);
			float s = sd_hex(wp - hex_center(h));
			if (dq == 0 && dr == 0) {
				s_own = s;
			}
			if (t != T_SEA) {
				land_soft = smooth_min(land_soft, s, COAST_SMOOTH);
			}
			for (int k = 0; k < 7; k++) {
				if (t == k) {
					same[k] = min(same[k], s);
				} else {
					other[k] = min(other[k], s);
				}
			}
		}
	}

	// Знаковое расстояние до границы «своей» области каждой местности: внутри положительное.
	// Соседние гексы одной местности сливаются в одну область — горы становятся хребтом, а не шестью пирамидами.
	float inside[7];
	for (int k = 0; k < 7; k++) {
		inside[k] = (t0 == k) ? min(other[k], FAR) : -min(same[k], FAR);
	}

	// Берег: coast < 0 на суше, > 0 в море — расстояние до границы гексов суши.
	float coast;
	if (t0 != T_SEA) {
		coast = -min(same[T_SEA], FAR);
	} else {
		float land_hard = min(-inside[T_SEA], FAR);
		coast = mix(land_hard, min(land_soft, FAR), smoothstep(0.0, 12.0, land_hard));
	}

	// Общая высота суши: к середине острова чуть выше.
	float inland = max(-coast, 0.0);
	float height = 7.0 + 7.0 * smoothstep(20.0, 240.0, inland) + 3.0 * fbm(n / 420.0 + vec2(0.0, 77.0), 3);

	// Характер местностей с плавными весами.
	float w_sum = 1.0e-5;
	float relief = 0.0;
	float w = smoothstep(-BLEND, BLEND, inside[T_DESERT]);
	if (w > 0.001) {
		relief += w * relief_desert(n, smoothstep(-20.0, 30.0, inside[T_DESERT]));
		w_sum += w;
	}
	w = smoothstep(-BLEND, BLEND, inside[T_HILLS]);
	if (w > 0.001) {
		relief += w * relief_hills(n, smoothstep(-22.0, 72.0, inside[T_HILLS]));
		w_sum += w;
	}
	w = smoothstep(-BLEND, BLEND, inside[T_MEADOW]);
	if (w > 0.001) {
		relief += w * relief_meadow(n);
		w_sum += w;
	}
	w = smoothstep(-BLEND, BLEND, inside[T_MOUNTAINS]);
	if (w > 0.001) {
		float valley = 0.5 + 0.5 * smoothstep(0.0, 50.0, -s_own);
		relief += w * relief_mountains(n, smoothstep(-15.0, 85.0, inside[T_MOUNTAINS]), valley);
		w_sum += w;
	}
	w = smoothstep(-BLEND, BLEND, inside[T_WATER]);
	if (w > 0.001) {
		relief += w * relief_meadow(n + vec2(300.0, 0.0));
		w_sum += w;
	}
	w = smoothstep(-BLEND, BLEND, inside[T_OASIS]);
	if (w > 0.001) {
		relief += w * relief_desert(n, 0.25 * smoothstep(-20.0, 30.0, inside[T_OASIS]));
		w_sum += w;
	}
	height += relief / w_sum;

	// Озеро и пруд оазиса — чаша внутри своего гекса, стороны гекса остаются сушей.
	if (t0 == T_WATER || t0 == T_OASIS) {
		float r_own = length(wp - hex_center(h0));
		if (t0 == T_WATER) {
			float d = 0.4 * (-s_own) + 0.6 * (HEX_APOTHEM - r_own)
					+ 9.0 * gnoise(n / 55.0 + vec2(0.0, 4.0)) + 4.0 * gnoise(n / 23.0 + vec2(8.0, 0.0));
			height -= 7.5 * smoothstep(34.0, 72.0, d);
		} else {
			height -= 6.5 * (1.0 - smoothstep(9.0, 30.0 + 5.0 * gnoise(n / 30.0), r_own));
		}
	}

	// Берег: пляж, отмель, глубина.
	float bulge = noise01(n / 520.0 + vec2(71.0, 13.0));
	float offset = max(COAST_MIN, COAST_BASE + COAST_BULGE * bulge * bulge + 12.0 * gnoise(n / 120.0 + vec2(0.0, 50.0)));
	float shore = offset - coast; // > 0 — метров вглубь суши от уреза воды
	if (shore > 0.0) {
		float beach = 2.4 * (1.0 - exp(-shore / 14.0));
		return mix(beach, height, smoothstep(4.0, SHORE_RAMP, shore));
	}
	float out_sea = -shore;
	float shelf = 38.0 + 70.0 * noise01(n / 380.0 + vec2(31.7, 8.0));
	float shallow = 0.1 * min(out_sea, 12.0) + 3.5 * smoothstep(0.0, 0.6 * shelf, out_sea)
			+ (SEA_DEPTH - 4.7) * smoothstep(0.5 * shelf, 1.6 * shelf, out_sea);
	return -max(shallow, SEA_DEPTH * smoothstep(150.0, 245.0, coast));
}
