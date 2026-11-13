class_name Weather
extends Node
## Погода (шаг 1.6 «Атмосфера и погода»): ясно и шторм — и плавный переход между ними.
##
## Погода — набор чисел («вид»): насколько толсты кучевые облака, доля штормовых туч, ветер, доля пасмурного
## света (её берёт DayLight), доля шторма в море (её берёт вода), дождь, мокрая земля, молнии. Между погодами числа перетекают плавно, за CHANGE_SECONDS (требование владельца ещё из шага «Океан»).
##
## Облака одни на всё: карта облаков плывёт по ветру, и по ней небо рисует сами облака — объёмом (sky.gdshader),
## дождь знает, где лить, а молнии — откуда бить. Теней на земле и море облака не кладут (решение владельца 12.11). Числа облаков —
## общие для всех шейдеров (global uniform): их смена не трогает материалы, и небо не пересчитывается для отражений.
##
## Решения владельца 12.11 (после теста 0.8.0): погод две — «ясно» и «шторм» (отдельного «дождя» нет); облаков
## ниже камеры не бывает — слой облаков поднимается вместе с камерой; облака — отдельные, разные, объёмные,
## в ясную погоду их мало и лежат они неравномерно. Шторм — событие игры (в шторм участники видят только карту
## с бурей). Песчаной мглы нет. Звук — отдельно, позже.

enum Kind { CLEAR, STORM }

const TITLES: Array[String] = ["ясно", "шторм"]
const CODES: Array[String] = ["clear", "storm"]
const CLOUD_MAP := preload("res://assets/weather/cloud_map.png")
const CLOUD_NOISE := preload("res://assets/weather/cloud_noise.png")
## За сколько секунд одна погода сменяет другую (клавишей; в игре начало и конец шторма приходят с сервера).
const CHANGE_SECONDS := 10.0
const WET_SECONDS := 50.0  ## за столько земля намокает под дождём полностью
const DRY_SECONDS := 200.0  ## и за столько высыхает после него
const CLOUD_PASS := preload("res://src/world/cloud_pass.gdshader")
const CLOUD_COMPOSITE := preload("res://src/world/cloud_composite.gdshader")
## Высоты слоёв облаков над морем, метры (те же числа — в clouds.gdshaderinc).
const CUMULUS_BASE := 1400.0
const STORM_BASE := 1000.0
const STORM_SAG := 320.0
const CLOUD_RESOLUTION := 0.66  ## картинка облаков — в такую долю разрешения картинки мира
const STRATEGIC_OPACITY := 0.32  ## насколько облака видны камере над ними при взгляде вниз (карта под ними читается)
const CLOUD_TILE := 48000.0  ## плитка карты облаков, метры (CLOUD_TILE в clouds.gdshaderinc)
const WIND := Vector2(0.87, 0.5)  ## куда дует ветер (по x и z) — туда же идут рябь и зыбь (water.gdshader)
const RAIN_DROPS := preload("res://src/world/rain_drops.gdshader")
## Струи дождя — три плана вокруг камеры: размер «коробки» (м), сколько в ней струй, длина и толщина струи (м),
## непрозрачность, скорость падения (м/с) и высоты камеры над землёй, с которой струи редеют и на которой пропадают.
## Дальше и выше дождь — завесы: пелену считают материалы земли, воды и неба (atmosphere.gdshaderinc).
const RAIN_PLANES: Array[Dictionary] = [
	{"box": Vector3(48.0, 36.0, 48.0), "count": 2600, "length": 0.45, "width": 0.018, "strength": 0.4, "speed": 9.0,
			"near": 7.0, "fade": Vector2(300.0, 900.0)},
	{"box": Vector3(220.0, 130.0, 220.0), "count": 3200, "length": 1.6, "width": 0.07, "strength": 0.3, "speed": 10.0,
			"near": 18.0, "fade": Vector2(700.0, 1600.0)},
	{"box": Vector3(900.0, 420.0, 900.0), "count": 3000, "length": 6.0, "width": 0.28, "strength": 0.16, "speed": 11.0,
			"near": 90.0, "fade": Vector2(1300.0, 2600.0)},
]
## Где стоят облака в кадрах проверок и при запуске: место карты облаков со средним их числом.
const SHOT_DRIFT := Vector2(1499.0, 33648.0)

