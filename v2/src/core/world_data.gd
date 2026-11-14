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
## Малые острова — свои, не по картинкам сайта (решение владельца 11.11): каталог лепится инструментом
## tools/islets/make.py и лежит в data/islets.bin — высоты, берег, скалы и озёра каждого острова.
const ISLETS_PATH := "res://data/islets.bin"
const MAX_COAST_CELLS := 160  ## столько клеток берега помещается в шейдер рельефа
const MAX_ISLETS := 12
const MAX_DESIGNS := 16  ## столько островов каталога помещается в шейдер рельефа


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
	var position := Vector2.ZERO  ## центр острова, метры
	var radius := 0.0  ## половина стороны штампа острова на карте, метры
	var design := 1  ## номер острова в каталоге (tools/islets/designs.py)
	var angle := 0.0  ## поворот штампа, радианы
	var mirror := 1.0  ## 1 или −1 — штамп отражён
	var quarry := false

	func title() -> String:
		return WorldData.design_title(design)

	## Точка штампа (в половинах его стороны: x — на восток, y — на юг) на карте мира.
	func to_world(uv: Vector2) -> Vector2:
		return position + Vector2(uv.x * mirror, uv.y).rotated(angle) * radius

	## Дальше этого расстояния от центра суши у острова нет, метры.
	func reach() -> float:
		return WorldData.design_value(design, "reach", 1.0) * radius

	## Во сколько раз высоты острова на карте больше, чем в каталоге: высоты растут медленнее размера.
	func height_scale() -> float:
		return pow(radius / HexMath.WORLD_SCALE / WorldData.design_value(design, "size", radius / HexMath.WORLD_SCALE), 0.75)

	## Квадрат, в который вписана суша острова.
	func area() -> Rect2:
		var half := reach() * 1.03 + 12.0 * HexMath.WORLD_SCALE
		return Rect2(position - Vector2(half, half), Vector2(half, half) * 2.0)


## Каталог малых островов (общий для всех карт, читается один раз): номер → сведения об острове.
static var _designs := {}
static var _stamps_texture: ImageTexture  ## высота и расстояние до берега, по 2 байта
static var _marks_texture: ImageTexture  ## «камень» и озеро
static var _stamp_size := 512
static var _stamp_extent := 1.15
static var _stamp_range := Vector3(-30.0, 330.0, 1.6)
const DESIGN_TITLES := {
	1: "Остров-пик",
	2: "Столовая гора",
	3: "Зелёная долина",
	4: "Подкова",
	5: "Двуглавый остров",
	6: "Остров-хребет",
	7: "Холмистый остров",
	8: "Дюны",
	9: "Шхеры",
	10: "Утёс",
	11: "Кратер",
	12: "Каменоломня",
}
const QUARRY_DESIGN := 12
## Какая земля на острове каталога (для поверхностей, шаг 1.3): доли пустыни, холмов, лугов и гор.
const DESIGN_BIOME := {
	1: Vector4(0.0, 0.15, 0.25, 0.6),
	2: Vector4(0.15, 0.75, 0.0, 0.1),
	3: Vector4(0.0, 0.1, 0.9, 0.0),
	4: Vector4(0.1, 0.35, 0.55, 0.0),
	5: Vector4(0.0, 0.2, 0.2, 0.6),
	6: Vector4(0.1, 0.5, 0.0, 0.4),
	7: Vector4(0.0, 0.7, 0.3, 0.0),
	8: Vector4(0.9, 0.1, 0.0, 0.0),
	9: Vector4(0.0, 0.3, 0.2, 0.5),
	10: Vector4(0.0, 0.2, 0.2, 0.6),
	11: Vector4(0.0, 0.1, 0.5, 0.4),
	12: Vector4(0.05, 0.7, 0.15, 0.1),
}
## Камень острова каталога: 0 — тёплый известняк, 1 — красный слоистый песчаник, 2 — серый гранит с лишайником,
## 3 — тёмная вулканическая порода.
const DESIGN_ROCK := {2: 1, 6: 1, 9: 2, 10: 2, 11: 3}

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
	if format != 1 and format != 3:  # формат 3 — со своими малыми островами (формат 2 был с картинками сайта)
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
		# В файле мира малые острова записаны в координатах доски; в мире они в WORLD_SCALE раз дальше и больше.
		islet.position = Vector2(float(row[0]), float(row[1])) * HexMath.WORLD_SCALE
		islet.radius = float(row[2]) * HexMath.WORLD_SCALE
		islet.design = int(row[3])
		islet.angle = float(row[4])
		islet.mirror = -1.0 if float(row[5]) < 0.0 else 1.0
		islet.quarry = int(row[6]) != 0
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
## Функция высот считает в координатах доски (см. HexMath): всё метрическое отдаётся ей делённым на WORLD_SCALE.
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
		coast[coast_count] = cell.center() / HexMath.WORLD_SCALE
		coast_count += 1
	material.set_shader_parameter("coast_cells", coast)
	material.set_shader_parameter("coast_count", coast_count)

	var centres := PackedVector2Array()
	var frames := PackedVector4Array()
	centres.resize(MAX_ISLETS)
	frames.resize(MAX_ISLETS)
	var ready := load_designs()
	var islet_count := mini(islets.size(), MAX_ISLETS) if ready else 0
	for i in islet_count:
		centres[i] = islets[i].position / HexMath.WORLD_SCALE
		frames[i] = Vector4(islets[i].radius / HexMath.WORLD_SCALE, float(islets[i].design), islets[i].angle, islets[i].mirror)
	var info := PackedVector4Array()
	info.resize(MAX_DESIGNS)
	var biomes := PackedVector4Array()
	biomes.resize(MAX_DESIGNS)
	for number: int in _designs:
		var d: Dictionary = _designs[number]
		info[number - 1] = Vector4(d["size"], d["shelf"], d["lake_level"], d["reach"])
		biomes[number - 1] = DESIGN_BIOME.get(number, Vector4(0.0, 0.5, 0.5, 0.0))
	material.set_shader_parameter("design_biome", biomes)
	# Прямоугольник мира: дальше него подводный рельеф затухает к ровной глубине.
	var board_rect := Rect2(content_rect.position / HexMath.WORLD_SCALE, content_rect.size / HexMath.WORLD_SCALE)
	material.set_shader_parameter("world_rect", Vector4(board_rect.position.x, board_rect.position.y, board_rect.end.x, board_rect.end.y))
	material.set_shader_parameter("islet_centre", centres)
	material.set_shader_parameter("islet_frame", frames)
	material.set_shader_parameter("islet_count", islet_count)
	material.set_shader_parameter("design_info", info)
	if ready:
		material.set_shader_parameter("islet_stamps", _stamps_texture)
		material.set_shader_parameter("islet_marks", _marks_texture)
		material.set_shader_parameter("stamp_size", _stamp_size)
		material.set_shader_parameter("stamp_extent", _stamp_extent)
		material.set_shader_parameter("stamp_range", _stamp_range)


