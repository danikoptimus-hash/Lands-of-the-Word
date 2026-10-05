import { hexDistance, hexKey, hexNeighbors, hexToPixel, type Hex } from "./hex.js";
import { parseVertexKey, vertexHexes, vertexToPixel } from "./hexgraph.js";
import { isletRadiusAt } from "./islets.js";

export interface Pt { x: number; y: number }
/** Препятствие в море (декоративный островок): центр, радиус и контур (как у `Islet`); без контура — круг. */
export interface SeaObstacle { x: number; y: number; r: number; shape?: number[] }

/**
 * Морской маршрут корабля (решение владельца 05.10): от порта к месту высадки строго по воде, плавной линией.
 * Поиск пути A* по водным гексам (гекс — вода, если его нет среди гексов суши и он не накрыт островком); шаг у берега
 * дороже, поэтому линия держится от суши на гекс, где это возможно. Точки — центры водных гексов, в начале —
 * корабль у порта (или сам порт), в конце — точка высадки; сглаживание — в `smoothRoute`.
 */
export function seaRoute(land: ReadonlySet<string>, fromKey: string, toKey: string, size: number, start?: Pt, obstacles: ReadonlyArray<SeaObstacle> = []): Pt[] {
  const from = parseVertexKey(fromKey), to = parseVertexKey(toKey);
  const a = vertexToPixel(from, size), b = vertexToPixel(to, size);
  const blocked = (h: Hex) => {
    if (land.has(hexKey(h))) return true;
    if (!obstacles.length) return false;
    const c = hexToPixel(h, size);
    return obstacles.some((o) => {
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      const edge = o.shape?.length ? isletRadiusAt({ r: o.r, shape: o.shape }, Math.atan2(c.y - o.y, c.x - o.x)) : o.r;
      return d < edge + size * 0.7;
    });
  };
  const isWater = (h: Hex) => !blocked(h);
  const starts = vertexHexes(from).filter((h) => !land.has(hexKey(h))), ends = vertexHexes(to).filter((h) => !land.has(hexKey(h)));
  if (!starts.length || !ends.length) return [start ?? a, b];
  const coastal = (h: Hex) => hexNeighbors(h).some((n) => land.has(hexKey(n)));
  const endSet = new Set(ends.map(hexKey));
  const span = Math.max(...starts.map((s) => Math.max(...ends.map((e) => hexDistance(s, e)))));
  const limit = span + 10;
  const nearest = (h: Hex) => Math.min(...ends.map((e) => hexDistance(h, e)));
  interface Node { h: Hex; g: number; f: number; parent: Node | null }
  const open: Node[] = starts.map((h) => ({ h, g: 0, f: nearest(h), parent: null }));
  const best = new Map<string, number>(starts.map((h) => [hexKey(h), 0]));
  const closed = new Set<string>();
  let found: Node | null = null;
  for (let guard = 0; open.length && guard < 40_000; guard++) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i;
    const cur = open.splice(bi, 1)[0]!;
    const ck = hexKey(cur.h);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (endSet.has(ck)) { found = cur; break; }
    for (const n of hexNeighbors(cur.h)) {
      const k = hexKey(n);
      if (closed.has(k) || !isWater(n)) continue;
      if (hexDistance(n, starts[0]!) > limit || nearest(n) > limit) continue;
      const g = cur.g + 1 + (coastal(n) ? 2.5 : 0);
      if ((best.get(k) ?? Infinity) <= g) continue;
      best.set(k, g);
      open.push({ h: n, g, f: g + nearest(n), parent: cur });
    }
  }
  if (!found) return [start ?? a, b];
  const cells: Hex[] = [];
  for (let n: Node | null = found; n; n = n.parent) cells.unshift(n.h);
  return pullRoute([start ?? a, ...cells.map((h) => hexToPixel(h, size)), b], land, size, obstacles);
}

/** Гекс (pointy-top) по точке карты: осевые координаты с кубическим округлением. */
export function pixelToHex(p: Pt, size: number): Hex {
  const qf = ((Math.sqrt(3) / 3) * p.x - (1 / 3) * p.y) / size, rf = ((2 / 3) * p.y) / size;
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf);
  const sr = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(sr - sf);
  if (dq > dr && dq > ds) q = -r - sr; else if (dr > ds) r = -q - sr;
  return { q, r };
}

