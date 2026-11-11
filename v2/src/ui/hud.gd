class_name Hud
extends CanvasLayer
## Надписи тестовой сборки: версия, подсказки по управлению, сообщения, отчёт замера.
## Это временная служебная оболочка; интерфейс игры — шаг 3.2 дорожной карты.

const INK := Color(0.95, 0.92, 0.86)
const INK_DIM := Color(0.95, 0.92, 0.86, 0.72)
const ACCENT := Color(0.89, 0.72, 0.42)
const PANEL := Color(0.09, 0.08, 0.07, 0.8)
const PANEL_EDGE := Color(0.89, 0.72, 0.42, 0.28)

const HELP_ROWS := [
	["Левая кнопка мыши", "взять землю и тянуть"],
	["Колесо", "приблизить или отдалить место под курсором"],
	["Правая кнопка мыши", "повернуть и наклонить камеру — вплоть до горизонта и неба"],
	["Двойной щелчок", "подлететь к месту"],
	["W A S D или стрелки", "двигаться; с Shift — быстрее"],
	["Q и E", "повернуть камеру"],
	["R и F", "наклонить камеру"],
	["+ и −", "приблизить и отдалить"],
	["Пробел", "весь мир"],
	["1 и 2", "острова «Ветхий Завет» и «Новый Завет»"],
	["N", "север вверху"],
	["G", "сетка гексов"],
	["C", "вешки городов"],
	["M", "другая карта: «Осень» и карты, собранные генератором игры"],
	["F2", "снимок экрана и код места"],
	["F5", "замер скорости"],
	["F9", "проверить, нет ли новой сборки"],
	["F11", "во весь экран"],
	["Esc", "закрыть подсказку или выйти из полного экрана"],
]

var _text_font: Font
var _bold_font: Font
var _title_font: Font

var _root: Control
var _frame: MarginContainer
var _fps: Label
var _help: PanelContainer
var _toast: PanelContainer
var _toast_label: Label
var _toast_left := 0.0
var _loading: PanelContainer
var _loading_label: Label
var _report: PanelContainer
var _report_label: Label
var _fps_timer := 0.0


func _ready() -> void:
	layer = 10
	_text_font = _load_font("res://assets/fonts/literata-400-cyrillic.woff2", "res://assets/fonts/literata-400-latin.woff2")
	_bold_font = _load_font("res://assets/fonts/literata-600-cyrillic.woff2", "res://assets/fonts/literata-600-latin.woff2")
	_title_font = _load_font("res://assets/fonts/philosopher-700-cyrillic.woff2", "res://assets/fonts/philosopher-700-latin.woff2")

	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)

	# Рамка с полями: надписи сами встают по углам и по центру и подстраиваются под размер окна и текста.
	_frame = MarginContainer.new()
	_frame.set_anchors_preset(Control.PRESET_FULL_RECT)
	_frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_frame.add_theme_constant_override("margin_left", 20)
	_frame.add_theme_constant_override("margin_right", 20)
	_frame.add_theme_constant_override("margin_top", 18)
	_frame.add_theme_constant_override("margin_bottom", 18)
	_root.add_child(_frame)

	_build_title()
	_build_hint()
	_build_fps()
	_build_help()
	_build_toast()
	_build_loading()
	_build_report()


func _process(delta: float) -> void:
	_fps_timer -= delta
	if _fps_timer <= 0.0:
		_fps_timer = 0.5
		_fps.text = "%d к/с" % roundi(Engine.get_frames_per_second())
	if _toast.visible:
		_toast_left -= delta
		_toast.modulate.a = clampf(_toast_left / 0.4, 0.0, 1.0)
		if _toast_left <= 0.0:
			_toast.visible = false


# ── Что умеет ────────────────────────────────────────────────────────────────

func toggle_help() -> void:
	_help.visible = not _help.visible


func is_help_open() -> bool:
	return _help.visible


func set_help_open(open: bool) -> void:
	_help.visible = open


## Короткое сообщение внизу экрана.
func toast(text: String, seconds: float = 4.0) -> void:
	_toast_label.text = text
	_toast_left = seconds
	_toast.modulate.a = 1.0
	_toast.visible = true


## Надпись по центру, пока мир строится; пустая строка убирает её.
func set_loading(text: String) -> void:
	_loading_label.text = text
	_loading.visible = not text.is_empty()


