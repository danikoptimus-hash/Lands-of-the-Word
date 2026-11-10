class_name HexMath
extends RefCounted
## Геометрия гексов. Те же формулы, что в packages/domain/src/hex.ts, hexgraph.ts и в шейдере hex.gdshaderinc:
## гексы «остриём вверх», осевые координаты (q, r); в мире x — восток, z — юг.

const SIZE := 100.0  ## метров от центра гекса до угла
const APOTHEM := 86.60254  ## метров от центра до стороны
const SQRT3 := 1.7320508075688772


static func center(q: int, r: int) -> Vector2:
	return Vector2(SIZE * SQRT3 * (float(q) + 0.5 * float(r)), SIZE * 1.5 * float(r))


## Точка перекрёстка по ключу вида «N:3,-2» или «S:0,1» (верхний или нижний угол гекса).
static func vertex_position(key: String) -> Vector2:
	var parts := key.substr(2).split(",")
	if parts.size() != 2:
		return Vector2.ZERO
	var c := center(int(parts[0]), int(parts[1]))
	if key.begins_with("N"):
		return Vector2(c.x, c.y - SIZE)
	return Vector2(c.x, c.y + SIZE)


## Прямоугольник, в который вписан гекс.
static func bounds(q: int, r: int) -> Rect2:
	var c := center(q, r)
	return Rect2(c.x - APOTHEM, c.y - SIZE, APOTHEM * 2.0, SIZE * 2.0)
