import { useEffect, useMemo, useRef } from "react";
import { HEX_SIZE, hexCenter } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";
import type { Viewport } from "./MapLayers";
import type { Islet } from "@lotw/domain";

/**
 * Живность на карте: горбатый кит, косатка и стайка дельфинов плывут вокруг острова по воде (по профилю берега),
 * чайки кружат у побережья, стая птиц перелетает остров. Всё рисуется кодом на canvas в единицах карты
 * (масштабируется вместе с ней), ~24 кадра в секунду и только в видимой области; при «уменьшить движение» слоя нет.
 *
 * Морские звери — ПОД водой: с глубиной в их цвет подмешивается толща воды, падают контраст и непрозрачность,
 * край размывается (стопка полупрозрачных обводок вместо дорогого blur), по спине бегут блики каустики.
 * Кит и косатка циклично всплывают: у поверхности — фонтан, круги на воде и кильватерный клин, потом ныряют.
 * Дельфины выпрыгивают по очереди. Движение без рывков: курс меняется с ограниченной скоростью, скорость
 * «дышит» шумом, тело изгибается в повороте, хвост бьёт с запаздыванием по фазе.
 */

// ───────────────────────────── Профиль острова ─────────────────────────────
const BINS = 72;
/** Островки в море как круги (центр, радиус с запасом): звери их обходят. */
interface Isle { x: number; y: number; r: number }
/** Профиль одного острова: центр и радиус берега по секторам угла. */
interface Part { cx: number; cy: number; r: number[]; maxR: number }
/** Мир живности: общий центр и охват (для маршрутов из-за края) плюс профили островов (их несколько: Ветхий и Новый Завет). */
interface Profile extends Part { parts: Part[]; isles: Isle[] }

function partProfile(cs: Array<{ x: number; y: number }>, size: number): Part {
  const cx = cs.reduce((a, c) => a + c.x, 0) / cs.length, cy = cs.reduce((a, c) => a + c.y, 0) / cs.length;
  const r = new Array<number>(BINS).fill(0);
  for (const c of cs) {
    const d = Math.hypot(c.x - cx, c.y - cy) + size * 1.1;
    const a = Math.atan2(c.y - cy, c.x - cx);
    const b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
    for (const k of [-2, -1, 0, 1, 2]) { const i = (b + k + BINS) % BINS; if (d > r[i]!) r[i] = d; }
  }
  const maxR = Math.max(...r);
  for (let i = 0; i < BINS; i++) if (r[i] === 0) r[i] = maxR;
  return { cx, cy, r, maxR };
}
/** Профиль мира: острова по признаку island (старые карты — один остров), общий профиль по всем гексам. */
function islandProfile(hexes: MapHexDto[], size: number, islets: Islet[]): Profile | null {
  if (!hexes.length) return null;
  const groups = new Map<string, Array<{ x: number; y: number }>>();
  for (const h of hexes) { const key = h.island ?? "OT"; (groups.get(key) ?? groups.set(key, []).get(key)!).push(hexCenter(h, size)); }
  const parts = [...groups.values()].map((cs) => partProfile(cs, size));
  const all = partProfile(hexes.map((h) => hexCenter(h, size)), size);
  const isles = islets.map((i) => ({ x: i.x, y: i.y, r: i.cover }));
  return { ...all, parts, isles };
}
/** Радиус профиля под любым углом (угол не обязан быть в −π…π). */
function radiusAt(p: Part, angle: number): number {
  const f = ((angle + Math.PI) / (2 * Math.PI)) * BINS;
  const i = ((Math.floor(f) % BINS) + BINS) % BINS, j = (i + 1) % BINS, t = f - Math.floor(f);
  return p.r[i]! * (1 - t) + p.r[j]! * t;
}

