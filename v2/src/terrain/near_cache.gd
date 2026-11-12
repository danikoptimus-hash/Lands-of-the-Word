class_name NearCache
extends Node
## Кэш ближнего вида земли вокруг камеры (с 0.5.4).
##
## Зачем. Разбор замера владельца на 0.5.3: вблизи 55–72 % времени кадра уходит на материалы земли — шейдер кадра
## в каждой точке экрана заново читает десяток текстур и смешивает материалы. А чтение готовой картинки стоит
## около миллисекунды на весь экран. Всю карту в подробности ближнего вида запечь нельзя (на точку экрана вблизи
## приходится 6 см земли — это десятки гигабайт), но землю вокруг камеры — можно: она считается в текстуру один
## раз, тем же кодом, что и в кадре (surface_near.gdshaderinc), а кадр её только читает.
##
## Как устроено. Четыре уровня подробности — 4,4, 9, 18 и 35 см на клетку; у каждого своя текстура — окно земли
## (180, 360, 720 и 1090 м). Окно подробного уровня стоит там, где этот уровень нужен: при взгляде сверху — вокруг
## точки, на которую смотрит камера, при наклонном взгляде — ближе к камере, а грубые уровни — дальше. Шейдер
## кадра берёт уровень по размеру точки экрана и смешивает два соседних. Текстура уровня — «по кругу»: клетка мира лежит в точке (x mod N, z mod N), поэтому при движении камеры
## окно сдвигается без пересчёта — досчитываются только полосы по краю. Считается не всё сразу, а по бюджету
## на кадр: готовая область уровня — прямоугольник, который растёт от фокуса к краям окна.
##
## Кэш — только ускорение. Где он не готов (первые секунду-две после прыжка камеры, передний край при быстром
## движении) или не годится (отвесные склоны, приближение ближе самого подробного уровня), шейдер кадра считает
## точку сам, как раньше, — картинка та же.

const BAKE_SHADER := preload("res://src/terrain/bake_near.gdshader")

## Метров на клетку нулевого уровня; у каждого следующего — вдвое больше. У владельца в самом близком приближении
## на точку экрана приходится 6,25 см земли — клетка в корень из двух раз мельче.
const CELL := 0.0442
## Сторона текстуры уровня, клеток. Уровень нужен, пока точка экрана не больше двух его клеток, поэтому экран
## занимает в нём до двух своих ширин — 4096 клеток хватает картинке мира шириной до 2000 точек.
const SIZES: Array[int] = [4096, 4096, 4096, 3072]
## Мелкий рельеф материалов (нормаль) виден, пока точка экрана мельче четверти метра, — он есть у двух подробных
## уровней; у остальных нормаль — как у рельефа.
const WITH_RELIEF: Array[bool] = [true, true, false, false]
## Шейдер кадра берёт клетку кэша мельче точки экрана — на полуровня (CACHE_BIAS в terrain_surface.gdshader):
## иначе кэш выглядит мягче прямого расчёта.
const BIAS := -0.5
const SNAP := 64  ## окно уровня сдвигается шагами в столько клеток
const PIECES := 6  ## столько кусков за кадр может досчитываться в одном уровне
## Бюджет на кадр — сколько клеток считается за кадр на все уровни вместе (клетка с рельефом идёт за две).
## 300 тысяч — около 3 мс на встроенной видеокарте владельца: прямой расчёт точки стоит там около 10 нс.
const BUDGET := 300000
## Источники шейдера кадра, которые нужны и запеканию: что за земля в области, откуда её читать.
const SHARED: Array[String] = ["splat_index", "splat_weight", "surface_tone", "surface_shade", "splat_texel", "noise_shift",
		"bake_rect", "layer_albedo", "layer_normal", "noise_map", "height_map", "debug_view"]


