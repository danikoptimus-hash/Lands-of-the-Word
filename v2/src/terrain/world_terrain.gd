class_name WorldTerrain
extends Node3D
## Земля и вода мира. Рельеф запекается один раз, рисуется плитками с уровнями детализации:
## рядом с камерой сетка плотная, вдали — редкая.

const CLAY_SHADER := preload("res://src/terrain/terrain_clay.gdshader")
const WATER_SHADER := preload("res://src/terrain/water_clay.gdshader")

const CHUNK := 256.0  ## сторона плитки, метры
const TEXEL := 2.0  ## точность запекания, метров на точку
const MARGIN := 520.0  ## запас моря вокруг суши
const LOD_CELLS: Array[int] = [64, 32, 16]  ## клеток на сторону плитки по уровням: шаг сетки 4, 8 и 16 м
const LOD_DISTANCE: Array[float] = [1100.0, 2600.0]  ## до какого расстояния держится уровень
const LOD_HYSTERESIS := 1.08  ## чтобы уровни не мигали на границе
const SKIRT := 24.0
const DEEP_CUTOFF := -24.0  ## плитки глубже этого не строим: дно не видно сквозь воду
const SEA_SIZE := 200000.0  ## море уходит за горизонт: его край тонет в дымке


class Chunk:
	var instance: MeshInstance3D
	var center := Vector3.ZERO
	var lod := -1


var height_map: HeightMap
var lakes: Array[Dictionary] = []  ## озёра и пруды: клетка и уровень воды
var bake_rect := Rect2()
var bake_ms := 0.0
var error := ""

var _material: ShaderMaterial
var _water_material: ShaderMaterial
var _lod_meshes: Array[ArrayMesh] = []
var _chunks: Array[Chunk] = []
var _viewer := Vector3.ZERO
var _viewer_known := false
var _grid_visible := true


## Сопрограмма: строит землю по данным мира. true — готово, иначе причина в error.
func build(world: WorldData) -> bool:
	var land := world.land_rect.grow(MARGIN)
	var x0 := floorf(land.position.x / CHUNK) * CHUNK
	var z0 := floorf(land.position.y / CHUNK) * CHUNK
	var columns := ceili((land.end.x - x0) / CHUNK)
	var rows := ceili((land.end.y - z0) / CHUNK)
	bake_rect = Rect2(x0, z0, float(columns) * CHUNK, float(rows) * CHUNK)

	var baker := TerrainBaker.new()
	add_child(baker)
	var ok: bool = await baker.bake(world, bake_rect, TEXEL)
	error = baker.error
	bake_ms = baker.bake_ms
	height_map = baker.height_map
	var texture := baker.texture
	if not ok:
		baker.queue_free()
		return false

	var rect_uniform := Vector4(bake_rect.position.x, bake_rect.position.y, bake_rect.size.x, bake_rect.size.y)
	_material = ShaderMaterial.new()
	_material.shader = CLAY_SHADER
	world.apply_hex_uniforms(_material)
	_material.set_shader_parameter("height_map", texture)
	_material.set_shader_parameter("normal_map", texture)
	_material.set_shader_parameter("bake_rect", rect_uniform)
	_material.set_shader_parameter("skirt_depth", SKIRT)
	_material.set_shader_parameter("grid_strength", 0.5 if _grid_visible else 0.0)

	_water_material = ShaderMaterial.new()
	_water_material.shader = WATER_SHADER
	_water_material.set_shader_parameter("height_map", texture)
	_water_material.set_shader_parameter("bake_rect", rect_uniform)

	for cells in LOD_CELLS:
		_lod_meshes.append(_make_grid(cells, CHUNK))
	_build_chunks(columns, rows)
	_build_sea()
	_build_lakes(world, baker)
	baker.queue_free()
	return true


## Откуда смотрит камера: от этого зависит детализация плиток.
func set_viewer(position_in_world: Vector3) -> void:
	if _viewer_known and position_in_world.distance_squared_to(_viewer) < 16.0:
		return
	_viewer = position_in_world
	_viewer_known = true
	for chunk in _chunks:
		var lod := _pick_lod(_viewer.distance_to(chunk.center), chunk.lod)
		if lod != chunk.lod:
			_set_lod(chunk, lod)


