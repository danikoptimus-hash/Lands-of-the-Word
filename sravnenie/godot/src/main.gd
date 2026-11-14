extends Node3D
## Сцена для сравнения движков: берег Корфу в Godot.
## Земля — готовое дополнение Terrain3D; место, покров и расстановка — общая основа (sravnenie/osnova).
## Ключи запуска: --kadry=ПАПКА — снять контрольные виды в папку и выйти;
## --nebo=den|zakat|shtorm — состояние неба; --vidy=имя,имя — снять только эти виды;
## --kachestvo=0…4 — качество облаков (таблица QUALITY: 0–2 — купол, 3 — прямой расчёт, 4 — без облаков);
## --par=имя:число,… — числа шейдера неба поверх таблицы;
## --vremya=100 — сколько секунд облака «уже плывут» к моменту кадров (в кадрах они стоят: кадры повторимы);
## --masshtab=50 — кадры в половину разрешения (в рабочей среде на этом падает программная отрисовка).
##
## --bez-zemli, --bez-morya — без земли, без моря (оба ключа — одно небо). В рабочей среде программная отрисовка
## на некоторых ракурсах с землёй у горизонта падает (внутри неё, на отрисовке дополнения Terrain3D) — небо
## сверяется кадрами с ключом --bez-zemli;
## --tolko-kupol — в пробе только проверка обновления купола (без перебора уровней качества: он долгий);
## --proba=папка — проба образца: путь владельца (весь экран, 67 % с достройкой, подсказка), но небо и качество
## переключаются сами, кадры пишутся в папку.
##
## Без ключа --kadry сцена открывается для владельца: полёт камерой, смена неба и качества клавишами,
## число кадров на экране.

const DATA := "res://dannye/"

var info: Dictionary
var side := 11000.0
var size := 2048
var terrain: Terrain3D
var camera: Camera3D
var sun: DirectionalLight3D
var shots_dir := ""
var probe_dir := ""
var only_dome_probe := false
var no_land := false
var no_sea := false
var sky_name := "den"
var quality := 0
var overrides := {}
var cloud_drift := Vector2.ZERO  ## снос облаков ветром, метры (x — восток, y — юг сцены): копится по кадрам
var shot_seconds := 100.0  ## сколько секунд облака «уже плывут» в кадрах проверок (в кадрах они стоят)
var wind := 2  ## скорость ветра: номер в таблице WINDS
var shot_scale := 1.0
var sky: Sky
var sky_direct: ShaderMaterial  ## небо с прямым расчётом облаков в каждом кадре
var sky_dome: ShaderMaterial  ## небо, которое показывает картинку купола
var dome_material: ShaderMaterial  ## расчёт картинки купола
var dome_views: Array[SubViewport] = []
var dome_rects: Array[ColorRect] = []
var dome_active := false
var dome_size := 2048
var dome_bands := 32
var dome_front := 0  ## какая из двух картинок показывается
var dome_cursor := 0  ## сколько полос второй картинки уже посчитано
var dome_full := true  ## картинку надо посчитать заново и быстро (сменилось небо или качество)
var dome_instant := false  ## считать её при этом целиком за один кадр (режим кадров) или за несколько (у владельца)
var dome_fill_bands := 32  ## на сколько полос делится идущий сейчас расчёт
var dome_clearing := true  ## в этом кадре обе картинки очищаются (созданы или сменили размер)
var dome_fade := DOME_FADE  ## сколько кадров новая картинка уже проявляется поверх прежней
var snap_drifts := [Vector2.ZERO, Vector2.ZERO]
var snap_places := [Vector3.ZERO, Vector3.ZERO]
var help: Label
var fps_label: Label
var fly_speed := 400.0
var looking := false
var wide := true  ## угол зрения: широкий (как в кадрах Unreal владельца) или как в игре
var full_res := false
var only_views := PackedStringArray()
var world: WorldEnvironment
var sea_material: ShaderMaterial
var sea: MeshInstance3D
var heights_image: Image
var water_time := WaterLook.SHOT_TIME
var swash_time := WaterLook.SHOT_TIME


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--kadry="):
			shots_dir = a.trim_prefix("--kadry=")
		if a.begins_with("--nebo="):
			sky_name = a.trim_prefix("--nebo=")
		if a.begins_with("--vidy="):
			only_views = a.trim_prefix("--vidy=").split(",")
		if a.begins_with("--kachestvo="):
			quality = int(a.trim_prefix("--kachestvo="))
		if a.begins_with("--par="):
			for pair in a.trim_prefix("--par=").split(","):
				overrides[pair.get_slice(":", 0)] = float(pair.get_slice(":", 1))
		if a == "--bez-zemli":
			no_land = true
		if a == "--bez-morya":
			no_sea = true
		if a == "--tolko-kupol":
			only_dome_probe = true
		if a.begins_with("--proba="):
			probe_dir = a.trim_prefix("--proba=")
		if a.begins_with("--vremya="):
			shot_seconds = float(a.trim_prefix("--vremya="))
		if a.begins_with("--masshtab="):
			shot_scale = float(a.trim_prefix("--masshtab=")) / 100.0
	cloud_drift = wind_velocity() * shot_seconds
	info = JSON.parse_string(FileAccess.get_file_as_string(DATA + "opisanie.json"))
	side = float(info["storona_m"])
	size = int(info["razmer"])
	_build_sky()
	_build_camera()
	await _build_terrain()
	terrain.visible = not no_land
	sea.visible = not no_sea
	if shots_dir != "":
		await _shots()
		get_tree().quit()
	elif probe_dir != "":
		_build_controls()
		await _probe()
		get_tree().quit()
	else:
		_build_controls()


