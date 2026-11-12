class_name ShotDirector
extends Node
## Автоматическая съёмка и проверки для конвейера сборки (запуск с ключом --shots=папка).
## Снимает кадры облёта, сохраняет картинку высот и проверяет камеру числами:
## место под курсором не уезжает при приближении, земля идёт за рукой при перетаскивании, границы держат.
## Быстрые проверки (для разработчика, v2/tools/godot-local.sh): --quick — только первая карта, без замера скорости
## и других карт; --stops=17,21 — только кадры облёта с этими номерами, без проверок; --checks — только проверки
## первой карты, без кадров (минута вместо получаса). У каждого кадра в журнале — время его отрисовки: в рабочей
## среде картинку считает процессор, и это время — мерило тяжести шейдеров (сравнивать до и после правки).

var _world: WorldData
var _terrain: WorldTerrain
var _rig: StrategyCamera
var _hud: Hud
var _folder := ""
var _checks: Array[Dictionary] = []
var _failed := 0
var _clock := 0.0
var _frame_msec := 0  ## сколько считался последний кадр в полном разрешении


func _process(delta: float) -> void:
	_clock += minf(delta, 0.1)


## Сопрограмма: по окончании закрывает программу; код выхода 1, если какая-то проверка не прошла.
func run(folder: String, world: WorldData, terrain: WorldTerrain, rig: StrategyCamera, hud: Hud, extra_views: PackedStringArray,
		benchmark: Benchmark, snapshot: Callable, next_world: Callable) -> void:
	_folder = folder
	_world = world
	_terrain = terrain
	_rig = rig
	_hud = hud
	DirAccess.make_dir_recursive_absolute(folder)
	var quick := false
	var checks_only := false
	var only := PackedStringArray()
	var profile_views := PackedStringArray()
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--profile="):
			profile_views = argument.trim_prefix("--profile=").split(";", false)
		elif argument == "--quick":
			quick = true
		elif argument == "--checks":
			quick = true
			checks_only = true
		elif argument.begins_with("--stops="):
			only = argument.trim_prefix("--stops=").split(",", false)
	await _frames(4)

	if not profile_views.is_empty():
		await _profile(profile_views)
		get_tree().quit(0)
		return

	var preview := terrain.height_map.to_preview()
	preview.save_png(folder.path_join("vysoty.png"))

	var stops := Tour.stops(world, rig, terrain.height_map)
	for stop in stops:
		if checks_only or (not only.is_empty() and not _listed(stop.name, only)):
			continue
		rig.set_view(stop.view)
		await _before_shot()
		await _capture(stop.name)
		print("КАДР %s — %s — место %s — отрисовка %d мс" % [stop.name, stop.title, stop.view.to_code(), _frame_msec])

	var index := 1
	var base_debug := terrain.debug_view()
	for code in extra_views:
		# После кода места можно поставить «@N» — снять этот кадр в проверочном виде N (см. --debug-view): один
		# запуск даёт одно и то же место в нескольких видах, и видно, какая часть шейдера что рисует.
		var parts := code.split("@")
		var view := CameraView.from_code(parts[0])
		if view == null:
			print("КАДР пропущен: непонятный код места «%s»" % code)
			continue
		# Без «@N» кадр снимается в том виде, что задан ключом --debug-view (или в обычном).
		var own_view := parts.size() > 1
		if own_view:
			terrain.set_debug_view(parts[1].to_int())
		rig.set_view(view)
		await _before_shot()
		await _capture("mesto-%02d" % index)
		print("КАДР mesto-%02d — место %s%s — отрисовка %d мс" % [index, parts[0], (", вид %d" % parts[1].to_int()) if own_view else "", _frame_msec])
		# Что под серединой кадра: точка земли и сколько метров земли приходится на точку экрана вправо и вниз
		# (по ним видно, с какой подробностью видеокарта берёт текстуры в этом месте).
		var middle := get_viewport().get_visible_rect().size * 0.5
		var here := rig.ground_point(middle)
		var right := rig.ground_point(middle + Vector2(8.0, 0.0))
		var below := rig.ground_point(middle + Vector2(0.0, 8.0))
		if here != StrategyCamera.NO_POINT and right != StrategyCamera.NO_POINT and below != StrategyCamera.NO_POINT:
			print("   под серединой кадра: x=%.1f z=%.1f высота %.1f м; на точку экрана: вправо %.2f м, вниз %.2f м земли"
					% [here.x, here.z, here.y, here.distance_to(right) / 8.0, here.distance_to(below) / 8.0])
		if own_view:
			terrain.set_debug_view(base_debug)
		index += 1

	# Записка «что нового» — кадр для проверки, что текст помещается в окно.
	if not checks_only and (only.is_empty() or _listed("93-chto-novogo", only)):
		hud.show_report(BuildInfo.notes())
		await _frames(3)
		await _capture("93-chto-novogo")
		hud.close_report()

	if not only.is_empty():
		# Только выбранные кадры: проверки, замер и другие карты не нужны. Отчёт с высотами — для сверки с песочницей.
		_save_report(_collect_report())
		print("ИТОГ: только кадры (--stops), проверки пропущены")
		get_tree().quit(0)
		return

	if not checks_only:
		hud.set_help_open(true)
		rig.set_view(stops[0].view)
		await _frames(3)
		await _capture("90-podskazka")
		hud.set_help_open(false)

	# Проверки камеры идут на уменьшенной картинке: числа от этого не меняются, а кадры считаются быстрее.
	get_viewport().scaling_3d_scale = 0.25
	await _check_zoom()
	await _check_drag()
	await _check_bounds()
	await _check_flight()
	_check_mountain_camera(stops)
	await _check_sky()
	_check_islets("")

	if quick:
		get_viewport().scaling_3d_scale = 1.0
		_save_report(_collect_report())
		print("ИТОГ: проверок %d, не прошло %d (быстрая проверка: одна карта, без замера)" % [_checks.size(), _failed])
		get_tree().quit(1 if _failed > 0 else 0)
		return

	# Замер скорости и снимок: проверяем, что клавиши F5 и F2 делают своё дело (сам замер здесь короткий).
	benchmark.time_scale = 0.05
	benchmark.run(world, rig, terrain.height_map, terrain, _find_sun())
	var report: String = await benchmark.finished
	_check("замер скорости даёт отчёт с разбором", report.contains("Кадров в секунду") and report.contains("Разбор"), "%d строк" % report.split("\n").size())
	print("ОТЧЁТ ЗАМЕРА:\n" + report)
	benchmark.time_scale = 1.0
	get_viewport().scaling_3d_scale = 1.0
	rig.set_view(stops[0].view)
	await _frames(3)
	await _capture("91-zamer")
	hud.close_report()
	await snapshot.call()
	await _frames(2)
	await _capture("92-snimok")

	# Отчёт — по первой карте («Осень»): по нему функция высот сверяется с песочницей. Проверки других карт
	# дописываются в него же.
	var first_world := _collect_report()

	# Другие карты (клавиша M): каждая должна построиться, а перекрёстки — стоять на суше. Кадры — весь мир,
	# острова, горы, озеро и обрыв.
	var first_title := _world.title
	while true:
		var next: Dictionary = await next_world.call()
		if next.is_empty():
			_check("другая карта строится", false, "мир не построился")
			break
		var number: int = next["number"]
		_world = next["world"]
		_terrain = next["terrain"]
		if _world.title == first_title:
			break  # круг замкнулся: снова первая карта
		await _frames(4)
		var lowest := INF
		var lowest_key := ""
		for site in _world.sites:
			var site_height := _terrain.height_map.sample(site.position)
			if site_height < lowest:
				lowest = site_height
				lowest_key = site.key
		_check("карта %d «%s»: перекрёстки на суше" % [number, _world.title], lowest > 0.5, "самый низкий %s — %.2f м" % [lowest_key, lowest])
		_check_islets("карта %d: " % number)
		var prefix := "k%d" % number
		_terrain.height_map.to_preview().save_png(_folder.path_join("%s-vysoty.png" % prefix))
		for stop in Tour.stops(_world, _rig, _terrain.height_map):
			if not (stop.name.begins_with("01") or stop.name.contains("ostrov-") or stop.name.contains("ozero") or stop.name.contains("obryv")
					or stop.name.contains("gory") or stop.name.contains("okean") or stop.name.contains("kamenolomnya")):
				continue
			_rig.set_view(stop.view)
			await _before_shot()
			await _capture("%s-%s" % [prefix, stop.name])
			print("КАДР %s-%s — %s — место %s" % [prefix, stop.name, stop.title, stop.view.to_code()])

	_save_report(first_world)
	print("ИТОГ: проверок %d, не прошло %d" % [_checks.size(), _failed])
	get_tree().quit(1 if _failed > 0 else 0)


