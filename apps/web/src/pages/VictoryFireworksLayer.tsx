import { useEffect, useRef } from "react";
import { coverGate } from "../lib/mapCover";
import { mapBrightness, victoryFxOn, type VictoryWindow } from "../lib/victoryFx";
import type { Viewport } from "./MapLayers";

/**
 * Салют победы над последней столицей (решение владельца 26.11: «невиданных масштабов салют по всей карте, очень сильный»;
 * первые сутки без остановки, вторые и третьи — только в игровую ночь). Не путать с `FireworksLayer` — тот горит над
 * городами, которые взяли сегодня; этот бьёт по всей видимой карте: над городами, руинами, сушей и морем.
 *
 * Чужой опыт (правило приёмки). Приёмы взяты из «Firework Simulator v2» Caleb Miller (CodePen MillerTime/XgpNwb, MIT):
 * библиотека видов снарядов (хризантема, пион, кольцо, пальма, ива, кроссет, строб, «золотой дождь»), скорость разлёта,
 * подобранная под сопротивление воздуха так, чтобы шар доходил ровно до нужного радиуса; шар выглядит объёмным, если
 * направления брать с поверхности сферы (круг получается плотным у края), а кольцо — с наклоном (эллипс); шлейф звезды —
 * отрезок против скорости; мерцающие звёзды; вторичный разрыв кроссета; искры за ракетой; вспышка-зарево при разрыве;
 * ограничение числа звёзд («качество»). Общее для всех холстовых салютов: сложение света `lighter` вместо теней.
 * Код не копировался — только приёмы, всё написано заново под карту.
 * Чего не взято: шлейф «затуханием прошлого кадра» (холст не очищается, а гасится прозрачной заливкой). Здесь карту
 * двигают пальцем, и такой след остался бы на месте, не следуя за картой (ошибка «следы при зуме» 16.11), поэтому шлейфы
 * геометрические — отрезки в координатах карты, а холст каждый кадр очищается целиком.
 *
 * Устройство. Один холст 2D над картой; всё в координатах карты, поэтому разрыв остаётся на своём месте при сдвиге и
 * зуме. Размер задаётся в пикселях экрана на момент разрыва и делится на «опорный» масштаб (`kEff`: в обычных пределах
 * размер на экране не зависит от приближения, за ними — растёт и убывает мягче самой карты): салют крупный и на общем
 * виде, и вблизи. Звёзды — в массивах чисел без выделения памяти; рисуются «вёдрами» по цвету и яркости: один путь на
 * сотню отрезков вместо тысячи отдельных штрихов. Потолок звёзд — `CAP`; новые разрывы мельчают, когда он близко.
 *
 * Распорядитель. Всё время идёт по собственным часам показа (`T`, растёт на кадр): под листом (`coverGate`) показ
 * замирает и после него не догоняет. Обычное — один «залп» раз в ~1 с: одиночный снаряд, веер ракет из одной точки,
 * пара, бегущая волна. Раз в 20–40 с — канонада 3–5 с с финальным аккордом из огромных разрывов. Места берутся из
 * видимой части экрана по принципу «самое далёкое от недавних», четверть залпов — над видимыми городами.
 *
 * Скорость (памятка 16.11): всё на холсте, в слое меток ничего не движется; потолок 30 кадров; когда салюта нет (до победы,
 * после неё, днём вторых и третьих суток) — цикл кадров не крутится, холст сжат до точки, раз в 4 с проверяется только
 * время. Холст чистится целиком каждый кадр, список звёзд сбрасывается вместе с ним. При `prefers-reduced-motion`
 * салюта нет. Выключатель для замеров — `perfOff("victory")`. Звука нет.
 */
export interface VictoryAnchor { x: number; y: number }

// ——— Палитра ———
// [оттенок, насыщенность %, яркость %]: «горячая» версия (белее) рисуется в первые мгновения звезды.
const COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [42, 100, 60], [32, 100, 55], [2, 100, 60], [340, 95, 60], [322, 95, 72], [295, 90, 64], [262, 90, 70], [222, 100, 68], [200, 100, 62],
  [180, 100, 56], [155, 90, 58], [125, 90, 56], [85, 95, 56], [56, 100, 62], [22, 100, 58], [210, 20, 96], [45, 70, 92], [190, 25, 85],
];
const NC = COLORS.length;
const C_GOLD = 0, C_AMBER = 1, C_WHITE = 15, C_WARM = 16;
const CHROMA: ReadonlyArray<number> = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0]; // цвета для разрывов (без белых)
const ALPHAS = [1, 0.85, 0.7, 0.56, 0.43, 0.31, 0.2, 0.1] as const;
const NA = ALPHAS.length;
const NB = 2 * 2 * NC * NA; // (толщина × горячая) × цвет × яркость

// ——— Пределы ———
const CAP = 3000;      // жёсткий потолок звёзд на весь холст
const SOFT = 2400;     // за ним новые разрывы теряют звёзды
const MAX_GLOWS = 28, MAX_ROCKETS = 40;
const FRAME_MS = 33;   // потолок кадров — 30 в секунду