func set_grid_visible(visible_now: bool) -> void:
	_grid_visible = visible_now
	if _material != null:
		_material.set_shader_parameter("grid_strength", 0.5 if visible_now else 0.0)


func is_grid_visible() -> bool:
	return _grid_visible


func chunk_count() -> int:
	return _chunks.size()


func _pick_lod(distance: float, current: int) -> int:
	for i in LOD_DISTANCE.size():
		var limit := LOD_DISTANCE[i]
		if current >= 0 and current <= i:
			limit *= LOD_HYSTERESIS
		if distance < limit:
			return i
	return LOD_DISTANCE.size()


## Сетка плитки и сглаживание высот под её шаг: высоты берутся из уменьшенной копии запечённого рельефа.
func _set_lod(chunk: Chunk, lod: int) -> void:
	chunk.lod = lod
	chunk.instance.mesh = _lod_meshes[lod]
	chunk.instance.set_instance_shader_parameter("height_lod", float(lod))


func _build_chunks(columns: int, rows: int) -> void:
	var coarsest := _lod_meshes.size() - 1
	for row in rows:
		for column in columns:
			var origin := Vector2(bake_rect.position.x + float(column) * CHUNK, bake_rect.position.y + float(row) * CHUNK)
			var heights := height_map.range_in(Rect2(origin, Vector2(CHUNK, CHUNK)))
			if heights.y < DEEP_CUTOFF:
				continue
			var instance := MeshInstance3D.new()
			instance.material_override = _material
			instance.position = Vector3(origin.x, 0.0, origin.y)
			# Высоту точкам даёт шейдер, поэтому границы плитки для отсечения задаём сами.
			instance.custom_aabb = AABB(
					Vector3(0.0, heights.x - SKIRT - 2.0, 0.0),
					Vector3(CHUNK, heights.y - heights.x + SKIRT + 4.0, CHUNK))
			add_child(instance)
			var chunk := Chunk.new()
			chunk.instance = instance
			chunk.center = Vector3(origin.x + CHUNK * 0.5, (heights.x + heights.y) * 0.5, origin.y + CHUNK * 0.5)
			_set_lod(chunk, coarsest)
			_chunks.append(chunk)


func _build_sea() -> void:
	var plane := PlaneMesh.new()
	plane.size = Vector2(SEA_SIZE, SEA_SIZE)
	var sea := MeshInstance3D.new()
	sea.name = "Sea"
	sea.mesh = plane
	sea.material_override = _water_material
	sea.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sea.position = Vector3(bake_rect.get_center().x, 0.0, bake_rect.get_center().y)
	sea.set_instance_shader_parameter("water_level", 0.0)
	add_child(sea)