func show_report(text: String) -> void:
	_report_label.text = text
	_report.visible = true


func is_report_open() -> bool:
	return _report.visible


func close_report() -> void:
	_report.visible = false


func set_overlay_visible(shown: bool) -> void:
	_root.visible = shown


# ── Сборка надписей ──────────────────────────────────────────────────────────

func _build_title() -> void:
	var box := _panel(Control.SIZE_SHRINK_BEGIN, Control.SIZE_SHRINK_BEGIN)
	var column := VBoxContainer.new()
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_theme_constant_override("separation", 0)
	box.add_child(column)
	column.add_child(_label("Земли Слова", _title_font, 24, INK))
	column.add_child(_label(BuildInfo.label(), _text_font, 13, INK_DIM))
	column.add_child(_label(BuildInfo.STEP, _text_font, 13, ACCENT))


func _build_hint() -> void:
	var box := _panel(Control.SIZE_SHRINK_BEGIN, Control.SIZE_SHRINK_END)
	box.add_child(_label("F1 — управление  ·  F2 — снимок  ·  F5 — замер скорости  ·  G — сетка  ·  C — вешки  ·  M — другая карта  ·  F11 — во весь экран", _text_font, 13, INK_DIM))


func _build_fps() -> void:
	var box := _panel(Control.SIZE_SHRINK_END, Control.SIZE_SHRINK_BEGIN)
	_fps = _label("— к/с", _bold_font, 14, INK)
	box.add_child(_fps)


func _build_help() -> void:
	_help = _panel(Control.SIZE_SHRINK_BEGIN, Control.SIZE_SHRINK_CENTER)
	var column := VBoxContainer.new()
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_theme_constant_override("separation", 6)
	_help.add_child(column)
	column.add_child(_label("Управление", _title_font, 20, INK))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	grid.add_theme_constant_override("h_separation", 18)
	grid.add_theme_constant_override("v_separation", 3)
	column.add_child(grid)
	for row: Array in HELP_ROWS:
		grid.add_child(_label(str(row[0]), _bold_font, 14, ACCENT))
		grid.add_child(_label(str(row[1]), _text_font, 14, INK))
	_help.visible = false


func _build_toast() -> void:
	_toast = _panel(Control.SIZE_SHRINK_CENTER, Control.SIZE_SHRINK_BEGIN)
	_toast_label = _label("", _text_font, 15, INK)
	_toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.add_child(_toast_label)
	_toast.visible = false


func _build_loading() -> void:
	_loading = _panel(Control.SIZE_SHRINK_CENTER, Control.SIZE_SHRINK_CENTER)
	_loading_label = _label("", _title_font, 22, INK)
	_loading.add_child(_loading_label)
	_loading.visible = false


func _build_report() -> void:
	_report = _panel(Control.SIZE_SHRINK_CENTER, Control.SIZE_SHRINK_CENTER)
	_report_label = _label("", _text_font, 15, INK)
	_report.add_child(_report_label)
	_report.visible = false


## Плашка: где встать по горизонтали и вертикали, задают флаги размера (начало, центр, конец).
func _panel(horizontal: Control.SizeFlags, vertical: Control.SizeFlags) -> PanelContainer:
	var style := StyleBoxFlat.new()
	style.bg_color = PANEL
	style.border_color = PANEL_EDGE
	style.set_border_width_all(1)
	style.set_corner_radius_all(8)
	style.content_margin_left = 14.0
	style.content_margin_right = 14.0
	style.content_margin_top = 9.0
	style.content_margin_bottom = 10.0
	var box := PanelContainer.new()
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_theme_stylebox_override("panel", style)
	box.size_flags_horizontal = horizontal
	box.size_flags_vertical = vertical
	_frame.add_child(box)
	return box


func _label(text: String, font: Font, size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = text
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if font != null:
		label.add_theme_font_override("font", font)
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	return label


## Шрифт сайта: кириллица и латиница лежат отдельными файлами, второй подключается как запасной.
static func _load_font(cyrillic: String, latin: String) -> Font:
	var font := load(cyrillic) as FontFile
	if font == null:
		return null
	var extra := load(latin) as FontFile
	if extra != null:
		var fallbacks: Array[Font] = [extra]
		font.fallbacks = fallbacks
	return font
