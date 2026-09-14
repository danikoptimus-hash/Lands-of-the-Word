import { describe, expect, it } from "vitest";
import { ISLET_GAP, generateIslets, isletSeed, seaField } from "./islets.js";
import { hexDistance, hexToPixel } from "./hex.js";

const SIZE = 26;
/** Поле радиусом radius гексов. */
function field(radius: number) {
  const hexes: { q: number; r: number }[] = [];
  for (let q = -radius; q <= radius; q++) for (let r = -radius; r <= radius; r++) if (Math.abs(q + r) <= radius) hexes.push({ q, r });
  return hexes;
}
function bounds(hexes: { q: number; r: number }[]) {
  const cs = hexes.map((h) => hexToPixel(h, SIZE));
  const minX = Math.min(...cs.map((c) => c.x)) - SIZE * 1.2, maxX = Math.max(...cs.map((c) => c.x)) + SIZE * 1.2;
  const minY = Math.min(...cs.map((c) => c.y)) - SIZE * 1.2, maxY = Math.max(...cs.map((c) => c.y)) + SIZE * 1.2;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

describe("islets", () => {
  const hexes = field(4), b = bounds(hexes);

  it("детерминированы: один набор гексов — одна раскладка", () => {
    const a = generateIslets(hexes, SIZE, b), c = generateIslets(hexes, SIZE, b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
    expect(isletSeed(hexes)).toBe(isletSeed([...hexes].reverse()));
    expect(a.length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...a.map((i) => i.hexes.length))).toBeGreaterThanOrEqual(5);
  });

  it("лежат в поясе моря, не касаются поля и друг друга, гексы кластера связны", () => {
    const islets = generateIslets(hexes, SIZE, b), f = seaField(b);
    for (const isl of islets) {
      for (const h of isl.hexes) {
        const p = hexToPixel(h, SIZE);
        expect(p.x).toBeGreaterThan(f.minX); expect(p.x).toBeLessThan(f.minX + f.width);
        expect(p.y).toBeGreaterThan(f.minY); expect(p.y).toBeLessThan(f.minY + f.height);
        for (const fh of hexes) expect(hexDistance(fh, h)).toBeGreaterThanOrEqual(ISLET_GAP);
        for (const o of islets) if (o !== isl) for (const oh of o.hexes) expect(hexDistance(oh, h)).toBeGreaterThanOrEqual(ISLET_GAP);
        // Круг островка накрывает все его гексы с запасом.
        expect(Math.hypot(p.x - isl.x, p.y - isl.y) + SIZE).toBeLessThanOrEqual(isl.r);
      }
      // Связность: от первого гекса достижимы все.
      const seen = new Set([0]); const stack = [0];
      while (stack.length) { const i = stack.pop()!; isl.hexes.forEach((h, j) => { if (!seen.has(j) && hexDistance(h, isl.hexes[i]!) === 1) { seen.add(j); stack.push(j); } }); }
      expect(seen.size).toBe(isl.hexes.length);
    }
  });

  it("разные карты — разные раскладки", () => {
    const other = field(5);
    expect(JSON.stringify(generateIslets(other, SIZE, bounds(other)))).not.toBe(JSON.stringify(generateIslets(hexes, SIZE, b)));
  });
});
