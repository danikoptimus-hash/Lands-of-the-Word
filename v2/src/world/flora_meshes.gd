class_name FloraMeshes
extends RefCounted
## Модели растительности и камней (шаг 1.8): лепятся при запуске по числам ниже, без файлов.
##
## Единица мира — метр. Модель строится в своём «опорном» росте (REFERENCE), а на карте каждое дерево получает
## свой рост из пределов вида (SIZE) — олива от 4 до 9 м, кипарис от 10 до 25 и так далее (таблица задания
## владельца 12.11). Размеры не подбираются «на глаз с мировой камеры»: дерево соразмерно человеку и дому.
##
## Дерево — ствол (трубка по ломаной) и крона из нескольких неровных клубов листвы; у пальмы крона — веер
## перистых листьев, у кипариса — узкое веретено. У каждого вида несколько вариантов формы и три уровня
## подробности: вблизи (все клубы и сучья), средний (клубов меньше и они проще) и дальний — один общий на все
## виды «клуб», которому вид задаёт пропорции и цвет. В вершинах: цвет (листва темнее снизу и в глубине кроны),
## в четвёртом числе цвета — гибкость (ствол жёсткий, концы веток гибкие: по ней шейдер качает дерево на ветру),
## в UV — что это (0 — кора, 1 — листва, 2 — перистый лист пальмы, 3 — камень).

enum Kind { OAK, PINE, OLIVE, CYPRESS, PALM, TAMARISK, SHRUB_GREEN, SHRUB_DRY, ROCK, GRASS }

const TITLES: Array[String] = ["дуб", "сосна", "олива", "кипарис", "пальма", "тамариск", "зелёный кустарник", "сухой кустарник", "камень",
		"пучок травы"]
## Опорный рост модели, метры.
const REFERENCE: Array[float] = [11.0, 13.0, 6.0, 15.0, 12.0, 5.5, 1.4, 0.6, 1.0, 0.5]
## Пределы роста на карте, метры (камень — поперечник; скальные выходы 5–14 м ставятся отдельным жребием,
## см. flora.gd).
const SIZE: Array[Vector2] = [Vector2(6.0, 18.0), Vector2(8.0, 20.0), Vector2(4.0, 9.0), Vector2(10.0, 25.0), Vector2(8.0, 20.0),
		Vector2(3.0, 7.0), Vector2(0.8, 2.5), Vector2(0.2, 1.0), Vector2(0.3, 4.0), Vector2(0.3, 0.7)]
## Сколько вариантов формы у вида.
const VARIANTS: Array[int] = [3, 2, 3, 2, 2, 2, 2, 2, 3, 2]
## Дальний вид дерева — один «клуб»: ширина и высота в долях роста и цвет (линейный).
const FAR_SHAPE: Array[Vector3] = [Vector3(0.85, 0.62, 0.42), Vector3(0.7, 0.3, 0.8), Vector3(0.95, 0.6, 0.45), Vector3(0.2, 0.92, 0.5),
		Vector3(0.5, 0.26, 0.86), Vector3(0.95, 0.5, 0.55)]
const FAR_COLOR: Array[Color] = [Color(0.125, 0.21, 0.075), Color(0.095, 0.175, 0.08), Color(0.25, 0.3, 0.175), Color(0.075, 0.125, 0.045),
		Color(0.16, 0.25, 0.09), Color(0.24, 0.275, 0.15)]

const BARK := Color(0.21, 0.16, 0.11)