class Level:
	var cell := 0.0  ## метров на клетку
	var cells := 0  ## сторона текстуры
	var origin := Vector2i.ZERO  ## клетка мира в углу окна
	var valid := Rect2i()  ## посчитанная область, клетки мира
	var shown := Rect2i()  ## область, которую уже можно читать: посчитанное кадром раньше
	var views: Array[SubViewport] = []  ## текстура цвета и, если есть, рельефа
	var materials: Array[ShaderMaterial] = []
	var rects: Array = []  ## по списку прямоугольников-кусков на каждую текстуру


var cells_done := 0  ## сколько клеток посчитано за всё время (для журнала и проверок)
## Читает ли шейдер кадра кэш. Выключается для сравнения (замер «без кэша», проверка картинки): посчитанное
## при этом сохраняется.
var reading := true:
	set(value):
		reading = value
		if _source != null:
			_source.set_shader_parameter("cache_on", value)

var _levels: Array[Level] = []
var _source: ShaderMaterial  ## материал области, к которой привязан кэш
var _centres: Array[Vector2] = []  ## середина окна каждого уровня (метры мира)
var _known := false


func _ready() -> void:
	for index in SIZES.size():
		var level := Level.new()
		level.cell = CELL * pow(2.0, float(index))
		level.cells = SIZES[index]
		for part in (2 if WITH_RELIEF[index] else 1):
			var view := SubViewport.new()
			view.size = Vector2i(level.cells, level.cells)
			view.disable_3d = true
			view.gui_disable_input = true
			view.transparent_bg = true
			# Содержимое не стирается: каждый кадр дорисовываются только новые куски.
			view.render_target_clear_mode = SubViewport.CLEAR_MODE_NEVER
			view.render_target_update_mode = SubViewport.UPDATE_DISABLED
			var material := ShaderMaterial.new()
			material.shader = BAKE_SHADER
			material.set_shader_parameter("part", part)
			material.set_shader_parameter("cells", level.cells)
			material.set_shader_parameter("cell_size", level.cell)
			var pieces: Array[ColorRect] = []
			for i in PIECES * 4:
				var rect := ColorRect.new()
				rect.material = material
				rect.visible = false
				view.add_child(rect)
				pieces.append(rect)
			add_child(view)
			level.views.append(view)
			level.materials.append(material)
			level.rects.append(pieces)
		_levels.append(level)


## Привязать кэш к области рельефа (её материалу кадра): запекание читает те же текстуры. Пусто — кэш выключен.
func bind(source: ShaderMaterial) -> void:
	if source == _source:
		return
	if _source != null:
		_source.set_shader_parameter("cache_on", false)
	_source = source
	for level in _levels:
		level.valid = Rect2i()
		level.shown = Rect2i()
	if source == null:
		return
	for level in _levels:
		for material in level.materials:
			for parameter in SHARED:
				material.set_shader_parameter(parameter, source.get_shader_parameter(parameter))
	var sizes := Vector4.ZERO
	for index in _levels.size():
		var level := _levels[index]
		sizes[index] = level.cell * float(level.cells)
		source.set_shader_parameter("cache_color_%d" % index, level.views[0].get_texture())
		if level.views.size() > 1:
			source.set_shader_parameter("cache_relief_%d" % index, level.views[1].get_texture())
	source.set_shader_parameter("cache_cell", CELL)
	source.set_shader_parameter("cache_size", sizes)
	source.set_shader_parameter("cache_on", reading)
	_push()


## Проверочный вид меняет сам расчёт точки — посчитанное раньше не годится.
func set_debug_view(view: int) -> void:
	for level in _levels:
		level.valid = Rect2i()
		level.shown = Rect2i()
		for material in level.materials:
			material.set_shader_parameter("debug_view", view)
	_push()


