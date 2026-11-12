class_name WorldTerrain
extends Node3D
## Земля и вода мира. Рельеф запекается один раз, по областям: главные острова, каждый малый остров отдельно
## и грубая карта глубин всего океана. Рисуется плитками с уровнями детализации: рядом с камерой сетка плотная,
## вдали — редкая. Переход между уровнями плавный: перед сменой сетки её точки сами съезжаются в положение
## более редкой (шейдер terrain_surface), поэтому рельеф не «перещёлкивает».
## Поверхности (шаг 1.3): вместе с рельефом по тем же областям запекается описание земли — что за земля в каждой
## точке (bake_ground.gdshader, сток воды — drainage.gd), а по нему — картинка земли: какие материалы на ней лежат
## (bake_surface.gdshader). Шейдер земли в кадре только читает готовое (terrain_surface.gdshader).

const SURFACE_SHADER := preload("res://src/terrain/terrain_surface.gdshader")
const WATER_SHADER := preload("res://src/terrain/water.gdshader")
## Материалы земли: 16 слоёв в двух атласах и шум (делает tools/surfaces/make.py; источники — assets/ASSETS.md).
const LAYER_ALBEDO := preload("res://assets/terrain/ground_albedo.webp")
const LAYER_NORMAL := preload("res://assets/terrain/ground_normal.jpg")
const NOISE := preload("res://assets/terrain/noise.png")

const CHUNK := 256.0  ## сторона плитки, метры
const TEXEL := 2.0  ## точность запекания суши, метров на точку
const GROUND_TEXEL := 4.0  ## точность описания земли: доли местностей меняются плавно, мелкое добавляет шейдер
const SURFACE_TEXEL := 2.0  ## точность картинки земли: материалы точки, затенение, готовый дальний вид
const TONE_TEXEL := 4.0  ## точность тона земли (сухость, цветение, оттенок песка): меняется плавно
const FLORA_TEXEL := 4.0  ## точность карт растительности (густота по видам): по ним flora.gd расставляет деревья
const MAX_CLEARINGS := 64  ## столько расчисток (города, точки старта) знает шейдер картинки земли
const CACHE_FLIGHT := 1.0  ## быстрее стольких расстояний до земли в секунду камера «летит»: кэш не считается
const MAX_ISLETS := 8  ## столько малых островов в одной области знает шейдер картинки земли
const MARGIN := 520.0  ## запас моря вокруг главных островов
const ISLET_MARGIN := 260.0  ## запас моря вокруг малого острова
## Области запекаются с запасом по краю: на стыке двух областей обе берут высоту из середины своей текстуры,
## а не с её края, — высоты совпадают, и шва нет. Запас кратен шагу самой редкой сетки.
const PAD := 16.0
const OCEAN_TEXEL := 16.0  ## точность карты глубин океана
const OCEAN_MARGIN := 2600.0  ## дальше этого от суши дно ровное
const MAX_AREAS := 16  ## больше областей суши не запекаем: каждая — отдельная текстура
const LOD_CELLS: Array[int] = [64, 32, 16]  ## клеток на сторону плитки по уровням: шаг сетки 4, 8 и 16 м
## До какого расстояния от камеры держится уровень. Шаг сетки на экране остаётся в несколько точек.
## Условие стыков без щелей: MORPH_START × второе расстояние − первое больше диагонали плитки.
const LOD_DISTANCE: Array[float] = [2000.0, 4500.0]
const MORPH_START := 0.7  ## с этой доли расстояния сетка начинает съезжаться к более редкой
const SKIRT := 24.0
## Плитки, где дно везде глубже этого, не строим: землю под водой не видно, а рисовать её — зря тратить время
## видеокарты (на тесте 0.3.0 так терялась четверть кадров над шельфом). С 0.7.2 вода прозрачна только у самого
## уреза (первые 20 см глубины), дно глубже рисует она сама (water.gdshader) — земля под водой нужна лишь там,
## куда вода отходит при накате; запас оставлен прежний.
const DEEP_CUTOFF := -4.0
const SEA_SIZE := 200000.0  ## море уходит за горизонт: его край тонет в дымке


class Chunk:
	var instance: MeshInstance3D
	var area := Rect2()  ## плитка на земле (x, z)
	var lod := -1


## Область, запечённая отдельной текстурой: главные острова или малый остров с морем вокруг.
class Region:
	var title := ""
	var area := Rect2()  ## плитки области (края кратны стороне плитки)
	var baked := Rect2()  ## что запечено: область с запасом по краю
	var height_map: HeightMap
	var material: ShaderMaterial  ## земля
	var water_material: ShaderMaterial  ## вода над областью
	var baker: TerrainBaker  ## нужен, пока расставляем озёра
	var ground_a: Texture2D  ## описание земли: доли местностей (нужно, пока запекается картинка)
	var ground_b: Texture2D  ## описание земли: озеро рядом, от уреза моря, камень, оазис
	var ground_c: Texture2D  ## сток воды по рельефу (drainage.gd)
	var islet: WorldData.Islet  ## малый остров области (у области главных островов — пусто)
	## Картинка земли (bake_surface.gdshader): три главных материала точки, их доли, тон, затенение, дальний вид.
	var splat_index: Texture2D
	var splat_weight: Texture2D
	var surface_tone: Texture2D
	var surface_shade: Texture2D
	var surface_color: Texture2D
	## Карты растительности (шаг 1.8; bake_surface.gdshader, части 5–7): густота по видам, шаг FLORA_TEXEL.
	var flora: Array[Image] = []


