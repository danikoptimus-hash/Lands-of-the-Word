import { createRng, type Rng } from "./random.js";
import { hexKey, hexToPixel, type Hex } from "./hex.js";
import type { Terrain } from "./mapgen.js";

/**
 * Островки в море вокруг поля: чистое украшение, без узлов и механики. Контур — плавное «пятно» (окружность
 * с гармониками), а суша внутри заливается теми же картинками местности, что и поле: мягкими пятнами размером
 * с гекс по решётке, так что стыков не видно. Раскладка детерминирована по набору гексов поля — у всех
 * игроков и в кабинете администратора островки одни и те же. Размеры — в единицах карты (size — радиус гекса).
 */
export interface Bounds { minX: number; minY: number; width: number; height: number }
/** Пятно местности внутри островка: клетка решётки, местность и поворот картинки. */
export interface IsletCell { q: number; r: number; terrain: Terrain; rotation: number }
export interface Islet {
  x: number; y: number;
  /** Базовый радиус суши; контур — r × shape[i] по углам от 0 до 2π. */
  r: number; shape: number[];
  /** Радиус круга, накрывающего островок с отмелью (для живности). */
  cover: number;
  cells: IsletCell[];
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

export const SHAPE_N = 32;
const TAU = Math.PI * 2;
const between = (rng: Rng, a: number, b: number) => a + rng() * (b - a);

/** Контур: окружность с тремя гармониками и лёгким шумом; вытянутость задаёт вторая гармоника. */
function makeShape(rng: Rng): number[] {
  const p1 = between(rng, 0, TAU), p2 = between(rng, 0, TAU), p3 = between(rng, 0, TAU);
  const a2 = between(rng, 0.1, 0.24), a3 = between(rng, 0.06, 0.16), a5 = between(rng, 0.02, 0.06);
  const out: number[] = [];
  for (let i = 0; i < SHAPE_N; i++) {
    const a = (i / SHAPE_N) * TAU;
    out.push(1 + a2 * Math.sin(2 * a + p1) + a3 * Math.sin(3 * a + p2) + a5 * Math.sin(5 * a + p3) + between(rng, -0.02, 0.02));
  }
  return out;
}

/** Радиус контура под углом (линейная интерполяция между отсчётами). */
export function isletRadiusAt(isl: { r: number; shape: number[] }, angle: number): number {
  const f = ((((angle % TAU) + TAU) % TAU) / TAU) * SHAPE_N;
  const i = Math.floor(f) % SHAPE_N, j = (i + 1) % SHAPE_N, t = f - Math.floor(f);
  return isl.r * (isl.shape[i]! * (1 - t) + isl.shape[j]! * t);
}

/** Местность зон островка: зелень и оазисы чаще, горы и пустыня реже. */
const ZONE_TERRAIN: Array<[Terrain, number]> = [["oasis", 0.3], ["meadow", 0.32], ["hills", 0.2], ["mountains", 0.1], ["desert", 0.08]];
function pickTerrain(rng: Rng): Terrain {
  let roll = rng();
  for (const [t, w] of ZONE_TERRAIN) { if (roll < w) return t; roll -= w; }
  return "meadow";
}

/**
 * Пятна местности: клетки решётки гексов, центры которых попали в сушу островка (с небольшим запасом, чтобы
 * края были закрыты). Местность клетки — от ближайшей из 1–3 зон островка, поэтому местности идут областями.
 */
function fillCells(rng: Rng, isl: { x: number; y: number; r: number; shape: number[] }, size: number): IsletCell[] {
  const zones = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => {
    const a = between(rng, 0, TAU), d = Math.sqrt(rng()) * isl.r * 0.8;
    return { x: isl.x + Math.cos(a) * d, y: isl.y + Math.sin(a) * d, terrain: pickTerrain(rng) };
  });
  const cells: IsletCell[] = [];
  const span = Math.ceil((isl.r * 1.4) / size) + 2;
  // Ближайшая клетка решётки к центру островка — точка отсчёта перебора (обратное hexToPixel).
  const cr = Math.round(isl.y / (size * 1.5)), cq = Math.round(isl.x / (size * Math.sqrt(3)) - cr / 2);
  for (let q = cq - span; q <= cq + span; q++) for (let r = cr - span; r <= cr + span; r++) {
    const p = hexToPixel({ q, r }, size);
    const dx = p.x - isl.x, dy = p.y - isl.y, d = Math.hypot(dx, dy);
    if (d > isletRadiusAt(isl, Math.atan2(dy, dx)) + size * 0.55) continue;
    let best = zones[0]!, bd = Infinity;
    for (const z of zones) { const zd = Math.hypot(z.x - p.x, z.y - p.y) + rng() * size * 0.6; if (zd < bd) { bd = zd; best = z; } }
    cells.push({ q, r, terrain: best.terrain, rotation: Math.floor(rng() * 6) });
  }
  return cells;
}

/**
 * Раскладка: один крупный островок, два-три средних и три маленьких в поясе моря вокруг поля. Островок не подходит
 * к полю ближе, чем отмель и песок берега, и не пересекается с соседями.
 */
export function generateIslets(fieldHexes: ReadonlyArray<Hex>, size: number, bounds: Bounds, seed = isletSeed(fieldHexes)): Islet[] {
  if (!fieldHexes.length) return [];
  const rng = createRng(seed);
  const field = seaField(bounds);
  const centers = fieldHexes.map((h) => hexToPixel(h, size));
  const plan: Array<[number, number]> = [[2.6, 3.4], [1.7, 2.3], [1.7, 2.3], ...(rng() < 0.5 ? [[1.6, 2.1] as [number, number]] : []), [1.0, 1.4], [1.0, 1.4], [0.9, 1.3]];
  const out: Islet[] = [];
  for (const [lo, hi] of plan) {
    const r = size * between(rng, lo, hi), shape = makeShape(rng);
    const rMax = r * Math.max(...shape), cover = rMax + size * 1.6;
    for (let tries = 0; tries < 80; tries++) {
      const x = between(rng, field.minX + cover, field.minX + field.width - cover);
      const y = between(rng, field.minY + cover, field.minY + field.height - cover);
      // Не ближе к любому гексу поля, чем его отмель (size × 3.4 от центра гекса) плюс своя отмель.
      if (centers.some((c) => Math.hypot(c.x - x, c.y - y) < cover + size * 3.4)) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.y - y) < cover + o.cover + size * 1.5)) continue;
      const base = { x, y, r, shape };
      out.push({ ...base, cover, cells: fillCells(rng, base, size) });
      break;
    }
  }
  return out;
}
