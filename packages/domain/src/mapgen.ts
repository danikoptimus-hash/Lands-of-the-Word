import { BOOKS, BOOK_COUNT } from "./books.js";
import { hexDistance, hexKey, hexNeighbors, hexesInRadius, type Hex } from "./hex.js";
import { createRng, pick, randomInt, shuffle, type Rng } from "./random.js";

export type NodeKind = "empty" | "city" | "start";
export type Terrain = "desert" | "hills" | "meadow" | "mountains" | "water" | "oasis";

export interface MapNode {
  id: string;          // "q,r"
  q: number;
  r: number;
  kind: NodeKind;
  terrain: Terrain;
  rotation: number;    // 0..5, поворот текстуры гекса
  bookCode?: string;   // для городов
  cityType?: string;   // тип иллюстрации города
  teamIndex?: number;  // для стартов
}

export interface MapEdge { a: string; b: string }

export interface GeneratedMap {
  seed: number;
  nodes: MapNode[];
  edges: MapEdge[];
  stats: {
    nodeCount: number;
    cityCount: number;
    startDistances: number[]; // расстояние от старта каждой команды до ближайшего города
    minCityGap: number;       // минимальное расстояние между двумя городами
  };
}

export interface MapGenOptions {
  seed: number;
  teamCount: number;
  nodeCount?: number;            // ~250 по умолчанию
  cityCount?: number;            // 66
  equidistantStarts?: boolean;   // переключатель «равноудалённые старты»
  maxStartDistanceDiff?: number; // разница расстояний до первого города между командами, 2–3
  minCityGap?: number;           // минимум пустых развилок между городами + 1 (2 = хотя бы один пустой узел)
}

const CITY_TYPES = ["village", "walled_city", "fortress", "temple_city", "port", "tent_camp", "hill_city", "ruins"];
const TERRAINS: Terrain[] = ["desert", "hills", "meadow", "mountains", "oasis"];

/** Радиус шестиугольной области, дающий не меньше nodeCount гексов. */
function radiusFor(nodeCount: number): number {
  let r = 1;
  while (3 * r * r + 3 * r + 1 < nodeCount) r++;
  return r;
}

/** Примерно круглое поле: берём шестиугольник и случайно «обкусываем» край до нужного числа узлов. */
function buildField(rng: Rng, nodeCount: number): Hex[] {
  const radius = radiusFor(nodeCount);
  let hexes = hexesInRadius(radius);
  const center: Hex = { q: 0, r: 0 };
  // Сначала убираем самые дальние по евклидову радиусу, с шумом, чтобы край был неровный.
  const scored = hexes.map((h) => {
    const x = Math.sqrt(3) * h.q + (Math.sqrt(3) / 2) * h.r;
    const y = 1.5 * h.r;
    return { h, d: Math.hypot(x, y) + rng() * 1.2 };
  });
  scored.sort((a, b) => a.d - b.d);
  hexes = scored.slice(0, nodeCount).map((s) => s.h);
  // Гарантируем связность: оставляем только компонент, содержащий центр.
  const set = new Set(hexes.map(hexKey));
  const seen = new Set<string>();
  const queue: Hex[] = [center];
  seen.add(hexKey(center));
  while (queue.length) {
    const cur = queue.pop()!;
    for (const n of hexNeighbors(cur)) {
      const k = hexKey(n);
      if (set.has(k) && !seen.has(k)) { seen.add(k); queue.push(n); }
    }
  }
  return hexes.filter((h) => seen.has(hexKey(h)));
}

function nearestCityDistance(h: Hex, cities: Hex[]): number {
  let best = Infinity;
  for (const c of cities) best = Math.min(best, hexDistance(h, c));
  return best;
}

function terrainFor(rng: Rng, h: Hex, radius: number): Terrain {
  // Лёгкая зональность: центр зеленее, край суше; вода редкими пятнами.
  const d = hexDistance(h, { q: 0, r: 0 }) / radius;
  const roll = rng();
  if (roll < 0.05) return "water";
  if (d < 0.35) return roll < 0.6 ? "meadow" : roll < 0.85 ? "hills" : "oasis";
  if (d < 0.7) return roll < 0.35 ? "meadow" : roll < 0.7 ? "hills" : roll < 0.85 ? "desert" : "mountains";
  return roll < 0.5 ? "desert" : roll < 0.8 ? "hills" : roll < 0.95 ? "mountains" : "oasis";
}

export class MapGenError extends Error {}

