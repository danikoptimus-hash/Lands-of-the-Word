import { useEffect, useRef } from "react";
import { coverGate } from "../lib/mapCover";
import { mapBrightness, victoryFxOn, type VictoryWindow } from "../lib/victoryFx";
import type { Viewport } from "./MapLayers";

/**
 * Салют победы над последней столицей (решение владельца 26.11: «невиданных масштабов салют по всей карте, очень сильный»;
 * первые сутки без остановки, вторые и третьи — только в игровую ночь). Не путать с `FireworksLayer` — тот горит над
 * городами, которые взяли сегодня; этот бьёт по всей видимой карте: над городами, руинами, сушей и морем.
 *
 * Чужой опыт (правило приёмки). Приёмы — из «Firework Simulator v2» Caleb Miller (CodePen MillerTime/XgpNwb, MIT) и из того,
 * как настоящий салют выглядит на фото с выдержкой:
 *  - салюту нужно тёмное небо: пока он идёт, карта под ним притемняется «ночной» вуалью (днём сильнее, ночью слабее);
 *  - шлейфы «с выдержкой»: отдельный холст следов, который каждый кадр не очищается, а гасится (`destination-out`), —
 *    звезда тянет за собой плавный сужающийся след сама, без нарисованных «палочек»;
 *  - звезда — светящаяся точка: заранее нарисованный спрайт-градиент по цвету (`drawImage`, без `shadowBlur`) и яркое ядро;
 *  - разрыв — шар: направления с поверхности сферы (круг плотнее у края), скорость подобрана под сопротивление воздуха,
 *    чтобы шар доходил ровно до нужного радиуса; сотни звёзд; смена цвета звёзд, «пестик» другого цвета;
 *  - ива и конский хвост — длинные золотые ветви с мерцанием, с которых сыплются искры; строб — мерцающие точки;
 *    кольцо — только вокруг шара («Сатурн»); искры за ракетой на подъёме; короткая вспышка цвета разрыва у ядра.
 * Код не копировался — только приёмы, всё написано заново под карту.
 *
 * Устройство. Вуаль — div под подписями городов; два холста над картой: следы (гасятся) и головки звёзд (чистятся
 * каждый кадр). Всё в координатах карты: разрыв остаётся на своём месте при сдвиге и зуме; когда карту двигают, холст
 * следов переносится вслед за ней одним `drawImage` (иначе следы остались бы на месте — ошибка «следы при зуме» 16.11).
 * Размер разрыва задаётся в пикселях экрана на момент разрыва при любом приближении: на общем виде карты разрывы так же
 * крупны, как вблизи. На большом экране разрывы крупнее и их больше (по площади экрана).
 *
 * Распорядитель — по собственным часам показа (`T`, растёт на кадр): под листом (`coverGate`) показ замирает и после него
 * не догоняет. Спокойно — разрыв-другой каждые полсекунды, на экране всегда 3–6 разрывов разной стадии. Раз в 18–28 с —
 * канонада 5–6 с: стена разрывов по всей ширине и финальный аккорд из огромных золотых ив.
 *
 * Скорость (памятка 16.11): всё на холсте, в слое меток ничего не движется; потолок 30 кадров; когда салюта нет (до победы,
 * после неё, днём вторых и третьих суток) — цикл кадров не крутится, холсты сжаты до точки, раз в 4 с проверяется только
 * время. Список звёзд и оба холста сбрасываются вместе. При `prefers-reduced-motion` салюта нет. Выключатель для
 * замеров — `perfOff("victory")`. Звука нет.
 */
export interface VictoryAnchor { x: number; y: number }

/** Сила «ночной» вуали над картой, пока бьёт салют: днём и ночью (между ними — по свету карты). */
export const VEIL_DAY = 0.5;
export const VEIL_NIGHT = 0.3;
/** Добавка к вуали в канонаду. */
const VEIL_BARRAGE = 0.07;

// ——— Палитра ———
// [оттенок, насыщенность %, яркость %].
const COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [44, 100, 62], [30, 100, 56], [0, 100, 62], [340, 100, 64], [318, 100, 70], [286, 95, 70], [258, 95, 74], [220, 100, 70], [198, 100, 64],
  [176, 100, 56], [148, 95, 58], [118, 90, 60], [70, 100, 58], [54, 100, 64], [20, 100, 60], [210, 30, 97], [42, 85, 90],
];
const NC = COLORS.length;
const C_GOLD = 0, C_AMBER = 1, C_WHITE = 15, C_WARM = 16;
const CHROMA: ReadonlyArray<number> = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // цвета разрывов (без белых и золота)
const ALPHAS = [1, 0.84, 0.68, 0.54, 0.41, 0.3, 0.2, 0.11] as const;
const NA = ALPHAS.length;

// ——— Пределы ———
const CAP_MAX = 6000;  // память под звёзды; рабочий потолок — `cap` по размеру экрана (телефон 3200)
const MAX_GLOWS = 24, MAX_ROCKETS = 48;
const FRAME_MS = 33;   // потолок кадров — 30 в секунду
const FADE = 0.24;     // гашение холста следов за кадр («выдержка» ~0,3 с)
const HALO_MAX = 1300; // ореолов-спрайтов на кадр не больше