// ───────────────────────────── Математика ─────────────────────────────
const TAU = Math.PI * 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const wrapAngle = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
/** Кадронезависимое плавное приближение к цели с постоянной времени tau (сек). */
const ease = (cur: number, target: number, dt: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
/** Гладкий шум −1…1 из несоизмеримых синусов: непрерывный, без таблиц и аллокаций. */
const noise1 = (t: number, seed: number) => 0.5 * Math.sin(t + seed) + 0.3 * Math.sin(t * 2.17 + seed * 1.7) + 0.2 * Math.sin(t * 0.53 + seed * 0.31);

type RGB = readonly [number, number, number];
/** Цвет толщи воды: чем глубже зверь, тем сильнее он в него уходит. */
const DEEP: RGB = [46, 98, 126];
const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
/** Цвет под водой: на глубине m (0 — поверхность, 1 — глубоко) к цвету подмешивается вода. */
function underwater(c: RGB, m: number): string {
  const w = m * 0.74;
  return `rgb(${(c[0] + (DEEP[0] - c[0]) * w) | 0},${(c[1] + (DEEP[1] - c[1]) * w) | 0},${(c[2] + (DEEP[2] - c[2]) * w) | 0})`;
}
/** Куда падают тени: свет сверху-слева. Ветер сносит фонтан (ед/с). */
const SUN_X = 0.55, SUN_Y = 0.83, WIND_X = 2.6, WIND_Y = -1.5;
/** Видимая область карты (в единицах карты), обновляется каждый кадр без аллокаций. */
interface Vis { x0: number; y0: number; x1: number; y1: number }
const inView = (v: Vis, x: number, y: number) => x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1;

// ───────────────────────────── Эффекты на воде ─────────────────────────────
/** Кольцевые буферы фиксированного размера: круги [x,y,t0,r0,r1,life], брызги [x,y,vx,vy,t0,r], фонтаны [x,y,t0,size,vx,vy]. */
const RINGS = 20, DROPS = 60, PUFFS = 6, DROP_LIFE = 0.75, PUFF_LIFE = 3.2;
interface Fx { ring: Float32Array; ri: number; drop: Float32Array; di: number; puff: Float32Array; pi: number }
const makeFx = (): Fx => ({ ring: new Float32Array(RINGS * 6), ri: 0, drop: new Float32Array(DROPS * 6), di: 0, puff: new Float32Array(PUFFS * 6), pi: 0 });
function emitRing(fx: Fx, x: number, y: number, T: number, r0: number, r1: number, life: number): void {
  const i = fx.ri * 6; fx.ring[i] = x; fx.ring[i + 1] = y; fx.ring[i + 2] = T; fx.ring[i + 3] = r0; fx.ring[i + 4] = r1; fx.ring[i + 5] = life;
  fx.ri = (fx.ri + 1) % RINGS;
}
function emitDrops(fx: Fx, x: number, y: number, T: number, n: number, speed: number, r: number): void {
  for (let k = 0; k < n; k++) {
    const a = rnd(0, TAU), s = speed * rnd(0.35, 1), i = fx.di * 6;
    fx.drop[i] = x; fx.drop[i + 1] = y; fx.drop[i + 2] = Math.cos(a) * s; fx.drop[i + 3] = Math.sin(a) * s; fx.drop[i + 4] = T; fx.drop[i + 5] = r * rnd(0.6, 1.2);
    fx.di = (fx.di + 1) % DROPS;
  }
}
function emitPuff(fx: Fx, x: number, y: number, T: number, size: number, vx: number, vy: number): void {
  const i = fx.pi * 6; fx.puff[i] = x; fx.puff[i + 1] = y; fx.puff[i + 2] = T; fx.puff[i + 3] = size; fx.puff[i + 4] = vx; fx.puff[i + 5] = vy;
  fx.pi = (fx.pi + 1) % PUFFS;
}
function drawFx(ctx: CanvasRenderingContext2D, fx: Fx, T: number, px: number, vis: Vis): void {
  ctx.lineCap = "round";
  // Круги на воде: два концентрических кольца, расширяются с замедлением и тают.
  ctx.strokeStyle = "rgb(236,249,252)";
  for (let k = 0; k < RINGS; k++) {
    const i = k * 6, life = fx.ring[i + 5]!; if (life <= 0) continue;
    const u = (T - fx.ring[i + 2]!) / life; if (u < 0 || u >= 1) continue;
    const x = fx.ring[i]!, y = fx.ring[i + 1]!; if (!inView(vis, x, y)) continue;
    const r = lerp(fx.ring[i + 3]!, fx.ring[i + 4]!, 1 - (1 - u) * (1 - u));
    ctx.lineWidth = Math.max(px * 1.1, r * 0.05 * (1 - u));
    ctx.globalAlpha = 0.55 * (1 - u) * (1 - u);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.globalAlpha *= 0.45; ctx.beginPath(); ctx.arc(x, y, r * 0.68, 0, TAU); ctx.stroke();
  }
  // Фонтан: облачко из трёх кругов растёт, сносится ветром и тает.
  ctx.fillStyle = "rgb(255,255,255)";
  for (let k = 0; k < PUFFS; k++) {
    const i = k * 6, age = T - fx.puff[i + 2]!, u = age / PUFF_LIFE; if (age < 0 || u >= 1 || fx.puff[i + 3]! <= 0) continue;
    const x = fx.puff[i]! + fx.puff[i + 4]! * age, y = fx.puff[i + 1]! + fx.puff[i + 5]! * age; if (!inView(vis, x, y)) continue;
    const s = fx.puff[i + 3]! * (0.22 + 0.95 * Math.sqrt(u));
    ctx.globalAlpha = 0.6 * Math.pow(1 - u, 1.6);
    ctx.beginPath();
    ctx.moveTo(x + s, y); ctx.arc(x, y, s, 0, TAU);
    ctx.moveTo(x - s * 0.55 + s * 0.65, y + s * 0.25); ctx.arc(x - s * 0.55, y + s * 0.25, s * 0.65, 0, TAU);
    ctx.moveTo(x + s * 0.6 + s * 0.7, y - s * 0.3); ctx.arc(x + s * 0.6, y - s * 0.3, s * 0.7, 0, TAU);
    ctx.fill();
  }
  // Брызги: капли разлетаются, тормозят и тают.
  for (let k = 0; k < DROPS; k++) {
    const i = k * 6, age = T - fx.drop[i + 4]!, u = age / DROP_LIFE; if (age < 0 || u >= 1 || fx.drop[i + 5]! <= 0) continue;
    const d = (1 - Math.exp(-4 * age)) / 4;
    const x = fx.drop[i]! + fx.drop[i + 2]! * d, y = fx.drop[i + 1]! + fx.drop[i + 3]! * d; if (!inView(vis, x, y)) continue;
    ctx.globalAlpha = 0.9 * (1 - u);
    ctx.beginPath(); ctx.arc(x, y, Math.max(px * 0.8, fx.drop[i + 5]! * (1 - u * 0.6)), 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ───────────────────────────── Китообразные ─────────────────────────────
type CetKind = "whale" | "orca" | "dolphin";
/** Образцов позвоночника на тело; профиль ширины считается один раз на вид. */
const N = 26;
interface CetSpec {
  kind: CetKind; L: number;
  /** Доля длины L до основания лопастей; профиль полуширины — пары (s, w) в долях L; округлость носа (0 — остриё). */
  body: number; prof: readonly number[]; noseRound: number;
  /** Грудные плавники: место посадки (доля L), длина, хорда, угол назад (рад), округлость задней кромки, бугорки по передней кромке. */
  finS: number; finLen: number; finChord: number; finSweep: number; finRound: number; finKnobs: boolean;
  flukeSpan: number; flukeLen: number; flukeSerrated: boolean;
  dorsalS: number; dorsalLen: number; dorsalW: number; blowS: number; blowTwin: boolean;
  swayFreq: number; swayK: number; speed: number; maxTurn: number;
  /** body — спина, dark — тень/кромка, hi — блик спины, fin — плавники, pale — светлая исподняя сторона, patch — узор (пятна, седло, накидка). */
  col: { body: RGB; dark: RGB; hi: RGB; fin: RGB; pale: RGB; patch: RGB };
  /** Полуширина в каждом образце позвоночника (единицы карты). */
  sw: Float32Array;
}
/** Полуширина по профилю: Catmull-Rom между опорными точками, чтобы силуэт был гладким, но держал заданные пропорции. */
function profileWidth(prof: readonly number[], s: number): number {
  const n = prof.length / 2;
  let k = 0; while (k < n - 2 && prof[(k + 1) * 2]! < s) k++;
  const s0 = prof[k * 2]!, s1 = prof[(k + 1) * 2]!, t = clamp((s - s0) / (s1 - s0), 0, 1);
  const p1 = prof[k * 2 + 1]!, p2 = prof[(k + 1) * 2 + 1]!;
  const p0 = k > 0 ? prof[(k - 1) * 2 + 1]! : p1 - (p2 - p1), p3 = k < n - 2 ? prof[(k + 2) * 2 + 1]! : p2 + (p2 - p1);
  return Math.max(0, 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t));
}
function buildSpec(base: Omit<CetSpec, "sw">): CetSpec {
  const sw = new Float32Array(N);
  for (let i = 0; i < N; i++) sw[i] = base.L * profileWidth(base.prof, (base.body * i) / (N - 1));
  return { ...base, sw };
}
/** Пропорции — по анатомии вида сверху (доли полной длины L). */
function cetSpec(kind: CetKind, L: number, size: number): CetSpec {
  if (kind === "whale") return buildSpec({ // горбач: широкая плоская голова, ширина 0,22 L на 37 %, длинные бугристые грудные, горб с низким плавником на 65 %, узкий стебель, лопасти 0,34 L
    kind, L, body: 0.84, noseRound: 0.9,
    prof: [0, 0, 0.03, 0.05, 0.08, 0.08, 0.15, 0.095, 0.25, 0.105, 0.37, 0.11, 0.5, 0.1, 0.62, 0.082, 0.7, 0.062, 0.78, 0.04, 0.84, 0.024],
    finS: 0.35, finLen: 0.32, finChord: 0.065, finSweep: 0.7, finRound: 0.25, finKnobs: true,
    flukeSpan: 0.34, flukeLen: 0.15, flukeSerrated: true,
    dorsalS: 0.65, dorsalLen: 0.06, dorsalW: 0.014, blowS: 0.28, blowTwin: true,
    swayFreq: 1.4, swayK: 2.0, speed: size * 0.27, maxTurn: 0.35,
    col: { body: [40, 42, 46], dark: [14, 15, 18], hi: [108, 112, 118], fin: [52, 56, 62], pale: [206, 210, 212], patch: [134, 138, 142] },
  });
  if (kind === "orca") return buildSpec({ // косатка: округлая голова без клюва, ширина 0,2 L на 40 %, плавники-вёсла на 30 %, седло за спинным плавником
    kind, L, body: 0.86, noseRound: 0.9,
    prof: [0, 0, 0.025, 0.045, 0.07, 0.075, 0.15, 0.092, 0.28, 0.099, 0.4, 0.1, 0.55, 0.09, 0.68, 0.066, 0.78, 0.04, 0.86, 0.026],
    finS: 0.3, finLen: 0.19, finChord: 0.11, finSweep: 0.4, finRound: 1, finKnobs: false,
    flukeSpan: 0.3, flukeLen: 0.13, flukeSerrated: false,
    dorsalS: 0.48, dorsalLen: 0.12, dorsalW: 0.018, blowS: 0.17, blowTwin: false,
    swayFreq: 2.0, swayK: 2.2, speed: size * 0.5, maxTurn: 0.6,
    col: { body: [17, 20, 24], dark: [5, 6, 8], hi: [128, 140, 150], fin: [17, 20, 24], pale: [238, 241, 243], patch: [142, 152, 160] },
  });
  return buildSpec({ // афалина: стройная, ширина 0,17 L, короткий клюв со складкой и дыней за ним, серповидный плавник посередине
    kind, L, body: 0.86, noseRound: 0.2,
    prof: [0, 0, 0.02, 0.012, 0.06, 0.022, 0.09, 0.03, 0.12, 0.058, 0.2, 0.076, 0.32, 0.085, 0.45, 0.083, 0.58, 0.072, 0.7, 0.05, 0.8, 0.03, 0.86, 0.02],
    finS: 0.32, finLen: 0.13, finChord: 0.05, finSweep: 0.75, finRound: 0.3, finKnobs: false,
    flukeSpan: 0.22, flukeLen: 0.1, flukeSerrated: false,
    dorsalS: 0.5, dorsalLen: 0.08, dorsalW: 0.013, blowS: 0.22, blowTwin: false,
    swayFreq: 4, swayK: 2.4, speed: size * 0.75, maxTurn: 1.3,
    col: { body: [126, 136, 146], dark: [54, 60, 68], hi: [180, 188, 196], fin: [92, 102, 112], pale: [198, 204, 210], patch: [68, 76, 86] },
  });
}

/** «Поводок»: точка, бегущая вдоль берега на отступе off с медленным меандром; зверь плывёт за ней. */
/**
 * Поводок: маршрут «из-за края карты — вокруг острова — за противоположный край». Прямая между двумя точками
 * далеко за островом; там, где прямая зашла бы на сушу, точка выталкивается на профиль берега с отступом off.
 * Дойдя до конца, поводок ждёт паузу вне экрана и начинает новый маршрут с другой стороны.
 */
interface Carrot { off: number; wob: number; seed: number; x: number; y: number; h: number; x0: number; y0: number; x1: number; y1: number; len: number; t: number; wait: number }
/** Радиус, с которого зверь входит в кадр: заведомо дальше видимого моря при виде «вся карта». */
const farR = (p: Profile, size: number) => p.maxR * 2.5 + size * 8;
/** Расстояние от точки до отрезка. */
function segDist(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
  const t = clamp(((x - x0) * dx + (y - y0) * dy) / l2, 0, 1);
  return Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t));
}
/** Прямая маршрута не должна проходить сквозь островки (с запасом на отмель и меандр): иначе выбираем другую. */
const crossesIsle = (p: Profile, x0: number, y0: number, x1: number, y1: number, off: number) => p.isles.some((i) => segDist(i.x, i.y, x0, y0, x1, y1) < i.r + off);
function carrotRoute(car: Carrot, p: Profile, size: number): void {
  const R = farR(p, size);
  let a = 0, b = 0;
  for (let tries = 0; tries < 12; tries++) {
    a = rnd(-Math.PI, Math.PI); b = a + Math.PI + rnd(-0.9, 0.9);
    if (tries === 11 || !crossesIsle(p, p.cx + Math.cos(a) * R, p.cy + Math.sin(a) * R, p.cx + Math.cos(b) * R, p.cy + Math.sin(b) * R, car.off + car.wob + size)) break;
  }
  car.x0 = p.cx + Math.cos(a) * R; car.y0 = p.cy + Math.sin(a) * R;
  car.x1 = p.cx + Math.cos(b) * R; car.y1 = p.cy + Math.sin(b) * R;
  car.len = Math.hypot(car.x1 - car.x0, car.y1 - car.y0); car.t = 0; car.wait = 0;
  car.x = car.x0; car.y = car.y0; car.h = Math.atan2(car.y1 - car.y0, car.x1 - car.x0);
}
function carrotPoint(car: Carrot, p: Profile, t: number, T: number): [number, number] {
  let x = car.x0 + (car.x1 - car.x0) * t, y = car.y0 + (car.y1 - car.y0) * t;
  // Выталкиваем из каждого острова по очереди (дважды: после выхода из одного можно оказаться в другом).
  for (let pass = 0; pass < 2; pass++) for (const part of p.parts) {
    const ang = Math.atan2(y - part.cy, x - part.cx), d = Math.hypot(x - part.cx, y - part.cy);
    const minR = radiusAt(part, ang) + car.off + noise1(T * 0.12, car.seed) * car.wob;
    if (d < minR) { x = part.cx + Math.cos(ang) * minR; y = part.cy + Math.sin(ang) * minR; }
  }
  return [x, y];
}
function carrotStep(car: Carrot, p: Profile, size: number, dist: number, T: number): void {
  if (car.wait > 0) { car.wait -= dist / Math.max(1, size); if (car.wait <= 0) carrotRoute(car, p, size); return; }
  car.t = Math.min(1, car.t + dist / Math.max(1, car.len));
  const [x, y] = carrotPoint(car, p, car.t, T);
  if (dist > 0 && (x !== car.x || y !== car.y)) car.h = Math.atan2(y - car.y, x - car.x);
  car.x = x; car.y = y;
  if (car.t >= 1) car.wait = rnd(6, 24); // пауза «за краем» в единицах пройденного пути (≈ секунды при обычной скорости)
}
/** off — отступ от профиля берега, wob — размах меандра (оба в единицах карты). */
const makeCarrot = (p: Profile, size: number, off: number, wob: number): Carrot => {
  const car: Carrot = { off, wob, seed: rnd(0, 100), x: 0, y: 0, h: 0, x0: 0, y0: 0, x1: 0, y1: 0, len: 1, t: 0, wait: 0 };
  carrotRoute(car, p, size);
  // Первый зверь пусть уже будет на подходе: стартуем с разной глубины маршрута.
  car.t = rnd(0, 0.5); const [x, y] = carrotPoint(car, p, car.t, 0); car.x = x; car.y = y;
  return car;
};

/** Цикл всплытия: глубоко → подъём → у поверхности (фонтан, круги) → погружение; длительности случайны. */
interface Surf { t: number; deep: number; rise: number; hold: number; dive: number; depth: number; nextRing: number; spouts: number }
function resetSurf(s: Surf, kind: CetKind): void {
  const w = kind === "whale";
  s.t = 0; s.deep = w ? rnd(12, 28) : rnd(20, 40); s.rise = w ? 7 : 4.5; s.hold = w ? rnd(9, 14) : rnd(5, 8); s.dive = w ? 8 : 5;
  s.depth = w ? 0.88 : 0.82; s.nextRing = 0; s.spouts = 0;
}
function makeSurf(kind: CetKind): Surf {
  const s: Surf = { t: 0, deep: 0, rise: 0, hold: 0, dive: 0, depth: 0, nextRing: 0, spouts: 0 };
  resetSurf(s, kind); s.t = rnd(0, s.deep);
  return s;
}
function surfDepth(s: Surf): number {
  const t = s.t, tRise = s.deep, tHold = tRise + s.rise, tDive = tHold + s.hold;
  if (t < tRise) return s.depth;
  if (t < tHold) return lerp(s.depth, 0, smooth((t - tRise) / s.rise));
  if (t < tDive) return 0;
  return lerp(0, s.depth, smooth((t - tDive) / s.dive));
}

interface Cet {
  spec: CetSpec; x: number; y: number; h: number; v: number; turn: number; phase: number; depth: number; seed: number;
  car: Carrot | null; surf: Surf | null;
  /** Дельфины: место в стае относительно поводка, начало прыжка и его прошедшая доля. */
  fdx: number; fdy: number; jumpAt: number; ju: number;
}
function makeCet(spec: CetSpec, car: Carrot | null, x: number, y: number, h: number): Cet {
  return { spec, x, y, h, v: spec.speed, turn: 0, phase: rnd(0, TAU), depth: 0.3, seed: rnd(0, 100), car, surf: spec.kind === "dolphin" ? null : makeSurf(spec.kind), fdx: 0, fdy: 0, jumpAt: -1e9, ju: 0 };
}
/** Плывёт к цели: курс меняется не быстрее maxTurn, скорость «пружинит» по расстоянию до цели и дышит шумом. */
function steerCet(c: Cet, tx: number, ty: number, dt: number, T: number, boost: number): number {
  const sp = c.spec, dx = tx - c.x, dy = ty - c.y, dist = Math.hypot(dx, dy);
  const d = clamp(wrapAngle(Math.atan2(dy, dx) - c.h), -sp.maxTurn * dt, sp.maxTurn * dt);
  c.h = wrapAngle(c.h + d);
  c.turn = ease(c.turn, d / Math.max(dt, 1e-3), dt, 0.5);
  const want = sp.speed * clamp(dist / (sp.L * 1.6), 0.5, 1.8) * (1 + 0.12 * noise1(T * 0.4, c.seed)) * boost;
  c.v = ease(c.v, want, dt, 1.2);
  c.x += Math.cos(c.h) * c.v * dt; c.y += Math.sin(c.h) * c.v * dt;
  c.phase += dt * sp.swayFreq * (0.55 + 0.45 * (c.v / sp.speed));
  return dist;
}
/** Мировые координаты точки на оси тела (u — вдоль тела от центра, голова по +x). */
const axisX = (c: Cet, u: number) => c.x + Math.cos(c.h) * u, axisY = (c: Cet, u: number) => c.y + Math.sin(c.h) * u;
/**
 * Жёсткая граница воды: если зверь оказался ближе к острову, чем профиль берега плюс запас (отмель и песок),
 * его выталкивает наружу, а курс теряет составляющую «в берег» — так он никогда не срежет угол через сушу,
 * даже когда поводок резко огибает мыс.
 */
function keepInWater(c: Cet, p: Profile, clearance: number): void {
  for (const part of p.parts) {
    const dx = c.x - part.cx, dy = c.y - part.cy, d = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx), minR = radiusAt(part, ang) + clearance;
    if (d < minR) pushOut(c, part.cx, part.cy, ang, minR);
  }
  // Островки — то же правило, круг вместо профиля.
  for (const i of p.isles) {
    const ix = c.x - i.x, iy = c.y - i.y, id = Math.hypot(ix, iy), ir = i.r + clearance * 0.8;
    if (id < ir) pushOut(c, i.x, i.y, Math.atan2(iy, ix), ir);
  }
}
function pushOut(c: Cet, cx: number, cy: number, ang: number, minR: number): void {
  const nx = Math.cos(ang), ny = Math.sin(ang);
  c.x = cx + nx * minR; c.y = cy + ny * minR;
  const hx = Math.cos(c.h), hy = Math.sin(c.h), dot = hx * nx + hy * ny;
  if (dot < 0) c.h = Math.atan2(hy - dot * ny, hx - dot * nx);
}

