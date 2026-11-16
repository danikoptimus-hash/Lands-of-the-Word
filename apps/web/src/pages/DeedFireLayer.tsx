import { useEffect, useRef } from "react";
import { coverGate } from "../lib/mapCover";
import type { Viewport } from "./MapLayers";

/**
 * Огонь приоритетного дела (решение владельца 14.11: «свиток как бы горит огнём, анимация») — на холсте, как остальные
 * живые предметы карты (живность, туман, салют).
 *
 * Почему холст. Сначала огонь был частью слоя меток (SVG) и двигался через CSS: пятнадцать движущихся частей на огонёк.
 * Каждое их движение заставляло браузер заново записывать и раскладывать весь слой меток — больше тысячи узлов, размером
 * с экран, — на каждый кадр экрана: замер 16.11 — один огонёк давал 54 перерисовки слоя в секунду и 120 мс работы главного
 * потока в секунду на быстром процессоре, три огня — 230 мс; столько же, когда огонь был за краем экрана, и чуть меньше —
 * под открытым листом. Без огней слой меток в покое не стоит ничего: его для того и держат неподвижным, а размеры знаков
 * при жесте обновляют не чаще раза в 120 мс (см. WorldSvg). Владелец 16.11: «после огоньков карта фризит».
 * Вдобавок слой с движущимися частями браузер рисовал упрощённо: все метки дел на карте (и без огня) выходили бледнее
 * и тоньше обычных. Поэтому правило: внутри слоя меток ничего не движется — ни CSS-анимацией, ни иначе.
 *
 * Как теперь. Два холста: `back` лежит под слоем меток (зарево, большие языки, искры — за кружком метки), `front` — над
 * ним (малые языки заходят на нижние края кружка). Рисунок и движение те же, что были в CSS: те же контуры, цвета,
 * длительности и сдвиги мерцаний. Рисуется не чаще 30 раз в секунду и только то, что в кадре; при движении карты — на
 * каждый кадр, чтобы огонь не отставал от метки; под листом, закрывшим карту, и в скрытой вкладке не рисуется вовсе.
 *
 * Порядок слоёв прежний: подписи городов и метки команды в слое меток лежат выше значков дел (решение владельца 04.11),
 * поэтому верхний холст вырезает из огня места под ними (`covers`) — язык пламени поверх подписи не ложится.
 */
export interface DeedFireSpec { /** Центр метки в единицах карты. */ x: number; y: number; /** Радиус кружка метки (12 — обычный знак). */ r: number }
/** То, что в слое меток нарисовано выше значков дел: плашка подписи или кружок метки команды. */
export interface FireCover { /** Опорная точка в единицах карты. */ x: number; y: number; /** Плашка в единицах подписи (на экране — как --inv слоя меток): левый верхний угол, размеры, радиус углов. */ bx: number; by: number; w: number; h: number; rad: number }

