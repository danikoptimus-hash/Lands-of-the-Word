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
      return d < edge + size * 1.0;
    });
  };
  const isWater = (h: Hex) => !blocked(h);
  const starts = vertexHexes(from).filter((h) => !land.has(hexKey(h))), ends = vertexHexes(to).filter((h) => !land.has(hexKey(h)));
  if (!starts.length || !ends.length) return [start ?? a, b];
  const coastal = (h: Hex) => hexNeighbors(h).some((n) => land.has(hexKey(n)));
  // Второе кольцо от берега тоже дороже, чем открытое море: где есть место, маршрут держится в двух гексах от суши.
  const nearCoast = (h: Hex) => hexNeighbors(h).some((n) => coastal(n));
  const stepCost = (h: Hex) => 1 + (coastal(h) ? 4 : nearCoast(h) ? 1.5 : 0);
  /** Точка отхода/подхода: от вершины берега в сторону воды (к центрам её водных гексов) на 1.4 размера. */
  const offshore = (v: Pt, water: Hex[]): Pt => {
    const cx = water.reduce((t, h) => t + hexToPixel(h, size).x, 0) / water.length, cy = water.reduce((t, h) => t + hexToPixel(h, size).y, 0) / water.length;
    const dx = cx - v.x, dy = cy - v.y, d = Math.hypot(dx, dy) || 1;
    return { x: v.x + (dx / d) * size * 1.4, y: v.y + (dy / d) * size * 1.4 };
  };
  // Сначала одна плавная S-кривая (решение владельца 05.10 по рисунку): выход из порта и подход к высадке перпендикулярно
  // берегу, между ними кубическая кривая Безье; берётся самый широкий изгиб, который целиком лежит на воде с запасом.
  // Направления выхода и подхода: нормаль к берегу, смешанная с направлением на другой конец, — иначе у высадки,
  // лежащей «за углом», кривая делала петлю (замечание владельца 05.10). Если нормаль смотрит прочь от цели — чистая
  // нормаль. Точки выхода и подхода (1.4 размера от берега) лежат на этих же направлениях, чтобы последний отрезок
  // к берегу продолжал кривую без излома.
  const dep0 = start ?? offshore(a, starts), app0 = offshore(b, ends);
  const dir0 = unit(app0, dep0);
  const blend = (n: Pt, d: Pt): Pt => { const v = { x: n.x + d.x, y: n.y + d.y }; const l = Math.hypot(v.x, v.y); return l < 0.3 ? n : { x: v.x / l, y: v.y / l }; };
  const outA = blend(unit(dep0, a), dir0), outB = blend(unit(app0, b), { x: -dir0.x, y: -dir0.y });
  const depPt = start ?? { x: a.x + outA.x * size * 1.4, y: a.y + outA.y * size * 1.4 }, appPt = { x: b.x + outB.x * size * 1.4, y: b.y + outB.y * size * 1.4 };
  const dist = Math.hypot(appPt.x - depPt.x, appPt.y - depPt.y);
  // У выхода из порта и у подхода к высадке (2.5 размера от вершины берега) запас в гекс невозможен: там достаточно не задеть сушу.
  const nearEnd = (q: Pt) => Math.hypot(q.x - a.x, q.y - a.y) < size * 2.5 || Math.hypot(q.x - b.x, q.y - b.y) < size * 2.5;
  const okAt = (q: Pt, margin: number) => (nearEnd(q) ? offLand(q, land, size, obstacles) : clearAt(q, land, size, obstacles, margin));
  // Запас от берега: сначала гекс, в узком проливе — меньше; при каждом запасе — сначала естественный изгиб (треть расстояния), затем шире, затем положе.
  for (const margin of [2.0, 1.6, 1.3]) {
    for (const k of [0.33, 0.4, 0.5, 0.26, 0.2, 0.15]) {
      const c1 = { x: depPt.x + outA.x * dist * k, y: depPt.y + outA.y * dist * k }, c2 = { x: appPt.x + outB.x * dist * k, y: appPt.y + outB.y * dist * k };
      const n = Math.max(8, Math.ceil((dist * (1 + k)) / (size * 0.5)));
      const pts: Pt[] = [];
      for (let i = 0; i <= n; i++) pts.push(bezier(depPt, c1, c2, appPt, i / n));
      if (pts.every((q) => okAt(q, margin))) return [a, ...pts, b];
    }
  }
  const endSet = new Set(ends.map(hexKey));
  const span = Math.max(...starts.map((s) => Math.max(...ends.map((e) => hexDistance(s, e)))));
  const limit = span + 10;
  const nearest = (h: Hex) => Math.min(...ends.map((e) => hexDistance(h, e)));
  interface Node { h: Hex; g: number; f: number; parent: Node | null }
  // Сначала ищем путь по воде не ближе двух гексов к суше (у самых концов берег неизбежен), иначе — по любой воде.
  const search = (strict: boolean): Hex[] | null => {
    const open: Node[] = starts.map((h) => ({ h, g: 0, f: nearest(h), parent: null }));
    const best = new Map<string, number>(starts.map((h) => [hexKey(h), 0]));
    const closed = new Set<string>();
    for (let guard = 0; open.length && guard < 40_000; guard++) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i]!.f < open[bi]!.f) bi = i;
      const cur = open.splice(bi, 1)[0]!;
      const ck = hexKey(cur.h);
      if (closed.has(ck)) continue;
      closed.add(ck);
      if (endSet.has(ck)) { const cells: Hex[] = []; for (let n: Node | null = cur; n; n = n.parent) cells.unshift(n.h); return cells; }
      for (const n of hexNeighbors(cur.h)) {
        const k = hexKey(n);
        if (closed.has(k) || !isWater(n)) continue;
        if (hexDistance(n, starts[0]!) > limit || nearest(n) > limit) continue;
        const nearEnds = Math.min(hexDistance(n, starts[0]!), nearest(n)) <= 2;
        if (strict && coastal(n) && !nearEnds && !endSet.has(k)) continue;
        const g = cur.g + stepCost(n);
        if ((best.get(k) ?? Infinity) <= g) continue;
        best.set(k, g);
        open.push({ h: n, g, f: g + nearest(n), parent: cur });
      }
    }
    return null;
  };
  const cells = search(true) ?? search(false);
  if (!cells) return [start ?? a, b];
  // Отход от порта и подход к высадке — короткие прямые в море (решение владельца 05.10: подходить с воды, а не вдоль
  // берега); между ними ломаная по центрам гексов натягивается в прямые там, где вода позволяет.
  // Запасной путь без углов: ломаная по центрам гексов натягивается, как резинка, которой нельзя подходить к берегу
  // ближе запаса — получаются плавные дуги вокруг мысов и островков.
  const bandOk = (q: Pt) => okAt(q, 2.2) || (okAt(q, 1.6) && nearEndWide(q));
  const band = elasticBand([a, depPt, ...cells.map((h) => hexToPixel(h, size)), appPt, b], size, bandOk);
  return bulge(band, size, bandOk);

  function nearEndWide(q: Pt): boolean { return Math.hypot(q.x - a.x, q.y - a.y) < size * 4 || Math.hypot(q.x - b.x, q.y - b.y) < size * 4; }
}

