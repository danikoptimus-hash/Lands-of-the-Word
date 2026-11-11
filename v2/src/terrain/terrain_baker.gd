class_name TerrainBaker
extends Node
## Запекает рельеф: видеокарта один раз считает высоту и наклон каждой точки мира (шейдер bake.gdshader).
## Результат — текстура для отрисовки и высоты в памяти для камеры и объектов.

const BAKE_SHADER := preload("res://src/terrain/bake.gdshader")
const OPEN_SEA := -30.0  ## глубина открытого моря в функции высот: по ней проверяем, что запекание прошло верно
const ATTEMPTS := 3

var texture: ImageTexture
var height_map: HeightMap
var bake_ms := 0.0
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
	world.apply_hex_uniforms(material)
	material.set_shader_parameter("noise_offset", world.noise_offset())
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

	height_map = HeightMap.from_image(image, world_rect)
	if height_map == null:
		error = "не удалось прочитать высоты"
		return false
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
	# Угол области — открытое море: там функция высот даёт ровно OPEN_SEA.
	var corner := image.get_pixel(1, 1).r
	if absf(corner - OPEN_SEA) > 0.1:
		return "проверочная точка рельефа: %.2f вместо %.2f" % [corner, OPEN_SEA]
	return ""
