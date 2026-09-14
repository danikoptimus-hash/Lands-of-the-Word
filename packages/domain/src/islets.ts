import { createRng, type Rng } from "./random.js";
import { hexKey, hexToPixel, type Hex } from "./hex.js";
import { ISLET_IMAGES } from "./isletShapes.js";

/**
 * Островки в море вокруг поля: чистое украшение, без узлов и механики. Это нарисованные картинки
 * (`apps/web/public/img/islet/islet-N.webp`, шесть разных островов), у каждой снят контур по прозрачности
 * (`isletShapes.ts`) — по нему рисуется отмель и по нему живность обходит остров. Раскладка детерминирована
 * по набору гексов поля — у всех игроков и в кабинете администратора островки одни и те же.
 * Размеры — в единицах карты (size — радиус гекса).
 */
export interface Bounds { minX: number; minY: number; width: number; height: number }
export interface Islet {
  x: number; y: number;
  /** Половина стороны картинки в единицах карты; контур — r × shape[i] по углам от 0 до 2π от центра картинки. */
  r: number; shape: number[];
  /** Номер картинки (1–6). */
  img: number;
  /** Радиус круга, накрывающего островок с отмелью (для живности и раскладки). */
  cover: number;
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

const TAU = Math.PI * 2;
const between = (rng: Rng, a: number, b: number) => a + rng() * (b - a);

/** Радиус контура под углом (линейная интерполяция между отсчётами). */
export function isletRadiusAt(isl: { r: number; shape: number[] }, angle: number): number {
  const n = isl.shape.length;
  const f = ((((angle % TAU) + TAU) % TAU) / TAU) * n;
  const i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f);
  return isl.r * (isl.shape[i]! * (1 - t) + isl.shape[j]! * t);
}

/**
 * План раскладки: какие картинки и какого размера (половина стороны в радиусах гекса). Два крупных, три средних,
 * две песчаные банки разного размера — семь островков.
 */
const PLAN: ReadonlyArray<{ img: number; lo: number; hi: number }> = [
  { img: 1, lo: 2.6, hi: 3.0 }, { img: 5, lo: 2.4, hi: 2.9 },            // зелёные круглые
  { img: 2, lo: 2.0, hi: 2.4 }, { img: 6, lo: 2.0, hi: 2.4 }, { img: 4, lo: 1.9, hi: 2.3 }, // скалистые гряды и полумесяц с лагуной
  { img: 3, lo: 1.1, hi: 1.3 }, { img: 3, lo: 0.8, hi: 1.0 },            // песчаная банка с пальмой, два размера
];

/** Раскладка в поясе моря вокруг поля: островок не подходит к полю ближе, чем отмель и песок берега, и не пересекается с соседями. */
export function generateIslets(fieldHexes: ReadonlyArray<Hex>, size: number, bounds: Bounds, seed = isletSeed(fieldHexes)): Islet[] {
  if (!fieldHexes.length) return [];
  const rng = createRng(seed);
  const field = seaField(bounds);
  const centers = fieldHexes.map((h) => hexToPixel(h, size));
  const out: Islet[] = [];
  for (const item of PLAN) {
    const spec = ISLET_IMAGES.find((s) => s.img === item.img)!;
    const r = size * between(rng, item.lo, item.hi);
    const cover = r * spec.maxR + size * 1.4;
    for (let tries = 0; tries < 80; tries++) {
      const x = between(rng, field.minX + cover, field.minX + field.width - cover);
      const y = between(rng, field.minY + cover, field.minY + field.height - cover);
      // Не ближе к любому гексу поля, чем его отмель (size × 3.4 от центра гекса) плюс своя отмель.
      if (centers.some((c) => Math.hypot(c.x - x, c.y - y) < cover + size * 3.4)) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.y - y) < cover + o.cover + size * 1.2)) continue;
      out.push({ x, y, r, shape: spec.shape, img: item.img, cover });
      break;
    }
  }
  return out;
}
