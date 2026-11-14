// Воздух (шаг 1.6 «Атмосфера и погода»): дымка — воздушная перспектива — и завесы дождя.
// Подключается после clouds.gdshaderinc (дождю нужна карта облаков).
//
// Дымка лежит слоем у моря и редеет с высотой. Сколько её между камерой и точкой, считается по пути луча сквозь
// этот слой: вниз с высоты дымки мало, вдоль моря к горизонту — много. Поэтому дальние острова тают постепенно,
// море у горизонта переходит в небо без линии, а земля под камерой остаётся ясной. Цвет дымки — цвет неба
// у горизонта в ту же сторону (с заревом и ореолом солнца): это рассеянный свет, а не серый фильтр.
//
// Дождь вдали — не струи, а полупрозрачная пелена в самом воздухе: по пути луча складывается, сколько на нём
// дождя. Густота берётся из карты облаков (льёт под толстыми тучами, с наклоном по ветру), её рвёт на струи
// объёмный шум. Чем длиннее путь сквозь дождь, тем плотнее пелена: вблизи земля видна, дальние острова уходят
// в завесу, а с большой высоты шторм виден пятнами пелены над морем. Молния подсвечивает дождь вокруг себя.
// Глубина кадра для этого не нужна (при сглаживании MSAA шейдеру её не дают): каждый материал считает пелену
// до своей точки сам.
//
// Один расчёт на всё: земля и вода (FOG = air(...)), небо (полоса у горизонта и море за краем света), облака.
// Всё, что появится в мире позже (города, корабли), должно звать air() так же. Числа — общие для всех шейдеров,
// их ставят day_light.gd и weather.gd.
global uniform vec4 haze_look; // x — густота у моря, 1/м; y — 1/высота слоя, 1/м; z — сила зарева; w — размах зарева
// Цвета здесь уже линейные (их переводит day_light.gd): общим числам-цветам движок перевод не делает.
global uniform vec4 haze_color; // цвет неба у горизонта
global uniform vec4 haze_glow_color; // цвет зарева
global uniform vec4 haze_sun; // xyz — направление на солнце; w — сила его ореола
global uniform vec4 haze_sun_color;

// Цвет неба у самого горизонта в сторону взгляда: в стороне солнца — зарево.
vec3 horizon_tint(vec3 horizon, vec3 glow_color, float glow, float reach, vec3 to_sun, vec3 direction) {
	vec2 flat_view = normalize(direction.xz + vec2(1.0e-5));
	vec2 flat_sun = normalize(to_sun.xz + vec2(1.0e-5));
	float toward = dot(flat_view, flat_sun) * 0.5 + 0.5;
	float side = pow(toward, mix(6.0, 0.6, reach));
	return mix(horizon, glow_color, clamp(glow * mix(0.25, 1.0, side), 0.0, 1.0));
}

// Ореол солнца: узкий — всегда, широкий — у низкого солнца (свет идёт сквозь толщу воздуха).
float sun_halo(float sun_angle, float sun_height) {
	return exp(-sun_angle * 9.0) * 0.55 + exp(-sun_angle * 2.4) * 0.14 * smoothstep(0.75, 0.2, sun_height);
}

// Сколько дымки на пути длиной distance от высоты from до высоты to (оптическая толщина).
float haze_depth(float from, float to, float distance) {
	float a = max(from, 0.0) * haze_look.y;
	float b = max(to, 0.0) * haze_look.y;
	float span = b - a;
	float mean = abs(span) < 1.0e-3 ? exp(-a) : (exp(-a) - exp(-b)) / span;
	return haze_look.x * distance * mean;
}

// Дымка между камерой и точкой мира: цвет и доля (0 — чисто, 1 — точка растворилась).
vec4 haze(vec3 eye, vec3 point) {
	vec3 ray = point - eye;
	float distance = length(ray);
	vec3 direction = ray / max(distance, 1.0e-3);
	vec3 to_sun = normalize(haze_sun.xyz);
	// Зарево — у горизонта; при взгляде круто вниз дымка светится ровным цветом неба, а не закатом.
	float level = smoothstep(0.8, 0.2, abs(direction.y));
	vec3 color = horizon_tint(haze_color.rgb, haze_glow_color.rgb, haze_look.z * level, haze_look.w, to_sun, direction);
	float sun_angle = acos(clamp(dot(direction, to_sun), -1.0, 1.0));
	color += haze_sun_color.rgb * haze_sun.w * sun_halo(sun_angle, to_sun.y) * 0.3;
	return vec4(color, 1.0 - exp(-haze_depth(eye.y, point.y, distance)));
}

// Дымка на луче в небо (direction.y > 0) — до края воздуха.
float haze_to_sky(float eye_height, float up) {
	return 1.0 - exp(-haze_look.x * exp(-max(eye_height, 0.0) * haze_look.y) / (haze_look.y * max(up, 1.0e-4)));
}

const int RAIN_STEPS = 6;
const float RAIN_FAR = 36000.0; // дальше дождь не считается: там уже всё в пелене и дымке
const float RAIN_DENSITY = 0.00016; // сколько света съедает метр пути сквозь ливень
const float RAIN_SHADE = 0.66; // пелена темнее неба у горизонта: завесы дождя читаются на его фоне
const vec3 FLASH_COLOR = vec3(0.62, 0.72, 1.0); // свет молнии в дожде и тучах
const float FLASH_REACH = 2200.0; // на таком расстоянии от разряда его свет в дожде слабеет в e раз, метры

// Завеса дождя на луче от камеры длиной far: x — доля пелены (0 — нет, 1 — сплошная), y — свет молнии в ней.
vec2 rain_veil(vec3 eye, vec3 direction, float far) {
	if (rain_look.x < 0.004) {
		return vec2(0.0);
	}
	// Дождь идёт ниже туч: выше этой высоты его нет.
	float start = 0.0;
	if (eye.y > RAIN_TOP) {
		if (direction.y > -1.0e-4) {
			return vec2(0.0);
		}
		start = (eye.y - RAIN_TOP) / -direction.y;
	} else if (direction.y > 1.0e-4) {
		far = min(far, (RAIN_TOP - eye.y) / direction.y);
	}
	far = min(far, start + RAIN_FAR);
	if (far <= start) {
		return vec2(0.0);
	}
	float span = far - start;
	float thickness = 0.0;
	float plain = 0.0; // то же без струй: по нему светит молния — ровно, без рисунка
	for (int i = 0; i < RAIN_STEPS; i++) {
		// Шаги гуще у камеры: там пелена меняется быстрее.
		float a = float(i) / float(RAIN_STEPS);
		float b = float(i + 1) / float(RAIN_STEPS);
		float from = start + span * a * a;
		float to = start + span * b * b;
		float middle = 0.5 * (from + to);
		vec3 p = eye + direction * middle;
		vec2 source = rain_source(p);
		float lod = clamp(log2((to - from) / 47.0) - 1.5, 0.0, 6.0);
		// Вблизи пелена рваная — струями; вдали струи сливаются в ровную завесу (иначе у горизонта вышел бы
		// частокол вертикальных полос).
		float streak = 0.5;
		if (middle < 7000.0) {
			streak = textureLod(cloud_noise, vec3(source.x / 950.0, rain_look.y * 0.012, source.y / 950.0), 0.0).r;
			streak = mix(streak, 0.5, smoothstep(1500.0, 7000.0, middle));
		}
		float here = rain_at(source, lod) * (to - from);
		plain += here;
		thickness += here * (0.25 + 1.5 * streak);
	}
	// Свет молнии в дожде: сколько луч проходит рядом с разрядом. Считается по формуле, а не шагами, —
	// свечение выходит гладким, без полос.
	float flare = 0.0;
	if (flash_at.w > 0.001) {
		vec3 to_flash = flash_at.xyz - eye;
		float along = dot(to_flash, direction);
		float aside = dot(to_flash, to_flash) - along * along;
		float reach = FLASH_REACH;
		float lit = 0.5 * (tanh(0.6 * (far - along) / reach) - tanh(0.6 * (start - along) / reach));
		flare = exp(-aside / (reach * reach)) * lit * plain / span * reach;
	}
	return vec2(1.0 - exp(-thickness * RAIN_DENSITY * rain_look.x), flare * RAIN_DENSITY * rain_look.x * 0.6);
}

// Положить завесу дождя поверх слоя (цвет, уже умноженный на плотность, и плотность).
vec4 under_rain(vec4 layer, vec3 mist_color, vec2 rain) {
	// Свет молнии в дожде прибавляется к пелене: его видно и там, где сама пелена ещё редкая.
	vec3 rain_color = mist_color * RAIN_SHADE;
	float cover = 1.0 - (1.0 - layer.a) * (1.0 - rain.x);
	float lit = min(rain.y * flash_at.w, 0.4);
	vec3 color = layer.rgb * (1.0 - rain.x) + rain_color * rain.x;
	return vec4(color * (1.0 - lit) + FLASH_COLOR * 1.6 * lit, 1.0 - (1.0 - cover) * (1.0 - lit));
}

// Воздух между камерой и точкой мира — дымка и дождь вместе: цвет и доля. Это и есть FOG материала.
vec4 air(vec3 eye, vec3 point) {
	vec4 mist = haze(eye, point);
	if (rain_look.x < 0.004) {
		return mist;
	}
	vec3 ray = point - eye;
	float distance = length(ray);
	vec4 layer = under_rain(vec4(mist.rgb * mist.a, mist.a), mist.rgb, rain_veil(eye, ray / max(distance, 1.0e-3), distance));
	return vec4(layer.rgb / max(layer.a, 1.0e-4), layer.a);
}
