class_name WaterLook
extends RefCounted
## Вид воды (шаг 1.5 «Океан»): числа для шейдера water.gdshader и текстуры ряби и пены.
##
## Вид один — «живое море»: владелец выбрал его 12.11 на тесте 0.7.0 из трёх (были ещё «спокойное» и «рисованное»).
##
## Шторм (событие игры: в шторм участники видят только карту с бурей) — тот же набор чисел: STORM. Между штилем
## и штормом числа перетекают плавно (at); скорость воды входит во время воды, а не в шейдер, поэтому при
## разгоне шторма рябь не прыгает. Размеры ряби и зыби в шторм те же — иначе рисунок волн поехал бы.
##
## Вид шторма — тот, что был в 0.7.0: в 0.7.1 к нему добавлялись большие волны (тёмные ложбины, светлые гребни
## в пене), владелец попросил вернуть прежний.
##
## Скорость воды и высота наката — отдельно (SPEED, SWASH): владелец подбирает их ползунками на экране
## (клавиша U) и называет числа.

## Штиль. Цвета — над отмелью, над глубиной моря и в глубине озера; остальное — см. параметры шейдера.
const CALM := {
	"shallow_color": Color(0.1, 0.6, 0.66), "deep_color": Color(0.01, 0.1, 0.34), "lake_color": Color(0.015, 0.17, 0.34),
	"deepening": 0.06, "murk": 0.35,
	"ripple": 0.9, "ripple_size": 11.0, "swell": 0.5, "swell_size": 150.0, "relief": 0.6,
	"foam": 1.2, "foam_reach": 2.4, "foam_lines": 0.9, "foam_wash": 0.0, "whitecaps": 0.6,
	"glitter": 1.6, "sheen": 0.3, "gloss": 0.16,
}

## Шторм: вода тёмная и серая, рябь и зыбь сильнее, барашки, у берега — взбитая вода, блика нет.
const STORM := {
	"shallow_color": Color(0.175, 0.3975, 0.4125), "deep_color": Color(0.026, 0.084, 0.148), "lake_color": Color(0.0325, 0.121, 0.186),
	"deepening": 0.06, "murk": 0.9,
	"ripple": 1.62, "ripple_size": 11.0, "swell": 1.6, "swell_size": 150.0, "relief": 0.85,
	"foam": 1.6, "foam_reach": 4.3, "foam_lines": 1.0, "foam_wash": 1.0, "whitecaps": 1.0,
	"glitter": 0.1, "sheen": 0.1, "gloss": 0.35,
}

## Скорость воды (во сколько раз время воды идёт быстрее часов) и высота наката на берег (метры) — в ясную погоду
## и в шторм. В 0.7.0 скорость была 1,3 и 2,4, в 0.7.1 — 1,0 и 1,7: владельцу оба раза быстро. Здесь — числа,
## с которых начинают ползунки; окончательные назовёт владелец.
const SPEED := Vector2(0.5, 1.0)
const SWASH := Vector2(0.5, 1.2)
## Пределы ползунков.
const SPEED_MAX := 2.5
const SWASH_MAX := 2.5

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


## Текстура пятен (пена, барашки, дно, оттенки моря): бесшовный шум, одно число в точке.
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


## Записать вид в материал воды.
static func apply(material: ShaderMaterial, look: Dictionary) -> void:
	for key: String in look:
		material.set_shader_parameter(key, look[key])
