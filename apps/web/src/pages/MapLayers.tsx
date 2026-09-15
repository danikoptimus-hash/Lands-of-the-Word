import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { FOG_COLOR, HEX_SIZE, TERRAIN_COLOR, coastPath, hexCenter, hexPoints } from "../lib/hexmap";
import { CLOUD_TILE, cloudTile, seaTiles, type SeaTiles } from "../lib/noise";
import type { View } from "../lib/useViewport";
import type { MapHexDto } from "../lib/api";
import { ISLET_IMAGES } from "@lotw/domain";
import { SeaGL } from "./SeaGL";
import { seabedColor, type Seabed } from "./Seabed";

export const IMG = {
  terrain: (t: string) => `/img/terrain/${t}.webp`,
  /** Остров: в адресе хеш содержимого файла, чтобы после замены картинки браузер и PWA не показывали старую копию из кеша. */
  islet: (n: number) => { const v = ISLET_IMAGES.find((s) => s.img === n)?.ver; return `/img/islet/islet-${n}.webp${v ? `?v=${v}` : ""}`; },
  city: (type: string | null | undefined) => `/img/city/${type && type !== "" ? type : "village"}.webp`,
  start: (i: number) => `/img/start/${["babylon", "egypt", "wilderness", "assyria", "zin", "shipwreck"][i % 6]}.webp`,
};

export type Viewport = { view: View; viewRef: { current: View }; subscribe: (fn: (v: View) => void) => () => void };
// subscribe и viewRef у useViewport стабильны, поэтому эффекты зависят от них, а не от объекта vp (он новый при каждой перерисовке).

/**
 * Море: canvas в пикселях экрана под картой, без картинок. Ровный цвет воды, две сети бликов-каустики (клеточный
 * шум, `seaTiles`) разного масштаба и направления, плывущие навстречу и медленно «дышащие» яркостью, и крупная
 * зыбь. Всё рисуется узорами с точной привязкой к координатам карты на каждом изменении вида, поэтому при
 * зуме подложка не перекладывается и не прыгает; ~20 кадров в секунду для дрейфа, пауза в скрытой вкладке.
 */
const SEA_TILE_WORLD = 340;
const SEA_LAYERS: ReadonlyArray<{ tile: keyof SeaTiles; scale: number; angle: number; vx: number; vy: number; alpha: number; breathe: number; phase: number }> = [
  // Масштабы 1 : 1.618 : 2.7 несоизмеримы — периоды слоёв не совпадают, и глаз не находит повтора.
  { tile: "swell", scale: 2.7, angle: 111, vx: 0.6, vy: -0.4, alpha: 0.85, breathe: 0, phase: 0 },
  { tile: "causticA", scale: 1, angle: 0, vx: 1.6, vy: 1.1, alpha: 0.24, breathe: 0.3, phase: 0 },
  { tile: "causticB", scale: 1.618, angle: 37, vx: -1.3, vy: 0.9, alpha: 0.17, breathe: 0.35, phase: 2.1 },
];
/** Море: WebGL-шейдер (SeaGL) без плиток; если WebGL недоступен — узоры на canvas 2D (SeaCanvas). */
export function SeaLayer({ vp, bed = null }: { vp: Viewport; bed?: Seabed | null }) {
  const [gl, setGl] = useState(true);
  return gl ? <SeaGL vp={vp} bed={bed} onUnsupported={() => setGl(false)} /> : <SeaCanvas vp={vp} bed={bed} />;
}
function SeaCanvas({ vp, bed }: { vp: Viewport; bed: Seabed | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const tiles = seaTiles();
    const patterns = SEA_LAYERS.map((l) => ctx.createPattern(tiles[l.tile], "repeat")!);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // воде хватает: экономим заливку на телефонах
    let W = 0, H = 0, dirty = true, raf = 0, lastDraw = 0;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } dirty = true; };
    const draw = (now: number) => {
      const { k, tx, ty } = vpRef.current.viewRef.current;
      const t = still ? 0 : now / 1000;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#3A82A4"; ctx.fillRect(0, 0, W, H);
      ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
      const x0 = -tx / k, y0 = -ty / k, w = W / dpr / k, h = H / dpr / k;
      if (bed) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(seabedColor(bed), bed.x, bed.y, bed.w, bed.h); }
      SEA_LAYERS.forEach((l, i) => {
        const s = (SEA_TILE_WORLD * l.scale) / CLOUD_TILE;
        patterns[i]!.setTransform(new DOMMatrix().translate(l.vx * t, l.vy * t).rotate(l.angle).scale(s));
        ctx.globalAlpha = l.alpha * (1 - l.breathe * 0.5 + l.breathe * 0.5 * Math.sin(t * 0.35 + l.phase));
        ctx.globalCompositeOperation = l.tile === "swell" ? "source-over" : "lighter"; // блики складываются светом, а не закрашивают
        ctx.fillStyle = patterns[i]!;
        ctx.fillRect(x0, y0, w, h);
      });
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (!dirty && (still || now - lastDraw < 50)) return;
      dirty = false; lastDraw = now; draw(now);
    };
    const unsub = vpRef.current.subscribe(() => { dirty = true; });
    const ro = new ResizeObserver(resize); ro.observe(host);
    resize(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); unsub(); ro.disconnect(); };
  }, [vp.subscribe, vp.viewRef, bed]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="fx-layer sea" aria-hidden="true" />;
}