/** Виды звёзд: 0 обычная, 1 строб, 4 искра (ракеты и капель), 6 ветвь ивы и хвоста, 7 голова пальмы. */
type Kind = 0 | 1 | 4 | 6 | 7;
type ShellType = "peony" | "chrys" | "willow" | "horsetail" | "palm" | "strobe" | "saturn";
interface Rocket { sx: number; sy: number; tx: number; ty: number; px: number; py: number; ax?: number; ay?: number; T: number; age: number; type: ShellType; R: number; c1: number; c2: number }
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
  /** Места городов в координатах карты: часть залпов уходит из них. */
  anchors?: ReadonlyArray<VictoryAnchor>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<HTMLCanvasElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  const winRef = useRef(win); winRef.current = win;
  const clockRef = useRef(clock); clockRef.current = clock;
  const tzRef = useRef(timeZone); tzRef.current = timeZone;
  const anchorsRef = useRef(anchors); anchorsRef.current = anchors;

  useEffect(() => {
    const canvas = ref.current, tcanvas = trailRef.current, veilEl = veilRef.current, host = canvas?.parentElement;
    if (!canvas || !tcanvas || !veilEl || !host) return;
    const ctx = canvas.getContext("2d"), tctx = tcanvas.getContext("2d");
    if (!ctx || !tctx || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const seedQ = /[?&]vseed=(\d+)/.exec(window.location.search)?.[1];
    const rng = seedQ ? mulberry(Number(seedQ)) : Math.random;
    const rnd = (a: number, b: number) => a + rng() * (b - a);
    const pick = <T,>(a: ReadonlyArray<T>): T => a[Math.floor(rng() * a.length)]!;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    // ——— Состояние холстов ———
    let CW = 0, CH = 0, W = 0, H = 0;
    let sizeU = 1, rateU = 1, cap = 3200, soft = 2600;
    let running = false, stopping = false, raf = 0, last = 0, checked = -1e9;
    /** Вид карты, под который сейчас нарисован холст следов. */
    let tk = 1, ttx = 0, tty = 0;
    let tmp: HTMLCanvasElement | null = null;
    const readSize = () => {
      CW = host.clientWidth; CH = host.clientHeight;
      const area = (CW * CH) / (390 * 844);
      sizeU = Math.min(1.6, Math.max(1, Math.sqrt(area) * 0.76));
      rateU = Math.min(2.2, Math.max(1, area / (sizeU * sizeU)));
      cap = Math.min(CAP_MAX, Math.round(3200 * rateU)); soft = Math.round(cap * 0.8);
    };
    const sizeCanvas = () => {
      const w = running ? Math.max(1, Math.round(CW * dpr)) : 1, h = running ? Math.max(1, Math.round(CH * dpr)) : 1;
      for (const c of [canvas, tcanvas]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      if (tmp && (tmp.width !== w || tmp.height !== h)) tmp = null;
      W = w; H = h;
    };

    // ——— Звёзды (массивы чисел, без выделения памяти) ———
    const X = new Float32Array(CAP_MAX), Y = new Float32Array(CAP_MAX), PX = new Float32Array(CAP_MAX), PY = new Float32Array(CAP_MAX);
    const VX = new Float32Array(CAP_MAX), VY = new Float32Array(CAP_MAX), AGE = new Float32Array(CAP_MAX), LIFE = new Float32Array(CAP_MAX);
    const GRAV = new Float32Array(CAP_MAX), DRAG = new Float32Array(CAP_MAX), WID = new Float32Array(CAP_MAX), PH = new Float32Array(CAP_MAX);
    const FR = new Float32Array(CAP_MAX), CHG = new Float32Array(CAP_MAX), GL = new Float32Array(CAP_MAX);
    const COL = new Uint8Array(CAP_MAX), COL2 = new Uint8Array(CAP_MAX), KIND = new Uint8Array(CAP_MAX), HALO = new Uint8Array(CAP_MAX);
    let n = 0;
    const kill = (i: number) => {
      const l = --n;
      if (i === l) return;
      X[i] = X[l]!; Y[i] = Y[l]!; PX[i] = PX[l]!; PY[i] = PY[l]!; VX[i] = VX[l]!; VY[i] = VY[l]!; AGE[i] = AGE[l]!; LIFE[i] = LIFE[l]!;
      GRAV[i] = GRAV[l]!; DRAG[i] = DRAG[l]!; WID[i] = WID[l]!; PH[i] = PH[l]!; FR[i] = FR[l]!; CHG[i] = CHG[l]!; GL[i] = GL[l]!;
      COL[i] = COL[l]!; COL2[i] = COL2[l]!; KIND[i] = KIND[l]!; HALO[i] = HALO[l]!;
    };
    /** Новая звезда; `w` — размер головки в пикселях экрана, `col2`/`chg` — смена цвета на доле жизни `chg`. */
    const star = (x: number, y: number, vx: number, vy: number, life: number, col: number, kind: Kind, grav: number, drag: number, w: number,
      o?: { fr?: number; col2?: number; chg?: number; gl?: number; age?: number }) => {
      if (n >= cap) return;
      const i = n++;
      X[i] = x; Y[i] = y; PX[i] = x; PY[i] = y; VX[i] = vx; VY[i] = vy; AGE[i] = o?.age ?? 0; LIFE[i] = life; COL[i] = col; KIND[i] = kind;
      GRAV[i] = grav; DRAG[i] = drag; WID[i] = w; FR[i] = o?.fr ?? 0; COL2[i] = o?.col2 ?? col; CHG[i] = o?.chg ?? 0; GL[i] = o?.gl ?? 0;
      PH[i] = rng() * 6.283; HALO[i] = Math.floor(rng() * 4);
    };

    const rockets: Rocket[] = [];
    const glows: Glow[] = [];
    const queue: Array<{ at: number; run: () => void }> = [];
    const recent: Array<{ x: number; y: number; at: number }> = [];
    let lastEnd = -1e9, T = 0, nextEvent = 0.1, nextBarrage = rnd(7, 11), barrageEnd = -1, finalDone = true;
    let energy = 0, barrageE = 0, bright = 1, brightAt = -1e9, veilNow = -1;
    let peak = 0, sumParts = 0, sumFrames = 0, frameMs = 0, burstsLive = 0, peakBursts = 0;
    /** Когда каждый разрыв перестанет быть виден (для счёта «сколько разрывов на экране сейчас»). */
    const burstEnds: number[] = [];
    const SEE: Record<ShellType, number> = { peony: 2.2, chrys: 2.8, willow: 4.2, horsetail: 3.4, palm: 3, strobe: 3, saturn: 2.4 };
    const stats = { cap: 3200, parts: 0, peak: 0, avgParts: 0, bursts: 0, peakBursts: 0, frameMs: 0, frames: 0, barrage: false, calm: false, T: 0, rockets: 0, veil: 0 };
    if (winRef.current.debug) (window as unknown as { __victoryFx?: unknown }).__victoryFx = stats;

    const view = () => vpRef.current.viewRef.current;
    const worldOf = (sx: number, sy: number) => { const v = view(); return { x: (sx - v.tx) / v.k, y: (sy - v.ty) / v.k }; };
    const screenOf = (wx: number, wy: number) => { const v = view(); return { x: wx * v.k + v.tx, y: wy * v.k + v.ty }; };

    // ——— Спрайты: светящаяся точка цвета (ядро почти белое, мягкий ореол) ———
    const sprites: Array<HTMLCanvasElement | undefined> = [];
    const sprite = (c: number) => {
      let s = sprites[c];
      if (s) return s;
      s = document.createElement("canvas"); s.width = s.height = 48;
      const g = s.getContext("2d")!, [h, sat, l] = COLORS[c]!;
      const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
      gr.addColorStop(0, `hsla(${h},${sat}%,${Math.min(98, l + 32)}%,1)`);
      gr.addColorStop(0.16, `hsla(${h},${sat}%,${Math.min(92, l + 14)}%,.85)`);
      gr.addColorStop(0.42, `hsla(${h},${sat}%,${l}%,.28)`);
      gr.addColorStop(1, `hsla(${h},${sat}%,${l}%,0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 48, 48);
      sprites[c] = s;
      return s;
    };
    const addGlow = (x: number, y: number, r: number, life: number, col: number, a: number) => { if (glows.length < MAX_GLOWS) glows.push({ x, y, r, age: 0, life, col, a }); };

    // ——— Виды разрывов ———
    // R — радиус разрыва в пикселях экрана, u — единиц карты на пиксель, fill — доля звёзд при близком потолке.
    const speedFor = (R: number, drag: number, life: number) => (R * drag) / (1 - Math.exp(-drag * life * 0.85));
    const fillOf = () => (n < soft ? 1 : Math.max(0.3, (cap - 200 - n) / (cap - soft)));
    /** Направления с поверхности шара, видимые сбоку: круг получается плотным у края, как у настоящего разрыва. */
    const sphere = (cnt: number, speed: number, f: (vx: number, vy: number, r: number) => void) => {
      for (let i = 0; i < cnt; i++) {
        const c = rnd(-1, 1), r = Math.sqrt(1 - c * c), a = rnd(0, 6.2832), v = speed * rnd(0.96, 1.04);
        f(Math.cos(a) * v * r, Math.sin(a) * v * r, r);
      }
    };

    const explode = (sh: Rocket, cx: number, cy: number) => {
      const u = 1 / view().k, R = sh.R, fill = fillOf(), { c1, c2 } = sh;
      const cnt = (base: number) => Math.max(50, Math.round(base * Math.pow(R / (90 * sizeU), 0.7) * fill));
      const g = (px: number) => px * u; // пиксели экрана → карта
      switch (sh.type) {
        case "peony": case "saturn": {
          const life = rnd(1.9, 2.4), drag = 2.1, v0 = speedFor(R, drag, life) * u;
          const change = rng() < 0.4, pistil = sh.type === "peony" && rng() < 0.35, two = !change && !pistil && rng() < 0.4;
          sphere(cnt(230), v0, (vx, vy) => star(cx, cy, vx, vy, life * rnd(0.9, 1.08), two && rng() < 0.5 ? c2 : c1, 0, g(48), drag, 2.6,
            change ? { col2: c2, chg: rnd(0.42, 0.55) } : undefined));
          if (pistil) sphere(cnt(70), v0 * 0.45, (vx, vy) => star(cx, cy, vx, vy, life * 0.8, c2, 0, g(40), drag, 2.4));
          if (sh.type === "saturn") {
            const m = Math.round(70 * Math.max(0.6, fill)), tilt = rnd(0.2, 0.4), rot = rnd(-0.6, 0.6), cr = Math.cos(rot), sr = Math.sin(rot), off = rnd(0, 6.28);
            for (let i = 0; i < m; i++) {
              const a = off + (i / m) * 6.2832, ex = Math.cos(a) * v0 * 1.35, ey = Math.sin(a) * v0 * 1.35 * tilt;
              star(cx, cy, ex * cr - ey * sr, ex * sr + ey * cr, life * rnd(0.95, 1.05), c2, 0, g(48), drag, 2.6);
            }
          }
          break;
        }
        case "chrys": {
          const life = rnd(2.4, 3), drag = 1.7, v0 = speedFor(R, drag, life) * u;
          sphere(cnt(250), v0, (vx, vy) => {
            const glit = rng() < 0.45;
            star(cx, cy, vx, vy, life * rnd(0.9, 1.08), rng() < 0.15 ? c2 : c1, 0, g(62), drag, 2.3, glit ? { fr: rnd(16, 26), gl: rng() < 0.5 ? 1.2 : 0 } : undefined);
          });
          break;
        }
        case "willow": {
          const life = rnd(3.6, 4.6), drag = 2.6, v0 = speedFor(R * 0.9, drag, life * 0.55) * u;
          sphere(cnt(200), v0, (vx, vy) => star(cx, cy, vx, vy, life * rnd(0.85, 1.1), rng() < 0.82 ? C_GOLD : C_AMBER, 6, g(64), drag, 2.2,
            { fr: rnd(10, 18), gl: rng() < 0.4 ? 1.4 : 0 }));
          break;
        }
        case "horsetail": {
          const m = cnt(170), life = rnd(3, 3.8), drag = 1.4, v0 = speedFor(R * 0.8, drag, 1.2) * u;
          for (let i = 0; i < m; i++) {
            const a = rnd(-Math.PI * 0.96, -Math.PI * 0.04), v = v0 * rnd(0.35, 1);
            star(cx, cy, Math.cos(a) * v, Math.sin(a) * v, life * rnd(0.8, 1.05), rng() < 0.85 ? C_GOLD : C_WARM, 6, g(120), drag, 2.1, { fr: rnd(10, 16), gl: rng() < 0.35 ? 1.3 : 0 });
          }
          break;
        }
        case "palm": {
          const arms = Math.round(rnd(7, 10)), life = rnd(2.6, 3.2), drag = 1.3, v0 = speedFor(R, drag, life * 0.8) * u, off = rnd(0, 6.28);
          const col = rng() < 0.6 ? C_GOLD : c1;
          for (let a = 0; a < arms; a++) {
            const ang = off + (a / arms) * 6.2832 + rnd(-0.08, 0.08), ca = Math.cos(ang), sa = Math.sin(ang);
            star(cx, cy, ca * v0, sa * v0 - g(30), life, col, 7, g(105), drag, 3.6, { gl: 7, fr: rnd(8, 12) });
            for (let j = 0; j < 6; j++) { const v = v0 * rnd(0.5, 0.95); star(cx, cy, ca * v + g(rnd(-5, 5)), sa * v - g(26), life * rnd(0.7, 0.95), col, 6, g(105), drag, 2.2); }
          }
          break;
        }
        case "strobe": {
          const life = rnd(2.7, 3.3), drag = 1.4, v0 = speedFor(R, drag, life * 0.9) * u;
          sphere(cnt(190), v0, (vx, vy) => {
            if (rng() < 0.3) star(cx, cy, vx, vy, life * 0.7, c1, 0, g(30), drag, 2.4);
            else star(cx, cy, vx, vy, life * rnd(0.85, 1.1), rng() < 0.6 ? C_WHITE : C_GOLD, 1, g(30), drag, 2.6, { fr: rnd(8, 13) });
          });
          break;
        }
      }
      // Вспышка у ядра (до ~120 мс, тёплая) и короткий свет цвета разрыва вокруг него — не заливка экрана.
      const dim = barrageEnd > 0 ? 0.65 : 1;
      addGlow(cx, cy, g(R * 0.2), 0.12, C_WARM, 0.9 * dim);
      addGlow(cx, cy, g(R * 0.62), 0.5, sh.type === "willow" || sh.type === "horsetail" ? C_GOLD : c1, 0.22 * dim);
      burstEnds.push(T + SEE[sh.type]);
      recent.push({ x: cx, y: cy, at: T }); if (recent.length > 10) recent.shift();
    };

    // ——— Ракеты ———
    const launch = (tsx: number, tsy: number, fromSx: number, fromSy: number, type: ShellType, Rpx: number, c1: number, c2: number, delay = 0) => {
      const go = () => {
        if (rockets.length >= MAX_ROCKETS) return;
        const t = worldOf(tsx, tsy), s = worldOf(fromSx, fromSy), dist = Math.hypot(tsx - fromSx, tsy - fromSy);
        rockets.push({ sx: s.x, sy: s.y, tx: t.x, ty: t.y, px: s.x, py: s.y, T: 0.55 + Math.min(0.5, dist / 1600) + rnd(0, 0.1), age: 0, type, R: Rpx, c1, c2 });
      };
      if (delay <= 0) go(); else queue.push({ at: T + delay, run: go });
    };

    // ——— Выбор вида и цветов ———
    type Cls = "small" | "medium" | "large" | "huge";
    const radius = (c: Cls) => (c === "small" ? rnd(40, 52) : c === "medium" ? rnd(56, 74) : c === "large" ? rnd(80, 104) : rnd(115, 150)) * sizeU;
    const typeFor = (c: Cls): ShellType => pick<ShellType>(
      c === "small" ? ["peony", "peony", "chrys", "strobe"]
        : c === "medium" ? ["peony", "peony", "chrys", "chrys", "willow", "strobe", "horsetail"]
        : c === "large" ? ["peony", "chrys", "chrys", "willow", "willow", "palm", "strobe", "saturn", "horsetail"]
        : ["chrys", "willow", "willow", "palm", "saturn", "peony"]);
    const pickClass = (barrage: boolean): Cls => {
      const r = rng();
      if (barrage) return r < 0.12 ? "small" : r < 0.45 ? "medium" : r < 0.85 ? "large" : "huge";
      return r < 0.2 ? "small" : r < 0.56 ? "medium" : r < 0.9 ? "large" : "huge";
    };
    const colors = (type: ShellType): [number, number] => {
      if (type === "willow" || type === "horsetail") return [C_GOLD, C_AMBER];
      const a = pick(CHROMA);
      let b = pick(CHROMA);
      while (b === a) b = pick(CHROMA);
      if (type === "palm") return [rng() < 0.5 ? C_GOLD : a, C_WARM];
      if (type === "strobe") return [a, C_WHITE];
      return rng() < 0.75 ? [a, b] : [a, rng() < 0.5 ? C_GOLD : C_WHITE];
    };

    /** Место разрыва: из нескольких случайных точек неба берётся самая далёкая от недавних разрывов — салют ложится по всей карте. */
    const spot = (): { x: number; y: number } => {
      let best = { x: CW / 2, y: CH / 2 }, bestD = -1;
      const rs = recent.filter((r) => T - r.at < 3).map((r) => screenOf(r.x, r.y));
      for (let i = 0; i < 8; i++) {
        const p = { x: rnd(CW * 0.06, CW * 0.94), y: rnd(CH * 0.1, CH * 0.72) };
        let d = 1e9;
        for (const q of rs) d = Math.min(d, Math.hypot(p.x - q.x, p.y - q.y));
        if (d > bestD) { bestD = d; best = p; }
      }
      return best;
    };
    const visibleAnchors = () => {
      const out: Array<{ x: number; y: number }> = [];
      for (const a of anchorsRef.current ?? []) { const s = screenOf(a.x, a.y); if (s.x > CW * 0.08 && s.x < CW * 0.92 && s.y > CH * 0.35 && s.y < CH * 0.9) out.push(s); }
      return out;
    };

    // ——— Залпы ———
    const single = (barrage: boolean, cls = pickClass(barrage), delay = 0) => {
      const type = typeFor(cls), [c1, c2] = colors(type), R = radius(cls);
      const as = rng() < 0.25 ? visibleAnchors() : [];
      if (as.length) {
        const a = pick(as), up = Math.max(R * 1.1, CH * rnd(0.2, 0.32));
        launch(a.x + rnd(-10, 10), Math.max(CH * 0.1, a.y - up), a.x, a.y, type, R, c1, c2, delay);
      } else {
        const p = spot();
        launch(p.x, p.y, p.x + rnd(-0.05, 0.05) * CW, CH * 1.02, type, R, c1, c2, delay);
      }
    };
    /** Веер: несколько ракет из одной точки внизу расходятся лучами и лопаются на разной высоте. */
    const fan = (barrage: boolean) => {
      const m = Math.round(rnd(3, barrage ? 6 : 4)), lx = rnd(0.25, 0.75) * CW, ly = CH * 1.02, step = rnd(0.22, 0.34);
      const cls: Cls = rng() < 0.6 ? "medium" : "large", type = typeFor(cls), mono = rng() < 0.5, base = colors(type);
      for (let i = 0; i < m; i++) {
        const k = i - (m - 1) / 2, ang = -Math.PI / 2 + k * step, len = CH * rnd(0.5, 0.78);
        const t2 = mono ? type : typeFor(cls), [a, b] = mono ? base : colors(t2);
        launch(lx + Math.cos(ang) * len, Math.max(CH * 0.1, ly + Math.sin(ang) * len), lx, ly, t2, radius(cls) * rnd(0.85, 1), a, b, i * 0.07);
      }
    };
    /** Бегущая волна: ряд разрывов поперёк экрана, радугой или одним цветом. */
    const wave = () => {
      const m = Math.max(4, Math.round(rnd(4, 6) * Math.sqrt(rateU))), dir = rng() < 0.5 ? 1 : -1, y0 = rnd(0.22, 0.5) * CH, rainbow = rng() < 0.5, h0 = Math.floor(rng() * CHROMA.length);
      const type: ShellType = rng() < 0.5 ? "peony" : "chrys", [c1, c2] = colors(type);
      for (let i = 0; i < m; i++) {
        const f = i / (m - 1), x = (dir > 0 ? 0.1 + 0.8 * f : 0.9 - 0.8 * f) * CW;
        launch(x, y0 + Math.sin(f * 5) * CH * 0.06, x + rnd(-10, 10), CH * 1.02, type, radius("medium"), rainbow ? CHROMA[(h0 + i * 2) % CHROMA.length]! : c1, c2, i * 0.13);
      }
    };
    const pair = (barrage: boolean) => {
      const cls = pickClass(barrage), type = typeFor(cls), [c1, c2] = colors(type), cx = rnd(0.4, 0.6) * CW, y = rnd(0.2, 0.55) * CH, d = rnd(0.22, 0.32) * CW, R = radius(cls);
      for (const s of [-1, 1]) launch(cx + s * d, y, cx + s * d * 1.15, CH * 1.02, type, R, c1, c2, 0);
    };
    const event = (barrage: boolean) => {
      const r = rng();
      if (barrage) { if (r < 0.28) fan(true); else if (r < 0.45) wave(); else if (r < 0.6) pair(true); else single(true); return; }
      if (r < 0.66) single(false); else if (r < 0.8) pair(false); else if (r < 0.93) fan(false); else wave();
    };
    /** Финальный аккорд канонады: ряд огромных золотых ив через весь экран, над ними — шар и строб. */
    const grand = () => {
      const m = Math.max(4, Math.min(10, Math.round(CW / (95 * sizeU))));
      for (let i = 0; i < m; i++) {
        const f = (i + 0.5) / m, x = f * CW, y = CH * (0.3 + (i % 2 ? 0.1 : -0.04) + rnd(-0.03, 0.03));
        launch(x, y, x + rnd(-14, 14), CH * 1.03, i % 3 === 1 ? "horsetail" : "willow", radius("huge") * rnd(0.95, 1.15), C_GOLD, C_AMBER, i * 0.06);
      }
      const t: ShellType = rng() < 0.5 ? "chrys" : "saturn", [a, b] = colors(t);
      launch(CW * rnd(0.4, 0.6), CH * 0.22, CW / 2, CH * 1.04, t, radius("huge") * 1.1, a, b, 0.55);
      launch(CW * rnd(0.25, 0.75), CH * 0.42, CW / 2, CH * 1.04, "strobe", radius("large"), C_WHITE, C_WHITE, 0.9);
    };

    // ——— Распорядитель ———
    const direct = (dt: number) => {
      T += dt;
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.at <= T) { const q = queue[i]!; queue.splice(i, 1); q.run(); }
      if (stopping) return;
      if (barrageEnd < 0 && T >= nextBarrage) { barrageEnd = T + rnd(5, 6); finalDone = false; }
      const barrage = barrageEnd > 0;
      if (barrage && !finalDone && T >= barrageEnd - 1.1) { finalDone = true; grand(); }
      if (barrage && T >= barrageEnd) { barrageEnd = -1; lastEnd = T; nextBarrage = T + rnd(18, 28); nextEvent = Math.max(nextEvent, T + 1.6); }
      if (T < nextEvent) return;
      if (barrage && T >= barrageEnd - 1.1) { nextEvent = T + 0.3; return; }
      event(barrage);
      nextEvent = T + (barrage ? rnd(0.13, 0.24) : rnd(0.42, 0.8)) / rateU;
      // Звёзд почти потолок — новых залпов нет, пока не освободится место.
      if (n > cap - 350) nextEvent = T + 0.4;
    };

    // ——— Шаг ———
    const step = (dt: number) => {
      const u = 1 / view().k;
      for (let i = n - 1; i >= 0; i--) {
        const age = AGE[i]! + dt; AGE[i] = age;
        PX[i] = X[i]!; PY[i] = Y[i]!;
        if (age < 0) continue;
        if (age >= LIFE[i]!) { kill(i); continue; }
        const d = 1 - Math.min(0.9, DRAG[i]! * dt);
        const vx = VX[i]! * d, vy = VY[i]! * d + GRAV[i]! * dt;
        VX[i] = vx; VY[i] = vy; X[i] = X[i]! + vx * dt; Y[i] = Y[i]! + vy * dt;
        // Капель искр с мерцающих ветвей: падают и быстро гаснут.
        const gl = GL[i]!;
        if (gl > 0 && n < soft && age > LIFE[i]! * 0.2 && rng() < gl * dt) {
          star(X[i]!, Y[i]!, vx * 0.25 + rnd(-8, 8) * u, vy * 0.25 + rnd(0, 14) * u, rnd(0.4, 0.8), rng() < 0.7 ? C_GOLD : C_WARM, 4, 140 * u, 1.6, 1.5);
        }
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]!; r.age += dt;
        const f = Math.min(1, r.age / r.T), e = 1 - Math.pow(1 - f, 2.2), x = r.sx + (r.tx - r.sx) * e, y = r.sy + (r.ty - r.sy) * e;
        r.px = r.ax ?? r.sx; r.py = r.ay ?? r.sy; r.ax = x; r.ay = y;
        if (f >= 1) { rockets.splice(i, 1); explode(r, r.tx, r.ty); continue; }
        // Искры за ракетой: две на кадр, падают и гаснут.
        if (n < soft) for (let q = 0; q < 2; q++) star(x, y, rnd(-16, 16) * u, rnd(10, 40) * u, rnd(0.3, 0.6), rng() < 0.6 ? C_GOLD : C_WARM, 4, 90 * u, 1.4, 1.4);
      }
      for (let i = glows.length - 1; i >= 0; i--) { const g = glows[i]!; g.age += dt; if (g.age >= g.life) glows.splice(i, 1); }
      for (let i = burstEnds.length - 1; i >= 0; i--) if (burstEnds[i]! < T) burstEnds.splice(i, 1);
      burstsLive = burstEnds.length;
    };

    // ——— Рисование ———
    // Вёдра штрихов: (толщина 0 тонкая искра / 1 обычная / 2 толстая) × цвет × яркость — один путь на ведро.
    const NT = 3, trailB: number[][] = Array.from({ length: NT * NC * NA }, () => []);
    const coreB: number[][] = Array.from({ length: 2 * NC * NA }, () => []);
    const alphaLevel = (a: number) => (a >= 0.93 ? 0 : Math.min(NA - 1, Math.max(0, Math.round((1 - a) * 7.6))));
    const vb = { x0: 0, x1: 0, y0: 0, y1: 0 };

    /** Холст следов нарисован под прежний вид карты — переносим его вслед за картой. */
    const followView = (k: number, tx: number, ty: number) => {
      if (k === tk && tx === ttx && ty === tty) return;
      const r = k / tk;
      if (!tmp) { tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H; }
      const t2 = tmp.getContext("2d")!;
      t2.setTransform(1, 0, 0, 1, 0, 0); t2.globalCompositeOperation = "copy"; t2.drawImage(tcanvas, 0, 0);
      tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.globalCompositeOperation = "source-over"; tctx.clearRect(0, 0, W, H);
      if (r > 0.05 && r < 20) { tctx.setTransform(r, 0, 0, r, (tx - ttx * r) * dpr, (ty - tty * r) * dpr); tctx.drawImage(tmp, 0, 0); }
      tk = k; ttx = tx; tty = ty;
    };

    const draw = () => {
      const v = view(), k = v.k, tx = v.tx, ty = v.ty;
      followView(k, tx, ty);
      // Следы: гасим прошлое и дорисовываем путь каждой звезды за этот кадр.
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.globalCompositeOperation = "destination-out"; tctx.globalAlpha = 1;
      tctx.fillStyle = `rgba(0,0,0,${FADE})`; tctx.fillRect(0, 0, W, H);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);
      const m = k * dpr;
      tctx.setTransform(m, 0, 0, m, tx * dpr, ty * dpr); tctx.globalCompositeOperation = "lighter";
      ctx.setTransform(m, 0, 0, m, tx * dpr, ty * dpr); ctx.globalCompositeOperation = "lighter";
      const mg = 60 / k;
      vb.x0 = -tx / k - mg; vb.x1 = (CW - tx) / k + mg; vb.y0 = -ty / k - mg; vb.y1 = (CH - ty) / k + mg;
      // Вспышки у ядер.
      for (const g of glows) {
        if (g.x < vb.x0 - g.r || g.x > vb.x1 + g.r || g.y < vb.y0 - g.r || g.y > vb.y1 + g.r) continue;
        const t = g.age / g.life;
        ctx.globalAlpha = g.a * (1 - t) * (1 - t);
        ctx.drawImage(sprite(g.col), g.x - g.r, g.y - g.r, g.r * 2, g.r * 2);
      }
      // Ракеты: след на холсте следов, головка — светящаяся точка.
      for (const r of rockets) {
        const x = r.ax ?? r.sx, y = r.ay ?? r.sy;
        if (x < vb.x0 || x > vb.x1 || y < vb.y0 || y > vb.y1) continue;
        trailB[(1 * NC + C_GOLD) * NA + 1]!.push(r.px, r.py, x, y);
        const s = 9 / k; ctx.globalAlpha = 0.9; ctx.drawImage(sprite(C_WARM), x - s, y - s, s * 2, s * 2);
      }
      // Звёзды.
      const haloStep = n > HALO_MAX ? Math.ceil((n / HALO_MAX) * 4) / 4 : 0; // доля ореолов: по метке звезды 0..3
      const haloKeep = haloStep ? Math.max(1, Math.floor(4 / haloStep)) : 4;
      for (let i = 0; i < n; i++) {
        const age = AGE[i]!;
        if (age < 0) continue;
        const x = X[i]!, y = Y[i]!;
        if (x < vb.x0 || x > vb.x1 || y < vb.y0 || y > vb.y1) continue;
        const life = LIFE[i]!, t = age / life, kind = KIND[i]!, w = WID[i]!;
        const col = CHG[i]! > 0 && t > CHG[i]! ? COL2[i]! : COL[i]!;
        let a: number;
        if (kind === 6 || kind === 7) a = 0.92 * (1 - t * t * t);
        else if (kind === 4) a = 0.9 * (1 - t) * (1 - t);
        else a = t < 0.05 ? 1 : Math.pow(1 - t, 1.1);
        const fr = FR[i]!;
        if (kind === 1 && t > 0.3) { if ((age * fr + PH[i]! / 6.2832) % 1 > 0.32) continue; a = Math.max(a, 0.7); }
        else if (fr > 0 && t > 0.4) a *= 0.35 + 0.65 * Math.abs(Math.sin(age * fr + PH[i]!));
        if (a <= 0.04) continue;
        const al = alphaLevel(a);
        if (kind !== 1 || t <= 0.3) {
          const th = kind === 4 ? 0 : kind === 7 ? 2 : 1;
          trailB[(th * NC + col) * NA + Math.min(NA - 1, al + (kind === 4 ? 1 : 0))]!.push(PX[i]!, PY[i]!, x, y);
        }
        if (kind === 4) continue;
        // Головка: ядро (в первые мгновения почти белое) и ореол-спрайт.
        coreB[((t < 0.12 ? 1 : 0) * NC + col) * NA + al]!.push(x, y);
        if (HALO[i]! < haloKeep) {
          const s = (w * (t < 0.15 ? 2.6 : 2) * (kind === 7 ? 1.4 : 1)) / k;
          ctx.globalAlpha = a * (kind === 1 ? 1 : 0.85);
          ctx.drawImage(sprite(col), x - s, y - s, s * 2, s * 2);
        }
      }
      ctx.globalAlpha = 1;
      tctx.lineCap = "round"; ctx.lineCap = "round";
      for (let b = 0; b < trailB.length; b++) {
        const s = trailB[b]!;
        if (!s.length) continue;
        const a = b % NA, rest = (b - a) / NA, col = rest % NC, th = (rest - col) / NC, [h, sat, l] = COLORS[col]!;
        tctx.strokeStyle = `hsla(${h},${sat}%,${Math.min(80, l + 6)}%,${(ALPHAS[a] * 0.8).toFixed(3)})`;
        tctx.lineWidth = (th === 0 ? 1.2 : th === 1 ? 2.2 : 3.2) / k;
        tctx.beginPath();
        for (let j = 0; j < s.length; j += 4) { tctx.moveTo(s[j]!, s[j + 1]!); tctx.lineTo(s[j + 2]!, s[j + 3]!); }
        tctx.stroke();
        s.length = 0;
      }
      for (let b = 0; b < coreB.length; b++) {
        const s = coreB[b]!;
        if (!s.length) continue;
        const a = b % NA, rest = (b - a) / NA, col = rest % NC, hot = (rest - col) / NC, [h, sat, l] = COLORS[col]!;
        ctx.strokeStyle = hot ? `hsla(${h},${Math.round(sat * 0.5)}%,92%,${ALPHAS[a]})` : `hsla(${h},${sat}%,${Math.min(90, l + 18)}%,${ALPHAS[a]})`;
        ctx.lineWidth = 2.4 / k;
        ctx.beginPath();
        const e = 0.02 / k;
        for (let j = 0; j < s.length; j += 2) { ctx.moveTo(s[j]!, s[j + 1]!); ctx.lineTo(s[j]! + e, s[j + 1]!); }
        ctx.stroke();
        s.length = 0;
      }
      ctx.globalCompositeOperation = "source-over"; tctx.globalCompositeOperation = "source-over";
    };

    /** Вуаль над картой: плавно входит и уходит; в канонаду чуть темнее. */
    const setVeil = () => {
      const base = VEIL_NIGHT + (VEIL_DAY - VEIL_NIGHT) * bright;
      const vv = Math.round((base + VEIL_BARRAGE * barrageE) * energy * 1000) / 1000;
      if (Math.abs(vv - veilNow) >= 0.003 || (vv === 0 && veilNow !== 0)) { veilNow = vv; veilEl.style.opacity = String(vv); }
    };

    // ——— Запуск и остановка цикла кадров ———
    const shouldBurn = () => victoryFxOn(winRef.current, clockRef.current(), tzRef.current);
    const under = coverGate();
    const reset = () => { n = 0; rockets.length = 0; glows.length = 0; queue.length = 0; burstEnds.length = 0; recent.length = 0; energy = 0; barrageE = 0; };
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
      energy += ((stopping ? 0 : 1) - energy) * Math.min(1, dt * (stopping ? 1.4 : 1.8));
      barrageE += ((barrageEnd > 0 ? 1 : 0) - barrageE) * Math.min(1, dt * 1.5);
      direct(dt);
      step(dt);
      setVeil();
      if (stopping && n === 0 && rockets.length === 0 && glows.length === 0 && queue.length === 0 && energy < 0.02) { stop(); return; }
      draw();
      if (winRef.current.debug) {
        const ms = performance.now() - t0; frameMs = frameMs ? frameMs * 0.9 + ms * 0.1 : ms;
        peak = Math.max(peak, n); peakBursts = Math.max(peakBursts, burstsLive); sumParts += n; sumFrames++;
        stats.cap = cap; stats.parts = n; stats.peak = peak; stats.avgParts = Math.round(sumParts / sumFrames); stats.bursts = burstsLive; stats.peakBursts = peakBursts;
        stats.frameMs = Math.round(frameMs * 100) / 100; stats.frames = sumFrames; stats.barrage = barrageEnd > 0 || T - lastEnd < 4; stats.calm = barrageEnd < 0 && T - lastEnd > 5;
        stats.T = Math.round(T * 10) / 10; stats.rockets = rockets.length; stats.veil = veilNow;
      }
    };
    const start = () => {
      if (running) return;
      running = true; stopping = false; last = 0; checked = -1e9; brightAt = -1e9;
      reset(); T = 0; nextEvent = 0.1; nextBarrage = rnd(7, 11); barrageEnd = -1; finalDone = true;
      sizeCanvas();
      const v = view(); tk = v.k; ttx = v.tx; tty = v.ty;
      raf = requestAnimationFrame(loop);
    };
    function stop() {
      cancelAnimationFrame(raf); raf = 0; running = false; stopping = false;
      for (const c of [ctx!, tctx!]) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "source-over"; c.clearRect(0, 0, W, H); }
      reset(); veilNow = 0; veilEl!.style.opacity = "0"; tmp = null;
      sizeCanvas(); // холсты сжимаются до точки: пока салюта нет, они не занимают память
    }
    // Пока салюта нет, раз в 4 секунды проверяется только время (без кадров).
    const watch = () => { if (!running && shouldBurn()) start(); };
    const ro = new ResizeObserver(() => {
      readSize();
      if (!running) return;
      sizeCanvas();
      const v = view(); tk = v.k; ttx = v.tx; tty = v.ty; // новый размер стирает холст следов — начинаем с текущего вида
    });
    ro.observe(host); readSize(); sizeCanvas();
    watch();
    const timer = window.setInterval(watch, 4000);
    return () => { cancelAnimationFrame(raf); window.clearInterval(timer); ro.disconnect(); };
  }, []);
  return (<>
    {/* Вуаль — под подписями городов и значками дел (они идут в разметке позже), холсты — над ними. */}
    <div ref={veilRef} className="victory-veil" aria-hidden="true" />
    <canvas ref={trailRef} className="fx-layer victory-fx" width={1} height={1} aria-hidden="true" />
    <canvas ref={ref} className="fx-layer victory-fx" width={1} height={1} aria-hidden="true" />
  </>);
}
