class_name Hud
extends CanvasLayer
## Надписи тестовой сборки: версия, подсказки по управлению, сообщения, отчёт замера.
## Это временная служебная оболочка; интерфейс игры — шаг 3.2 дорожной карты.

const INK := Color(0.95, 0.92, 0.86)
const INK_DIM := Color(0.95, 0.92, 0.86, 0.72)
const ACCENT := Color(0.89, 0.72, 0.42)
const PANEL := Color(0.09, 0.08, 0.07, 0.8)
const PANEL_EDGE := Color(0.89, 0.72, 0.42, 0.28)
const REPORT_FONT := 15  ## шрифт окна отчёта; если окно выше экрана, уменьшается до REPORT_FONT_MIN
const REPORT_FONT_MIN := 11

const HELP_ROWS := [
	["Левая кнопка мыши", "взять землю и тянуть"],
	["Колесо", "приблизить или отдалить место под курсором"],
	["Правая кнопка мыши", "повернуть и наклонить камеру — вплоть до горизонта и неба"],
	["Двойной щелчок", "подлететь к месту"],
	["W A S D или стрелки", "двигаться; с Shift — быстрее"],
	["Q, E и R, F", "повернуть и наклонить камеру"],
	["+ и −", "приблизить и отдалить"],
	["Пробел, 1 и 2", "главные острова; «Ветхий Завет» и «Новый Завет»"],
	["0", "весь мир с малыми островами"],
	["K", "остров Каменоломни"],
	["O", "следующий малый остров"],
	["N", "север вверху"],
	["G", "сетка гексов"],
	["L", "время суток: утро, день, вечер, ночь"],
	["P", "погода: ясно или шторм (переход плавный)"],
	["V", "цвет: естественно, сочно, очень сочно"],
	["B", "если медленно: картинка в 100, 77 или 67 % разрешения"],
	["T", "кэш ближнего вида: включить или выключить (для сравнения)"],
	["Y", "эталоны масштаба: человек, дом, дорога, валун и деревья — куда смотрит камера"],
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
var _report_columns: HBoxContainer
var _report_left: Label
var _report_right: Label
var _report_font := REPORT_FONT
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
	# Окно отчёта выше экрана — уменьшаем шрифт, пока не поместится: низ текста не должен уходить за край.
	if _report.visible and _report_font > REPORT_FONT_MIN and report_spare() < 0.0:
		_set_report_font(_report_font - 1)
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


## Окно с текстом по центру: записка «что нового», отчёт замера. rows — строки, которые встают под текстом
## в два столбца (участки облёта в отчёте замера). Если окно выше экрана, шрифт сам уменьшается (см. _process).
func show_report(text: String, rows: PackedStringArray = PackedStringArray()) -> void:
	_report_label.text = text
	var half := ceili(float(rows.size()) / 2.0)
	_report_left.text = "\n".join(rows.slice(0, half))
	_report_right.text = "\n".join(rows.slice(half))
	_report_columns.visible = not rows.is_empty()
	_set_report_font(REPORT_FONT)
	_report.visible = true


## Сколько места осталось под окном отчёта (точек): отрицательное — окно не помещается на экран.
func report_spare() -> float:
	return _frame.size.y - 36.0 - _report.size.y


func report_font() -> int:
	return _report_font


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
	box.add_child(_label("F1 — управление  ·  F2 — снимок  ·  F5 — замер скорости  ·  L — время суток  ·  P — погода  ·  G — сетка  ·  V — цвет  ·  0 — весь мир  ·  K — Каменоломня  ·  M — другая карта  ·  F11 — во весь экран", _text_font, 13, INK_DIM))


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
	var box := VBoxContainer.new()
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_theme_constant_override("separation", 0)
	_report.add_child(box)
	_report_label = _label("", _text_font, REPORT_FONT, INK)
	# Длинные строки переносятся: без этого абзац записки «что нового» уходил за края окна.
	_report_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_report_label.custom_minimum_size = Vector2(960.0, 0.0)
	box.add_child(_report_label)
	_report_columns = HBoxContainer.new()
	_report_columns.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_report_columns.add_theme_constant_override("separation", 36)
	box.add_child(_report_columns)
	_report_left = _label("", _text_font, REPORT_FONT, INK)
	_report_right = _label("", _text_font, REPORT_FONT, INK)
	for column: Label in [_report_left, _report_right]:
		column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		column.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		_report_columns.add_child(column)
	_report.visible = false


func _set_report_font(size: int) -> void:
	_report_font = size
	for label: Label in [_report_label, _report_left, _report_right]:
		label.add_theme_font_size_override("font_size", size)


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
