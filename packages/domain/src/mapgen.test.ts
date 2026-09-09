import { describe, expect, it } from "vitest";
import { generateMap, MapGenError } from "./mapgen.js";
import { hexDistance } from "./hex.js";
import { BOOK_COUNT } from "./books.js";

describe("generateMap", () => {
  it("даёт 66 городов, ~250 узлов и стартов по числу команд", () => {
    const map = generateMap({ seed: 42, teamCount: 3 });
    const cities = map.nodes.filter((n) => n.kind === "city");
    const starts = map.nodes.filter((n) => n.kind === "start");
    expect(cities).toHaveLength(BOOK_COUNT);
    expect(starts).toHaveLength(3);
    expect(map.nodes.length).toBeGreaterThanOrEqual(230);
    expect(map.nodes.length).toBeLessThanOrEqual(250);
  });

  it("между городами всегда есть пустой узел", () => {
    const map = generateMap({ seed: 7, teamCount: 3 });
    const cities = map.nodes.filter((n) => n.kind === "city");
    for (let i = 0; i < cities.length; i++)
      for (let j = i + 1; j < cities.length; j++)
        expect(hexDistance(cities[i]!, cities[j]!)).toBeGreaterThanOrEqual(2);
  });

  it("книги по городам не повторяются", () => {
    const map = generateMap({ seed: 3, teamCount: 2 });
    const codes = map.nodes.filter((n) => n.kind === "city").map((n) => n.bookCode);
    expect(new Set(codes).size).toBe(BOOK_COUNT);
  });

  it("старты не рядом с городами и разница расстояний ≤ 3", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const map = generateMap({ seed, teamCount: 3, equidistantStarts: seed % 2 === 0 });
      const d = map.stats.startDistances;
      expect(Math.min(...d)).toBeGreaterThanOrEqual(2);
      expect(Math.max(...d) - Math.min(...d)).toBeLessThanOrEqual(3);
    }
  });

  it("детерминирована по seed", () => {
    const a = generateMap({ seed: 99, teamCount: 3 });
    const b = generateMap({ seed: 99, teamCount: 3 });
    expect(a).toEqual(b);
    const c = generateMap({ seed: 100, teamCount: 3 });
    expect(c.nodes.map((n) => n.kind).join("")).not.toEqual(a.nodes.map((n) => n.kind).join(""));
  });

  it("все соседние узлы соединены рёбрами", () => {
    const map = generateMap({ seed: 11, teamCount: 2 });
    const ids = new Set(map.nodes.map((n) => n.id));
    for (const e of map.edges) { expect(ids.has(e.a)).toBe(true); expect(ids.has(e.b)).toBe(true); }
    expect(map.edges.length).toBeGreaterThan(map.nodes.length * 2);
  });

  it("ругается на одну команду", () => {
    expect(() => generateMap({ seed: 1, teamCount: 1 })).toThrow(MapGenError);
  });
});
