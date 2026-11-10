extends Node3D
## Главный сценарий тестовой сборки: свет, мир, камера, служебные клавиши.
## Ключи запуска (после «--»): --shots=папка — автоматические кадры и проверки; --view=x,z,d,поворот,наклон — добавить кадр места.

const WORLD_PATH := "res://data/world_osen.json"
const WINDOW_TITLE := "Земли Слова — версия 2 (тест)"
const SHOTS_FOLDER := "Земли Слова — тест"

var _world: WorldData
var _terrain: WorldTerrain
var _rig: StrategyCamera
var _hud: Hud
var _sun: DirectionalLight3D
var _markers: SiteMarkers
var _benchmark: Benchmark
var _shots_folder := ""
var _extra_views := PackedStringArray()
var _ready_to_play := false


func _ready() -> void:
	_read_arguments()
	DisplayServer.window_set_title(WINDOW_TITLE)
	if _shots_folder.is_empty():
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_MAXIMIZED)

	_build_light()
	_hud = Hud.new()
	add_child(_hud)
	_rig = StrategyCamera.new()
	add_child(_rig)

	_world = WorldData.load_file(WORLD_PATH)
	if _world == null:
		_fail("Не удалось прочитать данные мира.")
		return
	_rig.set_world_bounds(_world.land_rect)
	_rig.set_view(_rig.view_for_rect(_world.land_rect))

	_hud.set_loading("Лепим землю…")
	_terrain = WorldTerrain.new()
	add_child(_terrain)
	var built: bool = await _terrain.build(_world)
	if not built:
		_fail("Не удалось построить рельеф: %s.\nВидеокарта: %s" % [_terrain.error, RenderingServer.get_video_adapter_name()])
		return
	_rig.set_height_map(_terrain.height_map)
	_rig.set_view(_rig.view_for_rect(_world.land_rect))

	_markers = SiteMarkers.new()
	add_child(_markers)
	_markers.build(_world, _terrain.height_map)

	_benchmark = Benchmark.new()
	add_child(_benchmark)
	_benchmark.finished.connect(_on_benchmark_finished)

	_hud.set_loading("")
	_ready_to_play = true
	print("МИР «%s»: рельеф %d×%d за %.0f мс, высоты от %.1f до %.1f м, плиток %d" % [
		_world.title, _terrain.height_map.width, _terrain.height_map.height, _terrain.bake_ms,
		_terrain.height_map.lowest, _terrain.height_map.highest, _terrain.chunk_count()])

	if not _shots_folder.is_empty():
		var director := ShotDirector.new()
		add_child(director)
		director.run(_shots_folder, _world, _terrain, _rig, _hud, _extra_views)
	else:
		_hud.toast("F1 — управление камерой", 6.0)


func _process(_delta: float) -> void:
	if not _ready_to_play:
		return
	_terrain.set_viewer(_rig.camera.global_position)
	# Тени считаются только там, куда смотрит камера: вблизи они резче, издалека покрывают весь мир.
	_sun.directional_shadow_max_distance = clampf(_rig.current_distance() * 2.6, 500.0, 9000.0)


func _unhandled_key_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key == null or not key.pressed or key.echo:
		return
	match key.physical_keycode:
		KEY_F11:
			_toggle_fullscreen()
		KEY_ENTER, KEY_KP_ENTER:
			if key.alt_pressed:
				_toggle_fullscreen()
		KEY_ESCAPE:
			_on_escape()
		KEY_F1:
			_hud.toggle_help()
		KEY_Q:
			if key.ctrl_pressed:
				get_tree().quit()
	if not _ready_to_play or _benchmark.running:
		return
	match key.physical_keycode:
		KEY_SPACE, KEY_HOME:
			_rig.fly_to(_rig.view_for_rect(_world.land_rect))
		KEY_1:
			_fly_to_island("OT")
		KEY_2:
			_fly_to_island("NT")
		KEY_N:
			var view := _rig.get_view()
			view.yaw = 0.0
			view.tilt = 0.0
			_rig.fly_to(view, 0.6)
		KEY_G:
			_terrain.set_grid_visible(not _terrain.is_grid_visible())
		KEY_C:
			_markers.visible = not _markers.visible
		KEY_F2:
			_take_snapshot()
		KEY_F5:
			_hud.close_report()
			_hud.set_help_open(false)
			_hud.toast("Идёт замер скорости: камера облетает мир…", 30.0)
			_benchmark.run(_world, _rig)


# ── Сцена ────────────────────────────────────────────────────────────────────