## Строитель сетки: копит вершины, потом отдаёт сетку.
class Shape:
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	var uvs := PackedVector2Array()
	var uvs2 := PackedVector2Array()
	var indices := PackedInt32Array()
	var random := RandomNumberGenerator.new()

	## Клуб: неровный шар. radii — полуоси, detail — подробность (0 — 20 граней, 1 — 80), rough — неровность,
	## top и bottom — цвет сверху и снизу, flex — гибкость, kind — что это (см. UV).
	func blob(centre: Vector3, radii: Vector3, detail: int, rough: float, top: Color, bottom: Color, flex: float, kind := 1.0) -> void:
		var ball: Array = FloraMeshes._ball(detail)
		var points: PackedVector3Array = ball[0]
		var first := vertices.size()
		var a := Vector3(random.randf_range(0.0, TAU), random.randf_range(0.0, TAU), random.randf_range(0.0, TAU))
		var tint := random.randf_range(0.9, 1.1)
		for unit in points:
			# Неровность: три плавные волны со своими сдвигами и немного случайного в каждой вершине.
			var bump := 1.0 + rough * (0.5 * sin(unit.x * 3.1 + a.x) * cos(unit.z * 2.7 + a.y) + 0.35 * sin(unit.y * 4.3 + a.z)
					+ 0.3 * random.randf_range(-1.0, 1.0))
			var point := Vector3(unit.x * radii.x, unit.y * radii.y, unit.z * radii.z) * bump
			vertices.append(centre + point)
			normals.append((Vector3(unit.x / radii.x, unit.y / radii.y, unit.z / radii.z).normalized() * 0.6 + unit * 0.4).normalized())
			var lit := clampf(unit.y * 0.6 + 0.5, 0.0, 1.0)
			var color := bottom.lerp(top, lit) * tint
			color.a = flex * (0.55 + 0.45 * lit)
			colors.append(color)
			uvs.append(Vector2(kind, lit))
			uvs2.append(Vector2.ZERO)
		for index: int in ball[1]:
			indices.append(first + index)

	## Трубка по ломаной: ствол, сук. radii — радиус в каждой точке, sides — граней, flex — гибкость по точкам.
	func tube(points: PackedVector3Array, radii: PackedFloat32Array, sides: int, color: Color, flex: PackedFloat32Array) -> void:
		var first := vertices.size()
		for i in points.size():
			var along := (points[mini(i + 1, points.size() - 1)] - points[maxi(i - 1, 0)]).normalized()
			var side := along.cross(Vector3(0.31, 0.0, 0.95)).normalized()
			var up := side.cross(along).normalized()
			for k in sides:
				var turn := TAU * float(k) / float(sides)
				var out := side * cos(turn) + up * sin(turn)
				vertices.append(points[i] + out * radii[i])
				normals.append(out)
				var shade := 0.82 + 0.3 * random.randf()
				colors.append(Color(color.r * shade, color.g * shade, color.b * shade, flex[i]))
				uvs.append(Vector2(0.0, 0.5))
				uvs2.append(Vector2.ZERO)
			if i > 0:
				for k in sides:
					var a := first + (i - 1) * sides + k
					var b := first + (i - 1) * sides + (k + 1) % sides
					var c := first + i * sides + k
					var d := first + i * sides + (k + 1) % sides
					indices.append_array(PackedInt32Array([a, c, b, b, c, d]))

	## Перистый лист пальмы: дугой от макушки наружу и вниз. length — длина, width — ширина, droop — насколько
	## свисает конец, segments — звеньев.
	func frond(root: Vector3, heading: float, lift: float, length: float, width: float, droop: float, segments: int, color: Color) -> void:
		var first := vertices.size()
		var out := Vector3(cos(heading), 0.0, sin(heading))
		var side := Vector3(-out.z, 0.0, out.x)
		var tint := random.randf_range(0.85, 1.15)
		for i in segments + 1:
			var t := float(i) / float(segments)
			# Дуга: сначала вверх и наружу, к концу лист свисает.
			var point := root + out * (length * t * cos(lift * (1.0 - t))) + Vector3.UP * (length * (sin(lift) * t - droop * t * t))
			var wide := width * sin(PI * clampf(t * 0.9 + 0.08, 0.0, 1.0))
			for edge: float in [-1.0, 1.0]:
				# Половинки листа провисают от жилки вниз.
				vertices.append(point + side * edge * wide - Vector3.UP * wide * 0.28)
				normals.append((Vector3.UP * 0.8 + side * edge * 0.45 + out * 0.2).normalized())
				colors.append(Color(color.r * tint, color.g * tint, color.b * tint, 0.35 + 0.65 * t))
				uvs.append(Vector2(2.0, 0.7))
				uvs2.append(Vector2(edge, t))
			if i > 0:
				var at := first + i * 2
				indices.append_array(PackedInt32Array([at - 2, at, at - 1, at - 1, at, at + 1, at - 2, at - 1, at, at - 1, at + 1, at]))

	## Пучок травы: листья веером от корня наружу. Лист — один узкий клин (корень широкий, конец острый и отклонён
	## наружу), виден с обеих сторон; нормали смотрят вверх — пучок освещён как земля под ним, без чёрных и
	## горящих листьев. Пучок — 10–14 треугольников: их в кадре вблизи десятки тысяч.
	func tuft(blades: int, height: float, spread: float, width: float) -> void:
		for b in blades:
			var heading := TAU * (float(b) + random.randf_range(-0.35, 0.35)) / float(blades)
			var out := Vector3(cos(heading), 0.0, sin(heading))
			var side := Vector3(-out.z, 0.0, out.x)
			var tall := height * random.randf_range(0.62, 1.0)
			var lean := spread * random.randf_range(0.5, 1.0)
			var root := out * random.randf_range(0.0, 0.07)
			var first := vertices.size()
			var shade := random.randf_range(0.86, 1.12)
			var normal := (Vector3.UP * 0.9 + out * 0.35).normalized()
			for edge: float in [-1.0, 1.0, 0.0]:
				var t := 1.0 if edge == 0.0 else 0.0
				var tone := (0.36 + 1.0 * t) * shade
				vertices.append(root + side * edge * width + out * (lean * t) + Vector3.UP * (tall * t))
				normals.append(normal)
				colors.append(Color(tone, tone, tone, t))
				uvs.append(Vector2(4.0, t))
				uvs2.append(Vector2(edge, t))
			indices.append_array(PackedInt32Array([first, first + 2, first + 1, first, first + 1, first + 2]))

	func commit() -> ArrayMesh:
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = vertices
		arrays[Mesh.ARRAY_NORMAL] = normals
		arrays[Mesh.ARRAY_COLOR] = colors
		arrays[Mesh.ARRAY_TEX_UV] = uvs
		arrays[Mesh.ARRAY_TEX_UV2] = uvs2
		arrays[Mesh.ARRAY_INDEX] = indices
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		return mesh


