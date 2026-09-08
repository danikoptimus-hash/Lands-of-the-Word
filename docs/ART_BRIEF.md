# Бриф для генерации картинок — Lands of the Word / Земли Слова

Этот файл целиком можно вставить в чат с генератором изображений как контекст, а затем отправлять промпты из раздела 5 по одному. Русский текст — для тебя, английские промпты — для генератора (они работают точнее на английском).

---

## 1. Контекст проекта (для генератора)

Copy this block into the generator as the first message:

> You are helping create the visual assets for **Lands of the Word**, a browser strategy game for a church youth group. The game map is an ancient, hand-painted parchment atlas made of hexagonal tiles. Hidden across the map are 66 cities, one for each book of the Bible. Teams start in a "hard place" from Israel's history (Babylonian captivity, Egypt, the wilderness), explore the map by doing real-life good deeds, claim cities by studying the book, and capture each other's cities by reciting verses from memory. The setting is the **ancient Near East** of the Bible: mudbrick and limestone walls, flat roofs, palm and olive trees, tents, wells, deserts, hills, the Jordan valley. **Not medieval Europe**: no pointed fairy-tale towers, no Gothic castles, no knights, no dragons. No modern objects. No religious symbols such as crosses, and no depictions of God or Jesus. No human figures at all in the assets (the game adds team markers itself).
>
> All assets must share one consistent visual style so they can sit side by side on the same map. I will give you one asset at a time. Always apply the STYLE block below, changing only the SUBJECT.

## 2. Единый стиль (вставляется в каждый промпт)

