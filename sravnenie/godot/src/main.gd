extends Node3D
## Сцена для сравнения движков: берег Корфу в Godot.
## Земля — готовое дополнение Terrain3D; место, покров и расстановка — общая основа (sravnenie/osnova).
## Ключи запуска: --kadry=ПАПКА — снять контрольные виды в папку и выйти;
## --nebo=den|zakat|shtorm — состояние неба; --sunshine — включить дополнение SunshineClouds2 (на встроенной
## графике Intel и на программной отрисовке оно не работает; оставлено для справки).

const DATA := "res://dannye/"

var info: Dictionary
var side := 11000.0
var size := 2048
var terrain: Terrain3D
var camera: Camera3D
var sun: DirectionalLight3D
var shots_dir := ""
var with_clouds := false
var sky_name := "den"
var sky_material: ShaderMaterial
var world: WorldEnvironment
var clouds: SunshineCloudsGD
var sea_material: ShaderMaterial
var heights_image: Image
var water_time := WaterLook.SHOT_TIME
var swash_time := WaterLook.SHOT_TIME


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--kadry="):
			shots_dir = a.trim_prefix("--kadry=")
		if a == "--sunshine":
			with_clouds = true
		if a.begins_with("--nebo="):
			sky_name = a.trim_prefix("--nebo=")
	info = JSON.parse_string(FileAccess.get_file_as_string(DATA + "opisanie.json"))
	side = float(info["storona_m"])
	size = int(info["razmer"])
	_build_sky()
	_build_camera()
	if with_clouds:
		_build_clouds()
	await _build_terrain()
	if shots_dir != "":
		await _shots()
		get_tree().quit()


## Точка основы (u — восток, v — север, h — высота) в координатах сцены: север — это −Z.
func at(u: float, v: float, h: float) -> Vector3:
	return Vector3(u - side * 0.5, h, side * 0.5 - v)


## Состояния неба: высота и сторона солнца (градусы), сила света, облачность и плотность облаков.
const SKIES := {
	"den": {"sun_height": 52.0, "sun_side": 215.0, "energy": 1.0, "coverage": 0.25, "density": 0.05, "exposure": 0.1},
	"zakat": {"sun_height": 7.0, "sun_side": 262.0, "energy": 1.0, "coverage": 0.3, "density": 0.05, "exposure": 0.1},
	"shtorm": {"sun_height": 40.0, "sun_side": 215.0, "energy": 0.45, "coverage": 0.95, "density": 0.12, "exposure": 0.1},
}


func _build_sky() -> void:
	sky_material = ShaderMaterial.new()
	sky_material.shader = load("res://src/nebo.gdshader")
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
	world = WorldEnvironment.new()
	world.environment = env
	add_child(world)
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 3000.0
	add_child(sun)
	set_sky(sky_name)


## Включить состояние неба: «den», «zakat» или «shtorm».
func set_sky(title: String) -> void:
	sky_name = title
	var look: Dictionary = SKIES[title]
	var height := deg_to_rad(float(look["sun_height"]))
	var compass := deg_to_rad(float(look["sun_side"]))
	# Сторона солнца — по компасу: 0 — север (−Z), 90 — восток (+X).
	var to_sun := Vector3(sin(compass) * cos(height), sin(height), -cos(compass) * cos(height))
	sun.look_at_from_position(Vector3.ZERO, -to_sun, Vector3.UP)
	sun.light_energy = float(look["energy"])
	sky_material.set_shader_parameter("cloud_coverage", float(look["coverage"]))
	sky_material.set_shader_parameter("_density", float(look["density"]))
	sky_material.set_shader_parameter("exposure", float(look["exposure"]))


## Облака: готовое дополнение SunshineClouds2 (объёмные, считаются лучом; MIT). Настройки — его образец,
## высота слоя — под кучевые облака ясного дня над морем.
func _build_clouds() -> void:
	clouds = (load("res://addons/SunshineClouds2/ExampleCloudsResource.tres") as SunshineCloudsGD).duplicate(true)
	clouds.cloud_floor = 1500.0
	clouds.cloud_ceiling = 4200.0
	clouds.clouds_coverage = 0.5
	var compositor := Compositor.new()
	var effects: Array[CompositorEffect] = [clouds]
	compositor.compositor_effects = effects
	world.compositor = compositor
	var driver := SunshineCloudsDriverGD.new()
	driver.name = "Oblaka"
	driver.clouds_resource = clouds
	var lights: Array[DirectionalLight3D] = [sun]
	driver.tracked_directional_lights = lights
	# Без этого дополнение не передаёт облакам свет и ветер: всё под облаками выходит чёрным.
	driver.update_continuously = true
	add_child(driver)


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
func _build_sea() -> void:
	sea_material = ShaderMaterial.new()
	sea_material.shader = load("res://src/voda.gdshader")
	var look: Dictionary = WaterLook.at(0.0).duplicate()
	look["swash"] = WaterLook.SWASH.x
	WaterLook.apply(sea_material, look)
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
	var sea := MeshInstance3D.new()
	sea.mesh = plane
	sea.material_override = sea_material
	sea.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sea.position = Vector3(0.0, float(info["more_m"]) + WaterLook.SWASH.x, 0.0)
	add_child(sea)
	sea.set_instance_shader_parameter("water_level", float(info["more_m"]))


func _process(delta: float) -> void:
	if shots_dir == "" and sea_material != null:
		water_time += delta * WaterLook.SPEED.x
		swash_time += delta
		sea_material.set_shader_parameter("water_time", water_time)
		sea_material.set_shader_parameter("swash_time", swash_time)


func _shots() -> void:
	DirAccess.make_dir_recursive_absolute(shots_dir)
	for i in 30:
		await get_tree().process_frame
	# Виды: имя, откуда, куда, угол зрения. Первые два — как кадры Unreal владельца (угол 90°): небо с землёй
	# и одно небо; остальные — камера игры (35°).
	var views := [
		["nebo-zemlya", at(4300.0, 4000.0, 420.0), at(6800.0, 6900.0, 900.0), 90.0],
		["nebo", at(4300.0, 4000.0, 420.0), at(6000.0, 6000.0, 3600.0), 90.0],
		["obshchiy", at(600.0, 900.0, 5200.0), at(6300.0, 6000.0, 100.0), 35.0],
		["gorizont", at(2600.0, 2200.0, 1500.0), at(7800.0, 7600.0, 300.0), 35.0],
		["buhta", at(4350.0, 4150.0, 950.0), at(5414.0, 5333.0, 20.0), 35.0],
	]
	for view in views:
		camera.fov = view[3]
		camera.look_at_from_position(view[1], view[2], Vector3.UP)
		for i in 12:
			await get_tree().process_frame
		var t0 := Time.get_ticks_usec()
		await RenderingServer.frame_post_draw
		var ms := (Time.get_ticks_usec() - t0) / 1000.0
		var path := shots_dir.path_join("%s-%s.png" % [sky_name, view[0]])
		get_viewport().get_texture().get_image().save_png(path)
		print("КАДР ", view[0], " ", snappedf(ms, 0.1), " мс")
	print("ИТОГ кадры сняты")
