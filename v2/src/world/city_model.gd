class_name CityModel
extends RefCounted
## Черновая модель города (проба масштаба 13.11): одна планировка на все города — чтобы видеть, как город
## настоящего размера сидит на карте рядом с лесом, полями и гексом в километр. Это не окончательный город
## (города — шаг 1.10), а «болванка» в настоящих метрах: стена с башнями и воротами поперечником около 280 м,
## внутри — главная улица от ворот к площади, поперечная улица, кварталы домов с плоскими крышами (дом —
## 8–11 на 7–10 м, один или два этажа), большое здание у площади, несколько домов за воротами у дороги.
##
## Планировка считается один раз (жребий с постоянным зерном) в своих координатах: центр города — в нуле, ворота
## смотрят на +Z. Каждый город — эта планировка, повёрнутая на свой угол и «посаженная» на землю: каждый дом и
## каждый отрезок стены стоит на высоте земли под ним, поэтому на склоне город идёт уступами, а не висит.

const RADIUS := 140.0  ## от центра до стены
const WALL_HEIGHT := 8.0
const WALL_WIDTH := 2.6
const TOWER_SIZE := 6.5
const TOWER_HEIGHT := 12.0
const GATE_WIDTH := 9.0
const MAIN_STREET := 9.0  ## ширина главной улицы
const CROSS_STREET := 7.0
const SQUARE := 24.0  ## половина стороны площади
const LOT := 12.5  ## шаг сетки домов: дом и проулок
const GRID_TURN := 0.21  ## сетка кварталов повёрнута к главной улице: город не по линейке
const SEED := 20261113

const WALL_COLOR := Color(0.62, 0.56, 0.46)
const TOWER_COLOR := Color(0.58, 0.52, 0.43)
const HALL_COLOR := Color(0.78, 0.72, 0.6)
const PLASTER: Array[Color] = [Color(0.83, 0.78, 0.68), Color(0.78, 0.71, 0.58), Color(0.72, 0.63, 0.5), Color(0.86, 0.83, 0.76),
		Color(0.69, 0.6, 0.47)]


## Один «ящик» планировки: дом, башня или здание. Место — в координатах города.
class Block:
	var place := Vector2.ZERO
	var size := Vector3.ONE  ## ширина, высота, глубина
	var turn := 0.0
	var color := Color.WHITE
	var roof := Color.WHITE


static var _blocks: Array[Block] = []
static var _wall: PackedVector2Array = []  ## вершины стены по кругу; ворота — посреди отрезка между последней и первой


## Сколько в планировке домов (без башен и большого здания) — для журнала.
static func house_count() -> int:
	_layout()
	var count := 0
	for block in _blocks:
		if block.size.x < 13.0 and block.size.y < TOWER_HEIGHT - 0.1:
			count += 1
	return count


static func _layout() -> void:
	if not _blocks.is_empty():
		return
	var rng := RandomNumberGenerator.new()
	rng.seed = SEED
	# Стена: неровное кольцо из 16 отрезков.
	var corners := 16
	for i in corners:
		var angle := PI * 0.5 + (float(i) + 0.5) / float(corners) * TAU + rng.randf_range(-0.06, 0.06)
		var reach := RADIUS * (0.9 + 0.1 * sin(float(i) * 1.7 + 0.4) + rng.randf_range(-0.035, 0.035))
		_wall.append(Vector2(cos(angle), sin(angle)) * reach)
	for i in corners:
		_add(_wall[i], Vector3(TOWER_SIZE, TOWER_HEIGHT, TOWER_SIZE), atan2(_wall[i].x, _wall[i].y), TOWER_COLOR, TOWER_COLOR.darkened(0.12))
	# Ворота: две башни покрупнее по сторонам проёма.
	var gate := (_wall[corners - 1] + _wall[0]) * 0.5
	for side: float in [-1.0, 1.0]:
		_add(gate + Vector2(side * (GATE_WIDTH * 0.5 + 4.0), 0.0), Vector3(8.0, 14.0, 8.0), 0.0, TOWER_COLOR, TOWER_COLOR.darkened(0.12))
	# Большое здание у площади (храм или дом правителя) и его двор.
	var square := Vector2(4.0, -10.0)
	_add(square + Vector2(0.0, -SQUARE - 12.0), Vector3(30.0, 11.0, 19.0), 0.0, HALL_COLOR, HALL_COLOR.darkened(0.1))
	_add(square + Vector2(-SQUARE - 9.0, -6.0), Vector3(14.0, 7.5, 22.0), 0.0, HALL_COLOR.darkened(0.05), HALL_COLOR.darkened(0.15))
	# Кварталы: сетка домов внутри стены, без улиц и площади.
	var grid := Transform2D(GRID_TURN, Vector2.ZERO)
	var span := int(RADIUS / LOT) + 2
	for row in range(-span, span + 1):
		for column in range(-span, span + 1):
			# Проулки между кварталами — каждый четвёртый ряд и столбец.
			if posmod(row, 4) == 2 or posmod(column, 5) == 3:
				continue
			var place: Vector2 = grid * (Vector2(float(column), float(row)) * LOT) + Vector2(rng.randf_range(-1.3, 1.3), rng.randf_range(-1.3, 1.3))
			var width := rng.randf_range(8.0, 11.0)
			var depth := rng.randf_range(7.0, 10.0)
			var tall := rng.randf() < 0.3
			var height := rng.randf_range(6.3, 7.4) if tall else rng.randf_range(3.5, 4.6)
			var turn := GRID_TURN + rng.randf_range(-0.09, 0.09) + (PI * 0.5 if rng.randf() < 0.4 else 0.0)
			var tint := PLASTER[rng.randi() % PLASTER.size()].lerp(Color(0.6, 0.55, 0.47), rng.randf_range(0.0, 0.3))
			var empty := rng.randf() < 0.07  # двор или пустырь
			if empty or not _inside_wall(place, 11.0):
				continue
			if absf(place.x) < MAIN_STREET * 0.5 + 5.5 and place.y > square.y:
				continue
			if absf(place.y - square.y) < CROSS_STREET * 0.5 + 5.0:
				continue
			if absf(place.x - square.x) < SQUARE + 6.0 and place.y - square.y < SQUARE + 6.0 and place.y - square.y > -SQUARE - 28.0:
				continue
			if place.x - square.x < -SQUARE and place.x - square.x > -SQUARE - 22.0 and absf(place.y - square.y + 6.0) < 18.0:
				continue
			_add(place, Vector3(width, height, depth), turn, tint, tint.darkened(rng.randf_range(0.04, 0.16)))
			# У части двухэтажных — надстройка на крыше.
			if tall and rng.randf() < 0.4:
				_add(place + Vector2(rng.randf_range(-1.5, 1.5), rng.randf_range(-1.5, 1.5)), Vector3(width * 0.5, height + 2.6, depth * 0.55), turn, tint.lightened(0.05),
						tint.darkened(0.1))
	# Предместье: дома за воротами вдоль дороги.
	for i in 8:
		var along := gate.y + 20.0 + float(i / 2) * 13.0 + rng.randf_range(-1.5, 1.5)
		var side := -1.0 if i % 2 == 0 else 1.0
		var tint := PLASTER[rng.randi() % PLASTER.size()].lerp(Color(0.6, 0.55, 0.47), 0.25)
		_add(Vector2(side * rng.randf_range(11.0, 16.0), along), Vector3(rng.randf_range(8.0, 10.5), rng.randf_range(3.4, 4.3), rng.randf_range(7.0, 9.0)),
				rng.randf_range(-0.2, 0.2), tint, tint.darkened(0.1))


static func _add(place: Vector2, size: Vector3, turn: float, color: Color, roof: Color) -> void:
	var block := Block.new()
	block.place = place
	block.size = size
	block.turn = turn
	block.color = color
	block.roof = roof
	_blocks.append(block)


## Точка внутри стены и не ближе margin к ней.
static func _inside_wall(point: Vector2, margin: float) -> bool:
	var count := _wall.size()
	for i in count:
		var from := _wall[i]
		var to := _wall[(i + 1) % count]
		var edge := (to - from).normalized()
		# Вершины идут против часовой стрелки: внутри — слева от отрезка.
		if edge.cross(point - from) < margin:
			return false
	return true


## Сетка города на своём месте: centre — точка мира (x, z), turn — поворот вокруг вертикали. Вершины — в координатах
## мира. Дома и стены, которые попали бы в воду, не ставятся.
static func build_mesh(centre: Vector2, turn: float, height_map: HeightMap) -> ArrayMesh:
	_layout()
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var to_world := Transform2D(turn, centre)
	for block in _blocks:
		var place: Vector2 = to_world * block.place
		var yaw := block.turn + turn
		var across := Vector2(cos(yaw), sin(yaw)) * block.size.x * 0.5
		var along := Vector2(-sin(yaw), cos(yaw)) * block.size.z * 0.5
		var corners: Array[Vector2] = [place - across - along, place + across - along, place + across + along, place - across + along]
		var low := INF
		var high := -INF
		for corner in corners:
			var ground := height_map.sample(corner)
			low = minf(low, ground)
			high = maxf(high, ground)
		if low < 1.0:
			continue
		# Дом стоит на земле под своей серединой; основание уходит в землю до нижнего угла.
		var top := (low + high) * 0.5 + block.size.y
		_prism(vertices, normals, colors, corners, low - 1.0, [top, top, top, top], block.color, block.roof)
	# Стена: отрезки по 12 м, каждый — на своей высоте земли; в проёме ворот стены нет.
	var count := _wall.size()
	for i in count:
		var from := _wall[i]
		var to := _wall[(i + 1) % count]
		var pieces := maxi(int(ceil(from.distance_to(to) / 12.0)), 1)
		var outward := (to - from).normalized().rotated(-PI * 0.5) * WALL_WIDTH * 0.5
		for piece in pieces:
			var a := from.lerp(to, float(piece) / float(pieces))
			var b := from.lerp(to, float(piece + 1) / float(pieces))
			if i == count - 1 and absf((a.x + b.x) * 0.5) < GATE_WIDTH * 0.5 + 3.0:
				continue
			var corners: Array[Vector2] = [to_world * (a - outward), to_world * (b - outward), to_world * (b + outward), to_world * (a + outward)]
			var ground_a := height_map.sample(to_world * a)
			var ground_b := height_map.sample(to_world * b)
			if minf(ground_a, ground_b) < 0.8:
				continue
			_prism(vertices, normals, colors, corners, minf(ground_a, ground_b) - 2.0,
					[ground_a + WALL_HEIGHT, ground_b + WALL_HEIGHT, ground_b + WALL_HEIGHT, ground_a + WALL_HEIGHT], WALL_COLOR, WALL_COLOR.darkened(0.1))
	if vertices.is_empty():
		return null
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


## Призма на четырёхугольном основании (углы — по кругу): стены от bottom до своей высоты у каждого угла и крышка.
static func _prism(vertices: PackedVector3Array, normals: PackedVector3Array, colors: PackedColorArray, corners: Array[Vector2], bottom: float,
		tops: Array, side_color: Color, top_color: Color) -> void:
	var middle := (corners[0] + corners[2]) * 0.5
	for i in 4:
		var a := corners[i]
		var b := corners[(i + 1) % 4]
		var top_a: float = tops[i]
		var top_b: float = tops[(i + 1) % 4]
		var edge := b - a
		var out := Vector2(edge.y, -edge.x).normalized()
		if out.dot((a + b) * 0.5 - middle) < 0.0:
			out = -out
		var normal := Vector3(out.x, 0.0, out.y)
		var quad: Array[Vector3] = [Vector3(a.x, bottom, a.y), Vector3(b.x, bottom, b.y), Vector3(b.x, top_b, b.y), Vector3(a.x, top_a, a.y)]
		_quad(vertices, normals, colors, quad, normal, side_color)
	var lid: Array[Vector3] = [Vector3(corners[0].x, tops[0], corners[0].y), Vector3(corners[1].x, tops[1], corners[1].y),
			Vector3(corners[2].x, tops[2], corners[2].y), Vector3(corners[3].x, tops[3], corners[3].y)]
	_quad(vertices, normals, colors, lid, Vector3.UP, top_color)


## Четырёхугольник двумя треугольниками, лицом по нормали (порядок вершин подбирается сам).
static func _quad(vertices: PackedVector3Array, normals: PackedVector3Array, colors: PackedColorArray, quad: Array[Vector3], normal: Vector3,
		color: Color) -> void:
	var facing := (quad[1] - quad[0]).cross(quad[2] - quad[0])
	# В движке лицевая сторона — та, где вершины идут по часовой стрелке.
	var order := PackedInt32Array([0, 1, 2, 0, 2, 3])
	if facing.dot(normal) >= 0.0:
		order = PackedInt32Array([0, 2, 1, 0, 3, 2])
	for index in order:
		vertices.append(quad[index])
		normals.append(normal)
		colors.append(color)