static var _balls := {}


## Шар из треугольников: вершины на единичной сфере и номера вершин граней. detail — сколько раз дробить
## двадцатигранник.
static func _ball(detail: int) -> Array:
	if _balls.has(detail):
		return _balls[detail]
	var t := (1.0 + sqrt(5.0)) / 2.0
	var points: Array[Vector3] = []
	for raw: Vector3 in [Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0), Vector3(0, -1, t), Vector3(0, 1, t),
			Vector3(0, -1, -t), Vector3(0, 1, -t), Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)]:
		points.append(raw.normalized())
	var faces: Array[int] = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
			3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1]
	for level in detail:
		var next: Array[int] = []
		var middle := {}
		for f in range(0, faces.size(), 3):
			var corner: Array[int] = [faces[f], faces[f + 1], faces[f + 2]]
			var mids: Array[int] = []
			for e in 3:
				var a := corner[e]
				var b := corner[(e + 1) % 3]
				var key := Vector2i(mini(a, b), maxi(a, b))
				if not middle.has(key):
					points.append(((points[a] + points[b]) * 0.5).normalized())
					middle[key] = points.size() - 1
				mids.append(middle[key])
			next.append_array([corner[0], mids[0], mids[2], corner[1], mids[1], mids[0], corner[2], mids[2], mids[1], mids[0], mids[1], mids[2]])
		faces = next
	var result: Array = [PackedVector3Array(points), PackedInt32Array(faces)]
	_balls[detail] = result
	return result