## Точка основы (u — восток, v — север, h — высота) в координатах сцены: север — это −Z.
func at(u: float, v: float, h: float) -> Vector3:
	return Vector3(u - side * 0.5, h, side * 0.5 - v)


## Состояния неба: высота и сторона солнца (градусы), сила света, облачность и плотность облаков.
const SKIES := {
	# Ясный день: числа фона подобраны по кадрам Unreal владельца (синева в зените и на 30°, дымка у горизонта);
	# подбор — расчётом той же формулы вне движка, сверка — кадрами. Солнце невысоко, как в тех кадрах:
	# облака освещены сбоку и объёмны.
	"den": {"sun_height": 30.0, "sun_side": 215.0, "energy": 1.0, "light_color": Color(1.0, 0.97, 0.92), "ambient": 1.0, "shader": {
		"cloud_coverage": 0.2, "_density": 0.04, "weather_scale": 0.00012, "cloud_bottom": 2500.0, "cloud_top": 3800.0,
		"coverage_far": 0.72, "coverage_far_range": Vector2(6000.0, 40000.0), "weather_variety": 0.22,
		"exposure": 0.159, "rayleigh": 1.67, "turbidity": 1.3, "mie": 0.001, "mie_eccentricity": 0.93,
		"rayleigh_color": Color(0.24, 0.32, 0.48), "sky_saturation": 1.53,
		"haze_color": Vector3(0.70, 0.65, 0.52), "haze_sun_color": Vector3(0.92, 0.83, 0.62),
		"haze_strength": 0.62, "haze_power": 24.0,
		"sun_disk_scale": 2.0, "sun_glow": Vector2(3.0, 0.1), "sun_glow_color": Vector3(1.0, 0.93, 0.8),
		"cloud_visibility": 70000.0, "horizon_fade": Vector2(0.98, 0.9995),
		"cloud_sun": 0.55, "cloud_ambient": 0.7, "cloud_shoulder": 1.5, "phase_cap": 0.45,
		"shadow_strength": 3.5, "base_shade": 0.45, "powder": 0.25, "detail_strength": 0.4, "detail_floor": 0.1,
		"cloud_tint": Vector3(1.0, 0.97, 0.925), "sun_tint": Vector3(1.0, 1.0, 1.0),
		"cloud_floor": Vector3(0.045, 0.055, 0.085)}},
	# Закат и шторм — без утверждённых образцов: черновые.
	"zakat": {"sun_height": 7.0, "sun_side": 262.0, "energy": 1.0, "light_color": Color(0.8, 0.48, 0.3), "ambient": 0.3, "shader": {
		"cloud_coverage": 0.22, "_density": 0.04, "weather_scale": 0.00012, "cloud_bottom": 2500.0, "cloud_top": 3800.0,
		"coverage_far": 0.75, "coverage_far_range": Vector2(6000.0, 40000.0), "weather_variety": 0.22,
		"exposure": 0.15, "rayleigh": 1.6, "turbidity": 5.0, "mie": 0.004, "mie_eccentricity": 0.85,
		"rayleigh_color": Color(0.32, 0.44, 0.67), "sky_saturation": 1.34,
		"haze_color": Vector3(0.50, 0.38, 0.40), "haze_sun_color": Vector3(1.3, 0.68, 0.24),
		"haze_strength": 0.65, "haze_power": 9.0,
		"sun_disk_scale": 2.0, "sun_glow": Vector2(4.0, 0.7), "sun_glow_color": Vector3(1.0, 0.55, 0.2),
		"cloud_visibility": 60000.0, "horizon_fade": Vector2(0.98, 0.9995),
		"cloud_sun": 0.6, "cloud_ambient": 1.5, "cloud_shoulder": 1.4, "phase_cap": 1.2,
		"shadow_strength": 3.0, "base_shade": 0.45, "powder": 0.2, "detail_strength": 0.4, "detail_floor": 0.1,
		"cloud_tint": Vector3(1.0, 1.0, 1.0), "sun_tint": Vector3(1.0, 0.78, 1.1),
		"cloud_floor": Vector3(0.05, 0.06, 0.10)}},
	# Шторм: тёмная облачность с просветами; низ облаков освещён рассеянным светом, не чёрный.
	"shtorm": {"sun_height": 40.0, "sun_side": 215.0, "energy": 0.45, "light_color": Color(0.3, 0.33, 0.38), "ambient": 0.3, "shader": {
		"cloud_coverage": 0.5, "_density": 0.05, "weather_scale": 0.00006, "cloud_bottom": 1500.0, "cloud_top": 4000.0,
		"coverage_far": 1.0, "coverage_far_range": Vector2(6000.0, 40000.0), "weather_variety": 0.15,
		"exposure": 0.22, "rayleigh": 2.0, "turbidity": 14.0, "mie": 0.005, "mie_eccentricity": 0.8,
		"rayleigh_color": Color(0.26, 0.41, 0.58), "sky_saturation": 0.6,
		"haze_color": Vector3(0.10, 0.11, 0.13), "haze_sun_color": Vector3(0.14, 0.15, 0.17),
		"haze_strength": 0.75, "haze_power": 5.0,
		"sun_disk_scale": 0.02, "sun_glow": Vector2(0.0, 0.0), "sun_glow_color": Vector3(1.0, 1.0, 1.0),
		"cloud_visibility": 35000.0, "horizon_fade": Vector2(0.975, 0.999),
		"cloud_sun": 1.2, "cloud_ambient": 5.0, "cloud_shoulder": 1.0, "phase_cap": 0.3,
		"shadow_strength": 0.5, "base_shade": 1.0, "powder": 1.0, "detail_strength": 0.7, "detail_floor": 0.5,
		"cloud_tint": Vector3(0.9, 0.95, 1.0), "sun_tint": Vector3(1.0, 1.0, 1.0),
		"cloud_floor": Vector3(0.05, 0.06, 0.075)}},
}