## Раз в кадр. eye — камера, focus — точка земли, на которую она смотрит (с высотой), pixel — сколько метров земли
## приходится на точку экрана в середине кадра, budget — сколько клеток можно посчитать за этот кадр,
## paused — камера летит: считать нет смысла, окна уходят.
func update(eye: Vector3, focus: Vector3, pixel: float, budget: int, paused: bool) -> void:
	_place(eye, focus, pixel)
	_known = true
	if _source == null:
		return
	for index in _levels.size():
		var level := _levels[index]
		for pieces: Array in level.rects:
			for rect: ColorRect in pieces:
				rect.visible = false
		# То, что считалось в прошлом кадре, уже в текстуре — его можно читать.
		level.shown = level.valid
		var half := level.cells / 2
		var centre := _centres[index]
		var wanted := Vector2i(_snapped(floori(centre.x / level.cell) - half), _snapped(floori(centre.y / level.cell) - half))
		if wanted != level.origin:
			level.origin = wanted
			# Клетки, ушедшие из окна, отдают свои места новым: годным остаётся только общее со старым окном.
			var window := Rect2i(level.origin, Vector2i(level.cells, level.cells))
			level.valid = level.valid.intersection(window) if level.valid.has_area() else Rect2i()
			level.shown = level.valid
			for material in level.materials:
				material.set_shader_parameter("origin_cell", level.origin)
				material.set_shader_parameter("origin_texel", Vector2i(posmod(level.origin.x, level.cells), posmod(level.origin.y, level.cells)))
	_push()
	if paused or budget <= 0:
		return
	# Считаются уровни, нужные этому приближению: тот, что под точку экрана, все грубее него и один подробнее
	# (у нижнего края экрана земля ближе). Уровни заметно подробнее нужного не считаются вовсе: с такой высоты
	# их никто не увидит.
	var need := _need(pixel)
	if need > float(_levels.size()) + 0.5:
		return
	var first := clampi(floori(need), 0, _levels.size() - 1)
	var order: Array[int] = [first]
	for index in range(first + 1, _levels.size()):
		order.append(index)
	# Бюджет кадра делится на куски. Каждый кусок достаётся уровню, у которого готовая область хуже всех
	# закрывает середину своего окна (в метрах): так все уровни растут от середины наружу вместе, и экран
	# закрывается кэшем за секунду, а дальние края окон досчитываются потом.
	var left := budget
	var share := maxi(budget / 4, 4096)
	var pieces: Array[int] = []
	pieces.resize(_levels.size())
	pieces.fill(0)
	for turn in PIECES * _levels.size():
		if left <= 0:
			break
		var pick := -1
		var worst := INF
		for index in order:
			if pieces[index] >= PIECES:
				continue
			var covered := _covered(_levels[index], _centres[index])
			if covered < worst:
				worst = covered
				pick = index
		if (pick < 0 or worst == INF) and first > 0 and pieces[first - 1] < PIECES and _covered(_levels[first - 1], _centres[first - 1]) < INF:
			# Уровень подробнее нужного (для земли у нижнего края экрана) досчитывается, когда основные готовы:
			# при движении его окно уходит вдвое быстрее в клетках и забирало бы весь бюджет.
			pick = first - 1
			worst = 0.0
		if pick < 0 or worst == INF:
			break
		var spent := _grow(_levels[pick], _centres[pick], mini(left, share), pieces[pick])
		if spent <= 0:
			break
		pieces[pick] += 1
		left -= spent
	for index in _levels.size():
		if pieces[index] > 0:
			for view in _levels[index].views:
				view.render_target_update_mode = SubViewport.UPDATE_ONCE


## Какой уровень (дробный) нужен точке экрана такого размера.
static func _need(pixel: float) -> float:
	return log(maxf(pixel, 1.0e-4) / CELL) / log(2.0) + BIAS


