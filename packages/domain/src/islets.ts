import { createRng, type Rng } from "./random.js";
import { hexDistance, hexKey, hexNeighbors, hexToPixel, type Hex } from "./hex.js";
import type { Terrain } from "./mapgen.js";

/**
 * Островки в море вокруг поля: чистое украшение, без узлов и механики. Это маленькие группы гексов
 * (1–4) на той же решётке, что и поле, с теми же картинками местности и тем же берегом, поэтому по стилю
 * они неотличимы от поля. Раскладка детерминирована по набору гексов поля — у всех игроков и в кабинете
 * администратора островки одни и те же. Размеры — в единицах карты (size — радиус гекса).
 */
export interface Bounds { minX: number; minY: number; width: number; height: number }
export interface IsletHex { q: number; r: number; terrain: Terrain; rotation: number }
export interface Islet {
  hexes: IsletHex[];
  /** Центр и радиус круга, накрывающего островок с отмелью (для живности и проверок). */
  x: number; y: number; r: number;
}

/** Запас моря вокруг поля (в долях большей стороны поля): в нём живут островки и до него можно листать карту. */
export const SEA_MARGIN = 0.6;
export function seaField(b: Bounds): Bounds {
  const m = Math.max(b.width, b.height) * SEA_MARGIN;
  return { minX: b.minX - m, minY: b.minY - m, width: b.width + 2 * m, height: b.height + 2 * m };
}

/** FNV-1a по ключам гексов: seed раскладки, когда карта уже сгенерирована и seed игры клиенту не нужен. */
export function isletSeed(hexes: ReadonlyArray<Hex>): number {
  const keys = hexes.map(hexKey).sort();
  let h = 0x811c9dc5;
  for (const k of keys) for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Минимальное расстояние в гексах от островка до поля и до других островков: помещаются обе отмели. */
export const ISLET_GAP = 4;
/** Местность островков: зелень и оазисы чаще, горы и пустыня реже. */
const ISLET_TERRAIN: Array<[Terrain, number]> = [["oasis", 0.32], ["meadow", 0.3], ["hills", 0.2], ["mountains", 0.1], ["desert", 0.08]];
function pickTerrain(rng: Rng): Terrain {
  let roll = rng();
  for (const [t, w] of ISLET_TERRAIN) { if (roll < w) return t; roll -= w; }
  return "meadow";
}

/** Радиус круга вокруг гексов островка с запасом на отмель (1.6 размера гекса за краем). */
function coverRadius(hexes: Hex[], cx: number, cy: number, size: number): number {
  let r = 0;
  for (const h of hexes) { const p = hexToPixel(h, size); r = Math.max(r, Math.hypot(p.x - cx, p.y - cy)); }
  return r + size + size * (hexes.length === 1 ? 0.7 : hexes.length === 2 ? 0.95 : 1.2);
}

/**
 * Раскладка: в поясе моря выбираются свободные клетки решётки (не ближе ISLET_GAP к полю и к другим
 * островкам), из них растут кластеры заданных размеров — один на 4 гекса, один-два на 3, два на 2 и три
 * одиночных. Кластер растёт по соседям, поэтому островки получаются компактными, а берег — волнистым.
 */
export function generateIslets(fieldHexes: ReadonlyArray<Hex>, size: number, bounds: Bounds, seed = isletSeed(fieldHexes)): Islet[] {
  if (!fieldHexes.length) return [];
  const rng = createRng(seed);
  const field = seaField(bounds);
  const qs = fieldHexes.map((h) => h.q), rs = fieldHexes.map((h) => h.r);
  const span = Math.ceil(Math.max(field.width, field.height) / (size * 1.5)) + 2;
  const q0 = Math.min(...qs) - span, q1 = Math.max(...qs) + span, r0 = Math.min(...rs) - span, r1 = Math.max(...rs) + span;
  const farFromField = (h: Hex) => fieldHexes.every((f) => hexDistance(f, h) >= ISLET_GAP);
  const inside = (h: Hex) => {
    const p = hexToPixel(h, size), pad = size * 2.6;
    return p.x > field.minX + pad && p.x < field.minX + field.width - pad && p.y > field.minY + pad && p.y < field.minY + field.height - pad;
  };
  const free = new Map<string, Hex>();
  for (let q = q0; q <= q1; q++) for (let r = r0; r <= r1; r++) { const h = { q, r }; if (inside(h) && farFromField(h)) free.set(hexKey(h), h); }

  const plan = [4, 3, ...(rng() < 0.5 ? [3] : []), 2, 2, 1, 1];
  const taken: Hex[] = [];
  const out: Islet[] = [];
  const keys = () => [...free.keys()];
  for (const n of plan) {
    let placed = false;
    for (let tries = 0; tries < 40 && !placed; tries++) {
      const ks = keys(); if (!ks.length) break;
      const start = free.get(ks[Math.floor(rng() * ks.length)]!)!;
      const cluster: Hex[] = [start];
      // Растим кластер по соседям, которые тоже свободны.
      while (cluster.length < n) {
        const cand = cluster.flatMap(hexNeighbors).filter((h) => free.has(hexKey(h)) && !cluster.some((c) => hexKey(c) === hexKey(h)));
        if (!cand.length) break;
        cluster.push(cand[Math.floor(rng() * cand.length)]!);
      }
      if (cluster.length < n) continue;
      if (taken.some((t) => cluster.some((c) => hexDistance(t, c) < ISLET_GAP))) continue;
      const pts = cluster.map((h) => hexToPixel(h, size));
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      out.push({ hexes: cluster.map((h) => ({ q: h.q, r: h.r, terrain: pickTerrain(rng), rotation: Math.floor(rng() * 6) })), x: cx, y: cy, r: coverRadius(cluster, cx, cy, size) });
      taken.push(...cluster);
      for (const c of cluster) for (const k of keys()) if (hexDistance(free.get(k)!, c) < ISLET_GAP) free.delete(k);
      placed = true;
    }
  }
  return out;
}
