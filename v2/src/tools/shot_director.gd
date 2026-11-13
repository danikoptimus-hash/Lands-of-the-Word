class_name ShotDirector
extends Node
## Автоматическая съёмка и проверки для конвейера сборки (запуск с ключом --shots=папка).
## Снимает кадры облёта, сохраняет картинку высот и проверяет камеру числами:
## место под курсором не уезжает при приближении, земля идёт за рукой при перетаскивании, границы держат.
## Быстрые проверки (для разработчика, v2/tools/godot-local.sh): --quick — только первая карта, без замера скорости
## и других карт; --stops=17,21 — только кадры облёта с этими номерами, без проверок; --checks — только проверки
## первой карты, без кадров (минута вместо получаса). У каждого кадра в журнале — время его отрисовки: в рабочей
## среде картинку считает процессор, и это время — мерило тяжести шейдеров (сравнивать до и после правки).

## В каком разрешении снимать кадры (доля полного): обычно в полном; ключ --render-scale=67 — как у игрока
## с большим экраном (картинка мира в 67 % с достройкой до полного).
var render_scale := 1.0

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
	var flight := PackedStringArray()
	var lights := PackedStringArray()
	var waters := PackedStringArray()
	var water_times := PackedStringArray()
	var strikes := PackedStringArray()
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--profile="):
			profile_views = argument.trim_prefix("--profile=").split(";", false)
		elif argument.begins_with("--flight="):
			flight = argument.trim_prefix("--flight=").split(";", false)
		elif argument == "--quick":
			quick = true
		elif argument == "--checks":
			quick = true
			checks_only = true
		elif argument.begins_with("--stops="):
			only = argument.trim_prefix("--stops=").split(",", false)
		elif argument.begins_with("--lights="):
			lights = argument.trim_prefix("--lights=").split(",", false)
		elif argument.begins_with("--weathers="):
			waters = argument.trim_prefix("--weathers=").split(",", false)
		elif argument.begins_with("--water-times="):
			water_times = argument.trim_prefix("--water-times=").split(",", false)
		elif argument.begins_with("--strikes="):
			strikes = argument.trim_prefix("--strikes=").split(",", false)
	for node in get_tree().root.find_children("*", "Flora", true, false):
		(node as Flora).instant = true
	await _frames(4)

	if not profile_views.is_empty():
		await _profile(profile_views)
		get_tree().quit(0)
		return
	if not flight.is_empty():
		await _flight(flight)
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

	# Утро, вечер и ночь (шаг 1.4): остров целиком и взгляд к горизонту. День — все кадры облёта выше.
	if not checks_only and only.is_empty():
		var day_light := _find_light()
		var places: Array[Tour.Stop] = []
		for stop in stops:
			if stop.name.ends_with("ostrov-ot") or stop.name.ends_with("gorizont"):
				places.append(stop)
		for phase: int in [DayLight.Phase.MORNING, DayLight.Phase.EVENING, DayLight.Phase.NIGHT]:
			day_light.set_phase(phase as DayLight.Phase, true)
			get_viewport().scaling_3d_scale = 0.25
			await _frames(12)
			for place in places:
				rig.set_view(place.view)
				await _before_shot()
				var file_name := "4%d-svet-%s-%s" % [phase, DayLight.PHASE_CODES[phase], place.name.substr(3)]
				await _capture(file_name)
				print("КАДР %s — %s, %s — отрисовка %d мс" % [file_name, DayLight.PHASE_TITLES[phase], place.title, _frame_msec])
		day_light.set_phase(DayLight.Phase.DAY, true)
		get_viewport().scaling_3d_scale = 0.25
		await _frames(12)
		get_viewport().scaling_3d_scale = 1.0

	# Шторм (шаг 1.6): остров целиком и взгляд сверху с рабочей высоты. Ясная погода — все кадры выше.
	if not checks_only and only.is_empty():
		var tour_weather := _find_weather()
		for kind: int in [Weather.Kind.STORM]:
			tour_weather.set_kind(kind as Weather.Kind, true)
			get_viewport().scaling_3d_scale = 0.25
			await _frames(12)
			for stop in stops:
				if stop.name.ends_with("ostrov-ot") or stop.name.ends_with("-sverhu"):
					rig.set_view(stop.view)
					await _before_shot()
					var file_name := "5%d-pogoda-%s-%s" % [kind, Weather.CODES[kind], stop.name.substr(3)]
					await _capture(file_name)
					print("КАДР %s — %s, %s — отрисовка %d мс" % [file_name, Weather.TITLES[kind], stop.title, _frame_msec])
		tour_weather.set_kind(Weather.Kind.CLEAR, true)
		get_viewport().scaling_3d_scale = 0.25
		await _frames(12)
		get_viewport().scaling_3d_scale = 1.0

	# Времена суток (ключ --lights=morning,evening,…; шаг 1.4): места из ключей --view снимаются в каждом свете;
	# без ключей --view — пять мест облёта: остров целиком, горы, взгляд сверху, озеро и взгляд к горизонту.
	if not lights.is_empty() and waters.is_empty():
		var light := _find_light()
		var place_names := PackedStringArray()
		var place_views: Array[CameraView] = []
		for view_code in extra_views:
			var view := CameraView.from_code(view_code.split("@")[0])
			if view != null:
				place_names.append("%02d" % (place_views.size() + 1))
				place_views.append(view)
		if place_views.is_empty():
			for ending: String in ["ostrov-ot", "gory", "sverhu", "ozero", "gorizont"]:
				for stop in stops:
					if stop.name.substr(3) == ending:
						place_names.append(ending)
						place_views.append(stop.view)
						break
		for code in lights:
			var phase := DayLight.PHASE_CODES.find(code)
			if phase < 0:
				print("КАДРЫ света пропущены: непонятное время суток «%s»" % code)
				continue
			light.set_phase(phase as DayLight.Phase, true)
			# Небо для отражений и рассеянного света пересчитывается за несколько кадров.
			get_viewport().scaling_3d_scale = 0.25
			await _frames(12)
			for i in place_views.size():
				rig.set_view(place_views[i])
				await _before_shot()
				var file_name := "svet-%s-%s" % [code, place_names[i]]
				await _capture(file_name)
				print("КАДР %s — %s — место %s — отрисовка %d мс" % [file_name,
						DayLight.PHASE_TITLES[phase], place_views[i].to_code(), _frame_msec])
		light.set_phase(DayLight.Phase.DAY, true)
		get_viewport().scaling_3d_scale = 0.25
		await _frames(12)
		get_viewport().scaling_3d_scale = 1.0

	# Погода (ключ --weathers=clear,rain,storm; шаги 1.5 и 1.6): в каждой погоде и в каждом времени суток
	# из --lights (без него — днём) снимаются места облёта, где видны вода и небо, и места из ключей --view.
	# С ключом --water-times=20,24,28 каждое место снимается в эти моменты времени воды (секунды) — видно, как
	# ходит накат; в имени кадра тогда стоит и момент.
	if not waters.is_empty():
		var day_light := _find_light()
		var place_names := PackedStringArray()
		var place_views: Array[CameraView] = []
		var weather := _find_weather()
		for ending: String in ["ostrov-ot", "bereg", "veshka", "ozero-bereg", "gorizont"]:
			for stop in stops:
				if stop.name.substr(3) == ending:
					place_names.append(ending)
					place_views.append(stop.view)
					break
		for view_code in extra_views:
			var view := CameraView.from_code(view_code.split("@")[0])
			if view != null:
				place_names.append("mesto-%d" % (place_names.size() - 4))
				place_views.append(view)
		var phases := PackedStringArray(["day"]) if lights.is_empty() else lights
		for water in waters:
			# «turn» — середина перехода от ясной погоды к шторму: так виден сам переход.
			var kind := Weather.Kind.STORM if water == "turn" else Weather.CODES.find(water)
			if kind < 0:
				print("КАДРЫ погоды пропущены: непонятная погода «%s»" % water)
				continue
			if water == "turn":
				weather.show_blend(Weather.Kind.CLEAR, Weather.Kind.STORM, 0.5)
			else:
				weather.set_kind(kind as Weather.Kind, true)
			for code in phases:
				var phase := DayLight.PHASE_CODES.find(code)
				if phase < 0:
					continue
				day_light.set_phase(phase as DayLight.Phase, true)
				get_viewport().scaling_3d_scale = 0.25
				await _frames(12)
				for i in place_views.size():
					rig.set_view(place_views[i])
					for moment in (water_times if not water_times.is_empty() else PackedStringArray([""])):
						if not moment.is_empty():
							terrain.set_water_time(moment.to_float())
						await _before_shot()
						var file_name := "pogoda-%s-%s-%s%s" % [water, code, place_names[i], ("-" + moment) if not moment.is_empty() else ""]
						await _capture(file_name)
						print("КАДР %s — %s, %s — место %s — отрисовка %d мс" % [file_name,
								"середина перехода к шторму" if water == "turn" else Weather.TITLES[kind],
								DayLight.PHASE_TITLES[phase], place_views[i].to_code(), _frame_msec])
					# Молнии (ключ --strikes=0,1,2: до земли, между тучами, в туче) — в шторм, тем же видом.
					if kind == Weather.Kind.STORM and water != "turn":
						for strike in strikes:
							weather.show_strike(strike.to_int())
							await _before_shot()
							var strike_name := "pogoda-%s-%s-%s-molniya-%s" % [water, code, place_names[i], strike]
							await _capture(strike_name)
							print("КАДР %s — молния %s — отрисовка %d мс" % [strike_name, strike, _frame_msec])
						if not strikes.is_empty():
							weather.hide_strike()
		terrain.set_water_time(WaterLook.SHOT_TIME)
		weather.set_kind(Weather.Kind.CLEAR, true)
		day_light.set_phase(DayLight.Phase.DAY, true)
		get_viewport().scaling_3d_scale = 0.25
		await _frames(12)
		get_viewport().scaling_3d_scale = 1.0

	# Записка «что нового» — кадр для проверки, что текст помещается в окно.
	if not checks_only and (only.is_empty() or _listed("93-chto-novogo", only)):
		hud.show_report(BuildInfo.notes())
		await _frames(3)
		await _capture("93-chto-novogo")
		hud.close_report()

	if _listed("91-zamer", only):
		await _check_benchmark(benchmark, world, rig, terrain, hud, stops)
	if _listed("92-kesh", only):
		await _check_cache(stops)
	if _listed("94-svet", only):
		await _check_light(stops)
	if _listed("95-voda", only):
		await _check_water(stops)
	if _listed("98-flora", only):
		await _check_flora(world, terrain)
	if _listed("97-pogoda", only):
		await _check_weather(stops)
	if _listed("96-kamera", only):
		get_viewport().scaling_3d_scale = 0.25
		await _check_zoom()
		await _check_drag()
		await _check_bounds()
		await _check_flight()
		_check_mountain_camera(stops)
		await _check_sky()
		_check_islets("")
		get_viewport().scaling_3d_scale = 1.0

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
	await _check_light(stops)
	await _check_water(stops)
	await _check_weather(stops)
	await _check_flora(world, terrain)
	await _check_cache(stops)

	if quick:
		get_viewport().scaling_3d_scale = 1.0
		_save_report(_collect_report())
		print("ИТОГ: проверок %d, не прошло %d (быстрая проверка: одна карта, без замера)" % [_checks.size(), _failed])
		get_tree().quit(1 if _failed > 0 else 0)
		return

	# Замер скорости и снимок: проверяем, что клавиши F5 и F2 делают своё дело (сам замер здесь короткий).
	await _check_benchmark(benchmark, world, rig, terrain, hud, stops)
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
		await _check_swash_closed("карта %d «%s»: " % [number, _world.title])
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
	var far := _world.content_rect.end + Vector2(50000.0, 50000.0)
	_rig.set_view(CameraView.make(far, 800.0, 0.0, 0.0))
	await _frames(2)
	var focus := _rig.get_view().focus
	var allowed := _world.content_rect.grow(1700.0)
	_check("камера не уходит за границы мира", allowed.has_point(focus), "фокус %s" % str(focus))
	_rig.set_view(CameraView.make(_world.land_rect.get_center(), 1.0e6, 0.0, 0.0))
	await _frames(2)
	var widest := _rig.current_distance()
	_check("отдаление ограничено", widest < 240000.0 and widest > 6000.0, "расстояние %.0f м" % widest)


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
	var zoom_where := ""
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
				pan_jolt = maxf(pan_jolt, _jolt(speed, now_speed))
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
					if _jolt(speed, now_speed) > zoom_jolt:
						zoom_jolt = _jolt(speed, now_speed)
						zoom_where = "заход %d, щелчок %d, шаг %d: расстояние %.0f м, скорость по высоте %.2f → %.2f м за шаг" % [
								pass_index, wheel, step, _rig.current_distance(), speed, now_speed]
					if absf(now_speed) > 0.2 and absf(speed) > 0.2 and signf(now_speed) != signf(speed):
						turns += 1
				height = now
				speed = now_speed
				lowest = minf(lowest, _eye_clearance())
	_rig.set_view(stops[0].view)
	_check("камера у гор идёт плавно и не уходит в склон", pan_jolt < 0.6 and zoom_jolt < 1.2 and turns <= 2 and lowest > 3.0,
			"толчок по высоте за 1/60 с: при проходе %.2f м, при приближении %.2f м (%s); разворотов рывком %d; ближе всего к земле %.1f м"
			% [pan_jolt, zoom_jolt, zoom_where, turns, lowest])