var height_map: HeightMap  ## высоты главных островов; малые острова — в его extras
var lakes: Array[Dictionary] = []  ## озёра и пруды: клетка и уровень воды
var ponds: Array[Dictionary] = []  ## озёра малых островов: номер острова и уровень воды
var bake_rect := Rect2()  ## область главных островов
var ocean_rect := Rect2()  ## область карты глубин
var bake_ms := 0.0
var drainage_ms := 0.0  ## из них — расчёт стока воды на процессоре
var surface_ms := 0.0  ## и запекание картинки земли
var error := ""
## Сколько квадратных метров суши ниже высоты наката закрыто для моря (см. _swash_mask): дно глубоких озёр и ложбины
## за берегом, с морем не связанные. И две самые низкие такие точки — на дне озера и в ложбине вне озёр (её может
## и не быть: тогда высота — INF); по ним облёт проверяет, что море там не рисуется.
var swash_closed := 0.0
var swash_closed_place := Vector2.ZERO
var swash_closed_height := INF
var swash_hollow_place := Vector2.ZERO
var swash_hollow_height := INF
var swash_mask_ms := 0.0

var _regions: Array[Region] = []
## Области в порядке, в каком они получают плитки мира: сначала области малых островов, потом главные острова.
## Так малый остров целиком рисуется из своей области — и не разрезан границей плиток пополам.
var _owners: Array[Region] = []
var _owned := {}  ## плитки мира Vector2i(x, z) / CHUNK, над которыми вода своей области (остальное — открытое море)
var _lod_meshes: Array[ArrayMesh] = []
var _chunks: Array[Chunk] = []
var _viewer := Vector3.ZERO
var _viewer_known := false
var _grid_visible := true
var _debug_view := 0
var _flat_shader: Shader
var _cache: NearCache  ## кэш ближнего вида вокруг камеры
var _cache_focus := Vector2.ZERO
var _cache_focus_known := false
## Сколько клеток кэша считается за кадр (см. NearCache.BUDGET); ноль — кэш не строится и не читается.
var cache_budget := NearCache.BUDGET

var _water_materials: Array[ShaderMaterial] = []  ## вода областей и открытого моря
var _storm := 0.0  ## доля шторма в виде воды, 0…1
var _water_time := 0.0  ## накопленное время воды (секунды, умноженные на её скорость)
var _swash_time := 0.0  ## время наката: секунды по часам — у наката свой ритм, от скорости воды не зависит
var _wave_map: ImageTexture  ## рябь и пятна пены — одни на всю воду
var _foam_map: Array = []  ## текстура пятен, множитель и сдвиг её значений (WaterLook.make_foam_map)
var _sea_meshes: Array[MeshInstance3D] = []  ## полотна моря: поднимаются на высоту наката
var _lake_meshes: Array[MeshInstance3D] = []  ## вода озёр и прудов
var _lake_discs: PackedVector3Array = []  ## их круги: x, z и радиус
var _swash_closed_cells: PackedVector3Array = []  ## закрытая для моря низкая суша: x, z и высота
var _swash_masks: Array[ImageTexture] = []  ## маски наката областей, по порядку областей
## Скорость воды и высота наката на берег — в ясную погоду (x) и в шторм (y); подбираются ползунками.
var _water_speed := WaterLook.SPEED
var _water_swash := WaterLook.SWASH


## Сопрограмма: строит землю по данным мира. true — готово, иначе причина в error.
func build(world: WorldData) -> bool:
	var started := Time.get_ticks_usec()
	var main_area := _snap(world.land_rect.grow(MARGIN))
	var areas: Array[Rect2] = [main_area]
	var titles: Array[String] = ["главные острова"]
	var owners: Array[WorldData.Islet] = [null]
	for islet in world.islets:
		var area := _snap(islet.area().grow(ISLET_MARGIN))
		if main_area.encloses(area):
			continue  # остров целиком в области главных островов: запечён вместе с ними
		if areas.size() >= MAX_AREAS:
			push_error("Малых островов вне главной области больше, чем запекается отдельно")
			break
		areas.append(area)
		titles.append(islet.title())
		owners.append(islet)

	for i in areas.size():
		var region := Region.new()
		region.title = titles[i]
		region.area = areas[i]
		region.baked = areas[i].grow(PAD)
		region.baker = TerrainBaker.new()
		add_child(region.baker)
		var done: bool = await region.baker.bake(world, region.baked, TEXEL)
		if not done:
			error = "%s — %s" % [region.title, region.baker.error]
			return false
		region.height_map = region.baker.height_map
		region.islet = owners[i]
		# Описание земли для поверхностей: две текстуры на область.
		for part in 2:
			var ground_baker := TerrainBaker.new()
			add_child(ground_baker)
			var ground_done: bool = await ground_baker.bake(world, region.baked, GROUND_TEXEL, part)
			if not ground_done:
				error = "%s, описание земли — %s" % [region.title, ground_baker.error]
				return false
			if part == 0:
				region.ground_a = ground_baker.texture
			else:
				region.ground_b = ground_baker.texture
			ground_baker.queue_free()
		# Сток воды по рельефу: сеть ложбин и русел, по которой шейдер земли раскладывает влажность и промоины.
		var drain_started := Time.get_ticks_usec()
		region.ground_c = Drainage.flow_texture(region.baker.baked_image())
		drainage_ms += float(Time.get_ticks_usec() - drain_started) / 1000.0
		_regions.append(region)

	# Карта глубин всего океана: по ней открытое море темнеет над глубиной и светлеет над шельфом.
	ocean_rect = _snap(world.content_rect.grow(OCEAN_MARGIN))
	var ocean_baker := TerrainBaker.new()
	add_child(ocean_baker)
	var ocean_done: bool = await ocean_baker.bake(world, ocean_rect, OCEAN_TEXEL)
	if not ocean_done:
		error = "карта глубин — %s" % ocean_baker.error
		return false

	bake_rect = main_area
	height_map = _regions[0].height_map
	for i in range(1, _regions.size()):
		height_map.extras.append(_regions[i].height_map)
		height_map.highest = maxf(height_map.highest, _regions[i].height_map.highest)

	# Картинка земли: по описанию земли каждой области. Снеговая линия — от самой высокой горы карты, поэтому
	# картинка запекается, когда высоты всех областей уже известны.
	var surface_started := Time.get_ticks_usec()
	for region in _regions:
		var painted: bool = await _bake_surface(world, region)
		if not painted:
			return false
	surface_ms = float(Time.get_ticks_usec() - surface_started) / 1000.0

	for i in range(1, _regions.size()):
		_owners.append(_regions[i])
	_owners.append(_regions[0])
	for region in _regions:
		region.material = _make_terrain_material(world, region)
		region.water_material = _make_water_material(region.baker.texture, region.baked)
		region.water_material.set_shader_parameter("swash_mask", _swash_mask(region))
	_cache = NearCache.new()
	add_child(_cache)
	for cells in LOD_CELLS:
		_lod_meshes.append(_make_grid(cells, CHUNK))
	_build_chunks()
	_build_ocean(ocean_baker.texture)
	_build_lakes(world)
	_build_islet_lakes(world)
	_find_swash_places()

	for region in _regions:
		region.baker.queue_free()
		region.baker = null
	ocean_baker.queue_free()
	bake_ms = float(Time.get_ticks_usec() - started) / 1000.0
	return true