## Ветер: куда плывут облака (по компасу, градусы) и с какой скоростью, м/с. Всё поле облаков смещается целиком —
## форма каждого облака не меняется (замечание владельца 14.11). 20 м/с — облако над головой проходит
## широкий кадр за две-три минуты.
const WIND_SIDE := 120.0
const WINDS := [["стоят", 0.0], ["плывут медленно", 20.0], ["плывут", 40.0], ["плывут быстро", 80.0]]


## Скорость сноса облаков, м/с, в координатах сцены (x — восток, y — юг: это ось Z сцены).
func wind_velocity() -> Vector2:
	var side := deg_to_rad(WIND_SIDE)
	return Vector2(sin(side), -cos(side)) * float(WINDS[wind][1])


const NOISES := {"worlnoise": "res://nebo/worlnoise.bmp", "perlworlnoise": "res://nebo/perlworlnoise.tga",
	"weathermap": "res://nebo/weather.bmp"}


func _build_sky() -> void:
	sky_direct = ShaderMaterial.new()
	sky_direct.shader = load("res://src/nebo.gdshader")
	sky_dome = ShaderMaterial.new()
	sky_dome.shader = load("res://src/nebo_kupol.gdshader")
	dome_material = ShaderMaterial.new()
	dome_material.shader = load("res://src/kupol.gdshader")
	for material: ShaderMaterial in [sky_direct, sky_dome, dome_material]:
		for key: String in NOISES:
			material.set_shader_parameter(key, load(NOISES[key]))
	# Две картинки купола: одна показывается, вторая в это время досчитывается полосами.
	for i in 2:
		var view := SubViewport.new()
		view.size = Vector2i(dome_size, dome_size)
		view.disable_3d = true
		view.transparent_bg = true
		view.use_hdr_2d = true
		view.render_target_clear_mode = SubViewport.CLEAR_MODE_ONCE
		view.render_target_update_mode = SubViewport.UPDATE_ONCE
		var rect := ColorRect.new()
		rect.size = Vector2.ZERO
		rect.material = dome_material
		view.add_child(rect)
		add_child(view)
		dome_views.append(view)
		dome_rects.append(rect)
	sky = Sky.new()
	sky.sky_material = sky_dome
	# Отражение неба для света пересчитывать понемногу, а не каждый кадр целиком.
	sky.process_mode = Sky.PROCESS_MODE_INCREMENTAL
	sky.radiance_size = Sky.RADIANCE_SIZE_128
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_white = 3.22
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	# Дымка: дальнее море и берег уходят в цвет неба у горизонта — готовое средство движка.
	# Дымка по расстоянию: вблизи её нет, к краю моря (40 км) она полная — море уходит в цвет неба у горизонта.
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_depth_begin = 1500.0
	env.fog_depth_end = 39000.0
	env.fog_depth_curve = 3.0
	env.fog_density = 1.0
	env.fog_aerial_perspective = 0.0
	env.fog_sun_scatter = 0.0
	env.fog_sky_affect = 0.0
	world = WorldEnvironment.new()
	world.environment = env
	add_child(world)
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 3000.0
	add_child(sun)
	set_sky(sky_name)
	set_quality(quality)


