class_name Lightning
extends Node3D
## Молнии шторма (шаг 1.6): видимые ветвистые разряды, а свет — их следствие.
##
## Разряд — ломаная со случайными изломами и ветвями, каждый раз своя: до земли или моря, между тучами (под их
## низом) или внутри тучи (тогда канала не видно — туча светится изнутри). Вспышка света идёт от самого разряда:
## он подсвечивает тучи вокруг себя (sky.gdshader) и завесы дождя (atmosphere.gdshaderinc), а землю и море —
## лампой в месте разряда: ближе к нему светлее, дальше темнее. Разряд вспыхивает несколько раз подряд и гаснет
## меньше чем за полсекунды. Где и когда бьёт молния, решает weather.gd.

enum Kind { GROUND, CLOUD, INSIDE }

const SHADER := preload("res://src/world/lightning.gdshader")
## Вспышки одного разряда: когда (секунды от начала) и с какой силой; каждая гаснет за сотые доли секунды.
const PULSES: Array[Vector2] = [Vector2(0.0, 1.0), Vector2(0.075, 0.45), Vector2(0.16, 0.85), Vector2(0.3, 0.35)]
const PULSE_FADE := 0.05
const LIFE := 0.55
## Свет разряда на земле и море: докуда светит (метры) и сила. Слабеет обратно расстоянию: в километре от
## разряда он чуть сильнее света под тучами шторма, в четырёх — вчетверо слабее, дальше восьми его не видно.
const LAMP_RANGE := 11000.0
const LAMP_ENERGY := 800.0

var power := 0.0  ## яркость разряда сейчас, 0…1
var glow_at := Vector3.ZERO  ## где разряд светит в тучах (его верх)

var _bolt: MeshInstance3D
var _material: ShaderMaterial
var _lamp: OmniLight3D
var _age := 99.0
var _strength := 1.0
var _still := false


func _ready() -> void:
	_material = ShaderMaterial.new()
	_material.shader = SHADER
	_material.render_priority = 30
	_bolt = MeshInstance3D.new()
	_bolt.material_override = _material
	_bolt.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_bolt.visible = false
	add_child(_bolt)
	_lamp = OmniLight3D.new()
	_lamp.omni_range = LAMP_RANGE
	_lamp.omni_attenuation = 1.0
	_lamp.light_color = Color(0.72, 0.8, 1.0)
	_lamp.light_specular = 0.12
	_lamp.shadow_enabled = false
	_lamp.visible = false
	add_child(_lamp)


## Карта облаков и объёмный шум — шейдеру разряда (дымка и дождь гасят его вдали).
func set_cloud_textures(map: Texture2D, noise: Texture3D) -> void:
	_material.set_shader_parameter("cloud_map", map)
	_material.set_shader_parameter("cloud_noise", noise)


## Разряд: от точки под тучей (top) до земли (bottom, вид GROUND) или до другой точки под тучами (вид CLOUD);
## вид INSIDE — вспышка в туче без видимого канала. strength — сила, 0…1. still — разряд не гаснет (для кадров).
func strike(kind: Kind, top: Vector3, bottom: Vector3, seed_value: int, strength := 1.0, still := false) -> void:
	var random := RandomNumberGenerator.new()
	random.seed = seed_value
	_strength = strength
	_still = still
	_age = 0.0
	glow_at = top
	var lines: Array[Dictionary] = []
	if kind == Kind.GROUND:
		var channel := _jagged(top, bottom, 6, 0.13, random)
		lines.append({"points": channel, "width": 1.0, "bright": 1.0})
		# Ветви: от канала вниз и в сторону, до земли не доходят.
		for i in random.randi_range(4, 8):
			var at := random.randi_range(channel.size() / 10, channel.size() * 8 / 10)
			var from := channel[at]
			var reach := (from.y - bottom.y) * random.randf_range(0.2, 0.55)
			_branch(lines, from, _aside(random, 0.9) * reach, 0.55, 0.45, random)
		_lamp.position = bottom + Vector3(0.0, minf((top.y - bottom.y) * 0.3, 700.0), 0.0)
	elif kind == Kind.CLOUD:
		var channel := _jagged(top, bottom, 6, 0.1, random)
		lines.append({"points": channel, "width": 0.9, "bright": 0.85})
		for i in random.randi_range(3, 6):
			var from := channel[random.randi_range(channel.size() / 8, channel.size() * 7 / 8)]
			_branch(lines, from, _aside(random, 1.4) * random.randf_range(250.0, 800.0), 0.5, 0.4, random)
		_lamp.position = (top + bottom) * 0.5 - Vector3(0.0, 300.0, 0.0)
		glow_at = (top + bottom) * 0.5
	else:
		_lamp.position = top - Vector3(0.0, 200.0, 0.0)
	_bolt.mesh = _ribbons(lines) if not lines.is_empty() else null
	_bolt.visible = not lines.is_empty()
	_lamp.visible = true
	step(0.0)


