extends Node3D
## Сцена для сравнения движков: берег Корфу в Godot.
## Земля — готовое дополнение Terrain3D; место, покров и расстановка — общая основа (sravnenie/osnova).
## Ключи запуска: --kadry=ПАПКА — снять контрольные виды в папку и выйти;
## --nebo=den|zakat|shtorm — состояние неба; --vidy=имя,имя — снять только эти виды;
## --kachestvo=0|1|2 — качество облаков (0 — высокое); --par=имя:число,… — числа шейдера неба поверх таблицы;
## --vremya=100 — время облаков в кадрах, секунды (в кадрах облака стоят: кадры повторимы);
## --masshtab=50 — кадры в половину разрешения (в рабочей среде на этом падает программная отрисовка).
##
## --bez-zemli, --bez-morya — без земли, без моря (оба ключа — одно небо). В рабочей среде программная отрисовка
## на некоторых ракурсах с землёй у горизонта падает (внутри неё, на отрисовке дополнения Terrain3D) — небо
## сверяется кадрами с ключом --bez-zemli;
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
var no_land := false
var no_sea := false
var sky_name := "den"
var quality := 0
var overrides := {}
var sky_time := 100.0  ## время облаков, секунды: в кадрах стоит, у владельца идёт
var shot_scale := 1.0
var sky_shaders: Array[Shader] = []
var help: Label
var fps_label: Label
var fly_speed := 400.0
var looking := false
var wide := false
var full_res := false
var only_views := PackedStringArray()
var sky_material: ShaderMaterial
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
		if a.begins_with("--proba="):
			probe_dir = a.trim_prefix("--proba=")
		if a.begins_with("--vremya="):
			sky_time = float(a.trim_prefix("--vremya="))
		if a.begins_with("--masshtab="):
			shot_scale = float(a.trim_prefix("--masshtab=")) / 100.0
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
	"den": {"sun_height": 30.0, "sun_side": 215.0, "energy": 1.0, "shader": {
		"cloud_coverage": 0.2, "_density": 0.05, "weather_scale": 0.00012, "cloud_bottom": 2500.0, "cloud_top": 4500.0,
		"exposure": 0.159, "rayleigh": 1.67, "turbidity": 1.3, "mie": 0.0038,
		"rayleigh_color": Color(0.24, 0.32, 0.48), "sky_saturation": 1.53,
		"haze_color": Vector3(0.64, 0.60, 0.48), "haze_strength": 0.68, "haze_power": 10.0, "sun_disk_scale": 2.0,
		"cloud_sun": 1.0, "cloud_ambient": 0.75, "cloud_shoulder": 1.0, "phase_cap": 0.2,
		"cloud_tint": Vector3(1.0, 0.975, 0.94)}},
	"zakat": {"sun_height": 7.0, "sun_side": 262.0, "energy": 1.0, "shader": {
		"cloud_coverage": 0.22, "_density": 0.05, "weather_scale": 0.00012, "cloud_bottom": 2500.0, "cloud_top": 4500.0,
		"exposure": 0.12, "rayleigh": 1.6, "turbidity": 5.0, "mie": 0.005,
		"rayleigh_color": Color(0.32, 0.44, 0.67), "sky_saturation": 1.34,
		"haze_color": Vector3(0.8, 0.5, 0.3), "haze_strength": 0.5, "haze_power": 12.0, "sun_disk_scale": 2.0,
		"cloud_sun": 1.0, "cloud_ambient": 0.9, "cloud_shoulder": 1.0, "phase_cap": 0.35,
		"cloud_tint": Vector3(1.0, 1.0, 1.0)}},
	"shtorm": {"sun_height": 40.0, "sun_side": 215.0, "energy": 0.45, "shader": {
		"cloud_coverage": 0.95, "_density": 0.12, "weather_scale": 0.00006, "cloud_bottom": 1500.0, "cloud_top": 4000.0,
		"exposure": 0.1, "rayleigh": 2.0, "turbidity": 14.0, "mie": 0.005,
		"rayleigh_color": Color(0.26, 0.41, 0.58), "sky_saturation": 0.6,
		"haze_color": Vector3(0.2, 0.21, 0.22), "haze_strength": 0.6, "haze_power": 6.0, "sun_disk_scale": 1.0,
		"cloud_sun": 1.0, "cloud_ambient": 1.0, "cloud_shoulder": 0.0, "phase_cap": 10.0,
		"cloud_tint": Vector3(1.0, 1.0, 1.0)}},
}