## Включить состояние неба: «den», «zakat» или «shtorm».
func set_sky(title: String) -> void:
	sky_name = title
	var look: Dictionary = SKIES[title]
	var height := deg_to_rad(float(look["sun_height"]))
	var compass := deg_to_rad(float(look["sun_side"]))
	# Сторона солнца — по компасу: 0 — север (−Z, см. at()), 90 — восток (+X).
	var to_sun := Vector3(sin(compass) * cos(height), sin(height), -cos(compass) * cos(height))
	sun.look_at_from_position(Vector3.ZERO, -to_sun, Vector3.UP)
	sun.light_energy = float(look["energy"])
	sun.light_color = look["light_color"]
	# Рассеянный свет неба на земле и море: на закате и в шторм слабее — бухта не светится дневной бирюзой.
	world.environment.ambient_light_energy = float(look["ambient"])
	# Шейдеру купола солнце передаётся числами: встроенных значений светила у него нет.
	var light := sun.light_color.srgb_to_linear()
	dome_material.set_shader_parameter("sun_dir", to_sun)
	dome_material.set_shader_parameter("sun_power", sun.light_energy)
	dome_material.set_shader_parameter("sun_color", Vector3(light.r, light.g, light.b))
	# Дымка над землёй и морем — того же цвета, что дымка неба у горизонта: без шва по линии горизонта.
	var haze: Vector3 = (look["shader"]["haze_color"] as Vector3).lerp(look["shader"]["haze_sun_color"], 0.3)
	world.environment.fog_light_color = Color(haze.x, haze.y, haze.z).linear_to_srgb()
	for material: ShaderMaterial in [sky_direct, sky_dome, dome_material]:
		material.set_shader_parameter("horizon_color", haze)
		material.set_shader_parameter("horizon_line", 1.0)
	_sea_look()
	var numbers: Dictionary = look["shader"]
	for material: ShaderMaterial in [sky_direct, sky_dome, dome_material]:
		for key: String in numbers:
			material.set_shader_parameter(key, numbers[key])
		# Числа из ключа --par=имя:число,… — для подгонки без правки файла.
		for key: String in overrides:
			material.set_shader_parameter(key, overrides[key])
	_sky_moment()
	dome_full = true


## Текущие снос облаков и место камеры — небу (картинка купола получает свои в момент съёмки).
func _sky_moment() -> void:
	for material: ShaderMaterial in [sky_direct, sky_dome]:
		material.set_shader_parameter("cloud_drift", cloud_drift)
		if camera != null:
			material.set_shader_parameter("camera_place", camera.position)


## Качество облаков: название, способ, размер картинки купола, на сколько полос (кадров) делится её обновление.
## «Купол» — облака считаются в отдельную картинку неба по одной полосе за кадр, экран её только показывает;
## «прямой» — облака считаются заново в каждом кадре на половине разрешения экрана (как в образце шейдера).
const QUALITY := [
	["высокое (купол 2048)", "kupol", 2048, 64],
	["среднее (купол 1536)", "kupol", 1536, 48],
	["низкое (купол 1024)", "kupol", 1024, 32],
	["прямой расчёт в каждом кадре — для сравнения", "pryamoy", 0, 0],
	["облака выключены — для замера", "net", 0, 0],
]


func set_quality(level: int) -> void:
	quality = posmod(level, QUALITY.size())
	var mode: String = QUALITY[quality][1]
	sky.sky_material = sky_direct if mode == "pryamoy" else sky_dome
	sky_dome.set_shader_parameter("dome_on", 1.0 if mode == "kupol" else 0.0)
	dome_active = mode == "kupol"
	if dome_active:
		dome_size = QUALITY[quality][2]
		dome_bands = QUALITY[quality][3]
		for view in dome_views:
			view.size = Vector2i(dome_size, dome_size)
		_dome_clear()
		dome_material.set_shader_parameter("dome_size", float(dome_size))
		sky_dome.set_shader_parameter("dome_size", float(dome_size))
		dome_full = true
	else:
		for view in dome_views:
			view.render_target_update_mode = SubViewport.UPDATE_DISABLED


## За сколько кадров новая картинка купола проявляется поверх прежней.
const DOME_FADE := 8
## На сколько кадров делится срочный расчёт картинки (после смены неба или качества). Целиком за один кадр
## её считать нельзя: это в восемь раз дольше обычного кадра прямого расчёта, а долгий кадр видеокарта может
## счесть зависанием.
const DOME_RUSH := 8


## Шаг обновления купола, раз в кадр. Вторая картинка считается полосами; когда готова вся — она за несколько
## кадров проявляется поверх прежней, и картинки меняются местами. После смены неба или качества расчёт
## начинается заново и идёт быстрее.
func _dome_tick() -> void:
	if not dome_active or camera == null:
		return
	if dome_full:
		dome_full = false
		dome_cursor = 0
		dome_fade = DOME_FADE
		if dome_instant:
			dome_clearing = false
			_dome_snapshot(dome_front)
			_dome_draw(dome_front, 0, dome_size)
			_dome_show()
			return
		dome_fill_bands = DOME_RUSH
		_dome_show()
	if dome_clearing:
		# Этот кадр уходит на очистку обеих картинок; расчёт начнётся со следующего.
		dome_clearing = false
		return
	if dome_fade < DOME_FADE:
		# Прежняя картинка ещё видна — в неё пока не пишем.
		dome_fade += 1
		sky_dome.set_shader_parameter("dome_blend", float(dome_fade) / DOME_FADE)
		return
	if dome_cursor >= dome_fill_bands:
		dome_front = 1 - dome_front
		dome_fade = 0
		_dome_show()
		dome_cursor = 0
		dome_fill_bands = dome_bands
		return
	var back := 1 - dome_front
	if dome_cursor == 0:
		_dome_snapshot(back)
	@warning_ignore("integer_division")
	var band := dome_size / dome_fill_bands
	_dome_draw(back, dome_cursor * band, band)
	dome_cursor += 1