/**
 * Мягкий изгиб открытой воды (замечание владельца 05.10: прямых быть не должно): точки смещаются поперёк хорды
 * по синусу — сильнее в середине, к концам до нуля; берётся самое большое смещение (до 2.5 размера гекса) в ту
 * сторону, куда линия уже отклонена, при котором она остаётся на воде с запасом.
 */
function bulge(pts: Pt[], size: number, ok: (q: Pt) => boolean): Pt[] {
  if (pts.length < 4) return pts;
  const a = pts[0]!, b = pts[pts.length - 1]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  const total = cum[cum.length - 1]! || 1;
  const side = pts.reduce((t, p) => t + (p.x - a.x) * nx + (p.y - a.y) * ny, 0) >= 0 ? 1 : -1;
  for (const sign of [side, -side]) {
    for (const amp of [2.5, 1.8, 1.2, 0.7]) {
      const out = pts.map((p, i) => { const w = Math.sin((Math.PI * cum[i]!) / total) * amp * size * sign; return { x: p.x + nx * w, y: p.y + ny * w }; });
      if (out.slice(1, -1).every(ok)) return out;
    }
  }
  return pts;
}

/** Перевыборка ломаной по длине дуги с шагом `step`, концы на месте. */
function resample(pts: ReadonlyArray<Pt>, step: number): Pt[] {
  const out: Pt[] = [pts[0]!];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i]!, q = pts[i + 1]!, len = Math.hypot(q.x - p.x, q.y - p.y);
    let t = step - carry;
    while (t <= len) { out.push({ x: p.x + ((q.x - p.x) * t) / len, y: p.y + ((q.y - p.y) * t) / len }); t += step; }
    carry = len - (t - step);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * «Резинка»: точки ломаной (кроме концов) раз за разом подтягиваются к середине между соседями, если новое место
 * допустимо (`ok`); каждые 25 проходов — перевыборка, чтобы точки не сбивались в кучу. Итог — гладкая линия,
 * прямая на открытой воде и огибающая сушу по дуге радиусом не меньше запаса.
 */
