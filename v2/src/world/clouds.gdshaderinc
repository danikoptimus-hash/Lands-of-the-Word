// Облака (шаг 1.6 «Атмосфера и погода»): одна карта облаков на всё — по ней небо рисует сами облака (объёмом,
// sky.gdshader), а дождь знает, где лить. Теней на земле и море облака не кладут: решение владельца 12.11.
//
// Карта (assets/weather/cloud_map.png, её считает tools/weather/make.py) — плитка 48 км, плывёт по ветру:
// R — толщина отдельных кучевых облаков ясной погоды, G — толщина туч шторма (сплошной слой с грозовыми башнями),
// B — где в шторм льёт сильнее. Облако занимает высоты от низа слоя до низа плюс толщина.
//
// Низ слоя всегда выше камеры (решение владельца 12.11: облаков под камерой не бывает): когда камера
// поднимается, слой поднимается вместе с ней.
//
// Числа — общие для всех шейдеров («global uniform», описаны в project.godot, каждый кадр их ставит weather.gd):
// так движение облаков не трогает материалы, и небо не пересчитывается для отражений.
global uniform vec4 cloud_drift; // xy — на сколько облака ушли по ветру, метры; z — сдвиг объёмного шума
global uniform vec4 cloud_look; // x — высота низа облаков, м; y — доля шторма; z — толщина кучевых (множитель)
global uniform vec3 cloud_eye; // где камера (небу нужно знать, над чем мы стоим)
global uniform float rain_wet; // мокрая земля под дождём, 0…1
global uniform vec4 rain_look; // x — сила дождя, 0…1; y — время падения, с; z — наклон струй по ветру; w — высота камеры над землёй, м
global uniform vec4 flash_at; // молния: xyz — где, w — яркость сейчас

uniform sampler2D cloud_map : filter_linear_mipmap, repeat_enable;
uniform sampler3D cloud_noise : filter_linear_mipmap, repeat_enable; // объёмный шум: края облаков и струи в завесах дождя

const float CLOUD_TILE = 48000.0; // плитка карты, метры
const float CLEAR_DEPTH = 2200.0; // толщина кучевого облака при значении карты 1, метры
const float STORM_DEPTH = 3400.0; // то же для туч шторма
const float STORM_SAG = 360.0; // настолько в шторм низ туч провисает клубами
const float RAIN_TOP = 1900.0; // дождь идёт ниже этой высоты (низ туч над морем), метры
const vec2 WIND = vec2(0.867, 0.498); // куда дует ветер (по x и z); то же — WIND в weather.gd

// Столб облаков по значению карты: x — верх над низом слоя, y — низ (в шторм провисает), метры.
// Тучи шторма приходят не пеленой разом: сначала грозовые башни, потом слой между ними.
vec2 cloud_column(vec3 map) {
	float storm = cloud_look.y;
	float cut = (1.0 - storm) * 0.9;
	float deck = STORM_DEPTH * max(map.g - cut, 0.0) / (1.0 - cut) * smoothstep(0.0, 0.12, storm);
	float cumulus = map.r * CLEAR_DEPTH * cloud_look.z;
	return vec2(max(cumulus, deck), -map.r * STORM_SAG * storm);
}

// Где в шторм идёт дождь (x, z): 0 — сухо, 1 — ливень. Слабый дождь идёт везде, сильный — под толстыми тучами.
float rain_at(vec2 ground, float lod) {
	float heavy = textureLod(cloud_map, (ground - cloud_drift.xy) / CLOUD_TILE, lod).b;
	return mix(0.1, 1.0, heavy);
}

// Куда летит капля: вниз и по ветру (единичный вектор).
vec3 rain_fall() {
	return normalize(vec3(WIND.x * rain_look.z, -1.0, WIND.y * rain_look.z));
}

// Точка низа тучи, из которой выпала капля, пролетающая через точку мира: по ней дождь знает свою густоту —
// так завесы дождя висят под своими тучами с наклоном по ветру.
vec2 rain_source(vec3 point) {
	vec3 fall = rain_fall();
	return point.xz + fall.xz * (RAIN_TOP - point.y) / fall.y;
}