## Кадр облёта входит в список номеров: «17» подходит к «17-ves-okean».
static func _listed(stop_name: String, numbers: PackedStringArray) -> bool:
	for number in numbers:
		if stop_name.begins_with(number.strip_edges() + "-"):
			return true
	return false


# ── Проверки ─────────────────────────────────────────────────────────────────

func _check_zoom() -> void:
	var meadow := _world.cells_of(WorldData.Terrain.MEADOW)
	var centre := meadow[0].center() if not meadow.is_empty() else _world.land_rect.get_center()
	_rig.set_view(CameraView.make(centre, 1400.0, 20.0, 0.0))
	await _frames(2)
	var size := get_viewport().get_visible_rect().size
	var cursor := size * Vector2(0.71, 0.64)
	var before := _rig.ground_point(cursor)
	for i in 6:
		_wheel(cursor, true)
		await _frames(1)
	await _settle(1.6)
	var after := _rig.plane_point(cursor, before.y)
	var drift := Vector2(before.x - after.x, before.z - after.z).length()
	_check("приближение держит место под курсором", drift < _rig.current_distance() * 0.01,
			"сдвиг %.2f м при расстоянии %.0f м" % [drift, _rig.current_distance()])
	_check("приближение сработало", _rig.current_distance() < 700.0, "расстояние %.0f м" % _rig.current_distance())