/** Кит и косатка: поводок вдоль берега; цикл всплытия с фонтаном и кругами на воде. */
function stepSolo(c: Cet, p: Profile, size: number, fx: Fx, dt: number, T: number): void {
  const car = c.car!, s = c.surf!, sp = c.spec;
  // Поводок притормаживает, если зверь отстал (иначе он «срежет» и пойдёт по берегу).
  const behind = Math.hypot(car.x - c.x, car.y - c.y);
  const wasWaiting = car.wait > 0;
  carrotStep(car, p, size, sp.speed * dt * clamp(1.6 - behind / (sp.L * 2.5), 0.25, 1), T);
  if (wasWaiting && car.wait <= 0) { c.x = car.x; c.y = car.y; c.h = car.h; } // новый маршрут начинается за краем: перенос незаметен
  if (car.wait > 0) { c.x += Math.cos(c.h) * sp.speed * dt; c.y += Math.sin(c.h) * sp.speed * dt; c.phase += dt * sp.swayFreq; } // уплывает дальше за край
  else steerCet(c, car.x, car.y, dt, T, 1);
  keepInWater(c, p, size * (sp.kind === "whale" ? 2.2 : 1.9));
  const prev = s.t; s.t += dt;
  const tHold = s.deep + s.rise, tEnd = tHold + s.hold + s.dive;
  const blowU = sp.L * (0.5 - sp.blowS);
  if (prev < tHold && s.t >= tHold) { // вынырнул: выдох и первый круг
    // Облачко выдоха сразу сносится в сторону от дыхала, чтобы не закрывать спину зверя.
    emitPuff(fx, axisX(c, blowU) + WIND_X * 1.6, axisY(c, blowU) + WIND_Y * 1.6, T, sp.L * (sp.kind === "whale" ? 0.32 : 0.22), Math.cos(c.h) * c.v * 0.25 + WIND_X * 1.3, Math.sin(c.h) * c.v * 0.25 + WIND_Y * 1.3);
    emitRing(fx, c.x, c.y, T, sp.L * 0.35, sp.L * 1.3, 4); s.spouts = 1; s.nextRing = T + 1.5;
  }
  if (s.t >= tHold && s.t < tHold + s.hold) {
    if (T >= s.nextRing) { emitRing(fx, axisX(c, -sp.L * 0.1), axisY(c, -sp.L * 0.1), T, sp.L * 0.3, sp.L * 1.1, 3.5); s.nextRing = T + rnd(1.4, 2.2); }
    if (sp.kind === "whale" && s.spouts === 1 && s.t > tHold + s.hold * 0.55) { // второй выдох посреди стоянки у поверхности
      emitPuff(fx, axisX(c, blowU) + WIND_X * 1.6, axisY(c, blowU) + WIND_Y * 1.6, T, sp.L * 0.28, Math.cos(c.h) * c.v * 0.25 + WIND_X * 1.3, Math.sin(c.h) * c.v * 0.25 + WIND_Y * 1.3); s.spouts = 2;
    }
  }
  if (s.t >= tEnd) resetSurf(s, sp.kind);
  // У поверхности спина чуть «дышит»: лёгкие колебания глубины.
  c.depth = surfDepth(s) + 0.04 * (1 + Math.sin(T * 0.9 + c.seed));
}
/** Дельфины: держат строй за общим поводком (пружинные смещения), по очереди выпрыгивают. */
function stepPod(ds: Cet[], pod: Carrot, p: Profile, size: number, fx: Fx, dt: number, T: number): void {
  const lead = ds[0]!, sp = lead.spec;
  const behind = Math.hypot(pod.x - lead.x, pod.y - lead.y);
  const wasWaiting = pod.wait > 0;
  carrotStep(pod, p, size, sp.speed * dt * clamp(1.6 - behind / (sp.L * 3), 0.25, 1), T);
  if (wasWaiting && pod.wait <= 0) for (const d of ds) { d.x = pod.x + d.fdx; d.y = pod.y + d.fdy; d.h = pod.h; }
  const ch = Math.cos(pod.h), sh = Math.sin(pod.h);
  for (const d of ds) {
    if (pod.wait > 0) { d.x += Math.cos(d.h) * sp.speed * dt; d.y += Math.sin(d.h) * sp.speed * dt; d.phase += dt * sp.swayFreq; d.ju = 0; d.depth = 0.3; keepInWater(d, p, size * 1.7); continue; }
    const u = (T - d.jumpAt) / 1.35, jumping = u >= 0 && u < 1;
    const fx0 = d.fdx + sp.L * 1.3 + noise1(T * 0.3, d.seed) * sp.L * 0.25, fy0 = d.fdy + noise1(T * 0.25, d.seed + 7) * sp.L * 0.3;
    steerCet(d, pod.x + ch * fx0 - sh * fy0, pod.y + sh * fx0 + ch * fy0, dt, T, jumping ? 1 + 0.5 * Math.sin(Math.PI * u) : 1);
    keepInWater(d, p, size * 1.7);
    if (jumping) {
      d.depth = 0.28 - 0.95 * Math.sin(Math.PI * u);
      if (d.ju < 0.08 && u >= 0.08) { emitRing(fx, d.x, d.y, T, sp.L * 0.2, sp.L * 0.9, 1.3); emitDrops(fx, axisX(d, sp.L * 0.2), axisY(d, sp.L * 0.2), T, 7, sp.L * 1.6, sp.L * 0.028); }
      if (d.ju < 0.9 && u >= 0.9) { emitRing(fx, axisX(d, sp.L * 0.3), axisY(d, sp.L * 0.3), T, sp.L * 0.25, sp.L * 1.1, 1.5); emitDrops(fx, axisX(d, sp.L * 0.4), axisY(d, sp.L * 0.4), T, 9, sp.L * 2, sp.L * 0.03); }
      d.ju = u;
    } else { d.ju = 0; d.depth = 0.26 + 0.07 * Math.sin(T * 1.3 + d.seed); }
  }
}