/**
 * Мир карты: SVG размером с экран (плюс запас PAD вокруг), viewBox — видимая область карты под зафиксированный
 * масштаб (vp.view). Между фиксациями композитор двигает и масштабирует готовый растр CSS-трансформацией; после
 * жеста viewBox пересчитывается и слой растрируется заново один раз — но растр всегда не больше экрана с запасом,
 * на любом масштабе (решение владельца 15.09: SVG размером со всю карту при приближении «фризил» зум).
 * CSS-переменные --k (толщины линий), --inv и --inv-isl (размер экранных элементов) обновляются по ходу жеста
 * не чаще VAR_MS — каждое обновление перерисовывает слой, и на каждый кадр это дорого.
 */
const PAD = 0.75, VAR_MS = 120;
export function WorldSvg({ vp, children, overlay }: { vp: Viewport; bounds?: { minX: number; minY: number; width: number; height: number }; children: React.ReactNode; /** Верхний слой подписей: сам SVG не ловит нажатия, только его интерактивные дети. */ overlay?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const base = vp.view;
  const baseRef = useRef(base); baseRef.current = base;
  const pad = Math.ceil(Math.max(box.w, box.h) * PAD);
  const lastVars = useRef(0);
  const setVars = (el: SVGSVGElement, k: number) => {
    const ui = Math.min(1, Math.max(0.5, k / 1.6));
    el.style.setProperty("--k", k.toFixed(4));
    el.style.setProperty("--inv", (ui / k).toFixed(5));
    el.style.setProperty("--inv-isl", (Math.max(ui, 0.7) / k).toFixed(5));
  };
  const apply = (v: View, force = false) => {
    const el = ref.current; if (!el) return;
    const b = baseRef.current, f = v.k / b.k;
    // Растр построен под вид b: точка карты w стоит в нём на w·k0 + t0 (в CSS-пикселях контейнера); нужен вид v: w·k + t.
    const dx = v.tx - f * b.tx + pad * (1 - f), dy = v.ty - f * b.ty + pad * (1 - f);
    el.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${f.toFixed(5)})`;
    const now = performance.now();
    if (force || now - lastVars.current >= VAR_MS) { lastVars.current = now; setVars(el, v.k); }
  };
  useEffect(() => {
    const el = ref.current, host = el?.parentElement; if (!el || !host) return;
    const ro = new ResizeObserver(() => setBox({ w: host.clientWidth, h: host.clientHeight }));
    ro.observe(host); setBox({ w: host.clientWidth, h: host.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => vp.subscribe((v) => apply(v)), [vp.subscribe, pad]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { apply(vp.viewRef.current, true); }, [base, pad]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = box.w + 2 * pad, h = box.h + 2 * pad;
  const vx = (-pad - base.tx) / base.k, vy = (-pad - base.ty) / base.k;
  return (
    <svg ref={ref} className={"map-svg world" + (overlay ? " passthrough" : "")} width={w} height={h} viewBox={`${vx} ${vy} ${w / base.k} ${h / base.k}`} style={{ width: w, height: h, left: -pad, top: -pad }}>
      {children}
    </svg>
  );
}

export function useCoast(hexes: Array<{ q: number; r: number }>, size = HEX_SIZE): string {
  const key = hexes.map((h) => `${h.q},${h.r}`).join(";");
  return useMemo(() => (hexes.length ? coastPath(hexes, size) : ""), [key, size]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Берег под гексами: отмель (светлая вода), широкая полоса песка. Ширины в единицах карты, масштабируются с ней.
 * Прозрачность — на группах, а не на штрихах, чтобы самопересечения широкого штриха в бухтах не темнели.
 */
/**
 * Отмель: много тонких колец от дальнего края к берегу; прозрачность каждого подобрана так, чтобы суммарная плотность
 * росла плавно (≈ 0.7·u^1.6, u — доля пути от края отмели к песку). Кольца узкие, ступенек глазом не видно;
 * кольца рисует слой берега на canvas (`Islets.tsx`) и размывает на шаг между ними — сплошной градиент (решение
 * владельца 15.09: без полос). Ширина — в радиусах гекса (полная ширина штриха, по обе стороны линии берега).
 */
export const SHALLOW_RINGS: ReadonlyArray<{ color: string; width: number; alpha: number }> = (() => {
  const N = 28, outer = 3.4, inner = 1.05;
  const out: { color: string; width: number; alpha: number }[] = [];
  let prev = 0;
  for (let j = 1; j <= N; j++) {
    const u = j / N, total = 0.7 * Math.pow(u, 1.6);
    const alpha = 1 - (1 - total) / (1 - prev); prev = total;
    const t = (j - 1) / (N - 1);
    const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
    out.push({ color: `rgb(${mix(207, 226)}, ${mix(234, 243)}, ${mix(240, 246)})`, width: outer + (inner - outer) * t, alpha });
  }
  return out;
})();

/** Центр и радиус каждого острова (по центрам его гексов): для подписей и кораблей. */
export function islandGeometry(hexes: ReadonlyArray<MapHexDto>, size: number): Map<string, { x: number; y: number; r: number }> {
  const acc = new Map<string, { x: number; y: number; n: number }>();
  for (const h of hexes) { const c = hexCenter(h, size), key = h.island ?? "OT"; const a = acc.get(key) ?? { x: 0, y: 0, n: 0 }; a.x += c.x; a.y += c.y; a.n++; acc.set(key, a); }
  const out = new Map<string, { x: number; y: number; r: number }>();
  for (const [key, a] of acc) {
    const x = a.x / a.n, y = a.y / a.n;
    let r = 0;
    for (const h of hexes) if ((h.island ?? "OT") === key) { const c = hexCenter(h, size); r = Math.max(r, Math.hypot(c.x - x, c.y - y)); }
    out.set(key, { x, y, r: r + size });
  }
  return out;
}

/**
 * Подпись острова по дуге вдоль нижнего берега, как на старых картах (выбор владельца 15.09 из шести вариантов):
 * дуга радиусом r (в координатах группы подписи) с центром в центре острова, текст по середине дуги.
 * Светлые буквы с мягкой тёмной тенью читаются на воде и не спорят с номерами городов.
 */
export function IslandLabel({ name, r, id }: { name: string; r: number; id: string }) {
  // Дуга 200° по низу (сама не видна): текст стоит по её середине, длинному хватает места, короткий занимает центр.
  const phi = (100 * Math.PI) / 180;
  const x = r * Math.sin(phi), y = r * Math.cos(phi);
  return (
    <>
      <defs><path id={id} d={`M ${(-x).toFixed(1)} ${y.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${x.toFixed(1)} ${y.toFixed(1)}`} /></defs>
      <text><textPath href={`#${id}`} startOffset="50%" textAnchor="middle">{name}</textPath></text>
    </>
  );
}

/** Берег над гексами: песок, плавно растворяющийся в местность (двенадцать узких колец), и тёмная линия влажного песка у воды. */
export function CoastOver({ d, size = HEX_SIZE, scale = 1 }: { d: string; size?: number; scale?: number }) {
  if (!d) return null;
  const s = size * scale;
  const N = 12;
  return (
    <g className="coast" fill="none" strokeLinejoin="round" strokeLinecap="round">
      <path d={d} stroke="#E6D3A6" strokeWidth={s * 0.5} />
      {Array.from({ length: N }, (_, i) => { const t = (i + 1) / N; return <path key={i} d={d} stroke="#E6D3A6" strokeOpacity={0.55 * (1 - t) * (1 - t) + 0.06} strokeWidth={s * (0.5 + 0.65 * t)} />; })}
      <g opacity={0.35}><path className="coast-wet" d={d} stroke="#B8975E" /></g>
    </g>
  );
}

interface FogMask { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number }
const FOG_BASE = "#C9C0B0";
let tiles: { s: HTMLCanvasElement; a: HTMLCanvasElement; b: HTMLCanvasElement } | null = null;
/** Три плитки: тень в «долинах» облака, светлая масса, белые верхушки. */
const getTiles = () => (tiles ??= { s: cloudTile([176, 166, 150], 0, 0.55, 1.5), a: cloudTile([240, 236, 228], 0.2, 1, 1.35), b: cloudTile([255, 255, 255], 0, 0.8, 2.3) });

/** Маска тумана в координатах карты: гексы тумана с расширением и растушёвкой (уменьшение-увеличение вместо blur — работает везде). */
function buildFogMask(hexes: MapHexDto[], size: number): FogMask | null {
  if (hexes.length === 0) return null;
  const pad = size * 3;
  const cs = hexes.map((h) => hexCenter(h, size));
  const x = Math.min(...cs.map((c) => c.x)) - size - pad, y = Math.min(...cs.map((c) => c.y)) - size - pad;
  const w = Math.max(...cs.map((c) => c.x)) + size + pad - x, h = Math.max(...cs.map((c) => c.y)) + size + pad - y;
  const ms = Math.min(1, Math.sqrt(2.5e6 / (w * h)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * ms); canvas.height = Math.ceil(h * ms);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(ms, ms); ctx.translate(-x, -y);
  const poly = new Path2D();
  for (const c of cs) {
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 180) * (60 * i - 30); const px = c.x + Math.cos(a) * size, py = c.y + Math.sin(a) * size; if (i === 0) poly.moveTo(px, py); else poly.lineTo(px, py); }
    poly.closePath();
  }
  ctx.fillStyle = "#000"; ctx.strokeStyle = "#000"; ctx.lineJoin = "round"; ctx.lineWidth = size * 0.5;
  ctx.fill(poly); ctx.stroke(poly);
  // Растушёвка: два прохода через уменьшенную копию (радиус ≈ 8–10 единиц карты).
  for (const f of [4, 8]) {
    const tmp = document.createElement("canvas");
    tmp.width = Math.max(1, Math.round(canvas.width / f)); tmp.height = Math.max(1, Math.round(canvas.height / f));
    const tc = tmp.getContext("2d")!; tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = "high";
    tc.drawImage(canvas, 0, 0, tmp.width, tmp.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  }
  // Кромка маски всегда прозрачна: иначе при растяжении маски по краю проступала бы рамка.
  ctx.clearRect(0, 0, canvas.width, 2); ctx.clearRect(0, canvas.height - 2, canvas.width, 2);
  ctx.clearRect(0, 0, 2, canvas.height); ctx.clearRect(canvas.width - 2, 0, 2, canvas.height);
  return { canvas, x, y, w, h };
}

/**
 * Облака тумана поверх карты (canvas, без событий). Рисуется в пониженном разрешении (облака и так размыты),
 * ~24 раза в секунду для дрейфа и сразу при каждом движении карты; только пока вкладка видна;
 * при «уменьшить движение» — без дрейфа. Вид читается из ref, без React.
 */
export function FogLayer({ vp, size = HEX_SIZE, fogHexes }: { vp: Viewport; size?: number; fogHexes: MapHexDto[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fogKey = fogHexes.map((h) => `${h.q},${h.r}`).join(";");
  const mask = useMemo(() => (fogHexes.length ? buildFogMask(fogHexes, size) : null), [fogKey, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const maskRef = useRef(mask); maskRef.current = mask;
  const dirty = useRef(true); dirty.current = true;

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } dirty.current = true; };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(host);
    const unsub = vp.subscribe(() => { dirty.current = true; });
    const viewRef = vp.viewRef;
    let pats: { s: CanvasPattern; a: CanvasPattern; b: CanvasPattern } | null = null;
    const draw = (t: number) => {
      const { k, tx, ty } = viewRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      const m = maskRef.current;
      if (!m) return;
      ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
      // Видимая часть тумана в координатах карты — вне её ничего не рисуем.
      const vx0 = -tx / k, vy0 = -ty / k, vx1 = (W / dpr - tx) / k, vy1 = (H / dpr - ty) / k;
      const bx = Math.max(m.x, vx0), by = Math.max(m.y, vy0), bw = Math.min(m.x + m.w, vx1) - bx, bh = Math.min(m.y + m.h, vy1) - by;
      if (bw <= 0 || bh <= 0) return;
      pats ??= (() => { const tl = getTiles(); return { s: ctx.createPattern(tl.s, "repeat")!, a: ctx.createPattern(tl.a, "repeat")!, b: ctx.createPattern(tl.b, "repeat")! }; })();
      // Без clip(): сглаженный край области отсечения оставлял после destination-in тонкую линию по прямоугольнику маски
      // (тот самый «квадрат вокруг карты»). Заливки и так ограничены прямоугольником, а маска обнуляет всё вне тумана.
      ctx.save();
      ctx.fillStyle = FOG_BASE; ctx.fillRect(bx, by, bw, bh);
      const sec = reduced ? 0 : t / 1000;
      const layer = (pat: CanvasPattern, span: number, vx: number, vy: number, alpha: number) => {
        const sc = span / CLOUD_TILE, ox = sec * vx, oy = sec * vy;
        ctx.save(); ctx.globalAlpha = alpha; ctx.translate(ox, oy); ctx.scale(sc, sc); ctx.fillStyle = pat;
        ctx.fillRect((bx - ox) / sc, (by - oy) / sc, bw / sc, bh / sc); ctx.restore();
      };
      // Периоды плиток разные и большие (11, 14 и 7 гексов), чтобы повтор рисунка не читался.
      layer(pats.s, size * 11, -1.6, 1.2, 1);
      layer(pats.a, size * 14, 2.2, 0.9, 1);
      layer(pats.b, size * 7, -1.2, 2.8, 0.9);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(m.canvas, m.x, m.y, m.w, m.h);
      ctx.restore();
    };
    let raf = 0, last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const animated = !reduced && maskRef.current;
      if (!dirty.current && (!animated || t - last < 1000 / 24)) return;
      dirty.current = false; last = t;
      draw(t);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); unsub(); };
  }, [size, vp.subscribe, vp.viewRef]);

  return <canvas ref={ref} className="fx-layer" aria-hidden />;
}

