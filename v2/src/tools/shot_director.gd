class_name ShotDirector
extends Node
## Автоматическая съёмка и проверки для конвейера сборки (запуск с ключом --shots=папка).
## Снимает кадры облёта, сохраняет картинку высот и проверяет камеру числами:
## место под курсором не уезжает при приближении, земля идёт за рукой при перетаскивании, границы держат.
## Быстрые проверки (для разработчика, v2/tools/godot-local.sh): --quick — только первая карта, без замера скорости
## и других карт; --stops=17,21 — только кадры облёта с этими номерами, без проверок.

var _world: WorldData
var _terrain: WorldTerrain
var _rig: StrategyCamera
var _hud: Hud
var _folder := ""
var _checks: Array[Dictionary] = []
var _failed := 0
var _clock := 0.0


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
	var only := PackedStringArray()
	for argument in OS.get_cmdline_user_args():
		if argument == "--quick":
			quick = true
		elif argument.begins_with("--stops="):
			only = argument.trim_prefix("--stops=").split(",", false)
	await _frames(4)

	var preview := terrain.height_map.to_preview()
	preview.save_png(folder.path_join("vysoty.png"))

	var stops := Tour.stops(world, rig, terrain.height_map)
	for stop in stops:
		if not only.is_empty() and not _listed(stop.name, only):
			continue
		rig.set_view(stop.view)
		await _frames(5)
		await _capture(stop.name)
		print("КАДР %s — %s — место %s" % [stop.name, stop.title, stop.view.to_code()])

	var index := 1
	for code in extra_views:
		var view := CameraView.from_code(code)
		if view == null:
			print("КАДР пропущен: непонятный код места «%s»" % code)
			continue
		rig.set_view(view)
		await _frames(5)
		await _capture("mesto-%02d" % index)
		index += 1

	if not only.is_empty():
		# Только выбранные кадры: проверки, замер и другие карты не нужны. Отчёт с высотами — для сверки с песочницей.
		_save_report(_collect_report())
		print("ИТОГ: только кадры (--stops), проверки пропущены")
		get_tree().quit(0)
		return

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
	benchmark.run(world, rig, terrain.height_map)
	var report: String = await benchmark.finished
	_check("замер скорости даёт отчёт", report.contains("Кадров в секунду"), "%d строк" % report.split("\n").size())
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
			await _frames(5)
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
	var dry := 0
	var lowest_top := INF
	var problem := ""
	for i in _world.islets.size():
		var islet := _world.islets[i]
		var top := -INF
		for row in 13:
			for column in 13:
				var offset := Vector2(float(column) / 6.0 - 1.0, float(row) / 6.0 - 1.0) * islet.radius
				top = maxf(top, _terrain.height_map.sample(islet.position + offset))
		var sea := _terrain.height_map.sample(islet.position + Vector2(islet.radius * 1.05 + 180.0, 0.0))
		if top > 1.5 and sea < 0.0:
			dry += 1
		elif problem.is_empty():
			problem = "%s: вершина %.1f м, рядом %.1f м" % [islet.title(), top, sea]
		lowest_top = minf(lowest_top, top)
	_check("%sмалые острова стоят над водой" % prefix, dry == _world.islets.size(),
			"%d из %d, самый низкий — %.1f м%s" % [dry, _world.islets.size(), lowest_top, "" if problem.is_empty() else "; " + problem])


## Высоты в условленных точках малых островов: центр картинки, середина к востоку и море у восточного края.
func _probes() -> Dictionary:
	var result := {}
	for i in _world.islets.size():
		var islet := _world.islets[i]
		for part: Array in [["centre", 0.0], ["east", 0.45], ["sea", 1.25]]:
			var point := islet.position + Vector2(islet.radius * float(part[1]), 0.0)
			result["%d:%s" % [i, part[0]]] = [snappedf(point.x, 0.01), snappedf(point.y, 0.01), snappedf(_terrain.height_map.sample(point), 0.01)]
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
