class_name WaterLook
extends RefCounted
## Вид воды (шаг 1.5 «Океан»): числа для шейдера water.gdshader и текстуры ряби и пены.
##
## Вид один — «живое море»: владелец выбрал его 12.11 на тесте 0.7.0 из трёх (были ещё «спокойное» и «рисованное»)
## и попросил волны чуть замедлить, а шторм сделать сильнее — чтобы волны ощущались выше.
##
## Шторм (событие игры: в шторм участники видят только карту с бурей) — тот же набор чисел: STORM. Между штилем
## и штормом числа перетекают плавно (blend); скорость воды входит во время воды, а не в шейдер, поэтому при
## разгоне шторма рябь не прыгает. Размеры ряби и зыби в шторм те же — иначе рисунок волн поехал бы; высоту
## шторму дают большие волны (surge), которых в штиль просто нет.

## Штиль. Цвета — над отмелью, над глубиной моря и в глубине озера; остальное — см. параметры шейдера.
## Скорость (flow) была 1,3 — владелец попросил чуть медленнее.
const CALM := {
	"shallow_color": Color(0.1, 0.6, 0.66), "deep_color": Color(0.01, 0.1, 0.34), "lake_color": Color(0.015, 0.17, 0.34),
	"deepening": 0.06,
	"ripple": 0.9, "ripple_size": 11.0, "swell": 0.5, "swell_size": 150.0, "relief": 0.6, "flow": 1.0,
	"surge": 0.0, "swash": 0.06,
	"foam": 1.2, "foam_reach": 2.4, "foam_lines": 0.9, "foam_wash": 0.0, "whitecaps": 0.6, "streaks": 0.0,
	"glitter": 1.6, "sheen": 0.3, "gloss": 0.16,
}

## Шторм: вода тёмная и серая, рябь и зыбь сильнее, идут большие волны (тёмные ложбины, светлые гребни с пеной,
## полосы пены по ветру), у берега — взбитая вода и накат, блика нет. Скорость была 2,4: большие волны ходят
## тяжело, медленнее ряби.
const STORM := {
	"shallow_color": Color(0.17, 0.39, 0.4), "deep_color": Color(0.024, 0.078, 0.135), "lake_color": Color(0.032, 0.12, 0.18),
	"deepening": 0.06,
	"ripple": 1.6, "ripple_size": 11.0, "swell": 1.6, "swell_size": 150.0, "relief": 1.0, "flow": 1.7,
	"surge": 1.0, "swash": 0.45,
	"foam": 1.6, "foam_reach": 5.0, "foam_lines": 1.0, "foam_wash": 1.0, "whitecaps": 1.0, "streaks": 1.0,
	"glitter": 0.1, "sheen": 0.1, "gloss": 0.35,
}

const SHOT_TIME := 20.0  ## время воды в кадрах проверок, секунды: вода в них неподвижна
const WAVE_TEXELS := 512
const FOAM_TEXELS := 256


## Текстуры волн: бесшовный шум — высота поверхности (вторая текстура, одно число в точке) и её же наклоны
## (первая, r и g). Считаются один раз при запуске. По наклонам идёт рябь и зыбь; по высоте большие волны
## шторма темнеют в ложбинах и светлеют на гребнях.
static func make_wave_maps() -> Array[ImageTexture]:
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.seed = 7
	noise.frequency = 0.014
	noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	noise.fractal_octaves = 4
	noise.fractal_gain = 0.55
	var heights := noise.get_seamless_image(WAVE_TEXELS, WAVE_TEXELS, false, false, 0.25, true)
	var slopes: Image = heights.duplicate()
	slopes.bump_map_to_normal_map(5.0)
	slopes.generate_mipmaps(true)
	heights.generate_mipmaps()
	return [ImageTexture.create_from_image(slopes), ImageTexture.create_from_image(heights)]


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


## Вид воды при такой доле шторма (0 — штиль, 1 — шторм): числа и цвета — линейно.
static func at(storm: float) -> Dictionary:
	if storm <= 0.0:
		return CALM
	if storm >= 1.0:
		return STORM
	var result := {}
	for key: String in CALM:
		var from: Variant = CALM[key]
		if from is Color:
			result[key] = (from as Color).lerp(STORM[key], storm)
		else:
			result[key] = lerpf(from, STORM[key], storm)
	return result


## Записать вид в материал воды (скорость воды — не параметр шейдера: она входит во время воды).
static func apply(material: ShaderMaterial, look: Dictionary) -> void:
	for key: String in look:
		if key != "flow":
			material.set_shader_parameter(key, look[key])