## Сетка вида: variant — вариант формы, lod — 0 вблизи, 1 средний.
static func make(kind: Kind, variant: int, lod: int) -> ArrayMesh:
	var shape := Shape.new()
	shape.random.seed = 1000 + int(kind) * 97 + variant * 13
	match kind:
		Kind.OAK:
			_broadleaf(shape, lod, 11.0, 0.42, 3.4, 4.6, Vector2(1.9, 2.7), 0.8, 9 + variant, Color(0.2, 0.3, 0.1), Color(0.07, 0.12, 0.04), 0.28, 3)
		Kind.PINE:
			_broadleaf(shape, lod, 13.0, 0.3, 8.6, 3.4, Vector2(2.1, 3.0), 0.42, 6 + variant, Color(0.14, 0.23, 0.09), Color(0.05, 0.1, 0.045), 0.22, 2)
		Kind.OLIVE:
			_broadleaf(shape, lod, 6.0, 0.3, 1.5, 2.3, Vector2(1.2, 1.8), 0.7, 6 + variant, Color(0.3, 0.36, 0.22), Color(0.12, 0.16, 0.09), 0.36, 3)
		Kind.CYPRESS:
			_cypress(shape, lod, variant)
		Kind.PALM:
			_palm(shape, lod, variant)
		Kind.TAMARISK:
			_broadleaf(shape, lod, 5.5, 0.14, 2.0, 2.2, Vector2(1.1, 1.7), 0.45, 4 + variant, Color(0.26, 0.31, 0.17), Color(0.13, 0.16, 0.09), 0.34, 4)
		Kind.SHRUB_GREEN:
			for i in (2 + variant if lod == 0 else 1):
				var turn := shape.random.randf_range(0.0, TAU)
				var away := shape.random.randf_range(0.0, 0.5) if lod == 0 else 0.0
				var wide := 1.0 if lod == 0 else 1.35
				shape.blob(Vector3(cos(turn) * away, shape.random.randf_range(0.5, 0.75), sin(turn) * away),
						Vector3(shape.random.randf_range(0.55, 0.8) * wide, shape.random.randf_range(0.45, 0.65), shape.random.randf_range(0.55, 0.8) * wide),
						0, 0.3, Color(0.17, 0.26, 0.09), Color(0.07, 0.11, 0.04), 0.6)
		Kind.SHRUB_DRY:
			for i in (1 + variant if lod == 0 else 1):
				var turn := shape.random.randf_range(0.0, TAU)
				var away := shape.random.randf_range(0.0, 0.3) if lod == 0 else 0.0
				shape.blob(Vector3(cos(turn) * away, 0.26, sin(turn) * away),
						Vector3(shape.random.randf_range(0.34, 0.5), shape.random.randf_range(0.22, 0.34), shape.random.randf_range(0.34, 0.5)),
						0, 0.42, Color(0.36, 0.34, 0.19), Color(0.18, 0.16, 0.09), 0.7)
		Kind.ROCK:
			_rock(shape, lod, variant)
		Kind.GRASS:
			# Вариант 0 — пышный пучок, 1 — редкий и выше. Цвет — белый: зелёный он или соломенный, задаёт экземпляр.
			if variant == 0:
				shape.tuft(7 if lod == 0 else 4, 0.5, 0.44, 0.12 if lod == 0 else 0.15)
			else:
				shape.tuft(5 if lod == 0 else 3, 0.5, 0.26, 0.11 if lod == 0 else 0.14)
	return shape.commit()


## Дальний вид любого дерева: один клуб единичного размера, стоит на земле. Пропорции и цвет вида — в transform
## и цвете экземпляра (FAR_SHAPE, FAR_COLOR).
static func make_far() -> ArrayMesh:
	var shape := Shape.new()
	shape.random.seed = 7
	shape.blob(Vector3(0.0, 0.5, 0.0), Vector3(0.5, 0.5, 0.5), 0, 0.16, Color(1.0, 1.0, 1.0), Color(0.48, 0.48, 0.48), 0.5)
	return shape.commit()