## Куда накату моря хода нет. Шейдер воды рисует море везде, где земля ниже уровня наката (полотно моря поднято
## на его высоту), — а ниже него бывает и суша, с морем не связанная: дно глубоких озёр (светлые пятна на озёрах
## в 0.7.4) и ложбины за берегом на малых островах. Здесь от моря по низкой суше идёт заливка (клетка — 4 м); низкая
## суша, до которой она не дошла, в маске закрыта вместе с соседними клетками, и вода моря там не рисуется.
## Считается при каждой постройке мира: по одной точке на клетку, доли секунды.
func _swash_mask(region: Region) -> ImageTexture:
	const STEP := 2  # клетка маски — две точки запекания
	var started := Time.get_ticks_usec()
	var map := region.height_map
	var data := map.raw()
	var columns := map.width / STEP
	var rows := map.height / STEP
	# Выше высоты наката вода не поднимается; запас — на неровности внутри клетки.
	var limit := maxf(WaterLook.SWASH.x, WaterLook.SWASH.y) + 0.3
	# 0 — высокая суша, 1 — низкая суша, 2 — море, 3 — низкая суша, куда море доходит.
	var state := PackedByteArray()
	state.resize(columns * rows)
	var low := PackedInt32Array()
	for row in rows:
		var from := row * STEP * map.width
		var at := row * columns
		for column in columns:
			var height := data[from + column * STEP]
			if height < 0.0:
				state[at + column] = 2
			elif height < limit:
				state[at + column] = 1
				low.append(at + column)
	var front := PackedInt32Array()
	for cell in low:
		var column := cell % columns
		if (column > 0 and state[cell - 1] == 2) or (column < columns - 1 and state[cell + 1] == 2) \
				or (cell >= columns and state[cell - columns] == 2) or (cell + columns < state.size() and state[cell + columns] == 2):
			state[cell] = 3
			front.append(cell)
	while not front.is_empty():
		var next := PackedInt32Array()
		for cell in front:
			var column := cell % columns
			for neighbour: int in [cell - 1 if column > 0 else -1, cell + 1 if column < columns - 1 else -1, cell - columns, cell + columns]:
				if neighbour >= 0 and neighbour < state.size() and state[neighbour] == 1:
					state[neighbour] = 3
					next.append(neighbour)
		front = next
	var mask := PackedByteArray()
	mask.resize(columns * rows)
	mask.fill(255)
	var cell_size := map.texel * float(STEP)
	for cell in low:
		if state[cell] != 1:
			continue
		var column := cell % columns
		var row := cell / columns
		swash_closed += cell_size * cell_size
		var place := map.rect.position + Vector2((float(column) + 0.5) * cell_size, (float(row) + 0.5) * cell_size)
		_swash_closed_cells.append(Vector3(place.x, place.y, data[row * STEP * map.width + column * STEP]))
		for y in range(maxi(row - 1, 0), mini(row + 2, rows)):
			for x in range(maxi(column - 1, 0), mini(column + 2, columns)):
				mask[y * columns + x] = 0
	swash_mask_ms += float(Time.get_ticks_usec() - started) / 1000.0
	var texture := ImageTexture.create_from_image(Image.create_from_data(columns, rows, false, Image.FORMAT_R8, mask))
	_swash_masks.append(texture)
	return texture


## Самые низкие точки суши, закрытой для моря: вся и та, что вне кругов озёр (там море прячет только маска).
func _find_swash_places() -> void:
	for cell in _swash_closed_cells:
		var place := Vector2(cell.x, cell.y)
		if cell.z < swash_closed_height:
			swash_closed_height = cell.z
			swash_closed_place = place
		if cell.z >= swash_hollow_height:
			continue
		var in_lake := false
		for disc in _lake_discs:
			if place.distance_to(Vector2(disc.x, disc.y)) < disc.z:
				in_lake = true
				break
		if not in_lake:
			swash_hollow_height = cell.z
			swash_hollow_place = place
	_swash_closed_cells.clear()


