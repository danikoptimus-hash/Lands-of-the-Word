class_name FloraModels
extends RefCounted
## Модели деревьев из файлов glTF (v2/assets/models/flora, правила — v2/assets/models/README.md).
##
## В файле вида (oliva.glb) — все его варианты, у каждого три объекта: oliva_01_LOD0, oliva_01_LOD1, oliva_01_LOD2 —
## один и тот же силуэт в трёх уровнях подробности. Здесь они читаются и получают материал игры (flora_model.gdshader) со своими текстурами:
## ветер, дымка, дождь и тени облаков — как у остальной растительности. Вид, для которого файла нет, остаётся
## с прежней моделью, слепленной кодом (flora_meshes.gd). Файлы делает v2/tools/models/make.py; модели из Blender
## по тем же правилам читаются так же.

const FOLDER := "res://assets/models/flora/"
const SHADER := preload("res://src/world/flora_model.gdshader")
## Имя файла по виду (как в памятке); пусто — модели из файла у вида нет.
const NAMES: Array[String] = ["dub", "sosna", "oliva", "kiparis", "palma", "tamarisk", "kust", "kust_suhoy", "kamen", ""]


## Модели всех видов: Vector2i(вид, вариант) → [сетка LOD0, сетка LOD1, сетка LOD2]. far_from и far_to — расстояния,
## на которых дальний уровень уходит (по дереву, а не разом).
static func load_all(noise: Texture2D, far_from: float, far_to: float) -> Dictionary:
	var result := {}
	for kind in NAMES.size():
		if NAMES[kind].is_empty():
			continue
		# Файл вида: в нём все варианты, объекты названы «вид_NN_LODk» (oliva_02_LOD1).
		var path := "%s%s.glb" % [FOLDER, NAMES[kind]]
		if not ResourceLoader.exists(path):
			continue
		var scene: PackedScene = load(path)
		if scene == null:
			continue
		var root := scene.instantiate()
		for variant in FloraMeshes.VARIANTS[kind]:
			var lods: Array[Mesh] = [null, null, null]
			for node in root.find_children("*", "MeshInstance3D", true, false):
				var instance: MeshInstance3D = node
				for level in 3:
					if String(instance.name) == "%s_%02d_LOD%d" % [NAMES[kind], variant + 1, level]:
						lods[level] = _prepare(instance.mesh, noise, level == 2, far_from, far_to)
			if lods[0] != null and lods[1] != null and lods[2] != null:
				result[Vector2i(kind, variant)] = lods
		root.free()
	return result


## Сетке модели — материалы игры: по одному на поверхность, с её текстурой.
static func _prepare(mesh: Mesh, noise: Texture2D, far: bool, far_from: float, far_to: float) -> Mesh:
	for surface in mesh.get_surface_count():
		var source := mesh.surface_get_material(surface) as BaseMaterial3D
		var material := ShaderMaterial.new()
		material.shader = SHADER
		material.set_shader_parameter("noise_map", noise)
		if source != null:
			material.set_shader_parameter("albedo_map", source.albedo_texture)
			material.set_shader_parameter("leafy", 1.0 if source.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED else 0.0)
		if far:
			material.set_shader_parameter("far_view", 1.0)
			material.set_shader_parameter("vanish", Vector2(far_from, far_to))
		mesh.surface_set_material(surface, material)
	return mesh


## Самый дальний уровень — импосторы (flora_far.gdshader): общая картинка изображений моделей и таблица клеток
## (их запекает ключ --bake-impostors). Возвращает словарь: "mesh" — единичная сетка из трёх четырёхугольников,
## "material" — материал, "cells" — Vector2i(вид, вариант) → Vector3(клетка вида сбоку, сторона снятого квадрата
## в метрах, высота вида сверху в долях квадрата). Пусто — картинки нет.
static func load_far(far_from: float, far_to: float) -> Dictionary:
	const ATLAS := "res://assets/models/flora_far.png"
	const TABLE := "res://data/flora_far.json"
	if not ResourceLoader.exists(ATLAS) or not FileAccess.file_exists(TABLE):
		return {}
	var table: Variant = JSON.parse_string(FileAccess.get_file_as_string(TABLE))
	if typeof(table) != TYPE_DICTIONARY:
		return {}
	var cells := {}
	for kind in NAMES.size():
		for variant in FloraMeshes.VARIANTS[kind]:
			var entry: Variant = (table["models"] as Dictionary).get("%s_%02d" % [NAMES[kind], variant + 1])
			if typeof(entry) == TYPE_DICTIONARY:
				cells[Vector2i(kind, variant)] = Vector3(float(entry["index"]), float(entry["size"]), float(entry["top"]))
	var material := ShaderMaterial.new()
	material.shader = load("res://src/world/flora_far.gdshader")
	material.set_shader_parameter("atlas", load(ATLAS))
	material.set_shader_parameter("grid", Vector2(float(table["columns"]), float(table["rows"])))
	material.set_shader_parameter("vanish", Vector2(far_from, far_to))
	# Единичная сетка: два четырёхугольника крест-накрест (вид сбоку, от земли вверх) и один плашмя (вид сверху).
	var vertices := PackedVector3Array()
	var uvs := PackedVector2Array()
	var kinds := PackedVector2Array()
	var indices := PackedInt32Array()
	var quads: Array = [
		[Vector3(-0.5, 0.0, 0.0), Vector3(0.5, 0.0, 0.0), Vector3(0.5, 1.0, 0.0), Vector3(-0.5, 1.0, 0.0), 0.0],
		[Vector3(0.0, 0.0, -0.5), Vector3(0.0, 0.0, 0.5), Vector3(0.0, 1.0, 0.5), Vector3(0.0, 1.0, -0.5), 0.0],
		[Vector3(-0.5, 0.5, 0.5), Vector3(0.5, 0.5, 0.5), Vector3(0.5, 0.5, -0.5), Vector3(-0.5, 0.5, -0.5), 1.0],
	]
	for quad: Array in quads:
		var first := vertices.size()
		for corner in 4:
			vertices.append(quad[corner])
			uvs.append([Vector2(0.0, 1.0), Vector2(1.0, 1.0), Vector2(1.0, 0.0), Vector2(0.0, 0.0)][corner])
			kinds.append(Vector2(quad[4], 0.0))
		indices.append_array(PackedInt32Array([first, first + 1, first + 2, first, first + 2, first + 3]))
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_TEX_UV2] = kinds
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.custom_aabb = AABB(Vector3(-0.6, -0.1, -0.6), Vector3(1.2, 1.2, 1.2))
	return {"mesh": mesh, "material": material, "cells": cells}


## Проверочный цвет уровней подробности (клавиша U): всем материалам моделей.
static func set_tint(models: Dictionary, tints: Array[Vector3]) -> void:
	for key: Vector2i in models:
		var lods: Array = models[key]
		for level in 3:
			var mesh: Mesh = lods[level]
			for surface in mesh.get_surface_count():
				(mesh.surface_get_material(surface) as ShaderMaterial).set_shader_parameter("lod_tint", tints[level])