## Где стоять окну каждого уровня. Уровень нужен там, где мерка точки экрана на земле — около двух его клеток.
## Мерка (та же, что в шейдере кадра) — среднее двух сторон точки экрана на земле: поперёк взгляда сторона растёт
## с расстоянием D от камеры, вдоль взгляда она ещё и вытянута наклоном в D / h раз (h — высота камеры над землёй).
## Отсюда расстояние, на котором нужен уровень; середина его окна ставится на землю по линии взгляда на этом
## расстоянии — но не дальше того, что видно на экране. При взгляде сверху все окна стоят под камерой.
func _place(eye: Vector3, focus: Vector3, pixel: float) -> void:
	var eye_ground := Vector2(eye.x, eye.z)
	var focus_ground := Vector2(focus.x, focus.z)
	var away := focus_ground - eye_ground
	var along := away.length()
	var height := maxf(eye.y - focus.y, 1.0)
	var reach := maxf(eye.distance_to(focus), 1.0)
	var pitch := atan2(height, along)  # наклон взгляда под горизонт
	var half_view := deg_to_rad(StrategyCamera.FOV) * 0.5
	# Земля у нижнего и у верхнего края экрана: расстояние по земле от камеры.
	var near_edge := height / tan(pitch + half_view) if pitch + half_view < PI * 0.5 - 0.02 else 0.0
	var far_edge := height / tan(pitch - half_view) if pitch - half_view > 0.03 else 3000.0
	_centres.resize(_levels.size())
	for index in _levels.size():
		var level := _levels[index]
		# Мерка на расстоянии D: (pixel · D / reach) · (1 + D / height) / 2; ищем D, где она равна двум клеткам.
		var wanted := 4.0 * level.cell * pow(2.0, -BIAS - 0.5) * reach / maxf(pixel, 1.0e-4)
		var distance := height * (sqrt(1.0 + 4.0 * wanted / height) - 1.0) * 0.5
		var ground := sqrt(maxf(distance * distance - height * height, 0.0))
		ground = clampf(ground, near_edge, maxf(far_edge, near_edge))
		_centres[index] = focus_ground if along < 1.0 else eye_ground + away / along * ground


## Весь кэш вокруг фокуса посчитан (уровни, нужные этому приближению).
func is_ready(pixel: float) -> bool:
	if _source == null or not _known:
		return false
	var need := _need(pixel)
	if need > float(_levels.size()) + 0.5:
		return true
	for index in range(maxi(floori(need) - 1, 0), _levels.size()):
		var level := _levels[index]
		if level.shown.size != Vector2i(level.cells, level.cells):
			return false
	return true


## Доля посчитанного по уровням — для журнала.
func progress() -> String:
	var parts := PackedStringArray()
	for level in _levels:
		parts.append("%d %%" % roundi(100.0 * float(level.shown.get_area()) / float(level.cells * level.cells)))
	return ", ".join(parts)


func memory_mb() -> float:
	var total := 0.0
	for level in _levels:
		total += float(level.cells * level.cells * 4 * level.views.size())
	return total / 1048576.0


static func _snapped(cell: int) -> int:
	return floori(float(cell) / float(SNAP)) * SNAP


## Сколько метров от середины окна уровня до ближайшего края его готовой области (меньше нуля — середина ещё
## не посчитана; бесконечность — уровень готов целиком).
func _covered(level: Level, around: Vector2) -> float:
	var window := Rect2i(level.origin, Vector2i(level.cells, level.cells))
	if level.valid == window:
		return INF
	if not level.valid.has_area():
		return -INF
	var centre := Vector2i(floori(around.x / level.cell), floori(around.y / level.cell))
	var nearest := 1 << 30
	if level.valid.position.x > window.position.x:
		nearest = mini(nearest, centre.x - level.valid.position.x)
	if level.valid.end.x < window.end.x:
		nearest = mini(nearest, level.valid.end.x - centre.x)
	if level.valid.position.y > window.position.y:
		nearest = mini(nearest, centre.y - level.valid.position.y)
	if level.valid.end.y < window.end.y:
		nearest = mini(nearest, level.valid.end.y - centre.y)
	return float(nearest) * level.cell


