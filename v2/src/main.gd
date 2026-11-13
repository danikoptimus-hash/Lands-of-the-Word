extends Node3D
## Главный сценарий тестовой сборки: свет, мир, камера, служебные клавиши.
## Ключи запуска (после «--»): --shots=папка — автоматические кадры и проверки (с ним же --quick и --stops=17,21 —
## быстрые проверки, см. src/tools/shot_director.gd); --view=x,z,d,поворот,наклон — добавить кадр места;
## --world=N — начать с карты номер N (1 — «Осень»); --debug-view=N — показать географию вместо материалов
## (1 — влажность, 2 — сток воды, 3 — крутизна, 4 — ложбины и гребни; растительность, шаг 1.8: 21 — густота,
## 22 — местности, 23 — породы деревьев, 24 — где деревьям нельзя по уклону, 25 — поля);
## --flora-debug — проверочный вид растительности (как клавиша U), --flora-reference=x,z — эталоны масштаба в точке;
## --update-test=адрес и --update-target=файл — проверка самообновления в конвейере. Ключи --finish-update и --updated
## программа передаёт сама себе при обновлении (см. src/core/updater.gd).

## Карты тестовой сборки: «Осень» и карты, построенные генератором игры по другим зёрнам (tools/gen-world.mjs).
## На них видно, что форма земли складывается сама на любой карте. Клавиша M переключает карты по кругу.
const WORLD_PATHS: Array[String] = [
	"res://data/world_osen.json",
	"res://data/world_proba_1.json",
	"res://data/world_proba_2.json",
	"res://data/world_proba_3.json",
	"res://data/world_proba_4.json",
]
const WINDOW_TITLE := "Земли Слова — версия 2 (тест)"
## Насыщенность и контраст картинки (клавиша V). Начинаем с «естественно»: владелец сравнил наборы на 0.5.3
## и выбрал его («естественный цвет мне нравится больше»); до 0.5.3 первым стояло «сочно».
const COLOR_PRESETS: Array[Dictionary] = [
	{"title": "естественно", "saturation": 1.0, "contrast": 1.0, "brightness": 1.0},
	{"title": "сочно", "saturation": 1.28, "contrast": 1.06, "brightness": 1.0},
	{"title": "очень сочно", "saturation": 1.5, "contrast": 1.1, "brightness": 1.0},
]
## Разрешение картинки мира (клавиша B): мир считается в меньшем разрешении и достраивается до родного, надписи
## остаются в родном. На экранах с очень большим разрешением (у владельца 2880×1800 на 14 дюймах — замер 0.5.0:
## 22 кадра в секунду) полное разрешение стоит видеокарте вдвое дороже, чем нужно глазу, поэтому по умолчанию
## разрешение выбирается по числу точек окна: больше 3,2 млн — 67 %, больше 2,2 млн — 77 %, иначе полное.
const RENDER_SCALES: Array[float] = [1.0, 0.77, 0.67]
const AUTO_SCALE_PIXELS: Array[float] = [2.2e6, 3.2e6]
const SHOTS_FOLDER := "Земли Слова — тест"