> **STYLE:** hand-painted fantasy atlas illustration, parchment map aesthetic, gouache and ink look, soft painterly edges, subtle ink outlines, muted earthy palette (parchment #E8D9B5, sand #D9B97A, ochre #C48A3F, olive #7D8B4E, terracotta #A9553A, river blue #4F7C99, ink #3B2F2F), gentle warm light from the top-left, soft short shadows, slightly desaturated, clean and readable at small sizes, no text, no letters, no numbers, no watermark, no frame, no border, no signature.

## 3. Технические требования (одинаковые для всех)

| Параметр | Требование |
|---|---|
| Формат | PNG. **Прозрачный фон** для объектов (городов, локаций, предметов). Если генератор не даёт прозрачность — ровный фон `#00FF00`, я уберу. |
| Размер | Объекты: **1024×1024**. Текстуры местности: **1024×1024**, квадрат. |
| Композиция объектов | Объект по центру, занимает **~75–85 % кадра**, ничего не обрезано краями, вокруг пусто. Один объект на картинке. |
| Ракурс объектов | **Вид сверху под углом ~45° (три четверти)**, одинаковый на всех. Не строго сверху и не сбоку. |
| Ракурс текстур местности | **Строго сверху**, без горизонта, без крупных объектов, равномерное заполнение, края без «швов» (tileable, если генератор умеет). |
| Свет | Всегда сверху-слева. |
| Текст | Никакого текста и букв на картинках. Названия накладываются кодом. |
| Люди | Нет фигур людей. |

Гексы я вырезаю из квадратной текстуры сам, поэтому местность присылать **квадратом, не шестиугольником**: генераторы плохо держат точную форму гекса.

## 4. Пробная партия: 3 картинки на утверждение стиля

Не три города. Три **разных типа** ассетов, чтобы проверить, что стиль совместим между объектами и текстурами:

1. **Город со стенами** (тип «walled city») — объект, прозрачный фон.
2. **Текстура пустыни** — квадрат, вид сверху.
3. **Стартовая локация «Вавилонский плен»** — объект, прозрачный фон.

Делай по 2–4 варианта каждого и присылай все: выберем один, и он станет «эталоном стиля», на который ссылаемся дальше («in the same style as the attached image»).

## 5. Промпты

Каждый промпт = контекст (раздел 1, один раз в начале чата) + STYLE (раздел 2) + SUBJECT ниже.

### 5.1 Пробная партия

**A. Город со стенами**
> SUBJECT: a small ancient Near Eastern walled city seen from a three-quarter top-down angle, limestone and mudbrick walls with a single arched gate, flat-roofed houses inside, one modest watchtower, a few palm trees outside the wall, standing alone on plain transparent background, centered, filling about 80% of the frame, isolated game asset, 1024x1024, transparent background PNG.

**B. Текстура пустыни**
> SUBJECT: seamless top-down desert ground texture for a map tile, warm sand with soft dune ripples and scattered small stones, painted parchment look, even lighting, no horizon, no large objects, no shadows of off-frame objects, tileable, 1024x1024.

**C. Стартовая локация «Вавилонский плен»**
> SUBJECT: a somber ancient Babylonian riverside camp of exiles seen from a three-quarter top-down angle: a few worn tents and bundles beside a river with willows, a distant ziggurat silhouette suggested behind, muted dusk colors, melancholic but not scary, no people, isolated on transparent background, centered, filling about 80% of the frame, game asset, 1024x1024, transparent background PNG.

### 5.2 Полный список v1 (после утверждения стиля)

Текстуры местности (квадрат, вид сверху, tileable):

| Файл | SUBJECT |
|---|---|
| `terrain/desert.png` | (см. B) |
| `terrain/hills.png` | seamless top-down rocky hills texture, ochre and olive tones, soft ridges, sparse dry shrubs |
| `terrain/meadow.png` | seamless top-down green meadow texture, olive-green grass with subtle wildflowers, gentle variation |
| `terrain/mountains.png` | seamless top-down rocky mountain texture, grey-brown stone with light snow on peaks, painted look |
| `terrain/water.png` | seamless top-down calm river/lake water texture, muted blue with soft painted ripples |
| `terrain/oasis.png` | seamless top-down oasis texture, sand transitioning to lush green with a small pool, palm shadows |

Типы городов (объект, три четверти, прозрачный фон):

| Файл | SUBJECT |
|---|---|
| `city/village.png` | a small ancient village of flat-roofed mudbrick houses around a well, a few olive trees |
| `city/walled_city.png` | (см. A) |
| `city/fortress.png` | a compact stone fortress on a rock with thick walls and one square tower, dry moat |
| `city/temple_city.png` | a city with a large courtyard temple at its center, colonnades, cedar roofs |
| `city/port.png` | a small harbor city with a stone pier, two moored wooden boats, warehouses |
| `city/tent_camp.png` | a large encampment of goat-hair tents arranged in a circle around a central fire pit (no fire flames) |
| `city/hill_city.png` | a terraced city climbing a hill with stone stairs and vineyards |
| `city/ruins.png` | ancient ruined city with broken columns and collapsed walls, sand drifting in |
| `city/capital.png` | a grand ancient royal city with a palace, double walls, gardens and a wide gate (used for capitals) |

Стартовые локации (объект, три четверти, прозрачный фон):

| Файл | SUBJECT |
|---|---|
| `start/babylon.png` | (см. C) |
| `start/egypt.png` | a brick-making yard in ancient Egypt: mud pits, stacked bricks, a reed hut, straw bales, a distant pyramid silhouette |
| `start/wilderness.png` | a barren wilderness camp: a single tent beside a dry rock, thorn bushes, cracked ground |
| `start/assyria.png` | a bleak road with a broken cart and bundles beside a stone winged-bull gate, dusty exile scene |
| `start/desert_zin.png` | a rocky desert wadi with a small spring, sparse acacia, harsh light |
| `start/shipwreck.png` | a wrecked wooden boat on a stony shore after a storm, torn sail, grey sea |

Объекты и декор (объект, три четверти, прозрачный фон, 512×512 достаточно):

| Файл | SUBJECT |
|---|---|
| `props/well.png` | a stone well with a wooden beam and bucket |
| `props/palm.png` | a single date palm |
| `props/olive.png` | a single gnarled olive tree |
| `props/rocks.png` | a cluster of desert boulders |
| `props/tent.png` | a single goat-hair tent |
| `props/campfire.png` | a ring of stones with unlit firewood |

Эффекты (огонь при атаке, дымка тумана, подсветка, флаги команд, короны столиц, значки направлений дел) — **делаю я кодом и векторами**, генерировать не нужно.

## 6. Как присылать

- Имя файла как в таблице (`walled_city.png`), или просто подпиши, что это, — переименую.
- Оригинальный размер, без сжатия мессенджером (отправляй как файл, не как фото).
- К каждой присланной картинке — промпт, которым она получена (можно копией текста). Это нужно, чтобы позже перегенерировать в том же стиле.
- Если генератор поддерживает «в стиле приложенного изображения» — прикладывай утверждённый эталон к каждому следующему промпту.

## 7. Чек-лист приёмки (проверяю я)

- [ ] Ракурс совпадает с эталоном (три четверти для объектов, строго сверху для текстур).
- [ ] Свет сверху-слева.
- [ ] Нет текста, рамок, водяных знаков, подписей.
- [ ] Нет людей, крестов, средневековых европейских башен, современных предметов.
- [ ] Фон прозрачный или ровный `#00FF00`, без градиента.
- [ ] Объект не обрезан, занимает 75–85 % кадра.
- [ ] Палитра в пределах земляной гаммы, без кислотных цветов.
- [ ] Текстура местности без заметного шва при укладке 2×2.

## 8. Советы по генераторам

- Держи **один чат** на всю серию и не меняй STYLE-блок ни на слово: изменение формулировки меняет стиль.
- Генерируй по 2–4 варианта, выбирай ближайший к эталону, остальные не используй.
- Если генератор рисует людей или текст, добавь в конец промпта: «absolutely no people, no text, no letters».
- Если фон получается не прозрачным, а «шахматным» нарисованным, проси «solid bright green #00FF00 background», это надёжнее.
- Текстуры местности проверяй сам, положив картинку 2×2 в любом редакторе: шов виден сразу.
