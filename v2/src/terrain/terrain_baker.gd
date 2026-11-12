class_name TerrainBaker
extends Node
## Запекает рельеф: видеокарта один раз считает высоту и наклон каждой точки мира (шейдер bake.gdshader).
## Результат — текстура для отрисовки и высоты в памяти для камеры и объектов.
## Тем же способом запекается описание земли для поверхностей (bake_ground.gdshader): что за земля в каждой точке, —
## и картинка земли (bake_surface.gdshader): какие материалы на ней лежат.

const BAKE_SHADER := preload("res://src/terrain/bake.gdshader")
const GROUND_SHADER := preload("res://src/terrain/bake_ground.gdshader")
const SURFACE_SHADER := preload("res://src/terrain/bake_surface.gdshader")
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
## ground_part: −1 — рельеф (высоты, наклон, уровень озёр); 0 и 1 — две текстуры описания земли (без высот в памяти).
func bake(world: WorldData, world_rect: Rect2, texel: float, ground_part := -1) -> bool:
	var material := ShaderMaterial.new()
	material.shader = BAKE_SHADER if ground_part < 0 else GROUND_SHADER
	if ground_part >= 0:
		material.set_shader_parameter("part", ground_part)
	world.apply_height_uniforms(material)
	return await _run(material, world_rect, texel, ground_part < 0, true)


## Сопрограмма: одна текстура картинки земли (номер part — см. bake_surface.gdshader). parameters — текстуры
## географии области и настройки правил. Результат забирается восьмибитной текстурой: take_texture().
func bake_surface(world_rect: Rect2, texel: float, part: int, parameters: Dictionary) -> bool:
	var material := ShaderMaterial.new()
	material.shader = SURFACE_SHADER
	for key: String in parameters:
		material.set_shader_parameter(key, parameters[key])
	material.set_shader_parameter("part", part)
	return await _run(material, world_rect, texel, false, false)


## Запечённое — восьмибитной текстурой (значения от нуля до единицы). Уменьшенные копии нужны только картинке
## дальнего вида: остальное читается вблизи, точка в точку.
func take_texture(mipmaps: bool) -> ImageTexture:
	_image.convert(Image.FORMAT_RGBA8)
	if mipmaps:
		_image.generate_mipmaps()
	var result := ImageTexture.create_from_image(_image)
	_image = null
	return result


func _run(material: ShaderMaterial, world_rect: Rect2, texel: float, with_heights: bool, finish: bool) -> bool:
	var size := Vector2i(roundi(world_rect.size.x / texel), roundi(world_rect.size.y / texel))
	var started := Time.get_ticks_usec()

	var viewport := SubViewport.new()
	viewport.size = size
	viewport.disable_3d = true
	viewport.use_hdr_2d = true
	viewport.transparent_bg = true
	viewport.render_target_clear_mode = SubViewport.CLEAR_MODE_ALWAYS
	viewport.render_target_update_mode = SubViewport.UPDATE_ONCE

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
	if with_heights:
		height_map = HeightMap.from_image(image, world_rect)
		if height_map == null:
			error = "не удалось прочитать высоты"
			return false
	_image = image
	_rect = world_rect
	_texel = texel
	if finish:
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


## Запечённая картинка: по высотам рельефа считается сток воды (drainage.gd).
func baked_image() -> Image:
	return _image


## Уровень воды озера в точке мира или NO_WATER, если озера там нет.
func water_level_at(point: Vector2) -> float:
	if _image == null:
		return NO_WATER
	var x := clampi(floori((point.x - _rect.position.x) / _texel), 0, _image.get_width() - 1)
	var y := clampi(floori((point.y - _rect.position.y) / _texel), 0, _image.get_height() - 1)
	return _image.get_pixel(x, y).a
