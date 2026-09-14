import { describe, expect, it } from "vitest";
import { generateIslets, isletRadiusAt, isletSeed, seaField } from "./islets.js";
import { hexToPixel } from "./hex.js";

const SIZE = 26;
/** Поле радиусом 4 гекса. */
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
    expect(a.length).toBeGreaterThanOrEqual(5);
  });

  it("лежат в поясе моря и не касаются поля и друг друга", () => {
    const islets = generateIslets(hexes, SIZE, b), f = seaField(b);
    const centers = hexes.map((h) => hexToPixel(h, SIZE));
    for (const isl of islets) {
      const rMax = Math.max(...isl.shape) * isl.r;
      expect(isl.x - rMax).toBeGreaterThanOrEqual(f.minX);
      expect(isl.x + rMax).toBeLessThanOrEqual(f.minX + f.width);
      expect(isl.y - rMax).toBeGreaterThanOrEqual(f.minY);
      expect(isl.y + rMax).toBeLessThanOrEqual(f.minY + f.height);
      for (const c of centers) expect(Math.hypot(c.x - isl.x, c.y - isl.y)).toBeGreaterThan(rMax + SIZE * 3);
      for (const o of islets) if (o !== isl) expect(Math.hypot(o.x - isl.x, o.y - isl.y)).toBeGreaterThan(rMax + o.r);
      // Пальмы, кусты и лагуна — на суше островка.
      for (const p of [...isl.palms, ...isl.bushes, ...(isl.lagoon ? [isl.lagoon] : [])]) {
        const a = Math.atan2(p.y - isl.y, p.x - isl.x);
        expect(Math.hypot(p.x - isl.x, p.y - isl.y)).toBeLessThan(isletRadiusAt(isl, a) * 0.7);
      }
    }
  });

  it("разные карты — разные раскладки", () => {
    const other = field(5);
    expect(JSON.stringify(generateIslets(other, SIZE, bounds(other)))).not.toBe(JSON.stringify(generateIslets(hexes, SIZE, b)));
  });
});