func _check_drag() -> void:
	var size := get_viewport().get_visible_rect().size
	var from := size * Vector2(0.3, 0.62)
	var to := size * Vector2(0.63, 0.4)
	var grabbed := _rig.ground_point(from)
	_mouse_button(from, MOUSE_BUTTON_LEFT, true)
	var last := from
	for i in 12:
		var point := from.lerp(to, float(i + 1) / 12.0)
		_mouse_motion(point, point - last, MOUSE_BUTTON_MASK_LEFT)
		last = point
		await _frames(1)
	var under := _rig.plane_point(to, grabbed.y)
	var slip := Vector2(grabbed.x - under.x, grabbed.z - under.z).length()
	_mouse_button(to, MOUSE_BUTTON_LEFT, false)
	_check("земля идёт за курсором при перетаскивании", slip < 1.0, "расхождение %.2f м" % slip)
	await _settle(1.5)


func _check_bounds() -> void:
	var far := _world.content_rect.end + Vector2(9000.0, 9000.0)
	_rig.set_view(CameraView.make(far, 800.0, 0.0, 0.0))
	await _frames(2)
	var focus := _rig.get_view().focus
	var allowed := _world.content_rect.grow(300.0)
	_check("камера не уходит за границы мира", allowed.has_point(focus), "фокус %s" % str(focus))
	_rig.set_view(CameraView.make(_world.land_rect.get_center(), 1.0e6, 0.0, 0.0))
	await _frames(2)
	var widest := _rig.current_distance()
	_check("отдаление ограничено", widest < 40000.0 and widest > 1000.0, "расстояние %.0f м" % widest)


