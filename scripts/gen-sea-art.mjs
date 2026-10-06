#!/usr/bin/env node
/**
 * Генерация картинок вахт морей через OpenAI Images API (решение владельца 06.10: растр, не вектор).
 *   OPENAI_API_KEY=… node scripts/gen-sea-art.mjs [--only=common/lighthouse,adria/header] [--model=gpt-image-2.5-sunburst] [--dry]
 * Ключ берётся только из переменной окружения; в репозиторий и чат не попадает. Готовые файлы не перезаписываются
 * (удалите webp, чтобы перегенерировать). Стиль один на всю серию (STYLE_SEA), на картинках нет текста и людей
 * с лицами: буквы, цифры, отличия и спрайты кладёт код. Первая утверждённая картинка каждой группы — эталон стиля
 * для остальных через edits (поле "ref").
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps", "web", "public", "img", "sea");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "true"] : [a, "true"]; }));
const MODEL = args.model ?? "gpt-image-2.5-sunburst";
const ONLY = args.only ? new Set(args.only.split(",")) : null;
const DRY = args.dry === "true";
const KEY = process.env.OPENAI_API_KEY;
if (!KEY && !DRY) { console.error("Нет OPENAI_API_KEY в окружении: добавьте ключ в настройки среды (не в чат) и запустите снова."); process.exit(2); }

const STYLE = "antique watercolor nautical chart illustration, hand-painted on aged parchment, loose wet-on-wet watercolor washes with fine sepia ink linework, soft paper grain, muted palette (parchment #E8D9B5, sand #D9B97A, ochre #C48A3F, olive #7D8B4E, terracotta #A9553A, sea blue #4F7C99, deep indigo #2F4A66, ink #3B2F2F), gentle warm light from the top-left, slightly desaturated, clean and readable on a phone screen. Ancient Near East of the Bible, 1st millennium BC to 1st century AD. No modern objects. No human figures with faces. No religious symbols, no crosses. No text, no letters, no numbers, no labels, no watermark, no frame, no border, no signature.";
const SPRITE = "Game sprite, isolated on a fully transparent background, no scenery, no solid backdrop, no checkerboard, no shadow outside the object, centered, filling about 80% of the frame, viewed from slightly above at a three-quarter angle, light from the top-left.";
const banner = (subject) => `${STYLE} Wide panoramic header banner, 3:1. Subject: ${subject} Composition: horizon in the upper third, empty quiet sky at the top for a title overlay added later in code. Painted as a vignette that fades softly into parchment at the edges.`;

/** Список картинок: путь → { prompt, size, transparent, ref }. Пути совпадают с тем, что ждёт клиент (SeaForms.tsx). */
const ASSETS = {
  "common/lighthouse": { size: "1024x768", prompt: `${STYLE} Night scene: an ancient stone lighthouse tower in the style of the Pharos of Alexandria on a dark basalt headland at the left, an open fire in a bronze brazier at the top casting a warm beam into sea mist, deep indigo night sky with a few watercolor stars, black restless sea with white foam, a faint dark coastline across the middle distance with no lights on it (lights are added later in code), calm empty water in the middle of the frame.` },
  "common/land": { size: "1024x768", prompt: `${STYLE} Seamless-looking flat texture of aged parchment land for a nautical chart: pale parchment with faint watercolor hills and hatching in sepia ink, even lighting, no horizon, no objects, no coastline.` },
  "common/page": { size: "1024x1536", prompt: `${STYLE} A blank page of an old printed Bible: aged cream paper with foxing spots, soft shadow of the book spine on the left, faint impression of the text block from the other side, no visible letters at all, even lighting.` },
  "common/panel": { size: "1536x768", prompt: `${STYLE} A brass instrument panel of an ancient ship's helm: dark polished wood board with four empty round brass bezels in a row, rivets, patina, worn edges, no needles, no symbols, no text, viewed straight on.` },
  "common/disc": { size: "1024x1024", transparent: true, prompt: `${SPRITE} ${STYLE} A round bronze cipher disc viewed exactly from above: two concentric blank rings separated by an engraved groove, a plain raised hub in the center, worn patina, no letters, no symbols.` },
  "common/rose": { size: "1024x1024", transparent: true, prompt: `${SPRITE} ${STYLE} A compass rose on parchment viewed exactly from above: thirty-two points, the four main points longer, a thin outer ring, sepia ink and faint terracotta, no letters.` },
  "red/header": { size: "1536x512", prompt: banner("the Red Sea at dawn seen from a high shore: a long reddish-ochre desert coast with low rocky mountains on the left, calm turquoise-to-indigo water on the right, a dry sandy corridor of seabed suggested between two tall standing walls of water in the middle distance, abandoned Egyptian chariot wheels half-buried in the sand on the near shore, sparse acacia, pink morning haze.") },
  "galilee/header": { size: "1536x512", prompt: banner("the Sea of Galilee from a hillside: a green freshwater lake ringed by gentle olive-and-ochre hills, a small basalt-stone fishing village with flat roofs on the left shore, two empty wooden fishing boats pulled up on a pebble beach with nets spread to dry on poles, morning mist over the water.") },
  "salt/header": { size: "1536x512", prompt: banner("the Salt Sea (Dead Sea) at noon: a very still, heavy, pale turquoise lake with white salt crusts and salt pillars along the shore, barren tan cliffs and canyons on both sides, one dry tamarisk, strong flat light, a hint of a lush spring with palms far on the right shore.") },
  "merom/header": { size: "1536x512", prompt: banner("the Waters of Merom, a marshy lake in the upper Jordan valley: shallow reedy water with papyrus beds, water birds, low wooded hills, the snowy peak of Mount Hermon far in the background, on the near shore the remains of an encampment after a battle: broken chariot wheels, a burnt chariot frame still smoking faintly, no bodies, no people.") },
  "adria/header": { size: "1536x512", prompt: banner("the open Adriatic Sea in a grey northeast gale, no land in sight except a faint dark line of a rocky island on the far right horizon, long heavy swells with white foam, driving rain streaks, low torn clouds, a single small 1st-century Alexandrian grain ship far away under a scrap of sail.") },
  "red/chart": { size: "1024x768", prompt: `${STYLE} Flat seamless-looking watercolor texture of calm sea water for a nautical chart of the Red Sea: turquoise to indigo washes with faint rhumb lines in sepia ink, no horizon, no objects, no land, even lighting.` },
  "galilee/chart": { size: "1024x768", prompt: `${STYLE} Flat seamless-looking watercolor texture of calm freshwater lake for a nautical chart: green-blue washes with faint rhumb lines in sepia ink, no horizon, no objects, no land.` },
  "salt/chart": { size: "1024x768", prompt: `${STYLE} Flat seamless-looking watercolor texture of heavy pale turquoise salt water for a chart of the Dead Sea with faint white salt streaks and rhumb lines in sepia ink, no horizon, no objects, no land.` },
  "merom/chart": { size: "1024x768", prompt: `${STYLE} Flat seamless-looking watercolor texture of shallow marsh water with reed shadows for a chart, olive-blue washes, faint rhumb lines in sepia ink, no horizon, no objects, no land.` },
  "adria/chart": { size: "1024x768", prompt: `${STYLE} Flat seamless-looking watercolor texture of stormy grey-blue open sea for a nautical chart with faint rhumb lines in sepia ink, no horizon, no objects, no land.` },
  "adria/scene": { size: "1024x768", prompt: `${STYLE} A 1st-century Alexandrian grain ship seen from the side in calm water before a storm: broad-beamed wooden hull with a high curved swan-neck sternpost, one tall mainmast with the yard, a small foremast raked forward, two steering oars at the stern, a painted eye on the bow, empty deck with no cargo, no sails set (sails and cargo are added later), low clouds gathering, no people. The deck and the water around the stern are left clear for sprites.` },
  "galilee/scene": { size: "1024x768", prompt: `${STYLE} A pebble beach on the Sea of Galilee at dawn with one empty wooden fishing boat pulled up on the left, calm water, low hills behind, open sand in the foreground left clear for objects added later, no people, no nets, no fish.` },
  "red/scene": { size: "1024x768", prompt: `${STYLE} The western shore of the Red Sea at evening: reddish sand and low dunes in the foreground left empty for objects, calm water on the right, low mountains far away, no people, no chariots.` },
  "salt/scene": { size: "1024x768", prompt: `${STYLE} The barren western shore of the Dead Sea: tan cliffs on the left, pale heavy water on the right, salt-white shoreline in the foreground left empty for objects, no people, no plants.` },
  "merom/scene": { size: "1024x768", prompt: `${STYLE} A grassy plain by the marshy Waters of Merom at evening with reeds at the water edge on the right and an open field in the foreground left empty for tents, horses and chariots added later, hills behind, no people.` },
  "red/deck": { size: "1024x920", prompt: `${STYLE} Top-down flat texture of packed desert sand with faint footprints and small stones for a game board, even lighting, no objects.` },
  "galilee/deck": { size: "1024x920", prompt: `${STYLE} Top-down flat texture of a pebble beach with wet sand at the lower edge for a game board, even lighting, no objects.` },
  "salt/deck": { size: "1024x920", prompt: `${STYLE} Top-down flat texture of cracked salt crust and pale sand for a game board, even lighting, no objects.` },
  "merom/deck": { size: "1024x920", prompt: `${STYLE} Top-down flat texture of trampled grass and mud of a battlefield camp for a game board, even lighting, no objects.` },
  "adria/deck": { size: "1024x920", prompt: `${STYLE} Top-down flat texture of weathered wooden ship deck planks with tar seams for a game board, even lighting, no objects.` },
};
const SPRITES = {
  sack: "a bulging burlap sack of grain tied at the top", crate: "a wooden ship's crate bound with rope", wheat: "a sheaf of wheat bound with a cord", rope: "a coil of hemp ship's rope", boat: "a small wooden ship's boat with two oars", anchors: "four ancient wooden-and-lead anchors on cables, lying together", anchor: "an ancient wooden anchor with a lead stock", sail: "a square linen sail on a yard, full of wind", "sail-furled": "a square sail furled tightly to its yard", gull: "a seagull in flight seen from the side", lantern: "a lit bronze oil lantern", "lantern-off": "an unlit bronze oil lantern", cloud: "a single grey storm cloud", barrel: "a wooden barrel with iron hoops", "net-empty": "an empty fishing net spread on the ground", "net-full": "a fishing net full of fish", fish: "a pile of fresh fish", fire: "a small campfire of glowing coals", bread: "a round flat loaf of bread", tree: "a leafy olive tree", oar: "a single wooden oar", "net-drying": "a fishing net hung to dry on two poles", chariot: "an Egyptian war chariot with two wheels, no horses, no rider", "chariot-broken": "a wrecked Egyptian chariot with one wheel missing", wheel: "a single detached chariot wheel", horse: "a standing horse seen from the side, no rider", "wall-water": "a tall standing wall of sea water, translucent blue-green", "cloud-pillar": "a tall pillar of cloud glowing faintly from within", palm: "a date palm", bird: "a small dark bird in flight", tent: "a goat-hair nomad tent", shield: "a round bronze shield lying on the ground", salt: "a crust of white salt on the ground", "dead-tree": "a dead leafless tree", "fruit-tree": "a fruit tree with ripe fruit", stream: "a small stream of clear water flowing over stones", "salt-pillar": "a pillar of white salt rock", stone: "a large rounded boulder", "fire-chariot": "a chariot burning with flames", "banner-j": "a tribal standard: a tall pole with a terracotta banner showing a lion", "banner-r": "a tribal standard: a tall pole with an indigo banner", "banner-e": "a tribal standard: a tall pole with an olive-green banner", "banner-d": "a tribal standard: a tall pole with an ochre banner", sailor: "a sailor seen from above and behind, simple tunic, no visible face, small game token",
};
const FIGURES = { cloak: "a figure in a travelling cloak holding a scroll", helmet: "a Roman centurion with crested helmet, back turned", rope: "a sailor holding a coil of rope", spear: "a Roman soldier with spear and shield, back turned", chains: "a prisoner in chains, head bowed", traveller: "a traveller with a staff and bundle", swimmer: "a man swimming in waves, seen from behind", crowd: "a group of five figures standing together, seen from behind", crowd2: "a crowd of figures seen from behind, slightly different arrangement", rowers: "three figures rowing in a boat, seen from behind", fisher: "a fisherman casting a net, seen from behind", staff: "an old man with a long staff, seen from behind", crown: "a king in a crown and robe, seen from behind", crown2: "a king in a different crown and a striped robe, seen from behind", "chariot-man": "a charioteer in Egyptian dress, seen from behind", pillar: "a tall glowing pillar of cloud and fire", timbrel: "a woman with a timbrel raised, seen from behind", priest: "a priest-king with bread and a cup, seen from behind", runner: "a running messenger, seen from behind", tower: "a burning city tower on a hill" };
for (const [name, subject] of Object.entries(SPRITES)) ASSETS[`sprites/${name}`] = { size: "1024x1024", transparent: true, prompt: `${SPRITE} ${STYLE} ${subject}.` };
for (const [name, subject] of Object.entries(FIGURES)) ASSETS[`figures/${name}`] = { size: "1024x1536", prompt: `${STYLE} A silhouette-like sepia engraving of ${subject}, no visible face, dark figure on aged parchment, portrait format.` };

