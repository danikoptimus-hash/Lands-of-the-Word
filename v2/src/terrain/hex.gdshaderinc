// Геометрия гексов в шейдере. Те же формулы, что в packages/domain/src/hex.ts и src/core/hex_math.gd:
// гексы «остриём вверх», осевые координаты (q, r), x — восток, z — юг.

// Мир — доска, увеличенная в WORLD_SCALE раз (HexMath.WORLD_SCALE): здесь всё — в координатах доски.
const float WORLD_SCALE = 5.7735027;
const float HEX_SIZE = 100.0; // метров доски от центра до угла
const float HEX_APOTHEM = 86.60254; // метров от центра до стороны
const float SQRT3 = 1.7320508;

// Карта местности: тексель (q - hex_origin.x, r - hex_origin.y), красный канал — номер местности, 0 — море.
uniform sampler2D hex_map : filter_nearest, repeat_disable;
uniform ivec2 hex_origin;
uniform ivec2 hex_dims;

const int T_SEA = 0;
const int T_DESERT = 1;
const int T_HILLS = 2;
const int T_MEADOW = 3;
const int T_MOUNTAINS = 4;
const int T_WATER = 5;
const int T_OASIS = 6;

vec2 hex_center(ivec2 h) {
	return vec2(HEX_SIZE * SQRT3 * (float(h.x) + 0.5 * float(h.y)), HEX_SIZE * 1.5 * float(h.y));
}

// Гекс, в который попадает точка.
ivec2 hex_at(vec2 p) {
	float x = (SQRT3 / 3.0 * p.x - p.y / 3.0) / HEX_SIZE;
	float z = (2.0 / 3.0 * p.y) / HEX_SIZE;
	float y = -x - z;
	float rx = round(x);
	float ry = round(y);
	float rz = round(z);
	float dx = abs(rx - x);
	float dy = abs(ry - y);
	float dz = abs(rz - z);
	if (dx > dy && dx > dz) {
		rx = -ry - rz;
	} else if (dy <= dz) {
		rz = -rx - ry;
	}
	return ivec2(int(rx), int(rz));
}

// Знаковое расстояние до границы гекса с центром в нуле: внутри отрицательное.
float sd_hex(vec2 d) {
	const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
	vec2 p = abs(d.yx);
	p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
	p -= vec2(clamp(p.x, -k.z * HEX_APOTHEM, k.z * HEX_APOTHEM), HEX_APOTHEM);
	return length(p) * sign(p.y);
}

int terrain_at(ivec2 h) {
	ivec2 t = h - hex_origin;
	if (t.x < 0 || t.y < 0 || t.x >= hex_dims.x || t.y >= hex_dims.y) {
		return T_SEA;
	}
	return int(texelFetch(hex_map, t, 0).r * 255.0 + 0.5);
}
