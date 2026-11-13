class_name SiteMarkers
extends Node3D
## Города и точки старта на карте. Город — черновая модель настоящего размера (city_model.gd, проба масштаба 13.11):
## по ней видно, как город сидит рядом с лесом, полями и гексом в километр. Точка старта — вешка. Сами города —
## шаг 1.10.

const CITY_RADIUS := CityModel.RADIUS
const CITY_HEIGHT := CityModel.WALL_HEIGHT
const START_RADIUS := 12.0
const START_HEIGHT := 30.0

var city_count := 0


func build(world: WorldData, height_map: HeightMap) -> void:
	var starts: Array[Vector2] = []
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.55, 0.43, 0.36)
	material.roughness = 0.9

	var city_material := StandardMaterial3D.new()
	city_material.vertex_color_use_as_albedo = true
	city_material.vertex_color_is_srgb = true
	city_material.roughness = 0.93
	city_material.metallic_specular = 0.2
	city_count = 0
	for site in world.sites:
		if site.kind == "START":
			starts.append(site.position)
		if site.kind != "CITY":
			continue
		# У каждого города свой поворот — от его места на карте: ворота смотрят в разные стороны.
		var turn := float(posmod(hash(Vector2i(site.position)), 628)) / 100.0
		var mesh := CityModel.build_mesh(site.position, turn, height_map)
		if mesh == null:
			continue
		mesh.surface_set_material(0, city_material)
		var instance := MeshInstance3D.new()
		instance.mesh = mesh
		instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		add_child(instance)
		city_count += 1

	var pole := CylinderMesh.new()
	pole.top_radius = 0.0
	pole.bottom_radius = START_RADIUS
	pole.height = START_HEIGHT
	pole.radial_segments = 16
	pole.rings = 1
	pole.material = material
	_scatter(pole, starts, height_map, START_HEIGHT)


func _scatter(mesh: Mesh, points: Array[Vector2], height_map: HeightMap, mesh_height: float) -> void:
	if points.is_empty():
		return
	var multimesh := MultiMesh.new()
	multimesh.transform_format = MultiMesh.TRANSFORM_3D
	multimesh.mesh = mesh
	multimesh.instance_count = points.size()
	for i in points.size():
		var point := points[i]
		# Вешка чуть утоплена в землю, чтобы на склоне под ней не было щели.
		var ground := maxf(height_map.sample(point), 0.0)
		multimesh.set_instance_transform(i, Transform3D(Basis.IDENTITY, Vector3(point.x, ground + mesh_height * 0.5 - 2.0, point.y)))
	var instance := MultiMeshInstance3D.new()
	instance.multimesh = multimesh
	add_child(instance)
