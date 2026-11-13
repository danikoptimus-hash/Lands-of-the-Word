class_name DayLight
extends Node3D
## Свет и небо (шаг 1.4): утро, день, вечер и ночь — как в игре.
##
## Времена суток — те же, что на сайте (packages/domain/src/daytime.ts, решение владельца 03.10): утро 7:00–9:00,
## день 9:00–18:00, вечер 18:00–22:00, ночь 22:00–7:00 по поясу игры. Правила игры переключаются ровно на границе,
## а картинка перетекает плавно: 15 минут до границы и 15 после.
##
## У каждого времени суток — свой «вид»: где стоит светило и какого оно цвета, цвета неба, рассеянный свет, дымка,
## выдержка и насыщенность. Между видами все числа перетекают плавно. Светит всегда одно светило — солнце или луна:
## на границе вечера и ночи солнце гаснет до нуля, и только потом разгорается луна (в сумерках земля освещена
## одним небом, как и в природе) — так тени считаются от одного источника, а не от двух.
##
## Виды приняты владельцем 12.11 на тесте 0.6.0: из двух направлений — «естественного» (день как при приёмке
## поверхностей) и «живописного» — выбрано живописное, для всех четырёх времён суток. Здесь оно одно и осталось.

enum Phase { MORNING, DAY, EVENING, NIGHT }

const SKY_SHADER := preload("res://src/world/sky.gdshader")
const PHASE_TITLES: Array[String] = ["утро", "день", "вечер", "ночь"]
const PHASE_CODES: Array[String] = ["morning", "day", "evening", "night"]
## Начало каждого времени суток, минуты от полуночи (в порядке Phase), и полуширина плавного перехода.
const PHASE_START: Array[int] = [7 * 60, 9 * 60, 18 * 60, 22 * 60]
const BLEND_MINUTES := 15.0
## Сколько секунд длится переход, когда время суток переключают клавишей (в игре он идёт полчаса).
const SWITCH_SECONDS := 2.5
## Дымка ясного дня: густота у самого моря (доля света, теряемая на метре пути) и высота слоя, на которой дымка
## редеет в e раз. С этими числами остров в 9 км с высоты километра затянут на четверть, в 20 км — наполовину,
## у горизонта суша растворяется; прямо под камерой с любой высоты — почти чисто. У времён суток — множитель «fog».
const HAZE_DENSITY := 0.000045
const HAZE_HEIGHT := 1500.0

