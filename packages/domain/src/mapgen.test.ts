import { describe, expect, it } from "vitest";
import { generateMap, MapGenError, SEA_BOOKS } from "./mapgen.js";
import { BOOKS } from "./books.js";
import { buildHexGraph, graphDistances, hexCorners, vertexHexes, vertexKey } from "./hexgraph.js";
import { hexKey, hexNeighbors } from "./hex.js";
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

  it("детерминирована по seed; все рёбра соединяют существующие узлы; каждый остров связный, между островами рёбер нет", () => {
    const a = generateMap({ seed: 99, teamCount: 3 }), b = generateMap({ seed: 99, teamCount: 3 });
    expect(a).toEqual(b);
    const ids = new Set(a.nodes.map((n) => n.id));
    for (const e of a.edges) { expect(ids.has(e.a)).toBe(true); expect(ids.has(e.b)).toBe(true); }
    // Связность — по дорогам карты (внутри морей дорог нет, поэтому граф по всем гексам не годится).
    const adjacency = new Map<string, Set<string>>();
    for (const e of a.edges) { (adjacency.get(e.a) ?? adjacency.set(e.a, new Set()).get(e.a)!).add(e.b); (adjacency.get(e.b) ?? adjacency.set(e.b, new Set()).get(e.b)!).add(e.a); }
    const g = { vertices: new Map(), adjacency, edges: a.edges };
    const islandOf = new Map(a.nodes.map((n) => [n.id, n.island]));
    for (const e of a.edges) expect(islandOf.get(e.a)).toBe(islandOf.get(e.b));
    for (const isl of ["OT", "NT"] as const) {
      const mine = a.nodes.filter((n) => n.island === isl);
      expect(graphDistances(g, mine[0]!.id).size).toBe(mine.length);
    }
  });

  it("два острова: 39 книг Ветхого Завета на одном, 27 Нового — на другом; старты только на Ветхом", () => {
    for (const seed of [3, 11, 25]) {
      const map = generateMap({ seed, teamCount: 3 });
      const testament = new Map(BOOKS.map((b) => [b.code, b.testament]));
      const cities = map.nodes.filter((n) => n.kind === "city");
      expect(cities.filter((n) => n.island === "OT")).toHaveLength(39);
      expect(cities.filter((n) => n.island === "NT")).toHaveLength(27);
      for (const c of cities) expect(testament.get(c.bookCode!)).toBe(c.island);
      for (const st of map.nodes.filter((n) => n.kind === "start")) expect(st.island).toBe("OT");
      expect(map.hexes.filter((h) => h.island === "OT").length).toBeGreaterThan(map.hexes.filter((h) => h.island === "NT").length);
      // Между островами пролив: ни один гекс одного острова не соседствует с гексом другого.
      const ot = map.hexes.filter((h) => h.island === "OT"), nt = map.hexes.filter((h) => h.island === "NT");
      let minD = Infinity;
      for (const a of ot) for (const b of nt) minD = Math.min(minD, Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r)));
      expect(minD).toBeGreaterThanOrEqual(3);
    }
  });

  it("береговые города — порты, внутренние — нет; морские книги стоят у берега", () => {
    for (const seed of [5, 8, 13]) {
      const map = generateMap({ seed, teamCount: 2 });
      const fieldSet = new Set(map.hexes.map((h) => hexKey(h)));
      for (const n of map.nodes) {
        const coastal = vertexHexes(n).some((h) => !fieldSet.has(hexKey(h)));
        expect(n.coastal).toBe(coastal);
        if (n.kind === "city") expect(n.cityType === "port").toBe(coastal);
      }
      const seaCities = map.nodes.filter((n) => n.kind === "city" && SEA_BOOKS.includes(n.bookCode!));
      expect(seaCities).toHaveLength(SEA_BOOKS.length);
      for (const c of seaCities) expect(c.coastal).toBe(true);
    }
  });

  it("расстояние между городами задаётся: gap 3 при поле ×2.25 — минимум 3 ребра, среднее больше, чем при gap 2", () => {
    const near = generateMap({ seed: 11, teamCount: 3 });
    const far = generateMap({ seed: 11, teamCount: 3, minCityGap: 3, nodeCount: Math.round(250 * 2.25) });
    expect(near.stats.minCityGap).toBeGreaterThanOrEqual(2);
    expect(far.stats.minCityGap).toBeGreaterThanOrEqual(3);
    expect(far.stats.avgCityGap).toBeGreaterThan(near.stats.avgCityGap);
    expect(far.stats.cityCount).toBe(near.stats.cityCount);
  });

  it("ругается на одну команду", () => {
    expect(() => generateMap({ seed: 1, teamCount: 1 })).toThrow(MapGenError);
  });
});

describe("моря на карте (решение владельца 06.10)", () => {
  it("внутренние моря вырезаны в глубине островов, по их воде дорог нет, острова связны", () => {
    for (const seed of [1, 7, 42, 99, 123]) {
      const map = generateMap({ seed, teamCount: 3 });
      const seaHexes = map.hexes.filter((h) => h.sea);
      expect(seaHexes.length).toBeGreaterThanOrEqual(10);
      expect(Object.keys(map.stats.seas).sort()).toEqual(["adria", "galilee", "merom", "red", "salt"]);
      const fieldSet = new Set(map.hexes.map(hexKey));
      const seaSet = new Set(seaHexes.map(hexKey));
      // Все соседи морского гекса — на поле (море не выходит к проливу), а сам гекс — вода.
      for (const h of seaHexes) { expect(h.terrain).toBe("water"); for (const n of hexNeighbors(h)) expect(fieldSet.has(hexKey(n))).toBe(true); }
      // Ни одна сторона не лежит между двумя гексами моря, ни один узел не стоит посреди моря.
      const ids = new Map(map.nodes.map((n) => [n.id, n]));
      for (const e of map.edges) {
        const ha = vertexHexes(ids.get(e.a)!).map(hexKey), shared = vertexHexes(ids.get(e.b)!).filter((h) => ha.includes(hexKey(h)));
        expect(shared.every((h) => seaSet.has(hexKey(h)))).toBe(false);
      }
      for (const n of map.nodes) expect(vertexHexes(n).every((h) => seaSet.has(hexKey(h)))).toBe(false);
      // Берег моря помечен на узлах; город может стоять на берегу, но порт — только у пролива.
      const shore = map.nodes.filter((n) => n.sea);
      expect(shore.length).toBeGreaterThan(10);
      for (const n of shore) expect(vertexHexes(n).some((h) => seaSet.has(hexKey(h)))).toBe(true);
      for (const n of map.nodes) if (n.kind === "city" && n.cityType === "port") expect(n.coastal).toBe(true);
      // Каждый остров остаётся связным по оставшимся дорогам.
      const adjacency = new Map<string, Set<string>>();
      for (const e of map.edges) { (adjacency.get(e.a) ?? adjacency.set(e.a, new Set()).get(e.a)!).add(e.b); (adjacency.get(e.b) ?? adjacency.set(e.b, new Set()).get(e.b)!).add(e.a); }
      for (const isl of ["OT", "NT"] as const) {
        const mine = map.nodes.filter((n) => n.island === isl);
        const seen = new Set([mine[0]!.id]); const queue = [mine[0]!.id];
        while (queue.length) { const c = queue.pop()!; for (const n of adjacency.get(c) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); } }
        expect(seen.size).toBe(mine.length);
      }
    }
  });
});
