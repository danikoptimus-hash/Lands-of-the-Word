import { createRng } from "./random.js";
import { hexDistance, hexKey, hexNeighbors, hexToPixel, type Hex } from "./hex.js";
import { seaField, type Bounds } from "./islets.js";
import { pixelToHex, type Pt, type SeaObstacle } from "./seaRoute.js";

/**
 * Разбитый бурей корабль (решение владельца 04.11): срочное задание, за которое капитан и команда благодарят грузом —
 * тёсаными камнями или блоками для стен. Корабль один на все команды, стоит на водном гексе недалеко от берега.
 *
 * Владелец просил «где-то в радиусе 50 гексов», но карты сейчас 20–30 гексов в поперечнике, а вид нельзя увести дальше
 * пояса моря вокруг поля — корабль в 50 гексах никто бы не увидел. Поэтому место выбирается на расстоянии
 * WRECK_MIN…WRECK_MAX гексов от ближайшего гекса суши, внутри пояса моря, не на островке и не у стоянок кораблей команд
 * (корабли морских дел стоят в 1,6 гекса от порта). Выбор детерминирован семенем: у всех одно и то же место.
 */
export const WRECK_MIN = 2, WRECK_MAX = 6;

/** Границы поля по гексам (как `fieldBounds` в вебе): запас 1,2 радиуса гекса вокруг центров. */
export function fieldBoundsOf(hexes: ReadonlyArray<Hex>, size: number): Bounds {
  const cs = hexes.map((h) => hexToPixel(h, size));
  const minX = Math.min(...cs.map((c) => c.x)) - size * 1.2, maxX = Math.max(...cs.map((c) => c.x)) + size * 1.2;
  const minY = Math.min(...cs.map((c) => c.y)) - size * 1.2, maxY = Math.max(...cs.map((c) => c.y)) + size * 1.2;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/** Водный гекс накрыт островком: как `blocked` в `seaRoute` — ближе контура островка плюс радиус гекса. */
export function underIslet(h: Hex, size: number, islets: ReadonlyArray<SeaObstacle>): boolean {
  if (!islets.length) return false;
  const c = hexToPixel(h, size);
  return islets.some((o) => {
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    const edge = o.shape?.length ? isletEdge(o, Math.atan2(c.y - o.y, c.x - o.x)) : o.r;
    return d < edge + size * 1.0;
  });
}
function isletEdge(o: SeaObstacle, angle: number): number {
  const shape = o.shape!, n = shape.length, TAU = Math.PI * 2;
  const f = ((((angle % TAU) + TAU) % TAU) / TAU) * n;
  const i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f);
  return o.r * (shape[i]! * (1 - t) + shape[j]! * t);
}

/**
 * Все водные гексы на расстоянии WRECK_MIN…WRECK_MAX от суши, в поясе моря, не под островком и не ближе двух гексов
 * к стоянкам кораблей (`ships` — точки стоянок в единицах карты). Порядок — по ключу гекса, чтобы выбор не зависел от
 * порядка гексов во входе.
 */
export function wreckCandidates(land: ReadonlyArray<Hex>, size: number, islets: ReadonlyArray<SeaObstacle> = [], ships: ReadonlyArray<Pt> = []): Hex[] {
  if (!land.length) return [];
  const landSet = new Set(land.map(hexKey));
  const sea = seaField(fieldBoundsOf(land, size));
  // Волна от суши: расстояние до ближайшего гекса суши по сетке, до WRECK_MAX.
  const dist = new Map<string, number>();
  let ring: Hex[] = [...land];
  for (const h of land) dist.set(hexKey(h), 0);
  for (let d = 1; d <= WRECK_MAX; d++) {
    const next: Hex[] = [];
    for (const h of ring) for (const n of hexNeighbors(h)) { const k = hexKey(n); if (!dist.has(k)) { dist.set(k, d); next.push(n); } }
    ring = next;
  }
  const shipHexes = ships.map((p) => pixelToHex(p, size));
  const out: Hex[] = [];
  for (const [k, d] of dist) {
    if (d < WRECK_MIN || landSet.has(k)) continue;
    const [q, r] = k.split(",").map(Number) as [number, number];
    const h = { q, r }, c = hexToPixel(h, size);
    if (c.x < sea.minX + size || c.x > sea.minX + sea.width - size || c.y < sea.minY + size || c.y > sea.minY + sea.height - size) continue;
    if (underIslet(h, size, islets)) continue;
    if (shipHexes.some((s) => hexDistance(s, h) < 2)) continue;
    out.push(h);
  }
  return out.sort((a, b) => a.q - b.q || a.r - b.r);
}

/** Место корабля по семени: случайный из подходящих гексов; null — подходящих нет (поле без воды вокруг не бывает). */
export function pickWreckHex(land: ReadonlyArray<Hex>, size: number, seed: number, islets: ReadonlyArray<SeaObstacle> = [], ships: ReadonlyArray<Pt> = []): Hex | null {
  const cands = wreckCandidates(land, size, islets, ships);
  if (!cands.length) return null;
  const rng = createRng(seed >>> 0);
  return cands[Math.floor(rng() * cands.length)] ?? null;
}

/**
 * Сигнальные ракеты: раз в ROCKET_PERIOD ± ROCKET_JITTER секунд, детерминированно от семени корабля и времени мира —
 * у всех игроков ракета взлетает в одну и ту же секунду. Время делится на окна по ROCKET_WINDOW секунд; внутри окна
 * пуски идут от его начала с интервалами, разыгранными генератором «семя ^ номер окна». Возвращает моменты пусков
 * (секунды, те же часы, что на входе) в полуинтервале [from, to). Пауза между пусками не меньше 5 с; внутри окна — не больше 9 с.
 */
export const ROCKET_PERIOD = 7, ROCKET_JITTER = 2, ROCKET_WINDOW = 600;
export function rocketLaunches(seed: number, from: number, to: number): number[] {
  const out: number[] = [];
  if (!(to > from)) return out;
  const w0 = Math.floor(from / ROCKET_WINDOW), w1 = Math.floor((to - 1e-9) / ROCKET_WINDOW);
  for (let w = w0; w <= w1; w++) {
    const rng = createRng(((seed >>> 0) ^ Math.imul(w + 1, 0x9e3779b1)) >>> 0);
    // Первый пуск окна — через 5–9 с от его начала; на стыке окон пауза чуть длиннее обычной (до ~18 с), ритм не сбивается.
    let t = w * ROCKET_WINDOW + ROCKET_PERIOD - ROCKET_JITTER + rng() * 2 * ROCKET_JITTER;
    while (t < (w + 1) * ROCKET_WINDOW) {
      if (t >= from && t < to) out.push(t);
      t += ROCKET_PERIOD + (rng() * 2 - 1) * ROCKET_JITTER;
    }
  }
  return out;
}