/** Точка в воде с запасом от берега: её гекс не суша, до центра любого соседнего гекса суши не ближе 1.45 размера (≈0.6 размера от кромки). */
function clearAt(p: Pt, land: ReadonlySet<string>, size: number, obstacles: ReadonlyArray<SeaObstacle>): boolean {
  const h = pixelToHex(p, size);
  if (land.has(hexKey(h))) return false;
  for (const n of hexNeighbors(h)) {
    if (!land.has(hexKey(n))) continue;
    const c = hexToPixel(n, size);
    if (Math.hypot(c.x - p.x, c.y - p.y) < size * 1.45) return false;
  }
  return !obstacles.some((o) => {
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    const edge = o.shape?.length ? isletRadiusAt({ r: o.r, shape: o.shape }, Math.atan2(p.y - o.y, p.x - o.x)) : o.r;
    return d < edge + size * 0.7;
  });
}

/** Отрезок целиком в воде (проверка по точкам через полразмера гекса; концы — порт и высадка — не проверяются). */
function segmentClear(a: Pt, b: Pt, land: ReadonlySet<string>, size: number, obstacles: ReadonlyArray<SeaObstacle>, skipEnds: boolean): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(len / (size * 0.5)));
  for (let i = skipEnds ? 1 : 0; i <= (skipEnds ? n - 1 : n); i++) {
    const t = i / n;
    if (!clearAt({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, land, size, obstacles)) return false;
  }
  return true;
}

/**
 * Натяжение маршрута: из ломаной по центрам гексов убираются промежуточные точки, пока прямая между оставшимися
 * идёт по воде с запасом от берега — вместо ступенек вдоль рядов гексов получается прямая, изгибающаяся только у суши.
 */
export function pullRoute(pts: ReadonlyArray<Pt>, land: ReadonlySet<string>, size: number, obstacles: ReadonlyArray<SeaObstacle> = []): Pt[] {
  if (pts.length <= 2) return [...pts];
  const out: Pt[] = [pts[0]!];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    for (; j > i + 1; j--) {
      const ends = i === 0 || j === pts.length - 1;
      if (segmentClear(pts[i]!, pts[j]!, land, size, obstacles, ends)) break;
    }
    out.push(pts[j]!);
    i = j;
  }
  return out;
}

/** Сглаживание ломаной по Чайкину (срезание углов, концы на месте) после натяжения `pullRoute`. */
export function smoothRoute(pts: ReadonlyArray<Pt>, iterations = 3, step = 52): Pt[] {
  // Длинные отрезки делятся на куски не длиннее `step` (два размера гекса): срез угла тогда не глубже половины гекса, запас от берега больше.
  let cur: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (i > 0) {
      const a = pts[i - 1]!, n = Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / step);
      for (let k = 1; k < n; k++) cur.push({ x: a.x + (p.x - a.x) * (k / n), y: a.y + (p.y - a.y) * (k / n) });
    }
    cur.push(p);
  }
  for (let it = 0; it < iterations && cur.length > 2; it++) {
    const out: Pt[] = [cur[0]!];
    for (let i = 0; i < cur.length - 1; i++) {
      const p = cur[i]!, q = cur[i + 1]!;
      out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 }, { x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
    }
    out.push(cur[cur.length - 1]!);
    cur = out;
  }
  return cur;
}

/** Атрибут `d` SVG-пути по точкам. */
export function routePathD(pts: ReadonlyArray<Pt>): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

/** Направление в конце маршрута (угол в градусах для стрелки) по последним точкам. */
export function routeHeading(pts: ReadonlyArray<Pt>): number {
  if (pts.length < 2) return 0;
  const b = pts[pts.length - 1]!, a = pts[Math.max(0, pts.length - 4)]!;
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** Стрелка направления: точка на маршруте за `back` пикселей до конца (чтобы не прятаться под значком высадки) и курс. */
export function routeArrow(pts: ReadonlyArray<Pt>, back: number): { x: number; y: number; heading: number } {
  const end = pts[pts.length - 1]!;
  if (pts.length < 2) return { x: end.x, y: end.y, heading: 0 };
  let left = back, i = pts.length - 1;
  while (i > 0) {
    const p = pts[i]!, q = pts[i - 1]!, d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d >= left) { const t = left / d; const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t; return { x, y, heading: (Math.atan2(p.y - q.y, p.x - q.x) * 180) / Math.PI }; }
    left -= d; i--;
  }
  const a = pts[0]!;
  return { x: a.x, y: a.y, heading: (Math.atan2(end.y - a.y, end.x - a.x) * 180) / Math.PI };
}