## cumulus — толщина кучевых облаков (множитель к карте); storm — доля штормовых туч; wind — ветер, м/с;
## overcast — пасмурный свет; sea — шторм в море; rain, wet, lightning — дождь, мокрая земля и молнии.
const CLEAR := {"cumulus": 1.0, "storm": 0.0, "wind": 9.0, "overcast": 0.0, "sea": 0.0, "rain": 0.0, "wet": 0.0, "lightning": 0.0}
const STORM := {"cumulus": 1.3, "storm": 1.0, "wind": 30.0, "overcast": 1.0, "sea": 1.0, "rain": 1.0, "wet": 1.0, "lightning": 1.0}

var light: DayLight
var terrain: WorldTerrain  ## земля и вода мира (меняется при смене карты)
var camera: Camera3D
var cloud_map: Texture2D = CLOUD_MAP
## В кадрах проверок облака и дождь стоят, молний нет: кадр получается одним и тем же.
var frozen := false

var _kind := Kind.CLEAR
var _from: Dictionary
var _to: Dictionary
var _progress := 1.0
var _drift := SHOT_DRIFT  ## на сколько облака ушли по ветру, метры
var _churn := 0.0  ## сдвиг объёмного шума: облака понемногу меняют очертания
var _fall := 20.0  ## время падения дождя, секунды
var cloud_debug := 0  ## проверочный вид облаков (ключ --cloud-debug=N, см. cloud_pass.gdshader); ставится до _ready
var _cloud_view: SubViewport
var _cloud_camera: Camera3D
var _cloud_material: ShaderMaterial
var _composite_material: ShaderMaterial
var _storm_now := 0.0
var _ground_wet := 0.0  ## насколько намокла земля, 0…1 (см. WET_SECONDS, DRY_SECONDS)
var _wind_time := 40.0  ## время ветра для растительности: в сильный ветер идёт быстрее
var _drops: Array[MeshInstance3D] = []  ## струи дождя: ближний, средний и дальний план
var _drops_shown := true
var _base := STORM_BASE  ## высота низа туч шторма, метры (от неё бьют молнии)
var _lightning: Lightning
var _strike_in := 3.0  ## секунд до следующей молнии
var _map_image: Image  ## карта облаков для расчётов на процессоре: где тучи толще, туда и бьёт молния


func _ready() -> void:
	_to = look_of(_kind)
	_from = _to
	if light != null:
		light.set_cloud_textures(cloud_map, CLOUD_NOISE)
	_build_clouds()
	_build_rain()
	_lightning = Lightning.new()
	add_child(_lightning)
	_lightning.set_cloud_textures(cloud_map, CLOUD_NOISE)
	_map_image = cloud_map.get_image()
	if _map_image != null and _map_image.is_compressed():
		_map_image.decompress()
	_apply(0.0)


