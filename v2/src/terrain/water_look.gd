class_name WaterLook
extends RefCounted
## Вид воды (шаг 1.5 «Океан»): числа для шейдера water.gdshader и текстуры ряби и пены.
##
## На время выбора владельцем видов несколько (клавиша J); после выбора останется один.
##
## Шторм (событие игры: в шторм участники видят только карту с бурей) — тот же набор чисел, выведенный из вида
## штиля (storm_of): волнение сильнее, вода темнее и серее, прибой шире, барашки, блика нет. Между штилем и
## штормом числа перетекают плавно (blend); скорость воды входит во время воды, а не в шейдер, поэтому
## при разгоне шторма рябь не прыгает.

## Виды. Цвета — над отмелью, над глубиной моря и в глубине озера; остальное — см. параметры шейдера.
const LOOKS: Array[Dictionary] = [
	{
		"title": "спокойное море",
		"shallow_color": Color(0.13, 0.66, 0.67), "deep_color": Color(0.015, 0.14, 0.38), "lake_color": Color(0.02, 0.2, 0.36),
		"deepening": 0.045, "bands": 0.0,
		"ripple": 0.55, "ripple_size": 14.0, "swell": 0.18, "swell_size": 170.0, "relief": 0.45, "flow": 1.0,
		"foam": 1.0, "foam_reach": 1.0, "foam_lines": 0.3, "foam_grain": 1.0, "foam_wash": 0.0, "whitecaps": 0.0,
		"glitter": 1.0, "sheen": 0.2, "gloss": 0.18,
	},
	{
		"title": "живое море",
		"shallow_color": Color(0.1, 0.6, 0.66), "deep_color": Color(0.01, 0.1, 0.34), "lake_color": Color(0.015, 0.17, 0.34),
		"deepening": 0.06, "bands": 0.0,
		"ripple": 0.9, "ripple_size": 11.0, "swell": 0.5, "swell_size": 150.0, "relief": 0.6, "flow": 1.3,
		"foam": 1.2, "foam_reach": 2.4, "foam_lines": 0.9, "foam_grain": 1.0, "foam_wash": 0.0, "whitecaps": 0.6,
		"glitter": 1.6, "sheen": 0.3, "gloss": 0.16,
	},
	{
		"title": "рисованное море",
		"shallow_color": Color(0.2, 0.74, 0.72), "deep_color": Color(0.03, 0.2, 0.5), "lake_color": Color(0.04, 0.26, 0.46),
		"deepening": 0.05, "bands": 1.0,
		"ripple": 0.2, "ripple_size": 18.0, "swell": 0.08, "swell_size": 190.0, "relief": 0.25, "flow": 0.8,
		"foam": 1.3, "foam_reach": 1.8, "foam_lines": 1.0, "foam_grain": 0.15, "foam_wash": 0.0, "whitecaps": 0.0,
		"glitter": 0.5, "sheen": 0.12, "gloss": 0.24,
	},
]

const SHOT_TIME := 20.0  ## время воды в кадрах проверок, секунды: вода в них неподвижна
const WAVE_TEXELS := 512
const FOAM_TEXELS := 256


## Текстура ряби: бесшовный шум, переведённый в наклоны поверхности (r, g). Считается один раз при запуске.
static func make_wave_map() -> ImageTexture:
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.seed = 7
	noise.frequency = 0.014
	noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	noise.fractal_octaves = 4
	noise.fractal_gain = 0.55
	var image := noise.get_seamless_image(WAVE_TEXELS, WAVE_TEXELS, false, false, 0.25, true)
	image.bump_map_to_normal_map(5.0)
	image.generate_mipmaps(true)
	return ImageTexture.create_from_image(image)


## Текстура пятен (пена, барашки, оттенки моря): бесшовный шум, одно число в точке.
static func make_foam_map() -> ImageTexture:
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.seed = 23
	noise.frequency = 0.022
	noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	noise.fractal_octaves = 4
	noise.fractal_gain = 0.6
	var image := noise.get_seamless_image(FOAM_TEXELS, FOAM_TEXELS, false, false, 0.25, true)
	image.generate_mipmaps()
	return ImageTexture.create_from_image(image)


## Вид той же воды в шторм.
static func storm_of(look: Dictionary) -> Dictionary:
	var storm := look.duplicate()
	storm["shallow_color"] = (look["shallow_color"] as Color).lerp(Color(0.2, 0.33, 0.33), 0.75)
	storm["deep_color"] = (look["deep_color"] as Color).lerp(Color(0.03, 0.08, 0.1), 0.8)
	storm["lake_color"] = (look["lake_color"] as Color).lerp(Color(0.04, 0.1, 0.12), 0.7)
	storm["ripple"] = maxf(float(look["ripple"]) * 1.8, 0.9)
	storm["swell"] = 1.6
	storm["relief"] = 0.85
	storm["foam"] = 1.6
	storm["foam_reach"] = float(look["foam_reach"]) * 1.3 + 1.2
	storm["foam_lines"] = 1.0
	storm["foam_grain"] = maxf(float(look["foam_grain"]), 0.6)
	storm["foam_wash"] = 1.0
	storm["whitecaps"] = 1.0
	storm["glitter"] = 0.1
	storm["sheen"] = 0.1
	storm["gloss"] = 0.35
	storm["flow"] = 2.4
	return storm


## Смесь двух видов: числа и цвета — линейно.
static func blend(a: Dictionary, b: Dictionary, weight: float) -> Dictionary:
	if weight <= 0.0:
		return a
	if weight >= 1.0:
		return b
	var result := {}
	for key: String in a:
		var from: Variant = a[key]
		if from is Color:
			result[key] = (from as Color).lerp(b[key], weight)
		elif from is float:
			result[key] = lerpf(from, b[key], weight)
		else:
			result[key] = from
	return result


## Записать вид в материал воды (скорость воды — не параметр шейдера: она входит во время воды).
static func apply(material: ShaderMaterial, look: Dictionary) -> void:
	for key: String in look:
		if key != "title" and key != "flow":
			material.set_shader_parameter(key, look[key])