func _check_flight() -> void:
	var stops := Tour.stops(_world, _rig, _terrain.height_map)
	_rig.set_view(stops[0].view)
	await _frames(2)
	var goal := stops[mini(3, stops.size() - 1)].view
	_rig.fly_to(goal)
	await _settle(3.2)
	var view := _rig.get_view()
	var miss := view.focus.distance_to(goal.focus)
	_check("перелёт приходит в цель", miss < 2.0 and absf(view.distance - goal.distance) < 2.0,
			"мимо на %.2f м, расстояние %.0f вместо %.0f" % [miss, view.distance, goal.distance])


## Камера у гор (замечание владельца 11.11: при близком зуме к горам камера прыгала и отскакивала от них).
## Шаги камеры считаются вручную, по 1/60 секунды: (1) проход вплотную над хребтом с четырёх сторон; (2) приближение
## колесом к склонам — курсор в шести местах экрана, с шести сторон. Меряем высоту камеры: «толчок» — насколько
## за один шаг изменилась её скорость по высоте (у плавного движения — сантиметры, у прыжка — метры), и «развороты» —
## сколько раз камера рывком сменила подъём на спуск или обратно. Первые шаги после щелчка колеса в счёт не идут:
## там скорость меняется по замыслу. И камера не должна оказываться в склоне.
func _check_mountain_camera(stops: Array) -> void:
	var centre := Vector2.INF
	for stop in stops:
		if stop.name.ends_with("-gory"):
			centre = stop.view.focus
	if centre == Vector2.INF:
		return
	var dt := 1.0 / 60.0
	var size := get_viewport().get_visible_rect().size
	var pan_jolt := 0.0
	var zoom_jolt := 0.0
	var turns := 0
	var lowest := INF
	for pass_index in 4:
		var along := Vector2.from_angle(deg_to_rad(40.0 + 47.0 * float(pass_index)))
		_rig.set_view(CameraView.make(centre - along * 280.0, 125.0, 35.0 + 90.0 * float(pass_index), -8.0))
		var height := _rig.camera.global_position.y
		var speed := 0.0
		for step in 560:
			_rig.pan_by(along * 60.0 * dt)
			_rig._process(dt)
			var now := _rig.camera.global_position.y
			var now_speed := now - height
			if step > 1:
				pan_jolt = maxf(pan_jolt, absf(now_speed - speed))
				if absf(now_speed) > 0.2 and absf(speed) > 0.2 and signf(now_speed) != signf(speed):
					turns += 1
			height = now
			speed = now_speed
			lowest = minf(lowest, _eye_clearance())
	var cursors: Array[Vector2] = [Vector2(0.5, 0.4), Vector2(0.3, 0.35), Vector2(0.7, 0.35), Vector2(0.5, 0.25), Vector2(0.25, 0.55), Vector2(0.75, 0.6)]
	for pass_index in cursors.size():
		var screen := size * cursors[pass_index]
		_rig.set_view(CameraView.make(centre + Vector2.from_angle(float(pass_index) * 1.1) * 80.0, 560.0, 60.0 * float(pass_index), -10.0))
		var height := _rig.camera.global_position.y
		var speed := 0.0
		for wheel in 14:
			# Последние два «щелчка» — без колеса: камера доходит до места и успокаивается.
			if wheel < 12:
				_rig._zoom(1.0 / StrategyCamera.ZOOM_STEP, screen)
			for step in 20:
				_rig._process(dt)
				var now := _rig.camera.global_position.y
				var now_speed := now - height
				if step > 2:
					zoom_jolt = maxf(zoom_jolt, absf(now_speed - speed))
					if absf(now_speed) > 0.2 and absf(speed) > 0.2 and signf(now_speed) != signf(speed):
						turns += 1
				height = now
				speed = now_speed
				lowest = minf(lowest, _eye_clearance())
	_rig.set_view(stops[0].view)
	_check("камера у гор идёт плавно и не уходит в склон", pan_jolt < 0.6 and zoom_jolt < 1.2 and turns <= 2 and lowest > 3.0,
			"толчок по высоте за 1/60 с: при проходе %.2f м, при приближении %.2f м; разворотов рывком %d; ближе всего к земле %.1f м"
			% [pan_jolt, zoom_jolt, turns, lowest])