var _world: WorldData
var _world_index := 0
var _islet_index := -1  ## на какой малый остров летали последним (клавиша O)
var _terrain: WorldTerrain
var _rig: StrategyCamera
var _hud: Hud
var _light: DayLight  ## свет и небо: времена суток
var _sun: DirectionalLight3D
var _environment: Environment
var _weather: Weather  ## погода: облака и их тени, дождь, шторм
var _light_code := ""  ## ключ --light=время — с какого времени суток начать
var _color_preset := 0
var _render_scale := 0
var _render_scale_chosen := false  ## игрок выбрал разрешение сам (клавиша B): само оно больше не меняется
var _markers: SiteMarkers
var _flora: Flora  ## растительность и камни (шаг 1.8)
var _flora_debug := false  ## проверочный вид растительности (клавиша U или ключ --flora-debug)
var _flora_debug_wanted := false
var _flora_debug_wait := 0.0
var _flora_reference := Vector2.INF  ## ключ --flora-reference=x,z: поставить эталоны масштаба в этой точке мира
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
var _debug_view := 0  ## ключ --debug-view=N: вместо материалов показать географию (см. WorldTerrain.set_debug_view)
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
	_weather = Weather.new()
	_weather.light = _light
	_weather.camera = _rig.camera
	_weather.frozen = not _shots_folder.is_empty()
	add_child(_weather)

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

	_benchmark = Benchmark.new()
	add_child(_benchmark)
	_benchmark.finished.connect(_on_benchmark_finished)

	var loaded: bool = await _load_world(WORLD_PATHS[_world_index])
	if not loaded:
		return
	_auto_render_scale()
	get_window().size_changed.connect(_auto_render_scale)

	if not _shots_folder.is_empty():
		var director := ShotDirector.new()
		add_child(director)
		director.render_scale = RENDER_SCALES[_render_scale]
		director.run(_shots_folder, _world, _terrain, _rig, _hud, _extra_views, _benchmark, _take_snapshot, _next_world)
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


## Разрешение картинки мира по размеру окна — пока игрок не выбрал его сам клавишей B.
func _auto_render_scale() -> void:
	if _render_scale_chosen or not _shots_folder.is_empty():
		_apply_render_scale()
		return
	var size := get_window().size
	var pixels := float(size.x) * float(size.y)
	var index := 0
	for limit in AUTO_SCALE_PIXELS:
		if pixels > limit:
			index += 1
	if index != _render_scale:
		_render_scale = index
		_apply_render_scale()


func _apply_render_scale() -> void:
	var scale := RENDER_SCALES[_render_scale]
	get_viewport().scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR if scale < 1.0 else Viewport.SCALING_3D_MODE_BILINEAR
	get_viewport().scaling_3d_scale = scale


func _process(_delta: float) -> void:
	if not _ready_to_play:
		return
	_terrain.set_viewer(_rig.camera.global_position)
	if _flora_debug and _flora != null:
		# Счётчики проверочного вида — раз в полсекунды, пока он включён.
		_flora_debug_wait -= _delta
		if _flora_debug_wait <= 0.0:
			_flora_debug_wait = 0.5
			_hud.toast(_flora.debug_text(), 1.5)
	_terrain.update_cache(_rig.camera.global_position, _rig.current_focus(), _world_pixel(), _delta)
	# Вода движется по своему времени; в кадрах проверок оно стоит — кадр с водой получается одним и тем же.
	if _shots_folder.is_empty():
		_terrain.advance_water(_delta)
	# Тени считаются только там, куда смотрит камера: вблизи они резче, издалека покрывают весь мир.
	# Чем ближе взгляд к горизонту, тем дальше видно — и тем дальше нужны тени.
	var low := 1.0 - smoothstep(0.1, 0.5, _rig.view_angle())
	var reach := maxf(_rig.current_distance() * lerpf(2.6, 7.0, low), lerpf(500.0, 4500.0, low))
	_sun.directional_shadow_max_distance = minf(reach, 40000.0)


