class_name TerrainBaker
extends Node
## Запекает рельеф: видеокарта один раз считает высоту и наклон каждой точки мира (шейдер bake.gdshader).
## Результат — текстура для отрисовки и высоты в памяти для камеры и объектов.

const BAKE_SHADER := preload("res://src/terrain/bake.gdshader")
const NO_WATER := -999.0  ## значение канала уровня воды там, где озера нет
const PROBE := Color(-1024.0, 0.25, -0.5, 2048.0)  ## проверочная точка в углу (её пишет шейдер запекания)
const ATTEMPTS := 3

var texture: ImageTexture
var height_map: HeightMap
var bake_ms := 0.0
var _image: Image
var _rect := Rect2()
var _texel := 2.0
var error := ""


## Сопрограмма. Возвращает true, если рельеф готов; иначе причина — в error.
func bake(world: WorldData, world_rect: Rect2, texel: float) -> bool:
	var size := Vector2i(roundi(world_rect.size.x / texel), roundi(world_rect.size.y / texel))
	var started := Time.get_ticks_usec()

	var viewport := SubViewport.new()
	viewport.size = size
	viewport.disable_3d = true
	viewport.use_hdr_2d = true
	viewport.transparent_bg = true
	viewport.render_target_clear_mode = SubViewport.CLEAR_MODE_ALWAYS
	viewport.render_target_update_mode = SubViewport.UPDATE_ONCE

	var material := ShaderMaterial.new()
	material.shader = BAKE_SHADER
	world.apply_height_uniforms(material)
	material.set_shader_parameter("bake_rect", Vector4(world_rect.position.x, world_rect.position.y, world_rect.size.x, world_rect.size.y))
	material.set_shader_parameter("texel", texel)

	var quad := ColorRect.new()
	quad.position = Vector2.ZERO
	quad.size = Vector2(size)
	quad.material = material
	viewport.add_child(quad)
	add_child(viewport)

	var image: Image = null
	for attempt in ATTEMPTS:
		viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
		await RenderingServer.frame_post_draw
		await RenderingServer.frame_post_draw
		image = viewport.get_texture().get_image()
		error = _validate(image, size)
		if error.is_empty():
			break
	viewport.queue_free()
	if not error.is_empty():
		return false

	# Проверочная точка своё дело сделала: ставим на её место соседнюю высоту.
	image.set_pixel(0, 0, image.get_pixel(1, 0))
	height_map = HeightMap.from_image(image, world_rect)
	if height_map == null:
		error = "не удалось прочитать высоты"
		return false
	_image = image
	_rect = world_rect
	_texel = texel
	# Уменьшенные копии нужны, чтобы свет на дальнем рельефе не рябил.
	image.generate_mipmaps()
	texture = ImageTexture.create_from_image(image)
	bake_ms = float(Time.get_ticks_usec() - started) / 1000.0
	return true


func _validate(image: Image, size: Vector2i) -> String:
	if image == null or image.is_empty():
		return "видеокарта не вернула рельеф"
	if image.get_width() != size.x or image.get_height() != size.y:
		return "рельеф неожиданного размера %d×%d" % [image.get_width(), image.get_height()]
	if image.get_format() != Image.FORMAT_RGBAH and image.get_format() != Image.FORMAT_RGBAF:
		return "видеорежим не поддерживает точные текстуры (формат %d)" % image.get_format()
	# В углу шейдер пишет условленные числа: отрицательные, больше единицы и в четвёртом канале.
	# Если они дошли без искажений — видеорежим отдаёт настоящие высоты.
	var probe := image.get_pixel(0, 0)
	if absf(probe.r - PROBE.r) > 0.5 or absf(probe.g - PROBE.g) > 0.01 or absf(probe.b - PROBE.b) > 0.01 or absf(probe.a - PROBE.a) > 0.5:
		return "проверочная точка рельефа: %.2f, %.2f, %.2f, %.2f вместо %.0f, %.2f, %.2f, %.0f" % [
				probe.r, probe.g, probe.b, probe.a, PROBE.r, PROBE.g, PROBE.b, PROBE.a]
	return ""


## Уровень воды озера в точке мира или NO_WATER, если озера там нет.
func water_level_at(point: Vector2) -> float:
	if _image == null:
		return NO_WATER
	var x := clampi(floori((point.x - _rect.position.x) / _texel), 0, _image.get_width() - 1)
	var y := clampi(floori((point.y - _rect.position.y) / _texel), 0, _image.get_height() - 1)
	return _image.get_pixel(x, y).a
