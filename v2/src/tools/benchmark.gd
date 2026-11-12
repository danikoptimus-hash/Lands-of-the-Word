class_name Benchmark
extends Node
## Замер скорости (клавиша F5): камера сама облетает мир, программа считает кадры в секунду
## и собирает отчёт о компьютере. Отчёт копируется в буфер обмена — его можно вставить в чат.
##
## В конце — «разбор»: в нескольких местах облёта кадры считаются ещё по разу без одной из частей картинки
## (без материалов земли, без теней, без сглаживания краёв, в половине разрешения). Насколько от этого растёт
## скорость — столько эта часть и стоит на этом компьютере. Без разбора о скорости у игрока приходилось гадать:
## в рабочей среде картинку считает процессор, и доли там другие.

signal finished(report: String)

const WARMUP_FRAMES := 12
const BREAKDOWN_SECONDS := 1.2
## Где делается разбор — имена мест облёта без номера: самое тяжёлое вблизи, самое близкое приближение,
## взгляд сверху с рабочей высоты стратегии и остров целиком.
const BREAKDOWN_STOPS: Array[String] = ["gory-vblizi", "veshka", "sverhu", "ostrov-ot"]

var running := false
var time_scale := 1.0  ## меньше единицы — короче облёт (так конвейер проверяет сам замер)


## Сопрограмма.
func run(world: WorldData, rig: StrategyCamera, height_map: HeightMap = null, terrain: WorldTerrain = null,
		sun: DirectionalLight3D = null) -> void:
	if running:
		return
	running = true
	rig.input_enabled = false
	var vsync := DisplayServer.window_get_vsync_mode()
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	var saved := rig.get_view()

	var stops := Tour.stops(world, rig, height_map)
	var all_ms := PackedFloat32Array()
	var lines := PackedStringArray()
	rig.set_view(stops[0].view)
	for i in WARMUP_FRAMES:
		await get_tree().process_frame

	for i in range(1, stops.size()):
		var from := stops[i - 1].view
		var to := stops[i].view
		var leg_ms := PackedFloat32Array()
		var leg_seconds := stops[i].seconds * time_scale
		var elapsed := 0.0
		var last := Time.get_ticks_usec()
		while elapsed < leg_seconds:
			var weight := elapsed / leg_seconds
			var eased := weight * weight * (3.0 - 2.0 * weight)
			rig.set_view(CameraView.blend(from, to, eased))
			await get_tree().process_frame
			var now := Time.get_ticks_usec()
			var frame_ms := float(now - last) / 1000.0
			last = now
			elapsed += frame_ms / 1000.0
			leg_ms.append(frame_ms)
			all_ms.append(frame_ms)
		lines.append("  %s: %d к/с" % [stops[i].title, roundi(_fps(leg_ms))])

	if terrain != null and sun != null:
		var breakdown: PackedStringArray = await _breakdown(stops, rig, terrain, sun)
		if not breakdown.is_empty():
			lines.append("Разбор, к/с: как есть → земля ровным цветом / без теней / без сглаживания / пол-разрешения")
			lines.append_array(breakdown)

	DisplayServer.window_set_vsync_mode(vsync)
	rig.set_view(saved)
	rig.input_enabled = true
	running = false
	finished.emit(_report(all_ms, lines))


## Разбор по частям картинки (см. начало файла). Сопрограмма; всё изменённое возвращается как было.
func _breakdown(stops: Array[Tour.Stop], rig: StrategyCamera, terrain: WorldTerrain, sun: DirectionalLight3D) -> PackedStringArray:
	var lines := PackedStringArray()
	var viewport := get_viewport()
	var msaa := viewport.msaa_3d
	var scale := viewport.scaling_3d_scale
	var shadows := sun.shadow_enabled
	# В короткой проверке (конвейер, программная отрисовка) — одно место.
	var endings := BREAKDOWN_STOPS if time_scale > 0.5 else BREAKDOWN_STOPS.slice(0, 1)
	for ending in endings:
		var stop: Tour.Stop = null
		for candidate in stops:
			if candidate.name.substr(3) == ending:
				stop = candidate
				break
		if stop == null:
			continue
		rig.set_view(stop.view)
		var as_is: float = await _fps_now()
		terrain.set_flat(true)
		var flat: float = await _fps_now()
		terrain.set_flat(false)
		sun.shadow_enabled = false
		var no_shadows: float = await _fps_now()
		sun.shadow_enabled = shadows
		viewport.msaa_3d = Viewport.MSAA_DISABLED
		var no_msaa: float = await _fps_now()
		viewport.msaa_3d = msaa
		viewport.scaling_3d_scale = scale * 0.5
		var half: float = await _fps_now()
		viewport.scaling_3d_scale = scale
		lines.append("  %s: %d → %d / %d / %d / %d" % [stop.title, roundi(as_is), roundi(flat), roundi(no_shadows), roundi(no_msaa), roundi(half)])
	return lines