## Замер по частям (ключ --profile=место;место…): сколько времени кадра уходит на шейдер земли и на тени, и сколько
## стоили бы затенение впадин (SSAO) и сглаживание краёв в четыре прохода. Кадр считается несколько раз, каждый раз
## с одной изменённой настройкой; разница — её цена. В рабочей среде картинку считает процессор, поэтому числа —
## не скорость у игрока, а доли: что дорого. Так на 0.5.1 нашлось, что затенение впадин заставляло шейдер земли
## выполняться дважды (38 % кадра вблизи).
func _profile(views: PackedStringArray) -> void:
	var sun := _find_sun()
	var environment := get_viewport().world_3d.environment
	if environment == null:
		for node in get_tree().root.find_children("*", "WorldEnvironment", true, false):
			environment = (node as WorldEnvironment).environment
	var viewport := get_viewport()
	var msaa := viewport.msaa_3d
	var ssao := environment.ssao_enabled
	viewport.scaling_3d_scale = 1.0
	for code in views:
		var view := CameraView.from_code(code)
		if view == null:
			print("ЗАМЕР пропущен: непонятный код места «%s»" % code)
			continue
		_rig.set_view(view)
		await _frames(3)
		var whole := await _frame_cost()
		sun.shadow_enabled = false
		var no_shadows := await _frame_cost()
		sun.shadow_enabled = true
		environment.ssao_enabled = not ssao
		var other_ssao := await _frame_cost()
		environment.ssao_enabled = ssao
		viewport.msaa_3d = Viewport.MSAA_4X
		var msaa_four := await _frame_cost()
		viewport.msaa_3d = msaa
		_terrain.set_flat(true)
		var flat := await _frame_cost()
		_terrain.set_flat(false)
		print("ЗАМЕР %s: кадр %.0f мс; из них шейдер земли %.0f мс (%.0f %%), тени %.0f мс; затенение впадин %s бы %.0f мс; сглаживание в четыре прохода добавило бы %.0f мс"
				% [code, whole, whole - flat, 100.0 * (whole - flat) / whole, whole - no_shadows,
				"убавило" if ssao else "добавило", absf(other_ssao - whole), msaa_four - whole])


func _find_sun() -> DirectionalLight3D:
	for node in get_tree().root.find_children("*", "DirectionalLight3D", true, false):
		return node
	return null


## Среднее время кадра, мс (первые два кадра после смены настроек в счёт не идут).
func _frame_cost(frames := 3) -> float:
	await _frames(2)
	var started := Time.get_ticks_usec()
	await _frames(frames)
	return float(Time.get_ticks_usec() - started) / 1000.0 / float(frames)


## Высота камеры над землёй под ней.
func _eye_clearance() -> float:
	var eye := _rig.camera.global_position
	return eye.y - maxf(_terrain.height_map.sample(Vector2(eye.x, eye.z)), 0.0)