// ── Отрисовка китообразных: сегментированный позвоночник в общих буферах (без аллокаций в кадре)
const SX = new Float32Array(N), SY = new Float32Array(N), SW = new Float32Array(N), SA = new Float32Array(N), NX = new Float32Array(N), NY = new Float32Array(N);
/** Индекс образца по доле длины s. */
const idx = (sp: CetSpec, s: number) => Math.round((s / sp.body) * (N - 1));
/**
 * Позвоночник: центр в начале координат, голова по +x, s — доля полной длины. Боковая волна мала (до 0,03 L у стебля,
 * почти ноль у головы) и бежит назад; в повороте тело слегка изгибается. Ширины — из профиля вида, поэтому пропорции
 * не плывут при изгибе.
 */
function computeSpine(c: Cet): void {
  const sp = c.spec, L = sp.L, bend = clamp(c.turn, -1.2, 1.2) * L * 0.06;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    SX[i] = L * (0.5 - sp.body * u);
    SY[i] = L * 0.03 * (0.1 + 0.9 * u * u) * Math.sin(c.phase - u * sp.swayK) + bend * u * u;
    SW[i] = sp.sw[i]!;
  }
  for (let i = 0; i < N; i++) {
    const j = i < N - 1 ? i + 1 : i, k = i < N - 1 ? i : i - 1;
    const a = Math.atan2(SY[k]! - SY[j]!, SX[k]! - SX[j]!);
    SA[i] = a; NX[i] = -Math.sin(a); NY[i] = Math.cos(a);
  }
}
/** Контур вдоль позвоночника от образца i0 до i1 с множителем ширины wf; round — округлость носа. Кривые через середины — гладко. */
function spinePath(ctx: CanvasRenderingContext2D, i0: number, i1: number, wf: number, round: number): void {
  ctx.beginPath();
  const nx = SX[i0]!, ny = SY[i0]!;
  // Опорная точка носа сдвинута вбок на round: кривая выходит из носа поперёк оси — голова тупая и круглая, а не остриё.
  const rw = SW[i0 + 1]! * wf * round * 1.1;
  ctx.moveTo(nx, ny);
  let px = SX[i0]! + NX[i0]! * SW[i0]! * wf, py = SY[i0]! + NY[i0]! * SW[i0]! * wf;
  if (round > 0) { const mx = (px + SX[i0 + 1]! + NX[i0 + 1]! * SW[i0 + 1]! * wf) / 2, my = (py + SY[i0 + 1]! + NY[i0 + 1]! * SW[i0 + 1]! * wf) / 2; ctx.quadraticCurveTo(nx + NX[i0]! * rw, ny + NY[i0]! * rw, mx, my); px = SX[i0 + 1]! + NX[i0 + 1]! * SW[i0 + 1]! * wf; py = SY[i0 + 1]! + NY[i0 + 1]! * SW[i0 + 1]! * wf; i0++; }
  for (let i = i0 + 1; i <= i1; i++) {
    const x = SX[i]! + NX[i]! * SW[i]! * wf, y = SY[i]! + NY[i]! * SW[i]! * wf;
    ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2); px = x; py = y;
  }
  ctx.lineTo(px, py);
  px = SX[i1]! - NX[i1]! * SW[i1]! * wf; py = SY[i1]! - NY[i1]! * SW[i1]! * wf;
  ctx.lineTo(px, py);
  for (let i = i1 - 1; i >= i0; i--) {
    const x = SX[i]! - NX[i]! * SW[i]! * wf, y = SY[i]! - NY[i]! * SW[i]! * wf;
    ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2); px = x; py = y;
  }
  if (round > 0) ctx.quadraticCurveTo(nx - NX[i0]! * rw, ny - NY[i0]! * rw, nx, ny); else ctx.quadraticCurveTo(px, py, nx, ny);
  ctx.closePath();
}
/** Локальный базис плавника/лопастей: точки задаются как (вдоль курса, наружу), без аллокаций. */
let bx = 0, by = 0, bfx = 1, bfy = 0, box = 0, boy = 1;
function setBasis(x: number, y: number, a: number, fore: number, sgn: number): void {
  bx = x; by = y; bfx = Math.cos(a) * fore; bfy = Math.sin(a) * fore; box = -Math.sin(a) * sgn; boy = Math.cos(a) * sgn;
}
const mx = (u: number, v: number) => bx + bfx * u + box * v, my = (u: number, v: number) => by + bfy * u + boy * v;
/** Квадратичная кривая (u0,v0)→(u1,v1) с опорной (cu,cv), разбитая на n дужек-бугорков высотой amp наружу (side задаёт сторону). */
function scallopQuad(ctx: CanvasRenderingContext2D, u0: number, v0: number, cu: number, cv: number, u1: number, v1: number, n: number, amp: number, side: number): void {
  let pu = u0, pv = v0;
  for (let k = 1; k <= n; k++) {
    const t = k / n, w0 = (1 - t) * (1 - t), w1 = 2 * (1 - t) * t, w2 = t * t;
    const qu = w0 * u0 + w1 * cu + w2 * u1, qv = w0 * v0 + w1 * cv + w2 * v1;
    const du = qu - pu, dv = qv - pv, len = Math.hypot(du, dv) || 1, nu = (dv / len) * side * amp, nv = (-du / len) * side * amp;
    ctx.quadraticCurveTo(mx((pu + qu) / 2 + nu, (pv + qv) / 2 + nv), my((pu + qu) / 2 + nu, (pv + qv) / 2 + nv), mx(qu, qv), my(qu, qv));
    pu = qu; pv = qv;
  }
}
/** Грудной плавник у точки (x,y) с курсом a на стороне sgn: узкое крыло или весло; у горбача передняя кромка в бугорках. */
function finPath(ctx: CanvasRenderingContext2D, sp: CetSpec, x: number, y: number, a: number, sgn: number, flex: number): void {
  const L = sp.L, len = L * sp.finLen, chord = L * sp.finChord, sweep = sp.finSweep + flex;
  setBasis(x, y, a, 1, sgn);
  const tu = -len * Math.sin(sweep), tv = len * Math.cos(sweep);
  const c1u = chord * 0.4 + tu * 0.35, c1v = tv * 0.5, c2u = tu - chord * 0.6 - len * 0.3 * sp.finRound, c2v = tv * 0.5;
  const r0u = chord * 0.5, r1u = -chord * 0.6, rv = -chord * 0.15;
  ctx.moveTo(mx(r0u, rv), my(r0u, rv));
  if (sp.finKnobs) scallopQuad(ctx, r0u, rv, c1u, c1v, tu, tv, 8, L * 0.007, -1);
  else ctx.quadraticCurveTo(mx(c1u, c1v), my(c1u, c1v), mx(tu, tv), my(tu, tv));
  ctx.quadraticCurveTo(mx(c2u, c2v), my(c2u, c2v), mx(r1u, rv), my(r1u, rv));
  ctx.closePath();
}
/** Хвостовые лопасти у стебля (x,y): горизонтальные, с выемкой и острыми отведёнными назад кончиками; fore — проекция при ударе вверх-вниз; shift — сдвиг назад (для светлой исподней кромки). */
function flukePath(ctx: CanvasRenderingContext2D, sp: CetSpec, x: number, y: number, a: number, wTail: number, fore: number, shift: number): void {
  const L = sp.L, len = L * sp.flukeLen, hs = L * sp.flukeSpan * 0.5;
  setBasis(x - Math.cos(a) * shift, y - Math.sin(a) * shift, a, fore, 1);
  const su = len * 0.12, sv = wTail * 0.95, c1u = -len * 0.12, c1v = hs * 0.6, tu = -len * 0.7, tv = hs, c2u = -len * 1.02, c2v = hs * 0.42, nu = -len * 0.8;
  ctx.beginPath();
  ctx.moveTo(mx(su, sv), my(su, sv));
  ctx.quadraticCurveTo(mx(c1u, c1v), my(c1u, c1v), mx(tu, tv), my(tu, tv));
  if (sp.flukeSerrated) { scallopQuad(ctx, tu, tv, c2u, c2v, nu, 0, 6, L * 0.005, -1); scallopQuad(ctx, nu, 0, c2u, -c2v, tu, -tv, 6, L * 0.005, -1); }
  else { ctx.quadraticCurveTo(mx(c2u, c2v), my(c2u, c2v), mx(nu, 0), my(nu, 0)); ctx.quadraticCurveTo(mx(c2u, -c2v), my(c2u, -c2v), mx(tu, -tv), my(tu, -tv)); }
  ctx.quadraticCurveTo(mx(c1u, -c1v), my(c1u, -c1v), mx(su, -sv), my(su, -sv));
  ctx.closePath();
}
/** Мягкий край: широкие полупрозрачные обводки текущего контура под заливкой — дешёвая замена blur (на глубине). */
function softFill(ctx: CanvasRenderingContext2D, color: string, blur: number, alpha: number): void {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineJoin = "round";
  if (blur > 0) {
    ctx.globalAlpha = alpha * 0.1; ctx.lineWidth = blur * 3.4; ctx.stroke();
    ctx.globalAlpha = alpha * 0.18; ctx.lineWidth = blur * 2; ctx.stroke();
    ctx.globalAlpha = alpha * 0.3; ctx.lineWidth = blur * 0.9; ctx.stroke();
  }
  ctx.globalAlpha = alpha; ctx.fill();
}
/** Эллипс, лежащий вдоль позвоночника у образца i со сдвигом v вбок (доли L для радиусов). */
function spineEllipse(ctx: CanvasRenderingContext2D, L: number, i: number, v: number, ru: number, rv: number, tilt: number): void {
  const x = SX[i]! + NX[i]! * v, y = SY[i]! + NY[i]! * v;
  ctx.moveTo(x + Math.cos(SA[i]! + tilt) * L * ru, y + Math.sin(SA[i]! + tilt) * L * ru);
  ctx.ellipse(x, y, L * ru, L * rv, SA[i]! + tilt, 0, TAU);
}
/** Кильватер у поверхности: светлое пятно потревоженной воды, клин расходящихся полос от носа, пенный след за хвостом. */
function drawWake(ctx: CanvasRenderingContext2D, L: number, surf: number, px: number): void {
  ctx.fillStyle = "rgb(214,240,246)"; ctx.globalAlpha = surf * 0.13;
  ctx.beginPath(); ctx.ellipse(-L * 0.05, 0, L * 0.62, L * 0.3, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = "rgb(236,249,252)"; ctx.lineCap = "round"; ctx.lineWidth = Math.max(px * 1.2, L * 0.02);
  const x0 = L * 0.34, seg = L * 0.55, tan = 0.2;
  for (let k = 0; k < 3; k++) { // три отрезка с убывающей яркостью вместо градиента
    ctx.globalAlpha = surf * (k === 0 ? 0.36 : k === 1 ? 0.2 : 0.08);
    const xa = x0 - seg * k, xb = x0 - seg * (k + 1);
    ctx.beginPath();
    ctx.moveTo(xa, (x0 - xa) * tan); ctx.lineTo(xb, (x0 - xb) * tan);
    ctx.moveTo(xa, -(x0 - xa) * tan); ctx.lineTo(xb, -(x0 - xb) * tan);
    ctx.stroke();
  }
  ctx.globalAlpha = surf * 0.1; ctx.lineWidth = L * 0.1;
  ctx.beginPath(); ctx.moveTo(-L * 0.5, 0); ctx.lineTo(-L * 1.3, 0); ctx.stroke();
}
/** Блики каустики: тонкие светлые полосы в мировых осях, ползут по спине; видны только на погружённом теле. */
function drawCaustics(ctx: CanvasRenderingContext2D, h: number, L: number, m: number, alpha: number, T: number): void {
  const a = alpha * 0.14 * (1 - m) * clamp(m * 6, 0, 1);
  if (a < 0.01) return;
  ctx.rotate(-h + 0.7);
  ctx.strokeStyle = "rgb(228,246,255)"; ctx.lineCap = "round"; ctx.globalAlpha = a; ctx.lineWidth = L * 0.022;
  const gap = L * 0.21, off = (T * L * 0.07) % gap;
  ctx.beginPath();
  for (let i = -4; i <= 4; i++) { // полосы разной кривизны и с разным сдвигом, чтобы не читались как решётка
    const x = i * gap + off + Math.sin(i * 2.3) * gap * 0.25, w = Math.sin(T * 1.1 + i * 1.7) * L * 0.08;
    ctx.moveTo(x - w, -L * 0.7); ctx.bezierCurveTo(x + w, -L * 0.25, x - w * 0.8, L * 0.25, x + w * 0.4, L * 0.7);
  }
  ctx.stroke();
}
/** Пятна горбача по бокам: (s, сторона, радиусы в долях L). Постоянны — как индивидуальный рисунок. */
const MOTTLE: readonly number[] = [0.3, 1, 0.05, 0.02, 0.36, -1, 0.06, 0.024, 0.42, -1, 0.03, 0.014, 0.5, 1, 0.045, 0.018, 0.56, -1, 0.05, 0.02, 0.63, 1, 0.035, 0.015, 0.2, 1, 0.03, 0.012];
/**
 * Узор и светотень внутри тела (под clip по контуру): мягкая тёмная кромка к краям (бока уходят в воду), широкий
 * слабый блик хребта (форма), узкий яркий блик — только у поверхности; затем рисунок вида; каустика — под водой.
 */
function drawPattern(ctx: CanvasRenderingContext2D, c: Cet, m: number, alpha: number, surf: number, lod: boolean, T: number): void {
  const sp = c.spec, L = sp.L, form = alpha * (1 - m * 0.5), last = N - 1;
  ctx.strokeStyle = rgb(sp.col.dark); ctx.lineJoin = "round";
  spinePath(ctx, 0, last, 1, sp.noseRound);
  ctx.globalAlpha = form * 0.12; ctx.lineWidth = L * 0.11; ctx.stroke();
  ctx.globalAlpha = form * 0.14; ctx.lineWidth = L * 0.06; ctx.stroke();
  ctx.globalAlpha = form * 0.16; ctx.lineWidth = L * 0.03; ctx.stroke();
  if (sp.kind === "dolphin") { // накидка на спине темнее боков, брюхо светлое — видно светлыми кромками
    ctx.fillStyle = underwater(sp.col.patch, m); ctx.globalAlpha = alpha * 0.75; spinePath(ctx, idx(sp, 0.1), idx(sp, 0.82), 0.62, 0.7); ctx.fill();
    ctx.strokeStyle = underwater(sp.col.pale, m); ctx.globalAlpha = alpha * 0.4; ctx.lineWidth = L * 0.03; spinePath(ctx, idx(sp, 0.12), last, 1, 0); ctx.stroke();
  }
  ctx.fillStyle = rgb(sp.col.hi);
  ctx.globalAlpha = alpha * (1 - m) * 0.16 + 0.02; spinePath(ctx, 1, last - 1, 0.45, 0.8); ctx.fill();
  if (surf > 0) { ctx.globalAlpha = surf * (sp.kind === "orca" ? 0.42 : 0.3); spinePath(ctx, idx(sp, 0.1), idx(sp, 0.62), 0.14, 0.8); ctx.fill(); }
  if (sp.kind === "whale") { // мраморные пятна по бокам и у основания грудных плавников
    ctx.fillStyle = underwater(sp.col.patch, m); ctx.globalAlpha = alpha * 0.35;
    ctx.beginPath();
    for (let k = 0; k < MOTTLE.length; k += 4) { const i = idx(sp, MOTTLE[k]!); spineEllipse(ctx, L, i, MOTTLE[k + 1]! * SW[i]! * 0.7, MOTTLE[k + 2]!, MOTTLE[k + 3]!, MOTTLE[k + 1]! * 0.15); }
    ctx.fill();
  } else if (sp.kind === "orca") {
    const ie = idx(sp, 0.19), is = idx(sp, 0.56), ic = idx(sp, 0.12);
    ctx.fillStyle = underwater(sp.col.pale, m); ctx.globalAlpha = alpha * 0.55;
    ctx.beginPath(); spineEllipse(ctx, L, ic, SW[ic]! * 1.05, 0.13, 0.035, 0); spineEllipse(ctx, L, ic, -SW[ic]! * 1.05, 0.13, 0.035, 0); ctx.fill(); // белое горло — светлые бока у головы
    ctx.globalAlpha = alpha;
    ctx.beginPath(); spineEllipse(ctx, L, ie, SW[ie]! * 0.6, 0.07, 0.024, 0.35); spineEllipse(ctx, L, ie, -SW[ie]! * 0.6, 0.07, 0.024, -0.35); ctx.fill(); // пятна за глазами
    ctx.fillStyle = underwater(sp.col.patch, m); ctx.globalAlpha = alpha * 0.9;
    ctx.beginPath(); spineEllipse(ctx, L, is, SW[is]! * 0.62, 0.09, 0.04, 0.1); spineEllipse(ctx, L, is, -SW[is]! * 0.62, 0.09, 0.04, -0.1); ctx.fill(); // серое седло
  }
  if (lod) drawCaustics(ctx, c.h, L, m, alpha, T);
}
/** Детали поверх тела: дыхало (у горбача — с гребнем-«брызговиком» и бугорками на голове), спинной плавник сверху, складка клюва. */
function drawDetails(ctx: CanvasRenderingContext2D, c: Cet, m: number, alpha: number, fine: boolean): void {
  const sp = c.spec, L = sp.L, a = alpha * (1 - m);
  if (a < 0.03) return;
  const dark = rgb(sp.col.dark), pale = rgb(sp.col.pale), hi = rgb(sp.col.hi);
  const ib = idx(sp, sp.blowS), r = L * (sp.blowTwin ? 0.011 : 0.012);
  ctx.fillStyle = dark; ctx.globalAlpha = a * 0.85;
  ctx.beginPath();
  if (sp.blowTwin) for (let sgn = -1; sgn <= 1; sgn += 2) { const x = SX[ib]! + sgn * NX[ib]! * L * 0.016, y = SY[ib]! + sgn * NY[ib]! * L * 0.016; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
  else { ctx.moveTo(SX[ib]! + r, SY[ib]!); ctx.arc(SX[ib]!, SY[ib]!, r, 0, TAU); }
  ctx.fill();
  ctx.lineCap = "round";
  if (sp.kind === "whale") { // брызговик: дуга-гребень перед дыхалом, светлая с солнечной стороны
    const ig = idx(sp, sp.blowS - 0.035), w = L * 0.045;
    ctx.strokeStyle = hi; ctx.globalAlpha = a * 0.5; ctx.lineWidth = L * 0.01;
    ctx.beginPath(); ctx.moveTo(SX[ig]! + NX[ig]! * w, SY[ig]! + NY[ig]! * w); ctx.quadraticCurveTo(SX[ig]! + L * 0.02, SY[ig]!, SX[ig]! - NX[ig]! * w, SY[ig]! - NY[ig]! * w); ctx.stroke();
    ctx.strokeStyle = dark; ctx.globalAlpha = a * 0.45;
    ctx.beginPath(); ctx.moveTo(SX[ig]! + NX[ig]! * w - L * 0.008, SY[ig]! + NY[ig]! * w); ctx.quadraticCurveTo(SX[ig]! + L * 0.012, SY[ig]!, SX[ig]! - NX[ig]! * w - L * 0.008, SY[ig]! - NY[ig]! * w); ctx.stroke();
    // Гребень на стебле хвоста
    const i0 = idx(sp, 0.7), i1 = idx(sp, 0.83);
    ctx.strokeStyle = hi; ctx.globalAlpha = a * 0.3; ctx.lineWidth = L * 0.008;
    ctx.beginPath(); ctx.moveTo(SX[i0]!, SY[i0]!); ctx.lineTo(SX[i1]!, SY[i1]!); ctx.stroke();
  }
  // Спинной плавник сверху: короткая тёмная вытянутая форма по хребту со светлым кончиком.
  const id = idx(sp, sp.dorsalS);
  ctx.fillStyle = dark; ctx.globalAlpha = a * 0.7;
  ctx.beginPath(); spineEllipse(ctx, L, id, 0, sp.dorsalLen * 0.5, sp.dorsalW * 0.5, 0); ctx.fill();
  ctx.fillStyle = hi; ctx.globalAlpha = a * 0.55;
  const it = idx(sp, sp.dorsalS + sp.dorsalLen * 0.3);
  ctx.beginPath(); spineEllipse(ctx, L, it, sp.dorsalW * 0.25 * L, sp.dorsalLen * 0.16, sp.dorsalW * 0.2, 0); ctx.fill();
  if (!fine) return;
  if (sp.kind === "whale") { // бугорки по средней линии головы и вдоль челюстей
    const rk = L * 0.006;
    ctx.fillStyle = dark; ctx.globalAlpha = a * 0.5;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) { const i = idx(sp, 0.03 + k * 0.045); ctx.moveTo(SX[i]! + rk, SY[i]!); ctx.arc(SX[i]! - rk * 0.4, SY[i]!, rk, 0, TAU); for (let sgn = -1; sgn <= 1; sgn += 2) { const v = sgn * SW[i]! * 0.82, x = SX[i]! + NX[i]! * v - rk * 0.4, y = SY[i]! + NY[i]! * v; ctx.moveTo(x + rk, y); ctx.arc(x, y, rk, 0, TAU); } }
    ctx.fill();
    ctx.fillStyle = pale; ctx.globalAlpha = a * 0.45;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) { const i = idx(sp, 0.03 + k * 0.045); ctx.moveTo(SX[i]! + rk * 0.7, SY[i]!); ctx.arc(SX[i]!, SY[i]!, rk * 0.7, 0, TAU); for (let sgn = -1; sgn <= 1; sgn += 2) { const v = sgn * SW[i]! * 0.82, x = SX[i]! + NX[i]! * v, y = SY[i]! + NY[i]! * v; ctx.moveTo(x + rk * 0.7, y); ctx.arc(x, y, rk * 0.7, 0, TAU); } }
    ctx.fill();
  } else if (sp.kind === "dolphin") { // складка у основания клюва
    const i = idx(sp, 0.1), w = SW[i]! * 0.9;
    ctx.strokeStyle = dark; ctx.globalAlpha = a * 0.45; ctx.lineWidth = L * 0.008;
    ctx.beginPath(); ctx.moveTo(SX[i]! + NX[i]! * w, SY[i]! + NY[i]! * w); ctx.quadraticCurveTo(SX[i]! - L * 0.012, SY[i]!, SX[i]! - NX[i]! * w, SY[i]! - NY[i]! * w); ctx.stroke();
  }
}
function drawCet(ctx: CanvasRenderingContext2D, c: Cet, T: number, px: number, lod: boolean): void {
  const sp = c.spec, L = sp.L;
  const m = clamp(c.depth, 0, 1), air = Math.max(0, -c.depth);
  const alpha = 1 - 0.62 * m, blur = L * 0.075 * m, surf = clamp(1 - m / 0.32, 0, 1), fine = lod && L / px >= 60;
  computeSpine(c);
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.h);
  if (air > 0) { // тень на воде под выпрыгнувшим дельфином, смещена по солнцу (в мировых осях)
    const ch = Math.cos(c.h), sh = Math.sin(c.h);
    const ox = (SUN_X * ch + SUN_Y * sh) * L * 0.6 * air, oy = (-SUN_X * sh + SUN_Y * ch) * L * 0.6 * air;
    ctx.fillStyle = "rgb(18,48,64)"; ctx.globalAlpha = 0.24 * air;
    ctx.beginPath(); ctx.ellipse(ox, oy, L * 0.42, L * 0.13, 0, 0, TAU); ctx.fill();
  }
  const sc = (1 - 0.15 * m) * (1 + 0.2 * air); ctx.scale(sc, sc);
  if (surf > 0 && air === 0) drawWake(ctx, L, surf, px);
  // Плавники и лопасти всегда чуть глубже спины (спина у поверхности выступает из воды, плавники — нет).
  const mf = Math.max(m, 0.25), it = N - 1, body = underwater(sp.col.body, m), finColor = underwater(sp.col.fin, mf), paleColor = underwater(sp.col.pale, mf);
  // Лопасти горизонтальны и бьют вверх-вниз: сверху это лишь лёгкое сокращение проекции. Светлая исподняя сторона видна задней кромкой.
  const fore = 0.84 + 0.16 * Math.cos(c.phase - sp.swayK - 0.6);
  if (m < 0.5) { flukePath(ctx, sp, SX[it]!, SY[it]!, SA[it]!, SW[it]!, fore * 1.03, L * 0.009); softFill(ctx, paleColor, blur, alpha * 0.7 * (1 - m * 2)); }
  flukePath(ctx, sp, SX[it]!, SY[it]!, SA[it]!, SW[it]!, fore, 0);
  softFill(ctx, underwater(sp.col.body, mf), blur, alpha * (0.85 + 0.15 * fore));
  // Грудные плавники: расставлены, медленно и независимо «дышат»; светлая исподняя сторона — тонкой кромкой.
  const fi = idx(sp, sp.finS), flexL = 0.08 * noise1(T * 0.45, c.seed), flexR = 0.08 * noise1(T * 0.45, c.seed + 11);
  ctx.beginPath();
  finPath(ctx, sp, SX[fi]! + NX[fi]! * SW[fi]! * 0.85, SY[fi]! + NY[fi]! * SW[fi]! * 0.85, SA[fi]!, 1, flexR);
  finPath(ctx, sp, SX[fi]! - NX[fi]! * SW[fi]! * 0.85, SY[fi]! - NY[fi]! * SW[fi]! * 0.85, SA[fi]!, -1, flexL);
  softFill(ctx, finColor, blur, alpha);
  ctx.strokeStyle = paleColor; ctx.globalAlpha = alpha * 0.55 * (1 - m); ctx.lineWidth = L * 0.009; ctx.lineJoin = "round"; ctx.stroke();
  spinePath(ctx, 0, it, 1, sp.noseRound);
  softFill(ctx, body, blur, alpha);
  if (lod || sp.kind === "orca") { ctx.save(); ctx.clip(); drawPattern(ctx, c, m, alpha, surf, lod, T); ctx.restore(); }
  if (lod) drawDetails(ctx, c, m, alpha, fine);
  ctx.restore();
}