## Включить или выключить маску наката (для проверки облёта: без маски море в ложбинах за берегом появляется).
func set_swash_mask_enabled(enabled: bool) -> void:
	for i in mini(_regions.size(), _swash_masks.size()):
		_regions[i].water_material.set_shader_parameter("swash_mask", _swash_masks[i] if enabled else null)


## Области с картами растительности — для flora.gd: что запечено (прямоугольник мира), шаг карт, сами карты
## (три картинки: см. bake_surface.gdshader, части 5–7) и высоты области.
func flora_regions() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	for region in _regions:
		if region.flora.size() == 3:
			result.append({"rect": region.baked, "area": region.area, "texel": FLORA_TEXEL, "maps": region.flora,
					"heights": region.height_map, "title": region.title})
	return result


## Показать или спрятать воду озёр (для проверки облёта: под ней не должно быть воды моря).
func set_lakes_visible(shown: bool) -> void:
	for lake in _lake_meshes:
		lake.visible = shown


## Откуда смотрит камера: от этого зависит детализация плиток. Шейдер получает ту же точку и по ней плавно
## сводит сетку к более редкой; уровень плитки выбирается по её ближайшей к камере точке — так ко времени
## смены сетки все точки плитки уже стоят в положении новой.
func set_viewer(position_in_world: Vector3) -> void:
	if _regions.is_empty() or (_viewer_known and position_in_world.is_equal_approx(_viewer)):
		return
	_viewer = position_in_world
	_viewer_known = true
	for region in _regions:
		region.material.set_shader_parameter("viewer_position", _viewer)
	for chunk in _chunks:
		var dx := maxf(maxf(chunk.area.position.x - _viewer.x, _viewer.x - chunk.area.end.x), 0.0)
		var dz := maxf(maxf(chunk.area.position.y - _viewer.z, _viewer.z - chunk.area.end.y), 0.0)
		var lod := _pick_lod(sqrt(dx * dx + dz * dz + _viewer.y * _viewer.y))
		if lod != chunk.lod:
			_set_lod(chunk, lod)


func set_grid_visible(visible_now: bool) -> void:
	_grid_visible = visible_now
	for region in _regions:
		region.material.set_shader_parameter("grid_strength", 0.5 if visible_now else 0.0)


func is_grid_visible() -> bool:
	return _grid_visible


## Проверка географии (для разработчика): 1 — влажность, 2 — сток, 3 — крутизна, 4 — ложбины и гребни; 0 — картинка.
func debug_view() -> int:
	return _debug_view


## Раз в кадр: кэш ближнего вида идёт за камерой. eye — камера; focus — точка земли, на которую она смотрит;
## pixel — сколько метров земли приходится на точку экрана в середине кадра; delta — время кадра.
func update_cache(eye: Vector3, focus: Vector2, pixel: float, delta: float) -> void:
	if _cache == null:
		return
	if cache_budget <= 0:
		_cache.bind(null)
		return
	var region := _region_at(focus)
	_cache.bind(region.material if region != null else null)
	var ground := Vector3(focus.x, maxf(height_map.sample(focus), 0.0), focus.y)
	# Камера летит (перелёт к месту, облёт): окна уровней уходят быстрее, чем досчитываются, — считать незачем.
	# Порог — расстояние до земли в секунду: клавишами камера едет медленнее (0,85 расстояния в секунду), перелёты
	# быстрее. До 0.5.5 порог был в два с половиной раза выше, и на перелётах кэш строился впустую — замер
	# владельца на 0.5.4: облёт дальних мест стал на 7–10 % медленнее.
	var speed := focus.distance_to(_cache_focus) / maxf(delta, 1.0e-4) if _cache_focus_known else 0.0
	_cache_focus = focus
	_cache_focus_known = true
	_cache.update(eye, ground, pixel, cache_budget, speed > CACHE_FLIGHT * eye.distance_to(ground))


## Кэш вокруг камеры посчитан целиком (или не нужен на этой высоте).
func cache_ready(pixel: float) -> bool:
	return _cache == null or cache_budget <= 0 or _cache.is_ready(pixel)


func cache() -> NearCache:
	return _cache


## Для замера по частям: земля тем же рельефом, но одним цветом, без материалов (сколько стоит шейдер земли).
func set_flat(flat: bool) -> void:
	if _flat_shader == null:
		var code := SURFACE_SHADER.code
		_flat_shader = Shader.new()
		_flat_shader.code = code.substr(0, code.find("void fragment()")) + "void fragment() {\n\tALBEDO = vec3(0.4, 0.45, 0.3);\n\tROUGHNESS = 0.85;\n}\n"
	for region in _regions:
		region.material.shader = _flat_shader if flat else SURFACE_SHADER


func set_debug_view(view: int) -> void:
	_debug_view = view
	for region in _regions:
		region.material.set_shader_parameter("debug_view", view)
	if _cache != null:
		_cache.set_debug_view(view)


func chunk_count() -> int:
	return _chunks.size()


func region_count() -> int:
	return _regions.size()


## Сколько точек рельефа запечено во всех областях суши.
func baked_points() -> int:
	var total := 0
	for region in _regions:
		total += region.height_map.width * region.height_map.height
	return total


func _pick_lod(distance: float) -> int:
	for i in LOD_DISTANCE.size():
		if distance < LOD_DISTANCE[i]:
			return i
	return LOD_DISTANCE.size()


