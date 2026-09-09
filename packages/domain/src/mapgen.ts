import { BOOKS, BOOK_COUNT } from "./books.js";
import { hexDistance, hexKey, hexNeighbors, hexesInRadius, type Hex } from "./hex.js";
import { buildHexGraph, graphDistances, vertexToPixel, type HexGraph } from "./hexgraph.js";
import { createRng, pick, randomInt, shuffle, type Rng } from "./random.js";

export type NodeKind = "empty" | "city" | "start";
export type Terrain = "desert" | "hills" | "meadow" | "mountains" | "water" | "oasis";

/** Гекс — только местность (декорация и туман). */
export interface MapHexTile { q: number; r: number; terrain: Terrain; rotation: number }

/** Узел — перекрёсток (вершина гекса): пустая развилка, город или старт. */
export interface MapNode {
  id: string;          // "N:q,r" | "S:q,r"
  corner: "N" | "S";
  q: number;
  r: number;
  kind: NodeKind;
  bookCode?: string;
  cityType?: string;
  teamIndex?: number;
}

/** Ребро — сторона гекса между двумя перекрёстками; по ним ходят команды. */
export interface MapEdge { a: string; b: string }

export interface GeneratedMap {
  seed: number;
  hexes: MapHexTile[];
  nodes: MapNode[];
  edges: MapEdge[];
  stats: { hexCount: number; nodeCount: number; cityCount: number; startDistances: number[]; minCityGap: number };
}

export interface MapGenOptions {
  seed: number;
  teamCount: number;
  nodeCount?: number;            // сколько перекрёстков хотим (~250)
  cityCount?: number;            // 66
  equidistantStarts?: boolean;
  maxStartDistanceDiff?: number; // разница расстояний до первого города между командами, 2–3
  minCityGap?: number;           // минимум рёбер между городами (2 = хотя бы одна развилка между ними)
}

const CITY_TYPES = ["village", "walled_city", "fortress", "temple_city", "port", "tent_camp", "hill_city", "ruins"];
const TERRAINS: Terrain[] = ["desert", "hills", "meadow", "mountains", "oasis"];

function radiusFor(hexCount: number): number {
  let r = 1;
  while (3 * r * r + 3 * r + 1 < hexCount) r++;
  return r;
}

/** Примерно круглое связное поле гексов. */
function buildField(rng: Rng, hexCount: number): Hex[] {
  const radius = radiusFor(hexCount);
  const scored = hexesInRadius(radius).map((h) => {
    const x = Math.sqrt(3) * h.q + (Math.sqrt(3) / 2) * h.r, y = 1.5 * h.r;
    return { h, d: Math.hypot(x, y) + rng() * 1.2 };
  });
  scored.sort((a, b) => a.d - b.d);
  const hexes = scored.slice(0, hexCount).map((s) => s.h);
  const set = new Set(hexes.map(hexKey));
  const seen = new Set<string>(["0,0"]);
  const queue: Hex[] = [{ q: 0, r: 0 }];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const n of hexNeighbors(cur)) { const k = hexKey(n); if (set.has(k) && !seen.has(k)) { seen.add(k); queue.push(n); } }
  }
  return hexes.filter((h) => seen.has(hexKey(h)));
}

function terrainFor(rng: Rng, h: Hex, radius: number): Terrain {
  const d = hexDistance(h, { q: 0, r: 0 }) / radius;
  const roll = rng();
  if (roll < 0.05) return "water";
  if (d < 0.35) return roll < 0.6 ? "meadow" : roll < 0.85 ? "hills" : "oasis";
  if (d < 0.7) return roll < 0.35 ? "meadow" : roll < 0.7 ? "hills" : roll < 0.85 ? "desert" : "mountains";
  return roll < 0.5 ? "desert" : roll < 0.8 ? "hills" : roll < 0.95 ? "mountains" : "oasis";
}

export class MapGenError extends Error {}

function nearest(graph: HexGraph, from: string, targets: Set<string>): number {
  const d = graphDistances(graph, from);
  let best = Infinity;
  for (const t of targets) best = Math.min(best, d.get(t) ?? Infinity);
  return best;
}

/**
 * Генерация карты «по сторонам гексов»:
 * - поле гексов (местность) такого размера, чтобы перекрёстков было ~nodeCount;
 * - ровно cityCount городов на перекрёстках, между любыми двумя ≥ minCityGap рёбер;
 * - старты на перекрёстках: не города, ближайший город на расстоянии ≥ 2 рёбер, разница между командами ≤ maxDiff;
 * - книги случайно; рёбра — все стороны гексов.
 */