async function generate(path, spec) {
  const body = { model: MODEL, prompt: spec.prompt, size: spec.size, n: 1, quality: "medium", output_format: "webp", ...(spec.transparent ? { background: "transparent", output_format: "png" } : {}) };
  const res = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${path}: пустой ответ`);
  const file = join(OUT, path + (spec.transparent ? ".png" : ".webp"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(b64, "base64"));
  return file;
}

const todo = Object.entries(ASSETS).filter(([p]) => (!ONLY || ONLY.has(p)) && !existsSync(join(OUT, p + ".webp")) && !existsSync(join(OUT, p + ".png")));
console.log(`К генерации: ${todo.length} из ${Object.keys(ASSETS).length} (модель ${MODEL})`);
if (DRY) { for (const [p, s] of todo) console.log(`${p} ${s.size}${s.transparent ? " transparent" : ""}\n  ${s.prompt.slice(0, 140)}…`); process.exit(0); }
let done = 0;
for (const [p, s] of todo) {
  try { const f = await generate(p, s); done++; console.log(`✓ ${p} → ${f}`); }
  catch (e) { console.error(`✗ ${e.message}`); }
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`Готово: ${done}. PNG с прозрачностью переведите в webp: python3 scripts/webp-sea.py (или оставьте png и поправьте seaImg).`);
void readFileSync;
