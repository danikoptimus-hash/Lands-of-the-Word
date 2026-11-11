class_name ShotDirector
extends Node
## Автоматическая съёмка и проверки для конвейера сборки (запуск с ключом --shots=папка).
## Снимает кадры облёта, сохраняет картинку высот и проверяет камеру числами:
## место под курсором не уезжает при приближении, земля идёт за рукой при перетаскивании, границы держат.

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
		benchmark: Benchmark, snapshot: Callable) -> void:
	_folder = folder
	_world = world
	_terrain = terrain
	_rig = rig
	_hud = hud
	DirAccess.make_dir_recursive_absolute(folder)
	await _frames(4)

	var preview := terrain.height_map.to_preview()
	preview.save_png(folder.path_join("vysoty.png"))

	var stops := Tour.stops(world, rig, terrain.height_map)
	for stop in stops:
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

	_write_report()
	print("ИТОГ: проверок %d, не прошло %d" % [_checks.size(), _failed])
	get_tree().quit(1 if _failed > 0 else 0)


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
	var far := _world.land_rect.end + Vector2(9000.0, 9000.0)
	_rig.set_view(CameraView.make(far, 800.0, 0.0, 0.0))
	await _frames(2)
	var focus := _rig.get_view().focus
	var allowed := _world.land_rect.grow(300.0)
	_check("камера не уходит за границы мира", allowed.has_point(focus), "фокус %s" % str(focus))
	_rig.set_view(CameraView.make(_world.land_rect.get_center(), 1.0e6, 0.0, 0.0))
	await _frames(2)
	var widest := _rig.current_distance()
	_check("отдаление ограничено", widest < 20000.0 and widest > 1000.0, "расстояние %.0f м" % widest)


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


func _write_report() -> void:
	var report := {
		"build": BuildInfo.label(),
		"world": _world.title,
		"adapter": RenderingServer.get_video_adapter_name(),
		"bake_ms": _terrain.bake_ms,
		"bake_size": [_terrain.height_map.width, _terrain.height_map.height],
		"height_range": [_terrain.height_map.lowest, _terrain.height_map.highest],
		"chunks": _terrain.chunk_count(),
		"lakes": _terrain.lakes,
		# Высоты под перекрёстками: по ним функция высот в игре сверяется с песочницей разработчика.
		"site_heights": _site_heights(),
		"checks": _checks,
		"failed": _failed,
	}
	var file := FileAccess.open(_folder.path_join("otchet.json"), FileAccess.WRITE)
	if file != null:
		file.store_string(JSON.stringify(report, "  "))
		file.close()
