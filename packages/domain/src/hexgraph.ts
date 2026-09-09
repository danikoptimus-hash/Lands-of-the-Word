import { hexKey, hexNeighbors, hexToPixel, type Hex } from "./hex.js";

/**
 * Граф «как в Колонизаторах» поверх гексов (pointy-top, осевые координаты):
 * узлы — вершины гексов (перекрёстки трёх гексов), рёбра — стороны гексов.
 * Каждая вершина — верхняя (N) ровно одного гекса или нижняя (S) ровно одного гекса.
 */
export type Corner = "N" | "S";
export interface Vertex { corner: Corner; q: number; r: number }

export function vertexKey(v: Vertex): string { return `${v.corner}:${v.q},${v.r}`; }
export function parseVertexKey(key: string): Vertex {
  const [corner, rest] = key.split(":") as [Corner, string];
  const [q, r] = rest.split(",").map(Number) as [number, number];
  return { corner, q, r };
}

/** Шесть углов гекса по часовой стрелке от верхнего: N, NE, SE, S, SW, NW. */
export function hexCorners(h: Hex): Vertex[] {
  return [
    { corner: "N", q: h.q, r: h.r },
    { corner: "S", q: h.q + 1, r: h.r - 1 },
    { corner: "N", q: h.q, r: h.r + 1 },
    { corner: "S", q: h.q, r: h.r },
    { corner: "N", q: h.q - 1, r: h.r + 1 },
    { corner: "S", q: h.q, r: h.r - 1 },
  ];
}

/** Три гекса, сходящиеся в вершине. */
export function vertexHexes(v: Vertex): Hex[] {
  return v.corner === "N"
    ? [{ q: v.q, r: v.r }, { q: v.q, r: v.r - 1 }, { q: v.q + 1, r: v.r - 1 }]
    : [{ q: v.q, r: v.r }, { q: v.q, r: v.r + 1 }, { q: v.q - 1, r: v.r + 1 }];
}

/** Пиксельная позиция вершины (для отрисовки). */
export function vertexToPixel(v: Vertex, size: number): { x: number; y: number } {
  const c = hexToPixel({ q: v.q, r: v.r }, size);
  return { x: c.x, y: v.corner === "N" ? c.y - size : c.y + size };
}

export function edgeKey(a: string, b: string): string { return a < b ? `${a}|${b}` : `${b}|${a}`; }

export interface HexGraph {
  vertices: Map<string, Vertex>;
  /** Соседи каждой вершины (ключи). */
  adjacency: Map<string, Set<string>>;
  edges: Array<{ a: string; b: string }>;
}

/** Строит граф вершин и сторон по множеству гексов. Вершины со степенью < 2 (край) отбрасываются. */
export function buildHexGraph(field: Hex[]): HexGraph {
  const vertices = new Map<string, Vertex>();
  const adjacency = new Map<string, Set<string>>();
  const edgeSet = new Set<string>();
  const fieldSet = new Set(field.map(hexKey));
  for (const h of field) {
    const corners = hexCorners(h);
    for (let i = 0; i < 6; i++) {
      const a = corners[i]!, b = corners[(i + 1) % 6]!;
      const ka = vertexKey(a), kb = vertexKey(b);
      vertices.set(ka, a); vertices.set(kb, b);
      const ek = edgeKey(ka, kb);
      if (edgeSet.has(ek)) continue;
      edgeSet.add(ek);
      (adjacency.get(ka) ?? adjacency.set(ka, new Set()).get(ka)!).add(kb);
      (adjacency.get(kb) ?? adjacency.set(kb, new Set()).get(kb)!).add(ka);
    }
  }
  // Убираем краевые вершины степени 1 (их нет в замкнутом поле) и вершины, все гексы которых вне поля.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [k, nbrs] of adjacency) {
      if (nbrs.size < 2) {
        for (const n of nbrs) adjacency.get(n)?.delete(k);
        adjacency.delete(k); vertices.delete(k); changed = true;
      }
    }
  }
  void fieldSet;
  const edges: Array<{ a: string; b: string }> = [];
  for (const [a, nbrs] of adjacency) for (const b of nbrs) if (a < b) edges.push({ a, b });
  return { vertices, adjacency, edges };
}

/** Расстояние в рёбрах между вершинами (BFS). */
export function graphDistances(graph: HexGraph, from: string, limit = Infinity): Map<string, number> {
  const dist = new Map<string, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    if (d >= limit) continue;
    for (const n of graph.adjacency.get(cur) ?? []) if (!dist.has(n)) { dist.set(n, d + 1); queue.push(n); }
  }
  return dist;
}

/** Направление словами от вершины a к вершине b (по углу на экране). */
export function directionBetween(a: Vertex, b: Vertex): string {
  const pa = vertexToPixel(a, 1), pb = vertexToPixel(b, 1);
  const ang = (Math.atan2(-(pb.y - pa.y), pb.x - pa.x) * 180) / Math.PI; // 0 = восток, 90 = север
  const names = ["восток", "северо-восток", "север", "северо-запад", "запад", "юго-запад", "юг", "юго-восток"];
  const idx = Math.round((((ang % 360) + 360) % 360) / 45) % 8;
  return names[idx]!;
}