// ───────────────────────────── Птицы ─────────────────────────────
interface BirdSpec { arm: number; chordRoot: number; chordElbow: number; sweepArm: number; sweepHand: number; dihedral: number; bodyL: number; bodyW: number; headR: number; tailL: number; tailW: number; flapHz: number }
/** Чайка: длинные узкие крылья с изломом (рука вперёд, кисть назад), короткий хвост. */
const GULL: BirdSpec = { arm: 0.42, chordRoot: 0.26, chordElbow: 0.2, sweepArm: 0.28, sweepHand: 0.62, dihedral: 0.12, bodyL: 0.6, bodyW: 0.15, headR: 0.07, tailL: 0.18, tailW: 0.17, flapHz: 1.1 };
/** Птицы стаи (гуси): широкие крылья, длинная шея, заметный хвост. */
const LANDBIRD: BirdSpec = { arm: 0.5, chordRoot: 0.4, chordElbow: 0.33, sweepArm: 0.12, sweepHand: 0.4, dihedral: 0.06, bodyL: 0.72, bodyW: 0.17, headR: 0.06, tailL: 0.24, tailW: 0.2, flapHz: 1.2 };
/** Кончики крыльев (для чёрных «перчаток» чайки) и локти после wingPath. */
const WT = new Float32Array(8);
/**
 * Крыло из двух звеньев (плечо→локоть, локоть→кончик) в осях птицы (+x вперёд, +y — правая сторона).
 * Проекция на воду: звено под углом к горизонту видно короче (cos); крен добавляет угол одному крылу и отнимает у другого —
 * так виден наклон в повороте. На махе вниз рука выносится вперёд, на махе вверх кисть складывается назад.
 */