## Сколько метров земли приходится на точку картинки мира в середине кадра (картинка мира считается
## в уменьшенном разрешении — клавиша B).
func _world_pixel() -> float:
	var viewport := get_viewport()
	return _rig.pixel_size(float(get_window().size.y) * viewport.scaling_3d_scale)


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
		KEY_0, KEY_BACKSPACE:
			_rig.fly_to(_rig.view_for_rect(_world.content_rect))
		KEY_K:
			_fly_to_quarry()
		KEY_O:
			_fly_to_next_islet()
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
		KEY_B:
			_render_scale = (_render_scale + 1) % RENDER_SCALES.size()
			_render_scale_chosen = true
			_apply_render_scale()
			_hud.toast("Картинка мира: %d %% разрешения. B — следующее." % roundi(RENDER_SCALES[_render_scale] * 100.0), 4.0)
		KEY_L:
			# Время суток: утро → день → вечер → ночь, с плавным переходом (в игре он идёт полчаса).
			var next := ((_light.phase() + 1) % 4) as DayLight.Phase
			_light.set_phase(next)
			_hud.toast("Время суток: %s. L — следующее." % DayLight.PHASE_TITLES[next], 4.0)
		KEY_P:
			# Погода: ясно ↔ шторм, плавно.
			var next := Weather.Kind.CLEAR if _weather.kind() == Weather.Kind.STORM else Weather.Kind.STORM
			_weather.set_kind(next)
			_hud.toast("Погода: %s. P — обратно." % Weather.TITLES[next], 4.0)
		KEY_Y:
			# Эталоны масштаба (шаг 1.8): человек, дом, дорога, валун и деревья опорного роста — там, куда смотрит камера.
			if _flora != null:
				var focus := _rig.current_focus()
				var shown := _flora.toggle_reference(Vector3(focus.x, _terrain.height_map.sample(focus), focus.y))
				_hud.toast("Эталоны масштаба: %s. Y — переключить." % ("человек 1,75 м, дом 6 м, дорога 4 м, валун 2 м, олива 6 м, пальма 12 м, кипарис 15 м" if shown else "убраны"), 6.0)
		KEY_U:
			# Проверочный вид растительности (шаг 1.8): уровни подробности цветом, границы плиток, счётчики.
			if _flora != null:
				_flora_debug = _flora.toggle_debug()
				_hud.toast(_flora.debug_text() if _flora_debug else "Проверочный вид растительности выключен.", 4.0)
		KEY_T:
			# Кэш ближнего вида можно выключить и сравнить: картинка должна быть той же, скорость — как в 0.5.3.
			_terrain.cache_budget = 0 if _terrain.cache_budget > 0 else NearCache.BUDGET
			_hud.toast("Кэш ближнего вида: %s. T — переключить." % ("включён" if _terrain.cache_budget > 0 else "выключен"), 4.0)
		KEY_V:
			_color_preset = (_color_preset + 1) % COLOR_PRESETS.size()
			_apply_color_preset()
			_hud.toast("Цвет: %s (%d из %d). V — следующий." % [COLOR_PRESETS[_color_preset]["title"], _color_preset + 1, COLOR_PRESETS.size()], 4.0)
		KEY_C:
			_markers.visible = not _markers.visible
		KEY_M:
			_next_world()
		KEY_F2:
			_take_snapshot()
		KEY_F5:
			_hud.close_report()
			_hud.set_help_open(false)
			_hud.toast("Идёт замер скорости: камера облетает мир…", 30.0)
			_benchmark.run(_world, _rig, _terrain.height_map, _terrain, _sun)


# ── Сцена ────────────────────────────────────────────────────────────────────

## Свет и небо — узел DayLight (шаг 1.4): утро, день, вечер, ночь и плавные переходы между ними. Дымка слабая (замечание владельца 11.11: «чтобы это не было мыльное
## туманное нечто»); её густота зависит ещё и от высоты камеры (см. _process).
func _build_light() -> void:
	_light = DayLight.new()
	add_child(_light)
	_sun = _light.sun
	_environment = _light.environment
	if not _light_code.is_empty():
		_set_light(_light_code)
	_apply_color_preset()


## Время суток по коду (ключ --light=evening). Сразу, без плавного перехода.
func _set_light(code: String) -> void:
	var phase := DayLight.PHASE_CODES.find(code)
	if phase >= 0:
		_light.set_phase(phase as DayLight.Phase, true)


## Насыщенность и контраст картинки: три набора, клавиша V переключает по кругу. Ложатся поверх вида времени суток.
func _apply_color_preset() -> void:
	var preset: Dictionary = COLOR_PRESETS[_color_preset]
	_light.set_grade(preset["saturation"], preset["contrast"], preset["brightness"])