## Виды. Направление на светило: азимут — от севера по часовой стрелке (90 — восток, 180 — юг, 270 — запад),
## высота — над горизонтом, градусы. У каждого вида: солнце (где оно на небе, даже если под горизонтом), луна,
## чем освещена земля (body: солнце или луна), цвета неба и остальное.
## Утром солнце на востоке (справа, если смотреть на север), вечером — на западе: свет ложится сбоку, и рельеф
## читается по теням. Ночью солнце «уходит» под горизонт через север и оттуда же поднимается к утру. Луна стоит
## на одном месте неба: проступает в вечерних сумерках и тает на рассвете.
const LOOKS: Dictionary = {
	"morning": {
		"body": "sun", "sun_azimuth": 97.0, "sun_height": 13.0, "moon_azimuth": 68.0, "moon_height": 26.0,
		"light_color": Color(1.0, 0.78, 0.62), "light_energy": 1.8, "specular": 0.015, "shadow": 0.95,
		"sky_top": Color(0.28, 0.42, 0.84), "sky_horizon": Color(1.0, 0.78, 0.76), "sky_ground": Color(0.5, 0.46, 0.58),
		"glow_color": Color(1.0, 0.66, 0.56), "glow": 0.8, "glow_height": 0.16, "glow_reach": 0.6, "sun_strength": 1.2, "moon_strength": 0.0, "stars": 0.0,
		"ambient_color": Color(0.7, 0.66, 0.94), "ambient_energy": 0.6, "fog": 1.15,
		"exposure": 1.1, "saturation": 1.1, "contrast": 1.03,
	},
	"day": {
		"body": "sun", "sun_azimuth": 254.3, "sun_height": 35.6, "moon_azimuth": 68.0, "moon_height": 26.0,
		"light_color": Color(1.0, 0.93, 0.8), "light_energy": 2.15, "specular": 1.0, "shadow": 1.0,
		"sky_top": Color(0.08, 0.3, 0.78), "sky_horizon": Color(0.55, 0.78, 0.98), "sky_ground": Color(0.28, 0.42, 0.58),
		"glow_color": Color(1.0, 0.9, 0.7), "glow": 0.0, "glow_height": 0.18, "glow_reach": 0.5, "sun_strength": 0.9, "moon_strength": 0.0, "stars": 0.0,
		"ambient_color": Color(0.8, 0.88, 1.0), "ambient_energy": 0.62, "fog": 1.0,
		"exposure": 1.1, "saturation": 1.12, "contrast": 1.04,
	},
	"evening": {
		"body": "sun", "sun_azimuth": 284.0, "sun_height": 10.0, "moon_azimuth": 68.0, "moon_height": 26.0,
		"light_color": Color(1.0, 0.62, 0.36), "light_energy": 1.9, "specular": 0.015, "shadow": 0.9,
		"sky_top": Color(0.16, 0.11, 0.44), "sky_horizon": Color(0.95, 0.52, 0.44), "sky_ground": Color(0.34, 0.24, 0.4),
		"glow_color": Color(1.0, 0.42, 0.14), "glow": 1.0, "glow_height": 0.2, "glow_reach": 0.62, "sun_strength": 1.4, "moon_strength": 0.0, "stars": 0.0,
		"ambient_color": Color(0.64, 0.58, 0.88), "ambient_energy": 0.86, "fog": 1.0,
		"exposure": 1.08, "saturation": 1.12, "contrast": 1.0,
	},
	"night": {
		"body": "moon", "sun_azimuth": 0.0, "sun_height": -30.0, "moon_azimuth": 68.0, "moon_height": 26.0,
		"light_color": Color(0.5, 0.78, 1.0), "light_energy": 0.72, "specular": 0.04, "shadow": 0.9,
		"sky_top": Color(0.015, 0.05, 0.16), "sky_horizon": Color(0.05, 0.17, 0.32), "sky_ground": Color(0.02, 0.04, 0.09),
		"glow_color": Color(0.1, 0.2, 0.36), "glow": 0.0, "glow_height": 0.18, "glow_reach": 0.5, "sun_strength": 0.0, "moon_strength": 1.2, "stars": 1.3,
		"ambient_color": Color(0.22, 0.44, 0.7), "ambient_energy": 0.62, "fog": 1.0,
		"exposure": 1.1, "saturation": 0.95, "contrast": 1.02,
	},
}

var sun: DirectionalLight3D  ## светило: солнце днём, луна ночью
var environment: Environment

var _sky_material: ShaderMaterial
var _phase := Phase.DAY
var _from: Dictionary  ## вид, из которого идёт переход
var _to: Dictionary
var _left := 0.0  ## секунд перехода осталось
var _grade := Vector3.ONE  ## насыщенность, контраст и яркость поверх вида (клавиша V)
## Проверочные выключатели (ключи --no-sun и --no-sky-reflections): без прямого света светила и без отражений
## неба — чтобы увидеть, откуда берётся блеск поверхности.
var debug_no_sun := false
var debug_no_reflections := false
var _storm := 0.0  ## доля пасмурной погоды, 0…1 (дождь — около половины, шторм — единица)
var _flash := 0.0  ## вспышка молнии: добавка к яркости картинки


func _ready() -> void:
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_blend_splits = true
	sun.directional_shadow_max_distance = 6000.0
	sun.shadow_blur = 1.8
	add_child(sun)

	_sky_material = ShaderMaterial.new()
	_sky_material.shader = SKY_SHADER
	var sky := Sky.new()
	sky.sky_material = _sky_material
	# Отражения и рассеянный свет неба пересчитываются понемногу, за несколько кадров, а не разом.
	sky.process_mode = Sky.PROCESS_MODE_INCREMENTAL

	environment = Environment.new()
	environment.background_mode = Environment.BG_SKY
	environment.sky = sky
	# Свет неба в тенях — в основном заданный цвет: от чисто синего неба тени на скалах становились синими.
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	environment.ambient_light_sky_contribution = 0.3
	environment.tonemap_mode = Environment.TONE_MAPPER_AGX
	environment.tonemap_agx_contrast = 1.3
	# Затенение впадин по экрану (SSAO) выключено с 0.5.2: ради него шейдер земли выполнялся в каждом кадре
	# дважды. Впадины затеняет сама картинка земли — по форме рельефа.
	environment.ssao_enabled = false
	# Туман движка выключен: дымку считают сами шейдеры (atmosphere.gdshaderinc) — по пути луча сквозь слой воздуха.
	environment.fog_enabled = false
	environment.adjustment_enabled = true
	var world_environment := WorldEnvironment.new()
	world_environment.environment = environment
	add_child(world_environment)

	_to = look(_phase)
	_from = _to
	_apply(_to)


