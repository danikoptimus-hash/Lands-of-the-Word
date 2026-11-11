class_name HeightMap
extends RefCounted
## Высоты мира в памяти: по ним камера идёт над землёй, а объекты встают на поверхность.
## Получается из той же запечённой текстуры, по которой рисуется рельеф.

var rect := Rect2()  ## область мира, метры (x, z)
var texel := 2.0  ## метров на точку
var width := 0
var height := 0
var lowest := 0.0
var highest := 0.0
## Высоты соседних областей (малые острова запекаются отдельно): точку вне своей области ищем в них.
var extras: Array[HeightMap] = []
var outside := -60.0  ## высота там, где ничего не запечено: открытое море

var _data := PackedFloat32Array()


static func from_image(image: Image, world_rect: Rect2) -> HeightMap:
	var copy: Image = image.duplicate()
	copy.convert(Image.FORMAT_RF)
	var map := HeightMap.new()
	map.rect = world_rect
	map.width = copy.get_width()
	map.height = copy.get_height()
	map.texel = world_rect.size.x / float(map.width)
	map._data = copy.get_data().to_float32_array()
	if map._data.size() != map.width * map.height:
		push_error("Высоты мира: неожиданный размер данных")
		return null
	var low := map._data[0]
	var high := map._data[0]
	for i in range(0, map._data.size(), 7):
		var value := map._data[i]
		low = minf(low, value)
		high = maxf(high, value)
	map.lowest = low
	map.highest = high
	return map


## Высота в точке мира (x, z), метры над уровнем моря.
func sample(point: Vector2) -> float:
	if width < 2 or height < 2:
		return 0.0
	if not rect.has_point(point):
		for extra in extras:
			if extra.rect.has_point(point):
				return extra.sample(point)
		return outside
	var fx := (point.x - rect.position.x) / texel - 0.5
	var fy := (point.y - rect.position.y) / texel - 0.5
	var x0 := clampi(floori(fx), 0, width - 2)
	var y0 := clampi(floori(fy), 0, height - 2)
	var tx := clampf(fx - float(x0), 0.0, 1.0)
	var ty := clampf(fy - float(y0), 0.0, 1.0)
	var i := y0 * width + x0
	var top := lerpf(_data[i], _data[i + 1], tx)
	var bottom := lerpf(_data[i + width], _data[i + width + 1], tx)
	return lerpf(top, bottom, ty)


## Наименьшая и наибольшая высота в области (x — минимум, y — максимум).
func range_in(area: Rect2, stride: int = 4) -> Vector2:
	var x_from := clampi(floori((area.position.x - rect.position.x) / texel), 0, width - 1)
	var x_to := clampi(ceili((area.end.x - rect.position.x) / texel), 0, width - 1)
	var y_from := clampi(floori((area.position.y - rect.position.y) / texel), 0, height - 1)
	var y_to := clampi(ceili((area.end.y - rect.position.y) / texel), 0, height - 1)
	var low := INF
	var high := -INF
	var y := y_from
	while y <= y_to:
		var row := y * width
		var x := x_from
		while x <= x_to:
			var value := _data[row + x]
			low = minf(low, value)
			high = maxf(high, value)
			x += stride
		y += stride
	if low > high:
		return Vector2.ZERO
	return Vector2(low, high)


## Картинка высот для проверки глазами: тёмное — глубина, светлое — вершины.
func to_preview() -> Image:
	var bytes := PackedByteArray()
	bytes.resize(width * height)
	var span := maxf(highest - lowest, 0.001)
	for i in _data.size():
		bytes[i] = clampi(roundi((_data[i] - lowest) / span * 255.0), 0, 255)
	return Image.create_from_data(width, height, false, Image.FORMAT_L8, bytes)
