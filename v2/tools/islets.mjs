// Малые острова для снимка мира версии 2 — свои, не по картинкам сайта (решение владельца 11.11: «не нужно косить
// под сайт… красивые острова… какие-то меньше, какие-то больше», самые большие — примерно вдвое крупнее прежних).
// Каменоломня стоит там же, где на сайте (packages/domain, generateIslets): это место игры, а не украшение.
// Остальные острова расставляются заново: два больших, три средних и два малых, каждый со своим поворотом и размером.
// Раскладка детерминирована по набору гексов карты. Единица длины — метры (гекс 100 м).
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createRng, fieldBoundsOf, generateIslets, hexToPixel, isletSeed } from "../../packages/domain/dist/index.js";

const HEX_SIZE = 100;
const CATALOGUE = new URL("../data/islets.bin", import.meta.url);

/** Острова каталога (tools/islets/designs.py) и радиус их суши на карте, м: от и до. */
const BIG = [{ design: 1, land: [480, 600] }, { design: 3, land: [470, 590] }, { design: 2, land: [400, 520] }, { design: 11, land: [380, 500] }];
const MEDIUM = [{ design: 4, land: [300, 400] }, { design: 5, land: [300, 400] }, { design: 6, land: [320, 420] }, { design: 7, land: [280, 380] },
  { design: 8, land: [260, 360] }];
const SMALL = [{ design: 9, land: [110, 170] }, { design: 10, land: [55, 90] }];
const QUARRY = 12;

/** От берега главных островов (центров гексов) до суши малого острова — не меньше и не больше, м. */
const GAP = [HEX_SIZE * 2.6 + 260, HEX_SIZE * 2.6 + 2600];
/** Между сушей соседних малых островов — не меньше, м. */
const APART = 320;

/** Сведения каталога: номер → опорная половина стороны штампа и досягаемость суши (в половинах стороны). */
export function catalogue() {
  const raw = gunzipSync(readFileSync(CATALOGUE));
  if (raw.subarray(0, 8).toString("latin1") !== "LOTWISL2") throw new Error("неизвестный файл каталога островов");
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const count = view.getUint8(8), size = view.getUint16(9, true);
  const designs = new Map();
  let at = 27;
  for (let i = 0; i < count; i++) {
    const id = view.getUint8(at);
    designs.set(id, { size: view.getFloat32(at + 1, true), reach: view.getFloat32(at + 1 + 6 * 4, true) });
    at += 45 + size * size * 6;
  }
  return designs;
}

/** hexes — [{q, r}, …] или [[q, r, …], …]. Возвращает строки [x, z, половина стороны штампа, номер, поворот, зеркало, каменоломня]. */
export function isletRows(hexes) {
  const field = hexes.map((h) => (Array.isArray(h) ? { q: h[0], r: h[1] } : { q: h.q, r: h.r }));
  const designs = catalogue();
  const seed = isletSeed(field);
  const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
  const between = (a, b) => a + rng() * (b - a);
  const centers = field.map((h) => hexToPixel(h, HEX_SIZE));
  const bounds = fieldBoundsOf(field, HEX_SIZE);
  const margin = Math.max(bounds.width, bounds.height);
  const shore = (x, y) => Math.min(...centers.map((c) => Math.hypot(c.x - x, c.y - y)));
  const placed = [];
  const row = (x, y, land, design, quarry) => {
    const info = designs.get(design);
    const R = land / info.reach;
    placed.push({ x, y, land });
    const round = (v) => Math.round(v * 100) / 100;
    return [round(x), round(y), round(R), design, round(between(0, Math.PI * 2)), rng() < 0.5 ? -1 : 1, quarry ? 1 : 0];
  };
  const rows = [];

  // Каменоломня — на месте сайта; размер суши — как у острова сайта, чуть крупнее.
  const site = generateIslets(field, HEX_SIZE, bounds).find((i) => i.quarry);
  if (site) rows.push(row(site.x, site.y, site.r * 0.98, QUARRY, true));

  const pick = (list, count) => {
    const pool = [...list];
    const out = [];
    while (out.length < count && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out;
  };
  const plan = [...pick(BIG, 2), ...pick(MEDIUM, 3), ...SMALL];
  for (const item of plan) {
    const land = between(item.land[0], item.land[1]);
    let best = null;
    // Среди многих мест — то, что дальше всего от уже стоящих островов (острова расходятся по морю вокруг карты).
    for (let tries = 0; tries < 400; tries++) {
      const x = between(bounds.minX - margin, bounds.minX + bounds.width + margin);
      const y = between(bounds.minY - margin, bounds.minY + bounds.height + margin);
      const coast = shore(x, y) - land;
      if (coast < GAP[0] || coast > GAP[1]) continue;
      const room = Math.min(...placed.map((o) => Math.hypot(o.x - x, o.y - y) - o.land - land), 1e9);
      if (room < APART) continue;
      const score = Math.min(room, 1800) - 0.25 * coast + rng() * 300;
      if (!best || score > best.score) best = { x, y, score };
    }
    if (best) rows.push(row(best.x, best.y, land, item.design, false));
  }
  return rows;
}

/** Текст снимка мира (формат 3: со своими малыми островами). */
export function worldText(world) {
  const lines = ["{", `  "format": 3,`, `  "name": ${JSON.stringify(world.name)},`, `  "seed": ${world.seed},`];
  const keys = ["hexes", "nodes", "edges", "islets"];
  keys.forEach((key, index) => {
    lines.push(`  "${key}": [`);
    lines.push(world[key].map((row) => "    " + JSON.stringify(row)).join(",\n"));
    lines.push(index === keys.length - 1 ? "  ]" : "  ],");
  });
  lines.push("}");
  return lines.join("\n") + "\n";
}