/**
 * Обводка картинки города цветом команды: контур по прозрачности картинки (расширение альфа-канала),
 * а не круг вокруг. Один фильтр на команду; толщина в единицах карты, растёт вместе с картой.
 */
export function OutlineDefs({ colors, width = 1.6 }: { colors: string[]; width?: number }) {
  return (
    <defs>
      {colors.map((color) => (
        <filter key={color} id={`outline-${color.slice(1)}`} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feMorphology in="SourceAlpha" operator="dilate" radius={width} result="grow" />
          <feFlood floodColor={color} result="color" />
          <feComposite in="color" in2="grow" operator="in" result="ring" />
          <feMerge><feMergeNode in="ring" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      ))}
    </defs>
  );
}

const TERRAINS = ["desert", "hills", "meadow", "mountains", "water", "oasis"];

/**
 * Слой гексов. Текстуры не вставляются в каждый гекс отдельной картинкой (270 картинок с обрезкой тяжело
 * рисовать на телефоне), а задаются паттернами: по одному на местность и поворот (6 × 6). Под паттерном —
 * цвет местности, поэтому карта видна сразу, ещё до загрузки текстур. Туман — тёмные гексы.
 */
export function HexTiles({ hexes, size = HEX_SIZE, clipId, liveWater = false, fills = true }: { hexes: MapHexDto[]; size?: number; clipId: string; /** Озёра рисует WebGL-слой под миром: у гекса воды нет заливки, только граница. */ liveWater?: boolean; /** Картинки местности рисует TilesLayer (canvas под миром): у гексов только граница. */ fills?: boolean }) {
  const poly = hexPoints(size, 0.995);
  const fogPoly = hexPoints(size, 1.03);
  return (
    <>
      {fills && <defs>
        {TERRAINS.map((t) => Array.from({ length: 6 }, (_, r) => (
          <pattern key={`${t}${r}`} id={`${clipId}-${t}-${r}`} patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width={1} height={1}>
            <rect width={1} height={1} fill={TERRAIN_COLOR[t] ?? TERRAIN_COLOR.desert} />
            {/* Квадрат текстуры повёрнут вокруг центра и увеличен, чтобы закрыть углы гекса при любом повороте. */}
            <image href={IMG.terrain(t)} x={-0.2} y={-0.2} width={1.4} height={1.4} preserveAspectRatio="none" transform={`rotate(${r * 60} .5 .5)`} />
          </pattern>
        )))}
      </defs>}
      {hexes.map((h) => {
        const c = hexCenter(h, size);
        if (!h.lit && h.lit !== undefined) return <polygon key={`f${h.q},${h.r}`} className="hex-fog" points={fogPoly} transform={`translate(${c.x},${c.y})`} fill={FOG_COLOR} />;
        const t = TERRAINS.includes(h.terrain ?? "") ? h.terrain! : "desert";
        const fill = (liveWater && t === "water") || !fills ? "none" : `url(#${clipId}-${t}-${(h.rotation ?? 0) % 6})`;
        return <polygon key={`t${h.q},${h.r}`} className="hex-tile" points={poly} transform={`translate(${c.x},${c.y})`} fill={fill} vectorEffect="non-scaling-stroke" />;
      })}
    </>
  );
}

