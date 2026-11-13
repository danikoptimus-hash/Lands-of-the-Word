class_name Flora
extends Node3D
## Растительность и камни мира (шаг 1.8): деревья, кусты и камни по картам густоты.
##
## Где чему расти, решают экологические правила в расчёте земли (bake_surface.gdshader, части 5–8): для каждой
## точки суши (шаг 4 м) — густота каждого вида от местности, влажности, высоты, уклона, стока, берега и полей
## «лесистости». Здесь по этим картам расставляются сами деревья: в клетке карты — столько экземпляров вида,
## сколько выходит по его густоте (дробная часть — по жребию), место в клетке, поворот, рост и оттенок — тоже
## по жребию. Жребий — от зерна карты и номера клетки: при том же мире лес всегда тот же, а клетки не зависят друг
## от друга (плитку можно пересобрать отдельно). Дальний вид земли красится теми же картами — лес с высоты стоит
## там же, где вблизи стволы.
##
## Мир режется на плитки (CHUNK). В плитке на каждый вид и вариант формы — одна пачка экземпляров (MultiMesh):
## видеокарта рисует пачку разом. Уровней подробности три, у каждого своя пачка и свои расстояния (движок сам
## включает нужную и плавно, точками, меняет одну на другую): вблизи — полная модель, дальше — упрощённая,
## ещё дальше — один общий «клуб» на дерево; за FAR_END деревья не рисуются — остаётся цвет земли под лесом.
## Кусты и камни дальше SMALL_END не рисуются. Тени — только от ближнего уровня, и рисует их упрощённая модель.

const SHADER := preload("res://src/world/flora.gdshader")
const NOISE := preload("res://assets/terrain/noise.png")
const CHUNK := 256.0  ## сторона плитки, метры (как у земли)
const KINDS := 10
## Наибольшая густота вида: экземпляров на квадратный метр там, где карта вида равна единице (порядок —
## FloraMeshes.Kind). Дубрава — дерево на 34 м², сосняк — на 38, оливы реже, кипарисы тесными группами.
## Пучок травы — на 7 м²: это отдельные высокие пучки поверх рисунка травы на земле, а не весь луг.
const RATE: Array[float] = [1.0 / 34.0, 1.0 / 38.0, 1.0 / 52.0, 1.0 / 40.0, 1.0 / 55.0, 1.0 / 70.0, 1.0 / 22.0, 1.0 / 24.0, 1.0 / 26.0,
		1.0 / 7.0]
const NEAR_END := 300.0  ## до этого расстояния до плитки — полные модели, метры
const MID_END := 760.0  ## до этого — упрощённые
const FAR_END := 3800.0  ## до этого — по «клубу» на дерево; дальше — только цвет земли
const SMALL_END := 620.0  ## кусты и камни дальше не рисуются
const GRASS_END := 460.0  ## плитки с пучками травы дальше не рисуются (сами пучки уходят в землю уже за 210–360 м)
const SHADOW_OFF := GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
const SHADOW_ONLY := GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
const OUTCROP := Vector2(5.0, 14.0)  ## скальный выход: поперечник, метры
const GRASS_GREEN := Color(0.125, 0.215, 0.05)
const GRASS_STRAW := Color(0.42, 0.34, 0.13)
const FADE := 70.0  ## на таком расстоянии один уровень подробности плавно сменяет другой

var counts := PackedInt32Array()  ## сколько экземпляров каждого вида
var batches := 0  ## сколько пачек (вызовов отрисовки, если видны все)
var build_ms := 0.0
var lowest := INF  ## самая низкая точка, на которой что-то растёт, метры над морем
var fingerprint := 0  ## «отпечаток» расстановки: у того же мира он тот же
var densest := Vector2.ZERO  ## середина самой густой рощи мира (для проверки ветра: там в кадре точно есть деревья)
var _densest_count := 0