## Проход облаков: своё окно пониженного разрешения с камерой — копией камеры мира — и прямоугольником во весь
## кадр (cloud_pass.gdshader); на кадр мира его картинку кладёт второй прямоугольник (cloud_composite.gdshader).
func _build_clouds() -> void:
	_cloud_view = SubViewport.new()
	_cloud_view.own_world_3d = true
	_cloud_view.transparent_bg = true
	_cloud_view.msaa_3d = Viewport.MSAA_DISABLED
	_cloud_view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_cloud_view.size = Vector2i(640, 360)
	add_child(_cloud_view)
	_cloud_camera = Camera3D.new()
	_cloud_view.add_child(_cloud_camera)
	_cloud_camera.current = true
	_cloud_material = ShaderMaterial.new()
	_cloud_material.shader = CLOUD_PASS
	_cloud_material.set_shader_parameter("cloud_map", cloud_map)
	_cloud_material.set_shader_parameter("cloud_noise", CLOUD_NOISE)
	_cloud_material.set_shader_parameter("debug", cloud_debug)
	var screen := QuadMesh.new()
	screen.size = Vector2(2.0, 2.0)
	var everywhere := AABB(Vector3.ONE * -1.0e7, Vector3.ONE * 2.0e7)
	var pass_quad := MeshInstance3D.new()
	pass_quad.mesh = screen
	pass_quad.material_override = _cloud_material
	pass_quad.custom_aabb = everywhere
	pass_quad.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_cloud_view.add_child(pass_quad)
	_composite_material = ShaderMaterial.new()
	_composite_material.shader = CLOUD_COMPOSITE
	_composite_material.set_shader_parameter("clouds", _cloud_view.get_texture())
	var composite := MeshInstance3D.new()
	composite.mesh = screen
	composite.material_override = _composite_material
	composite.custom_aabb = everywhere
	composite.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(composite)
	if light != null:
		light.cloud_material = _cloud_material
	RenderingServer.frame_pre_draw.connect(_sync_clouds)


func _exit_tree() -> void:
	if RenderingServer.frame_pre_draw.is_connected(_sync_clouds):
		RenderingServer.frame_pre_draw.disconnect(_sync_clouds)


## Перед каждым кадром: камера прохода облаков — та же, что у мира; картинка облаков — в долю разрешения
## картинки мира; облака позади земли, пока камера под слоем, и перед ней, когда камера в слое или над ним.
func _sync_clouds() -> void:
	if camera == null or not is_instance_valid(camera) or _cloud_view == null:
		return
	_cloud_camera.global_transform = camera.global_transform
	_cloud_camera.fov = camera.fov
	_cloud_camera.near = camera.near
	_cloud_camera.far = camera.far
	_cloud_camera.keep_aspect = camera.keep_aspect
	var window := get_viewport()
	var size := Vector2(window.get_visible_rect().size) * window.scaling_3d_scale * CLOUD_RESOLUTION
	var wanted := Vector2i(maxi(int(size.x), 160), maxi(int(size.y), 90))
	if _cloud_view.size != wanted:
		_cloud_view.size = wanted
	_composite_material.set_shader_parameter("texel", Vector2(1.0 / float(wanted.x), 1.0 / float(wanted.y)))
	var front := camera.global_position.y > cloud_base() - 80.0
	_composite_material.set_shader_parameter("in_front", 1.0 if front else 0.0)
	_composite_material.render_priority = 20 if front else -20


## Размер картинки облаков, точки (для проверочного вида).
func cloud_picture_size() -> Vector2i:
	return _cloud_view.size if _cloud_view != null else Vector2i.ZERO


## Струи дождя: три плана вокруг камеры. Видны только в шторм и не с большой высоты.
func _build_rain() -> void:
	var everywhere := AABB(Vector3(-1.0e6, -1.0e6, -1.0e6), Vector3(2.0e6, 2.0e6, 2.0e6))
	for index in RAIN_PLANES.size():
		var plane: Dictionary = RAIN_PLANES[index]
		var material := ShaderMaterial.new()
		material.shader = RAIN_DROPS
		material.set_shader_parameter("cloud_map", cloud_map)
		material.set_shader_parameter("cloud_noise", CLOUD_NOISE)
		material.set_shader_parameter("box", plane["box"])
		material.set_shader_parameter("streak_length", plane["length"])
		material.set_shader_parameter("streak_width", plane["width"])
		material.set_shader_parameter("strength", plane["strength"])
		material.set_shader_parameter("speed", plane["speed"])
		material.set_shader_parameter("near_fade", plane["near"])
		material.set_shader_parameter("height_fade", plane["fade"])
		material.render_priority = 21 + index
		var drops := MeshInstance3D.new()
		drops.mesh = _drops_mesh(plane["count"], 77 + index)
		(drops.mesh as ArrayMesh).custom_aabb = everywhere
		drops.material_override = material
		drops.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		drops.visible = false
		add_child(drops)
		_drops.append(drops)