## Правая кнопка мыши: взгляд поднимается выше горизонта (видно небо) и опускается почти отвесно.
func _check_sky() -> void:
	_rig.set_view(CameraView.make(_world.land_rect.get_center(), 2600.0, 0.0, 0.0))
	await _frames(2)
	var size := get_viewport().get_visible_rect().size
	var grip := size * 0.5
	await _tilt_with_mouse(grip, -30.0, 40)
	var up := _look_elevation()
	_check("правая кнопка поднимает взгляд выше горизонта", up > 8.0, "взгляд на %.1f° выше горизонта" % up)
	var edge := _rig.ground_point(Vector2(size.x * 0.5, size.y - 4.0))
	_check("край земли остаётся в кадре", edge != StrategyCamera.NO_POINT, "у нижнего края кадра %s" % ("земля" if edge != StrategyCamera.NO_POINT else "небо"))

	# У горизонта приближение не должно менять угол взгляда.
	for i in 6:
		_wheel(grip, true)
		await _frames(1)
	await _settle(1.6)
	var after_zoom := _look_elevation()
	_check("приближение не сбивает взгляд у горизонта", absf(after_zoom - up) < 1.5,
			"было %.1f°, стало %.1f°, расстояние %.0f м" % [up, after_zoom, _rig.current_distance()])

	await _tilt_with_mouse(grip, 30.0, 70)
	var down := _look_elevation()
	_check("правая кнопка опускает взгляд почти отвесно", down < -80.0, "взгляд на %.1f° ниже горизонта" % -down)


## Тянем правой кнопкой по вертикали: шагов count по step точек.
func _tilt_with_mouse(from: Vector2, step: float, count: int) -> void:
	_mouse_button(from, MOUSE_BUTTON_RIGHT, true)
	for i in count:
		_mouse_motion(from + Vector2(0.0, step * float(i + 1)), Vector2(0.0, step), MOUSE_BUTTON_MASK_RIGHT)
		await _frames(1)
	_mouse_button(from, MOUSE_BUTTON_RIGHT, false)
	await _settle(1.2)


## На сколько градусов взгляд камеры выше горизонта (меньше нуля — ниже).
func _look_elevation() -> float:
	var forward := -_rig.camera.global_transform.basis.z
	return rad_to_deg(asin(clampf(forward.y, -1.0, 1.0)))


func _check(title: String, passed: bool, details: String) -> void:
	_checks.append({"title": title, "passed": passed, "details": details})
	if not passed:
		_failed += 1
	print("ПРОВЕРКА %s: %s (%s)" % ["пройдена" if passed else "НЕ ПРОЙДЕНА", title, details])


# ── Служебное ────────────────────────────────────────────────────────────────

func _frames(count: int) -> void:
	for i in count:
		await get_tree().process_frame


## Перед кадром: плитки земли и тени подстраиваются под новое место несколько кадров. На программной видеокарте
## кадр с материалами земли считается секунды, поэтому первые кадры идут на уменьшенной картинке, а к снимку
## картинка возвращается к полной.
func _before_shot() -> void:
	get_viewport().scaling_3d_scale = 0.25
	await _frames(4)
	get_viewport().scaling_3d_scale = 1.0
	await _frames(1)
	var started := Time.get_ticks_msec()
	await _frames(1)
	_frame_msec = Time.get_ticks_msec() - started


## Ждём, пока камера успокоится: не меньше заданного времени игры и не меньше трёх кадров.
func _settle(seconds: float) -> void:
	var until := _clock + seconds
	await _frames(3)
	while _clock < until:
		await get_tree().process_frame


func _capture(file_name: String) -> void:
	await RenderingServer.frame_post_draw
	var image := get_viewport().get_texture().get_image()
	image.save_png(_folder.path_join(file_name + ".png"))


func _wheel(position: Vector2, zoom_in: bool) -> void:
	var event := InputEventMouseButton.new()
	event.button_index = MOUSE_BUTTON_WHEEL_UP if zoom_in else MOUSE_BUTTON_WHEEL_DOWN
	event.pressed = true
	event.factor = 1.0
	event.position = position
	event.global_position = position
	_send(event)


func _mouse_button(position: Vector2, button: MouseButton, pressed: bool) -> void:
	var event := InputEventMouseButton.new()
	event.button_index = button
	event.pressed = pressed
	event.position = position
	event.global_position = position
	_send(event)


