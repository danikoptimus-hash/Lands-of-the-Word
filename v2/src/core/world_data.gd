class_name WorldData
extends RefCounted
## Описание мира партии: гексы, перекрёстки, стороны. Только геометрия карты, без людей и команд.
## Пока читается из снимка (data/world_*.json, делает v2/tools/export-world.mjs), позже — с сервера.

enum Terrain { SEA, DESERT, HILLS, MEADOW, MOUNTAINS, WATER, OASIS }

const TERRAIN_BY_NAME := {
	"desert": Terrain.DESERT,
	"hills": Terrain.HILLS,
	"meadow": Terrain.MEADOW,
	"mountains": Terrain.MOUNTAINS,
	"water": Terrain.WATER,
	"oasis": Terrain.OASIS,
}
const ISLAND_TITLES := {"OT": "Ветхий Завет", "NT": "Новый Завет"}
const HEX_MAP_PAD := 3  ## запас клеток моря вокруг карты в текстуре местностей
## Малые острова — те же, что на сайте (packages/domain/src/islets.ts): номер картинки → что это за остров.
const ISLET_TITLES := {
	1: "Зелёный остров",
	2: "Остров с хребтом",
	3: "Полумесяц с лагуной",
	4: "Песчаная банка",
	5: "Столовая гора",
	6: "Остров с ручьём и прудом",
	7: "Каменоломня",
}
const SHAPES_PATH := "res://data/islets.bin"  ## очертания островов по картинкам сайта (tools/islet-shapes.py)
const MAX_COAST_CELLS := 160  ## столько клеток берега помещается в шейдер рельефа
const MAX_ISLETS := 12


class Cell:
	var q := 0
	var r := 0
	var terrain := Terrain.SEA
	var island := ""

	func center() -> Vector2:
		return HexMath.center(q, r)


class Site:
	var key := ""
	var position := Vector2.ZERO
	var kind := ""  ## EMPTY — перекрёсток, CITY — город, START — точка старта
	var city_type := ""
	var book := ""
	var island := ""
	var coastal := false

	## Что стоит в вершине, числом для шейдера рельефа: 1 — развилка, 2 — город, 3 — порт, 4 — точка старта.
	func shader_kind() -> int:
		if kind == "START":
			return 4
		if kind == "CITY":
			return 3 if city_type == "port" else 2
		return 1


class Islet:
	var position := Vector2.ZERO  ## центр картинки острова, метры
	var radius := 0.0  ## половина стороны картинки, метры
	var picture := 1  ## номер картинки на сайте: от него зависит характер острова
	var quarry := false

	func title() -> String:
		return str(WorldData.ISLET_TITLES.get(picture, "Островок"))

	## Квадрат, в который вписан остров.
	func area() -> Rect2:
		return Rect2(position - Vector2(radius, radius) * 1.05, Vector2(radius, radius) * 2.1)


static var _shapes_texture: ImageTexture
static var _shapes_extent := 1.3
static var _shapes_size := 160

var title := ""
var map_seed := 0
var cells: Array[Cell] = []
var sites: Array[Site] = []
var edges: Array[PackedStringArray] = []
var islets: Array[Islet] = []
var land_rect := Rect2()  ## прямоугольник вокруг всех гексов
var content_rect := Rect2()  ## главные острова вместе с малыми
var island_rects := {}  ## остров → Rect2
var hex_origin := Vector2i.ZERO
var hex_dims := Vector2i.ONE

var _terrain_by_cell := {}  ## Vector2i(q, r) → Terrain
var _hex_texture: ImageTexture