/**
 * Гексы местности на canvas под миром (решение владельца 15.09: зум «фризил» — SVG с узорами-картинками у 140 гексов
 * перерастрировался целиком при каждой фиксации масштаба). Картинки рисуются во временный растр для текущего вида с
 * запасом вокруг экрана; при перетаскивании он сдвигается, при щипке масштабируется как картинка, а заново
 * (резко, в разрешении экрана) рисуется через SETTLE_MS после того, как вид устоялся. Только открытые гексы;
 * озёра — если их не рисует WebGL. В SVG мира у гексов остаются только границы.
 */
export function TilesLayer({ vp, hexes, size = HEX_SIZE, skipWater = false }: { vp: Viewport; hexes: MapHexDto[]; size?: number; skipWater?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  const key = hexes.map((h) => `${h.q},${h.r}:${h.terrain}:${h.rotation ?? 0}:${h.lit === false ? 0 : 1}`).join(";");
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const tiles = hexes.filter((h) => h.lit !== false && !(skipWater && h.terrain === "water")).map((h) => ({ c: hexCenter(h, size), t: TERRAINS.includes(h.terrain ?? "") ? h.terrain! : "desert", rot: ((h.rotation ?? 0) % 6) * Math.PI / 3 }));
    if (!tiles.length) { canvas.width = 1; canvas.height = 1; return; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const images = new Map<string, HTMLImageElement>();
    let dirty = true, raf = 0, settle = 0, W = 0, H = 0;
    for (const t of new Set(tiles.map((x) => x.t))) { const im = new Image(); im.decoding = "async"; im.onload = () => { cache.valid = false; dirty = true; }; im.src = IMG.terrain(t); images.set(t, im); }
    const hex = new Path2D();
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 180) * (60 * i - 30), x = Math.cos(a) * size * 0.995, y = Math.sin(a) * size * 0.995; if (i === 0) hex.moveTo(x, y); else hex.lineTo(x, y); }
    hex.closePath();
    const bw = size * Math.sqrt(3), bh = size * 2; // рамка гекса; картинка — квадрат 1.4 рамки, повёрнутый, как в SVG-узоре
    const PAD = 0.5, SETTLE_MS = 140, RERENDER_MS = 100;
    let lastRender = 0;
    const cache = { canvas: document.createElement("canvas"), k: 0, tx: 0, ty: 0, pad: 0, valid: false };
    const cctx = cache.canvas.getContext("2d"); if (!cctx) return;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } cache.valid = false; dirty = true; };
    const render = (k: number, tx: number, ty: number) => {
      const pad = Math.ceil(Math.max(W, H) * PAD);
      const CW = W + 2 * pad, CH = H + 2 * pad;
      if (cache.canvas.width !== CW || cache.canvas.height !== CH) { cache.canvas.width = CW; cache.canvas.height = CH; }
      cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.clearRect(0, 0, CW, CH);
      cctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr + pad, ty * dpr + pad);
      cctx.imageSmoothingEnabled = true; cctx.imageSmoothingQuality = "high";
      const x0 = (-pad / dpr - tx) / k - size, y0 = (-pad / dpr - ty) / k - size, x1 = ((W + pad) / dpr - tx) / k + size, y1 = ((H + pad) / dpr - ty) / k + size;
      for (const tl of tiles) {
        if (tl.c.x < x0 || tl.c.x > x1 || tl.c.y < y0 || tl.c.y > y1) continue;
        cctx.save(); cctx.translate(tl.c.x, tl.c.y); cctx.clip(hex);
        cctx.fillStyle = TERRAIN_COLOR[tl.t] ?? TERRAIN_COLOR.desert!; cctx.fillRect(-bw, -bh, 2 * bw, 2 * bh);
        const im = images.get(tl.t);
        if (im && im.complete && im.naturalWidth) { cctx.rotate(tl.rot); cctx.drawImage(im, -0.7 * bw, -0.7 * bh, 1.4 * bw, 1.4 * bh); }
        cctx.restore();
      }
      Object.assign(cache, { k, tx, ty, pad, valid: true });
    };
    const draw = () => {
      const { k, tx, ty } = vpRef.current.viewRef.current;
      const dx = (tx - cache.tx) * dpr, dy = (ty - cache.ty) * dpr;
      const fresh = cache.valid && cache.k === k && Math.abs(dx) <= cache.pad && Math.abs(dy) <= cache.pad;
      // Пока идёт жест, растр всё же обновляется не чаще RERENDER_MS — иначе при щипке картинка размыта до отпускания
      // пальцев (замечание владельца 15.09); окончательный пересчёт — когда вид устоится.
      const now = performance.now();
      if (!cache.valid || (!fresh && (!settle || now - lastRender >= RERENDER_MS))) { render(k, tx, ty); lastRender = now; }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      if (cache.k === k) ctx.drawImage(cache.canvas, (tx - cache.tx) * dpr - cache.pad, (ty - cache.ty) * dpr - cache.pad);
      else { const f = k / cache.k; ctx.setTransform(f, 0, 0, f, tx * dpr - (cache.pad + cache.tx * dpr) * f, ty * dpr - (cache.pad + cache.ty * dpr) * f); ctx.drawImage(cache.canvas, 0, 0); }
    };
    const loop = () => { raf = requestAnimationFrame(loop); if (!dirty) return; dirty = false; draw(); };
    const unsub = vpRef.current.subscribe(() => {
      dirty = true;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => { settle = 0; cache.valid = false; dirty = true; }, SETTLE_MS);
    });
    const ro = new ResizeObserver(resize); ro.observe(host);
    resize(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); unsub(); ro.disconnect(); window.clearTimeout(settle); };
  }, [key, size, skipWater, vp.subscribe, vp.viewRef]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="fx-layer tiles" aria-hidden="true" />;
}

