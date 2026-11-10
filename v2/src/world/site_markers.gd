class_name SiteMarkers
extends Node3D
## Вешки на местах городов и точек старта. Это не города, а разметка «в глине»:
## по ним видно масштаб мира и где будут стоять города (сами города — шаг 1.10).

const CITY_RADIUS := 22.0
const CITY_HEIGHT := 6.0
const START_RADIUS := 12.0
const START_HEIGHT := 30.0


func build(world: WorldData, height_map: HeightMap) -> void:
	var cities: Array[Vector2] = []
	var starts: Array[Vector2] = []
	for site in world.sites:
		if site.kind == "CITY":
			cities.append(site.position)
		elif site.kind == "START":
			starts.append(site.position)

	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.55, 0.43, 0.36)
	material.roughness = 0.9

	var plinth := CylinderMesh.new()
	plinth.top_radius = CITY_RADIUS * 0.88
	plinth.bottom_radius = CITY_RADIUS
	plinth.height = CITY_HEIGHT
	plinth.radial_segments = 24
	plinth.rings = 1
	plinth.material = material
	_scatter(plinth, cities, height_map, CITY_HEIGHT)

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