## Непрерывный пролёт камеры кадр за кадром (ключ --flight=место;место;…;кадров): между соседними местами —
## столько кадров, расстояние меняется в масштабе (каждый кадр — на ту же долю ближе). Кадры polet-NNNN.png
## складываются в папку (из них собирается видео), в журнал — что менялось на каждом кадре: расстояние, сколько
## треугольников, вызовов отрисовки и объектов в кадре, сколько плиток земли сменили сетку, сколько деревьев
## и пачек растительности стоит. Так переходы уровней подробности видны в рабочей среде, где самого движения
## не видно. Вместо кода места можно написать «etalon@расстояние»: эталонный участок — город, а рядом лес.
func _flight(parts: PackedStringArray) -> void:
	var frames := maxi(parts[parts.size() - 1].to_int(), 2)
	var views: Array[CameraView] = []
	for i in parts.size() - 1:
		var view: CameraView = null
		if parts[i].begins_with("etalon@"):
			view = CameraView.make(_reference_place(), parts[i].trim_prefix("etalon@").to_float(), 25.0, 0.0)
		else:
			view = CameraView.from_code(parts[i])
		if view == null:
			print("ПРОЛЁТ пропущен: непонятное место «%s»" % parts[i])
			return
		views.append(view)
	if views.size() < 2:
		return
	for view in views:
		print("ПРОЛЁТ место %s" % view.to_code())
	var flora: Flora = null
	for node in get_tree().root.find_children("*", "Flora", true, false):
		flora = node
	_hud.visible = false
	var number := 0
	for segment in views.size() - 1:
		for i in frames:
			var view := CameraView.blend(views[segment], views[segment + 1], float(i) / float(frames - 1 if segment == views.size() - 2 else frames))
			_rig.set_view(view)
			var switches := _terrain.lod_switches
			get_viewport().scaling_3d_scale = 0.25
			await _frames(2)
			get_viewport().scaling_3d_scale = render_scale
			var started := Time.get_ticks_msec()
			await _frames(1)
			await _capture("polet-%04d" % number)
			var trees := 0
			if flora != null:
				for kind in 6:
					trees += flora.counts[kind]
			print("ПРОЛЁТ %04d: расстояние %.0f м, камера на высоте %.0f м; треугольников %d, вызовов отрисовки %d, объектов %d; плиток земли сменили сетку: %d; деревьев %d, пачек %d; кадр %d мс" % [
					number, view.distance, _rig.camera.global_position.y,
					RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
					RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
					RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME),
					_terrain.lod_switches - switches, trees, flora.batches if flora != null else 0, Time.get_ticks_msec() - started])
			number += 1
	_hud.visible = true


