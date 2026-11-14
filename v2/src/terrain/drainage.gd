class_name Drainage
extends RefCounted
## Сток воды по рельефу — часть географии мира (шаг 1.3, задание владельца 11.11: материалы должны зависеть от
## географии, в том числе от влажности и местной эрозии; география отделена от картинки).
##
## По запечённым высотам считается, сколько земли выше по склону отдаёт воду в каждую точку: вода из клетки расходится
## по всем соседям ниже неё, тем больше, чем круче спуск. Получается сеть ложбин и русел, которая сходится к берегу
## и к озёрам. По ней шейдер земли делает ложбины влажнее и зеленее, в пустыне кладёт сухие русла, на склонах —
## промоины. Считается один раз при постройке мира; зависит только от рельефа, а он — от карты и её зерна.

const COARSE := 4  ## сток считается на сетке вчетверо реже рельефа (рельеф 2 м → сток 8 м): русла шире шага сетки
const BUCKET := 0.02  ## клетки перебираются от высоких к низким; порядок — по высоте с шагом 2 см
const FULL := 160.0  ## столько клеток водосбора считается полным руслом (около гектара)
const SPREAD := 1.3  ## чем больше, тем сильнее вода собирается в одну струю
const SHIFTS: Array[Vector2i] = [Vector2i(-1, -1), Vector2i(0, -1), Vector2i(1, -1), Vector2i(-1, 0), Vector2i(1, 0), Vector2i(-1, 1), Vector2i(0, 1), Vector2i(1, 1)]
const DISTANCES: Array[float] = [1.41421356, 1.0, 1.41421356, 1.0, 1.0, 1.41421356, 1.0, 1.41421356]


## Карта стока области: 0 — водораздел, 1 — русло с большим водосбором. baked — запечённый рельеф области
## (красный канал — высота, альфа — уровень воды озера или −999). Текстура вдвое подробнее расчётной сетки.
static func flow_texture(baked: Image) -> ImageTexture:
	var heights := baked.duplicate() as Image
	heights.clear_mipmaps()
	heights.convert(Image.FORMAT_RGBAF)
	var width := maxi(heights.get_width() / COARSE, 4)
	var height := maxi(heights.get_height() / COARSE, 4)
	# Высоты — средние по клетке; уровни озёр усреднять нельзя (рядом «озера нет»), их берём из ближайшей точки.
	var levels := heights.duplicate() as Image
	heights.resize(width, height, Image.INTERPOLATE_BILINEAR)
	levels.resize(width, height, Image.INTERPOLATE_NEAREST)
	var h_data := heights.get_data().to_float32_array()
	var l_data := levels.get_data().to_float32_array()
	var count := width * height
	var ground := PackedFloat32Array()
	ground.resize(count)
	var top := 0.0
	for i in count:
		var z := h_data[i * 4]
		var level := l_data[i * 4 + 3]
		# Море и вода озёр — не суша: вода, дойдя до них, дальше не течёт.
		if z <= 0.0 or (level > -900.0 and z < level):
			z = -1.0
		ground[i] = z
		top = maxf(top, z)

	# Порядок от низких к высоким: подсчётом по корзинам высоты (обычная сортировка здесь была бы вдесятеро дольше).
	var buckets := int(top / BUCKET) + 2
	var starts := PackedInt32Array()
	starts.resize(buckets + 1)
	var land := 0
	for y in range(1, height - 1):
		for x in range(1, width - 1):
			var z := ground[y * width + x]
			if z > 0.0:
				starts[int(z / BUCKET) + 1] += 1
				land += 1
	for b in buckets:
		starts[b + 1] += starts[b]
	var order := PackedInt32Array()
	order.resize(land)
	var cursor := starts.duplicate()
	for y in range(1, height - 1):
		for x in range(1, width - 1):
			var i := y * width + x
			var z := ground[i]
			if z > 0.0:
				var b := int(z / BUCKET)
				order[cursor[b]] = i
				cursor[b] += 1

	var offsets := PackedInt32Array()
	for shift in SHIFTS:
		offsets.append(shift.y * width + shift.x)
	var flow := PackedFloat32Array()
	flow.resize(count)
	flow.fill(1.0)
	var parts := PackedFloat32Array()
	parts.resize(8)
	for n in range(land - 1, -1, -1):
		var i := order[n]
		var z := ground[i]
		var total := 0.0
		for k in 8:
			var drop := z - maxf(ground[i + offsets[k]], 0.0)
			var part := 0.0
			if drop > 0.0:
				part = pow(drop / DISTANCES[k], SPREAD)
			parts[k] = part
			total += part
		if total <= 0.0:
			continue  # замкнутая ложбина: вода остаётся здесь
		var share := flow[i] / total
		for k in 8:
			if parts[k] > 0.0:
				flow[i + offsets[k]] += parts[k] * share

	var scale := 1.0 / log(FULL)
	var result := PackedFloat32Array()
	result.resize(count)
	for i in count:
		result[i] = clampf(log(flow[i]) * scale, 0.0, 1.0) if ground[i] > 0.0 else 0.0
	var image := Image.create_from_data(width, height, false, Image.FORMAT_RF, result.to_byte_array())
	# Вдвое подробнее с гладкой интерполяцией: русла не идут «лесенкой» по клеткам.
	image.resize(width * 2, height * 2, Image.INTERPOLATE_CUBIC)
	image.generate_mipmaps()
	return ImageTexture.create_from_image(image)
