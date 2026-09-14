/**
 * Бесшовный (замощаемый) шум для облаков тумана. Считается один раз при первом обращении,
 * без картинок: значение — сумма четырёх октав интерполированного случайного поля с периодом,
 * равным размеру плитки, поэтому плитка стыкуется сама с собой в обе стороны.
 */
const TILE = 512;

function lattice(n: number, seed: number): Float32Array {
  const a = new Float32Array(n * n);
  let s = seed >>> 0;
  for (let i = 0; i < a.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; a[i] = s / 4294967296; }
  return a;
}
const fade = (t: number) => t * t * (3 - 2 * t);

/** Октава: решётка n×n, растянутая на плитку (периодична по построению). */
function octave(n: number, seed: number, out: Float32Array, amp: number): void {
  const g = lattice(n, seed);
  const step = TILE / n;
  for (let y = 0; y < TILE; y++) {
    const gy = y / step, y0 = Math.floor(gy), y1 = (y0 + 1) % n, ty = fade(gy - y0);
    for (let x = 0; x < TILE; x++) {
      const gx = x / step, x0 = Math.floor(gx), x1 = (x0 + 1) % n, tx = fade(gx - x0);
      const v00 = g[y0 * n + x0]!, v10 = g[y0 * n + x1]!, v01 = g[y1 * n + x0]!, v11 = g[y1 * n + x1]!;
      const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
      out[y * TILE + x] = out[y * TILE + x]! + v * amp;
    }
  }
}

const fields = new Map<string, Float32Array>();
/** Поле шума 0..1 размером TILE×TILE из заданных октав [решётка, seed, амплитуда]; считается один раз на набор. */
export function noiseField(spec: ReadonlyArray<[number, number, number]>): Float32Array {
  const key = spec.map((o) => o.join(":")).join("|");
  const hit = fields.get(key);
  if (hit) return hit;
  const out = new Float32Array(TILE * TILE);
  for (const [n, seed, amp] of spec) octave(n, seed, out, amp);
  let min = Infinity, max = -Infinity;
  for (const v of out) { if (v < min) min = v; if (v > max) max = v; }
  for (let i = 0; i < out.length; i++) out[i] = (out[i]! - min) / (max - min);
  fields.set(key, out);
  return out;
}
/** Значения шума облаков 0..1 размером TILE×TILE. */
export function cloudNoise(): Float32Array {
  return noiseField([[5, 11, 0.5], [11, 23, 0.25], [23, 37, 0.125], [47, 51, 0.0625], [97, 73, 0.03]]);
}

/** Плитка из готового поля: цвет rgb, прозрачность 0..255 по функции от значения шума. */
function tileFrom(field: Float32Array, rgb: [number, number, number], alpha: (v: number) => number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE; c.height = TILE;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(TILE, TILE);
  for (let i = 0; i < field.length; i++) {
    img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2];
    img.data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(alpha(field[i]!))));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Клеточный (Worley) шум, периодичный по плитке: cells×cells случайных точек, для каждого пикселя — расстояния до
 * ближайшей (F1) и второй (F2) с переносом через край. Координаты пикселя перед поиском искажаются плавным шумом
 * (domain warp), поэтому границы ячеек не прямые, а изогнутые — как настоящие блики на воде.
 */
function worley(seed: number, cells: number, warp: number): { f1: Float32Array; f2: Float32Array } {
  let st = seed >>> 0;
  const rnd = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
  const px = new Float32Array(cells * cells), py = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) { px[i] = rnd(); py[i] = rnd(); }
  const wx = noiseField([[4, seed + 7, 0.6], [9, seed + 13, 0.3], [19, seed + 17, 0.1]]);
  const wy = noiseField([[4, seed + 23, 0.6], [9, seed + 29, 0.3], [19, seed + 31, 0.1]]);
  const f1 = new Float32Array(TILE * TILE), f2 = new Float32Array(TILE * TILE);
  const cs = TILE / cells;
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const k = y * TILE + x;
    // Искажённая точка выборки (по тору), в ячейках.
    const sx = ((x + (wx[k]! - 0.5) * warp) % TILE + TILE) % TILE / cs, sy = ((y + (wy[k]! - 0.5) * warp) % TILE + TILE) % TILE / cs;
    const cx = Math.floor(sx), cy = Math.floor(sy);
    let a = Infinity, b = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const gx = (cx + dx + cells) % cells, gy = (cy + dy + cells) % cells;
      const i = gy * cells + gx;
      const d = Math.hypot(cx + dx + px[i]! - sx, cy + dy + py[i]! - sy);
      if (d < a) { b = a; a = d; } else if (d < b) b = d;
    }
    f1[k] = a; f2[k] = b;
  }
  return { f1, f2 };
}

export interface SeaTiles { causticA: HTMLCanvasElement; causticB: HTMLCanvasElement; swell: HTMLCanvasElement }
let sea: SeaTiles | null = null;
/**
 * Море без картинок: две плитки каустики (искажённый клеточный шум разной плотности: тонкие изогнутые светлые линии
 * на границах ячеек, гаснущие пятнами по маске из плавного шума) и плитка зыби (крупный шум, затемнение). Считается один раз.
 */
export function seaTiles(): SeaTiles {
  if (sea) return sea;
  const caustic = (seed: number, cells: number, width: number, warp: number, rgb: [number, number, number]) => {
    const { f1, f2 } = worley(seed, cells, warp);
    const mask = noiseField([[3, seed + 41, 0.6], [7, seed + 43, 0.3], [15, seed + 47, 0.1]]);
    const field = new Float32Array(TILE * TILE);
    for (let i = 0; i < field.length; i++) {
      const e = (f2[i]! - f1[i]!) / width;
      const line = Math.exp(-e * e);                       // мягкая линия по границе ячейки
      const m = Math.min(1, Math.max(0, (mask[i]! - 0.3) / 0.5)); // блики пятнами: где маска низкая — их нет
      field[i] = line * (0.35 + 0.65 * m);
    }
    return tileFrom(field, rgb, (v) => 255 * v);
  };
  const swellField = noiseField([[3, 401, 0.6], [7, 431, 0.3], [19, 461, 0.1]]);
  sea = {
    causticA: caustic(9001, 12, 0.16, 70, [226, 245, 247]),
    causticB: caustic(9103, 17, 0.14, 90, [216, 240, 244]),
    swell: tileFrom(swellField, [18, 58, 84], (v) => 255 * Math.max(0, v - 0.4) * 0.7),
  };
  return sea;
}

/**
 * Плитка облака: цвет rgb, прозрачность от lo до hi по шуму (с «мягким порогом», чтобы были и просветы, и плотные места).
 */
export function cloudTile(rgb: [number, number, number], lo: number, hi: number, gamma = 1): HTMLCanvasElement {
  return tileFrom(cloudNoise(), rgb, (v) => 255 * (lo + (hi - lo) * Math.pow(v, gamma)));
}
export const CLOUD_TILE = TILE;