## Эталонный участок для приёмки: город, а рядом лес — точка между стеной города и ближайшим густым лесом.
## Берётся первый город со стеной, у которого в 300–700 м есть густой лес; место определяется картой, а не числами.
func _reference_place() -> Vector2:
	var flora: Flora = null
	for node in get_tree().root.find_children("*", "Flora", true, false):
		flora = node
	var best := _world.land_rect.get_center()
	var best_score := -1.0
	for site in _world.sites:
		if site.kind != "CITY" or flora == null:
			continue
		for i in 24:
			var heading := Vector2.from_angle(TAU * float(i) / 24.0)
			for away: float in [320.0, 420.0, 520.0]:
				var at: Vector2 = site.position + heading * away
				# Лес — не одна клетка: густо должно быть и чуть дальше от города.
				var score := minf(flora.tree_density(at), flora.tree_density(at + heading * 120.0))
				if score > best_score and _terrain.height_map.sample(at) > 2.0:
					best_score = score
					best = site.position + heading * (away * 0.62)
	return best


## «Толчок» камеры за шаг: насколько изменилась её скорость по высоте сверх плавного торможения. Камера догоняет
## цель по экспоненте — за шаг скорость сама убывает на шестую часть; с гексом в километр горы выше, камера при
## приближении к дальнему склону идёт по высоте десятки метров за шаг, и это убывание — не рывок.
func _jolt(speed: float, now_speed: float) -> float:
	return maxf(absf(now_speed - speed) - 0.18 * maxf(absf(speed), absf(now_speed)), 0.0)


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
		await _warm_cache()
		var whole := await _frame_cost()
		var direct := whole
		if _terrain.cache_budget > 0:
			_terrain.cache().reading = false
			direct = await _frame_cost()
			_terrain.cache().reading = true
			await _frames(1)
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
		print("ЗАМЕР %s: кадр %.0f мс (без кэша ближнего вида %.0f мс); из них шейдер земли %.0f мс (%.0f %%), тени %.0f мс; затенение впадин %s бы %.0f мс; сглаживание в четыре прохода добавило бы %.0f мс"
				% [code, whole, direct, whole - flat, 100.0 * (whole - flat) / whole, whole - no_shadows,
				"убавило" if ssao else "добавило", absf(other_ssao - whole), msaa_four - whole])