## Сетка струй: у каждой полоски четыре вершины с одним и тем же случайным местом в коробке (его раздвигает
## в полоску шейдер), углом полоски в UV и случайными числами в цвете.
static func _drops_mesh(count: int, seed_value: int) -> ArrayMesh:
	const CORNERS: Array[Vector2] = [Vector2(-1.0, 0.0), Vector2(1.0, 0.0), Vector2(1.0, 1.0), Vector2(-1.0, 1.0)]
	var random := RandomNumberGenerator.new()
	random.seed = seed_value
	var vertices := PackedVector3Array()
	var uvs := PackedVector2Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()
	vertices.resize(count * 4)
	uvs.resize(count * 4)
	colors.resize(count * 4)
	indices.resize(count * 6)
	for i in count:
		var place := Vector3(random.randf(), random.randf(), random.randf())
		var numbers := Color(random.randf(), random.randf(), random.randf(), random.randf())
		for corner in 4:
			vertices[i * 4 + corner] = place
			uvs[i * 4 + corner] = CORNERS[corner]
			colors[i * 4 + corner] = numbers
		for corner in 6:
			indices[i * 6 + corner] = i * 4 + [0, 1, 2, 0, 2, 3][corner]
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


func _process(delta: float) -> void:
	if _progress < 1.0:
		_progress = minf(_progress + delta / CHANGE_SECONDS, 1.0)
	_apply(0.0 if frozen else delta)


## Насколько земля намокла, 0…1: под дождём растёт около минуты, после дождя сохнет несколько минут.
func ground_wet() -> float:
	return _ground_wet


## Поставить намокание сразу (для кадров и проверок).
func set_ground_wet(value: float) -> void:
	_ground_wet = clampf(value, 0.0, 1.0)
	_apply(0.0)


func kind() -> Kind:
	return _kind


## Вид погоды: числа из таблиц в начале файла.
func look_of(of: Kind) -> Dictionary:
	return STORM if of == Kind.STORM else CLEAR


## Сменить погоду: плавно (как клавишей) или сразу (для кадров).
func set_kind(to: Kind, instant := false) -> void:
	_from = now()
	_kind = to
	_to = look_of(to)
	_progress = 1.0 if instant else 0.0
	if instant:
		_ground_wet = float(_to["wet"])


## Показать смесь двух погод (доля второй — share), сразу: для проверок плавности перехода.
func show_blend(from: Kind, to: Kind, share: float) -> void:
	_from = look_of(from)
	_to = look_of(to)
	_kind = to
	_progress = clampf(share, 0.0, 1.0)
	_ground_wet = float(now()["wet"])
	_apply(0.0)


## Погода сейчас (посреди перехода — смесь).
func now() -> Dictionary:
	if _progress >= 1.0 or _from.is_empty():
		return _to
	var weight := _progress * _progress * (3.0 - 2.0 * _progress)
	var result := {}
	for key: String in _to:
		result[key] = lerpf(_from.get(key, _to[key]), _to[key], weight)
	return result


## Сдвинуть время ветра на столько секунд (для проверок: растительность должна качаться).
func push_wind(seconds: float) -> void:
	_wind_time += seconds
	_apply(0.0)


## Высота низа облаков сейчас над морем, метры: кучевых в ясную погоду, туч — в шторм (с провисанием).
func cloud_base() -> float:
	return STORM_BASE - STORM_SAG if _storm_now > 0.01 else CUMULUS_BASE


