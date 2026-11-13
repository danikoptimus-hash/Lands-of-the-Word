extends Node3D
## Сцена для сравнения движков: берег Корфу в Godot.
## Земля — готовое дополнение Terrain3D; место, покров и расстановка — общая основа (sravnenie/osnova).
## Ключи запуска: --kadry=ПАПКА — снять контрольные виды в папку и выйти.

const DATA := "res://dannye/"

var info: Dictionary
var side := 11000.0
var size := 2048
var terrain: Terrain3D
var camera: Camera3D
var sun: DirectionalLight3D
var shots_dir := ""


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--kadry="):
			shots_dir = a.trim_prefix("--kadry=")
	info = JSON.parse_string(FileAccess.get_file_as_string(DATA + "opisanie.json"))
	side = float(info["storona_m"])
	size = int(info["razmer"])
	_build_sky()
	_build_camera()
	await _build_terrain()
	if shots_dir != "":
		await _shots()
		get_tree().quit()


## Точка основы (u — восток, v — север, h — высота) в координатах сцены: север — это −Z.
func at(u: float, v: float, h: float) -> Vector3:
	return Vector3(u - side * 0.5, h, side * 0.5 - v)


func _build_sky() -> void:
	var sky_material := ProceduralSkyMaterial.new()
	var sky := Sky.new()
	sky.sky_material = sky_material
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	var world := WorldEnvironment.new()
	world.environment = env
	add_child(world)
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 3000.0
	sun.light_energy = 1.3
	add_child(sun)
	sun.look_at_from_position(Vector3.ZERO, Vector3(0.45, -0.75, -0.35).normalized(), Vector3.UP)


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

	terrain = Terrain3D.new()
	terrain.name = "Terrain3D"
	add_child(terrain, true)
	terrain.set_camera(camera)
	terrain.vertex_spacing = side / float(size)
	terrain.region_size = Terrain3D.SIZE_1024
	terrain.mesh_lods = 8
	terrain.material.world_background = Terrain3DMaterial.NONE
	terrain.material.auto_shader_enabled = true
	terrain.material.set_shader_param("auto_slope", 4.0)
	terrain.assets.set_texture_asset(0, await _flat_texture("Земля", Color(0.33, 0.36, 0.22), Color(0.42, 0.40, 0.27)))
	terrain.assets.set_texture_asset(1, await _flat_texture("Скала", Color(0.62, 0.60, 0.54), Color(0.74, 0.72, 0.66)))
	terrain.data.import_images([heights, null, null], Vector3(-side * 0.5, 0.0, -side * 0.5), 0.0, 1.0)
	var range_now: Vector2 = terrain.data.get_height_range()
	print("МИР земля загружена за ", Time.get_ticks_msec() - t0, " мс; высоты ", range_now)


## Временная текстура ровного цвета с шумом — пока не подключены настоящие материалы.
func _flat_texture(title: String, a: Color, b: Color) -> Terrain3DTextureAsset:
	var noise := FastNoiseLite.new()
	noise.frequency = 0.02
	var gradient := Gradient.new()
	gradient.set_color(0, a)
	gradient.set_color(1, b)
	var tex := NoiseTexture2D.new()
	tex.width = 512
	tex.height = 512
	tex.seamless = true
	tex.noise = noise
	tex.color_ramp = gradient
	tex.generate_mipmaps = true
	await tex.changed
	var albedo := tex.get_image()
	albedo.convert(Image.FORMAT_RGBA8)
	for y in albedo.get_height():
		for x in albedo.get_width():
			var c := albedo.get_pixel(x, y)
			c.a = c.v
			albedo.set_pixel(x, y, c)
	albedo.generate_mipmaps()
	var normal := Image.create_empty(512, 512, false, Image.FORMAT_RGBA8)
	normal.fill(Color(0.5, 0.5, 1.0, 0.85))
	normal.generate_mipmaps()
	var asset := Terrain3DTextureAsset.new()
	asset.name = title
	asset.albedo_texture = ImageTexture.create_from_image(albedo)
	asset.normal_texture = ImageTexture.create_from_image(normal)
	asset.uv_scale = 0.05
	return asset


func _shots() -> void:
	DirAccess.make_dir_recursive_absolute(shots_dir)
	for i in 30:
		await get_tree().process_frame
	var views := [
		["obshchiy", at(600.0, 900.0, 5200.0), at(6300.0, 6000.0, 100.0)],
		["buhta", at(4350.0, 4150.0, 950.0), at(5414.0, 5333.0, 20.0)],
		["krony", at(5300.0, 5050.0, 330.0), at(5900.0, 5800.0, 120.0)],
	]
	for view in views:
		camera.look_at_from_position(view[1], view[2], Vector3.UP)
		for i in 12:
			await get_tree().process_frame
		var t0 := Time.get_ticks_usec()
		await RenderingServer.frame_post_draw
		var ms := (Time.get_ticks_usec() - t0) / 1000.0
		var path := shots_dir.path_join(view[0] + ".png")
		get_viewport().get_texture().get_image().save_png(path)
		print("КАДР ", view[0], " ", snappedf(ms, 0.1), " мс")
	print("ИТОГ кадры сняты")