## Свет «мастерской» для глиняного этапа: одно солнце слева (с запада, чуть с юга) и ровное небо.
## Склоны, обращённые к камере и влево, освещены, тени ложатся вправо. Настоящий свет — шаг 1.4.
func _build_light() -> void:
	_sun = DirectionalLight3D.new()
	_sun.transform = Transform3D(Basis.looking_at(Vector3(0.78, -0.58, -0.22), Vector3.UP), Vector3.ZERO)
	_sun.light_color = Color(1.0, 0.97, 0.92)
	_sun.light_energy = 1.25
	_sun.shadow_enabled = true
	_sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	_sun.directional_shadow_blend_splits = true
	_sun.directional_shadow_max_distance = 6000.0
	_sun.shadow_blur = 1.2
	add_child(_sun)

	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color(0.5, 0.58, 0.66)
	sky_material.sky_horizon_color = Color(0.8, 0.81, 0.8)
	sky_material.ground_horizon_color = Color(0.8, 0.81, 0.8)
	sky_material.ground_bottom_color = Color(0.44, 0.47, 0.5)
	var sky := Sky.new()
	sky.sky_material = sky_material

	var environment := Environment.new()
	environment.background_mode = Environment.BG_SKY
	environment.sky = sky
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	environment.ambient_light_energy = 0.75
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.tonemap_white = 1.4
	environment.ssao_enabled = true
	environment.ssao_radius = 9.0
	environment.ssao_intensity = 1.6
	environment.fog_enabled = true
	environment.fog_light_color = Color(0.8, 0.81, 0.8)
	environment.fog_density = 0.00006
	environment.fog_aerial_perspective = 0.4
	environment.fog_sky_affect = 0.0
	var world_environment := WorldEnvironment.new()
	world_environment.environment = environment
	add_child(world_environment)


# ── Действия ─────────────────────────────────────────────────────────────────

func _fly_to_island(island: String) -> void:
	if _world.island_rects.has(island):
		var area: Rect2 = _world.island_rects[island]
		_rig.fly_to(_rig.view_for_rect(area))


func _toggle_fullscreen() -> void:
	var mode := DisplayServer.window_get_mode()
	if mode == DisplayServer.WINDOW_MODE_FULLSCREEN or mode == DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_MAXIMIZED)
	else:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)


func _on_escape() -> void:
	if _hud.is_report_open():
		_hud.close_report()
	elif _hud.is_help_open():
		_hud.set_help_open(false)
	else:
		var mode := DisplayServer.window_get_mode()
		if mode == DisplayServer.WINDOW_MODE_FULLSCREEN or mode == DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN:
			DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_MAXIMIZED)


## Снимок экрана в папку «Изображения» и код места в буфер обмена: по коду разработчик увидит тот же кадр.
func _take_snapshot() -> void:
	await RenderingServer.frame_post_draw
	var image := get_viewport().get_texture().get_image()
	var folder := OS.get_system_dir(OS.SYSTEM_DIR_PICTURES).path_join(SHOTS_FOLDER)
	DirAccess.make_dir_recursive_absolute(folder)
	var stamp := Time.get_datetime_string_from_system().replace(":", "-").replace("T", "_")
	var path := folder.path_join("kadr_%s.png" % stamp)
	var code := _rig.get_view().to_code()
	if image.save_png(path) == OK:
		DisplayServer.clipboard_set("Земли Слова, %s, место %s" % [BuildInfo.label(), code])
		_hud.toast("Снимок сохранён: %s\nКод места скопирован: его можно вставить в чат (Ctrl+V)." % path, 7.0)
	else:
		_hud.toast("Не удалось сохранить снимок в %s" % path, 6.0)


func _on_benchmark_finished(report: String) -> void:
	DisplayServer.clipboard_set(report)
	var path := "user://zamer.txt"
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file != null:
		file.store_string(report)
		file.close()
	_hud.toast("Замер готов", 2.0)
	_hud.show_report(report + "\n\nОтчёт скопирован: вставьте его в чат (Ctrl+V).\nEsc — закрыть.")


func _read_arguments() -> void:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--shots="):
			_shots_folder = argument.trim_prefix("--shots=")
		elif argument.begins_with("--view="):
			_extra_views.append(argument.trim_prefix("--view="))


func _fail(message: String) -> void:
	push_error(message)
	_hud.set_loading(message)
	if not _shots_folder.is_empty():
		print("СБОЙ: %s" % message)
		get_tree().quit(1)