## Показывать ли облака (для проверки: сверху они не должны закрывать карту).
func set_clouds_shown(shown: bool) -> void:
	_composite_material.set_shader_parameter("hidden", 0.0 if shown else 1.0)


## Показывать ли струи дождя (для проверки: шторм должен читаться и без них).
func set_drops_shown(shown: bool) -> void:
	_drops_shown = shown
	_apply(0.0)


## Сдвинуть облака на столько метров по ветру (для проверок: облака должны идти по небу).
func push_clouds(metres: float) -> void:
	_drift += WIND.normalized() * metres
	_apply(0.0)


func _apply(delta: float) -> void:
	var look := now()
	var storm: float = look["storm"]
	_drift += WIND.normalized() * float(look["wind"]) * delta
	_drift = Vector2(fposmod(_drift.x, CLOUD_TILE), fposmod(_drift.y, CLOUD_TILE))
	_churn = fposmod(_churn + delta * lerpf(0.004, 0.012, storm), 1.0)
	_fall = fposmod(_fall + delta, 3600.0)
	# Ветер для растительности (flora.gdshader): одно направление на всё, сила — от погоды (ясно — лёгкий, с порывами;
	# шторм — сильный), время в сильный ветер идёт быстрее — качание чаще.
	var blow := clampf(float(look["wind"]) / 30.0, 0.0, 1.0)
	_wind_time = fposmod(_wind_time + delta * lerpf(0.8, 1.7, blow), 3600.0)
	var heading := WIND.normalized()
	RenderingServer.global_shader_parameter_set(&"wind_look", Vector4(heading.x, heading.y, lerpf(0.12, 1.0, blow * blow), _wind_time))

	# Слой облаков стоит на своей высоте над морем: камера может быть под ним, в нём и над ним.
	var eye := camera.global_position if camera != null else Vector3.ZERO
	_storm_now = storm
	_base = STORM_BASE
	if light != null:
		light.set_storm(float(look["overcast"]))
	RenderingServer.global_shader_parameter_set(&"cloud_drift", Vector4(_drift.x, _drift.y, _churn, 0.0))
	RenderingServer.global_shader_parameter_set(&"cloud_look", Vector4(look["cumulus"], storm, STRATEGIC_OPACITY, 0.0))
	RenderingServer.global_shader_parameter_set(&"cloud_eye", eye)
	# Земля мокнет и сохнет не вместе с небом, а со своей скоростью: дождь уже идёт — земля ещё сухая, дождь кончился —
	# ещё мокрая.
	var wet_target: float = look["wet"]
	if delta > 0.0:
		_ground_wet = move_toward(_ground_wet, wet_target, delta / (WET_SECONDS if wet_target > _ground_wet else DRY_SECONDS))
	RenderingServer.global_shader_parameter_set(&"rain_wet", _ground_wet)
	# При смене карты прежней земли уже нет, а новая ещё строится.
	var ground := 0.0
	if terrain != null and is_instance_valid(terrain):
		terrain.set_storm(float(look["sea"]))
		if terrain.height_map != null:
			ground = maxf(terrain.height_map.sample(Vector2(eye.x, eye.z)), 0.0)

	# Дождь: вблизи струи, с высоты и вдали — завесы. Струи наклонены по ветру.
	var rain: float = look["rain"]
	var above := eye.y - ground
	RenderingServer.global_shader_parameter_set(&"rain_look", Vector4(rain, _fall,
			lerpf(0.08, 0.42, clampf(float(look["wind"]) / 30.0, 0.0, 1.0)), above))
	for index in _drops.size():
		_drops[index].visible = _drops_shown and rain > 0.01 and above < (RAIN_PLANES[index]["fade"] as Vector2).y

	# Молнии: разряды через неровные промежутки (иногда два подряд); свет — от самого разряда.
	# В кадрах проверок сами они не бьют (кадр должен получаться одним и тем же) — их ставит show_strike.
	if float(look["lightning"]) > 0.5 and delta > 0.0:
		_strike_in -= delta
		if _strike_in <= 0.0:
			_strike(randi(), false, -1)
			_strike_in = randf_range(0.25, 0.9) if randf() < 0.22 else randf_range(2.5, 11.0)
	_lightning.step(delta)
	var glow := _lightning.glow_at
	RenderingServer.global_shader_parameter_set(&"flash_at", Vector4(glow.x, glow.y, glow.z, _lightning.power * 2.4))
	if light != null:
		# Всё небо от разряда светлеет едва заметно: главный свет — у самого разряда.
		light.set_flash(_lightning.power * 0.07)