var _material: ShaderMaterial
var _mid_material: ShaderMaterial
var _far_material: ShaderMaterial
var _borders: MeshInstance3D
var _tiles: Array[Vector2i] = []  ## плитки, где что-то растёт (для проверочных границ)
var _heights: Array[HeightMap] = []
var _near_meshes := {}  ## Vector2i(вид, вариант) → сетка
var _mid_meshes := {}
var _far_mesh: ArrayMesh
var _reference: Node3D


func _ready() -> void:
	_material = ShaderMaterial.new()
	_material.shader = SHADER
	_material.set_shader_parameter("noise_map", NOISE)
	_mid_material = _material.duplicate()
	_far_material = ShaderMaterial.new()
	_far_material.shader = SHADER
	_far_material.set_shader_parameter("noise_map", NOISE)
	_far_material.set_shader_parameter("far_view", 1.0)
	for kind in KINDS:
		for variant in FloraMeshes.VARIANTS[kind]:
			_near_meshes[Vector2i(kind, variant)] = FloraMeshes.make(kind as FloraMeshes.Kind, variant, 0)
			_mid_meshes[Vector2i(kind, variant)] = FloraMeshes.make(kind as FloraMeshes.Kind, variant, 1)
	_far_mesh = FloraMeshes.make_far()


## Карта облаков и объёмный шум: дымка и завесы дождя на растительности — те же, что на земле.
func set_cloud_textures(map: Texture2D, noise: Texture3D) -> void:
	for material: ShaderMaterial in [_material, _mid_material, _far_material]:
		material.set_shader_parameter("cloud_map", map)
		material.set_shader_parameter("cloud_noise", noise)


## Расставить растительность мира. Сопрограмма: между областями уступает кадр.
func build(world: WorldData, terrain: WorldTerrain) -> void:
	var started := Time.get_ticks_usec()
	for child in get_children():
		child.queue_free()
	_reference = null
	_borders = null
	_tiles.clear()
	_heights.clear()
	counts = PackedInt32Array()
	counts.resize(KINDS)
	batches = 0
	lowest = INF
	fingerprint = 0
	_densest_count = 0
	var regions := terrain.flora_regions()
	for region in regions:
		await _plant_region(world, region)
	build_ms = float(Time.get_ticks_usec() - started) / 1000.0


## Сколько чего посажено — строкой для журнала.
func summary() -> String:
	var parts := PackedStringArray()
	var trees := 0
	for kind in KINDS:
		if kind < 6:
			trees += counts[kind]
		parts.append("%s %d" % [FloraMeshes.TITLES[kind], counts[kind]])
	return "деревьев %d (%s); пачек %d; за %.0f мс" % [trees, ", ".join(parts), batches, build_ms]


## Проверочный вид (шаг 1.8): уровни подробности цветом — зелёный вблизи, жёлтый средний, красный дальний —
## и границы плиток посадки. Возвращает, включён ли он теперь.
func toggle_debug() -> bool:
	var on := _borders == null
	_material.set_shader_parameter("lod_tint", Vector3(0.15, 0.85, 0.2) if on else Vector3.ZERO)
	_mid_material.set_shader_parameter("lod_tint", Vector3(0.95, 0.85, 0.15) if on else Vector3.ZERO)
	_far_material.set_shader_parameter("lod_tint", Vector3(0.95, 0.25, 0.15) if on else Vector3.ZERO)
	if not on:
		_borders.queue_free()
		_borders = null
		return false
	# Границы плиток — ломаные по земле, чуть выше неё.
	var lines := PackedVector3Array()
	for i in _tiles.size():
		var corner := Vector2(_tiles[i]) * CHUNK
		for side: Array in [[Vector2.ZERO, Vector2(CHUNK, 0.0)], [Vector2.ZERO, Vector2(0.0, CHUNK)]]:
			var from: Vector2 = corner + side[0]
			var to: Vector2 = corner + side[1]
			for n in 16:
				for end in 2:
					var at := from.lerp(to, float(n + end) / 16.0)
					lines.append(Vector3(at.x, maxf(_heights[i].sample(at), 0.0) + 3.0, at.y))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = lines
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, arrays)
	var paint := StandardMaterial3D.new()
	paint.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	paint.albedo_color = Color(1.0, 1.0, 1.0)
	_borders = MeshInstance3D.new()
	_borders.mesh = mesh
	_borders.material_override = paint
	_borders.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_borders)
	return true