## Очистить обе картинки купола (в начале и после смены их размера: содержимое новой картинки не определено).
func _dome_clear() -> void:
	dome_clearing = true
	for i in 2:
		dome_rects[i].size = Vector2.ZERO
		dome_views[i].render_target_clear_mode = SubViewport.CLEAR_MODE_ONCE
		dome_views[i].render_target_update_mode = SubViewport.UPDATE_ONCE


## Запомнить снос облаков и место, при которых снимается картинка, и передать их её расчёту.
func _dome_snapshot(index: int) -> void:
	snap_drifts[index] = cloud_drift
	snap_places[index] = camera.position
	dome_material.set_shader_parameter("cloud_drift", cloud_drift)
	dome_material.set_shader_parameter("camera_place", camera.position)


## Посчитать в этом кадре полосу картинки: строки от y, высотой rows.
func _dome_draw(index: int, y: int, rows: int) -> void:
	for i in 2:
		dome_views[i].render_target_update_mode = SubViewport.UPDATE_ONCE if i == index else SubViewport.UPDATE_DISABLED
	dome_rects[index].position = Vector2(0.0, y)
	dome_rects[index].size = Vector2(dome_size, rows)


## Показать небу готовую картинку.
func _dome_show() -> void:
	var prev := 1 - dome_front
	sky_dome.set_shader_parameter("dome", dome_views[dome_front].get_texture())
	sky_dome.set_shader_parameter("snap_drift", snap_drifts[dome_front])
	sky_dome.set_shader_parameter("snap_place", snap_places[dome_front])
	sky_dome.set_shader_parameter("dome_prev", dome_views[prev].get_texture())
	sky_dome.set_shader_parameter("prev_drift", snap_drifts[prev])
	sky_dome.set_shader_parameter("prev_place", snap_places[prev])
	sky_dome.set_shader_parameter("dome_blend", float(dome_fade) / DOME_FADE)


func _build_camera() -> void:
	camera = Camera3D.new()
	camera.fov = 35.0
	camera.near = 1.0
	camera.far = 40000.0
	add_child(camera)
	camera.make_current()


func _load_png(file: String) -> Image:
	var image := Image.new()
	var err := image.load_png_from_buffer(FileAccess.get_file_as_bytes(DATA + file))
	assert(err == OK, "не читается " + file)
	return image


func _build_terrain() -> void:
	var t0 := Time.get_ticks_msec()
	var h_min := float(info["vysota_min_m"])
	var h_range := float(info["vysota_max_m"]) - h_min
	# Высоты: по два байта на точку (0…65535), переводим в метры сразу.
	var raw := FileAccess.get_file_as_bytes(DATA + "vysoty.r16")
	assert(raw.size() == size * size * 2, "высоты не того размера")
	var metres := PackedFloat32Array()
	metres.resize(size * size)
	for i in size * size:
		metres[i] = h_min + raw.decode_u16(i * 2) / 65535.0 * h_range
	var heights := Image.create_from_data(size, size, false, Image.FORMAT_RF, metres.to_byte_array())
	heights_image = heights

	terrain = Terrain3D.new()
	terrain.name = "Terrain3D"
	terrain.free_editor_textures = false
	add_child(terrain, true)
	terrain.set_camera(camera)
	terrain.vertex_spacing = side / float(size)
	terrain.region_size = Terrain3D.SIZE_1024
	terrain.mesh_lods = 8
	terrain.material.world_background = Terrain3DMaterial.NONE
	# Готовые средства дополнения против повтора плитки издали: второй, крупный масштаб и пятна цвета.
	terrain.material.dual_scaling_enabled = true
	terrain.material.macro_variation_enabled = true

	# Материалы: свободные фотосканы, подготовленные teksturi.py.
	var table: Array = JSON.parse_string(FileAccess.get_file_as_string(DATA + "materialy.json"))
	for i in table.size():
		var asset := Terrain3DTextureAsset.new()
		asset.name = table[i]["imya"]
		asset.albedo_texture = load("res://teksturi/%s_alb.png" % table[i]["imya"])
		asset.normal_texture = load("res://teksturi/%s_nrm.png" % table[i]["imya"])
		asset.uv_scale = 1.0 / float(table[i]["plitka_m"])
		terrain.assets.set_texture_asset(i, asset)

	# Раскладка материалов: по 32 бита на точку в виде дополнения, без пересчёта.
	var bits := FileAccess.get_file_as_bytes(DATA + "kontrol.u32")
	assert(bits.size() == size * size * 4, "карта раскладки не того размера")
	var control := Image.create_from_data(size, size, false, Image.FORMAT_RF, bits)
	terrain.data.import_images([heights, control, null], Vector3(-side * 0.5, 0.0, -side * 0.5), 0.0, 1.0)
	var range_now: Vector2 = terrain.data.get_height_range()
	print("МИР земля загружена за ", Time.get_ticks_msec() - t0, " мс; высоты ", range_now)
	_build_sea()


## Море: шейдер воды из игры (его вид владелец принял), дно — из карты высот основы.
## Вид моря под небо: в шторм — штормовое (числа — из игры).
func _sea_look() -> void:
	if sea_material == null:
		return
	var storm := 1.0 if sky_name == "shtorm" else 0.0
	var look: Dictionary = WaterLook.at(storm).duplicate()
	look["swash"] = WaterLook.SWASH.x
	WaterLook.apply(sea_material, look)


