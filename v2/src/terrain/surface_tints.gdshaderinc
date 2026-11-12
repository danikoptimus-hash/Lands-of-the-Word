// Оттенки материалов земли (шаг 1.3 «Поверхности»). Одна формула на двоих: по ней красится готовая картинка
// дальнего вида при запекании (bake_surface.gdshader) и материалы в кадре (terrain_surface.gdshader) — поэтому
// дальний и ближний вид одного места совпадают по цвету.
// Подключать после surface_layers.gdshaderinc (номера слоёв).
//
// Тон земли в точке — четыре числа от нуля до единицы, все запечены при постройке мира:
//   dryness    — сухость: чем суше, тем желтее трава, чем влажнее — тем гуще зелень;
//   bloom      — цветение лугов (жёлтые пятна там, где не сухо);
//   sandy      — оттенок песка большими территориями: 0 — светлый, 1 — красноватый;
//   sandy_land — пустыня и земля рядом с ней: грунт и осыпь там песочного тона;
//   rock_tone  — порода: 0…0,5 — камень главных островов (0 — береговые обрывы, 0,5 — горы, там он темнее),
//                0,75 — порода малого острова без подкраски, 1 — тёмная вулканическая.
// grass_shade — мелкая неровность травы: кочки темнее и светлее (вокруг единицы).

vec3 rock_tint_of(float rock_tone) {
	if (rock_tone > 0.875) {
		return vec3(0.46, 0.4, 0.38);
	}
	if (rock_tone > 0.6) {
		return vec3(1.0);
	}
	// Камень главных островов — спокойный серо-бурый, а не светлый и яркий: горы не должны спорить
	// с остальной землёй и с будущими городами. В горах он темнее, чем на береговых обрывах.
	return mix(vec3(0.84, 0.86, 0.9), vec3(0.66, 0.71, 0.78), clamp(rock_tone * 2.0, 0.0, 1.0));
}

vec3 surface_tint(int layer, float dryness, float bloom, float sandy, float sandy_land, float rock_tone, float grass_shade) {
	if (layer == L_SAND_DUNE || layer == L_DESERT_STONE || layer == L_SCREE) {
		vec3 sand = mix(vec3(1.0), vec3(1.07, 0.9, 0.76), sandy);
		if (layer == L_SAND_DUNE) {
			return sand;
		}
		if (layer == L_DESERT_STONE) {
			// Каменистая пустыня — той же земли, что и песок вокруг: светлее и желтее, чем грунт холмов.
			return mix(vec3(1.0), vec3(1.2, 1.27, 1.2) * sand, sandy_land);
		}
		// Осыпь — обломки той же породы и той же земли: в пустыне песочная, у известняка тёплая, а не серая заплатка.
		return mix(vec3(1.16, 1.0, 0.8), vec3(1.4, 1.1, 0.74) * sand, sandy_land) * mix(vec3(1.0), rock_tint_of(rock_tone), 0.5);
	}
	if (layer == L_DRY_GRASS || layer == L_MOUNTAIN_SLOPE || layer == L_OASIS_GREEN || layer == L_MEADOW || layer == L_GRASS_LUSH) {
		vec3 grass = mix(vec3(0.8, 0.98, 0.78), vec3(1.18, 1.04, 0.72), dryness) * grass_shade;
		if (layer == L_MEADOW || layer == L_GRASS_LUSH) {
			return mix(grass, grass * vec3(1.42, 1.22, 0.62), bloom);
		}
		return grass;
	}
	if (layer == L_ROCK_CLIFF || layer == L_LICHEN_ROCK) {
		return rock_tint_of(rock_tone);
	}
	if (layer == L_ROCK_STRATA) {
		// Красный песчаник пластов на главных островах — приглушённый, охристый: рядом с известняком он не «горит».
		return rock_tone > 0.6 ? vec3(1.0) : vec3(0.82, 1.02, 1.2);
	}
	return vec3(1.0);
}