/**
 * Генерация карты по правилам игры:
 * - ~nodeCount узлов, примерно круглое связное поле;
 * - ровно cityCount городов, между любыми двумя — хотя бы minCityGap-1 пустых узлов;
 * - teamCount стартов, не города и не рядом с городом; разница расстояний до ближайшего города ≤ maxStartDistanceDiff;
 * - книги по городам случайно; все соседние узлы соединены рёбрами.
 * Детерминирована по seed. Бросает MapGenError, если ограничения не удалось выполнить за разумное число попыток
 * (тогда админ жмёт «сгенерировать ещё раз» — будет другой seed).
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
  const field = buildField(rng, nodeCount);
  if (field.length < cityCount * 3) throw new MapGenError("Поле слишком маленькое для такого числа городов");
  const radius = radiusFor(nodeCount);

  // 1) Старты — первыми, чтобы вокруг них гарантированно осталось место без городов.
  //    Буфер: в радиусе startBuffer-1 от старта городов нет, значит ближайший город на расстоянии ≥ startBuffer.
  const startBuffer = 2;
  const center: Hex = { q: 0, r: 0 };
  const pickStarts = (): Hex[] => {
    const starts: Hex[] = [];
    const candidates = field.filter((h) => hexDistance(h, center) <= radius - 1);
    if (opts.equidistantStarts) {
      const ring = radius * 0.6;
      const phase = rng() * Math.PI * 2;
      for (let i = 0; i < teamCount; i++) {
        const ang = phase + (i * Math.PI * 2) / teamCount;
        const tx = Math.cos(ang) * ring * Math.sqrt(3);
        const ty = Math.sin(ang) * ring * 1.5;
        let best: Hex | null = null;
        let bestD = Infinity;
        for (const h of candidates) {
          if (starts.some((s) => hexDistance(s, h) < 4)) continue;
          const x = Math.sqrt(3) * h.q + (Math.sqrt(3) / 2) * h.r;
          const y = 1.5 * h.r;
          const d = Math.hypot(x - tx, y - ty) + rng() * 0.5;
          if (d < bestD) { bestD = d; best = h; }
        }
        if (best) starts.push(best);
      }
    } else {
      const minApart = Math.max(4, Math.floor(radius * 0.7));
      for (const h of shuffle(rng, candidates)) {
        if (starts.length >= teamCount) break;
        if (starts.every((s) => hexDistance(s, h) >= minApart)) starts.push(h);
      }
    }
    return starts;
  };

  // 2) Города: случайный жадный отбор с ограничением на расстояние, несколько попыток, берём лучшую.
  const placeCities = (starts: Hex[]): Hex[] => {
    const allowed = field.filter((h) => starts.every((s) => hexDistance(s, h) >= startBuffer));
    let best: Hex[] = [];
    for (let attempt = 0; attempt < 30 && best.length < cityCount; attempt++) {
      const cities: Hex[] = [];
      for (const h of shuffle(rng, allowed)) {
        if (cities.length >= cityCount) break;
        if (nearestCityDistance(h, cities) >= minCityGap) cities.push(h);
      }
      if (cities.length > best.length) best = cities;
    }
    return best;
  };

  let starts: Hex[] = [];
  let cities: Hex[] = [];
  let startDistances: number[] = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    starts = pickStarts();
    if (starts.length < teamCount) continue;
    cities = placeCities(starts);
    if (cities.length < cityCount) continue;
    startDistances = starts.map((s) => nearestCityDistance(s, cities));
    if (Math.max(...startDistances) - Math.min(...startDistances) <= maxDiff) break;
    starts = []; cities = [];
  }
  if (starts.length < teamCount) throw new MapGenError("Не удалось расставить старты");
  if (cities.length < cityCount) throw new MapGenError("Не удалось разместить все города с нужными промежутками");
  const cityKeys = new Set(cities.map(hexKey));
  const startKeys = new Map(starts.map((s, i) => [hexKey(s), i] as const));

  // Книги и типы городов.
  const books = shuffle(rng, BOOKS.map((b) => b.code)).slice(0, cityCount);

  const nodes: MapNode[] = field.map((h) => {
    const key = hexKey(h);
    const base = { id: key, q: h.q, r: h.r, terrain: terrainFor(rng, h, radius), rotation: randomInt(rng, 0, 5) };
    if (cityKeys.has(key)) {
      const idx = cities.findIndex((c) => hexKey(c) === key);
      return { ...base, kind: "city" as const, bookCode: books[idx]!, cityType: pick(rng, CITY_TYPES), terrain: base.terrain === "water" ? "meadow" : base.terrain };
    }
    if (startKeys.has(key)) return { ...base, kind: "start" as const, teamIndex: startKeys.get(key)!, terrain: "desert" as const };
    return { ...base, kind: "empty" as const };
  });

  // Рёбра между всеми соседними узлами (карта «зацикленная» в смысле связности).
  const nodeSet = new Set(nodes.map((n) => n.id));
  const edges: MapEdge[] = [];
  for (const n of nodes) {
    for (const nb of hexNeighbors({ q: n.q, r: n.r })) {
      const k = hexKey(nb);
      if (nodeSet.has(k) && n.id < k) edges.push({ a: n.id, b: k });
    }
  }

  let minGap = Infinity;
  for (let i = 0; i < cities.length; i++) for (let j = i + 1; j < cities.length; j++) minGap = Math.min(minGap, hexDistance(cities[i]!, cities[j]!));

  return { seed: opts.seed, nodes, edges, stats: { nodeCount: nodes.length, cityCount, startDistances, minCityGap: minGap } };
}

export { TERRAINS, CITY_TYPES };
