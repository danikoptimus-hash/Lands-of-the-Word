import { describe, expect, it } from "vitest";
import { coastLoops } from "./coast.js";
import { hexesInRadius } from "./hex.js";

describe("coastLoops", () => {
  it("один гекс — один контур из шести вершин", () => {
    const loops = coastLoops([{ q: 0, r: 0 }]);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
  });
  it("два соседних гекса — один контур из десяти вершин", () => {
    const loops = coastLoops([{ q: 0, r: 0 }, { q: 1, r: 0 }]);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(10);
  });
  it("кольцо с дырой — два контура", () => {
    const ring = hexesInRadius(2).filter((h) => !(h.q === 0 && h.r === 0));
    const loops = coastLoops(ring);
    expect(loops).toHaveLength(2);
    expect(loops.map((l) => l.length).sort((a, b) => a - b)).toEqual([6, 30]);
  });
  it("вершины идут по порядку: каждая следующая — сосед предыдущей", () => {
    const loops = coastLoops(hexesInRadius(3));
    expect(loops).toHaveLength(1);
    const loop = loops[0]!;
    expect(loop).toHaveLength(42);
    const keys = new Set(loop.map((v) => `${v.corner}:${v.q},${v.r}`));
    expect(keys.size).toBe(42);
  });
});