func _process(delta: float) -> void:
	step(delta)


## Продвинуть плавный переход на delta секунд (сам узел делает это каждый кадр; проверки — своим шагом).
func step(delta: float) -> void:
	if _left <= 0.0:
		return
	_left = maxf(_left - delta, 0.0)
	var weight := 1.0 - _left / SWITCH_SECONDS
	_apply(blend(_from, _to, weight * weight * (3.0 - 2.0 * weight)))


## Идёт ли плавный переход.
func is_changing() -> bool:
	return _left > 0.0


func phase() -> Phase:
	return _phase


## Вид времени суток.
func look(of: Phase) -> Dictionary:
	return LOOKS[PHASE_CODES[of]]


## Переключить время суток: плавно (как клавишей) или сразу (для кадров).
func set_phase(to: Phase, instant := false) -> void:
	_from = _current()
	_phase = to
	_to = look(to)
	_start(instant)


## Время суток по минутам от полуночи — как на сайте: вне переходов вид одного времени суток, 15 минут до границы
## и 15 после — смесь двух соседних.
func set_minutes(minutes: float) -> void:
	var m := fposmod(minutes, 1440.0)
	var now := Phase.NIGHT
	for index in PHASE_START.size():
		if m >= float(PHASE_START[index]):
			now = index as Phase
	_phase = now
	_left = 0.0
	var next := ((now + 1) % 4) as Phase
	var previous := ((now + 3) % 4) as Phase
	var since := fposmod(m - float(PHASE_START[now]), 1440.0)
	var until := fposmod(float(PHASE_START[next]) - m, 1440.0)
	if since < BLEND_MINUTES:
		_apply(blend(look(previous), look(now), 0.5 + since / (2.0 * BLEND_MINUTES)))
	elif until <= BLEND_MINUTES:
		_apply(blend(look(now), look(next), (BLEND_MINUTES - until) / (2.0 * BLEND_MINUTES)))
	else:
		_apply(look(now))
	_to = look(now)
	_from = _to


## Насыщенность, контраст и яркость поверх вида (наборы клавиши V).
func set_grade(saturation: float, contrast: float, brightness: float) -> void:
	_grade = Vector3(saturation, contrast, brightness)
	_apply(_current())


## Карта облаков и объёмный шум (weather.gd) — небо рисует по ним облака.
func set_cloud_textures(map: Texture2D, noise: Texture3D) -> void:
	_sky_material.set_shader_parameter("cloud_map", map)
	_sky_material.set_shader_parameter("cloud_noise", noise)


## Вспышка молнии: на столько долей ярче картинка (0 — нет). Небо и материалы не трогает.
func set_flash(value: float) -> void:
	if is_equal_approx(value, _flash):
		return
	_flash = value
	environment.adjustment_brightness = _grade.z * (1.0 + _flash)


## Доля пасмурной погоды, 0…1: свет и небо уходят в пасмурные (см. storm_view). Меняется плавно — тем, кто зовёт.
func set_storm(share: float) -> void:
	if is_equal_approx(share, _storm):
		return
	_storm = clampf(share, 0.0, 1.0)
	_apply(_current())