## Кадров в секунду прямо сейчас: несколько кадров на разгон (после смены настройки видеокарта собирает шейдеры —
## это не должно попасть в счёт), потом счёт. Сопрограмма.
func _fps_now() -> float:
	var short := time_scale < 0.5
	var warm_frames := 1 if short else 4
	var warm_until := Time.get_ticks_usec() + (0 if short else 300000)
	while warm_frames > 0 or Time.get_ticks_usec() < warm_until:
		await get_tree().process_frame
		warm_frames -= 1
	var need := 1 if short else 3
	var frames := 0
	var start := Time.get_ticks_usec()
	var until := start + (0 if short else int(BREAKDOWN_SECONDS * 1.0e6))
	while frames < need or Time.get_ticks_usec() < until:
		await get_tree().process_frame
		frames += 1
	return 1.0e6 * float(frames) / maxf(float(Time.get_ticks_usec() - start), 1.0)


static func _fps(frames_ms: PackedFloat32Array) -> float:
	if frames_ms.is_empty():
		return 0.0
	var total := 0.0
	for value in frames_ms:
		total += value
	return 1000.0 * float(frames_ms.size()) / maxf(total, 0.001)


func _report(frames_ms: PackedFloat32Array, legs: PackedStringArray) -> String:
	if frames_ms.is_empty():
		return "Замер не удался: кадров нет."
	var sorted := frames_ms.duplicate()
	sorted.sort()
	var worst_from := mini(floori(float(sorted.size()) * 0.99), sorted.size() - 1)
	var worst_total := 0.0
	for i in range(worst_from, sorted.size()):
		worst_total += sorted[i]
	var low := 1000.0 / maxf(worst_total / float(sorted.size() - worst_from), 0.001)
	var slowest := 1000.0 / maxf(sorted[sorted.size() - 1], 0.001)

	var memory: Dictionary = OS.get_memory_info()
	var memory_gb := float(int(memory.get("physical", 0))) / 1073741824.0
	var screen := DisplayServer.screen_get_size()
	var window := DisplayServer.window_get_size()
	var text := PackedStringArray()
	text.append("Земли Слова, %s — замер скорости" % BuildInfo.label())
	text.append("Система: %s %s" % [OS.get_name(), OS.get_version()])
	text.append("Процессор: %s, потоков: %d" % [OS.get_processor_name(), OS.get_processor_count()])
	text.append("Память: %.1f ГБ" % memory_gb)
	text.append("Видеокарта: %s" % RenderingServer.get_video_adapter_name())
	text.append("Отрисовка: %s, %s" % [RenderingServer.get_current_rendering_driver_name(), RenderingServer.get_current_rendering_method()])
	var refresh := DisplayServer.screen_get_refresh_rate()
	var screen_text := "%d×%d" % [screen.x, screen.y]
	if is_finite(refresh) and refresh > 0.0:
		screen_text += ", %d Гц" % roundi(refresh)
	text.append("Экран: %s; окно %d×%d" % [screen_text, window.x, window.y])
	var scale := get_viewport().scaling_3d_scale
	if scale < 0.999:
		text.append("Картинка мира считается в %d %% разрешения (клавиша B)" % roundi(scale * 100.0))
	text.append("Кадров в секунду: в среднем %d, в худшем 1%% кадров — %d, в самом медленном кадре — %d" % [roundi(_fps(frames_ms)), roundi(low), roundi(slowest)])
	text.append("По участкам облёта:")
	text.append_array(legs)
	return "\n".join(text)