## Счётчики для проверочного вида: что посажено и что рисуется в кадре сейчас.
func debug_text() -> String:
	var total := 0
	for kind in KINDS:
		total += counts[kind]
	return "Растительность: %d экз., %d пачек, посадка %.0f мс · кадр: %d объектов, %d вызовов, %.1f млн треуг. · зелёный — до %d м, жёлтый — до %d, красный — до %d" % [
			total, batches, build_ms,
			RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME),
			RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
			float(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME)) / 1.0e6,
			int(NEAR_END), int(MID_END), int(FAR_END)]


## Размеры моделей для аудита масштаба: рост и поперечник кроны каждого вида — у опорной модели и пределы на карте.
func size_report() -> PackedStringArray:
	var lines := PackedStringArray()
	for kind in KINDS:
		var box: AABB = (_near_meshes[Vector2i(kind, 0)] as Mesh).get_aabb()
		for variant in range(1, FloraMeshes.VARIANTS[kind]):
			box = box.merge((_near_meshes[Vector2i(kind, variant)] as Mesh).get_aabb())
		var limits: Vector2 = FloraMeshes.SIZE[kind]
		var reference: float = FloraMeshes.REFERENCE[kind]
		var wide := maxf(box.size.x, box.size.z)
		lines.append("%s: рост от %.1f до %.1f м; поперечник от %.1f до %.1f м (опорная модель: рост %.1f м, поперечник %.1f м)" % [
				FloraMeshes.TITLES[kind], limits.x, limits.y, wide * limits.x / reference * 0.85, wide * limits.y / reference * 1.18,
				box.end.y, wide])
	return lines


## Эталоны масштаба у точки мира (проверка шага 1.8): человек 1,75 м, дом 6 м, дорога 4 м, валун 2 м, по дереву
## опорного роста — олива 6 м, пальма 12 м, кипарис 15 м — и отрезок городской стены 40 м (высота 8 м, толщина
## 2,5 м) с башней 12 м. Повторный вызов убирает их.
func toggle_reference(at: Vector3) -> bool:
	if _reference != null:
		_reference.queue_free()
		_reference = null
		return false
	_reference = Node3D.new()
	_reference.position = at
	add_child(_reference)
	var plain := StandardMaterial3D.new()
	plain.albedo_color = Color(0.82, 0.74, 0.62)
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.45, 0.2, 0.14)
	var person := MeshInstance3D.new()
	var capsule := CapsuleMesh.new()
	capsule.radius = 0.22
	capsule.height = 1.75
	person.mesh = capsule
	person.material_override = dark
	person.position = Vector3(0.0, 0.875, 0.0)
	_reference.add_child(person)
	var house := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(7.0, 4.5, 6.0)
	house.mesh = box
	house.material_override = plain
	house.position = Vector3(8.0, 2.25, 0.0)
	_reference.add_child(house)
	var roof := MeshInstance3D.new()
	var prism := PrismMesh.new()
	prism.size = Vector3(7.4, 1.5, 6.4)
	roof.mesh = prism
	roof.material_override = dark
	roof.position = Vector3(8.0, 5.25, 0.0)
	_reference.add_child(roof)
	var road := MeshInstance3D.new()
	var strip := BoxMesh.new()
	strip.size = Vector3(40.0, 0.12, 4.0)
	road.mesh = strip
	road.material_override = plain
	road.position = Vector3(6.0, 0.06, 7.0)
	_reference.add_child(road)
	var wall := MeshInstance3D.new()
	var wall_box := BoxMesh.new()
	wall_box.size = Vector3(40.0, 8.0, 2.5)
	wall.mesh = wall_box
	wall.material_override = plain
	wall.position = Vector3(6.0, 4.0, -12.0)
	_reference.add_child(wall)
	var tower := MeshInstance3D.new()
	var tower_box := BoxMesh.new()
	tower_box.size = Vector3(6.0, 12.0, 6.0)
	tower.mesh = tower_box
	tower.material_override = plain
	tower.position = Vector3(29.0, 6.0, -12.0)
	_reference.add_child(tower)
	var stand: Array = [[FloraMeshes.Kind.ROCK, Vector3(-4.0, 0.0, 0.0), 2.0], [FloraMeshes.Kind.OLIVE, Vector3(-11.0, 0.0, 0.0), 1.0],
			[FloraMeshes.Kind.PALM, Vector3(-19.0, 0.0, 0.0), 1.0], [FloraMeshes.Kind.CYPRESS, Vector3(-26.0, 0.0, 0.0), 1.0]]
	for row: Array in stand:
		# Пачка из одного экземпляра: цвет камня задаётся экземпляром, как на карте.
		var multimesh := MultiMesh.new()
		multimesh.transform_format = MultiMesh.TRANSFORM_3D
		multimesh.use_custom_data = true
		multimesh.use_colors = true
		multimesh.mesh = _near_meshes[Vector2i(int(row[0]), 0)]
		multimesh.instance_count = 1
		multimesh.set_instance_transform(0, Transform3D(Basis.from_scale(Vector3.ONE * float(row[2])), row[1]))
		multimesh.set_instance_custom_data(0, Color(0.5, 0.0, 0.5, 1.0))
		multimesh.set_instance_color(0, Color(0.47, 0.31, 0.15) if int(row[0]) == FloraMeshes.Kind.ROCK else Color.WHITE)
		var item := MultiMeshInstance3D.new()
		item.multimesh = multimesh
		item.material_override = _material
		_reference.add_child(item)
	return true


