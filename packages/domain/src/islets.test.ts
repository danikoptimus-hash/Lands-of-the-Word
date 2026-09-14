import { describe, expect, it } from "vitest";
import { generateIslets, isletRadiusAt, isletSeed, seaField } from "./islets.js";
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
  const hexes = field(4), b = bounds(hexes);

  it("детерминированы: один набор гексов — одна раскладка", () => {
    const a = generateIslets(hexes, SIZE, b), c = generateIslets(hexes, SIZE, b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
    expect(isletSeed(hexes)).toBe(isletSeed([...hexes].reverse()));
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...a.map((i) => i.r))).toBeGreaterThanOrEqual(SIZE * 1.7);
  });

  it("лежат в поясе моря, не касаются поля и друг друга; суша закрыта пятнами местности", () => {
    const islets = generateIslets(hexes, SIZE, b), f = seaField(b);
    const centers = hexes.map((h) => hexToPixel(h, SIZE));
    for (const isl of islets) {
      expect(isl.x - isl.cover).toBeGreaterThanOrEqual(f.minX);
      expect(isl.x + isl.cover).toBeLessThanOrEqual(f.minX + f.width);
      expect(isl.y - isl.cover).toBeGreaterThanOrEqual(f.minY);
      expect(isl.y + isl.cover).toBeLessThanOrEqual(f.minY + f.height);
      for (const c of centers) expect(Math.hypot(c.x - isl.x, c.y - isl.y)).toBeGreaterThan(isl.cover + SIZE * 3);
      for (const o of islets) if (o !== isl) expect(Math.hypot(o.x - isl.x, o.y - isl.y)).toBeGreaterThan(isl.cover + o.cover);
      // Контур — плавный: соседние отсчёты отличаются не больше чем на 15%.
      for (let i = 0; i < isl.shape.length; i++) expect(Math.abs(isl.shape[i]! - isl.shape[(i + 1) % isl.shape.length]!)).toBeLessThan(0.2);
      // Любая точка суши не дальше 1.2 гекса от центра какого-нибудь пятна (пятна перекрывают сушу).
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, d = isletRadiusAt(isl, a) * 0.9;
        const px = isl.x + Math.cos(a) * d, py = isl.y + Math.sin(a) * d;
        const near = Math.min(...isl.cells.map((c) => { const p = hexToPixel(c, SIZE); return Math.hypot(p.x - px, p.y - py); }));
        expect(near).toBeLessThan(SIZE * 1.2);
      }
    }
  });

  it("разные карты — разные раскладки", () => {
    const other = field(5);
    expect(JSON.stringify(generateIslets(other, SIZE, bounds(other)))).not.toBe(JSON.stringify(generateIslets(hexes, SIZE, b)));
  });
});