func _build_sky() -> void:
	# Два вида одного шейдера: облака считаются в половину разрешения или в четверть.
	var half: Shader = load("res://src/nebo.gdshader")
	var quarter := Shader.new()
	quarter.code = half.code.replace("render_mode use_half_res_pass, use_quarter_res_pass;", "render_mode use_quarter_res_pass;") \
			.replace("} else if (AT_HALF_RES_PASS && !AT_CUBEMAP_PASS) {", "} else if (AT_QUARTER_RES_PASS) {") \
			.replace("COLOR = HALF_RES_COLOR.rgb;", "COLOR = QUARTER_RES_COLOR.rgb;")
	# Третий вид — то же небо без облаков: только для замера, сколько кадров стоят сами облака.
	var bare := Shader.new()
	bare.code = quarter.code.replace("vec4 volume = march(start, end, raystep, int(steps));", "vec4 volume = vec4(0.0);")
	sky_shaders = [half, quarter, bare]
	sky_material = ShaderMaterial.new()
	sky_material.set_shader_parameter("worlnoise", load("res://nebo/worlnoise.bmp"))
	sky_material.set_shader_parameter("perlworlnoise", load("res://nebo/perlworlnoise.tga"))
	sky_material.set_shader_parameter("weathermap", load("res://nebo/weather.bmp"))
	var sky := Sky.new()
	sky.sky_material = sky_material
	# Отражение неба для света пересчитывать понемногу, а не каждый кадр целиком: облака дорогие.
	sky.process_mode = Sky.PROCESS_MODE_INCREMENTAL
	sky.radiance_size = Sky.RADIANCE_SIZE_128
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_white = 3.22
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	# Дымка: дальнее море и берег уходят в цвет неба у горизонта — готовое средство движка.
	env.fog_enabled = true
	env.fog_density = 0.000035
	env.fog_aerial_perspective = 1.0
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
	# Сторона солнца — по компасу: 0 — север, 90 — восток. В этой сцене север — в сторону +Z (см. at()).
	var to_sun := Vector3(sin(compass) * cos(height), sin(height), cos(compass) * cos(height))
	sun.look_at_from_position(Vector3.ZERO, -to_sun, Vector3.UP)
	sun.light_energy = float(look["energy"])
	_sea_look()
	var numbers: Dictionary = look["shader"]
	for key in numbers:
		sky_material.set_shader_parameter(key, numbers[key])
	# Числа из ключа --par=имя:число,… — для подгонки без правки файла.
	for key in overrides:
		sky_material.set_shader_parameter(key, overrides[key])
	sky_material.set_shader_parameter("sky_time", sky_time)


## Качество облаков. 0 — высокое: половина разрешения, полный луч; 1 — среднее: четверть разрешения;
## 2 — низкое: четверть разрешения и вдвое меньше шагов луча; 3 — без облаков (замер их цены).
const QUALITY := [["высокое", 0, 1.0], ["среднее", 1, 1.0], ["низкое", 1, 0.5], ["облака выключены (для замера)", 2, 1.0]]


