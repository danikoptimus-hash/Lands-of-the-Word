class_name Weather
extends Node
## Погода (шаг 1.6 «Атмосфера и погода»): ясно, дождь, шторм — и плавные переходы между ними.
##
## Погода — набор чисел («вид»): сколько на небе облаков и насколько темны их тени, ветер, доля пасмурного света
## (её берёт DayLight), доля шторма в море (её берёт вода), дождь, мокрая земля, молнии. Между погодами числа
## перетекают плавно, за CHANGE_SECONDS: требование владельца ещё из шага «Океан» — «важен плавный переход».
##
## Облака одни на всё: карта облаков (бесшовный шум) плывёт по ветру, и по ней рисуются облака на небе
## (sky.gdshader), их тени на земле и море (clouds.gdshaderinc в шейдерах земли и воды) и слой облаков, видный
## с большой высоты (cloud_layer.gdshader). Числа облаков — общие для всех шейдеров (global uniform): их смена
## не трогает материалы, и небо не пересчитывается для отражений каждый кадр.
##
## Шторм — событие игры (в шторм участники видят только карту с бурей); дождь пока только картинка.
## Песчаной мглы нет: решение владельца 12.11. Звук — отдельно, позже.

enum Kind { CLEAR, RAIN, STORM }

const TITLES: Array[String] = ["ясно", "дождь", "шторм"]
const CODES: Array[String] = ["clear", "rain", "storm"]
## За сколько секунд одна погода сменяет другую (клавишей; в игре начало и конец шторма приходят с сервера).
const CHANGE_SECONDS := 8.0
const CLOUD_ALTITUDE := 1100.0  ## высота облаков над морем, метры: от неё сдвиг теней к солнцу и место слоя
const CLOUD_TEXELS := 1024
const CLOUD_CYCLES := 9.0  ## волн шума на плитку карты облаков: облако — около 600 м
const WIND := Vector2(0.87, 0.5)  ## куда дует ветер (по x и z) — туда же идут рябь и зыбь (water.gdshader)
const SHOT_DRIFT := Vector2(1700.0, 900.0)  ## где стоят облака в кадрах проверок

## Ясная погода — на выбор владельца (клавиша J); после выбора останется одна.
## cover — доля неба под облаками; shade — насколько тень облака темнит землю; layer — слой облаков с высоты.
const CLEAR_LOOKS: Array[Dictionary] = [
	{"title": "редкие облака, мягкие тени", "cover": 0.3, "shade": 0.34, "layer": 0.0, "wind": 9.0},
	{"title": "кучевые облака: тени плотнее, с высоты видны сами облака", "cover": 0.4, "shade": 0.42, "layer": 0.32, "wind": 9.0},
	{"title": "почти безоблачно", "cover": 0.14, "shade": 0.28, "layer": 0.0, "wind": 7.0},
]
## Что у ясной погоды одинаково во всех видах.
const CLEAR_BASE := {"overcast": 0.0, "sea": 0.0, "rain": 0.0, "wet": 0.0, "lightning": 0.0}
## Дождь: небо затянуто, свет мягкий, море чуть неспокойнее, земля мокрая.
const RAIN := {"cover": 0.86, "shade": 0.16, "layer": 0.0, "wind": 14.0, "overcast": 0.55, "sea": 0.25, "rain": 0.6, "wet": 1.0,
		"lightning": 0.0}
## Шторм: сплошные тёмные тучи, ливень, сильный ветер, море штормовое, молнии.
const STORM := {"cover": 1.0, "shade": 0.08, "layer": 0.0, "wind": 30.0, "overcast": 1.0, "sea": 1.0, "rain": 1.0, "wet": 1.0,
		"lightning": 1.0}

var light: DayLight
var terrain: WorldTerrain  ## земля и вода мира (меняется при смене карты)
var camera: Camera3D
var cloud_map: ImageTexture
## В кадрах проверок облака и дождь стоят, молний нет: кадр получается одним и тем же.
var frozen := false

