class_name HexMath
extends RefCounted
## Геометрия гексов. Те же формулы, что в packages/domain/src/hex.ts, hexgraph.ts и в шейдере hex.gdshaderinc:
## гексы «остриём вверх», осевые координаты (q, r); в мире x — восток, z — юг.

## Масштаб мира (решение владельца 13.11 по итогам аудита масштаба): гекс — километр между сторонами.
## Форма земли придумана и принята «на доске», где гекс — 100 м от центра до угла (BOARD_SIZE); функция высот,
## каталог малых островов и правила местностей считаются в координатах доски. Мир — та же доска, увеличенная
## подобием в WORLD_SCALE раз: координаты, расстояния и высоты. В настоящих метрах, без увеличения, остаются
## деревья, кусты, камни, дома, дороги и поля. Всё в GDScript — в метрах мира; в координаты доски переводят
## только шейдеры географии на входе (bake.gdshader, bake_ground.gdshader, bake_surface.gdshader) и те, кто
## готовит для них данные (WorldData.apply_height_uniforms).
const BOARD_SIZE := 100.0  ## «на доске»: метров от центра гекса до угла
const WORLD_SCALE := 5.773502691896258  ## во сколько раз мир больше доски: 1000 м между сторонами гекса вместо 173,2
const SIZE := BOARD_SIZE * WORLD_SCALE  ## метров от центра гекса до угла (577 м)
const APOTHEM := 500.0  ## метров от центра до стороны
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