func set_quality(level: int) -> void:
	quality = posmod(level, QUALITY.size())
	sky_material.shader = sky_shaders[QUALITY[quality][1]]
	sky_material.set_shader_parameter("steps_scale", QUALITY[quality][2])
	# Параметры после смены шейдера сохраняются, но текстуры надёжнее задать заново.
	sky_material.set_shader_parameter("worlnoise", load("res://nebo/worlnoise.bmp"))
	sky_material.set_shader_parameter("perlworlnoise", load("res://nebo/perlworlnoise.tga"))
	sky_material.set_shader_parameter("weathermap", load("res://nebo/weather.bmp"))
	set_sky(sky_name)


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
	camera.fov = 35.0
	camera.look_at_from_position(at(4300.0, 4000.0, 420.0), at(6800.0, 6900.0, 700.0), Vector3.UP)
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
			+ "5 — угол зрения  (сейчас: %s)\n" % ("широкий, 90°" if wide else "как в игре, 35°") \
			+ "6 — разрешение  (сейчас: %s)\n" % ("полное" if full_res else "67 % с достройкой, как в игре") \
			+ "7 — земля и море  (сейчас: %s)\n" % ("показаны" if terrain.visible else "скрыты — одно небо") \
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
				camera.fov = 90.0 if wide else 35.0
			KEY_6:
				full_res = not full_res
				_apply_scale()
			KEY_7:
				terrain.visible = not terrain.visible
				sea.visible = terrain.visible
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
	sky_time += delta
	sky_material.set_shader_parameter("sky_time", sky_time)
	sky_material.set_shader_parameter("camera_place", camera.position)
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
	var steps := [["den", 0, false], ["zakat", 1, false], ["shtorm", 2, false], ["den", 3, true]]
	for step: Array in steps:
		set_sky(step[0])
		set_quality(step[1])
		wide = step[2]
		camera.fov = 90.0 if wide else 35.0
		_update_help()
		for i in 4:
			await get_tree().process_frame
		var t0 := Time.get_ticks_usec()
		await RenderingServer.frame_post_draw
		var ms := (Time.get_ticks_usec() - t0) / 1000.0
		get_viewport().get_texture().get_image().save_png(probe_dir.path_join("proba-%s-%d.png" % [step[0], step[1]]))
		print("ПРОВЕРКА образец: небо ", step[0], ", качество ", QUALITY[quality][0], ", кадр ", snappedf(ms, 0.1), " мс, окно ",
				get_window().size, ", доля разрешения ", get_viewport().scaling_3d_scale)
	terrain.visible = false
	sea.visible = false
	full_res = true
	_apply_scale()
	_update_help()
	for i in 3:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(probe_dir.path_join("proba-odno-nebo.png"))
	print("ИТОГ проба образца пройдена")


func _shots() -> void:
	DirAccess.make_dir_recursive_absolute(shots_dir)
	get_viewport().scaling_3d_scale = shot_scale
	# Небо под землю светит через карту отражений, она обновляется по частям — нужно несколько кадров.
	camera.look_at_from_position(at(600.0, 900.0, 5200.0), at(6300.0, 6000.0, 100.0), Vector3.UP)
	for i in 10:
		await get_tree().process_frame
	# Виды: имя, откуда, куда, угол зрения по вертикали. Первые три — как кадры Unreal владельца (там угол 90°
	# по горизонтали — это 59° по вертикали): небо с землёй, небо в сторону солнца, одно небо; остальные —
	# камера игры (35°).
	var eye := at(4300.0, 4000.0, 420.0)
	var sun_side := deg_to_rad(float(SKIES[sky_name]["sun_side"]))
	var toward_sun := eye + Vector3(sin(sun_side), 0.0, cos(sun_side)) * 5000.0 + Vector3(0.0, 980.0, 0.0)
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
		sky_material.set_shader_parameter("camera_place", camera.position)
		for i in 4:
			await get_tree().process_frame
		var t0 := Time.get_ticks_usec()
		await RenderingServer.frame_post_draw
		var ms := (Time.get_ticks_usec() - t0) / 1000.0
		var path := shots_dir.path_join("%s-%s.png" % [sky_name, view[0]])
		get_viewport().get_texture().get_image().save_png(path)
		print("КАДР ", view[0], " ", snappedf(ms, 0.1), " мс")
	print("ИТОГ кадры сняты")
