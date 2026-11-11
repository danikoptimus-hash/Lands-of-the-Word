# Реестр ассетов версии 2

У каждого файла — источник и лицензия. Без записи здесь ассет в сборку не идёт.

| Файл | Что это | Источник | Лицензия |
|---|---|---|---|
| `fonts/literata-400-*.woff2`, `fonts/literata-600-*.woff2` | Шрифт Literata, начертания 400 и 600, кириллица и латиница | Те же файлы, что на сайте (`apps/web/public/fonts`), семейство Literata от TypeTogether для Google | SIL Open Font License 1.1 |
| `fonts/philosopher-700-*.woff2` | Шрифт Philosopher, начертание 700, кириллица и латиница | Те же файлы, что на сайте, автор — Джованни Лемонад | SIL Open Font License 1.1 |
| `terrain/ground_albedo.webp`, `terrain/ground_normal.jpg` | Материалы земли (шаг 1.3): 16 слоёв — цвет с высотой фактуры и нормаль с шероховатостью. Собирает `tools/surfaces/make.py` из снимков ниже; цвет каждого слоя приведён к палитре игры, у съёмок вблизи выровнены крупные пятна яркости (чтобы повтор плитки не читался). Четвёртый канал цвета — высота фактуры, а не прозрачность: файл пишется с ключом `exact` и проверяется после записи | См. строки ниже | CC0 1.0 |
| слой `sand_dune` | Песок барханов с ветровой рябью | ambientCG, Ground097 — https://ambientcg.com/a/Ground097 | CC0 1.0 |
| слой `desert_stone` | Каменистая пустыня | Poly Haven, dry_ground_rocks — https://polyhaven.com/a/dry_ground_rocks | CC0 1.0 |
| слой `dry_grass` | Сухая трава с валунами, съёмка с воздуха | Poly Haven, aerial_rocks_01 — https://polyhaven.com/a/aerial_rocks_01 | CC0 1.0 |
| слой `hill_stone` | Травянистый склон с плитняком, съёмка с воздуха | Poly Haven, rocky_terrain — https://polyhaven.com/a/rocky_terrain | CC0 1.0 |
| слой `meadow` | Луг, съёмка с воздуха | Poly Haven, rocky_terrain_02 — https://polyhaven.com/a/rocky_terrain_02 | CC0 1.0 |
| слой `grass_lush` | Густая трава вблизи | ambientCG, Grass004 — https://ambientcg.com/a/Grass004 | CC0 1.0 |
| слой `rock_cliff` | Трещиноватый известняк | Poly Haven, marble_cliff_03 — https://polyhaven.com/a/marble_cliff_03 | CC0 1.0 |
| слой `rock_strata` | Слоистый песчаник | Poly Haven, cliff_side — https://polyhaven.com/a/cliff_side | CC0 1.0 |
| слой `mountain_slope` | Горный склон: трава и камень, съёмка с воздуха | Poly Haven, aerial_rocks_04 — https://polyhaven.com/a/aerial_rocks_04 | CC0 1.0 |
| слой `scree` | Осыпь: мелкий щебень | Poly Haven, gravel_ground_01 — https://polyhaven.com/a/gravel_ground_01 | CC0 1.0 |
| слой `beach_sand` | Светлый песок пляжа | ambientCG, Ground092A — https://ambientcg.com/a/Ground092A | CC0 1.0 |
| слой `soil_red` | Красная почва | Poly Haven, red_dirt_mud_01 — https://polyhaven.com/a/red_dirt_mud_01 | CC0 1.0 |
| слой `oasis_green` | Влажная зелень | ambientCG, Ground037 — https://ambientcg.com/a/Ground037 | CC0 1.0 |
| слой `pebbles` | Галька | Poly Haven, ganges_river_pebbles — https://polyhaven.com/a/ganges_river_pebbles | CC0 1.0 |
| слой `mud_cracked` | Растрескавшаяся глина | Poly Haven, mud_cracked_dry_03 — https://polyhaven.com/a/mud_cracked_dry_03 | CC0 1.0 |
| слой `lichen_rock` | Серый камень с лишайником | Poly Haven, mossy_rock — https://polyhaven.com/a/mossy_rock | CC0 1.0 |
| `terrain/noise.png` | Четыре шума в одной текстуре (пятна цвета, чередование плиток) | Считает `tools/surfaces/make.py`, своё | — |