## Замер скорости (здесь короткий): отчёт с разбором и окно отчёта, которое помещается на экран целиком.
## До 0.5.3 окно было выше экрана, и низ отчёта — как раз разбор — владелец не видел; кадр окна снимался,
## но ничем не проверялся.
func _check_benchmark(benchmark: Benchmark, world: WorldData, rig: StrategyCamera, terrain: WorldTerrain, hud: Hud, stops: Array[Tour.Stop]) -> void:
	var scale := get_viewport().scaling_3d_scale
	get_viewport().scaling_3d_scale = 0.25
	benchmark.time_scale = 0.05
	benchmark.run(world, rig, terrain.height_map, terrain, _find_sun())
	var report: String = await benchmark.finished
	_check("замер скорости даёт отчёт с разбором", report.contains("Кадров в секунду") and report.contains("Разбор"), "%d строк" % report.split("\n").size())
	print("ОТЧЁТ ЗАМЕРА:\n" + report)
	benchmark.time_scale = 1.0
	get_viewport().scaling_3d_scale = 1.0
	rig.set_view(stops[0].view)
	await _frames(8)
	_check("окно отчёта о замере помещается на экран", hud.report_spare() >= 0.0 and hud.report_font() >= 13,
			"запас %.0f точек, шрифт %d" % [hud.report_spare(), hud.report_font()])
	await _capture("91-zamer")
	hud.close_report()
	get_viewport().scaling_3d_scale = scale


## Свет и небо (шаг 1.4): каждое время суток рисуется; днём светлее всего, ночью темнее всего, но землю видно
## («всё различимо» — требование к ночи с сайта); переход между временами суток плавный — без скачка света
## на середине, где солнце сменяется луной.
func _check_light(stops: Array[Tour.Stop]) -> void:
	var light := _find_light()
	if light == null:
		return
	var scale := get_viewport().scaling_3d_scale
	get_viewport().scaling_3d_scale = 0.25
	_rig.set_view(stops[1].view)
	var brightness: Array[float] = []
	for phase in 4:
		light.set_phase(phase as DayLight.Phase, true)
		await _frames(8)
		brightness.append(await _frame_brightness())
	var morning := brightness[DayLight.Phase.MORNING]
	var day := brightness[DayLight.Phase.DAY]
	var evening := brightness[DayLight.Phase.EVENING]
	var night := brightness[DayLight.Phase.NIGHT]
	_check("свет: днём светлее всего, ночью темнее всего, но землю видно",
			day >= morning and day >= evening and night < morning and night < evening and night > 0.07,
			"яркость кадра: утро %.2f, день %.2f, вечер %.2f, ночь %.2f" % [morning, day, evening, night])
	# Переход вечер → ночь, как клавишей, в двадцать шагов: ни один шаг не меняет яркость кадра резко.
	light.set_phase(DayLight.Phase.EVENING, true)
	await _frames(4)
	light.set_process(false)
	light.set_phase(DayLight.Phase.NIGHT)
	var last := await _frame_brightness()
	var first := last
	var jump := 0.0
	var steps := 0
	while light.is_changing() and steps < 40:
		light.step(DayLight.SWITCH_SECONDS / 20.0)
		await _frames(1)
		var now := await _frame_brightness()
		jump = maxf(jump, absf(now - last))
		last = now
		steps += 1
	light.set_process(true)
	var whole := maxf(absf(first - last), 0.01)
	_check("свет: переход между временами суток без скачков", steps >= 20 and jump < 0.35 * whole,
			"шагов %d, яркость %.2f → %.2f, самый большой шаг %.3f" % [steps, first, last, jump])
	light.set_phase(DayLight.Phase.DAY, true)
	await _frames(8)
	get_viewport().scaling_3d_scale = scale


## Средняя яркость картинки мира в кадре (0 — чёрное, 1 — белое); надписи по краям в счёт не идут.
func _frame_brightness() -> float:
	await RenderingServer.frame_post_draw
	var image := get_viewport().get_texture().get_image()
	var total := 0.0
	var count := 0
	for y in range(120, image.get_height() - 70, 8):
		for x in range(8, image.get_width() - 8, 8):
			total += image.get_pixel(x, y).get_luminance()
			count += 1
	return total / float(maxi(count, 1))


## Кэш ближнего вида вокруг камеры (near_cache.gd): картинка из кэша — та же, что при прямом расчёте, и на месте,
## и после проезда камеры (окна уровней сдвигаются, текстуры «по кругу» досчитываются полосами при малом бюджете);
## кадр с кэшем легче. В остальных кадрах облёта кэш выключен: картинка та же, а прогрев на программной отрисовке
## стоил бы минуты у каждого кадра.
func _check_cache(stops: Array[Tour.Stop]) -> void:
	var place: Tour.Stop = null
	for stop in stops:
		if stop.name.ends_with("gory-vblizi") or (place == null and stop.name.ends_with("holmy")):
			place = stop
	if place == null:
		return
	var budget := _terrain.cache_budget
	var scale := get_viewport().scaling_3d_scale
	get_viewport().scaling_3d_scale = 1.0
	_terrain.cache_budget = 40000000
	# Кэш работает вблизи (на точку экрана — меньше метра земли): место — горы, расстояние — настоящие 300 м
	# (кадр облёта «горы вблизи» с гексом в километр снят с 1,7 км — там земля уже рисуется дальней картинкой).
	var near_view := place.view.copy()
	near_view.distance = minf(near_view.distance, 300.0)
	_rig.set_view(near_view)
	await _frames(3)
	await _warm_cache()
	var first := await _cache_against_direct("92-kesh-na-meste")
	_check("кэш ближнего вида: картинка та же, что при прямом расчёте", first["mean"] < 5.0 and first["far"] < 0.01,
			"среднее отличие %.2f из 255, заметно отличается %.2f %% точек" % [first["mean"], 100.0 * first["far"]])
	_check("кэш ближнего вида: кадр легче", first["cached_ms"] < 0.8 * first["direct_ms"],
			"%d мс с кэшем, %d мс без него" % [first["cached_ms"], first["direct_ms"]])
	# Проезд: камера идёт шагами, кэш досчитывается понемногу — окна сдвигаются, не успев достроиться.
	_terrain.cache_budget = 1500000
	var view := near_view.copy()
	# Едем вглубь острова, чтобы в кадре осталась земля.
	var step := (_world.land_rect.get_center() - view.focus).normalized() * 14.0
	for i in 22:
		view.focus += step
		_rig.set_view(view)
		await _frames(2)
	_terrain.cache_budget = 40000000
	await _warm_cache()
	var second := await _cache_against_direct("92-kesh-posle-proezda")
	_check("кэш ближнего вида: после проезда камеры картинка та же", second["mean"] < 5.0 and second["far"] < 0.01,
			"среднее отличие %.2f из 255, заметно отличается %.2f %% точек; посчитано клеток %.0f млн" % [second["mean"], 100.0 * second["far"], float(_terrain.cache().cells_done) / 1.0e6])
	# Сколько стоит само обслуживание кэша на процессоре (без счёта клеток): камера стоит и камера летит.
	var eye := _rig.camera.global_position
	var focus := _rig.current_focus()
	var pixel := _rig.pixel_size(float(get_window().size.y))
	var started := Time.get_ticks_usec()
	for i in 400:
		_terrain.update_cache(eye, focus, pixel, 0.016)
	var resting := float(Time.get_ticks_usec() - started) / 400.0
	started = Time.get_ticks_usec()
	for i in 400:
		_terrain.update_cache(eye + Vector3(40.0 * float(i), 0.0, 0.0), focus + Vector2(40.0 * float(i), 0.0), pixel, 0.016)
	var flying := float(Time.get_ticks_usec() - started) / 400.0
	print("КЭШ: обслуживание на процессоре — %.0f мкс на кадр, когда камера стоит, %.0f мкс в полёте" % [resting, flying])
	_terrain.cache_budget = budget
	get_viewport().scaling_3d_scale = scale
	await _frames(2)


