class_name Tour
extends RefCounted
## Облёт мира: набор положений камеры для автоматических кадров и замера скорости.
## Места выбираются по данным карты, поэтому облёт годится для любой партии.


class Stop:
	var name := ""  ## имя файла кадра
	var title := ""  ## что на кадре
	var view: CameraView
	var seconds := 3.0  ## сколько лететь сюда при замере


static func stops(world: WorldData, rig: StrategyCamera, height_map: HeightMap = null) -> Array[Stop]:
	var list: Array[Stop] = []
	list.append(_stop("01-ves-mir", "Весь мир", rig.view_for_rect(world.land_rect), 2.5))

	var number := 2
	var islands: Array = world.island_rects.keys()
	islands.sort()
	islands.reverse()  # «OT» раньше «NT»: сначала Ветхий Завет
	for island: String in islands:
		var area: Rect2 = world.island_rects[island]
		var title: String = WorldData.ISLAND_TITLES.get(island, island)
		list.append(_stop("%02d-ostrov-%s" % [number, island.to_lower()], "Остров «%s»" % title, rig.view_for_rect(area), 3.0))
		number += 1

	var mountain := _densest(world, WorldData.Terrain.MOUNTAINS)
	if mountain != null:
		list.append(_stop("%02d-gory" % number, "Горы", CameraView.make(mountain.center(), 560.0, 32.0, -6.0), 3.5))
		number += 1
		list.append(_stop("%02d-gory-vblizi" % number, "Горы вблизи, взгляд вдоль земли", CameraView.make(mountain.center() + Vector2(-60.0, 90.0), 300.0, -40.0, -14.0), 3.0))
		number += 1

	var hills := _densest(world, WorldData.Terrain.HILLS)
	if hills != null:
		list.append(_stop("%02d-holmy" % number, "Холмы", CameraView.make(hills.center(), 430.0, -25.0, -4.0), 3.0))
		number += 1

	var desert := _densest(world, WorldData.Terrain.DESERT)
	if desert != null:
		list.append(_stop("%02d-pustynya" % number, "Пустыня: барханы", CameraView.make(desert.center(), 380.0, 20.0, -6.0), 3.0))
		number += 1

	var lakes := world.cells_of(WorldData.Terrain.WATER)
	if not lakes.is_empty():
		list.append(_stop("%02d-ozero" % number, "Озеро", CameraView.make(lakes[0].center(), 330.0, 15.0, 0.0), 3.0))
		number += 1

	var port := _first_site(world, "port")
	if port != null:
		list.append(_stop("%02d-bereg" % number, "Берег и отмель у порта", CameraView.make(port.position, 420.0, -55.0, -8.0), 3.0))
		number += 1
		list.append(_stop("%02d-veshka" % number, "Самое близкое приближение: вешка города", CameraView.make(port.position, StrategyCamera.MIN_DISTANCE, 30.0, 0.0), 2.5))
		number += 1

	var cliff := _highest_coast(world, height_map)
	if cliff != null:
		# Смотрим с моря на берег: камера со стороны от центра острова.
		var island: Rect2 = world.island_rects.get(cliff.island, world.land_rect)
		var outward := (cliff.position - island.get_center()).normalized()
		var yaw := rad_to_deg(atan2(outward.x, outward.y))
		list.append(_stop("%02d-obryv" % number, "Высокий берег: обрыв к морю", CameraView.make(cliff.position, 420.0, yaw, -16.0), 3.0))
		number += 1
		list.append(_stop("%02d-obryv-sverhu" % number, "Тот же берег с суши", CameraView.make(cliff.position, 520.0, yaw + 150.0, -4.0), 3.0))
		number += 1

	var meadow := _densest(world, WorldData.Terrain.MEADOW)
	if meadow != null:
		list.append(_stop("%02d-sverhu" % number, "Взгляд сверху: сетка гексов", CameraView.make(meadow.center(), 900.0, 0.0, 30.0), 3.0))
		number += 1

	var centre := world.land_rect.get_center()
	list.append(_stop("%02d-gorizont" % number, "Взгляд к горизонту через пролив", CameraView.make(centre + Vector2(-600.0, 0.0), 1100.0, -90.0, -26.0), 3.5))
	number += 1
	# Наклон −90° заведомо больше допустимого: камера опускается к земле и поднимает взгляд до предела.
	list.append(_stop("%02d-nebo" % number, "Взгляд к небу: камера у земли, взгляд выше горизонта", CameraView.make(centre + Vector2(-600.0, 0.0), 1400.0, -90.0, -90.0), 3.0))
	number += 1
	if mountain != null:
		list.append(_stop("%02d-nebo-nad-gorami" % number, "Горы на фоне неба, вблизи", CameraView.make(mountain.center(), 420.0, 105.0, -90.0), 3.0))
	return list


static func _stop(file_name: String, title: String, view: CameraView, seconds: float) -> Stop:
	var stop := Stop.new()
	stop.name = file_name
	stop.title = title
	stop.view = view
	stop.seconds = seconds
	return stop


## Гекс местности, у которого больше всего соседей той же местности: середина хребта, пустыни и так далее.
static func _densest(world: WorldData, terrain: WorldData.Terrain) -> WorldData.Cell:
	var best: WorldData.Cell = null
	var best_count := -1
	for cell in world.cells_of(terrain):
		var count := world.same_neighbours(cell)
		if count > best_count:
			best = cell
			best_count = count
	return best


## Перекрёсток у берега на самой высокой земле: там берег обрывается к морю.
static func _highest_coast(world: WorldData, height_map: HeightMap) -> WorldData.Site:
	if height_map == null:
		return null
	var best: WorldData.Site = null
	var best_height := 20.0
	for site in world.sites:
		if not site.coastal:
			continue
		var height := height_map.sample(site.position)
		if height > best_height:
			best = site
			best_height = height
	return best


static func _first_site(world: WorldData, city_type: String) -> WorldData.Site:
	for site in world.sites:
		if site.city_type == city_type:
			return site
	return null