## Показать молнию и не гасить её (для кадров): number — какую (0 — до земли, 1 — между тучами, 2 — в туче).
func show_strike(number: int) -> void:
	_strike(4100 + number * 17, true, number % 3)
	_apply(0.0)


## Убрать молнию (после кадра).
func hide_strike() -> void:
	_lightning.clear()
	_apply(0.0)


## Разряд: место — там, куда смотрит камера, из нескольких случайных точек берётся та, над которой тучи толще.
func _strike(seed_value: int, still: bool, forced_kind: int) -> void:
	if camera == null:
		return
	var random := RandomNumberGenerator.new()
	random.seed = seed_value
	var eye := camera.global_position
	var forward := -camera.global_transform.basis.z
	var reach_ahead := clampf(eye.y / maxf(-forward.y, 0.08), 600.0, 12000.0)
	var focus := Vector2(eye.x, eye.z) + Vector2(forward.x, forward.z) * reach_ahead
	var spread := clampf(reach_ahead * 0.8, 1500.0, 9000.0)
	var place := focus
	var best := -1.0
	for i in 6:
		var turn := random.randf_range(0.0, TAU)
		var candidate := focus + Vector2(cos(turn), sin(turn)) * spread * sqrt(random.randf())
		var score := _storm_thickness(candidate) + random.randf() * 0.25
		if score > best:
			best = score
			place = candidate
	var ground := 0.0
	if terrain != null and is_instance_valid(terrain) and terrain.height_map != null:
		ground = maxf(terrain.height_map.sample(place), 0.0)
	var pick := random.randf()
	var kind := Lightning.Kind.GROUND if pick < 0.55 else (Lightning.Kind.CLOUD if pick < 0.8 else Lightning.Kind.INSIDE)
	if forced_kind >= 0:
		kind = forced_kind as Lightning.Kind
	var strength := random.randf_range(0.65, 1.0)
	var lean := Vector2(random.randf_range(-1.0, 1.0), random.randf_range(-1.0, 1.0)) * random.randf_range(200.0, 900.0)
	var top := Vector3(place.x + lean.x, _base + 40.0, place.y + lean.y)
	var bottom := Vector3(place.x, ground, place.y)
	if kind == Lightning.Kind.CLOUD:
		var turn := random.randf_range(0.0, TAU)
		var span := random.randf_range(1500.0, 4800.0)
		top = Vector3(place.x, _base - random.randf_range(40.0, 200.0), place.y)
		bottom = top + Vector3(cos(turn) * span, random.randf_range(-160.0, 60.0), sin(turn) * span)
	elif kind == Lightning.Kind.INSIDE:
		top.y = _base + random.randf_range(150.0, 500.0)
	_lightning.strike(kind, top, bottom, random.randi(), strength, still)


## Толщина туч шторма над точкой мира (x, z), 0…1 — по той же карте, что у шейдеров.
func _storm_thickness(at: Vector2) -> float:
	if _map_image == null:
		return 0.5
	var size := _map_image.get_size()
	var uv := (at - _drift) / CLOUD_TILE
	return _map_image.get_pixel(posmod(floori(uv.x * float(size.x)), size.x), posmod(floori(uv.y * float(size.y)), size.y)).g
