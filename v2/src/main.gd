extends Node3D
## Главный сценарий тестовой сборки: свет, мир, камера, служебные клавиши.
## Ключи запуска (после «--»): --shots=папка — автоматические кадры и проверки; --view=x,z,d,поворот,наклон — добавить кадр места;
## --update-test=адрес и --update-target=файл — проверка самообновления в конвейере. Ключи --finish-update и --updated
## программа передаёт сама себе при обновлении (см. src/core/updater.gd).

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
var _updater: Updater
var _updating := false
var _update_notice := ""  ## что сказать об обновлении, когда мир построится
var _finish_target := ""  ## второй запуск при обновлении: файл программы, на место которого встаём
var _was_updated := false  ## третий запуск: программа только что обновилась
var _update_test_url := ""
var _update_test_target := ""
var _shots_folder := ""
var _extra_views := PackedStringArray()
var _ready_to_play := false


func _ready() -> void:
	_read_arguments()
	DisplayServer.window_set_title(WINDOW_TITLE)
	if not _update_test_url.is_empty():
		await _run_update_test()
		return
	if _shots_folder.is_empty():
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_MAXIMIZED)

	_build_light()
	_hud = Hud.new()
	add_child(_hud)
	_rig = StrategyCamera.new()
	add_child(_rig)

	_updater = Updater.new()
	add_child(_updater)
	_updater.progress.connect(_hud.set_loading)
	if not _finish_target.is_empty():
		var moved: bool = await _finish_update()
		if moved:
			return
	elif _shots_folder.is_empty() and Updater.is_supported():
		var replaced: bool = await _update_if_needed()
		if replaced:
			return

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
		director.run(_shots_folder, _world, _terrain, _rig, _hud, _extra_views, _benchmark, _take_snapshot)
	elif not _update_notice.is_empty():
		_hud.toast(_update_notice, 14.0)
	elif not BuildInfo.COMMIT.is_empty() and Updater.seen_build() != BuildInfo.COMMIT:
		# Первый запуск этой сборки: показываем записку «что нового».
		Updater.mark_seen(BuildInfo.COMMIT)
		var notes := BuildInfo.notes()
		if not notes.is_empty():
			_hud.show_report(notes)
	else:
		_hud.toast("F1 — управление камерой", 6.0)


func _process(_delta: float) -> void:
	if not _ready_to_play:
		return
	_terrain.set_viewer(_rig.camera.global_position)
	# Тени считаются только там, куда смотрит камера: вблизи они резче, издалека покрывают весь мир.
	# Чем ближе взгляд к горизонту, тем дальше видно — и тем дальше нужны тени.
	var low := 1.0 - smoothstep(0.1, 0.5, _rig.view_angle())
	var reach := maxf(_rig.current_distance() * lerpf(2.6, 7.0, low), lerpf(500.0, 4500.0, low))
	_sun.directional_shadow_max_distance = minf(reach, 12000.0)


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
		KEY_F9:
			_retry_update()
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
	_sun.light_energy = 0.85
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
	environment.ambient_light_energy = 0.42
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment.tonemap_white = 1.2
	environment.ssao_enabled = true
	environment.ssao_radius = 9.0
	environment.ssao_intensity = 2.0
	environment.fog_enabled = true
	environment.fog_light_color = Color(0.8, 0.81, 0.8)
	environment.fog_density = 0.000025
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
	if _updating:
		_updater.cancel()
	elif _hud.is_report_open():
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
	var pictures := OS.get_system_dir(OS.SYSTEM_DIR_PICTURES)
	if pictures.is_empty():
		pictures = OS.get_user_data_dir()
	var folder := pictures.path_join(SHOTS_FOLDER)
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


# ── Самообновление ───────────────────────────────────────────────────────────

## Первый запуск: если в канале «тест» лежит другая сборка, скачиваем её и передаём ей управление.
## true — программа закрывается, дальше работает новая сборка.
func _update_if_needed() -> bool:
	_updater.cleanup()
	if _was_updated:
		# Временный файл может быть ещё занят закрывающейся программой: уберём его чуть позже.
		get_tree().create_timer(5.0).timeout.connect(_updater.cleanup)
	_hud.set_loading("Проверяю, нет ли новой сборки…")
	var newer: bool = await _updater.check()
	if not newer:
		return false  # сборка свежая или нет связи — просто запускаемся
	if _was_updated or Updater.last_attempt() == _updater.available_commit:
		_update_notice = "Есть новая сборка %s, но обновиться самой программе в прошлый раз не удалось.\nF9 — попробовать ещё раз." % _updater.available_version
		return false
	return await _apply_update()