## Экземпляры одного вида и варианта в плитке.
class Batch:
	var transforms: Array[Transform3D] = []
	var numbers := PackedColorArray()  ## числа экземпляра для шейдера: оттенок, фаза ветра
	var sizes := PackedFloat32Array()  ## рост, метры
	var colors := PackedColorArray()  ## цвет экземпляра (камни — порода, трава — зелёная или сухая); у деревьев пусто


## Задание на посадку одной области: карты, высоты и плитки. Плитки считаются в несколько потоков — каждая
## пишет только в свою ячейку results.
class Planting:
	var rect := Rect2()
	var area := Rect2()
	var texel := 4.0
	var width := 0
	var height := 0
	var a := PackedByteArray()
	var b := PackedByteArray()
	var c := PackedByteArray()
	var d := PackedByteArray()
	var heights: HeightMap
	var world_seed := 0
	var tiles: Array[Vector2i] = []
	var results: Array = []  ## на плитку — словарь Vector2i(вид, вариант) → Batch
	var tallies: Array = []  ## на плитку — сколько экземпляров каждого вида


## Растительность одной области: по картам густоты — экземпляры, по плиткам — пачки. Сопрограмма.
func _plant_region(world: WorldData, region: Dictionary) -> void:
	var maps: Array = region["maps"]
	var first: Image = maps[0]
	var job := Planting.new()
	job.rect = region["rect"]
	job.area = region["area"]
	job.texel = region["texel"]
	job.width = first.get_width()
	job.height = first.get_height()
	job.a = first.get_data()
	job.b = (maps[1] as Image).get_data()
	job.c = (maps[2] as Image).get_data()
	job.d = (maps[3] as Image).get_data()
	job.heights = region["heights"]
	job.world_seed = world.map_seed
	for tile_z in range(floori(job.area.position.y / CHUNK), ceili(job.area.end.y / CHUNK)):
		for tile_x in range(floori(job.area.position.x / CHUNK), ceili(job.area.end.x / CHUNK)):
			job.tiles.append(Vector2i(tile_x, tile_z))
	job.results.resize(job.tiles.size())
	job.tallies.resize(job.tiles.size())
	var task := WorkerThreadPool.add_group_task(_plant_tile.bind(job), job.tiles.size())
	while not WorkerThreadPool.is_group_task_completed(task):
		await get_tree().process_frame
	WorkerThreadPool.wait_for_group_task_completion(task)
	for index in job.tiles.size():
		var tally: PackedInt32Array = job.tallies[index]
		for kind in KINDS:
			counts[kind] += tally[kind]
		lowest = minf(lowest, float(tally[KINDS]) / 100.0)
		var chunk: Dictionary = job.results[index]
		for slot: Vector2i in chunk:
			var batch: Batch = chunk[slot]
			fingerprint = (fingerprint * 31 + slot.x * 7 + slot.y + hash(batch.sizes) + hash(batch.transforms[0].origin)) & 0x7fffffff
			if slot.x < 6 and batch.transforms.size() > _densest_count:
				# Самая большая пачка деревьев одного вида в плитке — середина рощи.
				_densest_count = batch.transforms.size()
				var middle := Vector3.ZERO
				for item in batch.transforms:
					middle += item.origin
				middle /= float(_densest_count)
				densest = Vector2(middle.x, middle.z)
		if not chunk.is_empty():
			_make_chunk(chunk)
			_tiles.append(job.tiles[index])
			_heights.append(job.heights)