## Клетка суши, у которой хотя бы один сосед — море.
func _is_coastal(cell: Cell) -> bool:
	for d: Vector2i in [Vector2i(1, 0), Vector2i(1, -1), Vector2i(0, -1), Vector2i(-1, 0), Vector2i(-1, 1), Vector2i(0, 1)]:
		if terrain_at(cell.q + d.x, cell.r + d.y) == Terrain.SEA:
			return true
	return false


## Название острова каталога.
static func design_title(number: int) -> String:
	return str(DESIGN_TITLES.get(number, "Островок"))


## Сведение об острове каталога: size — опорная половина стороны, shelf — ширина отмели, lake_level — уровень
## озера (−999 — озера нет), lake — центр и радиус озера (в половинах стороны), reach — досягаемость суши,
## top — вершина (u, v, высота при опорном размере).
static func design_value(number: int, key: String, fallback: Variant) -> Variant:
	load_designs()
	if not _designs.has(number):
		return fallback
	return (_designs[number] as Dictionary).get(key, fallback)


## Каталог малых островов: две текстуры (острова один под другим) и сведения о каждом. Файл общий для всех карт.
static func load_designs() -> bool:
	if _stamps_texture != null:
		return true
	var packed := FileAccess.get_file_as_bytes(ISLETS_PATH)
	if packed.size() < 32:
		push_error("Каталог малых островов не найден: %s" % ISLETS_PATH)
		return false
	# gzip хранит длину распакованных данных в последних четырёх байтах
	var bytes := packed.decompress(packed.decode_u32(packed.size() - 4), FileAccess.COMPRESSION_GZIP)
	if bytes.size() < 27 or bytes.slice(0, 8).get_string_from_ascii() != "LOTWISL2":
		push_error("Каталог малых островов повреждён: %s" % ISLETS_PATH)
		return false
	var count := bytes.decode_u8(8)
	var size := bytes.decode_u16(9)
	_stamp_extent = bytes.decode_float(11)
	_stamp_range = Vector3(bytes.decode_float(15), bytes.decode_float(19), bytes.decode_float(23))
	var per := size * size
	var at := 27
	if bytes.size() < at + count * (45 + per * 6) or count > MAX_DESIGNS:
		push_error("Каталог малых островов повреждён: %s" % ISLETS_PATH)
		return false
	var pairs := PackedByteArray()
	var marks := PackedByteArray()
	for i in count:
		var number := bytes.decode_u8(at)
		var values := PackedFloat32Array()
		for k in 11:
			values.append(bytes.decode_float(at + 1 + k * 4))
		at += 45
		if number != i + 1:  # острова идут по порядку номеров: каждый — своя полоса текстуры
			push_error("Каталог малых островов: неверный номер острова %d" % number)
			return false
		_designs[number] = {
			"size": values[0],
			"shelf": values[1],
			"lake_level": values[2],
			"lake": Vector3(values[3], values[4], values[5]),
			"reach": values[6],
			"top": Vector3(values[7], values[8], values[9]),
		}
		pairs.append_array(bytes.slice(at, at + per * 4))
		at += per * 4
		marks.append_array(bytes.slice(at, at + per * 2))
		at += per * 2
	_stamp_size = size
	_stamps_texture = ImageTexture.create_from_image(Image.create_from_data(size, size * count, false, Image.FORMAT_RGBA8, pairs))
	_marks_texture = ImageTexture.create_from_image(Image.create_from_data(size, size * count, false, Image.FORMAT_RG8, marks))
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