## Погасить разряд сразу (смена погоды, кадры).
func clear() -> void:
	_age = 99.0
	_still = false
	step(0.0)


## Ход времени: вспышки разряда и его угасание.
func step(delta: float) -> void:
	if not _still:
		_age += delta
	if _age >= LIFE:
		power = 0.0
		_bolt.visible = false
		_lamp.visible = false
		return
	var now := 0.0
	for pulse in PULSES:
		if _age >= pulse.x:
			now = maxf(now, pulse.y * exp(-(_age - pulse.x) / PULSE_FADE))
	power = now * _strength
	_material.set_shader_parameter("power", power)
	_lamp.light_energy = LAMP_ENERGY * power


## Случайное направление вниз и в сторону; spread — насколько в сторону.
static func _aside(random: RandomNumberGenerator, spread: float) -> Vector3:
	var turn := random.randf_range(0.0, TAU)
	return Vector3(cos(turn) * spread, -random.randf_range(0.35, 1.0), sin(turn) * spread).normalized()


## Ветвь от точки from на вектор reach; у части ветвей — своя ветка потоньше.
static func _branch(lines: Array[Dictionary], from: Vector3, reach: Vector3, width: float, bright: float,
		random: RandomNumberGenerator) -> void:
	var points := _jagged(from, from + reach, 4, 0.2, random)
	lines.append({"points": points, "width": width, "bright": bright})
	if random.randf() < 0.45:
		var twig_from := points[random.randi_range(points.size() / 4, points.size() * 3 / 4)]
		var twig := _jagged(twig_from, twig_from + _aside(random, 1.1) * reach.length() * random.randf_range(0.3, 0.6), 3, 0.22, random)
		lines.append({"points": twig, "width": width * 0.6, "bright": bright * 0.55})


## Ломаная от from до to: отрезок делится пополам, середина уходит в сторону, и так levels раз — изломы
## крупные и мелкие сразу. sway — насколько середина уходит в сторону, в долях длины.
static func _jagged(from: Vector3, to: Vector3, levels: int, sway: float, random: RandomNumberGenerator) -> PackedVector3Array:
	var points := PackedVector3Array([from, to])
	var amount := from.distance_to(to) * sway
	for level in levels:
		var next := PackedVector3Array()
		for i in points.size() - 1:
			var a := points[i]
			var b := points[i + 1]
			var along := (b - a).normalized()
			var any := Vector3(random.randf_range(-1.0, 1.0), random.randf_range(-1.0, 1.0), random.randf_range(-1.0, 1.0))
			var side := along.cross(any)
			if side.length() > 0.001:
				side = side.normalized()
			next.append(a)
			next.append((a + b) * 0.5 + side * amount * random.randf_range(-1.0, 1.0))
		next.append(points[points.size() - 1])
		points = next
		amount *= 0.52
	return points


## Сетка лент по ломаным: в каждой точке ломаной — две вершины (края ленты), раздвигает их шейдер.
static func _ribbons(lines: Array[Dictionary]) -> ArrayMesh:
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs := PackedVector2Array()
	var uvs2 := PackedVector2Array()
	var indices := PackedInt32Array()
	for line in lines:
		var points: PackedVector3Array = line["points"]
		var first := vertices.size()
		for i in points.size():
			var along := (points[mini(i + 1, points.size() - 1)] - points[maxi(i - 1, 0)]).normalized()
			# У главного канала место вдоль разряда идёт от тучи; ветви начинаются уже в воздухе.
			var place := float(i) / float(points.size() - 1) if float(line["width"]) >= 0.9 else 1.0
			# Ветвь сходит на нет к концу.
			var bright: float = float(line["bright"]) * (1.0 if float(line["width"]) >= 0.9 else 1.0 - 0.75 * float(i) / float(points.size() - 1))
			for side: float in [-1.0, 1.0]:
				vertices.append(points[i])
				normals.append(along)
				uvs.append(Vector2(side, bright))
				uvs2.append(Vector2(line["width"], place))
			if i > 0:
				var at := first + i * 2
				indices.append_array(PackedInt32Array([at - 2, at - 1, at, at - 1, at + 1, at]))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_TEX_UV2] = uvs2
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.custom_aabb = AABB(Vector3(-1.0e6, -1.0e6, -1.0e6), Vector3(2.0e6, 2.0e6, 2.0e6))
	return mesh
