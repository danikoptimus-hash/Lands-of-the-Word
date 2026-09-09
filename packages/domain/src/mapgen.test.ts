import { describe, expect, it } from "vitest";
import { generateMap, MapGenError } from "./mapgen.js";
import { buildHexGraph, graphDistances, hexCorners, vertexHexes, vertexKey } from "./hexgraph.js";
import { hexKey } from "./hex.js";
import { hexesInRadius } from "./hex.js";
import { BOOK_COUNT } from "./books.js";

describe("hexgraph", () => {
  it("вершины гексов общие: у соседних гексов совпадают два угла", () => {
    const a = hexCorners({ q: 0, r: 0 }).map(vertexKey), b = hexCorners({ q: 1, r: 0 }).map(vertexKey);
    expect(a.filter((k) => b.includes(k))).toHaveLength(2);
  });
  it("внутренние вершины имеют степень 3, рёбер ~3 на гекс", () => {
    const g = buildHexGraph(hexesInRadius(4));
    const deg = [...g.adjacency.values()].map((s) => s.size);
    expect(deg.filter((d) => d === 3).length).toBeGreaterThan(deg.length * 0.6);
    expect(deg.every((d) => d >= 2)).toBe(true);
    expect(g.edges.length).toBeGreaterThan(hexesInRadius(4).length * 2.5);
  });
});

describe("generateMap", () => {
  it("66 городов на перекрёстках, ~250 перекрёстков, старты по числу команд", () => {
    const map = generateMap({ seed: 42, teamCount: 3 });
    const cities = map.nodes.filter((n) => n.kind === "city");
    const starts = map.nodes.filter((n) => n.kind === "start");
    expect(cities).toHaveLength(BOOK_COUNT);
    expect(starts).toHaveLength(3);
    expect(map.nodes.length).toBeGreaterThanOrEqual(200);
    expect(map.nodes.length).toBeLessThanOrEqual(320);
    expect(map.hexes.length).toBeGreaterThan(80);
  });

  it("между городами всегда есть хотя бы одна развилка (нет общего ребра)", () => {
    const map = generateMap({ seed: 7, teamCount: 3 });
    const citySet = new Set(map.nodes.filter((n) => n.kind === "city").map((n) => n.id));
    for (const e of map.edges) expect(citySet.has(e.a) && citySet.has(e.b)).toBe(false);
    expect(map.stats.minCityGap).toBeGreaterThanOrEqual(2);
  });

  it("книги не повторяются; старты — не города, до ближайшего города ≥ 2, разница ≤ 3", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const map = generateMap({ seed, teamCount: 3, equidistantStarts: seed % 2 === 0 });
      const codes = map.nodes.filter((n) => n.kind === "city").map((n) => n.bookCode);
      expect(new Set(codes).size).toBe(BOOK_COUNT);
      const d = map.stats.startDistances;
      expect(Math.min(...d)).toBeGreaterThanOrEqual(2);
      const fieldSet = new Set(map.hexes.map((h) => hexKey(h)));
      for (const st of map.nodes.filter((n) => n.kind === "start")) expect(vertexHexes(st).every((h) => fieldSet.has(hexKey(h)))).toBe(true);
      expect(Math.max(...d) - Math.min(...d)).toBeLessThanOrEqual(3);
    }
  });

  it("детерминирована по seed; все рёбра соединяют существующие узлы; граф связный", () => {
    const a = generateMap({ seed: 99, teamCount: 3 }), b = generateMap({ seed: 99, teamCount: 3 });
    expect(a).toEqual(b);
    const ids = new Set(a.nodes.map((n) => n.id));
    for (const e of a.edges) { expect(ids.has(e.a)).toBe(true); expect(ids.has(e.b)).toBe(true); }
    const g = buildHexGraph(a.hexes);
    expect(graphDistances(g, a.nodes[0]!.id).size).toBe(a.nodes.length);
  });

  it("ругается на одну команду", () => {
    expect(() => generateMap({ seed: 1, teamCount: 1 })).toThrow(MapGenError);
  });
});