func _apply_update() -> bool:
	_updating = true
	Updater.remember_attempt(_updater.available_commit)
	_hud.set_loading("Скачиваю новую сборку %s…" % _updater.available_version)
	var staged: bool = await _updater.download_and_stage()
	_updating = false
	if staged and _updater.launch_staged():
		_hud.set_loading("Запускаю новую сборку %s…" % _updater.available_version)
		get_tree().quit()
		return true
	if _updater.error == "обновление пропущено":
		Updater.remember_attempt("")
		_update_notice = "Обновление пропущено: запущена прежняя сборка. Новая скачается при следующем запуске."
	elif _updater.retry_later:
		Updater.remember_attempt("")
		_update_notice = "Свежая сборка ещё выкладывается. Запущена прежняя; новая скачается при следующем запуске (или F9 через пару минут)."
	else:
		_update_notice = "Обновиться не удалось: %s.\nЗапущена прежняя сборка. F9 — попробовать ещё раз." % _updater.error
	return false


## Второй запуск: новая программа встаёт на место прежней и запускается оттуда.
func _finish_update() -> bool:
	_hud.set_loading("Завершаю обновление…")
	_updater.target_path = _finish_target
	var done: bool = await _updater.finish_update()
	if done and _updater.relaunch_target():
		get_tree().quit()
		return true
	_update_notice = "Обновление не завершилось: %s.\nСейчас запущена новая сборка из временного файла." % _updater.error
	return false


## Клавиша F9: проверить и обновиться вручную.
func _retry_update() -> void:
	if _updating or not Updater.is_supported() or not _ready_to_play or _benchmark.running:
		return
	_hud.toast("Проверяю, нет ли новой сборки…", 3.0)
	var newer: bool = await _updater.check()
	if not newer:
		_hud.toast("Новой сборки нет." if _updater.error.is_empty() else "Проверить не удалось: %s." % _updater.error, 5.0)
		return
	var replaced: bool = await _apply_update()
	if not replaced:
		_hud.set_loading("")
		_hud.toast(_update_notice, 10.0)


## Проверка самообновления в конвейере: скачать сборку с местного адреса, проверить, распаковать и заменить файл-пустышку.
func _run_update_test() -> void:
	var failed := 0
	var updater := Updater.new()
	updater.base_url = _update_test_url
	updater.target_path = _update_test_target
	updater.own_path = _update_test_target
	add_child(updater)
	DirAccess.make_dir_recursive_absolute(_update_test_target.get_base_dir())
	var dummy := FileAccess.open(_update_test_target, FileAccess.WRITE)
	dummy.store_string("прежняя сборка")
	dummy.close()

	var newer: bool = await updater.check(true)
	failed += _report_check("описание сборки читается", newer, "версия %s, сборка %s %s" % [updater.available_version, updater.available_commit, updater.error])
	var staged := false
	if newer:
		staged = await updater.download_and_stage()
	failed += _report_check("новая сборка скачана, проверена и распакована", staged, updater.error if not staged else updater.staged_path().get_file())
	var replaced := false
	if staged:
		var staged_hash := FileAccess.get_sha256(updater.staged_path())
		updater.own_path = updater.staged_path()
		replaced = await updater.finish_update()
		replaced = replaced and FileAccess.get_sha256(_update_test_target) == staged_hash
		updater.own_path = _update_test_target
	failed += _report_check("новая программа встала на место прежней", replaced, updater.error if not replaced else "контрольные суммы совпали")
	var clean := updater.cleanup() and not FileAccess.file_exists(updater.staged_path())
	failed += _report_check("временный файл убран", clean, updater.staged_path().get_file())
	print("ИТОГ САМООБНОВЛЕНИЯ: не прошло %d" % failed)
	get_tree().quit(1 if failed > 0 else 0)


func _report_check(title: String, passed: bool, details: String) -> int:
	print("ПРОВЕРКА %s: %s (%s)" % ["пройдена" if passed else "НЕ ПРОЙДЕНА", title, details])
	return 0 if passed else 1


func _read_arguments() -> void:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--shots="):
			_shots_folder = argument.trim_prefix("--shots=")
		elif argument.begins_with("--view="):
			_extra_views.append(argument.trim_prefix("--view="))
		elif argument.begins_with("--finish-update="):
			_finish_target = argument.trim_prefix("--finish-update=")
		elif argument == "--updated":
			_was_updated = true
		elif argument.begins_with("--update-test="):
			_update_test_url = argument.trim_prefix("--update-test=")
		elif argument.begins_with("--update-target="):
			_update_test_target = argument.trim_prefix("--update-target=")


func _fail(message: String) -> void:
	push_error(message)
	_hud.set_loading(message)
	if not _shots_folder.is_empty():
		print("СБОЙ: %s" % message)
		get_tree().quit(1)