## Сетка плитки и сглаживание высот под её шаг: высоты берутся из уменьшенной копии запечённого рельефа.
func _set_lod(chunk: Chunk, lod: int) -> void:
	chunk.lod = lod
	chunk.instance.mesh = _lod_meshes[lod]
	chunk.instance.set_instance_shader_parameter("height_lod", float(lod))


## Область по сетке плиток: края кратны стороне плитки, так плитки соседних областей совпадают.
static func _snap(area: Rect2) -> Rect2:
	var x0 := floorf(area.position.x / CHUNK) * CHUNK
	var z0 := floorf(area.position.y / CHUNK) * CHUNK
	var x1 := ceilf(area.end.x / CHUNK) * CHUNK
	var z1 := ceilf(area.end.y / CHUNK) * CHUNK
	return Rect2(x0, z0, x1 - x0, z1 - z0)


func _make_terrain_material(world: WorldData, region: Region) -> ShaderMaterial:
	var material := ShaderMaterial.new()
	material.shader = SURFACE_SHADER
	world.apply_hex_uniforms(material)
	material.set_shader_parameter("height_map", region.baker.texture)
	material.set_shader_parameter("normal_map", region.baker.texture)
	material.set_shader_parameter("noise_shift", world.noise_offset())
	material.set_shader_parameter("debug_view", _debug_view)
	material.set_shader_parameter("layer_albedo", LAYER_ALBEDO)
	material.set_shader_parameter("layer_normal", LAYER_NORMAL)
	material.set_shader_parameter("noise_map", NOISE)
	material.set_shader_parameter("splat_index", region.splat_index)
	material.set_shader_parameter("splat_weight", region.splat_weight)
	material.set_shader_parameter("surface_tone", region.surface_tone)
	material.set_shader_parameter("surface_shade", region.surface_shade)
	material.set_shader_parameter("surface_color", region.surface_color)
	material.set_shader_parameter("splat_texel", SURFACE_TEXEL)
	material.set_shader_parameter("bake_rect", Vector4(region.baked.position.x, region.baked.position.y, region.baked.size.x, region.baked.size.y))
	material.set_shader_parameter("skirt_depth", SKIRT)
	material.set_shader_parameter("grid_strength", 0.5 if _grid_visible else 0.0)
	material.set_shader_parameter("lod_distance", Vector2(LOD_DISTANCE[0], LOD_DISTANCE[1]))
	material.set_shader_parameter("morph_start", MORPH_START)
	return material


## Сопрограмма: картинка земли области — пять текстур (см. bake_surface.gdshader). После неё описание земли
## области больше не нужно и освобождается.
func _bake_surface(world: WorldData, region: Region) -> bool:
	# Малые острова, чья суша заходит в область: у каждого своя порода, и остров узнаётся по месту.
	var islets := PackedVector4Array()
	islets.resize(MAX_ISLETS)
	var islet_count := 0
	for islet in world.islets:
		var reach := islet.reach() + 60.0
		var nearest := Vector2(
				clampf(islet.position.x, region.baked.position.x, region.baked.end.x),
				clampf(islet.position.y, region.baked.position.y, region.baked.end.y))
		if nearest.distance_to(islet.position) > reach or islet_count >= MAX_ISLETS:
			continue
		islets[islet_count] = Vector4(islet.position.x, islet.position.y, reach, float(WorldData.DESIGN_ROCK.get(islet.design, 0)))
		islet_count += 1
	var parameters := {
		"height_map": region.baker.texture,
		"ground_a": region.ground_a,
		"ground_b": region.ground_b,
		"ground_c": region.ground_c,
		"noise_map": NOISE,
		"layer_albedo": LAYER_ALBEDO,
		"noise_shift": world.noise_offset(),
		# Снег — только на самых высоких вершинах карты (замечание владельца к 0.5.0: не у всех гор снежные шапки).
		"snow_line": clampf(height_map.highest * 0.8, 95.0, 140.0),
		"islets": islets,
		"islet_count": islet_count,
		"debug_view": _debug_view,
	}
	# Расчистки: в городах и на точках старта деревья и кусты не растут (край расчистки неровный — шейдер).
	var clearings := PackedVector4Array()
	clearings.resize(MAX_CLEARINGS)
	var clearing_count := 0
	for site in world.sites:
		if site.kind == "EMPTY" or clearing_count >= MAX_CLEARINGS or not region.baked.grow(80.0).has_point(site.position):
			continue
		clearings[clearing_count] = Vector4(site.position.x, site.position.y, 48.0 if site.kind == "CITY" else 30.0, 0.0)
		clearing_count += 1
	parameters["clearings"] = clearings
	parameters["clearing_count"] = clearing_count
	region.flora.clear()
	for part in 8:
		var baker := TerrainBaker.new()
		add_child(baker)
		var step := SURFACE_TEXEL
		if part == 2:
			step = TONE_TEXEL
		elif part >= 5:
			step = FLORA_TEXEL
		var done: bool = await baker.bake_surface(region.baked, step, part, parameters)
		if not done:
			error = "%s, картинка земли — %s" % [region.title, baker.error]
			return false
		if part >= 5:
			region.flora.append(baker.take_image())
		else:
			var texture := baker.take_texture(part == 4)
			match part:
				0: region.splat_index = texture
				1: region.splat_weight = texture
				2: region.surface_tone = texture
				3: region.surface_shade = texture
				4: region.surface_color = texture
		baker.queue_free()
	region.ground_a = null
	region.ground_b = null
	region.ground_c = null
	return true