## Лиственное дерево и сосна-зонтик: ствол с изгибом, сучья, крона из клубов. height — рост, trunk — радиус
## ствола у земли, crown_from — где начинается крона, spread — на сколько крона расходится в стороны,
## puff — полуоси клуба (от и до), flat — сплюснутость клубов, count — сколько их, limbs — сколько сучьев.
static func _broadleaf(shape: Shape, lod: int, height: float, trunk: float, crown_from: float, spread: float, puff: Vector2, flat: float,
		count: int, top: Color, bottom: Color, rough: float, limbs: int) -> void:
	var random := shape.random
	var lean := Vector3(random.randf_range(-0.5, 0.5), 0.0, random.randf_range(-0.5, 0.5))
	var fork := Vector3(lean.x, crown_from, lean.z)
	var sides := 7 if lod == 0 else 4
	# Ствол: от земли до развилки, с изгибом посередине.
	var middle := fork * 0.5 + Vector3(random.randf_range(-0.25, 0.25), 0.0, random.randf_range(-0.25, 0.25))
	shape.tube(PackedVector3Array([Vector3(0.0, -0.4, 0.0), Vector3(0.0, 0.25, 0.0), middle, fork]),
			PackedFloat32Array([trunk * 1.35, trunk * 1.1, trunk * 0.85, trunk * 0.7]), sides, BARK, PackedFloat32Array([0.0, 0.0, 0.05, 0.12]))
	var crown_height := height - crown_from
	var anchors: Array[Vector3] = []
	for i in limbs:
		var turn := TAU * (float(i) + random.randf_range(-0.3, 0.3)) / float(limbs)
		var reach := spread * random.randf_range(0.45, 0.8)
		var tip := fork + Vector3(cos(turn) * reach, crown_height * random.randf_range(0.3, 0.6), sin(turn) * reach)
		anchors.append(tip)
		if lod == 0:
			shape.tube(PackedVector3Array([fork, fork.lerp(tip, 0.55) + Vector3(0.0, crown_height * 0.08, 0.0), tip]),
					PackedFloat32Array([trunk * 0.55, trunk * 0.36, trunk * 0.18]), 5, BARK, PackedFloat32Array([0.12, 0.25, 0.4]))
	# Крона: клубы вокруг концов сучьев и над развилкой; у среднего уровня их вдвое меньше, и они крупнее.
	var puffs := count if lod == 0 else maxi(count / 3, 2)
	var grow := 1.0 if lod == 0 else 1.55
	for i in puffs:
		var anchor := anchors[i % anchors.size()] if i < anchors.size() * 2 else fork + Vector3(0.0, crown_height * 0.55, 0.0)
		var offset := Vector3(random.randf_range(-1.0, 1.0), random.randf_range(-0.25, 0.6), random.randf_range(-1.0, 1.0)) * spread * 0.34
		var centre := anchor + offset
		centre.y = clampf(centre.y, crown_from + puff.x * flat * 0.5, height - puff.x * flat * 0.6)
		var size := random.randf_range(puff.x, puff.y) * grow
		shape.blob(centre, Vector3(size * random.randf_range(0.85, 1.15), size * flat * random.randf_range(0.85, 1.15), size * random.randf_range(0.85, 1.15)),
				1 if lod == 0 and i < 4 else 0, rough, top, bottom, 0.75)


## Кипарис: узкое веретено из вытянутых клубов друг над другом, макушка острая; у земли — короткий ствол.
static func _cypress(shape: Shape, lod: int, variant: int) -> void:
	var random := shape.random
	var height := 15.0
	var girth := 1.15 + 0.25 * float(variant)
	shape.tube(PackedVector3Array([Vector3(0.0, -0.4, 0.0), Vector3(0.0, 1.6, 0.0)]), PackedFloat32Array([0.3, 0.24]), 6 if lod == 0 else 4, BARK,
			PackedFloat32Array([0.0, 0.0]))
	var parts := 5 if lod == 0 else 3
	for i in parts:
		var t := (float(i) + 0.5) / float(parts)
		var wide := girth * (1.0 - 0.72 * pow(t, 1.5)) * random.randf_range(0.9, 1.1)
		var tall := height / float(parts) * 0.95
		shape.blob(Vector3(random.randf_range(-0.14, 0.14), 1.0 + t * (height - 1.6), random.randf_range(-0.14, 0.14)), Vector3(wide, tall, wide),
				1 if lod == 0 and i < 3 else 0, 0.16, Color(0.1, 0.155, 0.055), Color(0.04, 0.07, 0.03), 0.25 + 0.5 * t)
	# Пара боковых прядей: силуэт не идеальная колонна.
	if lod == 0:
		for i in 2 + variant:
			var turn := random.randf_range(0.0, TAU)
			var level := random.randf_range(0.2, 0.6)
			shape.blob(Vector3(cos(turn) * girth * 0.55, 1.0 + level * height, sin(turn) * girth * 0.55), Vector3(girth * 0.5, height * 0.14, girth * 0.5),
					0, 0.2, Color(0.09, 0.145, 0.05), Color(0.04, 0.07, 0.03), 0.5)