## Кадр с кэшем и тот же кадр прямым расчётом: насколько отличаются (среднее по наибольшему из трёх цветов, из 255;
## доля точек с отличием больше 60) и сколько считались. Оба кадра кладутся в папку под именем file_name.
func _cache_against_direct(file_name: String) -> Dictionary:
	var cached_ms := await _frame_cost(2)
	await RenderingServer.frame_post_draw
	var cached := get_viewport().get_texture().get_image()
	_terrain.cache().reading = false
	var direct_ms := await _frame_cost(2)
	await RenderingServer.frame_post_draw
	var direct := get_viewport().get_texture().get_image()
	_terrain.cache().reading = true
	# Оба кадра сохраняются: их можно сравнить глазами.
	cached.save_png(_folder.path_join(file_name + "-s-keshem.png"))
	direct.save_png(_folder.path_join(file_name + "-napryamuyu.png"))
	await _frames(1)
	var total := 0.0
	var far := 0
	var count := 0
	# Надписи по углам в счёт не идут (счётчик кадров меняется от кадра к кадру).
	for y in range(120, direct.get_height() - 70, 3):
		for x in range(8, direct.get_width() - 8, 3):
			var a := cached.get_pixel(x, y)
			var b := direct.get_pixel(x, y)
			var difference := 255.0 * maxf(absf(a.r - b.r), maxf(absf(a.g - b.g), absf(a.b - b.b)))
			total += difference
			if difference > 60.0:
				far += 1
			count += 1
	return {"mean": total / float(count), "far": float(far) / float(count), "cached_ms": cached_ms, "direct_ms": direct_ms}


## Вода (шаг 1.5): она движется — кадр через три секунды её времени другой, а при том же времени тот же (кадры
## проверок повторимы); шторм приходит плавно — ни на одном шаге перехода кадр не меняется рывком.
func _check_water(stops: Array[Tour.Stop]) -> void:
	var light := _find_light()
	var place: Tour.Stop = null
	for stop in stops:
		if stop.name.substr(3) == "bereg":
			place = stop
	if light == null or place == null:
		return
	var scale := get_viewport().scaling_3d_scale
	get_viewport().scaling_3d_scale = 0.25
	_rig.set_view(place.view)
	await _frames(8)
	var first := await _frame_picture()
	_terrain.set_water_time(WaterLook.SHOT_TIME + 3.0)
	await _frames(2)
	var later := await _frame_picture()
	_terrain.set_water_time(WaterLook.SHOT_TIME)
	await _frames(2)
	var again := await _frame_picture()
	var moved := _picture_difference(first, later)
	var same := _picture_difference(first, again)
	_check("вода: движется, а при том же времени кадр тот же", moved > 0.15 and same < 0.05,
			"среднее отличие кадра через 3 с — %.2f из 255, при том же времени — %.3f" % [moved, same])
	# Накат: у берега вода стоит выше или ниже обычного уреза — кадр с накатом отличается от кадра без него
	# (время воды то же: рябь и пена на местах, разница только в том, где сейчас кромка воды). Смотрим два места
	# у порта: на обрывистом берегу кромка почти не ходит.
	var swash_shift := 0.0
	var swash_views: Array[CameraView] = []
	for stop in stops:
		if stop.name.substr(3) == "bereg":
			# Кромка воды ближе всего к порту: с гексом в километр сам порт стоит в сотнях метров от берега.
			var shore := _shore_near(stop.view.focus)
			swash_views.append(CameraView.make(shore, 220.0, 0.0, 0.0))
			swash_views.append(CameraView.make(shore, 220.0, 120.0, 0.0))
	for view in swash_views:
		_rig.set_view(view)
		await _frames(8)
		var with_swash := await _frame_picture()
		_terrain.set_water_tuning(WaterLook.SPEED, Vector2.ZERO)
		await _frames(2)
		var without := await _frame_picture()
		_terrain.set_water_tuning(WaterLook.SPEED, WaterLook.SWASH)
		swash_shift = maxf(swash_shift, _picture_difference(with_swash, without))
	_check("вода: накат ходит по берегу", swash_shift > 0.15, "кадр у берега с накатом и без него отличается на %.2f из 255" % swash_shift)
	await _check_swash_closed("")
	_rig.set_view(place.view)
	await _frames(4)
	# Шторм набирает силу за двадцать шагов: свет, небо, облака, дождь и вода меняются вместе.
	var weather := _find_weather()
	var last := await _frame_brightness()
	var calm := last
	var last_picture := first
	var jump := 0.0
	var change := 0.0
	for i in 20:
		weather.show_blend(Weather.Kind.CLEAR, Weather.Kind.STORM, float(i + 1) / 20.0)
		await _frames(2)
		var picture := await _frame_picture()
		var now := await _frame_brightness()
		jump = maxf(jump, absf(now - last))
		change = maxf(change, _picture_difference(last_picture, picture))
		last = now
		last_picture = picture
	var whole_change := _picture_difference(first, last_picture)
	_check("вода: шторм приходит плавно", jump < 0.35 * maxf(absf(calm - last), 0.01) and change < 0.35 * whole_change,
			"яркость кадра %.2f → %.2f, самый большой шаг %.3f; картинка за весь переход меняется на %.1f из 255, за шаг — не больше %.1f"
			% [calm, last, jump, whole_change, change])
	await _capture("95-shtorm")
	weather.set_kind(Weather.Kind.CLEAR, true)
	await _frames(8)
	get_viewport().scaling_3d_scale = scale