/**
 * Значки карты одним набором SVG-символов (контур 2px, как у Icon): испытание, разведка, метки дел, столица.
 * Определяются один раз в <defs>, на карте ставятся через <use href="#m-…">; цвет — через CSS (currentColor).
 */
const SYMBOLS: Record<string, string> = {
  wave: "M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0M2 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0",
  city: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 10h.01M15 10h.01M9 14h.01M15 14h.01",
  telescope: "m4 14 12-7 3 5-12 7-3-5Zm12-7 3-2 3 5-3 2M9 17l3 5m-6-2 3-3",
  scroll: "M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4M8 21a2 2 0 0 1-2-2M6 5h12a2 2 0 0 1 2 2v10M10 9h6m-6 4h6",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m12-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14v6l4 2",
  alert: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  crown: "m2 8 5 4 5-8 5 8 5-4-2 12H4L2 8Z",
  ship: "M2 15h20l-3 5H5l-3-5ZM12 15V3m0 1 7 8h-7M12 5 6 12h6",
  anchor: "M12 22V8m0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5 12H2c0 6 4 10 10 10s10-4 10-10h-3",
};
export function MapSymbols() {
  return (
    <defs>
      {Object.entries(SYMBOLS).map(([name, d]) => (
        <symbol key={name} id={`m-${name}`} viewBox="0 0 24 24"><path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></symbol>
      ))}
    </defs>
  );
}

/** Прогрев кеша картинок карты: вызывается после входа, чтобы карта открывалась без ожидания. */
export function warmMapImages(): void {
  if (typeof window === "undefined") return;
  const urls = [...TERRAINS.map(IMG.terrain), ...["village", "capital", "fortress", "hill_city", "port", "ruins", "temple_city", "tent_camp", "walled_city"].map((c) => IMG.city(c)), ...Array.from({ length: 6 }, (_, i) => IMG.start(i)), ...ISLET_IMAGES.map((s) => IMG.islet(s.img))];
  const go = () => urls.forEach((u) => { const im = new Image(); im.decoding = "async"; im.src = u; });
  if ("requestIdleCallback" in window) (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(go); else setTimeout(go, 300);
}

export { TERRAIN_COLOR };