## Финиковая пальма: высокий ствол с лёгким изгибом и веер перистых листьев; снизу — несколько сухих, свисающих.
static func _palm(shape: Shape, lod: int, variant: int) -> void:
	var random := shape.random
	var height := 12.0
	var bend := Vector3(random.randf_range(-1.2, 1.2), 0.0, random.randf_range(-1.2, 1.2)) * (0.6 + 0.5 * float(variant))
	var points := PackedVector3Array()
	var radii := PackedFloat32Array()
	var flex := PackedFloat32Array()
	var steps := 6 if lod == 0 else 3
	for i in steps + 1:
		var t := float(i) / float(steps)
		points.append(Vector3(bend.x * t * t, -0.4 + (height - 1.2 + 0.4) * t, bend.z * t * t))
		radii.append(lerpf(0.34, 0.22, t) * (1.0 + (0.5 if i == 0 else 0.0)))
		flex.append(0.3 * t * t)
	shape.tube(points, radii, 7 if lod == 0 else 4, Color(0.27, 0.21, 0.15), flex)
	var top := points[points.size() - 1]
	var leaves := (13 + variant * 2) if lod == 0 else 7
	for i in leaves:
		var heading := TAU * (float(i) + random.randf_range(-0.3, 0.3)) / float(leaves)
		var ring := float(i % 3)
		shape.frond(top, heading, lerpf(1.05, 0.25, ring / 2.0) + random.randf_range(-0.12, 0.12), random.randf_range(3.6, 4.6), 0.55, lerpf(0.35, 0.75, ring / 2.0),
				6 if lod == 0 else 3, Color(0.17, 0.26, 0.09))
	if lod == 0:
		for i in 4:
			shape.frond(top - Vector3(0.0, 0.3, 0.0), random.randf_range(0.0, TAU), -0.5, random.randf_range(2.4, 3.2), 0.4, 0.5, 4, Color(0.34, 0.27, 0.14))
	# Сердцевина кроны: без неё с высоты видна «дырка» в середине веера.
	shape.blob(top + Vector3(0.0, 0.25, 0.0), Vector3(0.75, 0.6, 0.75), 0, 0.2, Color(0.16, 0.24, 0.08), Color(0.2, 0.17, 0.1), 0.3)


## Камень: 0 — валун (округлый), 1 — глыба (угловатая, приплюснутая), 2 — россыпь из трёх камней. Основание
## утоплено в землю. Цвет — белый: породу задаёт цвет экземпляра.
static func _rock(shape: Shape, lod: int, variant: int) -> void:
	var random := shape.random
	var light := Color(1.0, 1.0, 1.0)
	var dark := Color(0.56, 0.56, 0.56)
	var detail := 1 if lod == 0 else 0
	if variant == 0:
		shape.blob(Vector3(0.0, 0.26, 0.0), Vector3(0.5, 0.42, 0.46), detail, 0.3, light, dark, 0.0, 3.0)
	elif variant == 1:
		shape.blob(Vector3(0.0, 0.16, 0.0), Vector3(0.52, 0.3, 0.4), 0, 0.5, light, dark, 0.0, 3.0)
	else:
		for i in 3:
			var turn := TAU * float(i) / 3.0 + random.randf_range(-0.4, 0.4)
			var size := random.randf_range(0.16, 0.3)
			shape.blob(Vector3(cos(turn) * 0.3, size * 0.5, sin(turn) * 0.3), Vector3(size, size * 0.75, size * 0.9), 0, 0.4, light, dark, 0.0, 3.0)