func _make_water_material(texture: Texture2D, area: Rect2) -> ShaderMaterial:
	if _wave_map == null:
		_wave_map = WaterLook.make_wave_map()
		_foam_map = WaterLook.make_foam_map()
	var material := ShaderMaterial.new()
	material.shader = WATER_SHADER
	material.set_shader_parameter("height_map", texture)
	material.set_shader_parameter("bake_rect", Vector4(area.position.x, area.position.y, area.size.x, area.size.y))
	material.set_shader_parameter("wave_map", _wave_map)
	material.set_shader_parameter("wave_cycles", WaterLook.WAVE_CYCLES)
	material.set_shader_parameter("foam_map", _foam_map[0])
	material.set_shader_parameter("foam_cycles", WaterLook.FOAM_CYCLES)
	material.set_shader_parameter("foam_gain", _foam_map[1])
	material.set_shader_parameter("foam_bias", _foam_map[2])
	WaterLook.apply(material, water_now())
	_water_materials.append(material)
	return material


## Доля шторма в воде, 0…1: волнение, цвет, пена и большие волны перетекают от штиля к шторму.
func set_storm(share: float) -> void:
	if is_equal_approx(share, _storm):
		return
	_storm = clampf(share, 0.0, 1.0)
	_apply_water()


func storm() -> float:
	return _storm


## Карта облаков и объёмный шум (weather.gd): по ним шейдеры земли и воды кладут тени облаков и завесы дождя.
func set_cloud_textures(map: Texture2D, noise: Texture3D) -> void:
	for region in _regions:
		if region.material != null:
			region.material.set_shader_parameter("cloud_map", map)
			region.material.set_shader_parameter("cloud_noise", noise)
	for material in _water_materials:
		material.set_shader_parameter("cloud_map", map)
		material.set_shader_parameter("cloud_noise", noise)


## Скорость воды и высота наката (метры): x — в ясную погоду, y — в шторм.
func set_water_tuning(speed: Vector2, swash: Vector2) -> void:
	_water_speed = speed
	_water_swash = swash
	_apply_water()


## Вид воды сейчас: между штилем и штормом, с подобранной высотой наката.
func water_now() -> Dictionary:
	var look: Dictionary = WaterLook.at(_storm).duplicate()
	look["swash"] = lerpf(_water_swash.x, _water_swash.y, _storm)
	return look


## Вода ушла вперёд на delta секунд — со своей скоростью: в шторм она быстрее.
func advance_water(delta: float) -> void:
	_water_time += delta * lerpf(_water_speed.x, _water_speed.y, _storm)
	_swash_time += delta
	_push_water_time()


## Время воды, секунды: рябь, пена и накат движутся по нему. В кадрах проверок оно стоит.
func set_water_time(seconds: float) -> void:
	_water_time = seconds
	_swash_time = seconds
	_push_water_time()


func _push_water_time() -> void:
	for material in _water_materials:
		material.set_shader_parameter("water_time", _water_time)
		material.set_shader_parameter("swash_time", _swash_time)


func _apply_water() -> void:
	var look := water_now()
	for material in _water_materials:
		WaterLook.apply(material, look)
	# Полотно моря стоит на высоте самого высокого наката: берег выше обычного уреза иначе закрывал бы воду,
	# и взбежать на него она не могла бы. Где воды сейчас нет, полотно прозрачно.
	for sea in _sea_meshes:
		sea.position.y = float(look["swash"])


## Плитки земли и вода над ними. Плитка мира принадлежит первой области, в которую попала: области
## могут перекрываться (малый остров рядом с главным), а земля и вода не должны рисоваться дважды.
## Первыми плитки получают области малых островов (см. _owners).
func _build_chunks() -> void:
	var coarsest := _lod_meshes.size() - 1
	for region in _owners:
		var columns := roundi(region.area.size.x / CHUNK)
		var rows := roundi(region.area.size.y / CHUNK)
		var water_tiles := PackedFloat32Array()
		for row in rows:
			for column in columns:
				var origin := Vector2(region.area.position.x + float(column) * CHUNK, region.area.position.y + float(row) * CHUNK)
				var key := Vector2i(roundi(origin.x / CHUNK), roundi(origin.y / CHUNK))
				if _owned.has(key):
					continue
				_owned[key] = true
				water_tiles.append_array(PackedFloat32Array([origin.x, origin.y, origin.x + CHUNK, origin.y + CHUNK]))

				var heights := region.height_map.range_in(Rect2(origin, Vector2(CHUNK, CHUNK)))
				if heights.y < DEEP_CUTOFF:
					continue
				var instance := MeshInstance3D.new()
				instance.material_override = region.material
				instance.position = Vector3(origin.x, 0.0, origin.y)
				# Высоту точкам даёт шейдер, поэтому границы плитки для отсечения задаём сами.
				instance.custom_aabb = AABB(
						Vector3(0.0, heights.x - SKIRT - 2.0, 0.0),
						Vector3(CHUNK, heights.y - heights.x + SKIRT + 4.0, CHUNK))
				add_child(instance)
				var chunk := Chunk.new()
				chunk.instance = instance
				chunk.area = Rect2(origin, Vector2(CHUNK, CHUNK))
				_set_lod(chunk, coarsest)
				_chunks.append(chunk)

		if water_tiles.is_empty():
			continue
		var water := MeshInstance3D.new()
		water.name = "Water"
		_sea_meshes.append(water)
		water.mesh = _make_quads(water_tiles)
		water.material_override = region.water_material
		water.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		water.set_instance_shader_parameter("water_level", 0.0)
		add_child(water)