func _build_sea() -> void:
	sea_material = ShaderMaterial.new()
	sea_material.shader = load("res://src/voda.gdshader")
	_sea_look()
	var foam: Array = WaterLook.make_foam_map()
	sea_material.set_shader_parameter("wave_map", WaterLook.make_wave_map())
	sea_material.set_shader_parameter("wave_cycles", WaterLook.WAVE_CYCLES)
	sea_material.set_shader_parameter("foam_map", foam[0])
	sea_material.set_shader_parameter("foam_cycles", WaterLook.FOAM_CYCLES)
	sea_material.set_shader_parameter("foam_gain", foam[1])
	sea_material.set_shader_parameter("foam_bias", foam[2])
	sea_material.set_shader_parameter("height_map", ImageTexture.create_from_image(heights_image))
	# Глубина моря за краем участка — как у самого края: средняя по морским точкам его границы.
	var edge_sum := 0.0
	var edge_count := 0
	var last := heights_image.get_width() - 1
	for i in range(0, last + 1, 8):
		for point: Vector2i in [Vector2i(i, 0), Vector2i(i, last), Vector2i(0, i), Vector2i(last, i)]:
			var depth := heights_image.get_pixelv(point).r
			if depth < -1.0:
				edge_sum += depth
				edge_count += 1
	if edge_count > 0:
		sea_material.set_shader_parameter("far_bed", edge_sum / edge_count)
		print("МИР глубина моря у края участка ", snappedf(edge_sum / edge_count, 0.1), " м")
	sea_material.set_shader_parameter("bake_rect", Vector4(-side * 0.5, -side * 0.5, side, side))
	sea_material.set_shader_parameter("bed_texel_m", side / float(size))
	sea_material.set_shader_parameter("water_time", WaterLook.SHOT_TIME)
	sea_material.set_shader_parameter("swash_time", WaterLook.SHOT_TIME)
	var plane := PlaneMesh.new()
	plane.size = Vector2(80000.0, 80000.0)
	sea = MeshInstance3D.new()
	sea.mesh = plane
	sea.material_override = sea_material
	sea.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sea.position = Vector3(0.0, float(info["more_m"]) + WaterLook.SWASH.x, 0.0)
	add_child(sea)
	sea.set_instance_shader_parameter("water_level", float(info["more_m"]))


const SKY_TITLES := {"den": "ясный день", "zakat": "закат", "shtorm": "шторм"}


## Режим владельца: весь экран, без ограничения частоты кадров, картинка мира в 67 % с достройкой — как в игре.
func _build_controls() -> void:
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	_apply_scale()
	# Первый вид — как в кадрах Unreal владельца: широкий угол, взгляд в сторону солнца чуть выше горизонта.
	_apply_fov()
	var eye := at(4300.0, 4000.0, 420.0)
	var sun_side := deg_to_rad(float(SKIES[sky_name]["sun_side"]))
	camera.look_at_from_position(eye, eye + Vector3(sin(sun_side), 0.0, -cos(sun_side)) * 5000.0 + Vector3(0.0, 980.0, 0.0),
			Vector3.UP)
	# Надписи — в размер экрана: на экране владельца (2880 точек в ширину) мелкий шрифт не прочесть.
	var k := maxf(DisplayServer.screen_get_size().y / 900.0, 1.0)
	var layer := CanvasLayer.new()
	add_child(layer)
	var box := VBoxContainer.new()
	box.position = Vector2(24, 16) * k
	layer.add_child(box)
	fps_label = Label.new()
	fps_label.add_theme_font_size_override("font_size", int(40 * k))
	fps_label.add_theme_color_override("font_outline_color", Color.BLACK)
	fps_label.add_theme_constant_override("outline_size", int(8 * k))
	box.add_child(fps_label)
	help = Label.new()
	help.add_theme_font_size_override("font_size", int(19 * k))
	help.add_theme_color_override("font_outline_color", Color.BLACK)
	help.add_theme_constant_override("outline_size", int(6 * k))
	box.add_child(help)
	_update_help()


## Угол зрения по вертикали: 59° — это 90° по горизонтали, как в кадрах Unreal владельца; 35° — камера игры.
func _apply_fov() -> void:
	camera.fov = 59.0 if wide else 35.0


func _apply_scale() -> void:
	var viewport := get_viewport()
	viewport.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR if full_res else Viewport.SCALING_3D_MODE_FSR
	viewport.scaling_3d_scale = 1.0 if full_res else 0.67


func _update_help() -> void:
	if help == null:
		return
	help.text = "Полёт: W A S D, вверх и вниз — E и Q, быстрее — Shift\n" \
			+ "Осмотреться: зажать правую кнопку мыши (или стрелки)\n" \
			+ "1 2 3 — небо: ясный день, закат, шторм  (сейчас: %s)\n" % SKY_TITLES[sky_name] \
			+ "4 — качество облаков  (сейчас: %s)\n" % QUALITY[quality][0] \
			+ "5 — угол зрения  (сейчас: %s)\n" % ("широкий, как в кадрах Unreal" if wide else "как в игре, 35°") \
			+ "6 — разрешение  (сейчас: %s)\n" % ("полное" if full_res else "67 % с достройкой, как в игре") \
			+ "7 — земля и море  (сейчас: %s)\n" % ("показаны" if terrain.visible else "скрыты — одно небо") \
			+ "8 — ветер: облака %s  (%d м/с)\n" % [WINDS[wind][0], int(WINDS[wind][1])] \
			+ "H — скрыть подсказку,  Esc — выход"