type Layer = "out" | "in" | "core";
type TongueDef = [layer: Layer, bx: number, by: number, w: number, h: number, lean: number, flick: number];
/** Языки позади кружка радиуса 12: [слой, основание x, y, ширина, высота, наклон, номер мерцания]. Основания спрятаны за кружком. */
const FIRE_BACK: TongueDef[] = [
  ["out", -9.5, -1, 14, 23, -3, 2], ["out", 9.5, -2, 14, 25, 2.6, 1], ["out", 0.5, -4, 20, 31, 1.5, 0],
  ["in", -9, -3.5, 8.5, 14, -1.8, 1], ["in", 9, -4.5, 8.5, 15.5, 1.8, 3], ["in", 0.5, -7, 12, 20, 1, 2],
  ["core", 0.5, -10, 6.5, 11, 0.6, 4],
];
/** Языки поверх кружка: огонь заходит на нижние края метки с двух сторон — горит сам свиток, а не костёр за ним. */
const FIRE_FRONT: TongueDef[] = [
  ["out", -9.2, 11.2, 7.5, 11.5, -2.4, 3], ["in", -9.3, 11, 4.2, 6.5, -1.4, 1],
  ["out", 9.4, 11.4, 7.5, 12.5, 2.6, 4], ["in", 9.5, 11.2, 4.2, 7, 1.5, 2],
];
/** Язык пламени каплей: основание (bx, by), ширина w, высота h, наклон вершины lean. */
function tonguePath(bx: number, by: number, w: number, h: number, lean: number): string {
  const f = (n: number) => n.toFixed(2);
  return `M${f(bx - w / 2)},${f(by)} C${f(bx - w / 2)},${f(by - h * 0.42)} ${f(bx + lean - w * 0.16)},${f(by - h * 0.62)} ${f(bx + lean)},${f(by - h)} `
    + `C${f(bx + lean + w * 0.1)},${f(by - h * 0.58)} ${f(bx + w / 2)},${f(by - h * 0.4)} ${f(bx + w / 2)},${f(by)} C${f(bx + w / 2)},${f(by + w * 0.42)} ${f(bx - w / 2)},${f(by + w * 0.42)} ${f(bx - w / 2)},${f(by)}Z`;
}
const COLORS: Record<Layer, Array<[number, string]>> = {
  out: [[0, "#b3261a"], [0.55, "#e2571c"], [1, "#f59e0b"]],
  in: [[0, "#f97316"], [0.6, "#fbbf24"], [1, "#fde68a"]],
  core: [[0, "#fcd34d"], [1, "#fffbe6"]],
};
/** Мерцания языков: длительность, сдвиг начала (с) и опорные кадры [доля, растяжение по x, по y, наклон в градусах]. */
type Key = [at: number, sx: number, sy: number, skew: number];
const K0: Key[] = [[0, 1, 1, 0], [0.22, 0.9, 1.22, -7], [0.48, 1.08, 0.86, 4], [0.74, 0.94, 1.14, 8], [1, 1, 1, 0]];
const K1: Key[] = [[0, 1, 0.9, 4], [0.3, 0.86, 1.26, -8], [0.62, 1.1, 0.84, -2], [0.84, 0.95, 1.15, 6], [1, 1, 0.9, 4]];
const K2: Key[] = [[0, 0.96, 1.1, -5], [0.26, 1.1, 0.84, 3], [0.55, 0.88, 1.24, 8], [0.8, 1.04, 0.96, -4], [1, 0.96, 1.1, -5]];
const FLICKS: Array<{ dur: number; delay: number; keys: Key[] }> = [
  { dur: 0.95, delay: 0, keys: K0 }, { dur: 0.8, delay: -0.3, keys: K1 }, { dur: 1.1, delay: -0.7, keys: K2 },
  { dur: 1.25, delay: -1.1, keys: K1 }, { dur: 0.7, delay: -0.5, keys: K2 },
];
/** Искры: центр, радиус, длительность и сдвиг начала (с). Летят вверх и вправо, загораясь и угасая. */
const SPARKS: Array<{ cx: number; cy: number; r: number; dur: number; delay: number }> = [
  { cx: -6, cy: -24, r: 1.4, dur: 1.7, delay: 0 }, { cx: 7, cy: -27, r: 1.2, dur: 2.1, delay: -0.6 }, { cx: 1, cy: -34, r: 1.1, dur: 1.4, delay: -1.2 },
];
const GLOW = { cy: -6, r: 33, dur: 1.5 };
/** Края огня в его собственных единицах, с запасом на размах мерцания: нижний холст — зарево и взлёт искр, верхний — малые языки. По ним чистится холст. */
const BOXES = { back: { x0: -40, x1: 40, y0: -54, y1: 34 }, front: { x0: -18, x1: 18, y0: -7, y1: 17 } };

/** Плавность «ease-in-out» из CSS: кубическая кривая (0.42, 0, 0.58, 1). */
function easeInOut(u: number): number {
  if (u <= 0) return 0; if (u >= 1) return 1;
  const x1 = 0.42, x2 = 0.58, bx = (s: number) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  let lo = 0, hi = 1, s = u;
  for (let i = 0; i < 14; i++) { const x = bx(s); if (Math.abs(x - u) < 1e-4) break; if (x < u) lo = s; else hi = s; s = (lo + hi) / 2; }
  return 3 * (1 - s) * s * s + s * s * s; // y1 = 0, y2 = 1
}
const phase = (t: number, dur: number, delay: number) => { const p = ((t - delay) % dur) / dur; return p < 0 ? p + 1 : p; };
/** Положение мерцания в момент t: между опорными кадрами — плавно, как в CSS. */
function flickAt(f: { dur: number; delay: number; keys: Key[] }, t: number): [number, number, number] {
  const p = phase(t, f.dur, f.delay);
  let i = 1; while (i < f.keys.length - 1 && f.keys[i]![0] < p) i++;
  const a = f.keys[i - 1]!, b = f.keys[i]!, u = easeInOut((p - a[0]) / (b[0] - a[0]));
  return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, (a[3] + (b[3] - a[3]) * u) * Math.PI / 180];
}