## Посадка одной плитки (в своём потоке): клетки карт плитки → экземпляры.
func _plant_tile(index: int, job: Planting) -> void:
	var tile := job.tiles[index]
	var texel := job.texel
	var chunk := {}
	var tally := PackedInt32Array()  # по видам — сколько, последним числом — самая низкая точка, сантиметры
	tally.resize(KINDS + 1)
	tally[KINDS] = 1000000
	var value := PackedInt32Array()
	value.resize(KINDS)
	var cell_area := texel * texel
	var x_from := maxi(ceili((float(tile.x) * CHUNK - job.rect.position.x) / texel - 0.5), 0)
	var x_to := mini(ceili((float(tile.x + 1) * CHUNK - job.rect.position.x) / texel - 0.5), job.width)
	var y_from := maxi(ceili((float(tile.y) * CHUNK - job.rect.position.y) / texel - 0.5), 0)
	var y_to := mini(ceili((float(tile.y + 1) * CHUNK - job.rect.position.y) / texel - 0.5), job.height)
	var a := job.a
	var b := job.b
	var c := job.c
	var d := job.d
	for ty in range(y_from, y_to):
		var z0 := job.rect.position.y + float(ty) * texel
		for tx in range(x_from, x_to):
			var at := (ty * job.width + tx) * 4
			if c[at + 3] < 128:
				continue
			var x0 := job.rect.position.x + float(tx) * texel
			value[0] = a[at]
			value[1] = a[at + 1]
			value[2] = a[at + 2]
			value[3] = a[at + 3]
			value[4] = b[at]
			value[5] = b[at + 1]
			value[6] = b[at + 2]
			value[7] = b[at + 3]
			value[8] = c[at]
			value[9] = c[at + 1]
			for kind in KINDS:
				if value[kind] < 3:
					continue
				# Жребий клетки и вида — от зерна карты и места: тот же мир — тот же лес.
				var state := (roundi(x0 / texel) * 73856093) ^ (roundi(z0 / texel) * 19349663) ^ ((kind + 1) * 83492791) ^ job.world_seed
				state = (state * 1103515245 + 12345) & 0x7fffffff
				var expected := float(value[kind]) / 255.0 * RATE[kind] * cell_area
				var count := int(expected + float(state & 0xffff) / 65536.0)
				for n in count:
					state = (state * 1103515245 + 12345) & 0x7fffffff
					var u := float(state & 0xffff) / 65536.0
					state = (state * 1103515245 + 12345) & 0x7fffffff
					var v := float(state & 0xffff) / 65536.0
					state = (state * 1103515245 + 12345) & 0x7fffffff
					var w := float(state & 0xffff) / 65536.0
					state = (state * 1103515245 + 12345) & 0x7fffffff
					var t := float(state & 0xffff) / 65536.0
					var place := Vector2(x0 + u * texel, z0 + v * texel)
					var ground := job.heights.sample(place)
					if ground < 0.6:
						continue
					# Рост: чаще средний, крупные — редкость; у камней мелких много, глыб мало.
					var limits: Vector2 = FloraMeshes.SIZE[kind]
					var share := (w + t) * 0.5 if kind != FloraMeshes.Kind.ROCK else w * w * w
					var size := lerpf(limits.x, limits.y, pow(share, 1.25))
					var variant := int(w * 97.0) % FloraMeshes.VARIANTS[kind]
					# Скальный выход: изредка там, где камней много, — глыба в 5–14 м, наполовину в земле.
					var outcrop := kind == FloraMeshes.Kind.ROCK and value[kind] > 130 and t > 0.988
					if outcrop:
						size = lerpf(OUTCROP.x, OUTCROP.y, u * u)
						variant = 1 if v < 0.6 else 0
					var factor := size / FloraMeshes.REFERENCE[kind]
					var turned := Basis(Vector3.UP, t * TAU)
					# Наклон: деревья стоят почти прямо, пальмы и камни — вольнее.
					var lean := 0.05 if kind < 4 else (0.12 if kind == FloraMeshes.Kind.PALM else 0.2)
					turned = Basis(Vector3(cos(w * TAU), 0.0, sin(w * TAU)), (u - 0.5) * 2.0 * lean) * turned
					turned = turned.scaled(Vector3(factor * lerpf(0.85, 1.18, v), factor, factor * lerpf(0.85, 1.18, u)))
					var slot := Vector2i(kind, variant)
					var batch: Batch = chunk.get(slot)
					if batch == null:
						batch = Batch.new()
						chunk[slot] = batch
					var rooted := ground
					if kind == FloraMeshes.Kind.ROCK:
						batch.colors.append(_rock_color(d[at], d[at + 1], d[at + 2], d[at + 3], v))
						if outcrop:
							rooted -= size * 0.12
					elif kind == FloraMeshes.Kind.GRASS:
						batch.colors.append(GRASS_GREEN.lerp(GRASS_STRAW, clampf(float(c[at + 2]) / 255.0 * 1.25 - 0.2 + 0.3 * (v - 0.5), 0.0, 1.0)))
					batch.transforms.append(Transform3D(turned, Vector3(place.x, rooted, place.y)))
					batch.numbers.append(Color(v, t, w, 1.0))
					batch.sizes.append(size)
					tally[kind] += 1
					tally[KINDS] = mini(tally[KINDS], int(ground * 100.0))
	job.results[index] = chunk
	job.tallies[index] = tally