## Вид под пасмурным небом (дождь, шторм): небо за облаками серое, светило закрыто, свет слабый и рассеянный,
## тени мягкие, дымка гуще, краски глуше. Сами тучи рисует небо по карте облаков (weather.gd). Серость — по яркости
## неба этого времени суток: ночной шторм темнее дневного.
static func storm_view(view: Dictionary, share: float) -> Dictionary:
	if share <= 0.0:
		return view
	var result := view.duplicate()
	var sky_light := clampf((view["sky_horizon"] as Color).get_luminance() * 1.25, 0.1, 1.0)
	# Ночью свет и так слабый: тучи гасят луну меньше, чем солнце, и небо под тучами не чёрное — иначе ночной
	# шторм уходит в черноту.
	var night: bool = view["body"] == "moon"
	if night:
		sky_light = maxf(sky_light, 0.34)
	var overcast_top := Color(0.26, 0.3, 0.36) * sky_light
	var overcast_horizon := Color(0.44, 0.48, 0.53) * sky_light
	result["light_energy"] = float(view["light_energy"]) * lerpf(1.0, 0.62 if night else 0.3, share)
	result["light_color"] = (view["light_color"] as Color).lerp(Color(0.74, 0.8, 0.88), share)
	result["shadow"] = float(view["shadow"]) * lerpf(1.0, 0.4, share)
	# Светило за тучами — рассеянный свет: бликов от него на земле нет.
	result["specular"] = float(view["specular"]) * lerpf(1.0, 0.05, share)
	result["sky_top"] = (view["sky_top"] as Color).lerp(overcast_top, share)
	result["sky_horizon"] = (view["sky_horizon"] as Color).lerp(overcast_horizon, share)
	result["sky_ground"] = (view["sky_ground"] as Color).lerp(overcast_top, share)
	result["glow"] = float(view["glow"]) * (1.0 - share)
	result["sun_strength"] = float(view["sun_strength"]) * (1.0 - share)
	result["moon_strength"] = float(view["moon_strength"]) * (1.0 - 0.85 * share)
	result["stars"] = float(view["stars"]) * (1.0 - share)
	result["ambient_color"] = (view["ambient_color"] as Color).lerp(Color(0.62, 0.67, 0.74), share)
	result["ambient_energy"] = float(view["ambient_energy"]) * lerpf(1.0, 0.9, share)
	# Дымка в шторм гуще, но не вчетверо, как прежде: видимость в шторм съедает дождь — завесами, неровно (weather.gd).
	result["fog"] = float(view["fog"]) * lerpf(1.0, 1.8, share)
	result["saturation"] = float(view["saturation"]) * lerpf(1.0, 0.72, share)
	result["exposure"] = float(view["exposure"]) * lerpf(1.0, 1.08 if night else 0.94, share)
	return result


## Смесь двух видов: числа и цвета — линейно, направления — по короткой дуге. Если землю в них освещают разные
## светила, свет первого гаснет к середине перехода, свет второго разгорается после неё.
static func blend(a: Dictionary, b: Dictionary, weight: float) -> Dictionary:
	if weight <= 0.0:
		return a
	if weight >= 1.0:
		return b
	var result := {}
	for key: String in a:
		var from: Variant = a[key]
		var to: Variant = b[key]
		if from is Color:
			result[key] = (from as Color).lerp(to, weight)
		elif key.ends_with("_azimuth"):
			result[key] = rad_to_deg(lerp_angle(deg_to_rad(from), deg_to_rad(to), weight))
		elif from is float:
			result[key] = lerpf(from, to, weight)
		else:
			result[key] = from if weight < 0.5 else to
	if a["body"] != b["body"]:
		var first := weight < 0.5
		var source: Dictionary = a if first else b
		result["light_color"] = source["light_color"]
		result["light_energy"] = float(source["light_energy"]) * (1.0 - weight * 2.0 if first else weight * 2.0 - 1.0)
		# Сумерки: пока светило слабое, землю держит небо — рассеянный свет чуть сильнее.
		result["ambient_energy"] = float(result["ambient_energy"]) * (1.0 + 0.25 * (1.0 - absf(weight * 2.0 - 1.0)))
	return result


## Цвет для общих чисел шейдеров: линейный (материалам движок переводит цвета сам, общим числам — нет).
static func linear(color: Color) -> Vector4:
	var result := color.srgb_to_linear()
	return Vector4(result.r, result.g, result.b, color.a)


## Направление на точку неба: азимут от севера по часовой стрелке, высота над горизонтом (градусы).
## В мире север — это −z, восток — +x.
static func sky_direction(azimuth: float, height: float) -> Vector3:
	var a := deg_to_rad(azimuth)
	var h := deg_to_rad(height)
	return Vector3(sin(a) * cos(h), sin(h), -cos(a) * cos(h))


func _start(instant: bool) -> void:
	if instant:
		_left = 0.0
		_from = _to
		_apply(_to)
	else:
		_left = SWITCH_SECONDS


## Вид, который сейчас на экране (посреди перехода — смесь).
func _current() -> Dictionary:
	if _left <= 0.0 or _from.is_empty():
		return _to
	var weight := 1.0 - _left / SWITCH_SECONDS
	return blend(_from, _to, weight * weight * (3.0 - 2.0 * weight))