func _unhandled_input(event: InputEvent) -> void:
	if shots_dir != "":
		return
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_RIGHT:
		looking = event.pressed
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if looking else Input.MOUSE_MODE_VISIBLE
	elif event is InputEventMouseMotion and looking:
		_turn(-event.relative.x * 0.0022, -event.relative.y * 0.0022)
	elif event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_1: set_sky("den")
			KEY_2: set_sky("zakat")
			KEY_3: set_sky("shtorm")
			KEY_4: set_quality(quality + 1)
			KEY_5:
				wide = not wide
				_apply_fov()
			KEY_6:
				full_res = not full_res
				_apply_scale()
			KEY_7:
				terrain.visible = not terrain.visible
				sea.visible = terrain.visible
			KEY_8: wind = posmod(wind + 1, WINDS.size())
			KEY_H: help.visible = not help.visible
			KEY_ESCAPE: get_tree().quit()
		_update_help()


## Повернуть взгляд: по сторонам и вверх-вниз (не дальше зенита и надира).
func _turn(yaw: float, pitch: float) -> void:
	var angles := camera.rotation
	angles.y += yaw
	angles.x = clampf(angles.x + pitch, deg_to_rad(-88.0), deg_to_rad(88.0))
	angles.z = 0.0
	camera.rotation = angles


func _process(delta: float) -> void:
	if shots_dir != "":
		return
	if sea_material != null:
		water_time += delta * WaterLook.SPEED.x
		swash_time += delta
		sea_material.set_shader_parameter("water_time", water_time)
		sea_material.set_shader_parameter("swash_time", swash_time)
	if fps_label == null:
		return
	# В пробе облака идут ровно по 1/60 с за кадр: кадры на программной отрисовке длятся секундами.
	cloud_drift += wind_velocity() * (delta if probe_dir == "" else 1.0 / 60.0)
	_sky_moment()
	_dome_tick()
	fps_label.text = "%d кадров/с" % Engine.get_frames_per_second()
	var move := Vector3.ZERO
	if Input.is_physical_key_pressed(KEY_W): move.z -= 1.0
	if Input.is_physical_key_pressed(KEY_S): move.z += 1.0
	if Input.is_physical_key_pressed(KEY_A): move.x -= 1.0
	if Input.is_physical_key_pressed(KEY_D): move.x += 1.0
	if Input.is_physical_key_pressed(KEY_E): move.y += 1.0
	if Input.is_physical_key_pressed(KEY_Q): move.y -= 1.0
	var speed := fly_speed * (4.0 if Input.is_physical_key_pressed(KEY_SHIFT) else 1.0)
	if move != Vector3.ZERO:
		# Вперёд и вбок — по взгляду, вверх и вниз — по отвесу.
		var step := camera.global_transform.basis * Vector3(move.x, 0.0, move.z) + Vector3(0.0, move.y, 0.0)
		camera.position += step.normalized() * speed * delta
	var turn := Vector2.ZERO
	if Input.is_physical_key_pressed(KEY_LEFT): turn.x += 1.0
	if Input.is_physical_key_pressed(KEY_RIGHT): turn.x -= 1.0
	if Input.is_physical_key_pressed(KEY_UP): turn.y += 1.0
	if Input.is_physical_key_pressed(KEY_DOWN): turn.y -= 1.0
	if turn != Vector2.ZERO:
		_turn(turn.x * delta * 0.9, turn.y * delta * 0.9)
	# Облака всегда выше камеры: выше их нижней кромки камера не поднимается; ниже земли и воды — тоже.
	var ground := 2.0
	if terrain != null and terrain.data != null:
		var h: float = terrain.data.get_height(camera.position)
		if not is_nan(h):
			ground = maxf(h, 0.0) + 2.0
	camera.position.y = clampf(camera.position.y, ground, 1400.0)


