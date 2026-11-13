// Общая часть неба сцены сравнения: формула фона неба и объёмные облака. Основа — образец Godot Volumetric
// Cloud Demo (https://github.com/clayjohn/godot-volumetric-cloud-demo, лицензия MIT, автор — clayjohn),
// версия 6f5ecab; наши правки помечены словом «ПРАВКА».
//
// Cloud Raymarching based on: A. Schneider. “The Real-Time Volumetric Cloudscapes Of Horizon: Zero Dawn”. ACM SIGGRAPH. Los Angeles, CA: ACM SIGGRAPH, 2015. Web. 26 Aug. 2015.
//
// ПРАВКА: файл подключается из трёх шейдеров — неба с прямым расчётом облаков (nebo.gdshader), картинки купола
// (kupol.gdshader) и неба, которое эту картинку показывает (nebo_kupol.gdshader). Направление, сила и цвет солнца
// приходят именами SUN_DIR, SUN_POWER, SUN_COLOR: в шейдерах неба это встроенные значения светила, в шейдере
// купола — обычные числа.

uniform sampler3D worlnoise : filter_linear_mipmap, repeat_enable;
uniform sampler3D perlworlnoise : filter_linear_mipmap, repeat_enable;
uniform sampler2D weathermap : filter_linear_mipmap, repeat_enable;

uniform vec2 wind_direction = vec2(1, 0);
uniform float wind_speed :hint_range(0.0, 20.0) = 1.0;
uniform float _density : hint_range(0.01, 0.2) = 0.05;
uniform float cloud_coverage :hint_range(0.1, 1.0) = 0.25;
uniform float _time_offset : hint_range(0.0, 1000.0, 0.5) = 0.0;
// ПРАВКА: доля шагов луча от полного числа — уровень качества (меньше шагов — быстрее и грубее).
uniform float steps_scale : hint_range(0.25, 1.0) = 1.0;
// ПРАВКА: где облака растворяются в дымке у горизонта (доли: 1 − высота направления взгляда).
uniform vec2 horizon_fade = vec2(0.86, 0.985);
// ПРАВКА: насыщенность синевы и светлая дымка у горизонта — подгонка фона под утверждённый образец
// (кадры Unreal владельца): формула неба сама даёт блёклую зеленоватую синеву и серый горизонт.
uniform float sky_saturation : hint_range(0.5, 2.0) = 1.0;
uniform vec3 haze_color = vec3(0.62, 0.59, 0.50);
uniform float haze_strength : hint_range(0.0, 1.0) = 0.0;
uniform float haze_power : hint_range(1.0, 40.0) = 9.4;
// ПРАВКА: размер пятен карты погоды (в образце — 0.00006: пятно в четыре километра давало одно огромное
// облако на полнеба) и время облаков числом — чтобы проверочные кадры были повторимы.
uniform float weather_scale = 0.00006;
uniform float sky_time = 0.0;
// ПРАВКА: место камеры в мире, метры. В образце небо — купол вокруг неподвижной точки; с местом камеры облака
// смещаются при полёте над картой и приближаются при подъёме, как настоящие. Высота ограничена ниже кромки облаков.
uniform vec3 camera_place = vec3(0.0);
// ПРАВКА: яркость облаков (свет солнца в облаке и рассеянный свет) — тоже под образец.
uniform float cloud_sun : hint_range(0.0, 4.0) = 1.0;
uniform float cloud_ambient : hint_range(0.0, 4.0) = 1.0;
// ПРАВКА: плавное насыщение яркости облака вместо обрезки (0 — как в образце, обрезка): в сторону солнца
// облака не выгорают в ровное белое пятно, а сохраняют светотень.
uniform float cloud_shoulder : hint_range(0.0, 4.0) = 0.0;
// ПРАВКА: предел яркости «в сторону солнца» (в образце облако против солнца в одиннадцать раз ярче, чем сбоку,
// и выгорает; в настоящем облаке многократное рассеяние эту разницу сглаживает). 10 — как в образце.
uniform float phase_cap : hint_range(0.05, 10.0) = 10.0;
// ПРАВКА: оттенок света облаков (в образце Unreal светлые места чуть тёплые) и оттенок самого солнечного
// света в облаке: на закате формула даёт свет почти без синего, и облака выходят горчичными, а не персиковыми.
uniform vec3 cloud_tint = vec3(1.0);
uniform vec3 sun_tint = vec3(1.0);
// ПРАВКА: собственный рассеянный свет толщи облака — цвет, темнее которого плотное облако не бывает. В образце
// низ сплошной облачности выходил чёрным: свет солнца сквозь толщу не проходит, а рассеянного почти нет.
// Низкие части облака темнее высоких — так у сплошной облачности остаётся рисунок, а не ровная пелена.
uniform vec3 cloud_floor = vec3(0.0);

// Approximately earth sizes
const float g_radius = 6000000.0; //ground radius
// ПРАВКА: высоты слоя облаков над землёй — числами (в образце кромка 1500 м, верх 4000 м).
uniform float cloud_bottom = 1500.0;
uniform float cloud_top = 4000.0;

uniform float rayleigh : hint_range(0, 64) = 2.0;
uniform vec4 rayleigh_color : source_color = vec4(0.26, 0.41, 0.58, 1.0);
uniform float mie : hint_range(0, 1) = 0.005;
uniform float mie_eccentricity : hint_range(-1, 1) = 0.8;
uniform vec4 mie_color : source_color = vec4(0.63, 0.77, 0.92, 1.0);

uniform float turbidity : hint_range(0, 1000) = 10.0;
uniform float sun_disk_scale : hint_range(0, 360) = 1.0;
uniform vec4 ground_color : source_color = vec4(1.0);
uniform float exposure : hint_range(0, 128) = 0.1;

const vec3 UP = vec3( 0.0, 1.0, 0.0 );

// Sun constants
const float SOL_SIZE = 0.00872663806;
const float SUN_ENERGY = 1000.0;

// optical length at zenith for molecules
const float rayleigh_zenith_size = 8.4e3;
const float mie_zenith_size = 1.25e3;

// From: https://www.shadertoy.com/view/4sfGzS credit to iq
float hash(vec3 p) {
	p  = fract( p * 0.3183099 + 0.1 );
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// Utility function that maps a value from one range to another. 
float remap(float originalValue,  float originalMin,  float originalMax,  float newMin,  float newMax) {
	return newMin + (((originalValue - originalMin) / (originalMax - originalMin)) * (newMax - newMin));
}

// Phase function
float henyey_greenstein(float cos_theta, float g) {
	const float k = 0.0795774715459;
	return k * (1.0 - g * g) / (pow(1.0 + g * g - 2.0 * g * cos_theta, 1.5));
}

// Simple Analytic sky. In a real project you should use a texture
vec3 atmosphere(vec3 eye_dir) {
	float zenith_angle = clamp( dot(UP, normalize(SUN_DIR)), -1.0, 1.0 );
	float sun_energy = max(0.0, 1.0 - exp(-((PI * 0.5) - acos(zenith_angle)))) * SUN_ENERGY * SUN_POWER;
	float sun_fade = 1.0 - clamp(1.0 - exp(SUN_DIR.y), 0.0, 1.0);

	// Rayleigh coefficients.
	float rayleigh_coefficient = rayleigh - ( 1.0 * ( 1.0 - sun_fade ) );
	vec3 rayleigh_beta = rayleigh_coefficient * rayleigh_color.rgb * 0.0001;
	// mie coefficients from Preetham
	vec3 mie_beta = turbidity * mie * mie_color.rgb * 0.000434;

	// optical length
	float zenith = acos(max(0.0, dot(UP, eye_dir)));
	float optical_mass = 1.0 / (cos(zenith) + 0.15 * pow(93.885 - degrees(zenith), -1.253));
	float rayleigh_scatter = rayleigh_zenith_size * optical_mass;
	float mie_scatter = mie_zenith_size * optical_mass;

	// light extinction based on thickness of atmosphere
	vec3 extinction = exp(-(rayleigh_beta * rayleigh_scatter + mie_beta * mie_scatter));

	// in scattering
	float cos_theta = dot(eye_dir, normalize(SUN_DIR));

	float rayleigh_phase = (3.0 / (16.0 * PI)) * (1.0 + pow(cos_theta * 0.5 + 0.5, 2.0));
	vec3 betaRTheta = rayleigh_beta * rayleigh_phase;

	float mie_phase = henyey_greenstein(cos_theta, mie_eccentricity);
	vec3 betaMTheta = mie_beta * mie_phase;

	vec3 Lin = pow(sun_energy * ((betaRTheta + betaMTheta) / (rayleigh_beta + mie_beta)) * (1.0 - extinction), vec3(1.5));
	// Hack from https://github.com/mrdoob/three.js/blob/master/examples/jsm/objects/Sky.js
	Lin *= mix(vec3(1.0), pow(sun_energy * ((betaRTheta + betaMTheta) / (rayleigh_beta + mie_beta)) * extinction, vec3(0.5)), clamp(pow(1.0 - zenith_angle, 5.0), 0.0, 1.0));

	// Hack in the ground color
	Lin  *= mix(ground_color.rgb, vec3(1.0), smoothstep(-0.1, 0.1, dot(UP, eye_dir)));

	// Solar disk and out-scattering
	float sunAngularDiameterCos = cos(SOL_SIZE * sun_disk_scale);
	float sunAngularDiameterCos2 = cos(SOL_SIZE * sun_disk_scale*0.5);
	float sundisk = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos2, cos_theta);
	vec3 L0 = (sun_energy * 1900.0 * extinction) * sundisk * SUN_COLOR;
	// Note: Add nightime here: L0 += night_sky * extinction

	vec3 color = (Lin + L0) * 0.04;
	color = pow(color, vec3(1.0 / (1.2 + (1.2 * sun_fade))));
	color *= exposure;
	return color;
}

// ПРАВКА: фон неба для экрана — формула выше плюс насыщенность и дымка у горизонта.
vec3 background_sky(vec3 eye_dir) {
	vec3 color = atmosphere(eye_dir);
	float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
	color = max(vec3(0.0), mix(vec3(luma), color, sky_saturation));
	float haze = pow(1.0 - clamp(eye_dir.y, 0.0, 1.0), haze_power) * haze_strength;
	return mix(color, haze_color, haze);
}

float GetHeightFractionForPoint(float inPosition) { 
	float height_fraction = (inPosition - (g_radius + cloud_bottom)) / (cloud_top - cloud_bottom);
	return clamp(height_fraction, 0.0, 1.0);
}

vec4 mixGradients(float cloudType){
	const vec4 STRATUS_GRADIENT = vec4(0.02f, 0.05f, 0.09f, 0.11f);
	const vec4 STRATOCUMULUS_GRADIENT = vec4(0.02f, 0.2f, 0.48f, 0.625f);
	const vec4 CUMULUS_GRADIENT = vec4(0.01f, 0.0625f, 0.78f, 1.0f);
	float stratus = 1.0f - clamp(cloudType * 2.0f, 0.0, 1.0);
	float stratocumulus = 1.0f - abs(cloudType - 0.5f) * 2.0f;
	float cumulus = clamp(cloudType - 0.5f, 0.0, 1.0) * 2.0f;
	return STRATUS_GRADIENT * stratus + STRATOCUMULUS_GRADIENT * stratocumulus + CUMULUS_GRADIENT * cumulus;
}

float densityHeightGradient(float heightFrac, float cloudType) {
	vec4 cloudGradient = mixGradients(cloudType);
	return smoothstep(cloudGradient.x, cloudGradient.y, heightFrac) - smoothstep(cloudGradient.z, cloudGradient.w, heightFrac);
}

float intersectSphere(vec3 pos, vec3 dir,float r) {
    float a = dot(dir, dir);
    float b = 2.0 * dot(dir, pos);
    float c = dot(pos, pos) - (r * r);
	float d = sqrt((b*b) - 4.0*a*c);
	float p = -b - d;
	float p2 = -b + d;
    return max(p, p2) / (2.0 * a);
}

// Returns density at a given point
// Heavily based on method from Schneider
float density(vec3 pip, vec3 weather, float mip) {
	float time = sky_time;
	vec3 p = pip;
	float height_fraction = GetHeightFractionForPoint(length(p));
	p.xz += time * 20.0 * normalize(wind_direction) * wind_speed * 0.6;
	vec4 n = textureLod(perlworlnoise, p.xyz*0.00008, mip-2.0);
	float fbm = n.g*0.625+n.b*0.25+n.a*0.125;
	float g = densityHeightGradient(height_fraction, weather.r);
	float base_cloud = remap(n.r, -(1.0-fbm), 1.0, 0.0, 1.0);
	float weather_coverage = cloud_coverage*weather.b;
	base_cloud = remap(base_cloud*g, 1.0-(weather_coverage), 1.0, 0.0, 1.0);
	base_cloud *= weather_coverage;
	p.xz -= time * normalize(wind_direction) * 40.;
	p.y -= time * 40.;
	vec3 hn = textureLod(worlnoise, p*0.001, mip).rgb;
	float hfbm = hn.r*0.625+hn.g*0.25+hn.b*0.125;
	hfbm = mix(hfbm, 1.0-hfbm, clamp(height_fraction*4.0, 0.0, 1.0));
	base_cloud = remap(base_cloud, hfbm*0.4 * height_fraction, 1.0, 0.0, 1.0);
	return pow(clamp(base_cloud, 0.0, 1.0), (1.0 - height_fraction) * 0.8 + 0.5);
}

vec4 march(vec3 pos,  vec3 end, vec3 dir, int depth) {
	const vec3 RANDOM_VECTORS[6] = {vec3( 0.38051305f,  0.92453449f, -0.02111345f),vec3(-0.50625799f, -0.03590792f, -0.86163418f),vec3(-0.32509218f, -0.94557439f,  0.01428793f),vec3( 0.09026238f, -0.27376545f,  0.95755165f),vec3( 0.28128598f,  0.42443639f, -0.86065785f),vec3(-0.16852403f,  0.14748697f,  0.97460106f)};
	float T = 1.0;
	float alpha = 0.0;
	float ss = length(dir);
	dir = normalize(dir);
	vec3 p = pos + dir * hash(pos * 10.0) * ss;
	float t_dist = cloud_top - cloud_bottom;
	float lss = (t_dist / 36.0);
	vec3 ldir = normalize(SUN_DIR);
	vec3 L = vec3(0.0);
	int count=0;
	float t = 1.0;
	float costheta = dot(ldir, dir);
	// Stack multiple phase functions to emulate some backscattering
	float phase = max(max(henyey_greenstein(costheta, 0.6), henyey_greenstein(costheta, (0.4 - 1.4 * ldir.y))), henyey_greenstein(costheta, -0.2));
	phase = min(phase, phase_cap);
	// Precalculate sun and ambient colors
	// This should really come from a uniform or texture for performance reasons
	vec3 atmosphere_sun = atmosphere(SUN_DIR) * sun_tint * SUN_POWER * ss * 0.1;
	vec3 atmosphere_ambient = atmosphere(normalize(vec3(1.0, 1.0, 0.0)));
	vec3 atmosphere_ground = atmosphere(normalize(vec3(1.0, -1.0, 0.0)));
	
	float time = sky_time * 0.001 + 0.005 * _time_offset;
	vec2 weather_pos = time * normalize(wind_direction) * wind_speed;
	
	for (int i = 0; i < depth; i++) {
		p += dir * ss;
		// ПРАВКА: уровень подробности карты погоды задан явно (здесь и ниже). В образце он брался по соседним
		// точкам экрана, а внутри ветвления («выше горизонта», «внутри облака») у соседей значения не определены:
		// по линии горизонта и кромкам облаков это давало мусор, а на программной отрисовке — падение.
		vec3 weather_sample = textureLod(weathermap, p.xz * weather_scale + 0.5 + weather_pos, 0.0).xyz;
		float height_fraction = GetHeightFractionForPoint(length(p));

		t = density(p, weather_sample, 0.0);
		float dt = exp(-_density*t*ss);
		L += cloud_floor * mix(0.6, 1.6, height_fraction) * T * (1.0 - dt);
		T *= dt;
		vec3 lp = p;
		float lt = 1.0;
		float cd = 0.0;

		if (t > 0.0) { //calculate lighting, but only when we are in the cloud
			float lheight_fraction = 0.0;
			for (int j = 0; j < 6; j++) {
				lp += (ldir + RANDOM_VECTORS[j]*float(j))*lss;
				lheight_fraction = GetHeightFractionForPoint(length(lp));
				vec3 lweather = textureLod(weathermap, lp.xz * weather_scale + 0.5 + weather_pos, 0.0).xyz;
				lt = density(lp, lweather, float(j));
				cd += lt;
			}
			
			// Take a single distant sample
			lp = p + ldir * 18.0 * lss;
			lheight_fraction = GetHeightFractionForPoint(length(lp));
			vec3 lweather = textureLod(weathermap, lp.xz * weather_scale + 0.5, 0.0).xyz;
			lt = pow(density(lp, lweather, 5.0), (1.0 - lheight_fraction) * 0.8 + 0.5);
			cd += lt;
			
			// captures the direct lighting from the sun
			float beers = exp(-_density * cd * lss);
			float beers2 = exp(-_density * cd * lss * 0.25) * 0.7;
			float beers_total = max(beers, beers2);

			vec3 ambient = mix(atmosphere_ground, vec3(1.0), smoothstep(0.0, 1.0, height_fraction)) * _density * mix(atmosphere_ambient, vec3(1.0), 0.4) * (SUN_DIR.y);
			alpha += (1.0 - dt) * (1.0 - alpha);
			L += (ambient * cloud_ambient + beers_total * atmosphere_sun * cloud_sun * phase * alpha) * T * t;
			// ПРАВКА: луч, который уже ничего не пропускает, дальше не считается: в плотном облаке и под
			// сплошной облачностью остальные шаги ничего не добавляют к картинке, а стоят как полные.
			if (T < 0.01) {
				break;
			}
		}
	}
	if (cloud_shoulder > 0.0) {
		L = 1.0 - exp(-L * cloud_shoulder);
	}
	L *= cloud_tint;
	return clamp(vec4(L, alpha), 0.0, 1.0);
}

// ПРАВКА: облака в одном направлении взгляда — свет облака (уже умноженный на непрозрачность) и непрозрачность.
// Только выше горизонта.
vec4 cloud_volume(vec3 dir) {
	vec3 camPos = vec3(0.0, g_radius + clamp(camera_place.y, 0.0, cloud_bottom - 200.0), 0.0);
	vec3 start = camPos + dir * intersectSphere(camPos, dir, g_radius + cloud_bottom);
	vec3 end = camPos + dir * intersectSphere(camPos, dir, g_radius + cloud_top);
	float shelldist = (length(end-start));
	vec3 shift = vec3(camera_place.x, 0.0, camera_place.z);
	start += shift;
	end += shift;
	// Take fewer steps towards horizon
	float steps = (mix(96.0, 54.0, clamp(dot(dir, vec3(0.0, 1.0, 0.0)), 0.0, 1.0))) * steps_scale;
	vec3 raystep = dir * shelldist / steps;
	return march(start, end, raystep, int(steps));
}

// ПРАВКА: фон неба с облаками поверх него.
vec3 compose_sky(vec3 dir, vec3 background, vec4 volume) {
	// Draw cloud shape
	vec3 col = background*(1.0-volume.a)+volume.xyz;
	// Blend distant clouds into the sky
	// ПРАВКА: в образце облака растворялись уже на 25° над горизонтом — у горизонта оставалась пустая серая
	// полоса. Теперь они доходят почти до него и тонут в дымке на последних градусах, как в жизни.
	return mix(clamp(col, vec3(0.0), vec3(1.0)), clamp(background, vec3(0.0), vec3(1.0)), smoothstep(horizon_fade.x, horizon_fade.y, 1.0-dir.y));
}