# ── Мир ──────────────────────────────────────────────────────────────────────

## Сопрограмма: строит мир из снимка карты; прежний мир, если был, убирается. true — мир готов.
func _load_world(path: String) -> bool:
	_ready_to_play = false
	var world := WorldData.load_file(path)
	if world == null:
		_fail("Не удалось прочитать данные мира.")
		return false
	if _markers != null:
		_markers.queue_free()
		_markers = null
	if _flora != null:
		_flora.queue_free()
		_flora = null
		_flora_debug = false
	if _terrain != null:
		_weather.terrain = null
		_terrain.queue_free()
		_terrain = null
	_world = world
	_islet_index = -1
	_rig.set_world_bounds(_world.content_rect)
	_rig.set_view(_rig.view_for_rect(_world.land_rect))

	_hud.set_loading("Лепим землю…")
	_terrain = WorldTerrain.new()
	add_child(_terrain)
	# География запекается в картинку земли, поэтому проверочный вид задаётся до постройки.
	_terrain.set_debug_view(_debug_view)
	var built: bool = await _terrain.build(_world)
	if not built:
		_fail("Не удалось построить рельеф: %s.\nВидеокарта: %s" % [_terrain.error, RenderingServer.get_video_adapter_name()])
		return false
	_terrain.set_debug_view(_debug_view)
	_terrain.set_cloud_textures(_weather.cloud_map, Weather.CLOUD_NOISE)
	_weather.terrain = _terrain
	if not _shots_folder.is_empty():
		_terrain.set_water_time(WaterLook.SHOT_TIME)
	if not _shots_folder.is_empty():
		# В кадрах облёта земля считается напрямую (картинка та же, а прогревать кэш на программной отрисовке
		# у каждого кадра — минута); с ключом --cache кэш включён и считается сразу весь.
		_terrain.cache_budget = 40000000 if OS.get_cmdline_user_args().has("--cache") else 0
	_rig.set_height_map(_terrain.height_map)
	_rig.set_view(_rig.view_for_rect(_world.land_rect))

	_markers = SiteMarkers.new()
	add_child(_markers)
	_markers.build(_world, _terrain.height_map)

	_hud.set_loading("Сажаем леса…")
	_flora = Flora.new()
	add_child(_flora)
	_flora.set_cloud_textures(_weather.cloud_map, Weather.CLOUD_NOISE)
	await _flora.build(_world, _terrain)
	print("РАСТИТЕЛЬНОСТЬ «%s»: %s" % [_world.title, _flora.summary()])
	if _flora_debug_wanted:
		_flora_debug = _flora.toggle_debug()
	if _flora_reference.is_finite():
		_flora.toggle_reference(Vector3(_flora_reference.x, _terrain.height_map.sample(_flora_reference), _flora_reference.y))

	_hud.set_loading("")
	_ready_to_play = true
	print("МИР «%s»: рельеф — областей %d, точек %.1f млн, за %.0f мс (сток воды — %.0f мс, картинка земли — %.0f мс, маска наката — %.0f мс); высоты от %.1f до %.1f м, плиток %d, малых островов %d" % [
		_world.title, _terrain.region_count(), float(_terrain.baked_points()) / 1.0e6, _terrain.bake_ms, _terrain.drainage_ms, _terrain.surface_ms,
		_terrain.swash_mask_ms, _terrain.height_map.lowest, _terrain.height_map.highest, _terrain.chunk_count(), _world.islets.size()])
	return true


## Клавиша M: следующая карта по кругу. Возвращает построенный мир (для автоматических кадров) или пустой словарь.
func _next_world() -> Dictionary:
	_world_index = (_world_index + 1) % WORLD_PATHS.size()
	var loaded: bool = await _load_world(WORLD_PATHS[_world_index])
	if not loaded:
		return {}
	_hud.toast("«%s» — карта %d из %d. M — следующая." % [_world.title, _world_index + 1, WORLD_PATHS.size()], 6.0)
	return {"world": _world, "terrain": _terrain, "number": _world_index + 1, "count": WORLD_PATHS.size()}