## Открытое море: плитки по 256 м везде, где нет воды областей, и полосы до горизонта. Цвет берёт из карты глубин.
## Края плиток моря и воды областей совпадают точь-в-точь, поэтому на границе нет ни щели, ни наложения —
## и со сглаживанием краёв тоже (раньше море вырезалось по точкам экрана, и на границе проступала светлая черта).
func _build_ocean(depth_texture: Texture2D) -> void:
	var material := _make_water_material(depth_texture, ocean_rect)
	material.set_shader_parameter("open_sea", true)
	var sea := MeshInstance3D.new()
	sea.name = "Ocean"
	_sea_meshes.append(sea)
	sea.mesh = _make_ocean_mesh()
	sea.material_override = material
	sea.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sea.set_instance_shader_parameter("water_level", 0.0)
	add_child(sea)


func _make_ocean_mesh() -> ArrayMesh:
	var columns := roundi(ocean_rect.size.x / CHUNK)
	var rows := roundi(ocean_rect.size.y / CHUNK)
	var x0 := ocean_rect.position.x
	var z0 := ocean_rect.position.y
	var x1 := x0 + float(columns) * CHUNK
	var z1 := z0 + float(rows) * CHUNK
	var far := SEA_SIZE * 0.5
	var tiles := PackedFloat32Array()
	for row in rows:
		for column in columns:
			var tx := x0 + float(column) * CHUNK
			var tz := z0 + float(row) * CHUNK
			if not _owned.has(Vector2i(roundi(tx / CHUNK), roundi(tz / CHUNK))):
				tiles.append_array(PackedFloat32Array([tx, tz, tx + CHUNK, tz + CHUNK]))
	# Полосы до горизонта: каждая плитка края продолжается наружу, так что и здесь края совпадают.
	for column in columns:
		var tx := x0 + float(column) * CHUNK
		tiles.append_array(PackedFloat32Array([tx, z0 - far, tx + CHUNK, z0]))
		tiles.append_array(PackedFloat32Array([tx, z1, tx + CHUNK, z1 + far]))
	for row in rows:
		var tz := z0 + float(row) * CHUNK
		tiles.append_array(PackedFloat32Array([x0 - far, tz, x0, tz + CHUNK]))
		tiles.append_array(PackedFloat32Array([x1, tz, x1 + far, tz + CHUNK]))
	tiles.append_array(PackedFloat32Array([x0 - far, z0 - far, x0, z0, x1, z0 - far, x1 + far, z0]))
	tiles.append_array(PackedFloat32Array([x0 - far, z1, x0, z1 + far, x1, z1, x1 + far, z1 + far]))
	return _make_quads(tiles)


## Плоские квадраты на уровне моря, лицом вверх. tiles — по четыре числа на квадрат: x и z одного угла, x и z
## противоположного. Координаты кратны стороне плитки и точны в числах видеокарты: соседние квадраты из разных
## полотен сходятся без щелей.
static func _make_quads(tiles: PackedFloat32Array) -> ArrayMesh:
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var indices := PackedInt32Array()
	for i in range(0, tiles.size(), 4):
		var first := vertices.size()
		vertices.append(Vector3(tiles[i], 0.0, tiles[i + 1]))
		vertices.append(Vector3(tiles[i + 2], 0.0, tiles[i + 1]))
		vertices.append(Vector3(tiles[i + 2], 0.0, tiles[i + 3]))
		vertices.append(Vector3(tiles[i], 0.0, tiles[i + 3]))
		for corner in 4:
			normals.append(Vector3.UP)
		# По часовой стрелке, если смотреть сверху: лицевая сторона — вверх.
		indices.append_array(PackedInt32Array([first, first + 1, first + 2, first, first + 2, first + 3]))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


## Область, которой принадлежит точка (та же, что рисует там землю и воду).
func _region_at(point: Vector2) -> Region:
	for region in _owners:
		if region.area.has_point(point):
			return region
	return null


## Область, в запечённом квадрате которой прямоугольник лежит целиком (иначе — та, где его середина).
func _region_holding(rect: Rect2) -> Region:
	for region in _owners:
		if region.baked.encloses(rect):
			return region
	return _region_at(rect.get_center())


## Озёра и пруды оазисов. Форму и уровень воды задаёт функция высот: уровень запечён рядом с высотой.
## Вода — плоский круг на этом уровне; шейдер рисует его только в котловине своего озера.
## Соседние водные клетки с общим уровнем — одно озеро: на них один круг, иначе вода легла бы в два слоя.
func _build_lakes(world: WorldData) -> void:
	lakes.clear()
	var main := _regions[0]
	var levels := {}  # клетка Vector2i(q, r) → уровень воды
	var is_lake := {}
	for cell in world.cells:
		if cell.terrain != WorldData.Terrain.WATER and cell.terrain != WorldData.Terrain.OASIS:
			continue
		var level := _find_water_level(main.baker, cell.center())
		if level <= TerrainBaker.NO_WATER + 1.0:
			continue
		var at := Vector2i(cell.q, cell.r)
		levels[at] = level
		is_lake[at] = cell.terrain == WorldData.Terrain.WATER
		lakes.append({"q": cell.q, "r": cell.r, "lake": is_lake[at], "level": level})

	var seen := {}
	for start: Vector2i in levels:
		if seen.has(start):
			continue
		var level: float = levels[start]
		var group: Array[Vector2i] = [start]
		seen[start] = true
		var index := 0
		while index < group.size():
			var at := group[index]
			index += 1
			for step: Vector2i in [Vector2i(1, 0), Vector2i(1, -1), Vector2i(0, -1), Vector2i(-1, 0), Vector2i(-1, 1), Vector2i(0, 1)]:
				var next := at + step
				if levels.has(next) and not seen.has(next) and absf(float(levels[next]) - level) < 0.02:
					seen[next] = true
					group.append(next)
		var centre := Vector2.ZERO
		var with_lake := false
		for at in group:
			centre += HexMath.center(at.x, at.y)
			with_lake = with_lake or bool(is_lake[at])
		centre /= float(group.size())
		var reach := 0.0
		for at in group:
			reach = maxf(reach, centre.distance_to(HexMath.center(at.x, at.y)))
		_add_water_disc(main, centre, reach + (HexMath.SIZE * 2.4 if with_lake else 70.0), level)