static func load_file(path: String) -> WorldData:
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		push_error("Данные мира не найдены: %s" % path)
		return null
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("Данные мира повреждены: %s" % path)
		return null
	var data: Dictionary = parsed
	var format := int(data.get("format", 0))
	if format != 1 and format != 2:  # формат 2 — со списком малых островов
		push_error("Неизвестный формат данных мира: %s" % path)
		return null

	var world := WorldData.new()
	world.title = str(data.get("name", ""))
	world.map_seed = int(data.get("seed", 0))

	var hex_rows: Array = data.get("hexes", [])
	for row: Array in hex_rows:
		var cell := Cell.new()
		cell.q = int(row[0])
		cell.r = int(row[1])
		var terrain_name := str(row[2])
		cell.terrain = TERRAIN_BY_NAME.get(terrain_name, Terrain.MEADOW)
		cell.island = str(row[3])
		world.cells.append(cell)
		world._terrain_by_cell[Vector2i(cell.q, cell.r)] = cell.terrain

	var node_rows: Array = data.get("nodes", [])
	for row: Array in node_rows:
		var site := Site.new()
		site.key = str(row[0])
		site.position = HexMath.vertex_position(site.key)
		site.kind = str(row[1])
		site.city_type = "" if row[2] == null else str(row[2])
		site.book = "" if row[3] == null else str(row[3])
		site.island = str(row[4])
		site.coastal = int(row[5]) != 0
		world.sites.append(site)

	var edge_rows: Array = data.get("edges", [])
	for row: Array in edge_rows:
		world.edges.append(PackedStringArray([str(row[0]), str(row[1])]))

	var islet_rows: Array = data.get("islets", [])
	for row: Array in islet_rows:
		if world.islets.size() >= MAX_ISLETS:
			push_error("Малых островов больше, чем помещается в рельеф: %s" % path)
			break
		var islet := Islet.new()
		islet.position = Vector2(float(row[0]), float(row[1]))
		islet.radius = float(row[2])
		islet.picture = int(row[3])
		islet.quarry = int(row[5]) != 0
		world.islets.append(islet)

	if world.cells.is_empty():
		push_error("В данных мира нет гексов: %s" % path)
		return null
	world._measure()
	return world


func terrain_at(q: int, r: int) -> Terrain:
	return _terrain_by_cell.get(Vector2i(q, r), Terrain.SEA)


## Сколько соседей гекса имеют ту же местность.
func same_neighbours(cell: Cell) -> int:
	var count := 0
	for d: Vector2i in [Vector2i(1, 0), Vector2i(1, -1), Vector2i(0, -1), Vector2i(-1, 0), Vector2i(-1, 1), Vector2i(0, 1)]:
		if terrain_at(cell.q + d.x, cell.r + d.y) == cell.terrain:
			count += 1
	return count


func cells_of(terrain: Terrain) -> Array[Cell]:
	var found: Array[Cell] = []
	for cell in cells:
		if cell.terrain == terrain:
			found.append(cell)
	return found


## Сдвиг шума по зерну карты: у каждой карты свои мелкие детали рельефа.
func noise_offset() -> Vector2:
	var a := map_seed % 9973
	@warning_ignore("integer_division")
	var b := (map_seed / 9973) % 9973
	return Vector2(float(a) * 3.7, float(b) * 2.9)


## Карта партии для шейдеров: тексель (q − hex_origin.x, r − hex_origin.y).
## Красный канал — номер местности клетки; зелёный — что стоит в её северном углу, синий — в южном
## (каждая вершина — северный или южный угол ровно одной клетки; числа — Site.shader_kind).
func hex_texture() -> ImageTexture:
	if _hex_texture != null:
		return _hex_texture
	var image := Image.create_empty(hex_dims.x, hex_dims.y, false, Image.FORMAT_RGBA8)
	image.fill(Color(0.0, 0.0, 0.0, 1.0))
	for cell in cells:
		image.set_pixel(cell.q - hex_origin.x, cell.r - hex_origin.y, Color(float(cell.terrain) / 255.0, 0.0, 0.0, 1.0))
	for site in sites:
		var parts := site.key.substr(2).split(",")
		if parts.size() != 2:
			continue
		var x := int(parts[0]) - hex_origin.x
		var y := int(parts[1]) - hex_origin.y
		if x < 0 or y < 0 or x >= hex_dims.x or y >= hex_dims.y:
			continue
		var texel := image.get_pixel(x, y)
		if site.key.begins_with("N"):
			texel.g = float(site.shader_kind()) / 255.0
		else:
			texel.b = float(site.shader_kind()) / 255.0
		image.set_pixel(x, y, texel)
	_hex_texture = ImageTexture.create_from_image(image)
	return _hex_texture


func apply_hex_uniforms(material: ShaderMaterial) -> void:
	material.set_shader_parameter("hex_map", hex_texture())
	material.set_shader_parameter("hex_origin", hex_origin)
	material.set_shader_parameter("hex_dims", hex_dims)