func _mouse_motion(position: Vector2, relative: Vector2, mask: int) -> void:
	var event := InputEventMouseMotion.new()
	event.position = position
	event.global_position = position
	event.relative = relative
	event.button_mask = mask
	_send(event)


func _send(event: InputEvent) -> void:
	Input.parse_input_event(event)
	Input.flush_buffered_events()


func _site_heights() -> Dictionary:
	var heights := {}
	for site in _world.sites:
		heights[site.key] = snappedf(_terrain.height_map.sample(site.position), 0.01)
	return heights


## Малые острова: у каждого суша над водой, а рядом с ним — море.
func _check_islets(prefix: String) -> void:
	if _world.islets.is_empty():
		return
	var good := 0
	var problem := ""
	for i in _world.islets.size():
		var islet := _world.islets[i]
		# Вершина острова — там, где её поставил каталог (повёрнута и растянута вместе со штампом), и высотой как там.
		var top: Vector3 = WorldData.design_value(islet.design, "top", Vector3.ZERO)
		var expected := top.z * islet.height_scale()
		var summit := _terrain.height_map.sample(islet.to_world(Vector2(top.x, top.y)))
		var sea := _terrain.height_map.sample(islet.position + Vector2(islet.reach() * 1.05 + 180.0, 0.0))
		if summit > 1.5 and absf(summit - expected) < 3.0 + expected * 0.05 and sea < 0.0:
			good += 1
		elif problem.is_empty():
			problem = "%s: вершина %.1f м (ждали %.1f), рядом %.1f м" % [islet.title(), summit, expected, sea]
	_check("%sмалые острова стоят на местах, вершины над водой" % prefix, good == _world.islets.size(),
			"%d из %d%s" % [good, _world.islets.size(), "" if problem.is_empty() else "; " + problem])


## Высоты в условленных точках малых островов: центр, середина к востоку, вершина и море у восточного края.
func _probes() -> Dictionary:
	var result := {}
	for i in _world.islets.size():
		var islet := _world.islets[i]
		var top: Vector3 = WorldData.design_value(islet.design, "top", Vector3.ZERO)
		var points := {
			"centre": islet.position,
			"east": islet.position + Vector2(islet.radius * 0.45, 0.0),
			"top": islet.to_world(Vector2(top.x, top.y)),
			"sea": islet.position + Vector2(islet.reach() * 1.05 + 120.0, 0.0),
		}
		for name: String in points:
			var point: Vector2 = points[name]
			result["%d:%s" % [i, name]] = [snappedf(point.x, 0.01), snappedf(point.y, 0.01), snappedf(_terrain.height_map.sample(point), 0.01)]
	return result


func _collect_report() -> Dictionary:
	return {
		"build": BuildInfo.label(),
		"world": _world.title,
		"adapter": RenderingServer.get_video_adapter_name(),
		"bake_ms": _terrain.bake_ms,
		"bake_size": [_terrain.height_map.width, _terrain.height_map.height],
		"height_range": [_terrain.height_map.lowest, _terrain.height_map.highest],
		"chunks": _terrain.chunk_count(),
		"lakes": _terrain.lakes,
		"ponds": _terrain.ponds,
		"regions": _terrain.region_count(),
		# Высоты на малых островах и в море рядом с ними: по ним острова и дно сверяются с песочницей.
		"probes": _probes(),
		# Высоты под перекрёстками: по ним функция высот в игре сверяется с песочницей разработчика.
		"site_heights": _site_heights(),
	}


func _save_report(report: Dictionary) -> void:
	report["checks"] = _checks
	report["failed"] = _failed
	var file := FileAccess.open(_folder.path_join("otchet.json"), FileAccess.WRITE)
	if file != null:
		file.store_string(JSON.stringify(report, "  "))
		file.close()
