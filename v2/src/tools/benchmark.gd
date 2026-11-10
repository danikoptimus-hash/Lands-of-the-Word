class_name Benchmark
extends Node
## Замер скорости (клавиша F5): камера сама облетает мир, программа считает кадры в секунду
## и собирает отчёт о компьютере. Отчёт копируется в буфер обмена — его можно вставить в чат.

signal finished(report: String)

const WARMUP_FRAMES := 12

var running := false
var time_scale := 1.0  ## меньше единицы — короче облёт (так конвейер проверяет сам замер)


## Сопрограмма.
func run(world: WorldData, rig: StrategyCamera) -> void:
	if running:
		return
	running = true
	rig.input_enabled = false
	var vsync := DisplayServer.window_get_vsync_mode()
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	var saved := rig.get_view()

	var stops := Tour.stops(world, rig)
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

	DisplayServer.window_set_vsync_mode(vsync)
	rig.set_view(saved)
	rig.input_enabled = true
	running = false
	finished.emit(_report(all_ms, lines))


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
	text.append("Экран: %d×%d, %d Гц; окно %d×%d" % [screen.x, screen.y, roundi(DisplayServer.screen_get_refresh_rate()), window.x, window.y])
	text.append("Кадров в секунду: в среднем %d, 1%% худших %d, самый долгий кадр — %d" % [roundi(_fps(frames_ms)), roundi(low), roundi(slowest)])
	text.append("По участкам облёта:")
	text.append_array(legs)
	return "\n".join(text)