var _kind := Kind.CLEAR
var _clear_look := 0
var _from: Dictionary
var _to: Dictionary
var _progress := 1.0
var _drift := SHOT_DRIFT  ## на сколько облака ушли по ветру, метры
var _fall := 0.0  ## время падения дождя
var _mean := 0.5  ## среднее и разброс значений карты облаков
var _spread := 0.14
var _layer: MeshInstance3D
var _layer_material: ShaderMaterial
var _rain: ColorRect
var _rain_material: ShaderMaterial
var _flash_in := 6.0  ## секунд до следующей молнии
var _flash_age := 99.0  ## секунд с последней


func _ready() -> void:
	var image := WaterLook.noise_image(41, CLOUD_TEXELS, CLOUD_CYCLES, 5, 0.52)
	var stats := WaterLook.mean_and_spread(image)
	_mean = stats.x
	# Облако складывается из двух слоёв карты (0,7 и 0,3): разброс суммы меньше разброса карты.
	_spread = stats.y * 0.76
	image.generate_mipmaps()
	cloud_map = ImageTexture.create_from_image(image)

	_layer_material = ShaderMaterial.new()
	_layer_material.shader = preload("res://src/world/cloud_layer.gdshader")
	_layer_material.set_shader_parameter("cloud_map", cloud_map)
	var plane := PlaneMesh.new()
	plane.size = Vector2(60000.0, 60000.0)
	_layer = MeshInstance3D.new()
	_layer.mesh = plane
	_layer.material_override = _layer_material
	_layer.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_layer.visible = false
	add_child(_layer)

	_rain_material = ShaderMaterial.new()
	_rain_material.shader = preload("res://src/world/rain.gdshader")
	_rain_material.set_shader_parameter("streaks", cloud_map)
	var canvas := CanvasLayer.new()
	canvas.layer = 5  # под надписями (у них 10)
	add_child(canvas)
	_rain = ColorRect.new()
	_rain.set_anchors_preset(Control.PRESET_FULL_RECT)
	_rain.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_rain.material = _rain_material
	_rain.visible = false
	canvas.add_child(_rain)

	_to = look_of(_kind)
	_from = _to
	if light != null:
		light.set_cloud_map(cloud_map)
	_apply(0.0)


func _process(delta: float) -> void:
	if _progress < 1.0:
		_progress = minf(_progress + delta / CHANGE_SECONDS, 1.0)
	_apply(0.0 if frozen else delta)


func kind() -> Kind:
	return _kind


func clear_look() -> int:
	return _clear_look


## Вид погоды: числа из таблиц в начале файла.
func look_of(of: Kind) -> Dictionary:
	if of == Kind.RAIN:
		return RAIN
	if of == Kind.STORM:
		return STORM
	var look: Dictionary = CLEAR_LOOKS[_clear_look].duplicate()
	look.merge(CLEAR_BASE)
	return look


## Сменить погоду: плавно (как клавишей) или сразу (для кадров).
func set_kind(to: Kind, instant := false) -> void:
	_from = now()
	_kind = to
	_to = look_of(to)
	_progress = 1.0 if instant else 0.0


## Вид ясной погоды (на время выбора владельцем их несколько).
func set_clear_look(index: int, instant := false) -> void:
	_clear_look = posmod(index, CLEAR_LOOKS.size())
	if _kind == Kind.CLEAR:
		set_kind(Kind.CLEAR, instant)


## Показать смесь двух погод (доля второй — share), сразу: для проверок плавности перехода.
func show_blend(from: Kind, to: Kind, share: float) -> void:
	_from = look_of(from)
	_to = look_of(to)
	_kind = to
	_progress = clampf(share, 0.0, 1.0)
	_apply(0.0)


## Погода сейчас (посреди перехода — смесь).
func now() -> Dictionary:
	if _progress >= 1.0 or _from.is_empty():
		return _to
	var weight := _progress * _progress * (3.0 - 2.0 * _progress)
	var result := {}
	for key: String in _to:
		if _to[key] is float:
			result[key] = lerpf(_from.get(key, _to[key]), _to[key], weight)
		else:
			result[key] = _to[key]
	return result