## Досчитать уровень одним куском не больше budget клеток: готовая область растёт от середины окна к его краям,
## оставаясь прямоугольником, — прирастает та сторона, что ближе к середине. piece — номер куска в этом кадре.
## Возвращает, сколько клеток потрачено (клетка с рельефом идёт за две).
func _grow(level: Level, around: Vector2, budget: int, piece: int) -> int:
	var window := Rect2i(level.origin, Vector2i(level.cells, level.cells))
	var cost := level.views.size()
	var centre := Vector2i(floori(around.x / level.cell), floori(around.y / level.cell))
	var strip := Rect2i()
	if not level.valid.has_area():
		var side := clampi(floori(sqrt(float(budget) / float(cost))), 8, level.cells)
		var corner := (centre - Vector2i(side, side) / 2).clamp(window.position, window.end - Vector2i(side, side))
		strip = Rect2i(corner, Vector2i(side, side))
		level.valid = strip
	else:
		var gaps: Array[int] = [
			level.valid.position.x - window.position.x, window.end.x - level.valid.end.x,
			level.valid.position.y - window.position.y, window.end.y - level.valid.end.y]
		var reach: Array[int] = [
			centre.x - level.valid.position.x, level.valid.end.x - centre.x,
			centre.y - level.valid.position.y, level.valid.end.y - centre.y]
		var side := -1
		for i in 4:
			if gaps[i] > 0 and (side < 0 or reach[i] < reach[side]):
				side = i
		if side < 0:
			return 0
		var along := level.valid.size.y if side < 2 else level.valid.size.x
		var thick := clampi(budget / (cost * along), 1, gaps[side])
		match side:
			0: strip = Rect2i(level.valid.position.x - thick, level.valid.position.y, thick, along)
			1: strip = Rect2i(level.valid.end.x, level.valid.position.y, thick, along)
			2: strip = Rect2i(level.valid.position.x, level.valid.position.y - thick, along, thick)
			3: strip = Rect2i(level.valid.position.x, level.valid.end.y, along, thick)
		level.valid = level.valid.merge(strip)
	_draw(level, strip, piece)
	var used := strip.get_area() * cost
	cells_done += used
	return used


## Нарисовать кусок (клетки мира) в текстурах уровня. Текстура «по кругу», поэтому кусок, пересекающий её край,
## распадается на части — до четырёх.
func _draw(level: Level, strip: Rect2i, piece: int) -> void:
	var spans_x := _spans(strip.position.x, strip.size.x, level.cells)
	var spans_y := _spans(strip.position.y, strip.size.y, level.cells)
	for target in level.views.size():
		var pieces: Array = level.rects[target]
		var slot := piece * 4
		for span_x: Vector2i in spans_x:
			for span_y: Vector2i in spans_y:
				var rect: ColorRect = pieces[slot]
				rect.position = Vector2(span_x.x, span_y.x)
				rect.size = Vector2(span_x.y, span_y.y)
				rect.visible = true
				slot += 1


## Отрезок клеток мира [start, start + length) — на отрезки текстуры (начало, длина): один или два.
static func _spans(start: int, length: int, cells: int) -> Array[Vector2i]:
	var first := posmod(start, cells)
	if first + length <= cells:
		return [Vector2i(first, length)]
	return [Vector2i(first, cells - first), Vector2i(0, first + length - cells)]


## Сообщить шейдеру кадра, какую область каждого уровня можно читать (метры мира; на клетку внутрь — чтобы
## сглаживание текстуры не брало соседнюю, ещё не посчитанную клетку).
func _push() -> void:
	if _source == null:
		return
	var areas := PackedVector4Array()
	for level in _levels:
		if level.shown.size.x > 2 and level.shown.size.y > 2:
			areas.append(Vector4(
					float(level.shown.position.x + 1) * level.cell, float(level.shown.position.y + 1) * level.cell,
					float(level.shown.end.x - 1) * level.cell, float(level.shown.end.y - 1) * level.cell))
		else:
			areas.append(Vector4(1.0, 1.0, -1.0, -1.0))
	_source.set_shader_parameter("cache_valid", areas)
