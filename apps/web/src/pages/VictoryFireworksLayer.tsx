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
 *  - салюту нужно тёмное небо: пока он идёт, карта под ним притемняется «ночной» вуалью (владелец 26.11: «притемнение
 *    оставь»); вуаль умножает цвета карты на тёмно-синий — белое становится синим, а не серым;
 *  - шлейфы «с выдержкой»: отдельный холст следов, который каждый кадр не очищается, а гасится (`destination-out`), —
 *    звезда тянет за собой плавный сужающийся след сама, без нарисованных «палочек»;
 *  - звезда — светящаяся точка: заранее нарисованный спрайт-градиент по цвету (`drawImage`, без `shadowBlur`) и ядро;
 *  - разрыв — шар: направления с поверхности сферы (круг плотнее у края), скорость подобрана под сопротивление воздуха,
 *    чтобы шар доходил ровно до нужного радиуса; падение под тяжестью подобрано так, чтобы звезда гасла, не опустившись
 *    ниже ~0,3–0,65 радиуса, — без «дождя»; смена цвета звёзд, «пестик» другого цвета, мерцание при угасании;
 *  - ива — длинные золотые ветви (с цветными кончиками), которые гаснут вместе с куполом; строб — мерцающие точки;
 *    пальма — толстые ветви; ракета — яркая головка с коротким хвостом; короткая вспышка у ядра.
 * Код не копировался — только приёмы, всё написано заново под карту.
 *
 * Устройство. Вуаль — div под подписями городов; два холста над картой: следы (гасятся) и головки (чистятся каждый кадр).
 * К карте привязан только центр разрыва (`SX`, `SY` — места в координатах карты); звёзды хранят смещение от центра в
 * пикселях экрана. Поэтому при сдвиге разрыв едет с картой, а при зуме сохраняет размер на экране (не сжимается в комок
 * на общем виде и не раздувается вблизи). При сдвиге холст следов переносится одним `drawImage`, при зуме — очищается
 * (ошибка «следы при зуме» 16.11). На большом экране разрывы крупнее и их больше — по площади экрана.
 *
 * Распорядитель — по собственным часам показа (`T`, растёт на кадр): под листом (`coverGate`) показ замирает и после него
 * не догоняет. Спокойно — на экране всё время 6–10 ярких разрывов в разных стадиях (на компьютере больше, по площади).
 * Раз в 18–28 с — канонада 5–6 с вдвое гуще и финальный аккорд: сетка огромных ив и многоцветных шаров от края до края,
 * строб поверх; сразу за ним — снова обычные разрывы. Центры разрывов — вне шапки и панели разделов.
 *
 * Скорость (памятка 16.11): всё на холсте, в слое меток ничего не движется; потолок 30 кадров; когда салюта нет (до победы,
 * после неё, днём вторых и третьих суток) — цикл кадров не крутится, холсты сжаты до точки, раз в 4 с проверяется только
 * время. Список звёзд и оба холста сбрасываются вместе. При `prefers-reduced-motion` салюта нет. Выключатель для
 * замеров — `perfOff("victory")`. Звука нет.
 */
export interface VictoryAnchor { x: number; y: number }

/** Сила «ночной» вуали над картой, пока бьёт салют: днём и ночью (между ними — по свету карты). Вуаль — `multiply`. */
export const VEIL_DAY = 0.85;
export const VEIL_NIGHT = 0.5;
/** Добавка к вуали в канонаду. */
const VEIL_BARRAGE = 0.06;

// ——— Палитра ———
// [оттенок, насыщенность %, яркость %].
const COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [44, 100, 62], [30, 100, 56], [0, 100, 62], [340, 100, 64], [318, 100, 70], [286, 95, 70], [258, 95, 74], [220, 100, 70], [198, 100, 64],
  [176, 100, 56], [148, 95, 58], [118, 90, 60], [70, 100, 58], [54, 100, 64], [20, 100, 60], [210, 30, 97], [42, 85, 90],
];
const NC = COLORS.length;
const C_GOLD = 0, C_AMBER = 1, C_WHITE = 15, C_WARM = 16;
const CHROMA: ReadonlyArray<number> = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14]; // цвета разрывов (без белых и золота)
const ALPHAS = [1, 0.84, 0.68, 0.54, 0.41, 0.3, 0.2, 0.11] as const;
const NA = ALPHAS.length;

// ——— Пределы ———
const CAP_MAX = 8000;   // память под звёзды; рабочий потолок — `cap` по размеру экрана (телефон 4800, компьютер 8000)
const CAP_PHONE = 4800;
const NSLOT = 256;      // мест разрывов в кольце (разрыв живёт ≤ 4 с, их ≤ ~30 в секунду)
const MAX_GLOWS = 40, MAX_ROCKETS = 60;
const FRAME_MS = 33;    // потолок кадров — 30 в секунду
const FADE = 0.24;      // гашение холста следов за кадр («выдержка» ~0,3 с)
const HALO_PHONE = 1500; // ореолов-спрайтов на кадр не больше (на большом экране — больше, по площади)
/** Ветви ивы и пальмы помнят путь: HN точек через HDT с — длинная плавно гаснущая ветвь, как на фото с выдержкой. */
const HN = 6, HDT = 0.1;

