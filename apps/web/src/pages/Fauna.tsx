import { useEffect, useMemo, useRef } from "react";
import { HEX_SIZE, hexCenter } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";
import type { Viewport } from "./MapLayers";

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
interface Profile { cx: number; cy: number; r: number[]; maxR: number }

/** Профиль острова: для каждого сектора угла — наибольшее расстояние до края гекса от центра острова. */
function islandProfile(hexes: MapHexDto[], size: number): Profile | null {
  if (!hexes.length) return null;
  const cs = hexes.map((h) => hexCenter(h, size));
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
/** Радиус профиля под любым углом (угол не обязан быть в −π…π). */
function radiusAt(p: Profile, angle: number): number {
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
const RINGS = 20, DROPS = 60, PUFFS = 6, DROP_LIFE = 0.75, PUFF_LIFE = 3.6;
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
    ctx.globalAlpha = 0.75 * Math.pow(1 - u, 1.6);
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
interface CetSpec {
  kind: CetKind; L: number;
  /** Доля длины на тело (остальное — лопасти), доля тела на округлую голову, вынос носа (клюв), полуширины и степени сужения. */
  body: number; head: number; beak: number; noseRound: number; wMax: number; wTail: number; taperP: number; taperQ: number;
  finS: number; finLen: number; finChord: number; finSweep: number; finRound: number;
  flukeSpan: number; flukeLen: number; dorsalS: number; dorsalLen: number; blowS: number; blowTwin: boolean;
  swayAmp: number; swayFreq: number; swayK: number; speed: number; maxTurn: number;
  col: { body: RGB; fin: RGB; hi: RGB; dark: RGB; patch: RGB };
}
function cetSpec(kind: CetKind, size: number): CetSpec {
  if (kind === "whale") return { // горбач: длинные светлые грудные плавники, широкие лопасти с выемкой
    kind, L: size * 1.8, body: 0.76, head: 0.3, beak: 0.02, noseRound: 1, wMax: 0.13, wTail: 0.034, taperP: 2.6, taperQ: 1.3,
    finS: 0.34, finLen: 0.3, finChord: 0.075, finSweep: 0.72, finRound: 0.3, flukeSpan: 0.46, flukeLen: 0.24,
    dorsalS: 0.66, dorsalLen: 0.08, blowS: 0.16, blowTwin: true, swayAmp: 0.016, swayFreq: 1.5, swayK: 2.2, speed: size * 0.27, maxTurn: 0.35,
    col: { body: [58, 72, 86], fin: [168, 186, 196], hi: [138, 158, 172], dark: [24, 32, 40], patch: [120, 138, 150] },
  };
  if (kind === "orca") return { // косатка: чёрная, белые пятна за глазами, серое седло за спинным плавником, плавники-вёсла
    kind, L: size * 1.1, body: 0.8, head: 0.28, beak: 0.02, noseRound: 0.85, wMax: 0.145, wTail: 0.036, taperP: 2.3, taperQ: 1.3,
    finS: 0.34, finLen: 0.21, finChord: 0.11, finSweep: 0.45, finRound: 0.9, flukeSpan: 0.38, flukeLen: 0.2,
    dorsalS: 0.5, dorsalLen: 0.14, blowS: 0.15, blowTwin: false, swayAmp: 0.024, swayFreq: 2.2, swayK: 2.4, speed: size * 0.5, maxTurn: 0.6,
    col: { body: [24, 28, 32], fin: [24, 28, 32], hi: [96, 104, 112], dark: [8, 10, 12], patch: [242, 246, 248] },
  };
  return { // дельфин: стройный, с клювом, тёмная «накидка» на спине
    kind, L: size * 0.55, body: 0.8, head: 0.24, beak: 0.08, noseRound: 0.3, wMax: 0.125, wTail: 0.032, taperP: 2.2, taperQ: 1.3,
    finS: 0.36, finLen: 0.2, finChord: 0.07, finSweep: 0.65, finRound: 0.25, flukeSpan: 0.38, flukeLen: 0.16,
    dorsalS: 0.55, dorsalLen: 0.12, blowS: 0.2, blowTwin: false, swayAmp: 0.035, swayFreq: 4.2, swayK: 2.6, speed: size * 0.75, maxTurn: 1.3,
    col: { body: [104, 122, 136], fin: [86, 102, 116], hi: [204, 214, 220], dark: [58, 72, 84], patch: [66, 82, 96] },
  };
}

/** «Поводок»: точка, бегущая вдоль берега на отступе off с медленным меандром; зверь плывёт за ней. */
interface Carrot { a: number; dir: 1 | -1; off: number; wob: number; seed: number; x: number; y: number; h: number }
function carrotStep(car: Carrot, p: Profile, size: number, dist: number, T: number): void {
  const rNow = radiusAt(p, car.a) + car.off;
  car.a = wrapAngle(car.a + (car.dir * dist) / Math.max(size, rNow));
  const r = radiusAt(p, car.a) + car.off + noise1(T * 0.12, car.seed) * car.wob;
  const x = p.cx + Math.cos(car.a) * r, y = p.cy + Math.sin(car.a) * r;
  if (dist > 0) car.h = Math.atan2(y - car.y, x - car.x);
  car.x = x; car.y = y;
}
/** off — отступ от профиля берега, wob — размах меандра (оба в единицах карты). */
const makeCarrot = (p: Profile, size: number, off: number, wob: number): Carrot => {
  const car: Carrot = { a: rnd(-Math.PI, Math.PI), dir: Math.random() < 0.5 ? 1 : -1, off, wob, seed: rnd(0, 100), x: 0, y: 0, h: 0 };
  carrotStep(car, p, size, 0, 0); carrotStep(car, p, size, size * 0.05, 0);
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

/** Кит и косатка: поводок вдоль берега; цикл всплытия с фонтаном и кругами на воде. */
function stepSolo(c: Cet, p: Profile, size: number, fx: Fx, dt: number, T: number): void {
  const car = c.car!, s = c.surf!, sp = c.spec;
  // Поводок притормаживает, если зверь отстал (иначе он «срежет» и пойдёт по берегу).
  const behind = Math.hypot(car.x - c.x, car.y - c.y);
  carrotStep(car, p, size, sp.speed * dt * clamp(1.6 - behind / (sp.L * 2.5), 0.25, 1), T);
  steerCet(c, car.x, car.y, dt, T, 1);
  const prev = s.t; s.t += dt;
  const tHold = s.deep + s.rise, tEnd = tHold + s.hold + s.dive;
  const blowU = sp.L * sp.body * (0.5 - sp.blowS);
  if (prev < tHold && s.t >= tHold) { // вынырнул: выдох и первый круг
    emitPuff(fx, axisX(c, blowU) + WIND_X * 0.9, axisY(c, blowU) + WIND_Y * 0.9, T, sp.L * (sp.kind === "whale" ? 0.45 : 0.28), Math.cos(c.h) * c.v * 0.25 + WIND_X, Math.sin(c.h) * c.v * 0.25 + WIND_Y);
    emitRing(fx, c.x, c.y, T, sp.L * 0.35, sp.L * 1.3, 4); s.spouts = 1; s.nextRing = T + 1.5;
  }
  if (s.t >= tHold && s.t < tHold + s.hold) {
    if (T >= s.nextRing) { emitRing(fx, axisX(c, -sp.L * 0.1), axisY(c, -sp.L * 0.1), T, sp.L * 0.3, sp.L * 1.1, 3.5); s.nextRing = T + rnd(1.4, 2.2); }
    if (sp.kind === "whale" && s.spouts === 1 && s.t > tHold + s.hold * 0.55) { // второй выдох посреди стоянки у поверхности
      emitPuff(fx, axisX(c, blowU) + WIND_X * 0.9, axisY(c, blowU) + WIND_Y * 0.9, T, sp.L * 0.38, Math.cos(c.h) * c.v * 0.25 + WIND_X, Math.sin(c.h) * c.v * 0.25 + WIND_Y); s.spouts = 2;
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
  carrotStep(pod, p, size, sp.speed * dt * clamp(1.6 - behind / (sp.L * 3), 0.25, 1), T);
  const ch = Math.cos(pod.h), sh = Math.sin(pod.h);
  for (const d of ds) {
    const u = (T - d.jumpAt) / 1.35, jumping = u >= 0 && u < 1;
    const fx0 = d.fdx + sp.L * 1.3 + noise1(T * 0.3, d.seed) * sp.L * 0.25, fy0 = d.fdy + noise1(T * 0.25, d.seed + 7) * sp.L * 0.3;
    steerCet(d, pod.x + ch * fx0 - sh * fy0, pod.y + sh * fx0 + ch * fy0, dt, T, jumping ? 1 + 0.5 * Math.sin(Math.PI * u) : 1);
    if (jumping) {
      d.depth = 0.28 - 0.95 * Math.sin(Math.PI * u);
      if (d.ju < 0.08 && u >= 0.08) { emitRing(fx, d.x, d.y, T, sp.L * 0.2, sp.L * 0.9, 1.3); emitDrops(fx, axisX(d, sp.L * 0.2), axisY(d, sp.L * 0.2), T, 7, sp.L * 1.6, sp.L * 0.028); }
      if (d.ju < 0.9 && u >= 0.9) { emitRing(fx, axisX(d, sp.L * 0.3), axisY(d, sp.L * 0.3), T, sp.L * 0.25, sp.L * 1.1, 1.5); emitDrops(fx, axisX(d, sp.L * 0.4), axisY(d, sp.L * 0.4), T, 9, sp.L * 2, sp.L * 0.03); }
      d.ju = u;
    } else { d.ju = 0; d.depth = 0.26 + 0.07 * Math.sin(T * 1.3 + d.seed); }
  }
}

// ── Отрисовка китообразных: сегментированный позвоночник в общих буферах (без аллокаций в кадре)
const N = 18;
const SX = new Float32Array(N), SY = new Float32Array(N), SW = new Float32Array(N), SA = new Float32Array(N), NX = new Float32Array(N), NY = new Float32Array(N);
/** Полуширина тела в долях L по нормированной длине s: округлая голова (эллипс), затем плавное сужение к стеблю хвоста. */
function halfWidth(sp: CetSpec, s: number): number {
  if (s < sp.head) { const u = 1 - s / sp.head; return sp.wMax * Math.sqrt(Math.max(0, 1 - u * u)); }
  const u = (s - sp.head) / (1 - sp.head);
  return sp.wTail + (sp.wMax - sp.wTail) * Math.pow(1 - Math.pow(u, sp.taperP), sp.taperQ);
}
/** Позвоночник: центр в начале координат, голова по +x. Боковая волна растёт к хвосту и бежит назад; в повороте тело изгибается. */
function computeSpine(c: Cet): void {
  const sp = c.spec, L = sp.L, Lb = L * sp.body;
  const bend = clamp(c.turn, -1.2, 1.2) * L * 0.1;
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    SX[i] = Lb * (0.5 - s);
    SY[i] = L * sp.swayAmp * (0.15 + 0.85 * s * s) * Math.sin(c.phase - s * sp.swayK) + bend * s * s;
    SW[i] = L * halfWidth(sp, s);
  }
  for (let i = 0; i < N; i++) {
    const j = i < N - 1 ? i + 1 : i, k = i < N - 1 ? i : i - 1;
    const a = Math.atan2(SY[k]! - SY[j]!, SX[k]! - SX[j]!);
    SA[i] = a; NX[i] = -Math.sin(a); NY[i] = Math.cos(a);
  }
}
/** Контур вдоль позвоночника от образца i0 до i1 с множителем ширины wf; nose — вынос носа вперёд. Кривые через середины — гладко. */
function spinePath(ctx: CanvasRenderingContext2D, i0: number, i1: number, wf: number, nose: number, round: number): void {
  ctx.beginPath();
  const nx = SX[i0]! + nose, ny = SY[i0]!;
  // Опорная точка носа сдвинута вбок на round: кривая выходит из носа поперёк оси — голова тупая и круглая, а не остриё.
  const rw = SW[i0 + 1]! * wf * round * 1.1, cx = nx - nose * 0.5 * round;
  ctx.moveTo(nx, ny);
  let px = SX[i0]! + NX[i0]! * SW[i0]! * wf, py = SY[i0]! + NY[i0]! * SW[i0]! * wf;
  if (round > 0) { const mx = (px + SX[i0 + 1]! + NX[i0 + 1]! * SW[i0 + 1]! * wf) / 2, my = (py + SY[i0 + 1]! + NY[i0 + 1]! * SW[i0 + 1]! * wf) / 2; ctx.quadraticCurveTo(cx + NX[i0]! * rw, ny + NY[i0]! * rw, mx, my); px = SX[i0 + 1]! + NX[i0 + 1]! * SW[i0 + 1]! * wf; py = SY[i0 + 1]! + NY[i0 + 1]! * SW[i0 + 1]! * wf; i0++; }
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
  if (round > 0) ctx.quadraticCurveTo(cx - NX[i0]! * rw, ny - NY[i0]! * rw, nx, ny); else ctx.quadraticCurveTo(px, py, nx, ny);
  ctx.closePath();
}
/** Грудной плавник у точки (x,y) с курсом a на стороне sgn: лист, скошенный назад; round — округлость задней кромки. */
function finPath(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, sgn: number, len: number, chord: number, sweep: number, round: number): void {
  // Оси: f — вперёд по курсу, o — наружу от тела на стороне sgn. Точки задаются как (вдоль, наружу).
  const fx = Math.cos(a), fy = Math.sin(a), ox = -Math.sin(a) * sgn, oy = Math.cos(a) * sgn;
  const tu = -len * Math.sin(sweep), tv = len * Math.cos(sweep);
  const c1u = chord * 0.45 + tu * 0.3, c1v = tv * 0.55, c2u = tu - chord * 0.7 - len * 0.35 * round, c2v = tv * 0.5;
  const r0u = chord * 0.5, r1u = -chord * 0.6, rv = -chord * 0.2;
  ctx.moveTo(x + fx * r0u + ox * rv, y + fy * r0u + oy * rv);
  ctx.quadraticCurveTo(x + fx * c1u + ox * c1v, y + fy * c1u + oy * c1v, x + fx * tu + ox * tv, y + fy * tu + oy * tv);
  ctx.quadraticCurveTo(x + fx * c2u + ox * c2v, y + fy * c2u + oy * c2v, x + fx * r1u + ox * rv, y + fy * r1u + oy * rv);
  ctx.closePath();
}
/** Хвостовые лопасти у стебля (x,y) с курсом a: две лопасти, выемка посередине, кончики отведены назад; fore — сокращение по оси при ударе. */
function flukePath(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, span: number, len: number, wTail: number, fore: number): void {
  const fx = Math.cos(a) * fore, fy = Math.sin(a) * fore, ox = -Math.sin(a), oy = Math.cos(a), hs = span * 0.5;
  // Опорные точки одной лопасти (вдоль, наружу): стебель, изгиб передней кромки, кончик, выпуклая задняя кромка, выемка.
  const su = len * 0.15, sv = wTail * 0.9, c1u = -len * 0.1, c1v = hs * 0.62, tu = -len * 0.62, tv = hs, c2u = -len * 1.05, c2v = hs * 0.42, nu = -len * 0.8;
  ctx.beginPath();
  ctx.moveTo(x + fx * su + ox * sv, y + fy * su + oy * sv);
  ctx.quadraticCurveTo(x + fx * c1u + ox * c1v, y + fy * c1u + oy * c1v, x + fx * tu + ox * tv, y + fy * tu + oy * tv);
  ctx.quadraticCurveTo(x + fx * c2u + ox * c2v, y + fy * c2u + oy * c2v, x + fx * nu, y + fy * nu);
  ctx.quadraticCurveTo(x + fx * c2u - ox * c2v, y + fy * c2u - oy * c2v, x + fx * tu - ox * tv, y + fy * tu - oy * tv);
  ctx.quadraticCurveTo(x + fx * c1u - ox * c1v, y + fy * c1u - oy * c1v, x + fx * su - ox * sv, y + fy * su - oy * sv);
  ctx.closePath();
}
/** Мягкий край: две широкие полупрозрачные обводки текущего контура под заливкой — дешёвая замена blur. */
function softFill(ctx: CanvasRenderingContext2D, color: string, blur: number, alpha: number): void {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineJoin = "round";
  ctx.globalAlpha = alpha * 0.1; ctx.lineWidth = blur * 3.4; ctx.stroke();
  ctx.globalAlpha = alpha * 0.18; ctx.lineWidth = blur * 2; ctx.stroke();
  ctx.globalAlpha = alpha * 0.3; ctx.lineWidth = blur * 0.9; ctx.stroke();
  ctx.globalAlpha = alpha; ctx.fill();
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
/** Блики каустики: тонкие светлые полосы в мировых осях (не крутятся вместе со зверем), медленно ползут по спине. */
function drawCaustics(ctx: CanvasRenderingContext2D, h: number, L: number, m: number, alpha: number, T: number): void {
  ctx.rotate(-h + 0.7);
  ctx.strokeStyle = "rgb(228,246,255)"; ctx.lineCap = "round";
  ctx.globalAlpha = alpha * (0.03 + 0.11 * (1 - m)); ctx.lineWidth = L * 0.022;
  const gap = L * 0.21, off = (T * L * 0.07) % gap;
  ctx.beginPath();
  for (let i = -4; i <= 4; i++) { // полосы разной кривизны и с разным сдвигом, чтобы не читались как решётка
    const x = i * gap + off + Math.sin(i * 2.3) * gap * 0.25, w = Math.sin(T * 1.1 + i * 1.7) * L * 0.08;
    ctx.moveTo(x - w, -L * 0.7); ctx.bezierCurveTo(x + w, -L * 0.25, x - w * 0.8, L * 0.25, x + w * 0.4, L * 0.7);
  }
  ctx.stroke();
}
/** Узор внутри тела (вызывается под clip по контуру тела): блик хребта, накидка дельфина, пятна и седло косатки. */
function drawPattern(ctx: CanvasRenderingContext2D, c: Cet, m: number, alpha: number, lod: boolean, T: number): void {
  const sp = c.spec, L = sp.L, hi = alpha * (1 - m);
  // Тёмная кромка изнутри контура: бока уходят вниз, в воду — тело выглядит объёмным, а не плоским.
  ctx.strokeStyle = rgb(sp.col.dark); ctx.globalAlpha = alpha * 0.28 * (1 - m * 0.6); ctx.lineWidth = L * 0.045; ctx.lineJoin = "round";
  spinePath(ctx, 0, N - 1, 1, L * sp.beak, sp.noseRound); ctx.stroke();
  if (sp.kind === "whale") {
    // Округлость спины: два мягких прохода блика — широкий слабый и узкий поярче.
    ctx.fillStyle = rgb(sp.col.hi); ctx.globalAlpha = hi * 0.14 + 0.03; spinePath(ctx, 1, N - 2, 0.6, 0, 0.8); ctx.fill();
    ctx.globalAlpha = hi * 0.16 + 0.03; spinePath(ctx, 2, N - 2, 0.3, 0, 0.8); ctx.fill();
  } else if (sp.kind === "dolphin") {
    ctx.fillStyle = underwater(sp.col.patch, m); ctx.globalAlpha = alpha * 0.55; spinePath(ctx, 1, N - 2, 0.62, L * 0.02, 0.6); ctx.fill();
    ctx.fillStyle = rgb(sp.col.hi); ctx.globalAlpha = hi * 0.35; spinePath(ctx, 2, N - 3, 0.18, 0, 0.8); ctx.fill();
  } else {
    const ie = Math.round(0.2 * (N - 1)), is = Math.round(0.6 * (N - 1));
    ctx.fillStyle = underwater(sp.col.patch, m); ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let sgn = -1; sgn <= 1; sgn += 2) { // белые пятна за глазами — вытянутые, чуть отвёрнутые наружу
      const ex = SX[ie]! + sgn * NX[ie]! * SW[ie]! * 0.58, ey = SY[ie]! + sgn * NY[ie]! * SW[ie]! * 0.58;
      ctx.moveTo(ex + L * 0.075, ey); ctx.ellipse(ex, ey, L * 0.075, L * 0.028, SA[ie]! + sgn * 0.42, 0, TAU);
    }
    ctx.fill();
    ctx.fillStyle = underwater(sp.col.hi, m); ctx.globalAlpha = alpha * 0.85;
    ctx.beginPath();
    for (let sgn = -1; sgn <= 1; sgn += 2) { // серое седло за спинным плавником
      const ex = SX[is]! + sgn * NX[is]! * SW[is]! * 0.62, ey = SY[is]! + sgn * NY[is]! * SW[is]! * 0.62;
      ctx.moveTo(ex + L * 0.1, ey); ctx.ellipse(ex, ey, L * 0.1, L * 0.045, SA[is]! + sgn * 0.12, 0, TAU);
    }
    ctx.fill();
    ctx.fillStyle = rgb(sp.col.hi); ctx.globalAlpha = hi * 0.22; spinePath(ctx, 2, N - 2, 0.16, 0, 0.8); ctx.fill();
  }
  if (lod) drawCaustics(ctx, c.h, L, m, alpha, T);
}
/** Дыхало и намёк на спинной плавник (тёмная линия с блик-кромкой по хребту) — поверх тела. */
function drawDetails(ctx: CanvasRenderingContext2D, c: Cet, m: number, alpha: number): void {
  const sp = c.spec, L = sp.L, a = alpha * (1 - m);
  if (a < 0.03) return;
  const ib = Math.round(sp.blowS * (N - 1)), r = L * 0.012;
  ctx.fillStyle = rgb(sp.col.dark); ctx.globalAlpha = a * 0.8;
  ctx.beginPath();
  if (sp.blowTwin) {
    for (let sgn = -1; sgn <= 1; sgn += 2) { const x = SX[ib]! + sgn * NX[ib]! * L * 0.017, y = SY[ib]! + sgn * NY[ib]! * L * 0.017; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
  } else { ctx.moveTo(SX[ib]! + r, SY[ib]!); ctx.arc(SX[ib]!, SY[ib]!, r, 0, TAU); }
  ctx.fill();
  const i0 = Math.round((sp.dorsalS - sp.dorsalLen / 2) * (N - 1)), i1 = Math.round((sp.dorsalS + sp.dorsalLen / 2) * (N - 1));
  ctx.lineCap = "round";
  ctx.strokeStyle = rgb(sp.col.dark); ctx.globalAlpha = a * 0.55; ctx.lineWidth = L * 0.014;
  ctx.beginPath(); ctx.moveTo(SX[i0]!, SY[i0]!); ctx.lineTo(SX[i1]!, SY[i1]!); ctx.stroke();
  ctx.strokeStyle = rgb(sp.col.hi); ctx.globalAlpha = a * 0.6; ctx.lineWidth = L * (sp.kind === "orca" ? 0.016 : 0.01);
  ctx.beginPath(); ctx.moveTo(SX[i0]! + NX[i0]! * L * 0.012, SY[i0]! + NY[i0]! * L * 0.012); ctx.lineTo(SX[i1]! + NX[i1]! * L * 0.012, SY[i1]! + NY[i1]! * L * 0.012); ctx.stroke();
}
function drawCet(ctx: CanvasRenderingContext2D, c: Cet, T: number, px: number, lod: boolean): void {
  const sp = c.spec, L = sp.L;
  const m = clamp(c.depth, 0, 1), air = Math.max(0, -c.depth);
  const alpha = 1 - 0.62 * m, blur = L * (0.012 + 0.07 * m), surf = clamp(1 - m / 0.32, 0, 1);
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
  // Лопасти бьют вверх-вниз: сверху видна укороченная проекция, плюс лёгкое виляние с запаздыванием по фазе.
  const fore = 0.8 + 0.2 * Math.cos(c.phase - sp.swayK - 0.6), wag = 0.22 * Math.sin(c.phase - sp.swayK - 1.1);
  // Плавники и лопасти всегда глубже спины (спина у поверхности может выступать из воды, плавники — нет).
  const it = N - 1, mf = Math.max(m, 0.3), finColor = underwater(sp.col.fin, mf);
  flukePath(ctx, SX[it]!, SY[it]!, SA[it]! + wag, L * sp.flukeSpan, L * sp.flukeLen, SW[it]!, fore);
  softFill(ctx, underwater(sp.col.body, mf), blur, alpha * (0.8 + 0.2 * fore));
  const fi = Math.round(sp.finS * (N - 1)), flutter = 0.07 * Math.sin(c.phase * 0.5 + c.seed);
  ctx.beginPath();
  finPath(ctx, SX[fi]! + NX[fi]! * SW[fi]! * 0.85, SY[fi]! + NY[fi]! * SW[fi]! * 0.85, SA[fi]!, 1, L * sp.finLen, L * sp.finChord, sp.finSweep + flutter, sp.finRound);
  finPath(ctx, SX[fi]! - NX[fi]! * SW[fi]! * 0.85, SY[fi]! - NY[fi]! * SW[fi]! * 0.85, SA[fi]!, -1, L * sp.finLen, L * sp.finChord, sp.finSweep - flutter, sp.finRound);
  softFill(ctx, finColor, blur, alpha);
  spinePath(ctx, 0, N - 1, 1, L * sp.beak, sp.noseRound);
  softFill(ctx, underwater(sp.col.body, m), blur, alpha);
  if (lod || sp.kind === "orca") { ctx.save(); ctx.clip(); drawPattern(ctx, c, m, alpha, lod, T); ctx.restore(); }
  if (lod) drawDetails(ctx, c, m, alpha);
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
interface Gull { x: number; y: number; h: number; v: number; om: number; roll: number; alt: number; anchorA: number; off: number; dir: 1 | -1; R: number; phase: number; amp: number; modeT: number; glide: boolean; seed: number; S: number }
function makeGull(p: Profile, size: number): Gull {
  const anchorA = rnd(-Math.PI, Math.PI), off = size * rnd(-0.3, 0.9), R = size * rnd(1.2, 2.0);
  const r = radiusAt(p, anchorA) + off;
  return { x: p.cx + Math.cos(anchorA) * r + R, y: p.cy + Math.sin(anchorA) * r, h: rnd(-Math.PI, Math.PI), v: size * rnd(0.75, 0.95), om: 0, roll: 0, alt: 0.7, anchorA, off, dir: Math.random() < 0.5 ? 1 : -1, R, phase: rnd(0, TAU), amp: 1, modeT: rnd(2, 5), glide: false, seed: rnd(0, 100), S: size * rnd(0.38, 0.46) };
}
function stepGull(g: Gull, p: Profile, size: number, dt: number, T: number): void {
  g.anchorA += g.dir * 0.03 * dt;
  const ar = radiusAt(p, g.anchorA) + g.off, ax = p.cx + Math.cos(g.anchorA) * ar, ay = p.cy + Math.sin(g.anchorA) * ar;
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
  const a = rnd(-Math.PI, Math.PI), R = p.maxR * 1.25, b = a + Math.PI + rnd(-0.6, 0.6);
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
  const f: Flock = { x0: 0, y0: 0, cx: 0, cy: 0, x1: 0, y1: 0, t0: 0, dur: 1, n: 0, x: 0, y: 0, h: 0, roll: 0, S: size * 0.3, birds: Array.from({ length: 8 }, () => ({ dx: 0, dy: 0, phase: 0, seed: rnd(0, 100), amp: 1, glide: false, modeT: 5 })) };
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
interface World { p: Profile; size: number; T: number; whale: Cet; orca: Cet; dolphins: Cet[]; /** Порядок рисования: от глубоких к мелким. */ cets: Cet[]; pod: Carrot; podNext: number; gulls: Gull[]; flock: Flock; fx: Fx }
function createWorld(p: Profile, size: number): World {
  // Отступы от берега: под профилем ещё ~1.6 гекса отмели и песка, дельфинам с их строем нужен запас побольше.
  const whaleCar = makeCarrot(p, size, size * rnd(2.8, 4), size * 0.7), orcaCar = makeCarrot(p, size, size * rnd(2.4, 3.4), size * 0.6), pod = makeCarrot(p, size, size * rnd(2.3, 3), size * 0.35);
  const whale = makeCet(cetSpec("whale", size), whaleCar, whaleCar.x, whaleCar.y, whaleCar.h);
  const orca = makeCet(cetSpec("orca", size), orcaCar, orcaCar.x, orcaCar.y, orcaCar.h);
  const dsp = cetSpec("dolphin", size);
  const dolphins = [0, 1, 2].map((i) => {
    const d = makeCet(dsp, null, pod.x - i * dsp.L, pod.y + (i % 2 ? 1 : -1) * i * dsp.L * 0.5, pod.h);
    d.fdx = -i * dsp.L * 1.15; d.fdy = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * dsp.L * 0.95;
    return d;
  });
  return { p, size, T: 0, whale, orca, dolphins, cets: [whale, orca, ...dolphins], pod, podNext: rnd(3, 6), gulls: [makeGull(p, size), makeGull(p, size), makeGull(p, size)], flock: makeFlock(p, size, 0), fx: makeFx() };
}
function stepWorld(w: World, dt: number): void {
  w.T += dt; const T = w.T;
  stepSolo(w.whale, w.p, w.size, w.fx, dt, T);
  stepSolo(w.orca, w.p, w.size, w.fx, dt, T);
  if (T >= w.podNext) { // серия прыжков: по одному, с запаздыванием
    const rev = Math.random() < 0.5;
    w.dolphins.forEach((d, i) => { d.jumpAt = T + (rev ? w.dolphins.length - 1 - i : i) * rnd(0.4, 0.6); });
    w.podNext = T + rnd(7, 13);
  }
  stepPod(w.dolphins, w.pod, w.p, w.size, w.fx, dt, T);
  for (const g of w.gulls) stepGull(g, w.p, w.size, dt, T);
  stepFlock(w.flock, w.p, w.size, dt, T);
  // Порядок рисования — от глубоких к мелким (вставками, массив из пяти).
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
      const land = smooth((radiusAt(p, Math.atan2(y - p.cy, x - p.cx)) - size * 0.3 - Math.hypot(x - p.cx, y - p.cy)) / (size * 1.5));
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
export function FaunaLayer({ vp, hexes, size = HEX_SIZE }: { vp: Viewport; hexes: MapHexDto[]; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = hexes.length ? `${hexes.length}:${hexes[0]!.q},${hexes[0]!.r}` : "";
  const profile = useMemo(() => islandProfile(hexes, size), [key, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const profileRef = useRef(profile); profileRef.current = profile;

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
    let last = performance.now(), lastDraw = 0, raf = 0;

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const { k, tx, ty } = vp.viewRef.current;
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
      if (t - lastDraw < 1000 / 24) return;
      lastDraw = t; draw(t);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [vp, size, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile) return null;
  return <canvas ref={ref} className="fx-layer fauna" aria-hidden />;
}