## Цвет камня по породе места (карта, часть 8): тот же камень, что на скалах вокруг, — тёплый известняк берегов,
## серо-бурый в горах, песочный в пустыне, тёмный вулканический, серый с лишайником на малых островах.
static func _rock_color(tone: int, sandy: int, sand_tone: int, lichen: int, chance: float) -> Color:
	var rock_tone := float(tone) / 255.0
	var color := Color(0.56, 0.36, 0.17)
	if lichen > 127:
		color = Color(0.3, 0.3, 0.22)
	if rock_tone > 0.875:
		color = Color(0.13, 0.115, 0.1)
	elif rock_tone <= 0.6:
		var tint := Color(0.84, 0.86, 0.9).lerp(Color(0.66, 0.71, 0.78), clampf(rock_tone * 2.0, 0.0, 1.0))
		color = Color(color.r * tint.r, color.g * tint.g, color.b * tint.b)
	var sand := Color(0.6, 0.35, 0.13).lerp(Color(0.62, 0.31, 0.1), float(sand_tone) / 255.0)
	color = color.lerp(sand, float(sandy) / 255.0 * 0.7)
	var shade := lerpf(0.7, 0.94, chance)
	return Color(color.r * shade, color.g * shade, color.b * shade, 1.0)


## Пачки одной плитки: ближние и средние — по виду и варианту, дальняя — общая на все деревья.
func _make_chunk(chunk: Dictionary) -> void:
	var far_transforms: Array[Transform3D] = []
	var far_colors := PackedColorArray()
	for slot: Vector2i in chunk:
		var batch: Batch = chunk[slot]
		if slot.x == FloraMeshes.Kind.GRASS:
			# Трава — одна пачка на плитку: пучки сами уходят в землю с расстоянием (flora.gdshader), теней не дают.
			_add_batch(_near_meshes[slot], _material, batch.transforms, batch.numbers, batch.colors, 0.0, GRASS_END, SHADOW_OFF)
			continue
		var small := slot.x >= 6
		var near_end := NEAR_END if not small else minf(NEAR_END, SMALL_END)
		# Тень ближних деревьев рисует упрощённая модель (в 5–6 раз меньше треугольников): тень на земле от этого
		# не меняется, а расчёт теней — самая дорогая часть растительности вблизи.
		_add_batch(_near_meshes[slot], _material, batch.transforms, batch.numbers, batch.colors, 0.0, near_end, SHADOW_OFF)
		_add_batch(_mid_meshes[slot], _mid_material, batch.transforms, batch.numbers, batch.colors, 0.0, near_end, SHADOW_ONLY)
		_add_batch(_mid_meshes[slot], _mid_material, batch.transforms, batch.numbers, batch.colors, near_end, SMALL_END if small else MID_END, SHADOW_OFF)
		if small:
			continue
		var shape: Vector3 = FloraMeshes.FAR_SHAPE[slot.x]
		var color: Color = FloraMeshes.FAR_COLOR[slot.x]
		for i in batch.transforms.size():
			var origin := batch.transforms[i].origin
			var size := batch.sizes[i]
			# Клуб кроны: ширина и высота — в долях роста дерева, стоит на высоте начала кроны.
			var wide := size * shape.x * lerpf(0.9, 1.1, batch.numbers[i].r)
			var tall := size * shape.y
			far_transforms.append(Transform3D(Basis.from_scale(Vector3(wide, tall, wide)), origin + Vector3(0.0, size * shape.z - tall * 0.5, 0.0)))
			far_colors.append(color * lerpf(0.85, 1.15, batch.numbers[i].r))
	if not far_transforms.is_empty():
		var numbers := PackedColorArray()
		numbers.resize(far_transforms.size())
		numbers.fill(Color(0.5, 0.0, 0.0, 1.0))
		_add_batch(_far_mesh, _far_material, far_transforms, numbers, far_colors, MID_END, FAR_END, SHADOW_OFF)


## Одна пачка экземпляров с расстояниями видимости. colors — цвет экземпляра (пусто — белый).
func _add_batch(mesh: Mesh, material: Material, transforms: Array[Transform3D], numbers: PackedColorArray, colors: PackedColorArray,
		from: float, to: float, shadows: GeometryInstance3D.ShadowCastingSetting) -> void:
	var multimesh := MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.use_custom_data = true
	multimesh.use_colors = not colors.is_empty()
	multimesh.mesh = mesh
	multimesh.instance_count = transforms.size()
	for i in transforms.size():
		multimesh.set_instance_transform(i, transforms[i])
		multimesh.set_instance_custom_data(i, numbers[i])
		if not colors.is_empty():
			multimesh.set_instance_color(i, colors[i])
	var instance := MultiMeshInstance3D.new()
	instance.multimesh = multimesh
	instance.material_override = material
	instance.cast_shadow = shadows
	instance.extra_cull_margin = 4.0
	instance.visibility_range_begin = from
	instance.visibility_range_end = to
	instance.visibility_range_begin_margin = FADE if from > 0.0 else 0.0
	instance.visibility_range_end_margin = FADE
	instance.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
	add_child(instance)
	batches += 1