## Всё, что нужно функции высот: карта партии, зерно и сдвиг шума, берег главных островов и малые острова.
func apply_height_uniforms(material: ShaderMaterial) -> void:
	apply_hex_uniforms(material)
	material.set_shader_parameter("noise_offset", noise_offset())
	material.set_shader_parameter("map_seed", map_seed & 0x7FFFFFFF)

	# Клетки суши у моря: по ним шейдер считает расстояние до главных островов вдали от берега.
	var coast := PackedVector2Array()
	coast.resize(MAX_COAST_CELLS)
	var coast_count := 0
	for cell in cells:
		if not _is_coastal(cell):
			continue
		if coast_count >= MAX_COAST_CELLS:
			push_error("Клеток берега больше, чем помещается в рельеф: шельф вдали от берега будет неточным")
			break
		coast[coast_count] = cell.center()
		coast_count += 1
	material.set_shader_parameter("coast_cells", coast)
	material.set_shader_parameter("coast_count", coast_count)

	var centres := PackedVector2Array()
	var sizes := PackedVector2Array()
	centres.resize(MAX_ISLETS)
	sizes.resize(MAX_ISLETS)
	var shapes_ready := _load_shapes()
	var islet_count := mini(islets.size(), MAX_ISLETS) if shapes_ready else 0
	for i in islet_count:
		centres[i] = islets[i].position
		sizes[i] = Vector2(islets[i].radius, float(islets[i].picture))
	# Прямоугольник мира: дальше него подводный рельеф затухает к ровной глубине.
	material.set_shader_parameter("world_rect", Vector4(content_rect.position.x, content_rect.position.y, content_rect.end.x, content_rect.end.y))
	material.set_shader_parameter("islet_centre", centres)
	material.set_shader_parameter("islet_size", sizes)
	material.set_shader_parameter("islet_count", islet_count)
	if shapes_ready:
		material.set_shader_parameter("islet_shapes", _shapes_texture)
		material.set_shader_parameter("shape_extent", _shapes_extent)
		material.set_shader_parameter("shape_size", float(_shapes_size))


## Клетка суши, у которой хотя бы один сосед — море.
func _is_coastal(cell: Cell) -> bool:
	for d: Vector2i in [Vector2i(1, 0), Vector2i(1, -1), Vector2i(0, -1), Vector2i(-1, 0), Vector2i(-1, 1), Vector2i(0, 1)]:
		if terrain_at(cell.q + d.x, cell.r + d.y) == Terrain.SEA:
			return true
	return false


## Очертания малых островов: семь полей расстояний до берега одно под другим в одной текстуре.
## Файл общий для всех карт, читается один раз.
static func _load_shapes() -> bool:
	if _shapes_texture != null:
		return true
	var bytes := FileAccess.get_file_as_bytes(SHAPES_PATH)
	if bytes.size() < 19 or bytes.slice(0, 8).get_string_from_ascii() != "LOTWISL1":
		push_error("Очертания малых островов не найдены: %s" % SHAPES_PATH)
		return false
	var count := bytes.decode_u8(8)
	var size := bytes.decode_u16(9)
	var extent := bytes.decode_float(11)
	var limit := bytes.decode_float(15)
	var rows := ISLET_TITLES.size()
	var per_field := size * size
	if bytes.size() < 19 + count * (1 + per_field * 2):
		push_error("Очертания малых островов повреждены: %s" % SHAPES_PATH)
		return false
	var values := PackedFloat32Array()
	values.resize(per_field * rows)
	values.fill(limit)
	var at := 19
	for i in count:
		var picture := bytes.decode_u8(at)
		at += 1
		if picture >= 1 and picture <= rows:
			var base := (picture - 1) * per_field
			for k in per_field:
				values[base + k] = (float(bytes.decode_u16(at + k * 2)) / 65535.0 * 2.0 - 1.0) * limit
		at += per_field * 2
	var image := Image.create_from_data(size, size * rows, false, Image.FORMAT_RF, values.to_byte_array())
	_shapes_texture = ImageTexture.create_from_image(image)
	_shapes_extent = extent
	_shapes_size = size
	return true


func _measure() -> void:
	var q_min := cells[0].q
	var q_max := cells[0].q
	var r_min := cells[0].r
	var r_max := cells[0].r
	land_rect = HexMath.bounds(cells[0].q, cells[0].r)
	for cell in cells:
		q_min = mini(q_min, cell.q)
		q_max = maxi(q_max, cell.q)
		r_min = mini(r_min, cell.r)
		r_max = maxi(r_max, cell.r)
		var box := HexMath.bounds(cell.q, cell.r)
		land_rect = land_rect.merge(box)
		if island_rects.has(cell.island):
			var known: Rect2 = island_rects[cell.island]
			island_rects[cell.island] = known.merge(box)
		else:
			island_rects[cell.island] = box
	content_rect = land_rect
	for islet in islets:
		content_rect = content_rect.merge(islet.area())
	hex_origin = Vector2i(q_min - HEX_MAP_PAD, r_min - HEX_MAP_PAD)
	hex_dims = Vector2i(q_max - q_min + 1 + HEX_MAP_PAD * 2, r_max - r_min + 1 + HEX_MAP_PAD * 2)
