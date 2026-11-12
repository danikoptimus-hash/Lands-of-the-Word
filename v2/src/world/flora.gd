class_name Flora
extends Node3D
## Растительность и камни мира (шаг 1.8): деревья, кусты и камни по картам густоты.
##
## Где чему расти, решают экологические правила в расчёте земли (bake_surface.gdshader, части 5–7): для каждой
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
## Кусты и камни дальше SMALL_END не рисуются. Тени — только от ближнего и среднего уровня.

const SHADER := preload("res://src/world/flora.gdshader")
const NOISE := preload("res://assets/terrain/noise.png")
const CHUNK := 256.0  ## сторона плитки, метры (как у земли)
const KINDS := 9
## Наибольшая густота вида: экземпляров на квадратный метр там, где карта вида равна единице (порядок —
## FloraMeshes.Kind). Дубрава — дерево на 34 м², сосняк — на 38, оливы реже, кипарисы тесными группами.
const RATE: Array[float] = [1.0 / 34.0, 1.0 / 38.0, 1.0 / 52.0, 1.0 / 40.0, 1.0 / 55.0, 1.0 / 70.0, 1.0 / 22.0, 1.0 / 24.0, 1.0 / 26.0]
const NEAR_END := 300.0  ## до этого расстояния до плитки — полные модели, метры
const MID_END := 760.0  ## до этого — упрощённые
const FAR_END := 3800.0  ## до этого — по «клубу» на дерево; дальше — только цвет земли
const SMALL_END := 620.0  ## кусты и камни дальше не рисуются
const FADE := 70.0  ## на таком расстоянии один уровень подробности плавно сменяет другой

var counts := PackedInt32Array()  ## сколько экземпляров каждого вида
var batches := 0  ## сколько пачек (вызовов отрисовки, если видны все)
var build_ms := 0.0

var _material: ShaderMaterial
var _far_material: ShaderMaterial
var _near_meshes := {}  ## Vector2i(вид, вариант) → сетка
var _mid_meshes := {}
var _far_mesh: ArrayMesh
var _reference: Node3D


func _ready() -> void:
	_material = ShaderMaterial.new()
	_material.shader = SHADER
	_material.set_shader_parameter("noise_map", NOISE)
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
	for material: ShaderMaterial in [_material, _far_material]:
		material.set_shader_parameter("cloud_map", map)
		material.set_shader_parameter("cloud_noise", noise)


## Расставить растительность мира. Сопрограмма: между областями уступает кадр.
func build(world: WorldData, terrain: WorldTerrain) -> void:
	var started := Time.get_ticks_usec()
	for child in get_children():
		child.queue_free()
	_reference = null
	counts = PackedInt32Array()
	counts.resize(KINDS)
	batches = 0
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


## Эталоны масштаба у точки мира (проверка шага 1.8): человек 1,75 м, дом 6 м, дорога 4 м, валун 2 м и по дереву
## опорного роста — олива 6 м, пальма 12 м, кипарис 15 м. Повторный вызов убирает их.
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
	var stand: Array = [[FloraMeshes.Kind.ROCK, Vector3(-4.0, 0.0, 0.0), 2.0], [FloraMeshes.Kind.OLIVE, Vector3(-11.0, 0.0, 0.0), 1.0],
			[FloraMeshes.Kind.PALM, Vector3(-19.0, 0.0, 0.0), 1.0], [FloraMeshes.Kind.CYPRESS, Vector3(-26.0, 0.0, 0.0), 1.0]]
	for row: Array in stand:
		var item := MeshInstance3D.new()
		item.mesh = _near_meshes[Vector2i(int(row[0]), 0)]
		item.material_override = _material
		item.position = row[1]
		item.scale = Vector3.ONE * float(row[2])
		_reference.add_child(item)
	return true


## Экземпляры одного вида и варианта в плитке.
class Batch:
	var transforms: Array[Transform3D] = []
	var numbers := PackedColorArray()  ## числа экземпляра для шейдера: оттенок, фаза ветра
	var sizes := PackedFloat32Array()  ## рост, метры


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
		var chunk: Dictionary = job.results[index]
		if not chunk.is_empty():
			_make_chunk(chunk)


## Посадка одной плитки (в своём потоке): клетки карт плитки → экземпляры.
func _plant_tile(index: int, job: Planting) -> void:
	var tile := job.tiles[index]
	var texel := job.texel
	var chunk := {}
	var tally := PackedInt32Array()
	tally.resize(KINDS)
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
					var factor := size / FloraMeshes.REFERENCE[kind]
					var turned := Basis(Vector3.UP, t * TAU)
					# Наклон: деревья стоят почти прямо, пальмы и камни — вольнее.
					var lean := 0.05 if kind < 4 else (0.12 if kind == FloraMeshes.Kind.PALM else 0.2)
					turned = Basis(Vector3(cos(w * TAU), 0.0, sin(w * TAU)), (u - 0.5) * 2.0 * lean) * turned
					turned = turned.scaled(Vector3(factor * lerpf(0.85, 1.18, v), factor, factor * lerpf(0.85, 1.18, u)))
					var slot := Vector2i(kind, int(w * 97.0) % FloraMeshes.VARIANTS[kind])
					var batch: Batch = chunk.get(slot)
					if batch == null:
						batch = Batch.new()
						chunk[slot] = batch
					batch.transforms.append(Transform3D(turned, Vector3(place.x, ground, place.y)))
					batch.numbers.append(Color(v, t, w, 1.0))
					batch.sizes.append(size)
					tally[kind] += 1
	job.results[index] = chunk
	job.tallies[index] = tally


## Пачки одной плитки: ближние и средние — по виду и варианту, дальняя — общая на все деревья.
func _make_chunk(chunk: Dictionary) -> void:
	var far_transforms: Array[Transform3D] = []
	var far_colors := PackedColorArray()
	for slot: Vector2i in chunk:
		var batch: Batch = chunk[slot]
		var small := slot.x >= 6
		var near_end := NEAR_END if not small else minf(NEAR_END, SMALL_END)
		_add_batch(_near_meshes[slot], _material, batch.transforms, batch.numbers, PackedColorArray(), 0.0, near_end, true)
		_add_batch(_mid_meshes[slot], _material, batch.transforms, batch.numbers, PackedColorArray(), near_end, SMALL_END if small else MID_END, false)
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
		_add_batch(_far_mesh, _far_material, far_transforms, numbers, far_colors, MID_END, FAR_END, false)


## Одна пачка экземпляров с расстояниями видимости. colors — цвет экземпляра (пусто — белый).
func _add_batch(mesh: Mesh, material: Material, transforms: Array[Transform3D], numbers: PackedColorArray, colors: PackedColorArray,
		from: float, to: float, shadows: bool) -> void:
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
	instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	instance.extra_cull_margin = 4.0
	instance.visibility_range_begin = from
	instance.visibility_range_end = to
	instance.visibility_range_begin_margin = FADE if from > 0.0 else 0.0
	instance.visibility_range_end_margin = FADE
	instance.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
	add_child(instance)
	batches += 1
