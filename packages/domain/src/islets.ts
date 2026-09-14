import { createRng, type Rng } from "./random.js";
import { hexToPixel } from "./hex.js";

/**
 * Островки в море вокруг поля: чистое украшение, без гексов и механики. Раскладка детерминирована —
 * один и тот же набор гексов даёт одни и те же островки у всех игроков и в кабинете администратора.
 * Все размеры — в единицах карты (size — радиус гекса), рисование — на стороне клиента.
 */
export interface Bounds { minX: number; minY: number; width: number; height: number }
export type IsletKind = "bank" | "small" | "large";
export interface Palm { x: number; y: number; h: number; lean: number; seed: number }
export interface Rock { x: number; y: number; r: number; a: number }
export interface Bush { x: number; y: number; r: number }
export interface Islet {
  x: number; y: number;
  /** Базовый радиус; контур — r × shape[i] по углам от 0 до 2π. */
  r: number; shape: number[]; kind: IsletKind;
  palms: Palm[]; rocks: Rock[]; bushes: Bush[]; lagoon: { x: number; y: number; r: number } | null;
}

/** Запас моря вокруг поля (в долях большей стороны поля): в нём живут островки и до него можно листать карту. */
export const SEA_MARGIN = 0.6;
export function seaField(b: Bounds): Bounds {
  const m = Math.max(b.width, b.height) * SEA_MARGIN;
  return { minX: b.minX - m, minY: b.minY - m, width: b.width + 2 * m, height: b.height + 2 * m };
}

/** FNV-1a по ключам гексов: seed раскладки, когда карта уже сгенерирована и seed игры клиенту не нужен. */
export function isletSeed(hexes: ReadonlyArray<{ q: number; r: number }>): number {
  const keys = hexes.map((h) => `${h.q},${h.r}`).sort();
  let h = 0x811c9dc5;
  for (const k of keys) for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export const SHAPE_N = 24;
const between = (rng: Rng, a: number, b: number) => a + rng() * (b - a);

/** Контур: базовая окружность с тремя гармониками и лёгким шумом; максимум ≈ 1.3, минимум ≈ 0.7. */
function makeShape(rng: Rng): number[] {
  const p1 = between(rng, 0, Math.PI * 2), p2 = between(rng, 0, Math.PI * 2), p3 = between(rng, 0, Math.PI * 2);
  const a2 = between(rng, 0.08, 0.2), a3 = between(rng, 0.05, 0.14), a5 = between(rng, 0.02, 0.07);
  const out: number[] = [];
  for (let i = 0; i < SHAPE_N; i++) {
    const a = (i / SHAPE_N) * Math.PI * 2;
    out.push(1 + a2 * Math.sin(2 * a + p1) + a3 * Math.sin(3 * a + p2) + a5 * Math.sin(5 * a + p3) + between(rng, -0.03, 0.03));
  }
  return out;
}

/** Радиус контура под углом (линейная интерполяция между отсчётами). */
export function isletRadiusAt(isl: Islet, angle: number): number {
  const f = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * SHAPE_N;
  const i = Math.floor(f) % SHAPE_N, j = (i + 1) % SHAPE_N, t = f - Math.floor(f);
  return isl.r * (isl.shape[i]! * (1 - t) + isl.shape[j]! * t);
}

/** Точка внутри суши островка: не дальше frac от контура по этому направлению. */
function inland(rng: Rng, isl: Islet, frac: number): { x: number; y: number } {
  const a = between(rng, 0, Math.PI * 2), d = Math.sqrt(rng()) * isletRadiusAt(isl, a) * frac;
  return { x: isl.x + Math.cos(a) * d, y: isl.y + Math.sin(a) * d };
}

function dressIslet(rng: Rng, isl: Islet, size: number): void {
  const palms = isl.kind === "large" ? 4 + Math.floor(rng() * 3) : isl.kind === "small" ? 2 + Math.floor(rng() * 2) : rng() < 0.6 ? 1 : 0;
  const minGap = size * 0.34;
  for (let n = 0, tries = 0; n < palms && tries < 40; tries++) {
    const p = inland(rng, isl, isl.kind === "bank" ? 0.35 : 0.58);
    if (isl.palms.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < minGap)) continue;
    const h = size * (isl.kind === "large" ? between(rng, 0.7, 1.0) : isl.kind === "small" ? between(rng, 0.6, 0.85) : between(rng, 0.5, 0.7));
    isl.palms.push({ x: p.x, y: p.y, h, lean: between(rng, -1, 1), seed: rng() }); n++;
  }
  isl.palms.sort((a, b) => a.y - b.y);
  const rocks = isl.kind === "large" ? 1 + Math.floor(rng() * 3) : isl.kind === "small" ? Math.floor(rng() * 2) : 0;
  for (let i = 0; i < rocks; i++) {
    const a = between(rng, 0, Math.PI * 2), d = isletRadiusAt(isl, a) * between(rng, 0.62, 0.86);
    isl.rocks.push({ x: isl.x + Math.cos(a) * d, y: isl.y + Math.sin(a) * d, r: size * between(rng, 0.1, 0.2), a: between(rng, 0, Math.PI) });
  }
  const bushes = isl.kind === "large" ? 3 + Math.floor(rng() * 3) : isl.kind === "small" ? 1 + Math.floor(rng() * 2) : 0;
  for (let i = 0; i < bushes; i++) { const p = inland(rng, isl, 0.62); isl.bushes.push({ x: p.x, y: p.y, r: size * between(rng, 0.1, 0.18) }); }
  if (isl.kind === "large" && rng() < 0.45) {
    const p = inland(rng, isl, 0.3);
    isl.lagoon = { x: p.x, y: p.y, r: isl.r * between(rng, 0.16, 0.24) };
  }
}

