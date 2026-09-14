import { describe, expect, it } from "vitest";
import { generateIslets, isletRadiusAt, isletSeed, seaField } from "./islets.js";
import { ISLET_IMAGES, ISLET_SHAPE_N } from "./isletShapes.js";
import { hexToPixel } from "./hex.js";

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
  const hexes = field(5), b = bounds(hexes);

  it("контуры картинок сняты: шесть картинок по 72 отсчёта, край не дальше половины стороны", () => {
    expect(ISLET_IMAGES).toHaveLength(6);
    for (const s of ISLET_IMAGES) { expect(s.shape).toHaveLength(ISLET_SHAPE_N); expect(s.maxR).toBeLessThanOrEqual(1); expect(Math.min(...s.shape)).toBeGreaterThan(0); }
  });

  it("детерминированы: один набор гексов — одна раскладка; картинки разные", () => {
    const a = generateIslets(hexes, SIZE, b), c = generateIslets(hexes, SIZE, b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
    expect(isletSeed(hexes)).toBe(isletSeed([...hexes].reverse()));
    expect(a.length).toBeGreaterThanOrEqual(5);
    expect(new Set(a.map((i) => i.img)).size).toBeGreaterThanOrEqual(4);
    for (const i of a) { expect(i.img).toBeGreaterThanOrEqual(1); expect(i.img).toBeLessThanOrEqual(6); expect(i.cover).toBeGreaterThan(i.r * 0.5); }
  });

  it("лежат в поясе моря, не касаются поля и друг друга", () => {
    const islets = generateIslets(hexes, SIZE, b), f = seaField(b);
    const centers = hexes.map((h) => hexToPixel(h, SIZE));
    for (const isl of islets) {
      expect(isl.x - isl.cover).toBeGreaterThanOrEqual(f.minX);
      expect(isl.x + isl.cover).toBeLessThanOrEqual(f.minX + f.width);
      expect(isl.y - isl.cover).toBeGreaterThanOrEqual(f.minY);
      expect(isl.y + isl.cover).toBeLessThanOrEqual(f.minY + f.height);
      for (const c of centers) expect(Math.hypot(c.x - isl.x, c.y - isl.y)).toBeGreaterThan(isl.cover + SIZE * 3);
      for (const o of islets) if (o !== isl) expect(Math.hypot(o.x - isl.x, o.y - isl.y)).toBeGreaterThan(isl.cover + o.cover);
      // Контур целиком внутри круга cover.
      for (let k = 0; k < 24; k++) expect(isletRadiusAt(isl, (k / 24) * Math.PI * 2)).toBeLessThanOrEqual(isl.cover);
    }
  });

  it("разные карты — разные раскладки", () => {
    const other = field(6);
    expect(JSON.stringify(generateIslets(other, SIZE, bounds(other)))).not.toBe(JSON.stringify(generateIslets(hexes, SIZE, b)));
  });
});