## Озёра малых островов (долина, кратер, лагуна среди дюн): где озеро на штампе, знает каталог островов.
func _build_islet_lakes(world: WorldData) -> void:
	ponds.clear()
	for i in world.islets.size():
		var islet := world.islets[i]
		if float(WorldData.design_value(islet.design, "lake_level", TerrainBaker.NO_WATER)) <= TerrainBaker.NO_WATER + 1.0:
			continue
		var lake: Vector3 = WorldData.design_value(islet.design, "lake", Vector3.ZERO)
		var centre := islet.to_world(Vector2(lake.x, lake.y))
		var radius := lake.z * islet.radius * 1.2 + 30.0
		# Вода озера берёт уровень и глубину из запечённой области, где озеро лежит целиком: у края области
		# (озеро кратера на краю области главных островов) за краем уровня нет — вода обрывалась прямой линией.
		var region := _region_holding(Rect2(centre - Vector2(radius, radius), Vector2(radius, radius) * 2.0))
		if region == null:
			continue
		var level := _find_water_level(region.baker, centre)
		if level <= TerrainBaker.NO_WATER + 1.0:
			continue
		_add_water_disc(region, centre, radius, level)
		ponds.append({"islet": i, "level": level})


func _add_water_disc(region: Region, centre: Vector2, radius: float, level: float) -> void:
	var water := MeshInstance3D.new()
	water.mesh = _make_disc(radius)
	water.material_override = region.water_material
	water.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	water.position = Vector3(centre.x, level, centre.y)
	water.set_instance_shader_parameter("water_level", level)
	_lake_meshes.append(water)
	_lake_discs.append(Vector3(centre.x, centre.y, radius))
	add_child(water)


## Уровень воды озера клетки: ищем его рядом с центром гекса, расходясь кругами (чаша смещена от центра).
func _find_water_level(baker: TerrainBaker, centre: Vector2) -> float:
	for ring in 6:
		var points := maxi(ring * 8, 1)
		for i in points:
			var angle := TAU * float(i) / float(points)
			var level := baker.water_level_at(centre + Vector2(cos(angle), sin(angle)) * float(ring) * 9.0)
			if level > TerrainBaker.NO_WATER + 1.0:
				return level
	return TerrainBaker.NO_WATER


## Плоская сетка плитки. Высоту точкам даёт шейдер; по краю — «юбка» (UV.x = 1), закрывающая щели.
## UV2 — на сколько метров точка съезжает к ближайшей точке вдвое более редкой сетки (у чётных точек ноль):
## когда все нечётные точки съехали, сетка совпадает с более редкой точь-в-точь.
static func _make_grid(cells: int, size: float) -> ArrayMesh:
	var side := cells + 1
	var step := size / float(cells)
	var vertices := PackedVector3Array()
	var uvs := PackedVector2Array()
	var slides := PackedVector2Array()
	var indices := PackedInt32Array()
	for z in side:
		for x in side:
			vertices.append(Vector3(float(x) * step, 0.0, float(z) * step))
			uvs.append(Vector2.ZERO)
			slides.append(Vector2(float(x % 2) * step, float(z % 2) * step))
	for z in cells:
		for x in cells:
			var a := z * side + x
			var b := a + 1
			var c := a + side
			var d := c + 1
			indices.append_array(PackedInt32Array([a, b, c, b, d, c]))

	var north := PackedInt32Array()
	var south := PackedInt32Array()
	var west := PackedInt32Array()
	var east := PackedInt32Array()
	for i in side:
		north.append(i)
		south.append((side - 1) * side + i)
		west.append(i * side)
		east.append(i * side + side - 1)
	var borders: Array[PackedInt32Array] = [north, south, west, east]
	for border in borders:
		var first := vertices.size()
		for index in border:
			vertices.append(vertices[index])
			uvs.append(Vector2(1.0, 0.0))
			slides.append(slides[index])
		for i in border.size() - 1:
			var top_a := border[i]
			var top_b := border[i + 1]
			var low_a := first + i
			var low_b := first + i + 1
			# Обе стороны: юбку видно с любой стороны плитки.
			indices.append_array(PackedInt32Array([top_a, top_b, low_a, top_b, low_b, low_a]))
			indices.append_array(PackedInt32Array([top_a, low_a, top_b, top_b, low_a, low_b]))

	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_TEX_UV2] = slides
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


static func _make_disc(radius: float) -> ArrayMesh:
	var segments := 40
	var vertices := PackedVector3Array([Vector3.ZERO])
	var normals := PackedVector3Array([Vector3.UP])
	var indices := PackedInt32Array()
	for i in segments:
		var angle := TAU * float(i) / float(segments)
		vertices.append(Vector3(cos(angle) * radius, 0.0, sin(angle) * radius))
		normals.append(Vector3.UP)
	for i in segments:
		# По часовой стрелке, если смотреть сверху: лицевая сторона — вверх.
		indices.append_array(PackedInt32Array([0, 1 + i, 1 + (i + 1) % segments]))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh
