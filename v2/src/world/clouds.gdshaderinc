// Облака (шаг 1.6 «Атмосфера и погода»): одна и та же карта облаков для неба, для их теней на земле и море
// и для слоя облаков, видного с высоты. Где на небе облако — под ним (со сдвигом к солнцу) лежит его тень.
//
// Числа — общие для всех шейдеров («global uniform», описаны в project.godot, каждый кадр их ставит weather.gd):
// так движение облаков не трогает материалы, и небо не пересчитывается для отражений.
global uniform vec4 cloud_drift; // на сколько облака ушли по ветру: xy — крупный слой, zw — мелкий (в его осях), метры
global uniform vec2 cloud_edge; // порог «здесь облако» и мягкость его края (в значениях карты)
global uniform float cloud_shade; // насколько тень облака темнит землю, 0…1
global uniform vec2 cloud_sun; // от точки земли к облаку, которое её затеняет (по x и z), метры
global uniform vec3 cloud_eye; // где камера (небу нужно знать, над чем мы стоим)
global uniform float rain_wet; // мокрая земля под дождём, 0…1

uniform sampler2D cloud_map : filter_linear_mipmap, repeat_enable; // бесшовный шум, одно число в точке

const float CLOUD_TILE = 5200.0; // плитка крупного слоя, метры (мелкого — 0,37 от неё и повёрнута)
const vec3 CLOUD_SHADE_TINT = vec3(0.5, 0.56, 0.68); // цвет земли в полной тени облака: темнее и прохладнее

// Значение карты облаков над точкой мира (x, z): два слоя — крупный и мелкий, повёрнутый.
float cloud_raw(vec2 at) {
	float big = texture(cloud_map, (at - cloud_drift.xy) / CLOUD_TILE).r;
	vec2 turned_at = vec2(at.x * 0.788 + at.y * 0.616, at.y * 0.788 - at.x * 0.616);
	float fine = texture(cloud_map, (turned_at - cloud_drift.zw) / (CLOUD_TILE * 0.37)).r;
	return big * 0.7 + fine * 0.3;
}

// Сколько облака над точкой мира (x, z): 0 — чистое небо, 1 — плотное облако.
float cloud_cover_at(vec2 at) {
	return smoothstep(cloud_edge.x - cloud_edge.y, cloud_edge.x + cloud_edge.y, cloud_raw(at));
}

// Тень облаков в точке земли или воды (x, z): 0 — на свету, до cloud_shade — в тени.
float cloud_shadow(vec2 ground) {
	return cloud_cover_at(ground + cloud_sun) * cloud_shade;
}