interface Tongue { layer: Layer; path: Path2D; ox: number; oy: number; top: number; flick: number }
const build = (list: TongueDef[]): Tongue[] => list.map(([layer, bx, by, w, h, lean, flick]) => ({
  layer, flick, path: new Path2D(tonguePath(bx, by, w, h, lean)),
  // Движение языка — вокруг середины его основания (нижний край контура), краска — от основания к вершине.
  ox: bx, oy: by + w * 0.315, top: by - h,
}));

/** Размер знака дела на экране при масштабе k — та же формула, что у переменной --inv-mark слоя меток (MapLayers). */
const markScale = (k: number) => Math.max(2.6, Math.min(12, 2.4 * k)) / 12;

const NO_COVERS: FireCover[] = [];
export function DeedFireLayer({ vp, fires, part, covers = NO_COVERS }: { vp: Viewport; fires: DeedFireSpec[]; part: "back" | "front"; /** Что лежит выше значков дел (нужно только верхнему холсту). */ covers?: FireCover[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const firesRef = useRef(fires); firesRef.current = fires;
  const coversRef = useRef(covers); coversRef.current = covers;
  const dirty = useRef(true); dirty.current = true;
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // как у живности: на экране тройной плотности огонь чуть мягче, глазом не отличить
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tongues = build(part === "back" ? FIRE_BACK : FIRE_FRONT), BOX = BOXES[part];
    const grads = tongues.map((tg) => { const g = ctx.createLinearGradient(0, tg.oy, 0, tg.top); for (const [at, c] of COLORS[tg.layer]) g.addColorStop(at, c); return g; });
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, GLOW.r);
    glow.addColorStop(0, "rgba(251, 191, 36, .8)"); glow.addColorStop(0.5, "rgba(245, 158, 11, .36)"); glow.addColorStop(1, "rgba(245, 158, 11, 0)");
    /** Что нарисовано в прошлом кадре (в точках холста): чистим только эти места, а не весь холст. */
    const drawn: Array<[number, number, number, number]> = [];
    let W = 0, H = 0;
    // Список нарисованного и сам холст сбрасываются только вместе. Ошибка 16.11 (владелец: «при зуме остаются отпечатки
    // других огоньков»): наблюдатель размера срабатывает и сразу после подключения, уже после первого кадра огня; список
    // тогда обнулялся, а холст того же размера не очищался — первый кадр оставался на нём навсегда, если карта в этот
    // миг двигалась (слой создаётся посреди щипка, когда масштаб проходит порог показа меток дел).
    const resize = () => {
      const w = Math.round(host.clientWidth * dpr), h = Math.round(host.clientHeight * dpr);
      if (w === W && h === H) return;
      W = w; H = h; canvas.width = w; canvas.height = h; // смена размера очищает холст
      drawn.length = 0; dirty.current = true;
    };
    const flick: Array<[number, number, number]> = FLICKS.map(() => [1, 1, 0]);
    const draw = (now: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const [x, y, w, h] of drawn) ctx.clearRect(x, y, w, h);
      drawn.length = 0;
      const { k, tx, ty } = vp.viewRef.current;
      const t = now / 1000, ms = markScale(k);
      if (!reduced) for (let i = 0; i < FLICKS.length; i++) flick[i] = flickAt(FLICKS[i]!, t);
      // Зарево: дышит размером и яркостью.
      const gu = reduced ? 1 : easeInOut(1 - Math.abs(1 - 2 * phase(t, GLOW.dur, 0))), gs = reduced ? 1 : 0.86 + 0.26 * gu, ga = reduced ? 1 : 0.6 + 0.4 * gu;
      for (const f of firesRef.current) {
        const s = ms * (f.r / 12) * dpr, X = (f.x * k + tx) * dpr, Y = (f.y * k + ty) * dpr;
        const x0 = X + BOX.x0 * s, y0 = Y + BOX.y0 * s, x1 = X + BOX.x1 * s, y1 = Y + BOX.y1 * s;
        if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) continue; // за краем экрана
        drawn.push([Math.floor(x0) - 1, Math.floor(y0) - 1, Math.ceil(x1 - x0) + 3, Math.ceil(y1 - y0) + 3]);
        ctx.setTransform(s, 0, 0, s, X, Y);
        if (part === "back") {
          ctx.save(); ctx.globalAlpha = ga; ctx.translate(0, GLOW.cy); ctx.scale(gs, gs); ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(0, 0, GLOW.r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
        for (let i = 0; i < tongues.length; i++) {
          const tg = tongues[i]!, [sx, sy, skew] = flick[tg.flick]!;
          ctx.save(); ctx.translate(tg.ox, tg.oy); ctx.scale(sx, sy); if (skew) ctx.transform(1, 0, Math.tan(skew), 1, 0, 0); ctx.translate(-tg.ox, -tg.oy);
          ctx.fillStyle = grads[i]!; ctx.fill(tg.path);
          if (tg.layer === "out") { ctx.strokeStyle = "rgba(122, 38, 14, .5)"; ctx.lineWidth = 0.6; ctx.stroke(tg.path); }
          ctx.restore();
        }
        if (part === "back") {
          ctx.fillStyle = "#ffd27a";
          for (const sp of SPARKS) {
            // Без движения искры стоят на месте, чуть приглушённые (как было при «уменьшить движение»).
            const p = reduced ? 0 : phase(t, sp.dur, sp.delay);
            const a = reduced ? 0.8 : p < 0.15 ? p / 0.15 : p < 0.65 ? 1 - 0.15 * (p - 0.15) / 0.5 : 0.85 * (1 - (p - 0.65) / 0.35);
            if (a <= 0.01) continue;
            const sc = reduced ? 1 : 0.7 - 0.4 * p, dx = reduced ? 0 : 3.5 * p, dy = reduced ? 0 : 5 - 21 * p, lx = sp.cx - sp.r, ly = sp.cy - sp.r;
            ctx.save(); ctx.globalAlpha = a; ctx.translate(dx + lx, dy + ly); ctx.scale(sc, sc); ctx.translate(-lx, -ly);
            ctx.beginPath(); ctx.arc(sp.cx, sp.cy, sp.r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
          }
        }
      }
      // Подписи и метки команды лежат выше значков дел: под ними огня не видно — вырезаем эти места.
      if (drawn.length && coversRef.current.length) {
        const ui = Math.min(1, Math.max(0.5, k / 1.6)) * dpr; // размер подписей на экране — множитель --inv слоя меток (WorldSvg)
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "#000";
        for (const c of coversRef.current) {
          // Полточки запаса — обводка плашки.
          const x0 = (c.x * k + tx) * dpr + (c.bx - 0.5) * ui, y0 = (c.y * k + ty) * dpr + (c.by - 0.5) * ui, w = (c.w + 1) * ui, h = (c.h + 1) * ui;
          let hit = false;
          for (const d of drawn) if (x0 < d[0] + d[2] && x0 + w > d[0] && y0 < d[1] + d[3] && y0 + h > d[1]) { hit = true; break; }
          if (!hit) continue;
          const r = Math.min((c.rad + 0.5) * ui, w / 2, h / 2);
          ctx.beginPath(); ctx.moveTo(x0 + r, y0); ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r); ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r); ctx.arcTo(x0, y0 + h, x0, y0, r); ctx.arcTo(x0, y0, x0 + w, y0, r); ctx.closePath(); ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(host);
    const unsub = vp.subscribe(() => { dirty.current = true; });
    const under = coverGate();
    let raf = 0, last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || host.classList.contains("storm")) return; // в шторм метки дел скрыты — и огонь тоже (player.css)
      if (!dirty.current && under(now)) return; // карта под листом — lib/mapCover.ts
      // Карта движется или сменились огни — рисуем в этом же кадре; в покое — не чаще 30 раз в секунду, без движения — вовсе нет.
      if (!dirty.current && (reduced || now - last < 33)) return;
      dirty.current = false; last = now;
      draw(now);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); unsub(); };
  }, [part, vp.subscribe, vp.viewRef]);
  return <canvas ref={ref} className={"fx-layer deed-fire " + part} aria-hidden="true" />;
}
