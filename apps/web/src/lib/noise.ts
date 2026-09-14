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

let sea: { veinsA: string; veinsB: string; swell: string } | null = null;
/**
 * Море без картинок: три бесшовные плитки шума, каждая со своим seed. «Жилки» — гребни шума (1 − |2n − 1|) в
 * высокой степени: тонкие светлые сетки бликов, как на воде; «зыбь» — крупные тёмные и светлые пятна. Плитки
 * кладутся слоями разного масштаба и направления, поэтому общего периода у рисунка нет.
 */
export function seaTiles(): { veinsA: string; veinsB: string; swell: string } {
  if (sea) return sea;
  // Жилки тонкие и негромкие: высокая степень сужает гребень, множитель гасит яркость; в воде блики намёком, не сеткой.
  const veins = (v: number) => { const r = 1 - Math.abs(2 * v - 1); return 255 * Math.pow(r, 12) * 0.62; };
  const a = noiseField([[9, 101, 0.5], [17, 131, 0.3], [37, 151, 0.15], [71, 181, 0.07]]);
  const b = noiseField([[8, 211, 0.5], [19, 241, 0.3], [41, 271, 0.15], [83, 307, 0.06]]);
  const c = noiseField([[3, 401, 0.6], [7, 431, 0.3], [19, 461, 0.1]]);
  sea = {
    veinsA: tileFrom(a, [222, 240, 244], veins).toDataURL("image/png"),
    veinsB: tileFrom(b, [208, 234, 240], veins).toDataURL("image/png"),
    swell: tileFrom(c, [22, 66, 92], (v) => 255 * Math.max(0, v - 0.42) * 0.6).toDataURL("image/png"),
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