func _apply(clear_view: Dictionary) -> void:
	var view := storm_view(clear_view, _storm)
	var to_sun := sky_direction(view["sun_azimuth"], view["sun_height"])
	var to_moon := sky_direction(view["moon_azimuth"], view["moon_height"])
	var to_light := to_moon if view["body"] == "moon" else to_sun
	# Светило у самого горизонта светило бы снизу вверх по склонам — ниже нескольких градусов свет не опускается.
	to_light.y = maxf(to_light.y, 0.07)
	to_light = to_light.normalized()
	sun.transform = Transform3D(Basis.looking_at(-to_light, Vector3.UP), Vector3.ZERO)
	sun.light_color = view["light_color"]
	sun.light_energy = 0.0 if debug_no_sun else float(view["light_energy"])
	environment.reflected_light_source = Environment.REFLECTION_SOURCE_DISABLED if debug_no_reflections else Environment.REFLECTION_SOURCE_BG
	sun.shadow_opacity = view["shadow"]
	# Сила блика светила — для суши: с этими числами приняты времена суток (шаг 1.4; тогда ими же глушился белый
	# столб на ровной воде). Вода с шага 1.5 считает свой блик сама (water.gdshader) и это число не читает.
	sun.light_specular = view["specular"]
	sun.shadow_enabled = float(view["light_energy"]) > 0.02

	_sky_material.set_shader_parameter("top_color", view["sky_top"])
	_sky_material.set_shader_parameter("horizon_color", view["sky_horizon"])
	_sky_material.set_shader_parameter("ground_color", view["sky_ground"])
	_sky_material.set_shader_parameter("glow_color", view["glow_color"])
	_sky_material.set_shader_parameter("glow", view["glow"])
	_sky_material.set_shader_parameter("glow_reach", view["glow_reach"])
	_sky_material.set_shader_parameter("glow_height", view["glow_height"])
	_sky_material.set_shader_parameter("sun_direction", to_sun)
	_sky_material.set_shader_parameter("sun_color", view["light_color"] if view["body"] == "sun" else Color(1.0, 0.8, 0.6))
	_sky_material.set_shader_parameter("sun_strength", view["sun_strength"])
	_sky_material.set_shader_parameter("moon_direction", to_moon)
	_sky_material.set_shader_parameter("moon_strength", view["moon_strength"])
	_sky_material.set_shader_parameter("stars", view["stars"])
	# Облака: со стороны светила — его цвет (чуть выбеленный), яркость — по яркости неба этого времени суток;
	# низ и тень — в цвет неба у горизонта. В шторм тучи темнее.
	var sky_light := clampf((view["sky_horizon"] as Color).get_luminance() * 1.25, 0.1, 1.0)
	var dim := lerpf(1.0, 0.95 if view["body"] == "moon" else 0.6, _storm)
	_sky_material.set_shader_parameter("cloud_lit", (view["light_color"] as Color).lerp(Color.WHITE, 0.4) * (sky_light * 1.45 * dim))
	_sky_material.set_shader_parameter("cloud_light_direction", to_light)
	_sky_material.set_shader_parameter("cloud_dark", (view["sky_horizon"] as Color).lerp(Color(0.5, 0.52, 0.58) * sky_light, 0.5) * (0.7 * dim))

	environment.ambient_light_color = view["ambient_color"]
	environment.ambient_light_energy = view["ambient_energy"]
	# Дымка — цветом неба у горизонта (с заревом в стороне солнца): дальняя земля и море уходят в небо.
	RenderingServer.global_shader_parameter_set(&"haze_look", Vector4(HAZE_DENSITY * float(view["fog"]), 1.0 / HAZE_HEIGHT,
			view["glow"], view["glow_reach"]))
	RenderingServer.global_shader_parameter_set(&"haze_color", linear(view["sky_horizon"]))
	RenderingServer.global_shader_parameter_set(&"haze_glow_color", linear(view["glow_color"]))
	RenderingServer.global_shader_parameter_set(&"haze_sun", Vector4(to_sun.x, to_sun.y, to_sun.z, view["sun_strength"]))
	RenderingServer.global_shader_parameter_set(&"haze_sun_color", linear(view["light_color"] if view["body"] == "sun" else Color(1.0, 0.8, 0.6)))
	environment.tonemap_exposure = view["exposure"]
	environment.adjustment_saturation = float(view["saturation"]) * _grade.x
	environment.adjustment_contrast = float(view["contrast"]) * _grade.y
	environment.adjustment_brightness = _grade.z * (1.0 + _flash)