## Озёра и пруды оазисов. Форму и уровень воды задаёт функция высот: уровень запечён рядом с высотой.
## Вода — плоский круг на этом уровне; шейдер рисует его только в котловине своего озера.
## Соседние водные клетки с общим уровнем — одно озеро: на них один круг, иначе вода легла бы в два слоя.
func _build_lakes(world: WorldData, baker: TerrainBaker) -> void:
	lakes.clear()
	var levels := {}  # клетка Vector2i(q, r) → уровень воды
	var is_lake := {}
	for cell in world.cells:
		if cell.terrain != WorldData.Terrain.WATER and cell.terrain != WorldData.Terrain.OASIS:
			continue
		var level := _find_water_level(baker, cell.center())
		if level <= TerrainBaker.NO_WATER + 1.0:
			continue
		var at := Vector2i(cell.q, cell.r)
		levels[at] = level
		is_lake[at] = cell.terrain == WorldData.Terrain.WATER
		lakes.append({"q": cell.q, "r": cell.r, "lake": is_lake[at], "level": level})

	var seen := {}
	for start: Vector2i in levels:
		if seen.has(start):
			continue
		var level: float = levels[start]
		var group: Array[Vector2i] = [start]
		seen[start] = true
		var index := 0
		while index < group.size():
			var at := group[index]
			index += 1
			for step: Vector2i in [Vector2i(1, 0), Vector2i(1, -1), Vector2i(0, -1), Vector2i(-1, 0), Vector2i(-1, 1), Vector2i(0, 1)]:
				var next := at + step
				if levels.has(next) and not seen.has(next) and absf(float(levels[next]) - level) < 0.02:
					seen[next] = true
					group.append(next)
		var centre := Vector2.ZERO
		var with_lake := false
		for at in group:
			centre += HexMath.center(at.x, at.y)
			with_lake = with_lake or bool(is_lake[at])
		centre /= float(group.size())
		var reach := 0.0
		for at in group:
			reach = maxf(reach, centre.distance_to(HexMath.center(at.x, at.y)))
		var water := MeshInstance3D.new()
		water.mesh = _make_disc(reach + (HexMath.SIZE * 2.4 if with_lake else 70.0))
		water.material_override = _water_material
		water.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		water.position = Vector3(centre.x, level, centre.y)
		water.set_instance_shader_parameter("water_level", level)
		add_child(water)


## Уровень воды озера клетки: ищем его рядом с центром гекса, расходясь кругами (чаша смещена от центра).
func _find_water_level(baker: TerrainBaker, centre: Vector2) -> float:
	for ring in 6:
		var points := maxi(ring * 8, 1)
		for i in points:
			var angle := TAU * float(i) / float(points)
			var level := baker.water_level_at(centre + Vector2(cos(angle), sin(angle)) * float(ring) * 9.0)
			if level > TerrainBaker.NO_WATER + 1.0:
				return level
	return TerrainBaker.NO_WATER


## Плоская сетка плитки. Высоту точкам даёт шейдер; по краю — «юбка» (UV.x = 1), закрывающая щели.
static func _make_grid(cells: int, size: float) -> ArrayMesh:
	var side := cells + 1
	var step := size / float(cells)
	var vertices := PackedVector3Array()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()
	for z in side:
		for x in side:
			vertices.append(Vector3(float(x) * step, 0.0, float(z) * step))
			uvs.append(Vector2.ZERO)
	for z in cells:
		for x in cells:
			var a := z * side + x
			var b := a + 1
			var c := a + side
			var d := c + 1
			indices.append_array(PackedInt32Array([a, b, c, b, d, c]))

	var north := PackedInt32Array()
	var south := PackedInt32Array()
	var west := PackedInt32Array()
	var east := PackedInt32Array()
	for i in side:
		north.append(i)
		south.append((side - 1) * side + i)
		west.append(i * side)
		east.append(i * side + side - 1)
	var borders: Array[PackedInt32Array] = [north, south, west, east]
	for border in borders:
		var first := vertices.size()
		for index in border:
			vertices.append(vertices[index])
			uvs.append(Vector2(1.0, 0.0))
		for i in border.size() - 1:
			var top_a := border[i]
			var top_b := border[i + 1]
			var low_a := first + i
			var low_b := first + i + 1
			# Обе стороны: юбку видно с любой стороны плитки.
			indices.append_array(PackedInt32Array([top_a, top_b, low_a, top_b, low_b, low_a]))
			indices.append_array(PackedInt32Array([top_a, low_a, top_b, top_b, low_a, low_b]))

	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


static func _make_disc(radius: float) -> ArrayMesh:
	var segments := 40
	var vertices := PackedVector3Array([Vector3.ZERO])
	var indices := PackedInt32Array()
	for i in segments:
		var angle := TAU * float(i) / float(segments)
		vertices.append(Vector3(cos(angle) * radius, 0.0, sin(angle) * radius))
	for i in segments:
		# По часовой стрелке, если смотреть сверху: лицевая сторона — вверх.
		indices.append_array(PackedInt32Array([0, 1 + i, 1 + (i + 1) % segments]))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh
