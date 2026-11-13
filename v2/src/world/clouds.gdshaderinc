// Облака (шаг 1.6 «Атмосфера и погода», третья переделка — задание владельца 13.11): объёмные облака в координатах
// мира. Здесь — общее для всех шейдеров: где облако есть и насколько оно плотное (cloud_density), сколько облака
// между точкой и светилом (cloud_light_depth), тень облаков на земле (cloud_shade) и где идёт дождь.
// Рисует облака отдельный проход (cloud_pass.gdshader), на кадр их кладёт cloud_composite.gdshader.
//
// Слой облаков стоит на своей высоте над морем (а не «всегда выше камеры», как в 0.8.x): кучевые — низ около
// 1400 м, тучи шторма — около 1000 м, перистые — 8,6 км. Камера может быть под облаками, в них и над ними.
//
// Карта (assets/weather/cloud_map.png, считает tools/weather/make.py) — плитка 48 км, плывёт по ветру:
// R — где стоят кучевые облака ясной погоды («присутствие»: 1 — середина облачной массы, к краю 0),
// A — «развитие» облака (насколько оно высокое) ровной площадкой на всё облако, G — тучи шторма (слой и грозовые
// башни), B — где в шторм льёт сильнее. Форму карта не задаёт: клубы лепит объёмный шум (cloud_noise.png,
// четыре канала: R — форма, шум Перлина — Ворли; G — башни; B — мелкие клочья; A — плавный шум).
//
// Числа — общие для всех шейдеров («global uniform», описаны в project.godot, каждый кадр их ставит weather.gd).
global uniform vec4 cloud_drift; // xy — на сколько облака ушли по ветру, метры; z — «кипение»: сдвиг объёмного шума
global uniform vec4 cloud_look; // x — облачность ясной погоды (множитель); y — доля шторма; z — насколько облака видны камере над ними
global uniform vec3 cloud_eye; // где камера
global uniform vec4 cloud_sun; // xyz — на светило; w — сила тени облаков на земле, 0…1
global uniform float rain_wet; // насколько намокла земля под дождём, 0…1
global uniform vec4 rain_look; // x — сила дождя, 0…1; y — время падения, с; z — наклон струй по ветру; w — высота камеры над землёй
global uniform vec4 flash_at; // молния: xyz — где, w — яркость сейчас

uniform sampler2D cloud_map : filter_linear_mipmap, repeat_enable;
uniform sampler3D cloud_noise : filter_linear_mipmap, repeat_enable;

const float CLOUD_TILE = 48000.0; // плитка карты, метры
const float CUMULUS_BASE = 1400.0; // низ кучевых облаков над морем, метры
const float CUMULUS_DEPTH = 2600.0; // наибольшая толщина кучевого облака
const float STORM_BASE = 1000.0; // низ туч шторма
const float STORM_SAG = 320.0; // настолько низ туч провисает валами
const float STORM_DECK = 2200.0; // толщина сплошного слоя туч
const float STORM_DEPTH = 6800.0; // толщина грозовой башни (верх — около 7,8 км)
const float CIRRUS_HEIGHT = 8600.0; // высота перистых облаков
const float SHAPE_TILE = 5800.0; // плитка шума формы, метры: клубы от 180 до 1500 м
const float DETAIL_TILE = 1500.0; // плитка шума мелких клочьев: от 60 до 250 м
const float RAIN_TOP = 1000.0; // дождь идёт ниже этой высоты (низ туч над морем), метры
const vec2 WIND = vec2(0.867, 0.498); // куда дует ветер (по x и z); то же — WIND в weather.gd

// Границы слоя облаков по высоте сейчас: x — низ, y — верх (метры над морем).
vec2 cloud_slab() {
	float storm = cloud_look.y;
	float low = storm > 0.01 ? STORM_BASE - STORM_SAG - 60.0 : CUMULUS_BASE - 80.0;
	float high = max(CUMULUS_BASE + CUMULUS_DEPTH, storm > 0.01 ? STORM_BASE + STORM_DEPTH : 0.0);
	return vec2(low, high);
}

// Плотность облака в точке мира, 0…1; level — высота точки внутри своего облака: 0 (низ) … 1 (верх).
// lod — насколько грубо читать карту и шум (дальние шаги, пробы к свету); fine — «обгрызать» край мелким шумом.
//
// Облако — там, где шум формы, умноженный на профиль по высоте, выше порога; порог тем ниже, чем больше
// «присутствие» по карте. Поэтому в середине облачной массы стоит тело из сросшихся клубов, к краю от него
// остаются отдельные клубы, а верх — не купол и не конус: каждая башня кончается на своей высоте, там, где её
// клуб шума перестаёт перекрывать порог. Низ почти ровный (так у настоящих кучевых), но не срез: у низа край
// «обгрызается» сильнее и клочьями.
float cloud_density(vec3 p, float lod, bool fine, out float level) {
	level = 0.0;
	float storm = cloud_look.y;
	vec2 map_at = (p.xz - cloud_drift.xy) / CLOUD_TILE;
	vec4 map = textureLod(cloud_map, map_at, lod);
	vec3 churn = vec3(cloud_drift.z, 0.0, cloud_drift.z * 0.6);
	float result = 0.0;
	float erode = 0.46;
	// ── Кучевые ясной погоды (в шторм их сменяют тучи) ──
	float cover = map.r * cloud_look.x * (1.0 - smoothstep(0.3, 0.85, storm));
	if (cover > 0.012 && p.y > CUMULUS_BASE - 80.0 && p.y < CUMULUS_BASE + CUMULUS_DEPTH) {
		vec4 wide = textureLod(cloud_noise, vec3(p.x / 9000.0, 0.37, p.z / 9000.0) + churn * 0.5, lod * 0.5);
		float depth = max(CUMULUS_DEPTH * map.a * mix(0.6, 1.0, wide.g), 150.0);
		float base = CUMULUS_BASE + 120.0 * (wide.a - 0.5);
		float h = (p.y - base) / depth;
		if (h > 0.0 && h < 1.0) {
			float shape = textureLod(cloud_noise, p / SHAPE_TILE + churn, lod * 0.7).r;
			float profile = smoothstep(0.0, 0.1, h) * smoothstep(1.0, 0.4, h);
			float threshold = 1.0 - 0.78 * cover;
			// Для самого облака край резче, для проб к свету (fine выключен) — мягче: тень внутри облака ложится
			// плавно, без полос.
			result = clamp((shape * profile - threshold) / (1.0 - threshold) * (fine ? 2.6 : 1.5), 0.0, 1.0);
			level = h;
		}
	}
	// ── Тучи шторма: сплошной слой и грозовые башни; приходят не пеленой разом — сначала башни ──
	if (storm > 0.01 && p.y > STORM_BASE - STORM_SAG - 60.0) {
		// Толщина туч читается с грубого уровня карты (точка — 750 м). Поле толщины плавное, а в карте восемь бит:
		// с шагом карты 47 м соседние точки равны, и высота низа и верха туч ложилась площадками — на тучах
		// проступали «горизонтали» (гребёнка). На грубом уровне соседние точки различаются, переход между ними плавный.
		float cut = (1.0 - storm) * 0.9;
		float thick = max(textureLod(cloud_map, map_at, max(lod, 4.0)).g - cut, 0.0) / (1.0 - cut);
		if (thick > 0.004) {
			vec4 wide = textureLod(cloud_noise, vec3(p.x / 7600.0, 0.61, p.z / 7600.0) + churn * 0.5, lod * 0.5);
			float tower = smoothstep(0.5, 0.9, thick);
			float base = STORM_BASE - STORM_SAG * wide.a * smoothstep(0.15, 0.6, thick);
			float depth = mix(700.0, STORM_DECK, smoothstep(0.0, 0.45, thick)) + (STORM_DEPTH - STORM_DECK) * tower * mix(0.65, 1.0, wide.g);
			float h = (p.y - base) / depth;
			if (h > 0.0 && h < 1.0) {
				float shape = textureLod(cloud_noise, p / (SHAPE_TILE * 1.7) + churn, lod * 0.7).r;
				float profile = smoothstep(0.0, 0.05, h) * smoothstep(1.0, 0.55, h);
				// Наковальня: у вершины грозовой башни облако растекается вширь плоской шапкой.
				float anvil = tower * smoothstep(0.7, 0.86, h) * (1.0 - smoothstep(0.92, 1.0, h));
				float threshold = mix(0.5, 0.14, smoothstep(0.0, 0.3, thick));
				float deck = clamp((max(shape * profile, 0.75 * anvil) - threshold) / (1.0 - threshold) * 1.8, 0.0, 1.0)
						* smoothstep(0.0, 0.1, storm);
				if (deck > result) {
					result = deck;
					level = h;
					erode = 0.26;
				}
			}
		}
	}
	if (fine && result > 0.0) {
		// Мелкие клочья по краю: у низа — прядями (шум наизнанку), выше — клубами.
		float detail = textureLod(cloud_noise, p / DETAIL_TILE - churn * 2.0, lod * 0.7).b;
		if (erode < 0.3) {
			// Тучи шторма «обгрызает» плавный шум покрупнее, а не ячеистый: на ровном низе и на шапке тучи ячейки
			// одного размера читались рябью-«гребёнкой».
			detail = mix(textureLod(cloud_noise, p / 3100.0 + churn, lod * 0.7).a, detail, 0.2);
		}
		float ragged = mix(1.0 - detail, detail, clamp(level * 5.0, 0.0, 1.0)) * erode * mix(1.6, 1.0, clamp(level * 4.0, 0.0, 1.0));
		result = clamp((result - ragged * (1.0 - result)) / (1.0 - ragged * 0.6), 0.0, 1.0);
	}
	return result;
}

// Сколько облака между точкой и светилом — «метры плотного облака» (четыре пробы с растущим шагом, без мелких
// клочьев). По нему считается самозатенение: сторона к светилу светлая, глубина и дальняя сторона темнее.
// spread — множитель шага проб (у каждой точки экрана чуть свой: пробы не складываются в полосы на облаке).
float cloud_light_depth(vec3 p, vec3 to_light, float lod, float spread) {
	float level;
	return cloud_density(p + to_light * (60.0 * spread), lod, false, level) * 90.0
			+ cloud_density(p + to_light * (170.0 * spread), lod + 0.5, false, level) * 150.0
			+ cloud_density(p + to_light * (380.0 * spread), lod + 1.0, false, level) * 280.0
			+ cloud_density(p + to_light * (820.0 * spread), lod + 1.5, false, level) * 540.0;
}

// Сколько тучи над точкой (шторм): по нему низ туч светлее там, где слой тонкий (свет неба пробивается),
// и темнее под грозовыми башнями.
float cloud_above_depth(vec3 p, float lod, float spread) {
	float level;
	return cloud_density(p + vec3(0.0, 500.0 * spread, 0.0), lod + 1.0, false, level) * 700.0
			+ cloud_density(p + vec3(0.0, 1500.0 * spread, 0.0), lod + 1.5, false, level) * 1300.0
			+ cloud_density(p + vec3(0.0, 3600.0 * spread, 0.0), lod + 2.0, false, level) * 2600.0;
}

// Тень облаков на земле: доля прямого света, дошедшая до точки (1 — солнце, меньше — под облаком). Мягкая:
// читается размытая карта облаков в той точке слоя, через которую идёт луч от точки к светилу. Движется вместе
// с облаками. В шторм отдельных теней нет — всё небо закрыто, свет и так рассеянный.
float cloud_shade(vec3 point) {
	if (cloud_sun.w <= 0.001 || cloud_sun.y < 0.04) {
		return 1.0;
	}
	vec2 at = point.xz + cloud_sun.xz * ((CUMULUS_BASE + 500.0 - point.y) / cloud_sun.y);
	vec4 map = textureLod(cloud_map, (at - cloud_drift.xy) / CLOUD_TILE, 2.0);
	float shape = textureLod(cloud_noise, vec3(at.x, 600.0, at.y) / SHAPE_TILE + vec3(cloud_drift.z, 0.0, cloud_drift.z * 0.6), 1.5).r;
	float cover = map.r * cloud_look.x * (1.0 - smoothstep(0.3, 0.85, cloud_look.y));
	return 1.0 - cloud_sun.w * smoothstep(0.3, 0.8, cover * (0.5 + shape));
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