# ── Действия ─────────────────────────────────────────────────────────────────

func _fly_to_island(island: String) -> void:
	if _world.island_rects.has(island):
		var area: Rect2 = _world.island_rects[island]
		_rig.fly_to(_rig.view_for_rect(area))


func _fly_to_islet(index: int) -> void:
	var islet := _world.islets[index]
	_islet_index = index
	_rig.fly_to(CameraView.make(islet.position, maxf(islet.reach() * 3.4, 420.0), 25.0, -8.0))
	_hud.toast("%s — малый остров %d из %d. O — следующий." % [islet.title(), index + 1, _world.islets.size()], 5.0)


func _fly_to_quarry() -> void:
	for i in _world.islets.size():
		if _world.islets[i].quarry:
			_fly_to_islet(i)
			return
	_hud.toast("На этой карте нет острова Каменоломни.", 4.0)


func _fly_to_next_islet() -> void:
	if _world.islets.is_empty():
		_hud.toast("На этой карте нет малых островов.", 4.0)
		return
	_fly_to_islet((_islet_index + 1) % _world.islets.size())


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
	# Подсказка — первой строкой: раньше она стояла под отчётом и уходила за край экрана вместе с его низом.
	_hud.show_report("Замер готов. Отчёт скопирован: вставьте его в чат (Ctrl+V). Esc — закрыть.\n\n" + _benchmark.report_head,
			_benchmark.report_legs)


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

	# Настоящий канал «тест»: читается ли описание сборки так, как его будет читать программа у тестировщика.
	# Это справка, а не проверка: сеть в конвейере может подвести, и сборку из-за этого не бракуем.
	var channel := Updater.new()
	add_child(channel)
	var readable: bool = await channel.check(true)
	print("КАНАЛ «ТЕСТ»: %s" % ("версия %s, сборка %s, по точному номеру выкладки: %s" % [
		channel.available_version, channel.available_commit, "да" if channel.is_exact() else "нет"] if readable else "не читается — %s" % channel.error))
	print("ИТОГ САМООБНОВЛЕНИЯ: не прошло %d" % failed)
	get_tree().quit(1 if failed > 0 else 0)


func _report_check(title: String, passed: bool, details: String) -> int:
	print("ПРОВЕРКА %s: %s (%s)" % ["пройдена" if passed else "НЕ ПРОЙДЕНА", title, details])
	return 0 if passed else 1


func _read_arguments() -> void:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--shots="):
			_shots_folder = argument.trim_prefix("--shots=")
		elif argument.begins_with("--world="):
			_world_index = clampi(argument.trim_prefix("--world=").to_int() - 1, 0, WORLD_PATHS.size() - 1)
		elif argument.begins_with("--debug-view="):
			_debug_view = argument.trim_prefix("--debug-view=").to_int()
		elif argument == "--flora-debug":
			_flora_debug_wanted = true
		elif argument.begins_with("--flora-reference="):
			var at := argument.trim_prefix("--flora-reference=").split(",")
			if at.size() == 2:
				_flora_reference = Vector2(at[0].to_float(), at[1].to_float())
		elif argument.begins_with("--render-scale="):
			# Разрешение картинки мира, проценты (100, 77 или 67), — чтобы кадры проверок были как у игрока: у владельца
			# 67 % с достройкой до полного, и рисунок воды на точках экрана там другой.
			var wanted := argument.trim_prefix("--render-scale=").to_float() / 100.0
			for index in RENDER_SCALES.size():
				if absf(RENDER_SCALES[index] - wanted) < absf(RENDER_SCALES[_render_scale] - wanted):
					_render_scale = index
			_render_scale_chosen = true
		elif argument.begins_with("--light="):
			_light_code = argument.trim_prefix("--light=")
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
