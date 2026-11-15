import { describe, expect, it } from "vitest";
import { chebyshevDistance } from "./chebyshev";

/** Прежний способ (до ревизии 15.11): расширение ядром 3×3 шаг за шагом, не дальше maxD. Эталон для сверки. */
function byDilation(rgba: Uint8Array, P: number, maxD: number): Uint8Array {
  let cur = new Uint8Array(P * P), next = new Uint8Array(P * P); const out = new Uint8Array(P * P).fill(255);
  for (let i = 0; i < P * P; i++) if (rgba[i * 4 + 3]! >= 128) { cur[i] = 1; out[i] = 0; }
  for (let step = 1; step <= maxD; step++) {
    let any = false;
    for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
      const i = y * P + x; if (cur[i]) { next[i] = 1; continue; }
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++) { const yy = y + dy; if (yy < 0 || yy >= P) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= P) continue; if (cur[yy * P + xx]) { on = 1; break; } } }
      next[i] = on; if (on) { out[i] = step; any = true; }
    }
    [cur, next] = [next, cur]; if (!any) break;
  }
  return out;
}

/** Картинка P×P: пятна непрозрачных пикселей случайной формы (детерминированно по зерну). */
function picture(P: number, seed: number, fill: number): Uint8Array {
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const rgba = new Uint8Array(P * P * 4);
  for (let i = 0; i < P * P; i++) rgba[i * 4 + 3] = rnd() < fill ? 128 + Math.floor(rnd() * 128) : Math.floor(rnd() * 128);
  return rgba;
}

describe("расстояние Чебышёва для обводки городов", () => {
  it("совпадает с прежним расчётом на случайных картинках", () => {
    for (const [P, fill, maxD] of [[16, 0.05, 24], [32, 0.01, 24], [64, 0.002, 24], [64, 0.3, 6], [128, 0.0005, 24], [128, 0.02, 3]] as const) {
      for (let seed = 1; seed <= 4; seed++) {
        const rgba = picture(P, seed * 7919 + P, fill);
        expect(Array.from(chebyshevDistance(rgba, P, maxD))).toEqual(Array.from(byDilation(rgba, P, maxD)));
      }
    }
  });
  it("пустая и сплошная картинки", () => {
    const P = 16, empty = new Uint8Array(P * P * 4), full = new Uint8Array(P * P * 4).fill(255);
    expect(chebyshevDistance(empty, P, 24).every((v) => v === 255)).toBe(true);
    expect(chebyshevDistance(full, P, 24).every((v) => v === 0)).toBe(true);
  });
});