export function generateMap(opts: MapGenOptions): GeneratedMap {
  const nodeCount = opts.nodeCount ?? 250;
  const cityCount = opts.cityCount ?? BOOK_COUNT;
  const minCityGap = opts.minCityGap ?? 2;
  const maxDiff = opts.maxStartDistanceDiff ?? 3;
  const teamCount = opts.teamCount;
  if (teamCount < 2) throw new MapGenError("Нужно минимум две команды");
  if (cityCount > BOOK_COUNT) throw new MapGenError(`Городов не больше ${BOOK_COUNT}`);

  const rng = createRng(opts.seed);
  // Перекрёстков примерно 2 на гекс (плюс край) — подбираем число гексов.
  const hexCount = Math.max(19, Math.round(nodeCount / 2.15));
  const field = buildField(rng, hexCount);
  const radius = radiusFor(hexCount);
  const graph = buildHexGraph(field);
  const keys = [...graph.vertices.keys()];
  if (keys.length < cityCount * 3) throw new MapGenError("Поле слишком маленькое для такого числа городов");

  const startBuffer = 2;
  const center = { x: 0, y: 0 };
  const pos = new Map(keys.map((k) => [k, vertexToPixel(graph.vertices.get(k)!, 1)]));
  const maxR = Math.max(...keys.map((k) => Math.hypot(pos.get(k)!.x, pos.get(k)!.y)));

  const pickStarts = (): string[] => {
    const starts: string[] = [];
    const candidates = keys.filter((k) => Math.hypot(pos.get(k)!.x - center.x, pos.get(k)!.y - center.y) <= maxR * 0.85 && (graph.adjacency.get(k)?.size ?? 0) === 3);
    if (opts.equidistantStarts) {
      const ring = maxR * 0.6, phase = rng() * Math.PI * 2;
      for (let i = 0; i < teamCount; i++) {
        const ang = phase + (i * Math.PI * 2) / teamCount;
        const tx = Math.cos(ang) * ring, ty = Math.sin(ang) * ring;
        let best: string | null = null, bestD = Infinity;
        for (const k of candidates) {
          if (starts.some((s) => (graphDistances(graph, s, 6).get(k) ?? 99) < 6)) continue;
          const d = Math.hypot(pos.get(k)!.x - tx, pos.get(k)!.y - ty) + rng() * 0.5;
          if (d < bestD) { bestD = d; best = k; }
        }
        if (best) starts.push(best);
      }
    } else {
      const minApart = 8;
      for (const k of shuffle(rng, candidates)) {
        if (starts.length >= teamCount) break;
        if (starts.every((s) => (graphDistances(graph, s, minApart).get(k) ?? 99) >= minApart)) starts.push(k);
      }
    }
    return starts;
  };

  const placeCities = (starts: string[]): string[] => {
    const blocked = new Set<string>();
    for (const s of starts) for (const [k, d] of graphDistances(graph, s, startBuffer - 1)) if (d <= startBuffer - 1) blocked.add(k);
    const allowed = keys.filter((k) => !blocked.has(k));
    let best: string[] = [];
    for (let attempt = 0; attempt < 30 && best.length < cityCount; attempt++) {
      const cities: string[] = [];
      const taken = new Set<string>(); // вершины ближе minCityGap к уже поставленным городам
      for (const k of shuffle(rng, allowed)) {
        if (cities.length >= cityCount) break;
        if (taken.has(k)) continue;
        cities.push(k);
        for (const [n, d] of graphDistances(graph, k, minCityGap - 1)) if (d <= minCityGap - 1) taken.add(n);
      }
      if (cities.length > best.length) best = cities;
    }
    return best;
  };

  let starts: string[] = [], cities: string[] = [], startDistances: number[] = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    starts = pickStarts();
    if (starts.length < teamCount) continue;
    cities = placeCities(starts);
    if (cities.length < cityCount) continue;
    const citySet = new Set(cities);
    startDistances = starts.map((s) => nearest(graph, s, citySet));
    if (Math.max(...startDistances) - Math.min(...startDistances) <= maxDiff) break;
    starts = []; cities = [];
  }
  if (starts.length < teamCount) throw new MapGenError("Не удалось расставить старты");
  if (cities.length < cityCount) throw new MapGenError("Не удалось разместить все города с нужными промежутками");

  const cityIndex = new Map(cities.map((k, i) => [k, i]));
  const startIndex = new Map(starts.map((k, i) => [k, i]));
  const books = shuffle(rng, BOOKS.map((b) => b.code)).slice(0, cityCount);

  const hexes: MapHexTile[] = field.map((h) => ({ q: h.q, r: h.r, terrain: terrainFor(rng, h, radius), rotation: randomInt(rng, 0, 5) }));
  const nodes: MapNode[] = keys.map((k) => {
    const v = graph.vertices.get(k)!;
    const base = { id: k, corner: v.corner, q: v.q, r: v.r };
    if (cityIndex.has(k)) return { ...base, kind: "city" as const, bookCode: books[cityIndex.get(k)!]!, cityType: pick(rng, CITY_TYPES) };
    if (startIndex.has(k)) return { ...base, kind: "start" as const, teamIndex: startIndex.get(k)! };
    return { ...base, kind: "empty" as const };
  });

  let minGap = Infinity;
  const citySet = new Set(cities);
  for (const c of cities) { const d = graphDistances(graph, c, 6); for (const [k, dd] of d) if (k !== c && citySet.has(k)) minGap = Math.min(minGap, dd); }

  return { seed: opts.seed, hexes, nodes, edges: graph.edges, stats: { hexCount: hexes.length, nodeCount: nodes.length, cityCount, startDistances, minCityGap: minGap } };
}

export { TERRAINS, CITY_TYPES };
