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


var title := ""
var map_seed := 0
var cells: Array[Cell] = []
var sites: Array[Site] = []
var edges: Array[PackedStringArray] = []
var land_rect := Rect2()  ## прямоугольник вокруг всех гексов
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
	if int(data.get("format", 0)) != 1:
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


## Всё, что нужно функции высот: карта партии, зерно и сдвиг шума.
func apply_height_uniforms(material: ShaderMaterial) -> void:
	apply_hex_uniforms(material)
	material.set_shader_parameter("noise_offset", noise_offset())
	material.set_shader_parameter("map_seed", map_seed & 0x7FFFFFFF)


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
	hex_origin = Vector2i(q_min - HEX_MAP_PAD, r_min - HEX_MAP_PAD)
	hex_dims = Vector2i(q_max - q_min + 1 + HEX_MAP_PAD * 2, r_max - r_min + 1 + HEX_MAP_PAD * 2)