func _probe() -> void:
	DirAccess.make_dir_recursive_absolute(probe_dir)
	var steps := [["den", 0, false], ["zakat", 1, false], ["shtorm", 2, false], ["den", 3, true], ["den", 4, false]]
	if only_dome_probe:
		steps = []
	for step: Array in steps:
		set_sky(step[0])
		set_quality(step[1])
		wide = step[2]
		_apply_fov()
		_update_help()
		# Срочный расчёт картинки купола и её проявление.
		for i in DOME_RUSH + DOME_FADE + 4:
			await get_tree().process_frame
		var t0 := Time.get_ticks_usec()
		await RenderingServer.frame_post_draw
		var ms := (Time.get_ticks_usec() - t0) / 1000.0
		get_viewport().get_texture().get_image().save_png(probe_dir.path_join("proba-%s-%d.png" % [step[0], step[1]]))
		print("ПРОВЕРКА образец: небо ", step[0], ", качество ", QUALITY[quality][0], ", кадр ", snappedf(ms, 0.1), " мс, окно ",
				get_window().size, ", доля разрешения ", get_viewport().scaling_3d_scale)
	# Обновление купола полосами при летящей камере (10 м за кадр): кадр в середине обычного круга, кадр
	# в середине проявления новой картинки, кадр после смены и — для сравнения — тот же момент с картинкой,
	# посчитанной заново. Расхождение двух последних — ошибка пересчёта направления.
	set_sky("den")
	set_quality(2)
	camera.fov = 59.0
	camera.look_at_from_position(at(4300.0, 4000.0, 420.0), at(6000.0, 6000.0, 2600.0), Vector3.UP)
	help.visible = false
	for frame in range(1, 63):
		camera.position += Vector3(10.0, 0.0, 4.0)
		await get_tree().process_frame
		if frame == 30 or frame == 54 or frame == 62:
			await RenderingServer.frame_post_draw
			get_viewport().get_texture().get_image().save_png(probe_dir.path_join("proba-kupol-%d.png" % frame))
			print("ПРОВЕРКА купол: кадр ", frame, ", полос посчитано ", dome_cursor, ", показывается картинка ", dome_front,
					", облака с тех пор уплыли на ", snappedf(cloud_drift.distance_to(snap_drifts[dome_front]), 0.1), " м, сдвиг камеры ",
					snappedf(camera.position.distance_to(snap_places[dome_front]), 1.0), " м")
	set_process(false)
	dome_instant = true
	dome_full = true
	_sky_moment()
	_dome_tick()
	for i in 2:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(probe_dir.path_join("proba-kupol-62-zanovo.png"))
	# Ход облаков: всё поле смещается целиком, форма облаков не меняется. Кадр; тот же вид, когда облака уплыли
	# на 15 секунд хода, показанный пересчётом прежней картинки (так он выглядит между обновлениями); он же,
	# посчитанный заново (расхождение этих двух — ошибка пересчёта); и ещё через 15 секунд.
	var start := cloud_drift
	var stride := wind_velocity() * 15.0
	for stage: Array in [["hod-00", 0.0, true], ["hod-15-pereschyot", 1.0, false], ["hod-15-zanovo", 1.0, true], ["hod-30", 2.0, true]]:
		cloud_drift = start + stride * float(stage[1])
		_sky_moment()
		if stage[2]:
			dome_full = true
			_dome_tick()
		for i in 2:
			await get_tree().process_frame
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(probe_dir.path_join("proba-%s.png" % stage[0]))
	print("ПРОВЕРКА ход облаков: за 15 с — ", snappedf(stride.length(), 1.0), " м, ветер ", WINDS[wind][1], " м/с")
	print("ИТОГ проба образца пройдена")


func _shots() -> void:
	DirAccess.make_dir_recursive_absolute(shots_dir)
	get_viewport().scaling_3d_scale = shot_scale
	dome_instant = true
	var dome_place := Vector3.INF
	# Небо под землю светит через карту отражений, она обновляется по частям — нужно несколько кадров.
	camera.look_at_from_position(at(600.0, 900.0, 5200.0), at(6300.0, 6000.0, 100.0), Vector3.UP)
	for i in 10:
		await get_tree().process_frame
	# Виды: имя, откуда, куда, угол зрения по вертикали. Первые три — как кадры Unreal владельца (там угол 90°
	# по горизонтали — это 59° по вертикали): небо с землёй, небо в сторону солнца, одно небо; остальные —
	# камера игры (35°).
	var eye := at(4300.0, 4000.0, 420.0)
	var sun_side := deg_to_rad(float(SKIES[sky_name]["sun_side"]))
	var toward_sun := eye + Vector3(sin(sun_side), 0.0, -cos(sun_side)) * 5000.0 + Vector3(0.0, 980.0, 0.0)
	var views := [
		["nebo-zemlya", eye, at(6800.0, 6900.0, 1150.0), 59.0],
		["nebo-solntse", eye, toward_sun, 59.0],
		["nebo", eye, at(6000.0, 6000.0, 3600.0), 59.0],
		["obshchiy", at(600.0, 900.0, 5200.0), at(6300.0, 6000.0, 100.0), 35.0],
		["gorizont", at(2600.0, 2200.0, 1500.0), at(7800.0, 7600.0, 300.0), 35.0],
		["buhta", at(4350.0, 4150.0, 950.0), at(5414.0, 5333.0, 20.0), 35.0],
	]
	for view in views:
		if not only_views.is_empty() and not only_views.has(view[0]):
			continue
		camera.fov = view[3]
		camera.look_at_from_position(view[1], view[2], Vector3.UP)
		_sky_moment()
		# Картинка купола зависит от места камеры, а не от направления взгляда: для видов из одной точки она общая.
		if dome_place != camera.position:
			dome_place = camera.position
			dome_full = true
			_dome_tick()
		for i in 4:
			await get_tree().process_frame
		var t0 := Time.get_ticks_usec()
		await RenderingServer.frame_post_draw
		var ms := (Time.get_ticks_usec() - t0) / 1000.0
		var path := shots_dir.path_join("%s-%s.png" % [sky_name, view[0]])
		get_viewport().get_texture().get_image().save_png(path)
		print("КАДР ", view[0], " ", snappedf(ms, 0.1), " мс")
	print("ИТОГ кадры сняты")
