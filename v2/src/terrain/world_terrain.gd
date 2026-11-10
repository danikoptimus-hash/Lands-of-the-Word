class_name WorldTerrain
extends Node3D
## Земля и вода мира. Рельеф запекается один раз, рисуется плитками с уровнями детализации:
## рядом с камерой сетка плотная, вдали — редкая.

const CLAY_SHADER := preload("res://src/terrain/terrain_clay.gdshader")
const WATER_SHADER := preload("res://src/terrain/water_clay.gdshader")

const CHUNK := 256.0  ## сторона плитки, метры
const TEXEL := 2.0  ## точность запекания, метров на точку
const MARGIN := 520.0  ## запас моря вокруг суши
const LOD_CELLS: Array[int] = [64, 32, 16, 8]  ## клеток на сторону плитки по уровням
const LOD_DISTANCE: Array[float] = [750.0, 1600.0, 3400.0]  ## до какого расстояния держится уровень
const LOD_HYSTERESIS := 1.08  ## чтобы уровни не мигали на границе
const SKIRT := 24.0
const DEEP_CUTOFF := -24.0  ## плитки глубже этого не строим: дно не видно сквозь воду
const SEA_SIZE := 200000.0  ## море уходит за горизонт: его край тонет в дымке


class Chunk:
	var instance: MeshInstance3D
	var center := Vector3.ZERO
	var lod := -1


var height_map: HeightMap
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
	baker.queue_free()
	if not ok:
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
	_build_lakes(world)
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
			chunk.lod = lod
			chunk.instance.mesh = _lod_meshes[lod]


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


func _build_chunks(columns: int, rows: int) -> void:
	var coarsest := _lod_meshes.size() - 1
	for row in rows:
		for column in columns:
			var origin := Vector2(bake_rect.position.x + float(column) * CHUNK, bake_rect.position.y + float(row) * CHUNK)
			var heights := height_map.range_in(Rect2(origin, Vector2(CHUNK, CHUNK)))
			if heights.y < DEEP_CUTOFF:
				continue
			var instance := MeshInstance3D.new()
			instance.mesh = _lod_meshes[coarsest]
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
			chunk.lod = coarsest
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


## Озёра и пруды оазисов: у каждого свой уровень воды — чуть ниже самого низкого берега.
func _build_lakes(world: WorldData) -> void:
	var lake_disc := _make_disc(HexMath.APOTHEM - 6.0)
	var pond_disc := _make_disc(36.0)
	for cell in world.cells:
		if cell.terrain != WorldData.Terrain.WATER and cell.terrain != WorldData.Terrain.OASIS:
			continue
		var is_lake := cell.terrain == WorldData.Terrain.WATER
		var centre := cell.center()
		var ring := HexMath.APOTHEM - 8.0 if is_lake else 34.0
		var shore := INF
		for i in 32:
			var angle := TAU * float(i) / 32.0
			shore = minf(shore, height_map.sample(centre + Vector2(cos(angle), sin(angle)) * ring))
		var level := shore - (1.0 if is_lake else 0.5)
		if level <= height_map.sample(centre) + 0.3:
			continue  # чаша не получилась (например, у самого берега моря) — воды нет
		var water := MeshInstance3D.new()
		water.mesh = lake_disc if is_lake else pond_disc
		water.material_override = _water_material
		water.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		water.position = Vector3(centre.x, level, centre.y)
		water.set_instance_shader_parameter("water_level", level)
		add_child(water)


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