type Kind = 0 | 1 | 3 | 4 | 6; // 0 звезда, 1 строб, 3 кроссет-разделитель, 4 искра ракеты, 6 «ветвь» ивы и дождя
type ShellType = "chrys" | "peony" | "ring" | "ring2" | "palm" | "willow" | "crossette" | "strobe" | "rain" | "spiral";
interface Rocket { sx: number; sy: number; tx: number; ty: number; T: number; age: number; type: ShellType; R: number; c1: number; c2: number; big: number }
interface Glow { x: number; y: number; r: number; age: number; life: number; col: number; a: number }

/** Простой генератор с зерном (mulberry32): `?vseed=N` даёт одинаковый показ для съёмки. */
function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function VictoryFireworksLayer({ vp, win, clock, timeZone, anchors }: {
  vp: Viewport;
  /** Окно празднования (см. `victoryWindow`): салют бьёт внутри него по правилам `victoryFxOn`. */
  win: VictoryWindow;
  /** Часы сервера, мс. */
  clock: () => number;
  timeZone: string;
  /** Места городов в координатах карты: четверть залпов уходит из них. */
  anchors?: ReadonlyArray<VictoryAnchor>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  const winRef = useRef(win); winRef.current = win;
  const clockRef = useRef(clock); clockRef.current = clock;
  const tzRef = useRef(timeZone); tzRef.current = timeZone;
  const anchorsRef = useRef(anchors); anchorsRef.current = anchors;

  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const seedQ = /[?&]vseed=(\d+)/.exec(window.location.search)?.[1];
    const rng = seedQ ? mulberry(Number(seedQ)) : Math.random;
    const rnd = (a: number, b: number) => a + rng() * (b - a);
    const pick = <T,>(a: ReadonlyArray<T>): T => a[Math.floor(rng() * a.length)]!;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    // ——— Состояние холста ———
    let CW = 0, CH = 0, W = 0, H = 0;
    let running = false, stopping = false, raf = 0, last = 0, checked = -1e9;
    const readSize = () => { CW = host.clientWidth; CH = host.clientHeight; };
    const sizeCanvas = () => {
      const w = running ? Math.max(1, Math.round(CW * dpr)) : 1, h = running ? Math.max(1, Math.round(CH * dpr)) : 1;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      W = w; H = h;
    };

    // ——— Звёзды (массивы чисел, без выделения памяти) ———
    const X = new Float32Array(CAP), Y = new Float32Array(CAP), VX = new Float32Array(CAP), VY = new Float32Array(CAP);
    const AGE = new Float32Array(CAP), LIFE = new Float32Array(CAP), GRAV = new Float32Array(CAP), DRAG = new Float32Array(CAP);
    const TAIL = new Float32Array(CAP), WID = new Float32Array(CAP), PH = new Float32Array(CAP), FR = new Float32Array(CAP);
    const COL = new Uint8Array(CAP), KIND = new Uint8Array(CAP);
    let n = 0;
    const kill = (i: number) => {
      const l = --n;
      if (i === l) return;
      X[i] = X[l]!; Y[i] = Y[l]!; VX[i] = VX[l]!; VY[i] = VY[l]!; AGE[i] = AGE[l]!; LIFE[i] = LIFE[l]!; GRAV[i] = GRAV[l]!; DRAG[i] = DRAG[l]!;
      TAIL[i] = TAIL[l]!; WID[i] = WID[l]!; PH[i] = PH[l]!; FR[i] = FR[l]!; COL[i] = COL[l]!; KIND[i] = KIND[l]!;
    };
    const star = (x: number, y: number, vx: number, vy: number, life: number, col: number, kind: Kind, grav: number, drag: number, tail: number, w: number, fr = 0, age = 0) => {
      if (n >= CAP) return;
      const i = n++;
      X[i] = x; Y[i] = y; VX[i] = vx; VY[i] = vy; AGE[i] = age; LIFE[i] = life; COL[i] = col; KIND[i] = kind;
      GRAV[i] = grav; DRAG[i] = drag; TAIL[i] = tail; WID[i] = w; FR[i] = fr; PH[i] = rng() * 6.283;
    };

    const rockets: Rocket[] = [];
    const glows: Glow[] = [];
    const queue: Array<{ at: number; run: () => void }> = [];
    const recent: Array<{ x: number; y: number; at: number }> = [];
    let T = 0, nextEvent = 0.15, nextBarrage = rnd(6, 11), barrageEnd = -1, finalDone = true;
    let flash = 0, flashCol = C_WARM, energy = 0, bright = 1, brightAt = -1e9;
    let peak = 0, sumParts = 0, sumFrames = 0, frameMs = 0, burstsLive = 0;
    /** Когда каждый разрыв перестанет быть виден (для счёта «сколько разрывов на экране сейчас»). */
    const burstEnds: number[] = [];
    const SEE: Record<ShellType, number> = { chrys: 2.6, peony: 2.1, ring: 2.2, ring2: 2.2, palm: 3, willow: 4.2, rain: 3.4, spiral: 2.3, crossette: 2.1, strobe: 3 };
    const stats = { cap: CAP, parts: 0, peak: 0, avgParts: 0, bursts: 0, frameMs: 0, frames: 0, barrage: false, T: 0, rockets: 0 };
    if (winRef.current.debug) (window as unknown as { __victoryFx?: unknown }).__victoryFx = stats;

    // ——— Пересчёт «пикселей экрана» в единицы карты ———
    // В обычных пределах (0,3–3) размер на экране не зависит от приближения; за ними растёт мягче карты.
    const kEff = (k: number) => (k < 0.3 ? 0.3 : k <= 3 ? k : 3 * Math.pow(k / 3, 0.6));
    const screenU = () => Math.min(2.1, Math.max(0.9, Math.min(CW, CH) / 390));
    const worldOf = (sx: number, sy: number) => { const v = vpRef.current.viewRef.current; return { x: (sx - v.tx) / v.k, y: (sy - v.ty) / v.k }; };
    const screenOf = (wx: number, wy: number) => { const v = vpRef.current.viewRef.current; return { x: wx * v.k + v.tx, y: wy * v.k + v.ty }; };

    // ——— Спрайты зарева (по цвету, лениво) ———
    const sprites: Array<HTMLCanvasElement | undefined> = [];
    const sprite = (c: number) => {
      let s = sprites[c];
      if (s) return s;
      s = document.createElement("canvas"); s.width = s.height = 64;
      const g = s.getContext("2d")!, [h, sat, l] = COLORS[c]!;
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, `hsla(${h},${Math.min(100, sat)}%,${Math.min(96, l + 22)}%,1)`);
      gr.addColorStop(0.3, `hsla(${h},${sat}%,${l}%,.55)`);
      gr.addColorStop(1, `hsla(${h},${sat}%,${l}%,0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      sprites[c] = s;
      return s;
    };
    const addGlow = (x: number, y: number, r: number, life: number, col: number, a: number) => { if (glows.length < MAX_GLOWS) glows.push({ x, y, r, age: 0, life, col, a }); };

    // ——— Виды разрывов ———
    // R — радиус разрыва в пикселях экрана, u — единиц карты на пиксель, fill — доля звёзд при близком потолке.
    const speedFor = (R: number, drag: number, life: number) => (R * drag) / (1 - Math.exp(-drag * life * 0.85));
    const budget = () => Math.max(0.35, Math.min(1, (CAP - 150 - n) / (CAP - SOFT + 450)));
    const fillOf = () => (n < SOFT ? 1 : budget());
    /** Направления с поверхности шара, видимые сбоку: круг получается плотным у края, как у настоящего разрыва. */
    const sphere = (cnt: number, speed: number, u: number, f: (vx: number, vy: number, r: number) => void) => {
      for (let i = 0; i < cnt; i++) {
        const c = rnd(-1, 1), r = Math.sqrt(1 - c * c), a = rnd(0, 6.2832), v = speed * rnd(0.97, 1.03) * u;
        f(Math.cos(a) * v * r, Math.sin(a) * v * r, r);
      }
    };

    const explode = (sh: Rocket, cx: number, cy: number) => {
      const u = 1 / kEff(vpRef.current.viewRef.current.k), R = sh.R, fill = fillOf();
      const { c1, c2 } = sh;
      const cnt = (base: number) => Math.max(18, Math.round(base * Math.pow(R / 150, 0.8) * fill));
      const gU = (px: number) => px * u;
      switch (sh.type) {
        case "chrys": {
          const life = rnd(2.2, 2.9), drag = 1.7, v0 = speedFor(R, drag, life), pistil = rng() < 0.5;
          sphere(cnt(210), v0, u, (vx, vy, r) => {
            const inner = pistil && r < 0.42;
            star(cx, cy, vx, vy, life * rnd(0.92, 1.08), inner ? c2 : rng() < 0.18 ? c2 : c1, 0, gU(70), drag, 0.3, R > 150 ? 2.8 : 2.2, rng() < 0.3 ? rnd(14, 26) : 0);
          });
          break;
        }
        case "peony": {
          const life = rnd(1.7, 2.2), drag = 2.1, v0 = speedFor(R, drag, life);
          sphere(cnt(230), v0, u, (vx, vy) => star(cx, cy, vx, vy, life * rnd(0.92, 1.08), rng() < 0.2 ? c2 : c1, 0, gU(45), drag, 0.06, 3.6, rng() < 0.2 ? rnd(16, 28) : 0));
          break;
        }
        case "ring": case "ring2": {
          const rings = sh.type === "ring2" ? 2 : 1;
          for (let k = 0; k < rings; k++) {
            const RR = R * (k ? 0.55 : 1), life = rnd(1.9, 2.4), drag = 1.9, v0 = speedFor(RR, drag, life), tilt = rnd(0.35, 1), rot = rnd(0, 3.1416), cr = Math.cos(rot), sr = Math.sin(rot);
            const m = Math.round((34 + RR / 3.5) * Math.max(0.6, fill)), col = k ? c2 : c1, off = rnd(0, 6.28);
            for (let i = 0; i < m; i++) {
              const a = off + (i / m) * 6.2832 + rnd(-0.03, 0.03), ex = Math.cos(a) * v0 * u, ey = Math.sin(a) * v0 * u * tilt;
              star(cx, cy, ex * cr - ey * sr, ex * sr + ey * cr, life * rnd(0.95, 1.05), col, 0, gU(40), drag, 0.18, 3.2);
            }
          }
          if (rng() < 0.5) star(cx, cy, 0, 0, 0.5, C_WARM, 0, 0, 0, 0, 7);
          break;
        }
        case "palm": {
          const arms = Math.round(rnd(7, 10)), per = Math.max(4, Math.round(8 * fill)), life = rnd(2.6, 3.2), drag = 1.2, v0 = speedFor(R, drag, life * 0.8), off = rnd(0, 6.28);
          const col = rng() < 0.6 ? C_GOLD : c1;
          for (let a = 0; a < arms; a++) {
            const ang = off + (a / arms) * 6.2832 + rnd(-0.08, 0.08);
            for (let j = 0; j < per; j++) {
              const v = v0 * (0.5 + 0.5 * (j / per)) * rnd(0.96, 1.02) * u;
              star(cx, cy, Math.cos(ang) * v, Math.sin(ang) * v - gU(26), life * rnd(0.92, 1.05), j % 3 === 0 ? C_WARM : col, 0, gU(125), drag, 0.4, 3.4, j % 2 ? rnd(14, 24) : 0);
            }
          }
          break;
        }
        case "willow": {
          const life = rnd(3.8, 4.8), drag = 1.5, v0 = speedFor(R * 0.78, drag, life * 0.5);
          sphere(cnt(170), v0, u, (vx, vy) => star(cx, cy, vx, vy, life * rnd(0.85, 1.1), rng() < 0.85 ? C_GOLD : C_AMBER, 6, gU(52), drag, 0.6, 2.1));
          break;
        }
        case "rain": {
          const m = cnt(150);
          for (let i = 0; i < m; i++) {
            star(cx + rnd(-1.15, 1.15) * R * u, cy + rnd(-0.35, 0.1) * R * u, rnd(-6, 6) * u, rnd(-34, 8) * u, rnd(2.5, 3.8), rng() < 0.82 ? C_GOLD : C_WARM, 6, gU(40), 0.4, 0.65, 1.9, 0, -rnd(0, 1.1));
          }
          break;
        }
        case "spiral": {
          const arms = Math.round(rnd(3, 4)), per = Math.max(10, Math.round(26 * fill)), life = rnd(2, 2.5), drag = 1.8, v0 = speedFor(R, drag, life);
          const spin = rnd(1.3, 2.1) * Math.PI * (rng() < 0.5 ? -1 : 1), off = rnd(0, 6.28);
          for (let a = 0; a < arms; a++) {
            for (let j = 1; j <= per; j++) {
              const f = j / per, ang = off + (a / arms) * 6.2832 + f * spin, v = v0 * (0.12 + 0.88 * f) * u;
              star(cx, cy, Math.cos(ang) * v, Math.sin(ang) * v, life * rnd(0.95, 1.05), a % 2 ? c2 : c1, 0, gU(35), drag, 0.14, 3.2);
            }
          }
          break;
        }
        case "crossette": {
          const m = Math.round(rnd(9, 13) * Math.max(0.6, fill)), life = rnd(0.95, 1.2), drag = 1.5, v0 = speedFor(R * 0.58, drag, life), off = rnd(0, 6.28);
          for (let i = 0; i < m; i++) {
            const a = off + (i / m) * 6.2832 + rnd(-0.05, 0.05);
            star(cx, cy, Math.cos(a) * v0 * u, Math.sin(a) * v0 * u, life, i % 2 ? c2 : c1, 3, gU(30), drag, 0.22, 3.8);
          }
          break;
        }
        case "strobe": {
          const life = rnd(2.7, 3.4), drag = 1.1, v0 = speedFor(R, drag, life * 0.9);
          sphere(cnt(110), v0, u, (vx, vy) => {
            if (rng() < 0.28) star(cx, cy, vx, vy, life * 0.7, c1, 0, gU(26), drag, 0.2, 2.6);
            else star(cx, cy, vx, vy, life * rnd(0.85, 1.1), rng() < 0.5 ? C_WHITE : C_GOLD, 1, gU(26), drag, 0, 3.4, rnd(6, 11));
          });
          break;
        }
      }
      // Зарево и вспышка: вспышка в центре всегда, зарево и подсветка всей карты — у крупных.
      addGlow(cx, cy, R * u * 0.45, 0.22, C_WARM, 0.95);
      if (R > 100 * screenU()) addGlow(cx, cy, R * u * 1.25, 0.9, c1, Math.min(0.42, 0.12 + R / 900));
      if (sh.big > 0) { flash = Math.max(flash, sh.big); flashCol = c1; }
      burstEnds.push(T + SEE[sh.type]);
      recent.push({ x: cx, y: cy, at: T }); if (recent.length > 8) recent.shift();
    };

    // ——— Ракеты ———
    const launch = (tsx: number, tsy: number, fromSx: number, fromSy: number, type: ShellType, Rpx: number, c1: number, c2: number, big = 0, delay = 0) => {
      const go = () => {
        if (rockets.length >= MAX_ROCKETS) return;
        const t = worldOf(tsx, tsy), s = worldOf(fromSx, fromSy), dist = Math.hypot(tsx - fromSx, tsy - fromSy);
        rockets.push({ sx: s.x, sy: s.y, tx: t.x, ty: t.y, T: 0.5 + Math.min(0.55, dist / 1500) + rnd(0, 0.08), age: 0, type, R: Rpx, c1, c2, big });
      };
      if (delay <= 0) go(); else queue.push({ at: T + delay, run: go });
    };

    // ——— Выбор вида и цветов ———
    type Cls = "small" | "medium" | "large" | "huge";
    const radius = (c: Cls) => {
      const u = screenU();
      return (c === "small" ? rnd(55, 85) : c === "medium" ? rnd(95, 140) : c === "large" ? rnd(150, 215) : rnd(235, 315)) * u;
    };
    const bigOf = (c: Cls) => (c === "huge" ? 0.75 : c === "large" ? 0.38 : 0);
    const typeFor = (c: Cls): ShellType => {
      const pool: ShellType[] = c === "small" ? ["peony", "peony", "chrys", "ring", "strobe"]
        : c === "medium" ? ["chrys", "chrys", "peony", "ring", "ring2", "crossette", "strobe", "spiral", "willow"]
        : c === "large" ? ["chrys", "chrys", "ring2", "palm", "willow", "willow", "crossette", "spiral", "strobe", "rain"]
        : ["chrys", "willow", "willow", "palm", "palm", "ring2", "rain", "crossette"];
      return pick(pool);
    };
    const pickClass = (barrage: boolean): Cls => {
      const r = rng();
      if (barrage) return r < 0.1 ? "small" : r < 0.42 ? "medium" : r < 0.82 ? "large" : "huge";
      return r < 0.18 ? "small" : r < 0.55 ? "medium" : r < 0.88 ? "large" : "huge";
    };
    const colors = (type: ShellType): [number, number] => {
      if (type === "willow" || type === "rain") return [C_GOLD, C_AMBER];
      if (type === "palm") return [rng() < 0.5 ? C_GOLD : pick(CHROMA), C_WARM];
      const a = pick(CHROMA);
      let b = pick(CHROMA);
      if (b === a) b = rng() < 0.5 ? C_WARM : C_GOLD;
      return rng() < 0.4 ? [a, b] : [a, rng() < 0.5 ? C_WARM : C_WHITE];
    };

    /** Место разрыва: из нескольких случайных точек экрана берётся самая далёкая от недавних разрывов — салют ложится по всей карте. */
    const spot = (mx = 0.09, my = 0.09): { x: number; y: number } => {
      let best = { x: CW / 2, y: CH / 2 }, bestD = -1;
      const rs = recent.map((r) => screenOf(r.x, r.y));
      for (let i = 0; i < 7; i++) {
        const p = { x: rnd(CW * mx, CW * (1 - mx)), y: rnd(CH * my, CH * (1 - my)) };
        let d = 1e9;
        for (const q of rs) d = Math.min(d, Math.hypot(p.x - q.x, p.y - q.y));
        if (d > bestD) { bestD = d; best = p; }
      }
      return best;
    };
    const visibleAnchors = () => {
      const out: Array<{ x: number; y: number }> = [];
      for (const a of anchorsRef.current ?? []) { const s = screenOf(a.x, a.y); if (s.x > CW * 0.06 && s.x < CW * 0.94 && s.y > CH * 0.3 && s.y < CH * 0.96) out.push(s); }
      return out;
    };

    // ——— Залпы ———
    const single = (barrage: boolean, cls = pickClass(barrage), delay = 0) => {
      const type = typeFor(cls), [c1, c2] = colors(type), R = radius(cls);
      const as = rng() < 0.25 ? visibleAnchors() : [];
      if (as.length) {
        const a = pick(as), up = Math.max(R * 0.7, CH * rnd(0.14, 0.3));
        launch(a.x + rnd(-8, 8), a.y - up, a.x, a.y, type, R, c1, c2, bigOf(cls), delay);
      } else {
        const p = spot(), fromY = Math.min(CH * 1.04, p.y + CH * rnd(0.2, 0.42));
        launch(p.x, p.y, p.x + rnd(-0.05, 0.05) * CW, fromY, type, R, c1, c2, bigOf(cls), delay);
      }
    };
    /** Веер: несколько ракет из одной точки внизу расходятся лучами и лопаются на разной высоте. */
    const fan = (barrage: boolean) => {
      const m = Math.round(rnd(3, barrage ? 7 : 6)), lx = rnd(0.2, 0.8) * CW, ly = CH * rnd(0.9, 1.04), step = rnd(0.2, 0.36);
      const cls: Cls = barrage ? (rng() < 0.5 ? "large" : "medium") : (rng() < 0.7 ? "medium" : "large");
      const type = typeFor(cls), mono = rng() < 0.5, base = colors(type);
      for (let i = 0; i < m; i++) {
        const k = i - (m - 1) / 2, ang = -Math.PI / 2 + k * step, len = CH * (0.34 + 0.26 * Math.cos((k / Math.max(1, m)) * 1.6)) * rnd(0.92, 1.08);
        const t2 = mono ? type : typeFor(cls), [a, b] = mono ? base : colors(t2);
        launch(lx + Math.cos(ang) * len, ly + Math.sin(ang) * len, lx, ly, t2, radius(cls) * rnd(0.85, 1), a, b, 0, i * 0.045);
      }
    };
    /** Бегущая волна: ряд разрывов слева направо (или обратно), от малых к большим. */
    const wave = (barrage: boolean) => {
      const m = Math.round(rnd(5, barrage ? 9 : 8)), dir = rng() < 0.5 ? 1 : -1, y0 = rnd(0.25, 0.62) * CH, grow = rng() < 0.5, type = typeFor("medium");
      const [c1, c2] = colors(type), rainbow = rng() < 0.4, h0 = Math.floor(rng() * CHROMA.length);
      for (let i = 0; i < m; i++) {
        const f = i / (m - 1), x = (dir > 0 ? 0.08 + 0.84 * f : 0.92 - 0.84 * f) * CW, cls: Cls = grow ? (f < 0.4 ? "small" : f < 0.85 ? "medium" : "large") : "medium";
        const col = rainbow ? CHROMA[(h0 + i) % CHROMA.length]! : c1;
        launch(x, y0 + Math.sin(f * 6) * CH * 0.05, x + rnd(-10, 10), CH * 1.03, i % 4 === 3 ? "ring" : type === "willow" ? "chrys" : type, radius(cls), col, c2, 0, i * 0.12);
      }
    };
    const pair = (barrage: boolean) => {
      const cls = pickClass(barrage), type = typeFor(cls), [c1, c2] = colors(type), cx = rnd(0.35, 0.65) * CW, y = rnd(0.2, 0.7) * CH, d = rnd(0.16, 0.32) * CW, R = radius(cls);
      for (const s of [-1, 1]) launch(cx + s * d, y, cx + s * d * 1.2, CH * 1.03, type, R, c1, c2, bigOf(cls) * 0.6, 0);
    };
    const event = (barrage: boolean) => {
      const r = rng();
      if (barrage) { if (r < 0.34) fan(true); else if (r < 0.56) wave(true); else if (r < 0.7) pair(true); else single(true); return; }
      if (r < 0.5) single(false); else if (r < 0.72) fan(false); else if (r < 0.84) pair(false); else wave(false);
    };
    /** Финальный аккорд канонады: ряд огромных разрывов через весь экран и золотые дожди. */
    const grand = () => {
      const m = Math.max(5, Math.min(8, Math.round(CW / 62))), types: ShellType[] = ["willow", "chrys", "palm", "ring2", "willow", "chrys", "palm", "rain"];
      for (let i = 0; i < m; i++) {
        const f = (i + 0.5) / m, x = f * CW, y = CH * (0.34 + 0.2 * Math.sin(f * Math.PI) * (i % 2 ? 0.7 : -0.5) + rnd(-0.04, 0.04)), t = types[i % types.length]!, [a, b] = colors(t);
        launch(x, y, x + rnd(-14, 14), CH * 1.04, t, radius("huge") * rnd(0.9, 1.25), a, b, 1, i * 0.05);
      }
      const t = pick(["chrys", "willow"] as const), [a, b] = colors(t);
      launch(CW / 2, CH * 0.42, CW / 2, CH * 1.05, t, radius("huge") * 1.35, a, b, 1, 0.5);
      single(true, "huge", 0.85);
    };

    // ——— Распорядитель ———
    const direct = (dt: number) => {
      T += dt;
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.at <= T) { const q = queue[i]!; queue.splice(i, 1); q.run(); }
      if (stopping) return;
      if (barrageEnd < 0 && T >= nextBarrage) { barrageEnd = T + rnd(3.2, 4.8); finalDone = false; }
      const barrage = barrageEnd > 0;
      if (barrage && !finalDone && T >= barrageEnd - 0.7) { finalDone = true; grand(); }
      if (barrage && T >= barrageEnd) { barrageEnd = -1; nextBarrage = T + rnd(20, 40); nextEvent = Math.max(nextEvent, T + 1.4); }
      if (T < nextEvent) return;
      if (barrage && T >= barrageEnd - 0.7) { nextEvent = T + 0.25; return; }
      event(barrage);
      nextEvent = T + (barrage ? rnd(0.12, 0.3) : rnd(1, 2.2));
      // Ракет много, а звёзд почти потолок — не добавляем новых залпов, пока не освободится место.
      if (n > CAP - 300) nextEvent = T + 0.6;
    };

    // ——— Шаг и рисование ———
    const buckets: number[][] = Array.from({ length: NB }, () => []);
    const bidx = (thick: number, hot: number, col: number, a: number) => ((thick * 2 + hot) * NC + col) * NA + a;
    const seg = (b: number, x0: number, y0: number, x1: number, y1: number) => { const s = buckets[b]!; s.push(x0, y0, x1, y1); };
    const alphaLevel = (a: number) => (a >= 0.95 ? 0 : Math.min(NA - 1, Math.max(0, Math.round((1 - a) * 7.6))));
    const fx = { vx0: 0, vx1: 0, vy0: 0, vy1: 0 };

    const step = (dt: number) => {
      for (let i = n - 1; i >= 0; i--) {
        const age = AGE[i]! + dt; AGE[i] = age;
        if (age < 0) continue;
        if (age >= LIFE[i]!) {
          if (KIND[i] === 3 && n < CAP - 8) {
            const rot = rng() * 1.5708, x = X[i]!, y = Y[i]!, c = COL[i]!, u = 1 / kEff(vpRef.current.viewRef.current.k), v = speedFor(30, 2, 0.8) * u;
            for (let q = 0; q < 4; q++) { const a = rot + q * 1.5708; star(x, y, Math.cos(a) * v + VX[i]! * 0.15, Math.sin(a) * v + VY[i]! * 0.15, rnd(0.7, 0.95), c === C_WARM ? C_GOLD : c, 0, GRAV[i]!, 2, 0.16, 2.6, 0); }
            addGlow(x, y, 22 * u, 0.18, C_WARM, 0.6);
          }
          kill(i);
          continue;
        }
        const d = 1 - Math.min(0.9, DRAG[i]! * dt);
        const vx = VX[i]! * d, vy = VY[i]! * d + GRAV[i]! * dt;
        VX[i] = vx; VY[i] = vy; X[i] = X[i]! + vx * dt; Y[i] = Y[i]! + vy * dt;
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]!; r.age += dt;
        const f = Math.min(1, r.age / r.T), e = 1 - Math.pow(1 - f, 2.2), x = r.sx + (r.tx - r.sx) * e, y = r.sy + (r.ty - r.sy) * e;
        if (f >= 1) { rockets.splice(i, 1); explode(r, r.tx, r.ty); continue; }
        // Искры за ракетой: одна-две на кадр, падают и гаснут.
        const u = 1 / kEff(vpRef.current.viewRef.current.k);
        if (n < SOFT) { star(x, y, rnd(-14, 14) * u, rnd(8, 34) * u, rnd(0.3, 0.55), rng() < 0.6 ? C_GOLD : C_WARM, 4, 90 * u, 1.2, 0, 1.6); }
      }
      for (let i = glows.length - 1; i >= 0; i--) { const g = glows[i]!; g.age += dt; if (g.age >= g.life) glows.splice(i, 1); }
      flash *= Math.exp(-dt * 4.5);
      if (flash < 0.01) flash = 0;
      for (let i = burstEnds.length - 1; i >= 0; i--) if (burstEnds[i]! < T) burstEnds.splice(i, 1);
      burstsLive = burstEnds.length;
    };

    const draw = () => {
      const v = vpRef.current.viewRef.current, k = v.k, tx = v.tx, ty = v.ty, ke = kEff(k);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      // Притемнение днём: на светлой воде и песке искры теряются; ночью притемнения нет.
      const veil = energy * 0.22 * bright;
      if (veil > 0.004) { ctx.fillStyle = `rgba(8,10,36,${veil.toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
      ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
      ctx.globalCompositeOperation = "lighter";
      const mg = 140 / k;
      fx.vx0 = -tx / k - mg; fx.vx1 = (CW - tx) / k + mg; fx.vy0 = -ty / k - mg; fx.vy1 = (CH - ty) / k + mg;
      // Зарево разрывов.
      for (const g of glows) {
        if (g.x < fx.vx0 - g.r || g.x > fx.vx1 + g.r || g.y < fx.vy0 - g.r || g.y > fx.vy1 + g.r) continue;
        const t = g.age / g.life;
        ctx.globalAlpha = g.a * (1 - t) * (1 - t);
        ctx.drawImage(sprite(g.col), g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
      }
      ctx.globalAlpha = 1;
      // Вспышка всей карты у огромных разрывов: мягкая, не резче ~0,1 прозрачности и затухает за полсекунды.
      if (flash > 0.02) {
        const [h, s, l] = COLORS[flashCol]!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `hsla(${h},${Math.min(80, s)}%,${l}%,${(flash * 0.08).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
        ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
      }
      // Ракеты: яркая головка с ореолом, короткое тело и длинный бледный хвост.
      for (const r of rockets) {
        const f = Math.min(1, r.age / r.T), ease = (q: number) => 1 - Math.pow(1 - Math.max(0, q), 2.2);
        const e = ease(f), e1 = ease(f - 0.05), e2 = ease(f - 0.16);
        const x = r.sx + (r.tx - r.sx) * e, y = r.sy + (r.ty - r.sy) * e;
        if (x < fx.vx0 || x > fx.vx1 || y < fx.vy0 || y > fx.vy1) continue;
        const px = (q: number) => r.sx + (r.tx - r.sx) * q, py = (q: number) => r.sy + (r.ty - r.sy) * q;
        seg(bidx(0, 0, C_GOLD, 2), px(e1), py(e1), x, y);
        seg(bidx(0, 0, C_AMBER, 4), px(e2), py(e2), px(e1), py(e1));
        seg(bidx(1, 1, C_WARM, 0), x, y, x + 0.01, y);
      }
      // Звёзды — по вёдрам цвета и яркости: тело шлейфа (тонкая линия цвета звезды) и яркая головка с ореолом.
      for (let i = 0; i < n; i++) {
        const age = AGE[i]!;
        if (age < 0) continue;
        const x = X[i]!, y = Y[i]!;
        if (x < fx.vx0 || x > fx.vx1 || y < fx.vy0 || y > fx.vy1) continue;
        const life = LIFE[i]!, t = age / life, kind = KIND[i]!, col = COL[i]!, w = WID[i]!;
        let a: number;
        if (kind === 6) a = 1 - t * t * t; // ветвь ивы и дождя держит яркость почти до конца
        else if (kind === 4) a = (1 - t) * (1 - t);
        else a = Math.pow(1 - t, 1.15);
        const fr = FR[i]!;
        if (kind === 1) { if (((age * fr + PH[i]! / 6.2832) % 1) > 0.34) continue; a = Math.max(a, 0.55); }
        else if (fr > 0 && t > 0.35) a *= 0.45 + 0.55 * Math.sin(age * fr + PH[i]!);
        else if (kind === 6 && fr > 0) a *= 0.8 + 0.2 * Math.sin(age * fr * 3 + PH[i]!);
        if (a <= 0.04) continue;
        const al = alphaLevel(a), tl = Math.min(TAIL[i]!, age);
        if (tl > 0.02 && kind !== 1) {
          const vx = VX[i]!, vy = VY[i]!;
          seg(bidx(0, 0, col, Math.min(NA - 1, al + 1)), x - vx * tl, y - vy * tl, x, y);
          if (TAIL[i]! > 0.3 && age > 0.2) seg(bidx(0, 0, col, Math.min(NA - 1, al + 3)), x - vx * tl * 2.2, y - vy * tl * 2.2, x - vx * tl, y - vy * tl);
        }
        if (w >= 1.9) seg(bidx(1, t < 0.35 || kind === 1 ? 1 : 0, col, al), x, y, x + 0.01, y);
      }
      ctx.lineCap = "round";
      for (let b = 0; b < NB; b++) {
        const s = buckets[b]!;
        if (!s.length) continue;
        const a = b % NA, rest = (b - a) / NA, col = rest % NC, hh = (rest - col) / NC, hot = hh % 2, thick = (hh - hot) / 2;
        const [h, sat, l] = COLORS[col]!;
        ctx.strokeStyle = hot ? `hsla(${h},${Math.round(sat * 0.65)}%,86%,${ALPHAS[a]})` : `hsla(${h},${sat}%,${Math.min(78, l + 8)}%,${ALPHAS[a]})`;
        ctx.lineWidth = (thick ? 3 : 1.5) / ke;
        ctx.beginPath();
        for (let j = 0; j < s.length; j += 4) { ctx.moveTo(s[j]!, s[j + 1]!); ctx.lineTo(s[j + 2]!, s[j + 3]!); }
        ctx.stroke();
        // Ореол вокруг головок: тот же путь шире и совсем прозрачный — свечение без размытия.
        if (thick) { ctx.lineWidth = 10 / ke; ctx.globalAlpha = 0.11; ctx.stroke(); ctx.globalAlpha = 1; }
        s.length = 0;
      }
      ctx.globalCompositeOperation = "source-over";
    };

    // ——— Запуск и остановка цикла кадров ———
    const shouldBurn = () => victoryFxOn(winRef.current, clockRef.current(), tzRef.current);
    const under = coverGate();
    const reset = () => { n = 0; rockets.length = 0; glows.length = 0; queue.length = 0; burstEnds.length = 0; recent.length = 0; flash = 0; energy = 0; };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (under(now)) return; // карта под листом — lib/mapCover.ts; показ стоит и после листа не догоняет
      if (now - checked > 1000) {
        checked = now;
        const on = shouldBurn();
        if (on && stopping) stopping = false;
        else if (!on && !stopping) stopping = true;
        if (now - brightAt > 5000) { brightAt = now; bright = mapBrightness(tzRef.current, clockRef.current(), winRef.current.forceNight); }
      }
      if (now - last < FRAME_MS) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.033; last = now;
      const t0 = performance.now();
      energy += ((stopping ? 0 : 1) - energy) * Math.min(1, dt * (stopping ? 1.6 : 1.2));
      direct(dt);
      step(dt);
      if (stopping && n === 0 && rockets.length === 0 && glows.length === 0 && queue.length === 0 && energy < 0.02) { stop(); return; }
      draw();
      if (stats && winRef.current.debug) {
        const ms = performance.now() - t0; frameMs = frameMs ? frameMs * 0.9 + ms * 0.1 : ms;
        peak = Math.max(peak, n); sumParts += n; sumFrames++;
        stats.parts = n; stats.peak = peak; stats.avgParts = Math.round(sumParts / sumFrames); stats.bursts = burstsLive; stats.frameMs = Math.round(frameMs * 100) / 100; stats.frames = sumFrames; stats.barrage = barrageEnd > 0; stats.T = Math.round(T * 10) / 10; stats.rockets = rockets.length;
      }
    };
    const start = () => {
      if (running) return;
      running = true; stopping = false; last = 0; checked = -1e9; brightAt = -1e9;
      reset(); T = 0; nextEvent = 0.15; nextBarrage = rnd(6, 11); barrageEnd = -1; finalDone = true;
      sizeCanvas();
      raf = requestAnimationFrame(loop);
    };
    function stop() {
      cancelAnimationFrame(raf); raf = 0; running = false; stopping = false;
      ctx!.setTransform(1, 0, 0, 1, 0, 0); ctx!.clearRect(0, 0, W, H);
      reset(); sizeCanvas(); // холст сжимается до точки: пока салюта нет, он не занимает память
    }
    // Пока салюта нет, раз в 4 секунды проверяется только время (без кадров).
    const watch = () => { if (!running && shouldBurn()) start(); };
    const ro = new ResizeObserver(() => { readSize(); if (running) sizeCanvas(); });
    ro.observe(host); readSize(); sizeCanvas();
    watch();
    const timer = window.setInterval(watch, 4000);
    return () => { cancelAnimationFrame(raf); window.clearInterval(timer); ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className="fx-layer victory-fx" width={1} height={1} aria-hidden="true" />;
}