## Ближайшая к точке кромка моря: идём от точки по шестнадцати направлениям, пока суша не сменится водой.
func _shore_near(point: Vector2) -> Vector2:
	var best := point
	var best_away := INF
	for i in 16:
		var heading := Vector2.from_angle(TAU * float(i) / 16.0)
		for step in range(1, 150):
			var at := point + heading * (10.0 * float(step))
			if _terrain.height_map.sample(at) < 0.2:
				if float(step) * 10.0 < best_away:
					best_away = float(step) * 10.0
					best = at
				break
	return best


## Море не появляется там, куда ему хода нет: над самой низкой сушей, закрытой для наката (дно глубокого озера и
## ложбина за берегом вне озёр), кадр с накатом и без него один и тот же — в восемь моментов времени воды, чтобы
## застать гребень волны. Сравнивается только середина кадра — сама точка: рядом с ложбиной бывает пляж, где накату
## место. Накат для проверки в полтора раза выше обычного. Вода озёр на время проверки спрятана: под ней воды моря
## быть не должно, а видно её было не с любой стороны (так пятна на озёрах в 0.7.4 прошли мимо кадров проверок).
## В ложбине заодно меряется, что было бы без маски наката: так видно, что проверка смотрит в нужное место. Сопрограмма.
func _check_swash_closed(prefix: String) -> void:
	if _terrain.swash_closed <= 0.0:
		print("НАКАТ %sсуши ниже высоты наката, закрытой для моря, нет" % prefix)
		return
	var scale := get_viewport().scaling_3d_scale
	get_viewport().scaling_3d_scale = 0.25
	_terrain.set_lakes_visible(false)
	var leak := await _swash_difference(_terrain.swash_closed_place)
	var detail := "закрыто для моря %d м² суши ниже высоты наката; над самой низкой точкой (x=%d z=%d, %.2f м) кадр с накатом и без него отличается на %.3f из 255" \
			% [roundi(_terrain.swash_closed), roundi(_terrain.swash_closed_place.x), roundi(_terrain.swash_closed_place.y),
			_terrain.swash_closed_height, leak]
	if _terrain.swash_hollow_height < INF:
		var in_hollow := await _swash_difference(_terrain.swash_hollow_place)
		_terrain.set_swash_mask_enabled(false)
		var unmasked := await _swash_difference(_terrain.swash_hollow_place)
		_terrain.set_swash_mask_enabled(true)
		leak = maxf(leak, in_hollow)
		detail += "; над самой низкой ложбиной вне озёр (x=%d z=%d, %.2f м) — на %.3f, а без маски наката было бы %.3f" \
				% [roundi(_terrain.swash_hollow_place.x), roundi(_terrain.swash_hollow_place.y), _terrain.swash_hollow_height,
				in_hollow, unmasked]
	else:
		detail += "; ложбин вне озёр нет"
	_terrain.set_water_time(WaterLook.SHOT_TIME)
	_terrain.set_lakes_visible(true)
	_check("%sвода: море не появляется в озёрах и ложбинах за берегом" % prefix, leak < 0.05, detail)
	await _frames(2)
	get_viewport().scaling_3d_scale = scale


## Самое большое за восемь моментов времени воды отличие кадра с накатом (в полтора раза выше обычного) от кадра
## без него — вид сверху на место, в счёт идёт только середина кадра: несколько метров вокруг самой точки.
func _swash_difference(place: Vector2) -> float:
	_rig.set_view(CameraView.make(place, 120.0, 0.0, 30.0))
	await _frames(8)
	var most := 0.0
	for i in 8:
		_terrain.set_water_time(WaterLook.SHOT_TIME + float(i) * 1.25)
		_terrain.set_water_tuning(WaterLook.SPEED, WaterLook.SWASH * 1.5)
		await _frames(2)
		var with_swash := await _frame_picture()
		_terrain.set_water_tuning(WaterLook.SPEED, Vector2.ZERO)
		await _frames(2)
		var without := await _frame_picture()
		var centre := Vector2i(with_swash.get_width(), with_swash.get_height()) / 2
		var total := 0.0
		var count := 0
		for y in range(centre.y - 24, centre.y + 25, 4):
			for x in range(centre.x - 24, centre.x + 25, 4):
				var one := with_swash.get_pixel(x, y)
				var two := without.get_pixel(x, y)
				total += 255.0 * maxf(absf(one.r - two.r), maxf(absf(one.g - two.g), absf(one.b - two.b)))
				count += 1
		most = maxf(most, total / float(count))
	_terrain.set_water_tuning(WaterLook.SPEED, WaterLook.SWASH)
	return most


## Кадр как картинка — для сравнения кадров между собой.
func _frame_picture() -> Image:
	await RenderingServer.frame_post_draw
	return get_viewport().get_texture().get_image()


## Среднее отличие двух кадров, единиц из 255; надписи по краям в счёт не идут.
func _picture_difference(a: Image, b: Image) -> float:
	var total := 0.0
	var count := 0
	for y in range(120, a.get_height() - 70, 6):
		for x in range(8, a.get_width() - 8, 6):
			var one := a.get_pixel(x, y)
			var two := b.get_pixel(x, y)
			total += 255.0 * maxf(absf(one.r - two.r), maxf(absf(one.g - two.g), absf(one.b - two.b)))
			count += 1
	return total / float(maxi(count, 1))