function wingPath(ctx: CanvasRenderingContext2D, b: BirdSpec, S: number, sgn: number, flapA: number, flapH: number, roll: number): void {
  const armL = S * b.arm * Math.max(0.3, Math.cos(b.dihedral + flapA - sgn * roll)), handL = S * (1 - b.arm) * Math.max(0.25, Math.cos(flapH - sgn * roll));
  const sa = b.sweepArm - 0.25 * flapA, sh = b.sweepHand + 0.45 * flapH;
  const cr = S * b.chordRoot, ce = S * b.chordElbow;
  const x0 = S * 0.05, y0 = sgn * S * b.bodyW * 0.4;
  const ex = x0 + armL * Math.sin(sa), ey = y0 + sgn * armL * Math.cos(sa);
  const tx = ex - handL * Math.sin(sh), ty = ey + sgn * handL * Math.cos(sh);
  const p1x = x0 + cr * 0.5, p1y = y0, p2x = ex + ce * 0.42, p2y = ey;
  const c12x = (p1x + p2x) / 2 + cr * 0.1, c12y = (p1y + p2y) / 2;
  const c2tx = p2x + (tx - p2x) * 0.5 + ce * 0.12, c2ty = p2y + (ty - p2y) * 0.5;
  const p3x = ex - ce * 0.55, p3y = ey + sgn * handL * 0.12;
  const ct3x = tx + (p3x - tx) * 0.5 - ce * 0.3, ct3y = ty + (p3y - ty) * 0.45;
  const p4x = x0 - cr * 0.5, p4y = y0;
  const c34x = (p3x + p4x) / 2 - cr * 0.28, c34y = (p3y + p4y) / 2 + sgn * S * 0.03;
  // Обход всегда по часовой стрелке, чтобы заливка nonzero объединяла крылья с телом.
  ctx.moveTo(p1x, p1y);
  if (sgn > 0) { ctx.quadraticCurveTo(c12x, c12y, p2x, p2y); ctx.quadraticCurveTo(c2tx, c2ty, tx, ty); ctx.quadraticCurveTo(ct3x, ct3y, p3x, p3y); ctx.quadraticCurveTo(c34x, c34y, p4x, p4y); }
  else { ctx.lineTo(p4x, p4y); ctx.quadraticCurveTo(c34x, c34y, p3x, p3y); ctx.quadraticCurveTo(ct3x, ct3y, tx, ty); ctx.quadraticCurveTo(c2tx, c2ty, p2x, p2y); ctx.quadraticCurveTo(c12x, c12y, p1x, p1y); }
  ctx.closePath();
  const o = sgn > 0 ? 0 : 4; WT[o] = ex; WT[o + 1] = ey; WT[o + 2] = tx; WT[o + 3] = ty;
}
/** Чёрные кончики крыльев чайки: треугольник по последней трети кисти. */
function tipPath(ctx: CanvasRenderingContext2D, sgn: number, ce: number): void {
  const o = sgn > 0 ? 0 : 4, ex = WT[o]!, ey = WT[o + 1]!, tx = WT[o + 2]!, ty = WT[o + 3]!;
  const bx = ex + (tx - ex) * 0.66, by = ey + (ty - ey) * 0.66;
  ctx.moveTo(bx + ce * 0.28, by - sgn * ce * 0.02); ctx.lineTo(tx, ty); ctx.lineTo(bx - ce * 0.3, by + sgn * ce * 0.08); ctx.closePath();
}
/** Корпус: капля с головой спереди и веером хвоста сзади (обход по часовой стрелке). */
function bodyPath(ctx: CanvasRenderingContext2D, b: BirdSpec, S: number): void {
  const bl = S * b.bodyL, bw = S * b.bodyW, hx = bl * 0.5 + S * b.headR * 1.7;
  ctx.moveTo(hx, 0);
  ctx.bezierCurveTo(hx - S * b.headR * 0.3, S * b.headR, bl * 0.15, bw * 0.62, -bl * 0.45, bw * 0.3);
  ctx.lineTo(-bl * 0.5 - S * b.tailL, S * b.tailW * 0.5);
  ctx.lineTo(-bl * 0.5 - S * b.tailL * 0.9, 0);
  ctx.lineTo(-bl * 0.5 - S * b.tailL, -S * b.tailW * 0.5);
  ctx.lineTo(-bl * 0.45, -bw * 0.3);
  ctx.bezierCurveTo(bl * 0.15, -bw * 0.62, hx - S * b.headR * 0.3, -S * b.headR, hx, 0);
  ctx.closePath();
}
/** Птица в текущей системе координат (+x — курс). amp — размах взмаха (0 — парит), roll — крен. */
function drawBird(ctx: CanvasRenderingContext2D, b: BirdSpec, S: number, phase: number, amp: number, roll: number, wings: string, body: string | null, tips: string | null, alpha: number): void {
  const flapA = amp * 0.85 * Math.sin(phase), flapH = amp * 1.15 * Math.sin(phase - 0.65); // кисть отстаёт от руки и машет шире
  ctx.globalAlpha = alpha; ctx.fillStyle = wings;
  ctx.beginPath(); wingPath(ctx, b, S, 1, flapA, flapH, roll); wingPath(ctx, b, S, -1, flapA, flapH, roll);
  if (!body) bodyPath(ctx, b, S); // одноцветная птица (или тень): всё одним контуром
  ctx.fill();
  if (body) { ctx.fillStyle = body; ctx.beginPath(); bodyPath(ctx, b, S); ctx.fill(); }
  if (tips) { ctx.fillStyle = tips; ctx.beginPath(); tipPath(ctx, 1, S * b.chordElbow); tipPath(ctx, -1, S * b.chordElbow); ctx.fill(); }
}
/** Тень птицы на воде/земле: смещена по солнцу, тем больше и бледнее, чем выше птица; край размыт широкой обводкой. */
function drawBirdShadow(ctx: CanvasRenderingContext2D, b: BirdSpec, S: number, phase: number, amp: number, roll: number, h: number, alt: number, alpha: number): void {
  if (alpha < 0.02) return;
  ctx.save();
  ctx.translate(SUN_X * S * (0.6 + 1.6 * alt), SUN_Y * S * (0.6 + 1.6 * alt)); ctx.rotate(h);
  const k = 1 + 0.45 * alt; ctx.scale(k, k);
  const flapA = amp * 0.85 * Math.sin(phase), flapH = amp * 1.15 * Math.sin(phase - 0.65);
  ctx.beginPath(); wingPath(ctx, b, S, 1, flapA, flapH, roll); wingPath(ctx, b, S, -1, flapA, flapH, roll); bodyPath(ctx, b, S);
  ctx.fillStyle = "rgb(16,44,60)"; ctx.strokeStyle = "rgb(16,44,60)"; ctx.lineJoin = "round";
  ctx.globalAlpha = alpha * 0.3; ctx.lineWidth = S * (0.08 + 0.16 * alt); ctx.stroke();
  ctx.globalAlpha = alpha; ctx.fill();
  ctx.restore();
}

/** Чайка: кружит у берега вокруг медленно плывущего вдоль побережья «якоря», с кренами, парением и покачиванием по высоте. */
interface Gull { part: Part; x: number; y: number; h: number; v: number; om: number; roll: number; alt: number; anchorA: number; off: number; dir: 1 | -1; R: number; phase: number; amp: number; modeT: number; glide: boolean; seed: number; S: number }
function makeGull(p: Profile, size: number): Gull {
  const part = p.parts[Math.floor(Math.random() * p.parts.length)]!;
  const anchorA = rnd(-Math.PI, Math.PI), off = size * rnd(-0.3, 0.9), R = size * rnd(1.2, 2.0);
  const r = radiusAt(part, anchorA) + off;
  return { part, x: part.cx + Math.cos(anchorA) * r + R, y: part.cy + Math.sin(anchorA) * r, h: rnd(-Math.PI, Math.PI), v: size * rnd(0.75, 0.95), om: 0, roll: 0, alt: 0.7, anchorA, off, dir: Math.random() < 0.5 ? 1 : -1, R, phase: rnd(0, TAU), amp: 1, modeT: rnd(2, 5), glide: false, seed: rnd(0, 100), S: size * rnd(0.19, 0.23) };
}
function stepGull(g: Gull, p: Profile, size: number, dt: number, T: number): void {
  g.anchorA += g.dir * 0.03 * dt;
  const ar = radiusAt(g.part, g.anchorA) + g.off, ax = g.part.cx + Math.cos(g.anchorA) * ar, ay = g.part.cy + Math.sin(g.anchorA) * ar;
  const dx = ax - g.x, dy = ay - g.y, dist = Math.hypot(dx, dy);
  // Кружит с постоянной кривизной; улетев дальше радиуса — плавно заворачивает к якорю.
  let wantOm = (g.dir * g.v) / g.R + 0.25 * noise1(T * 0.6, g.seed);
  if (dist > g.R) wantOm = lerp(wantOm, clamp(wrapAngle(Math.atan2(dy, dx) - g.h) * 1.8, -1.8, 1.8), smooth((dist - g.R) / (g.R * 0.6)));
  g.om = ease(g.om, wantOm, dt, 0.5);
  g.h = wrapAngle(g.h + g.om * dt);
  const v = g.v * (1 + 0.12 * noise1(T * 0.5, g.seed + 3));
  g.x += Math.cos(g.h) * v * dt; g.y += Math.sin(g.h) * v * dt;
  g.roll = ease(g.roll, clamp((g.om * v) / (size * 3), -0.6, 0.6), dt, 0.4);
  g.alt = 0.45 + 0.55 * (0.5 + 0.5 * noise1(T * 0.22, g.seed + 9));
  g.modeT -= dt;
  if (g.modeT <= 0) { g.glide = !g.glide; g.modeT = g.glide ? rnd(1.5, 4) : rnd(2.5, 6); }
  g.amp = ease(g.amp, g.glide ? 0 : 1, dt, 0.35);
  g.phase += dt * TAU * GULL.flapHz * (0.15 + 0.85 * g.amp);
}

