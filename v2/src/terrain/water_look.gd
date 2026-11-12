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
## Скорость воды и высота наката — отдельно (SPEED, SWASH): владелец подобрал их ползунками на тесте 0.7.2.

## Штиль. Цвета — над отмелью, над глубиной моря и в глубине озера; остальное — см. параметры шейдера.
const CALM := {
	"shallow_color": Color(0.1, 0.6, 0.66), "deep_color": Color(0.01, 0.1, 0.34), "lake_color": Color(0.015, 0.17, 0.34),
	"deepening": 0.06, "murk": 0.35,
	"ripple": 0.9, "ripple_size": 1.535, "swell": 0.5, "swell_size": 20.9, "relief": 0.6,
	"foam": 1.2, "foam_reach": 2.4, "foam_lines": 0.9, "foam_wash": 0.0, "whitecaps": 0.6,
	"glitter": 1.6, "sheen": 0.3, "gloss": 0.16,
}

## Шторм: вода тёмная и серая, рябь и зыбь сильнее, барашки, у берега — взбитая вода, блика нет.
const STORM := {
	"shallow_color": Color(0.175, 0.3975, 0.4125), "deep_color": Color(0.026, 0.084, 0.148), "lake_color": Color(0.0325, 0.121, 0.186),
	"deepening": 0.06, "murk": 0.9,
	"ripple": 1.62, "ripple_size": 1.535, "swell": 1.6, "swell_size": 20.9, "relief": 0.85,
	"foam": 1.6, "foam_reach": 4.3, "foam_lines": 1.0, "foam_wash": 1.0, "whitecaps": 1.0,
	"glitter": 0.1, "sheen": 0.1, "gloss": 0.35,
}

## Скорость воды (во сколько раз время воды идёт быстрее часов) и высота наката на берег (метры) — в ясную погоду
## (x) и в шторм (y). Числа владельца, подобранные ползунками на тесте 0.7.2 (12.11): скорость 0,40 и 1,00, накат
## 1,20 и 1,20. (Скорость была 1,3 и 2,4 в 0.7.0, 1,0 и 1,7 в 0.7.1 — оба раза «неестественно быстро».)
const SPEED := Vector2(0.4, 1.0)
const SWASH := Vector2(1.2, 1.2)

const SHOT_TIME := 20.0  ## время воды в кадрах проверок, секунды: вода в них неподвижна

## Текстуры ряби и пятен — бесшовный шум, плитка. Чем больше волн шума укладывается в плитку, тем реже плитка
## повторяется на экране: в 0.7.0–0.7.2 в плитке было 7 и 5,6 волны, и рябь с волной полтора метра повторялась
## каждые 11 метров — издали владелец видел «закономерность повторения рисунка моря».
const WAVE_TEXELS := 1024
const WAVE_CYCLES := 42.0
const FOAM_TEXELS := 1024
const FOAM_CYCLES := 40.0
## Среднее и разброс значений прежних текстур (512 и 256 точек, обе растянуты на весь диапазон): вид воды принят
## с ними, а у большой плитки после растяжения разброс меньше (крайние значения дальше от среднего). Новые
## текстуры приводятся к этим числам: рябь — силой наклона, пятна — множителем и сдвигом в шейдере.
const WAVE_SPREAD := 0.1566
const FOAM_MEAN := 0.4958
const FOAM_SPREAD := 0.1562


## Текстура ряби: бесшовный шум, переведённый в наклоны поверхности (r, g). Считается один раз при запуске.
static func make_wave_map() -> ImageTexture:
	var image := noise_image(7, WAVE_TEXELS, WAVE_CYCLES, 4, 0.55)
	var spread := mean_and_spread(image).y
	# Сила наклона: та же, что у прежней текстуры (5 при 7,2 волны на 512 точек), с поправкой на длину волны
	# в точках текстуры и на разброс высот.
	image.bump_map_to_normal_map(5.0 * (0.014 * 512.0 / 512.0) / (WAVE_CYCLES / float(WAVE_TEXELS)) * WAVE_SPREAD / maxf(spread, 0.01))
	image.generate_mipmaps(true)
	return ImageTexture.create_from_image(image)


## Текстура пятен (пена, барашки, дно): бесшовный шум, одно число в точке. Вместе с ней — множитель и сдвиг,
## которыми шейдер приводит её значения к прежним среднему и разбросу: [текстура, множитель, сдвиг].
static func make_foam_map() -> Array:
	var image := noise_image(23, FOAM_TEXELS, FOAM_CYCLES, 4, 0.6)
	var stats := mean_and_spread(image)
	var gain := FOAM_SPREAD / maxf(stats.y, 0.01)
	image.generate_mipmaps()
	return [ImageTexture.create_from_image(image), gain, FOAM_MEAN - stats.x * gain]


## Бесшовный шум: столько волн на плитку, столько слоёв (каждый следующий вдвое мельче и слабее в gain раз).
static func noise_image(seed_value: int, texels: int, cycles: float, octaves: int, gain: float) -> Image:
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.seed = seed_value
	noise.frequency = cycles / float(texels)
	noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	noise.fractal_octaves = octaves
	noise.fractal_gain = gain
	var image := noise.get_seamless_image(texels, texels, false, false, 0.25, true)
	if image.get_format() != Image.FORMAT_L8:
		image.convert(Image.FORMAT_L8)
	return image


## Среднее (x) и разброс (y) значений картинки из одного числа в точке, в долях единицы. По каждой тринадцатой точке.
static func mean_and_spread(image: Image) -> Vector2:
	var data := image.get_data()
	var total := 0.0
	var squares := 0.0
	var count := 0
	for i in range(0, image.get_width() * image.get_height(), 13):
		var value := float(data[i]) / 255.0
		total += value
		squares += value * value
		count += 1
	var mean := total / float(count)
	return Vector2(mean, sqrt(maxf(squares / float(count) - mean * mean, 0.0)))


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