## Погода (шаг 1.6): облака идут по небу — кадр со сдвинутыми облаками другой, а с возвращёнными тот же;
## облака стоят на своей высоте и сверху не закрывают карту; море у горизонта переходит в небо без линии; шторм виден и без струй
## дождя (критерий владельца 12.11); молния видна и гаснет без следа. Плавный приход шторма (с тучами и дождём)
## проверяет _check_water.
func _check_weather(stops: Array[Tour.Stop]) -> void:
	var weather := _find_weather()
	var place: Tour.Stop = null
	for stop in stops:
		if stop.name.substr(3) == "sverhu":
			place = stop
	if weather == null or place == null:
		return
	var scale := get_viewport().scaling_3d_scale
	get_viewport().scaling_3d_scale = 0.25
	# Облака идут по небу: взгляд к горизонту, облака сдвинуты по ветру — кадр другой, вернулись — тот же.
	_rig.set_view(CameraView.make(place.view.focus, 9000.0, 0.0, -54.0))
	await _frames(8)
	var first := await _frame_picture()
	weather.push_clouds(900.0)
	await _frames(2)
	var moved := await _frame_picture()
	weather.push_clouds(-900.0)
	await _frames(2)
	var back := await _frame_picture()
	var shift := _picture_difference(first, moved)
	var same := _picture_difference(first, back)
	_check("погода: облака идут по небу", shift > 0.15 and same < 0.05,
			"кадр с облаками, ушедшими на 900 м, отличается на %.2f из 255; с возвращёнными — на %.3f" % [shift, same])

	# Облака стоят в мире на своей высоте (задание владельца 13.11): у земли камера под ними, с самой большой
	# высоты — над ними; и сверху они не закрывают карту — кадр с высоты с облаками и без них отличается мало.
	var camera := get_viewport().get_camera_3d()
	_rig.set_view(CameraView.make(place.view.focus, StrategyCamera.MIN_DISTANCE, 0.0, 0.0))
	await _frames(4)
	var low_gap := weather.cloud_base() - camera.global_position.y
	_rig.set_view(CameraView.make(place.view.focus, 100000.0, 0.0, 0.0))
	await _frames(6)
	var high_eye := camera.global_position.y
	var high_gap := high_eye - weather.cloud_base()
	var with_clouds := await _frame_picture()
	weather.set_clouds_shown(false)
	await _frames(4)
	var without_clouds := await _frame_picture()
	weather.set_clouds_shown(true)
	var hidden := _picture_difference(with_clouds, without_clouds)
	_check("погода: облака стоят на своей высоте и сверху не закрывают карту", low_gap > 900.0 and high_gap > 900.0 and hidden < 12.0,
			"у земли низ облаков выше камеры на %d м; с самой большой высоты камера выше него на %d м; кадр с высоты с облаками и без них отличается на %.2f из 255" % [
			roundi(low_gap), roundi(high_gap), hidden])

	# Море у горизонта переходит в небо без линии: строки кадра чуть ниже и чуть выше горизонта — одного цвета.
	# Смотрим в открытое море от края мира (с гексом в километр за лугом у горизонта стоит суша): из четырёх
	# сторон берётся та, где на луче взгляда нет земли.
	var far_view := CameraView.make(place.view.focus, 9000.0, 0.0, -54.0)
	# Взгляд — на шесть градусов ниже горизонта, камера на высоте около километра (как в этой проверке до 0.10.0):
	# с малой высоты горизонт близко, и море у него ещё не тонет в дымке.
	var low_tilt := 6.0 - rad_to_deg(_rig._auto_pitch(9000.0))
	var content := _world.content_rect
	var sides: Array = []
	for edge: Vector2 in [Vector2(content.get_center().x, content.end.y), Vector2(content.get_center().x, content.position.y),
			Vector2(content.end.x, content.get_center().y), Vector2(content.position.x, content.get_center().y)]:
		for turn: float in [0.0, 90.0, 180.0, -90.0]:
			sides.append([edge, turn])
	for side: Array in sides:
		var view := CameraView.make(side[0], 9000.0, side[1], low_tilt)
		_rig.set_view(view)
		await _frames(1)
		var eye := camera.global_position
		var ahead := -camera.global_transform.basis.z
		ahead = Vector3(ahead.x, 0.0, ahead.z).normalized()
		var land_ahead := false
		# Взгляд должен уходить от суши: если он смотрит на мир, а не от него, — на луче будет земля.
		for step in 400:
			var at := eye + ahead * (200.0 * float(step))
			if _terrain.height_map.sample(Vector2(at.x, at.z)) > 0.5:
				land_ahead = true
				break
		if not land_ahead:
			far_view = view
			break
	_rig.set_view(far_view)
	await _frames(8)
	var clear := await _frame_picture()
	if not _folder.is_empty():
		clear.save_png(_folder.path_join("97-gorizont.png"))
	print("ГОРИЗОНТ: вид %s, камера на высоте %.0f м" % [far_view.to_code(), camera.global_position.y])
	var forward := -camera.global_transform.basis.z
	var horizon := camera.unproject_position(camera.global_position + Vector3(forward.x, 0.0, forward.z).normalized() * 90000.0 - Vector3(0.0, camera.global_position.y, 0.0))
	var line := clampi(roundi(horizon.y), 40, clear.get_height() - 40)
	var step_at_horizon := 0.0
	var samples := 0
	for x in range(clear.get_width() / 5, clear.get_width() * 4 / 5, 16):
		var above := clear.get_pixel(x, line - 10)
		var below := clear.get_pixel(x, line + 10)
		step_at_horizon += 255.0 * maxf(absf(above.r - below.r), maxf(absf(above.g - below.g), absf(above.b - below.b)))
		samples += 1
	step_at_horizon /= float(maxi(samples, 1))
	_check("погода: море у горизонта переходит в небо без линии", step_at_horizon < 9.0,
			"в ясный день цвет на 10 точек выше и ниже горизонта отличается на %.1f из 255 (в 0.8.0 было около 60)" % step_at_horizon)

	# Шторм виден и без струй дождя: по тучам, свету, морю и видимости (критерий владельца).
	weather.set_kind(Weather.Kind.STORM, true)
	await _frames(8)
	var storm := await _frame_picture()
	weather.set_drops_shown(false)
	await _frames(2)
	var storm_dry := await _frame_picture()
	var storm_reads := _picture_difference(clear, storm_dry)
	var drops_part := _picture_difference(storm, storm_dry)
	_check("погода: шторм виден и без струй дождя", storm_reads > 25.0 and drops_part < 0.2 * storm_reads,
			"кадр шторма без струй отличается от ясного на %.1f из 255; сами струи меняют кадр на %.2f" % [storm_reads, drops_part])
	weather.set_drops_shown(true)

	# Молния: разряд виден в кадре, а после него кадр прежний.
	weather.show_strike(0)
	await _frames(2)
	var struck := await _frame_picture()
	weather.hide_strike()
	await _frames(2)
	var after := await _frame_picture()
	var flash := _picture_difference(storm, struck)
	var trace := _picture_difference(storm, after)
	_check("погода: молния видна и гаснет без следа", flash > 1.0 and trace < 0.05,
			"кадр с разрядом отличается от кадра без него на %.1f из 255; после разряда — на %.3f" % [flash, trace])
	weather.set_kind(Weather.Kind.CLEAR, true)
	await _frames(8)
	get_viewport().scaling_3d_scale = scale


