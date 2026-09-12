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

let cached: Float32Array | null = null;
/** Значения шума 0..1 размером TILE×TILE. */
export function cloudNoise(): Float32Array {
  if (cached) return cached;
  const out = new Float32Array(TILE * TILE);
  octave(5, 11, out, 0.5); octave(11, 23, out, 0.25); octave(23, 37, out, 0.125); octave(47, 51, out, 0.0625); octave(97, 73, out, 0.03);
  let min = Infinity, max = -Infinity;
  for (const v of out) { if (v < min) min = v; if (v > max) max = v; }
  for (let i = 0; i < out.length; i++) out[i] = (out[i]! - min) / (max - min);
  cached = out;
  return out;
}

/**
 * Плитка облака: цвет rgb, прозрачность от lo до hi по шуму (с «мягким порогом», чтобы были и просветы, и плотные места).
 */
export function cloudTile(rgb: [number, number, number], lo: number, hi: number, gamma = 1): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE; c.height = TILE;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(TILE, TILE);
  const n = cloudNoise();
  for (let i = 0; i < n.length; i++) {
    const v = Math.pow(n[i]!, gamma);
    img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2];
    img.data[i * 4 + 3] = Math.round(255 * (lo + (hi - lo) * v));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
export const CLOUD_TILE = TILE;