/** Виды звёзд: 0 обычная, 1 строб, 4 искра ракеты, 6 ветвь ивы, 7 голова пальмы. */
type Kind = 0 | 1 | 4 | 6 | 7;
type ShellType = "peony" | "chrys" | "willow" | "palm" | "strobe";
/** Ракета летит к месту `slot`; `ox`, `oy` — откуда, в пикселях экрана от него. */
interface Rocket { slot: number; ox: number; oy: number; T: number; age: number; type: ShellType; R: number; c1: number; c2: number }
interface Glow { slot: number; r: number; age: number; life: number; col: number; a: number }

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
  /** Места городов в координатах карты: часть ракет взлетает из них. */
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
    let sizeU = 1, rateU = 1, cap = CAP_PHONE, soft = 3800, haloMax = HALO_PHONE;
    /** Свободная от интерфейса часть экрана (шапка, панель разделов, колонка плиток): центры разрывов — только в ней. */
    let fx0 = 0, fx1 = 0, fy0 = 0, fy1 = 0;
    let running = false, stopping = false, raf = 0, last = 0, checked = -1e9;
    /** Вид карты, под который сейчас нарисован холст следов. */
    let tk = 1, ttx = 0, tty = 0;
    let tmp: HTMLCanvasElement | null = null;
    const readSize = () => {
      CW = host.clientWidth; CH = host.clientHeight;
      const area = (CW * CH) / (390 * 844);
      sizeU = Math.min(1.7, Math.max(1, Math.sqrt(area) * 0.84));
      rateU = Math.min(2, Math.max(1, area / sizeU));
      cap = Math.min(CAP_MAX, Math.round(CAP_PHONE * rateU)); soft = Math.round(cap * 0.8); haloMax = Math.round(HALO_PHONE * Math.min(2, rateU));
      const wide = CW >= 900;
      fx0 = wide ? 96 : 14; fx1 = CW - 14; fy0 = wide ? 70 : 86; fy1 = CH - (wide ? 70 : 128);
    };
    const sizeCanvas = () => {
      const w = running ? Math.max(1, Math.round(CW * dpr)) : 1, h = running ? Math.max(1, Math.round(CH * dpr)) : 1;
      for (const c of [canvas, tcanvas]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      if (tmp && (tmp.width !== w || tmp.height !== h)) tmp = null;
      W = w; H = h;
    };

    // ——— Места разрывов: центр в координатах карты ———
    const SX = new Float64Array(NSLOT), SY = new Float64Array(NSLOT), SK = new Float64Array(NSLOT).fill(1);
    let slotNext = 0;
    const view = () => vpRef.current.viewRef.current;
    const newSlot = (sx: number, sy: number) => { const v = view(), s = slotNext; slotNext = (slotNext + 1) % NSLOT; SX[s] = (sx - v.tx) / v.k; SY[s] = (sy - v.ty) / v.k; SK[s] = v.k; return s; };
    const screenOf = (wx: number, wy: number) => { const v = view(); return { x: wx * v.k + v.tx, y: wy * v.k + v.ty }; };

    // ——— Звёзды (массивы чисел, без выделения памяти); X, Y — смещение от центра разрыва в пикселях экрана ———
    const X = new Float32Array(CAP_MAX), Y = new Float32Array(CAP_MAX), PX = new Float32Array(CAP_MAX), PY = new Float32Array(CAP_MAX);
    const VX = new Float32Array(CAP_MAX), VY = new Float32Array(CAP_MAX), AGE = new Float32Array(CAP_MAX), LIFE = new Float32Array(CAP_MAX);
    const GRAV = new Float32Array(CAP_MAX), DRAG = new Float32Array(CAP_MAX), WID = new Float32Array(CAP_MAX), PH = new Float32Array(CAP_MAX);
    const FR = new Float32Array(CAP_MAX), CHG = new Float32Array(CAP_MAX);
    const COL = new Uint8Array(CAP_MAX), COL2 = new Uint8Array(CAP_MAX), KIND = new Uint8Array(CAP_MAX), HALO = new Uint8Array(CAP_MAX), SLOT = new Uint8Array(CAP_MAX);
    const HX = new Float32Array(CAP_MAX * HN), HY = new Float32Array(CAP_MAX * HN), HT = new Float32Array(CAP_MAX), HC = new Uint8Array(CAP_MAX);
    let n = 0;
    const kill = (i: number) => {
      const l = --n;
      if (i === l) return;
      X[i] = X[l]!; Y[i] = Y[l]!; PX[i] = PX[l]!; PY[i] = PY[l]!; VX[i] = VX[l]!; VY[i] = VY[l]!; AGE[i] = AGE[l]!; LIFE[i] = LIFE[l]!;
      GRAV[i] = GRAV[l]!; DRAG[i] = DRAG[l]!; WID[i] = WID[l]!; PH[i] = PH[l]!; FR[i] = FR[l]!; CHG[i] = CHG[l]!;
      COL[i] = COL[l]!; COL2[i] = COL2[l]!; KIND[i] = KIND[l]!; HALO[i] = HALO[l]!; SLOT[i] = SLOT[l]!; HT[i] = HT[l]!; HC[i] = HC[l]!;
      if (HC[l]) { const a = i * HN, b = l * HN; for (let q = 0; q < HN; q++) { HX[a + q] = HX[b + q]!; HY[a + q] = HY[b + q]!; } }
    };
    /** Новая звезда у места `slot`; `w` — размер головки в пикселях экрана, `col2`/`chg` — смена цвета на доле жизни `chg`. */
    const star = (slot: number, x: number, y: number, vx: number, vy: number, life: number, col: number, kind: Kind, grav: number, drag: number, w: number,
      o?: { fr?: number; col2?: number; chg?: number }) => {
      if (n >= cap) return;
      const i = n++;
      X[i] = x; Y[i] = y; PX[i] = x; PY[i] = y; VX[i] = vx; VY[i] = vy; AGE[i] = 0; LIFE[i] = life; COL[i] = col; KIND[i] = kind; SLOT[i] = slot;
      GRAV[i] = grav; DRAG[i] = drag; WID[i] = w; FR[i] = o?.fr ?? 0; COL2[i] = o?.col2 ?? col; CHG[i] = o?.chg ?? 0;
      PH[i] = rng() * 6.283; HALO[i] = Math.floor(rng() * 4); HT[i] = 0; HC[i] = 0;
    };

    const rockets: Rocket[] = [];
    const glows: Glow[] = [];
    const queue: Array<{ at: number; run: () => void }> = [];
    const recent: Array<{ s: number; at: number }> = [];
    let lastEnd = -1e9, T = 0, nextEvent = 0.05, nextBarrage = rnd(8, 12), barrageEnd = -1, finalDone = true;
    let energy = 0, barrageE = 0, bright = 1, brightAt = -1e9, veilNow = -1;
    let peak = 0, sumParts = 0, sumFrames = 0, frameMs = 0, burstsLive = 0, peakBursts = 0;
    /** Пока каждый разрыв ярок (купол виден целиком, а не угасающие хвосты) — для счёта «ярких разрывов на экране». */
    const brightEnds: number[] = [];
    const BRIGHT: Record<ShellType, number> = { peony: 1.05, chrys: 1.3, willow: 1.8, palm: 1.4, strobe: 1.6 };
    const stats = { cap: CAP_PHONE, parts: 0, peak: 0, avgParts: 0, bursts: 0, peakBursts: 0, frameMs: 0, frames: 0, barrage: false, calm: false, T: 0, rockets: 0, veil: 0 };
    if (winRef.current.debug) (window as unknown as { __victoryFx?: unknown }).__victoryFx = stats;

    // ——— Спрайты: светящаяся точка цвета (ядро светлое, мягкий ореол) ———
    const sprites: Array<HTMLCanvasElement | undefined> = [];
    const sprite = (c: number) => {
      let s = sprites[c];
      if (s) return s;
      s = document.createElement("canvas"); s.width = s.height = 48;
      const g = s.getContext("2d")!, [h, sat, l] = COLORS[c]!;
      const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
      gr.addColorStop(0, `hsla(${h},${sat}%,${Math.min(96, l + 26)}%,1)`);
      gr.addColorStop(0.16, `hsla(${h},${sat}%,${Math.min(90, l + 12)}%,.85)`);
      gr.addColorStop(0.42, `hsla(${h},${sat}%,${l}%,.28)`);
      gr.addColorStop(1, `hsla(${h},${sat}%,${l}%,0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 48, 48);
      sprites[c] = s;
      return s;
    };
    const addGlow = (slot: number, r: number, life: number, col: number, a: number) => { if (glows.length < MAX_GLOWS) glows.push({ slot, r, age: 0, life, col, a }); };

    // ——— Виды разрывов ———
    // R — радиус разрыва в пикселях экрана, fill — доля звёзд при близком потолке.
    /** Начальная скорость, при которой звезда с сопротивлением `drag` за жизнь доходит ровно до радиуса R. */
    const speedFor = (R: number, drag: number, life: number) => (R * drag) / (1 - Math.exp(-drag * life * 0.85));
    /** Тяжесть, при которой звезда за жизнь опускается под весом на `drop`·R (не дальше — гаснет над своим шаром). */
    const gravFor = (R: number, drag: number, life: number, drop: number) => (drop * R * drag) / Math.max(0.3, life - 1 / drag);
    const fillOf = () => (n < soft ? 1 : Math.max(0.35, (cap - 200 - n) / (cap - soft)));
    /** Направления с поверхности шара, видимые сбоку: круг получается плотным у края, как у настоящего разрыва. */
    const sphere = (cnt: number, speed: number, f: (vx: number, vy: number, dx: number, dy: number) => void) => {
      for (let i = 0; i < cnt; i++) {
        const c = rnd(-1, 1), r = Math.sqrt(1 - c * c), a = rnd(0, 6.2832), k = rnd(0.96, 1.04), dx = Math.cos(a) * r, dy = Math.sin(a) * r;
        f(dx * speed * k, dy * speed * k, dx, dy);
      }
    };

    const explode = (sh: Rocket) => {
      const R = sh.R, fill = fillOf(), { c1, c2, slot } = sh;
      const cnt = (base: number) => Math.max(60, Math.round(base * Math.pow(R / (90 * sizeU), 0.6) * fill));
      const o0 = R * 0.05; // звёзды стартуют чуть в стороне от центра: шар виден с первого кадра, а не точкой
      switch (sh.type) {
        case "peony": {
          const life = rnd(1.5, 1.8), drag = 2.4, v0 = speedFor(R, drag, life), gr = gravFor(R, drag, life, 0.3);
          const change = rng() < 0.4, pistil = rng() < 0.35, two = !change && !pistil && rng() < 0.4;
          sphere(cnt(180), v0, (vx, vy, dx, dy) => star(slot, dx * o0, dy * o0, vx, vy, life * rnd(0.92, 1.06), two && rng() < 0.5 ? c2 : c1, 0, gr, drag, 2.6,
            change ? { col2: c2, chg: rnd(0.42, 0.55) } : undefined));
          if (pistil) sphere(cnt(60), v0 * 0.45, (vx, vy, dx, dy) => star(slot, dx * o0, dy * o0, vx, vy, life * 0.8, c2, 0, gr * 0.6, drag, 2.4));
          break;
        }
        case "chrys": {
          const life = rnd(1.9, 2.3), drag = 1.9, v0 = speedFor(R, drag, life), gr = gravFor(R, drag, life, 0.4);
          sphere(cnt(190), v0, (vx, vy, dx, dy) => star(slot, dx * o0, dy * o0, vx, vy, life * rnd(0.92, 1.06), rng() < 0.18 ? c2 : c1, 0, gr, drag, 2.3,
            rng() < 0.45 ? { fr: rnd(16, 26) } : undefined));
          break;
        }
        case "willow": {
          // Купол ивы: ветви гаснут вместе (жизнь почти одинаковая), опускаются на 0,65 R; у половины ив — цветные кончики.
          const life = rnd(2.6, 3), drag = 2.8, v0 = speedFor(R * 0.92, drag, life * 0.6), gr = gravFor(R, drag, life, 0.4), tip = c2 !== C_AMBER;
          sphere(cnt(160), v0, (vx, vy, dx, dy) => star(slot, dx * o0, dy * o0, vx, vy, life * rnd(0.95, 1.04), rng() < 0.85 ? C_GOLD : C_AMBER, 6, gr, drag, 2.2,
            tip && rng() < 0.6 ? { fr: rnd(10, 16), col2: c2, chg: rnd(0.5, 0.62) } : { fr: rnd(10, 16) }));
          break;
        }
        case "palm": {
          const arms = Math.round(rnd(7, 9)), life = rnd(2, 2.4), drag = 1.6, v0 = speedFor(R, drag, life * 0.8), gr = gravFor(R, drag, life, 0.55), off = rnd(0, 6.28);
          const col = rng() < 0.5 ? C_GOLD : c1;
          for (let a = 0; a < arms; a++) {
            const ang = off + (a / arms) * 6.2832 + rnd(-0.08, 0.08), ca = Math.cos(ang), sa = Math.sin(ang);
            star(slot, ca * o0, sa * o0, ca * v0, sa * v0, life, col, 7, gr, drag, 3.2, { fr: rnd(8, 12) });
            for (let j = 0; j < 8; j++) { const v = v0 * rnd(0.45, 0.95), aj = ang + rnd(-0.07, 0.07); star(slot, ca * o0, sa * o0, Math.cos(aj) * v, Math.sin(aj) * v, life * rnd(0.75, 0.95), col, 6, gr, drag, 2); }
          }
          break;
        }
        case "strobe": {
          const life = rnd(2.2, 2.6), drag = 1.8, v0 = speedFor(R, drag, life * 0.9), gr = gravFor(R, drag, life, 0.4);
          sphere(cnt(170), v0, (vx, vy, dx, dy) => {
            if (rng() < 0.3) star(slot, dx * o0, dy * o0, vx, vy, life * 0.7, c1, 0, gr, drag, 2.4);
            else star(slot, dx * o0, dy * o0, vx, vy, life * rnd(0.9, 1.05), rng() < 0.6 ? C_WHITE : C_GOLD, 1, gr, drag, 2.6, { fr: rnd(8, 13) });
          });
          break;
        }
      }
      // Вспышка у ядра: маленькая (0,08 R) и короткая (80 мс), и слабый свет цвета разрыва вокруг — не заливка экрана.
      const gc = sh.type === "willow" ? C_GOLD : c1, dim = barrageEnd > 0 ? 0.65 : 1;
      addGlow(slot, R * 0.08, 0.08, gc, 0.5 * dim);
      addGlow(slot, R * 0.5, 0.4, gc, 0.14 * dim);
      brightEnds.push(T + BRIGHT[sh.type]);
      recent.push({ s: slot, at: T }); if (recent.length > 24) recent.shift();
    };

    // ——— Ракеты ———
    /** Ракета к месту (tsx, tsy) экрана: взлетает недалеко снизу, иногда из видимого города под местом разрыва. */
    const launch = (tsx: number, tsy: number, type: ShellType, Rpx: number, c1: number, c2: number, delay = 0) => {
      const go = () => {
        if (rockets.length >= MAX_ROCKETS) return;
        const slot = newSlot(tsx, tsy);
        let ox = rnd(-0.05, 0.05) * CW, oy = CH * rnd(0.16, 0.3);
        if (rng() < 0.3) {
          for (const a of anchorsRef.current ?? []) {
            const s = screenOf(a.x, a.y), dy = s.y - tsy, dx = s.x - tsx;
            if (dy > CH * 0.1 && dy < CH * 0.4 && Math.abs(dx) < CW * 0.2) { ox = dx; oy = dy; break; }
          }
        }
        rockets.push({ slot, ox, oy, T: rnd(0.32, 0.48) + Math.min(0.12, Math.hypot(ox, oy) / 3000), age: 0, type, R: Rpx, c1, c2 });
      };
      if (delay <= 0) go(); else queue.push({ at: T + delay, run: go });
    };

    // ——— Выбор вида и цветов ———
    type Cls = "small" | "medium" | "large" | "huge";
    const radius = (c: Cls) => (c === "small" ? rnd(40, 52) : c === "medium" ? rnd(56, 74) : c === "large" ? rnd(80, 104) : rnd(115, 150)) * sizeU;
    const typeFor = (c: Cls): ShellType => pick<ShellType>(
      c === "small" ? ["peony", "peony", "chrys", "strobe"]
        : c === "medium" ? ["peony", "peony", "chrys", "chrys", "strobe", "willow"]
        : c === "large" ? ["peony", "peony", "chrys", "chrys", "willow", "palm", "strobe"]
        : ["chrys", "peony", "willow", "willow", "palm"]);
    const pickClass = (barrage: boolean): Cls => {
      const r = rng();
      if (barrage) return r < 0.12 ? "small" : r < 0.45 ? "medium" : r < 0.85 ? "large" : "huge";
      return r < 0.22 ? "small" : r < 0.6 ? "medium" : r < 0.92 ? "large" : "huge";
    };
    const colors = (type: ShellType): [number, number] => {
      const a = pick(CHROMA);
      let b = pick(CHROMA);
      while (b === a) b = pick(CHROMA);
      if (type === "willow") return [C_GOLD, rng() < 0.5 ? a : C_AMBER];
      if (type === "palm") return [rng() < 0.4 ? C_GOLD : a, C_WARM];
      if (type === "strobe") return [a, C_WHITE];
      return rng() < 0.8 ? [a, b] : [a, rng() < 0.5 ? C_GOLD : C_WHITE];
    };

    /** Место разрыва: из нескольких случайных точек свободной части экрана — самая далёкая от недавних разрывов. */
    const spot = (R: number): { x: number; y: number } => {
      const x0 = fx0 + R * 0.25, x1 = Math.max(x0 + 1, fx1 - R * 0.25), y0 = fy0 + R * 0.55, y1 = Math.max(y0 + 1, fy1 - R * 0.3);
      let best = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, bestD = -1;
      const rs = recent.filter((r) => T - r.at < 1.6).map((r) => screenOf(SX[r.s]!, SY[r.s]!));
      for (let i = 0; i < 9; i++) {
        const p = { x: rnd(x0, x1), y: rnd(y0, y1) };
        let d = 1e9;
        for (const q of rs) d = Math.min(d, Math.hypot(p.x - q.x, (p.y - q.y) * 1.1));
        if (d > bestD) { bestD = d; best = p; }
      }
      return best;
    };

    // ——— Залпы ———
    const single = (barrage: boolean, cls = pickClass(barrage), delay = 0) => {
      const type = typeFor(cls), [c1, c2] = colors(type), R = radius(cls), p = spot(R);
      launch(p.x, p.y, type, R, c1, c2, delay);
    };
    /** Веер: несколько ракет почти разом, лопаются рядом друг с другом на разной высоте. */
    const fan = (barrage: boolean) => {
      const m = Math.round(rnd(3, barrage ? 5 : 4)), cls: Cls = rng() < 0.6 ? "medium" : "large", type = typeFor(cls), mono = rng() < 0.5, base = colors(type);
      const c = spot(radius(cls) * 2);
      for (let i = 0; i < m; i++) {
        const k = i - (m - 1) / 2, R = radius(cls) * rnd(0.85, 1);
        const x = Math.min(fx1 - R * 0.25, Math.max(fx0 + R * 0.25, c.x + k * R * 1.2)), y = Math.min(fy1 - R * 0.3, Math.max(fy0 + R * 0.55, c.y - Math.cos(k) * R * 0.5));
        const t2 = mono ? type : typeFor(cls), [a, b] = mono ? base : colors(t2);
        launch(x, y, t2, R, a, b, i * 0.08);
      }
    };
    /** Бегущая волна: ряд разрывов поперёк экрана, радугой или одним цветом. */
    const wave = () => {
      const m = Math.max(4, Math.round(rnd(4, 6) * Math.sqrt(rateU))), dir = rng() < 0.5 ? 1 : -1, R = radius("medium");
      const y0 = rnd(fy0 + R, fy1 - R), rainbow = rng() < 0.6, h0 = Math.floor(rng() * CHROMA.length);
      const type: ShellType = rng() < 0.5 ? "peony" : "chrys", [c1, c2] = colors(type);
      for (let i = 0; i < m; i++) {
        const f = i / (m - 1), x = fx0 + R * 0.4 + (fx1 - fx0 - R * 0.8) * (dir > 0 ? f : 1 - f);
        launch(x, y0 + Math.sin(f * 5) * R * 0.5, type, R, rainbow ? CHROMA[(h0 + i * 2) % CHROMA.length]! : c1, c2, i * 0.12);
      }
    };
    const event = (barrage: boolean) => {
      const r = rng();
      if (barrage) { if (r < 0.25) fan(true); else if (r < 0.4) wave(); else single(true); return; }
      if (r < 0.8) single(false); else if (r < 0.95) fan(false); else wave();
    };
    /**
     * Финальный аккорд канонады — самый сильный миг: сетка огромных разрывов по всей свободной части экрана, от края до края
     * и до панели разделов; ивы (с цветными кончиками) вперемешку с многоцветными шарами, строб поверх.
     */
    const grand = () => {
      const R = radius("huge") * 0.85, cols = Math.max(3, Math.round((fx1 - fx0) / (R * 1.35))), rows = Math.max(3, Math.round((fy1 - fy0) / (R * 1.25)));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = fx0 + (fx1 - fx0) * (c + 0.5 + (r % 2 ? 0.25 : -0.25)) / cols + rnd(-0.1, 0.1) * R;
          const y = fy0 + R * 0.45 + (fy1 - fy0 - R * 0.7) * (r + rnd(0.3, 0.7)) / rows;
          const willow = (r + c) % 2 === 0, type: ShellType = willow ? "willow" : rng() < 0.5 ? "peony" : "chrys", [a, b] = colors(type);
          launch(Math.min(fx1, Math.max(fx0, x)), y, type, R * rnd(0.9, 1.15), a, b, rnd(0, 0.55) + r * 0.05);
        }
      }
      for (let i = 0; i < Math.max(2, Math.round(cols / 2)); i++) {
        const p = spot(radius("large"));
        launch(p.x, p.y, "strobe", radius("large"), pick(CHROMA), C_WHITE, 0.7 + i * 0.1);
      }
    };

    // ——— Распорядитель ———
    const direct = (dt: number) => {
      T += dt;
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i]!.at <= T) { const q = queue[i]!; queue.splice(i, 1); q.run(); }
      if (stopping) return;
      if (barrageEnd < 0 && T >= nextBarrage) { barrageEnd = T + rnd(5, 6); finalDone = false; }
      const barrage = barrageEnd > 0;
      if (barrage && !finalDone && T >= barrageEnd - 1) { finalDone = true; grand(); }
      // Сразу за финалом — снова обычные разрывы: экран не остаётся с одними угасающими ивами.
      if (barrage && T >= barrageEnd) { barrageEnd = -1; lastEnd = T; nextBarrage = T + rnd(18, 28); nextEvent = Math.min(nextEvent, T + 0.2); }
      if (T < nextEvent) return;
      if (barrage && T >= barrageEnd - 1) { nextEvent = T + 0.25; return; }
      event(barrage);
      nextEvent = T + (barrage ? rnd(0.08, 0.13) : rnd(0.13, 0.21)) / rateU;
      // Звёзд почти потолок — новых залпов нет, пока не освободится место.
      if (n > cap - 300) nextEvent = T + 0.25;
    };

    // ——— Шаг ———
    const step = (dt: number) => {
      for (let i = n - 1; i >= 0; i--) {
        const age = AGE[i]! + dt; AGE[i] = age;
        PX[i] = X[i]!; PY[i] = Y[i]!;
        if (age >= LIFE[i]!) { kill(i); continue; }
        const d = 1 - Math.min(0.9, DRAG[i]! * dt);
        const vx = VX[i]! * d, vy = VY[i]! * d + GRAV[i]! * dt;
        VX[i] = vx; VY[i] = vy; X[i] = X[i]! + vx * dt; Y[i] = Y[i]! + vy * dt;
        const kd = KIND[i]!;
        if (kd === 6 || kd === 7) {
          const ht = HT[i]! + dt;
          if (ht >= HDT) {
            const o = i * HN;
            for (let q = HN - 1; q > 0; q--) { HX[o + q] = HX[o + q - 1]!; HY[o + q] = HY[o + q - 1]!; }
            HX[o] = PX[i]!; HY[o] = PY[i]!; HT[i] = 0; if (HC[i]! < HN) HC[i] = HC[i]! + 1;
          } else HT[i] = ht;
        }
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]!; r.age += dt;
        const f = Math.min(1, r.age / r.T), e = 1 - Math.pow(1 - f, 2), x = r.ox * (1 - e), y = r.oy * (1 - e);
        if (f >= 1) { rockets.splice(i, 1); explode(r); continue; }
        // Искра за ракетой: одна на кадр, короткая.
        if (n < soft) star(r.slot, x, y, rnd(-14, 14), rnd(10, 36), rnd(0.2, 0.38), rng() < 0.6 ? C_GOLD : C_WARM, 4, 90, 1.4, 1.4);
      }
      for (let i = glows.length - 1; i >= 0; i--) { const g = glows[i]!; g.age += dt; if (g.age >= g.life) glows.splice(i, 1); }
      for (let i = brightEnds.length - 1; i >= 0; i--) if (brightEnds[i]! < T) brightEnds.splice(i, 1);
      burstsLive = brightEnds.length;
    };

    // ——— Рисование ———
    // Вёдра штрихов: (толщина 0 тонкая искра / 1 обычная) × цвет × яркость — один путь на ведро.
    const NT = 2, trailB: number[][] = Array.from({ length: NT * NC * NA }, () => []);
    const coreB: number[][] = Array.from({ length: 2 * NC * NA }, () => []);
    const strandB: number[][] = Array.from({ length: NC * NA }, () => []);
    const alphaLevel = (a: number) => (a >= 0.93 ? 0 : Math.min(NA - 1, Math.max(0, Math.round((1 - a) * 7.6))));
    // Центры мест на экране (пересчёт раз за кадр).
    const CX = new Float32Array(NSLOT), CY = new Float32Array(NSLOT);
    /**
     * Доля яркости места: разрыв держит размер на экране, а его центр едет с картой. Если карту сильно приблизили или
     * отдалили (больше чем в 1,4 раза с момента разрыва), центры сбегаются или разбегаются — такой разрыв быстро гаснет,
     * а не сливается с соседями в комок; новые разрывы уже бьют по новому виду.
     */
    const SF = new Float32Array(NSLOT);

    /** Холст следов нарисован под прежний вид карты: при сдвиге — переносим вслед, при зуме — начинаем заново. */
    const followView = (k: number, tx: number, ty: number) => {
      if (k === tk && tx === ttx && ty === tty) return;
      tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.globalCompositeOperation = "source-over";
      if (Math.abs(k / tk - 1) < 1e-6) {
        if (!tmp) { tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H; }
        const t2 = tmp.getContext("2d")!;
        t2.setTransform(1, 0, 0, 1, 0, 0); t2.globalCompositeOperation = "copy"; t2.drawImage(tcanvas, 0, 0);
        tctx.clearRect(0, 0, W, H);
        tctx.drawImage(tmp, Math.round((tx - ttx) * dpr), Math.round((ty - tty) * dpr));
      } else tctx.clearRect(0, 0, W, H);
      tk = k; ttx = tx; tty = ty;
    };

    const draw = () => {
      const v = view(), k = v.k, tx = v.tx, ty = v.ty;
      followView(k, tx, ty);
      for (let s = 0; s < NSLOT; s++) {
        CX[s] = SX[s]! * k + tx; CY[s] = SY[s]! * k + ty;
        const r = k > SK[s]! ? k / SK[s]! : SK[s]! / k;
        SF[s] = r < 1.4 ? 1 : Math.max(0, 1 - (r - 1.4) / 0.5);
      }
      // Следы: гасим прошлое и дорисовываем путь каждой звезды за этот кадр.
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.globalCompositeOperation = "destination-out"; tctx.globalAlpha = 1;
      tctx.fillStyle = `rgba(0,0,0,${FADE})`; tctx.fillRect(0, 0, W, H);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);
      tctx.setTransform(dpr, 0, 0, dpr, 0, 0); tctx.globalCompositeOperation = "lighter";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = "lighter";
      const x0 = -40, x1 = CW + 40, y0 = -40, y1 = CH + 40;
      // Вспышки у ядер.
      for (const g of glows) {
        const gx = CX[g.slot]!, gy = CY[g.slot]!;
        if (gx < x0 - g.r || gx > x1 + g.r || gy < y0 - g.r || gy > y1 + g.r) continue;
        const t = g.age / g.life, sf = SF[g.slot]!;
        if (sf <= 0) continue;
        ctx.globalAlpha = g.a * (1 - t) * (1 - t) * sf;
        ctx.drawImage(sprite(g.col), gx - g.r, gy - g.r, g.r * 2, g.r * 2);
      }
      // Ракеты: яркая головка и короткий хвост (на холсте головок — следа-кола на экране не остаётся).
      for (const r of rockets) {
        const f = Math.min(1, r.age / r.T), e = 1 - Math.pow(1 - f, 2), x = CX[r.slot]! + r.ox * (1 - e), y = CY[r.slot]! + r.oy * (1 - e);
        if (x < x0 || x > x1 || y < y0 || y > y1 || SF[r.slot]! <= 0) continue;
        const len = Math.hypot(r.ox, r.oy) || 1, tl = Math.min(24, len * e);
        strandB[C_GOLD * NA + 2]!.push(x, y, x + (r.ox / len) * tl, y + (r.oy / len) * tl);
        ctx.globalAlpha = 0.95; ctx.drawImage(sprite(C_WARM), x - 6, y - 6, 12, 12);
      }
      // Звёзды.
      const haloStep = n > haloMax ? Math.ceil((n / haloMax) * 4) / 4 : 0; // доля ореолов: по метке звезды 0..3
      const haloKeep = haloStep ? Math.max(1, Math.floor(4 / haloStep)) : 4;
      for (let i = 0; i < n; i++) {
        const sl = SLOT[i]!, cx = CX[sl]!, cy = CY[sl]!, x = cx + X[i]!, y = cy + Y[i]!, sf = SF[sl]!;
        if (sf <= 0 || x < x0 || x > x1 || y < y0 || y > y1) continue;
        const age = AGE[i]!, life = LIFE[i]!, t = age / life, kind = KIND[i]!, w = WID[i]!;
        const col = CHG[i]! > 0 && t > CHG[i]! ? COL2[i]! : COL[i]!;
        let a: number;
        if (kind === 6 || kind === 7) a = t < 0.4 ? 0.95 : 0.95 * Math.pow(1 - (t - 0.4) / 0.6, 2.2); // ветви гаснут вместе с куполом
        else if (kind === 4) a = 0.8 * (1 - t) * (1 - t);
        else a = t < 0.06 ? 0.7 + 5 * t : Math.pow(1 - t, 1.25);
        const fr = FR[i]!;
        if (kind === 1 && t > 0.3) { if ((age * fr + PH[i]! / 6.2832) % 1 > 0.32) continue; a = Math.max(a, 0.75); }
        else if (fr > 0 && t > 0.45) a *= 0.4 + 0.6 * Math.abs(Math.sin(age * fr + PH[i]!));
        a *= sf;
        if (a <= 0.04) continue;
        const al = alphaLevel(a);
        if ((kind !== 1 || t <= 0.3) && (kind < 6 || t < 0.55)) trailB[((kind === 4 ? 0 : 1) * NC + col) * NA + Math.min(NA - 1, al + (kind === 4 ? 1 : 0))]!.push(cx + PX[i]!, cy + PY[i]!, x, y);
        if (kind === 4) continue;
        const hc = HC[i]!;
        if (hc) {
          // Ветвь: путь за последние ~0,6 с, бледнее к хвосту.
          const o = i * HN;
          let xa = x, ya = y;
          for (let q = 0; q < hc; q++) {
            const xb = cx + HX[o + q]!, yb = cy + HY[o + q]!, aa = a * (1 - (q + 0.5) / HN) * 0.65;
            if (aa > 0.04) strandB[col * NA + alphaLevel(aa)]!.push(xa, ya, xb, yb);
            xa = xb; ya = yb;
          }
        }
        // Головка: ядро (в первые мгновения светлее) и ореол-спрайт; в первые кадры ореол меньше — шар, а не комок.
        coreB[((t < 0.1 ? 1 : 0) * NC + col) * NA + al]!.push(x, y);
        if (HALO[i]! < haloKeep) {
          const s = w * (t < 0.1 ? 1.5 : 2) * (kind === 7 ? 1.3 : 1);
          ctx.globalAlpha = a * (t < 0.1 ? 0.55 : kind === 1 ? 1 : 0.85);
          ctx.drawImage(sprite(col), x - s, y - s, s * 2, s * 2);
        }
      }
      ctx.globalAlpha = 1;
      tctx.lineCap = "round"; ctx.lineCap = "round";
      for (let b = 0; b < trailB.length; b++) {
        const s = trailB[b]!;
        if (!s.length) continue;
        const a = b % NA, rest = (b - a) / NA, col = rest % NC, th = (rest - col) / NC, [h, sat, l] = COLORS[col]!;
        tctx.strokeStyle = `hsla(${h},${sat}%,${Math.min(80, l + 6)}%,${(ALPHAS[a] * 0.9).toFixed(3)})`;
        tctx.lineWidth = th === 0 ? 1.2 : 2.2;
        tctx.beginPath();
        for (let j = 0; j < s.length; j += 4) { tctx.moveTo(s[j]!, s[j + 1]!); tctx.lineTo(s[j + 2]!, s[j + 3]!); }
        tctx.stroke();
        s.length = 0;
      }
      ctx.lineWidth = 1.5;
      for (let b = 0; b < strandB.length; b++) {
        const s = strandB[b]!;
        if (!s.length) continue;
        const a = b % NA, col = (b - a) / NA, [h, sat, l] = COLORS[col]!;
        ctx.strokeStyle = `hsla(${h},${sat}%,${Math.min(80, l + 4)}%,${ALPHAS[a]})`;
        ctx.beginPath();
        for (let j = 0; j < s.length; j += 4) { ctx.moveTo(s[j]!, s[j + 1]!); ctx.lineTo(s[j + 2]!, s[j + 3]!); }
        ctx.stroke();
        s.length = 0;
      }
      ctx.lineWidth = 2.1;
      for (let b = 0; b < coreB.length; b++) {
        const s = coreB[b]!;
        if (!s.length) continue;
        const a = b % NA, rest = (b - a) / NA, col = rest % NC, hot = (rest - col) / NC, [h, sat, l] = COLORS[col]!;
        ctx.strokeStyle = hot ? `hsla(${h},${Math.round(sat * 0.7)}%,86%,${ALPHAS[a]})` : `hsla(${h},${sat}%,${Math.min(86, l + 16)}%,${ALPHAS[a]})`;
        ctx.beginPath();
        for (let j = 0; j < s.length; j += 2) { ctx.moveTo(s[j]!, s[j + 1]!); ctx.lineTo(s[j]! + 0.02, s[j + 1]!); }
        ctx.stroke();
        s.length = 0;
      }
      ctx.globalCompositeOperation = "source-over"; tctx.globalCompositeOperation = "source-over";
    };

    /** Вуаль над картой: плавно входит и уходит; в канонаду чуть темнее. */
    const setVeil = () => {
      const base = VEIL_NIGHT + (VEIL_DAY - VEIL_NIGHT) * bright;
      const vv = Math.round(Math.min(1, base + VEIL_BARRAGE * barrageE) * energy * 1000) / 1000;
      if (Math.abs(vv - veilNow) >= 0.003 || (vv === 0 && veilNow !== 0)) { veilNow = vv; veilEl.style.opacity = String(vv); }
    };

    // ——— Запуск и остановка цикла кадров ———
    const shouldBurn = () => victoryFxOn(winRef.current, clockRef.current(), tzRef.current);
    const under = coverGate();
    const reset = () => { n = 0; rockets.length = 0; glows.length = 0; queue.length = 0; brightEnds.length = 0; recent.length = 0; energy = 0; barrageE = 0; };
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
        stats.frameMs = Math.round(frameMs * 100) / 100; stats.frames = sumFrames; stats.barrage = barrageEnd > 0 || T - lastEnd < 3; stats.calm = barrageEnd < 0 && T - lastEnd > 3;
        stats.T = Math.round(T * 10) / 10; stats.rockets = rockets.length; stats.veil = veilNow;
      }
    };
    const start = () => {
      if (running) return;
      running = true; stopping = false; last = 0; checked = -1e9; brightAt = -1e9;
      reset(); T = 0; nextEvent = 0.05; nextBarrage = rnd(8, 12); barrageEnd = -1; finalDone = true;
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