## Растительность (шаг 1.8): посажена, стоит на суше, при том же мире — та же; на ветру качается, в шторм сильнее.
func _check_flora(world: WorldData, terrain: WorldTerrain) -> void:
	var flora: Flora = null
	for node in get_tree().root.find_children("*", "Flora", true, false):
		flora = node
	var weather := _find_weather()
	if flora == null or weather == null:
		return
	# Растительность сажается плитками вокруг камеры, в фоновых потоках, понемногу за кадр (в кадрах проверок —
	# сразу вся: flora.instant). Встаём над самой густой рощей и смотрим, что посадка по кадрам доходит до конца.
	var scale := get_viewport().scaling_3d_scale
	get_viewport().scaling_3d_scale = 0.25
	flora.instant = false
	flora.reset()
	_rig.set_view(CameraView.make(flora.densest, 900.0, -90.0, 0.0))
	var waited := 0
	await _frames(2)
	while flora.is_busy() and waited < 3000:
		await _frames(1)
		waited += 1
	_check("растительность: сажается вокруг камеры по кадрам", not flora.is_busy() and waited > 0,
			"посадка закончилась за %d кадров" % waited)
	flora.instant = true
	var trees := 0
	for kind in 6:
		trees += flora.counts[kind]
	_check("растительность: посажена вокруг камеры и стоит на суше", trees > 2000 and flora.lowest >= 0.6,
			"%s; самая низкая точка — %.2f м над морем" % [flora.summary(), flora.lowest])
	# Тот же мир — тот же лес: сажаем заново и сверяем отпечаток деревьев.
	var before := flora.tree_fingerprint()
	var counted := flora.counts.duplicate()
	flora.reset()
	flora.settle()
	_check("растительность: при том же мире та же", flora.tree_fingerprint() == before and flora.counts == counted,
			"отпечаток расстановки %d и %d" % [before, flora.tree_fingerprint()])
	# С высоты, где дерево меньше точки экрана, плиток нет: лес — это цвет земли; при возврате он сажается снова.
	_rig.set_view(CameraView.make(flora.densest, 9000.0, -90.0, 0.0))
	await _frames(3)
	flora.settle()
	var high_trees := 0
	for kind in 6:
		high_trees += flora.counts[kind]
	_check("растительность: с высоты деревья убраны (лес — цвет земли)", high_trees == 0, "деревьев в мире с высоты 9 км: %d" % high_trees)
	# Ветер: кадр рощи меняется со временем ветра, а при том же времени он тот же; в шторм качает сильнее.
	get_viewport().scaling_3d_scale = 0.5
	_rig.set_view(CameraView.make(flora.densest, 180.0, -90.0, -20.0))
	await _frames(3)
	flora.settle()
	await _frames(8)
	var still := await _frame_picture()
	weather.push_wind(1.7)
	await _frames(2)
	var swayed := await _frame_picture()
	weather.push_wind(-1.7)
	await _frames(2)
	var back := await _frame_picture()
	var sway := _picture_difference(still, swayed)
	var same := _picture_difference(still, back)
	weather.set_kind(Weather.Kind.STORM, true)
	weather.set_drops_shown(false)
	await _frames(6)
	var storm_still := await _frame_picture()
	weather.push_wind(1.7)
	await _frames(2)
	var storm_swayed := await _frame_picture()
	weather.push_wind(-1.7)
	var storm_sway := _picture_difference(storm_still, storm_swayed)
	weather.set_drops_shown(true)
	weather.set_kind(Weather.Kind.CLEAR, true)
	await _frames(6)
	_check("растительность: качается на ветру, в шторм сильнее", sway > 0.3 and same < 0.05 and storm_sway > sway * 1.3,
			"кадр самой густой рощи (%.0f, %.0f) через 1,7 с ветра отличается на %.2f из 255 (при том же времени — на %.3f); в шторм — на %.2f" % [
			flora.densest.x, flora.densest.y, sway, same, storm_sway])
	get_viewport().scaling_3d_scale = scale


func _find_weather() -> Weather:
	for node in get_tree().root.find_children("*", "Weather", true, false):
		return node
	return null


func _find_light() -> DayLight:
	for node in get_tree().root.find_children("*", "DayLight", true, false):
		return node
	return null


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
	get_viewport().scaling_3d_scale = render_scale
	await _frames(1)
	await _warm_cache()
	var started := Time.get_ticks_msec()
	await _frames(1)
	_frame_msec = Time.get_ticks_msec() - started


## Ждём, пока кэш ближнего вида вокруг камеры досчитается (если он включён: ключ --cache).
func _warm_cache() -> void:
	if _terrain.cache_budget <= 0:
		return
	var pixel := _rig.pixel_size(float(get_window().size.y) * get_viewport().scaling_3d_scale)
	var started := Time.get_ticks_msec()
	var frames := 0
	while not _terrain.cache_ready(pixel) and frames < 40:
		await _frames(1)
		frames += 1
	# Ещё кадр: посчитанное в последнем кадре читается со следующего.
	await _frames(2)
	print("КЭШ: %s за %d кадров и %d мс (уровни: %s; память %.0f МБ)" % ["готов" if _terrain.cache_ready(pixel) else "НЕ ГОТОВ",
			frames, Time.get_ticks_msec() - started, _terrain.cache().progress(), _terrain.cache().memory_mb()])


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
		var expected := top.z * islet.height_scale() * HexMath.WORLD_SCALE
		var summit := _terrain.height_map.sample(islet.to_world(Vector2(top.x, top.y)))
		var sea := _terrain.height_map.sample(islet.position + Vector2(islet.reach() * 1.05 + 180.0 * HexMath.WORLD_SCALE, 0.0))
		if summit > 1.5 and absf(summit - expected) < 17.0 + expected * 0.05 and sea < 0.0:
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
			"sea": islet.position + Vector2(islet.reach() * 1.05 + 120.0 * HexMath.WORLD_SCALE, 0.0),
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