## Сдвинуть облака на столько метров по ветру (для проверок: тени должны идти по земле).
func push_clouds(metres: float) -> void:
	_drift += WIND.normalized() * metres
	_apply(0.0)


func _apply(delta: float) -> void:
	var look := now()
	var cover: float = look["cover"]
	_drift += WIND.normalized() * float(look["wind"]) * delta
	_fall += delta * lerpf(0.8, 1.5, float(look["rain"]))

	# Облака: порог по доле неба (значения карты распределены почти нормально вокруг среднего).
	var edge := _mean + _spread * lerpf(2.2, -2.4, cover)
	var tile := 5200.0  # CLOUD_TILE в clouds.gdshaderinc
	var fine_tile := tile * 0.37
	var turned := Vector2(_drift.x * 0.788 + _drift.y * 0.616, _drift.y * 0.788 - _drift.x * 0.616) * 1.35
	RenderingServer.global_shader_parameter_set(&"cloud_drift", Vector4(fposmod(_drift.x, tile), fposmod(_drift.y, tile),
			fposmod(turned.x, fine_tile), fposmod(turned.y, fine_tile)))
	RenderingServer.global_shader_parameter_set(&"cloud_edge", Vector2(edge, _spread * 0.55))
	RenderingServer.global_shader_parameter_set(&"rain_wet", float(look["wet"]))
	var thin := smoothstep(0.0, 0.06, cover)
	var shade: float = float(look["shade"]) * thin
	if light != null:
		# Тень облака лежит со сдвигом к светилу; при слабом свете (сумерки, луна) она слабее.
		var to_light := light.sun.global_transform.basis.z
		var offset := Vector2(to_light.x, to_light.z) / maxf(to_light.y, 0.12) * CLOUD_ALTITUDE
		RenderingServer.global_shader_parameter_set(&"cloud_sun", offset)
		shade *= clampf(light.sun.light_energy / 1.2, 0.3, 1.0)
		light.set_storm(float(look["overcast"]))
	RenderingServer.global_shader_parameter_set(&"cloud_shade", shade)
	# При смене карты прежней земли уже нет, а новая ещё строится.
	if terrain != null and is_instance_valid(terrain):
		terrain.set_storm(float(look["sea"]))

	# Слой облаков с высоты идёт за камерой; рисунок привязан к миру.
	var layer: float = float(look["layer"]) * thin
	_layer.visible = layer > 0.01
	if camera != null:
		var eye := camera.global_position
		RenderingServer.global_shader_parameter_set(&"cloud_eye", eye)
		_layer.position = Vector3(eye.x, CLOUD_ALTITUDE, eye.z)
	_layer_material.set_shader_parameter("strength", layer)
	if light != null:
		_layer_material.set_shader_parameter("lit_color", light.cloud_color())

	# Дождь.
	var rain: float = look["rain"]
	_rain.visible = rain > 0.01
	_rain_material.set_shader_parameter("amount", rain)
	_rain_material.set_shader_parameter("slant", lerpf(0.12, 0.42, clampf(float(look["wind"]) / 30.0, 0.0, 1.0)))
	_rain_material.set_shader_parameter("fall", fposmod(_fall, 4096.0))

	# Молнии: редкая мягкая вспышка света и короткий отблеск следом. В кадрах проверок их нет.
	var flash := 0.0
	var lightning: float = look["lightning"]
	if lightning > 0.01 and delta > 0.0:
		_flash_in -= delta
		_flash_age += delta
		if _flash_in <= 0.0:
			_flash_in = randf_range(5.0, 12.0)
			_flash_age = 0.0
		flash = maxf(exp(-_flash_age * 12.0), 0.55 * exp(-absf(_flash_age - 0.22) * 16.0) if _flash_age > 0.15 else 0.0) * lightning
	if light != null:
		light.set_flash(flash * 0.55)