export function elasticBand(pts: ReadonlyArray<Pt>, size: number, ok: (q: Pt) => boolean, iterations = 200): Pt[] {
  let p = resample(pts, size * 0.5);
  for (let it = 0; it < iterations; it++) {
    for (let i = 1; i < p.length - 1; i++) {
      const a = p[i - 1]!, b = p[i + 1]!, c = p[i]!;
      const cand = { x: c.x + ((a.x + b.x) / 2 - c.x) * 0.5, y: c.y + ((a.y + b.y) / 2 - c.y) * 0.5 };
      if (ok(cand)) p[i] = cand;
    }
    if (it % 25 === 24) p = resample(p, size * 0.5);
  }
  return p;
}

const unit = (p: Pt, from: Pt): Pt => { const dx = p.x - from.x, dy = p.y - from.y, d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; };
const bezier = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt => {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
};

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

/** Точка в воде с запасом от берега: её гекс не суша, до центра любого соседнего гекса суши не ближе 2 размеров (≈ гекс от кромки). */
function clearAt(p: Pt, land: ReadonlySet<string>, size: number, obstacles: ReadonlyArray<SeaObstacle>, margin = 2.0): boolean {
  const h = pixelToHex(p, size);
  if (land.has(hexKey(h))) return false;
  for (const n of hexNeighbors(h)) {
    if (!land.has(hexKey(n))) continue;
    const c = hexToPixel(n, size);
    if (Math.hypot(c.x - p.x, c.y - p.y) < size * margin) return false;
  }
  return !obstacles.some((o) => {
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    const edge = o.shape?.length ? isletRadiusAt({ r: o.r, shape: o.shape }, Math.atan2(p.y - o.y, p.x - o.x)) : o.r;
    return d < edge + size * (margin - 1.0);
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

/** Точка не на суше (без запаса): её гекс — вода и она не внутри островка. */
function offLand(p: Pt, land: ReadonlySet<string>, size: number, obstacles: ReadonlyArray<SeaObstacle>): boolean {
  if (land.has(hexKey(pixelToHex(p, size)))) return false;
  return !obstacles.some((o) => {
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    const edge = o.shape?.length ? isletRadiusAt({ r: o.r, shape: o.shape }, Math.atan2(p.y - o.y, p.x - o.x)) : o.r;
    return d < edge + size * 0.3;
  });
}

/**
 * Красивая кривая маршрута: широкие дуги (отрезки до 4 размеров гекса, 4 прохода Чайкина); если скругление задело
 * сушу или островок, радиус уменьшается (2 размера, затем 1) — линия всегда остаётся на воде.
 */
export function routeCurve(pts: ReadonlyArray<Pt>, land: ReadonlySet<string>, size: number, obstacles: ReadonlyArray<SeaObstacle> = []): Pt[] {
  // Кривая Безье уже гладкая (точки через полразмера гекса): её только слегка скругляем у концов.
  if (pts.length > 8) return smoothRoute(pts, 1, size);
  for (const step of [4, 2, 1]) {
    const c = smoothRoute(pts, 4, size * step);
    if (c.slice(1, -1).every((p) => offLand(p, land, size, obstacles))) return c;
  }
  return [...pts];
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