/** Стая над сушей: перелёт по дуге с одного края острова на другой клином, потом пауза и новый маршрут. */
interface FlockBird { dx: number; dy: number; phase: number; seed: number; amp: number; glide: boolean; modeT: number }
interface Flock { x0: number; y0: number; cx: number; cy: number; x1: number; y1: number; t0: number; dur: number; n: number; x: number; y: number; h: number; roll: number; birds: FlockBird[]; S: number }
function newRoute(f: Flock, p: Profile, size: number, T: number, first: boolean): void {
  const a = rnd(-Math.PI, Math.PI), R = farR(p, size), b = a + Math.PI + rnd(-0.6, 0.6);
  f.x0 = p.cx + Math.cos(a) * R; f.y0 = p.cy + Math.sin(a) * R; f.x1 = p.cx + Math.cos(b) * R; f.y1 = p.cy + Math.sin(b) * R;
  const mx = (f.x0 + f.x1) / 2, my = (f.y0 + f.y1) / 2, nx = -(f.y1 - f.y0), ny = f.x1 - f.x0, bow = rnd(-0.3, 0.3);
  f.cx = mx + nx * bow; f.cy = my + ny * bow; // изгиб маршрута — плавный поворот в пути
  f.t0 = T + (first ? rnd(2, 8) : rnd(8, 25));
  f.dur = (Math.hypot(f.x1 - f.x0, f.y1 - f.y0) * 1.1) / (size * 0.95);
  f.n = Math.floor(rnd(5, 9));
  f.x = f.x0; f.y = f.y0; f.h = Math.atan2(f.cy - f.y0, f.cx - f.x0); f.roll = 0;
  for (let i = 0; i < f.n; i++) { // клин: ведущая впереди, остальные по бокам со сдвигом назад
    const b2 = f.birds[i]!;
    b2.dx = -Math.ceil(i / 2) * f.S * 1.9 + rnd(-0.15, 0.15) * f.S; b2.dy = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * f.S * 1.5;
    b2.phase = rnd(0, TAU); b2.amp = 1; b2.glide = false; b2.modeT = rnd(3, 9);
  }
}
function makeFlock(p: Profile, size: number, T: number): Flock {
  const f: Flock = { x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0, t0: 0, dur: 1, n: 0, x: 0, y: 0, h: 0, roll: 0, S: size * 0.15, birds: Array.from({ length: 8 }, () => ({ dx: 0, dy: 0, phase: 0, seed: rnd(0, 100), amp: 1, glide: false, modeT: 5 })) };
  newRoute(f, p, size, T, true);
  return f;
}
function stepFlock(f: Flock, p: Profile, size: number, dt: number, T: number): void {
  if (T < f.t0) return;
  const u = (T - f.t0) / f.dur;
  if (u >= 1) { newRoute(f, p, size, T, false); return; }
  const w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
  const x = w0 * f.x0 + w1 * f.cx + w2 * f.x1, y = w0 * f.y0 + w1 * f.cy + w2 * f.y1;
  const h = Math.atan2(y - f.y, x - f.x), om = wrapAngle(h - f.h) / Math.max(dt, 1e-3);
  f.roll = ease(f.roll, clamp((om * size * 0.95) / (size * 2.5), -0.5, 0.5), dt, 0.6);
  f.x = x; f.y = y; f.h = h;
  for (let i = 0; i < f.n; i++) {
    const b = f.birds[i]!;
    b.modeT -= dt;
    if (b.modeT <= 0) { b.glide = !b.glide; b.modeT = b.glide ? rnd(1, 2.5) : rnd(4, 10); }
    b.amp = ease(b.amp, b.glide ? 0 : 1, dt, 0.3);
    b.phase += dt * TAU * LANDBIRD.flapHz * (0.15 + 0.85 * b.amp);
  }
}

// ───────────────────────────── Мир ─────────────────────────────
/** Стая дельфинов: звери, поводок и время следующей серии прыжков. */
interface Pod { dolphins: Cet[]; car: Carrot; next: number }
interface World { p: Profile; size: number; T: number; solos: Cet[]; pods: Pod[]; /** Порядок рисования: от глубоких к мелким. */ cets: Cet[]; gulls: Gull[]; flock: Flock; fx: Fx }
function makePod(p: Profile, size: number, n: number): Pod {
  const car = makeCarrot(p, size, size * rnd(2.3, 3), size * 0.35);
  const dL = size * 0.55;
  const scales = [1, 0.88, 0.95, 0.9, 0.84];
  const dolphins = scales.slice(0, n).map((sc, i) => { // в стае звери чуть разного размера
    const d = makeCet(cetSpec("dolphin", dL * sc, size), null, car.x - i * dL, car.y + (i % 2 ? 1 : -1) * i * dL * 0.5, car.h);
    d.fdx = -i * dL * 1.15; d.fdy = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * dL * 0.95;
    return d;
  });
  return { dolphins, car, next: rnd(3, 8) };
}
function createWorld(p: Profile, size: number): World {
  // Отступы от берега: под профилем ещё ~1.6 гекса отмели и песка, дельфинам с их строем нужен запас побольше.
  // Населённость (решение владельца: живности должно быть заметно): два кита, две косатки, две стаи дельфинов, пять чаек.
  const solo = (kind: CetKind, L: number, off: [number, number], wob: number) => { const car = makeCarrot(p, size, size * rnd(off[0], off[1]), size * wob); return makeCet(cetSpec(kind, L, size), car, car.x, car.y, car.h); };
  const solos = [solo("whale", size * 1.8, [2.8, 4], 0.7), solo("whale", size * 1.6, [3, 4.4], 0.7), solo("orca", size * 1.1, [2.4, 3.4], 0.6), solo("orca", size * 1.0, [2.6, 3.6], 0.6)];
  const pods = [makePod(p, size, 3), makePod(p, size, 4)];
  return { p, size, T: 0, solos, pods, cets: [...solos, ...pods.flatMap((pd) => pd.dolphins)], gulls: Array.from({ length: 5 }, () => makeGull(p, size)), flock: makeFlock(p, size, 0), fx: makeFx() };
}
function stepWorld(w: World, dt: number): void {
  w.T += dt; const T = w.T;
  for (const c of w.solos) stepSolo(c, w.p, w.size, w.fx, dt, T);
  for (const pd of w.pods) {
    if (T >= pd.next) { // серия прыжков: по одному, с запаздыванием
      const rev = Math.random() < 0.5;
      pd.dolphins.forEach((d, i) => { d.jumpAt = T + (rev ? pd.dolphins.length - 1 - i : i) * rnd(0.4, 0.6); });
      pd.next = T + rnd(7, 13);
    }
    stepPod(pd.dolphins, pd.car, w.p, w.size, w.fx, dt, T);
  }
  for (const g of w.gulls) stepGull(g, w.p, w.size, dt, T);
  stepFlock(w.flock, w.p, w.size, dt, T);
  // Порядок рисования — от глубоких к мелким (вставками, массив короткий).
  const cs = w.cets;
  for (let i = 1; i < cs.length; i++) { const c = cs[i]!; let j = i - 1; while (j >= 0 && cs[j]!.depth < c.depth) { cs[j + 1] = cs[j]!; j--; } cs[j + 1] = c; }
}
function drawWorld(ctx: CanvasRenderingContext2D, w: World, k: number, vis: Vis): void {
  const T = w.T, px = 1 / k, lod = k >= 1.1, size = w.size, p = w.p;
  for (const c of w.cets) if (inView(vis, c.x, c.y)) drawCet(ctx, c, T, px, lod);
  drawFx(ctx, w.fx, T, px, vis);
  for (const g of w.gulls) {
    if (!inView(vis, g.x, g.y)) continue;
    ctx.save(); ctx.translate(g.x, g.y);
    drawBirdShadow(ctx, GULL, g.S, g.phase, g.amp, g.roll, g.h, g.alt, 0.22 * (1 - 0.5 * g.alt));
    ctx.rotate(g.h);
    drawBird(ctx, GULL, g.S, g.phase, g.amp, g.roll, "rgb(208,214,218)", "rgb(252,253,254)", "rgb(40,44,48)", 1);
    ctx.restore();
  }
  const f = w.flock;
  if (T >= f.t0) {
    const ch = Math.cos(f.h), sh = Math.sin(f.h);
    for (let i = 0; i < f.n; i++) {
      const b = f.birds[i]!;
      const dx = b.dx + noise1(T * 0.7, b.seed) * f.S * 0.25, dy = b.dy + noise1(T * 0.6, b.seed + 5) * f.S * 0.25;
      const x = f.x + ch * dx - sh * dy, y = f.y + sh * dx + ch * dy;
      if (!inView(vis, x, y)) continue;
      const h = f.h + 0.06 * noise1(T * 0.8, b.seed + 2), roll = f.roll + 0.08 * noise1(T * 0.9, b.seed + 4);
      // Тень только над сушей: по профилю острова с плавной кромкой.
      const land = Math.max(...p.parts.map((part) => smooth((radiusAt(part, Math.atan2(y - part.cy, x - part.cx)) - size * 0.3 - Math.hypot(x - part.cx, y - part.cy)) / (size * 1.5))));
      ctx.save(); ctx.translate(x, y);
      drawBirdShadow(ctx, LANDBIRD, f.S, b.phase, b.amp, roll, h, 0.55, 0.28 * land);
      ctx.rotate(h);
      drawBird(ctx, LANDBIRD, f.S, b.phase, b.amp, roll, "rgb(52,42,34)", null, null, 0.95);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

// ───────────────────────────── Слой ─────────────────────────────
const NO_ISLETS: Islet[] = [];
export function FaunaLayer({ vp, hexes, islets = NO_ISLETS, size = HEX_SIZE }: { vp: Viewport; hexes: MapHexDto[]; islets?: Islet[]; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = hexes.length ? `${hexes.length}:${hexes[0]!.q},${hexes[0]!.r}` : "";
  const profile = useMemo(() => islandProfile(hexes, size, islets), [key, size, islets]); // eslint-disable-line react-hooks/exhaustive-deps
  const profileRef = useRef(profile); profileRef.current = profile;
  // vp — новый объект при каждой перерисовке карты; мир живности от него зависеть не должен, иначе звери
  // пересоздавались бы после каждого жеста и «исчезали».
  const vpRef = useRef(vp); vpRef.current = vp;

  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host || !profileRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(host);
    const world = createWorld(profileRef.current, size);
    const vis: Vis = { x0: 0, y0: 0, x1: 0, y1: 0 };
    let last = performance.now(), lastDraw = 0, raf = 0, dirty = false;
    // При движении карты перерисовываем сразу (иначе звери «примерзают» к экрану до следующего кадра по таймеру).
    const unsub = vpRef.current.subscribe(() => { dirty = true; });

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const { k, tx, ty } = vpRef.current.viewRef.current;
      stepWorld(world, dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
      // Видимая область с запасом в три гекса: звери чуть за краем ещё видны хвостом или следом.
      vis.x0 = -tx / k - size * 3; vis.y0 = -ty / k - size * 3; vis.x1 = (W / dpr - tx) / k + size * 3; vis.y1 = (H / dpr - ty) / k + size * 3;
      drawWorld(ctx, world, k, vis);
    };
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) { last = t; return; }
      if (!dirty && t - lastDraw < 1000 / 24) return;
      dirty = false; lastDraw = t; draw(t);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); unsub(); };
  }, [size, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile) return null;
  return <canvas ref={ref} className="fx-layer fauna" aria-hidden />;
}
