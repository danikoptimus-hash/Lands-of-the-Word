import { BOOKS, BOOK_COUNT } from "./books.js";
import { hexDistance, hexKey, hexNeighbors, hexesInRadius, type Hex } from "./hex.js";
import { buildHexGraph, graphDistances, vertexHexes, vertexToPixel, type HexGraph } from "./hexgraph.js";
import { createRng, pick, randomInt, shuffle, type Rng } from "./random.js";

export type NodeKind = "empty" | "city" | "start";
export type Terrain = "desert" | "hills" | "meadow" | "mountains" | "water" | "oasis";
/** Остров: Ветхий Завет (старты команд, 39 книг) и Новый Завет (27 книг), между ними пролив. */
export type Island = "OT" | "NT";

/** Гекс — только местность (декорация и туман). */
export interface MapHexTile { q: number; r: number; terrain: Terrain; rotation: number; island: Island }

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
  island: Island;
  /** Береговой узел: хотя бы один из трёх гексов вокруг — море. Береговой город — порт, из него ходят корабли. */
  coastal: boolean;
}

/** Ребро — сторона гекса между двумя перекрёстками; по ним ходят команды. */
export interface MapEdge { a: string; b: string }

export interface GeneratedMap {
  seed: number;
  hexes: MapHexTile[];
  nodes: MapNode[];
  edges: MapEdge[];
  stats: { hexCount: number; nodeCount: number; cityCount: number; startDistances: number[]; minCityGap: number; islands: Record<Island, { hexes: number; cities: number; ports: number }> };
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
/** Внутренние города: любой тип, кроме порта. Порт — только береговые города. */
const INLAND_CITY_TYPES = CITY_TYPES.filter((t) => t !== "port");
const TERRAINS: Terrain[] = ["desert", "hills", "meadow", "mountains", "oasis"];
/**
 * Книги, в которых есть события на море (решение владельца): такие города ставятся на берег в первую очередь.
 * Бытие, Исход (Чермное море), 3 Царств и 2 Паралипоменон (корабли), Псалтирь (Пс. 106), Исаия (о Тире), Иезекииль
 * (плач о Тире), Иона; Евангелия (Галилейское море), Деяния (плавания Павла), 2 Коринфянам (кораблекрушения), Откровение.
 */
export const SEA_BOOKS: readonly string[] = ["gen", "exo", "1ki", "2ch", "psa", "isa", "ezk", "jon", "mat", "mrk", "luk", "jhn", "act", "2co", "rev"];
/** Просвет между островами в гексах (пролив). */
const STRAIT = 3;

function radiusFor(hexCount: number): number {
  let r = 1;
  while (3 * r * r + 3 * r + 1 < hexCount) r++;
  return r;
}

/** Примерно круглое связное поле гексов вокруг центра offset. */
function buildField(rng: Rng, hexCount: number, offset: Hex = { q: 0, r: 0 }): Hex[] {
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
  return hexes.filter((h) => seen.has(hexKey(h))).map((h) => ({ q: h.q + offset.q, r: h.r + offset.r }));
}

function terrainFor(rng: Rng, h: Hex, center: Hex, radius: number): Terrain {
  const d = hexDistance(h, center) / radius;
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
  const otBooks = BOOKS.filter((b) => b.testament === "OT").map((b) => b.code), ntBooks = BOOKS.filter((b) => b.testament === "NT").map((b) => b.code);
  // Города делятся между островами пропорционально числу книг заветов; так же делятся и гексы.
  const otCities = Math.min(otBooks.length, Math.round((cityCount * otBooks.length) / BOOK_COUNT)), ntCities = Math.min(ntBooks.length, cityCount - otCities);
  const hexCount = Math.max(38, Math.round(nodeCount / 2.15));
  const otHexCount = Math.max(19, Math.round((hexCount * otCities) / Math.max(1, otCities + ntCities))), ntHexCount = Math.max(19, hexCount - otHexCount);
  const otRadius = radiusFor(otHexCount), ntRadius = radiusFor(ntHexCount);
  // Новый Завет — справа от Ветхого за проливом, чуть выше или ниже (случайно), чтобы острова не стояли по линейке.
  const dr = randomInt(rng, -2, 2);
  const ntCenter: Hex = { q: otRadius + ntRadius + STRAIT + Math.max(0, -dr), r: dr };
  const otField = buildField(rng, otHexCount), ntField = buildField(rng, ntHexCount, ntCenter);
  const field = [...otField, ...ntField];
  const islandByHex = new Map<string, Island>([...otField.map((h) => [hexKey(h), "OT"] as const), ...ntField.map((h) => [hexKey(h), "NT"] as const)]);
  const graph = buildHexGraph(field);
  const keys = [...graph.vertices.keys()];
  const fieldSet = new Set(field.map(hexKey));
  const islandOf = (k: string): Island => { for (const h of vertexHexes(graph.vertices.get(k)!)) { const i = islandByHex.get(hexKey(h)); if (i) return i; } return "OT"; };
  const coastal = (k: string) => vertexHexes(graph.vertices.get(k)!).some((h) => !fieldSet.has(hexKey(h)));
  const otKeys = keys.filter((k) => islandOf(k) === "OT"), ntKeys = keys.filter((k) => islandOf(k) === "NT");
  if (otKeys.length < otCities * 3 || ntKeys.length < ntCities * 3) throw new MapGenError("Поле слишком маленькое для такого числа городов");

  const startBuffer = 2;
  const pos = new Map(keys.map((k) => [k, vertexToPixel(graph.vertices.get(k)!, 1)]));
  const maxR = Math.max(...otKeys.map((k) => Math.hypot(pos.get(k)!.x, pos.get(k)!.y)));

  // Старт — внутренний перекрёсток Ветхого Завета: все три гекса вокруг него есть на поле.
  const interior = (k: string) => vertexHexes(graph.vertices.get(k)!).every((h) => fieldSet.has(hexKey(h)));
  const pickStarts = (): string[] => {
    const starts: string[] = [];
    const candidates = otKeys.filter((k) => Math.hypot(pos.get(k)!.x, pos.get(k)!.y) <= maxR * 0.85 && interior(k));
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

  /**
   * Города одного острова: сначала coastalFirst городов на береговых узлах (под «морские» книги), потом
   * остальные где угодно; между любыми двумя ≥ minCityGap рёбер.
   */
  const placeCities = (starts: string[], islandKeys: string[], count: number, coastalFirst: number): string[] => {
    const blocked = new Set<string>();
    for (const s of starts) for (const [k, d] of graphDistances(graph, s, startBuffer - 1)) if (d <= startBuffer - 1) blocked.add(k);
    const allowed = islandKeys.filter((k) => !blocked.has(k));
    let best: string[] = [];
    for (let attempt = 0; attempt < 30 && best.length < count; attempt++) {
      const cities: string[] = [];
      const taken = new Set<string>(); // вершины ближе minCityGap к уже поставленным городам
      const tryPlace = (k: string, limit: number) => {
        if (cities.length >= limit || taken.has(k)) return;
        cities.push(k);
        for (const [n, d] of graphDistances(graph, k, minCityGap - 1)) if (d <= minCityGap - 1) taken.add(n);
      };
      for (const k of shuffle(rng, allowed.filter(coastal))) tryPlace(k, Math.min(count, coastalFirst));
      for (const k of shuffle(rng, allowed)) tryPlace(k, count);
      if (cities.length > best.length) best = cities;
    }
    return best;
  };

  const seaOT = otBooks.filter((b) => SEA_BOOKS.includes(b)), seaNT = ntBooks.filter((b) => SEA_BOOKS.includes(b));
  let starts: string[] = [], cities: string[] = [], startDistances: number[] = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    starts = pickStarts();
    if (starts.length < teamCount) continue;
    const ot = placeCities(starts, otKeys, otCities, seaOT.length), nt = placeCities(starts, ntKeys, ntCities, seaNT.length);
    if (ot.length < otCities || nt.length < ntCities) continue;
    cities = [...ot, ...nt];
    const otSet = new Set(ot);
    startDistances = starts.map((s) => nearest(graph, s, otSet));
    if (Math.max(...startDistances) - Math.min(...startDistances) <= maxDiff) break;
    starts = []; cities = [];
  }
  if (starts.length < teamCount) throw new MapGenError("Не удалось расставить старты");
  if (cities.length < otCities + ntCities) throw new MapGenError("Не удалось разместить все города с нужными промежутками");

  /** Книги острова: морские — береговым городам (сколько поместится), остальные — случайно. */
  const assignBooks = (cityKeys: string[], books: string[], sea: string[]): Map<string, string> => {
    const out = new Map<string, string>();
    const coast = shuffle(rng, cityKeys.filter(coastal)), inland = shuffle(rng, cityKeys.filter((k) => !coastal(k)));
    const seaBooks = shuffle(rng, sea), rest = shuffle(rng, books.filter((b) => !sea.includes(b)));
    const order = [...coast, ...inland];
    // Сначала морские книги по береговым узлам, затем всё остальное по оставшимся узлам (если городов меньше, чем книг, — часть книг не попадает).
    let bi = 0;
    for (const k of coast) if (bi < seaBooks.length) out.set(k, seaBooks[bi++]!);
    const leftover = [...seaBooks.slice(bi), ...rest];
    let li = 0;
    for (const k of order) if (!out.has(k)) out.set(k, leftover[li++]!);
    return out;
  };
  const bookByCity = new Map([...assignBooks(cities.filter((k) => islandOf(k) === "OT"), otBooks, seaOT), ...assignBooks(cities.filter((k) => islandOf(k) === "NT"), ntBooks, seaNT)]);
  const startIndex = new Map(starts.map((k, i) => [k, i]));

  const hexes: MapHexTile[] = field.map((h) => {
    const island = islandByHex.get(hexKey(h))!;
    return { q: h.q, r: h.r, terrain: terrainFor(rng, h, island === "OT" ? { q: 0, r: 0 } : ntCenter, island === "OT" ? otRadius : ntRadius), rotation: randomInt(rng, 0, 5), island };
  });
  const nodes: MapNode[] = keys.map((k) => {
    const v = graph.vertices.get(k)!;
    const base = { id: k, corner: v.corner, q: v.q, r: v.r, island: islandOf(k), coastal: coastal(k) };
    if (bookByCity.has(k)) return { ...base, kind: "city" as const, bookCode: bookByCity.get(k)!, cityType: base.coastal ? "port" : pick(rng, INLAND_CITY_TYPES) };
    if (startIndex.has(k)) return { ...base, kind: "start" as const, teamIndex: startIndex.get(k)! };
    return { ...base, kind: "empty" as const };
  });

  let minGap = Infinity;
  const citySet = new Set(cities);
  for (const c of cities) { const d = graphDistances(graph, c, 6); for (const [k, dd] of d) if (k !== c && citySet.has(k)) minGap = Math.min(minGap, dd); }
  const islandStats = (isl: Island) => ({ hexes: hexes.filter((h) => h.island === isl).length, cities: nodes.filter((n) => n.island === isl && n.kind === "city").length, ports: nodes.filter((n) => n.island === isl && n.kind === "city" && n.coastal).length });

  return { seed: opts.seed, hexes, nodes, edges: graph.edges, stats: { hexCount: hexes.length, nodeCount: nodes.length, cityCount: cities.length, startDistances, minCityGap: minGap, islands: { OT: islandStats("OT"), NT: islandStats("NT") } } };
}

export { TERRAINS, CITY_TYPES };
