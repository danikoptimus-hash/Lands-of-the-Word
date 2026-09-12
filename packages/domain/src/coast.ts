import { hexKey, type Hex } from "./hex.js";
import { hexCorners, vertexKey, type Vertex } from "./hexgraph.js";

/** Сосед за стороной i (сторона между углами i и i+1 в порядке hexCorners: N, NE, SE, S, SW, NW). */
const SIDE_NEIGHBOR: readonly Hex[] = [
  { q: 1, r: -1 }, { q: 1, r: 0 }, { q: 0, r: 1 },
  { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 },
];

/**
 * Береговая линия острова: замкнутые контуры из вершин по границе множества гексов
 * (сторона граничная, если за ней нет гекса). Обходится по часовой стрелке для внешнего контура;
 * дыры внутри поля дают отдельные контуры. Вершины даются по порядку, без повторения первой.
 */
export function coastLoops(hexes: Hex[]): Vertex[][] {
  const set = new Set(hexes.map(hexKey));
  const next = new Map<string, Vertex[]>();
  const vertices = new Map<string, Vertex>();
  for (const h of hexes) {
    const corners = hexCorners(h);
    for (let i = 0; i < 6; i++) {
      const n = SIDE_NEIGHBOR[i]!;
      if (set.has(hexKey({ q: h.q + n.q, r: h.r + n.r }))) continue;
      const a = corners[i]!, b = corners[(i + 1) % 6]!;
      const ak = vertexKey(a);
      vertices.set(ak, a); vertices.set(vertexKey(b), b);
      const list = next.get(ak) ?? [];
      list.push(b);
      next.set(ak, list);
    }
  }
  const loops: Vertex[][] = [];
  for (const [startKey] of next) {
    const first = next.get(startKey);
    if (!first || first.length === 0) continue;
    const loop: Vertex[] = [];
    let cur = startKey;
    // Ограничение по длине — защита от бесконечного цикла при некорректных данных.
    for (let guard = 0; guard < 100000; guard++) {
      const outs = next.get(cur);
      if (!outs || outs.length === 0) break;
      loop.push(vertices.get(cur)!);
      const to = outs.shift()!;
      cur = vertexKey(to);
      if (cur === startKey) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}