/**
 * Раскладка островков в поясе моря вокруг поля: несколько крупных, средних и совсем мелких песчаных банок.
 * Островок не подходит к полю ближе, чем отмель и песок берега, и не пересекается с соседями.
 */
export function generateIslets(hexes: ReadonlyArray<{ q: number; r: number }>, size: number, bounds: Bounds, seed = isletSeed(hexes)): Islet[] {
  if (!hexes.length) return [];
  const rng = createRng(seed);
  const field = seaField(bounds);
  const centers = hexes.map((h) => hexToPixel(h, size));
  const plan: IsletKind[] = [];
  const nLarge = 1 + (rng() < 0.5 ? 1 : 0), nSmall = 3 + Math.floor(rng() * 2), nBank = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < nLarge; i++) plan.push("large");
  for (let i = 0; i < nSmall; i++) plan.push("small");
  for (let i = 0; i < nBank; i++) plan.push("bank");
  const out: Islet[] = [];
  for (const kind of plan) {
    const r = size * (kind === "large" ? between(rng, 2.1, 2.9) : kind === "small" ? between(rng, 1.2, 1.8) : between(rng, 0.55, 0.95));
    const shape = makeShape(rng);
    const rMax = r * Math.max(...shape);
    for (let tries = 0; tries < 80; tries++) {
      const x = between(rng, field.minX + rMax * 1.6, field.minX + field.width - rMax * 1.6);
      const y = between(rng, field.minY + rMax * 1.6, field.minY + field.height - rMax * 1.6);
      // Не ближе к любому гексу поля, чем его отмель (size × 3.4 от центра гекса) плюс своя отмель.
      const clear = rMax + size * 3.4 + Math.min(size, r * 0.75) * 1.6;
      if (centers.some((c) => Math.hypot(c.x - x, c.y - y) < clear)) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.y - y) < rMax + o.r * 1.3 + size * 2.2)) continue;
      const isl: Islet = { x, y, r, shape, kind, palms: [], rocks: [], bushes: [], lagoon: null };
      dressIslet(rng, isl, size);
      out.push(isl);
      break;
    }
  }
  return out;
}
