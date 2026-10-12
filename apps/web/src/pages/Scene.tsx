import { useEffect, useRef } from "react";
import { iconPath } from "../components/Icon";
import { SYMBOLS, drawRoads, type RoadSpec } from "./MapLayers";

/**
 * Сцена карты на холсте (плавность 12.10, второй пересмотр): города, старты, подписи, метки дел, корабли, булавки
 * и прочие значки рисуются за каждый кадр жеста в текущем масштабе. Раньше всё это жило в двух SVG-слоях, которые
 * по ходу зума масштабировались как картинка (размытие, подписи растут вместе с картой), а при фиксации
 * перерастрировались целиком (рывок и «скачок» размеров). На холсте размер экранных элементов и толщина обводок
 * считаются от живого масштаба на каждом кадре, поэтому ничего не плывёт и не прыгает. В SVG остаются только
 * прозрачные зоны нажатия (класс `hits`).
 *
 * Координаты элементов — в единицах карты; размеры экранных элементов — в CSS-пикселях, они умножаются на ui
 * (при отдалении уменьшаются до половины, как раньше через --inv). Пороги детализации — по живому масштабу.
 */
export type SceneItem =
  /** Картинка в координатах карты (город, старт): x, y — левый верхний угол, w, h — размер в единицах карты; обводка по контуру цветом (ширина в экранных пикселях при масштабе 1, не толще cap). */
  | { t: "sprite"; x: number; y: number; w: number; h: number; src: string; outline?: { color: string; width: number; cap: number; alpha?: number } }
  /** Кружок экранного размера в точке карты. */
  | { t: "dot"; x: number; y: number; dx?: number; dy?: number; r: number; fill: string; stroke?: string; sw?: number; minK?: number; maxK?: number }
  /** Подпись-пилюля: текст полный (k ≥ 1.6) и короткий; dy — сдвиг вниз в единицах карты (под картинкой города), dx — в экранных пикселях; слева направо: корона, текст, точки команд. */
  | { t: "label"; x: number; y: number; dy?: number; dx?: number; text: string; textSm?: string; fill: string; color: string; stroke?: string; crown?: string | null; battle?: "att" | "def" | null; /** Значок испытания у правого края пилюли (карта администратора), а не над ней. */ battleRight?: boolean; dots?: string[]; left?: boolean; fs?: number; fsSm?: number; minK?: number; maxK?: number; alphaSm?: number }
  /** Кружок со значком: метки дел, разведка, корабли. r — при k ≥ 1.6, rSm — при отдалении. */
  | { t: "icon"; x: number; y: number; dy?: number; r: number; rSm?: number; fill: string; stroke: string; sw?: number; icon: string; color: string; /** Размер значка в долях радиуса (по умолчанию 1.2). */ is?: number; minK?: number }
  /** Отрезок в единицах карты с толщиной в экранных пикселях (швартов корабля). */
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; color: string; w: number; dash?: number; alpha?: number }
  /** Пульсирующее кольцо высадки. */
  | { t: "pulse"; x: number; y: number; color: string; fill: string; icon: string }
  /** Круг отклика нажатия: расходится и гаснет за 600 мс от born. */
  | { t: "ripple"; x: number; y: number; born: number; color: string }
  /** Булавка метки команды с запиской. */
  | { t: "mark"; x: number; y: number; color: string; note?: string; by?: string; fill: string; textColor: string; byColor: string; stroke: string; minK?: number }
  /** Пилюля со значком слева (Каменоломня). */
  | { t: "pill"; x: number; y: number; text: string; icon: string; fs: number; fsSm?: number; fill: string; color: string; stroke: string }
  /** Маленький номер города в кружке (карта администратора без подписей). */
  | { t: "badge"; x: number; y: number; dy?: number; text: string; fill: string; color: string; stroke: string; r: number; crown?: string | null; battle?: boolean; maxK?: number; minK?: number };

interface Viewport { subscribe: (fn: (v: { k: number; tx: number; ty: number }) => void) => () => void; viewRef: { current: { k: number; tx: number; ty: number } } }

const NO_ITEMS: ReadonlyArray<SceneItem> = [];
const images = new Map<string, HTMLImageElement>();
const onImage = new Set<() => void>();
function image(src: string): HTMLImageElement {
  let im = images.get(src);
  if (!im) { im = new Image(); im.decoding = "async"; im.onload = () => { for (const fn of onImage) fn(); }; im.src = src; images.set(src, im); }
  return im;
}
const ready = (im: HTMLImageElement) => im.complete && im.naturalWidth > 0;

/** Картинка с обводкой по контуру (расширение альфа-канала): кэш по картинке, цвету и радиусу в пикселях картинки. */
const outlined = new Map<string, HTMLCanvasElement>();
const OUTLINE_CACHE = 64;
function outlinedSprite(im: HTMLImageElement, color: string, alpha: number, r: number): HTMLCanvasElement | null {
  const key = `${im.src}|${color}|${alpha}|${r}`;
  const hit = outlined.get(key);
  if (hit) { outlined.delete(key); outlined.set(key, hit); return hit; }
  const W = im.naturalWidth, H = im.naturalHeight, R = Math.ceil(r);
  if (!W || !H) return null;
  const sil = document.createElement("canvas"); sil.width = W + 2 * R; sil.height = H + 2 * R;
  const sctx = sil.getContext("2d"); if (!sctx) return null;
  sctx.drawImage(im, R, R); sctx.globalCompositeOperation = "source-in"; sctx.fillStyle = color; sctx.fillRect(0, 0, sil.width, sil.height);
  const out = document.createElement("canvas"); out.width = sil.width; out.height = sil.height;
  const octx = out.getContext("2d"); if (!octx) return null;
  const steps = r < 1.5 ? 8 : 16;
  octx.globalAlpha = alpha;
  for (let i = 0; i < steps; i++) { const a = (i / steps) * Math.PI * 2; octx.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r); }
  if (r >= 1.5) for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; octx.drawImage(sil, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55); }
  octx.globalAlpha = 1; octx.drawImage(im, R, R);
  outlined.set(key, out);
  if (outlined.size > OUTLINE_CACHE) { const first = outlined.keys().next().value; if (first) outlined.delete(first); }
  return out;
}

const paths = new Map<string, Path2D>();
function symbol(name: string): Path2D | null {
  let p = paths.get(name);
  if (!p) { const d = SYMBOLS[name] ?? iconPath(name); if (!d) return null; p = new Path2D(d); paths.set(name, p); }
  return p;
}
/** Значок 24×24 со штрихом 2, как <Icon>: центр в (cx, cy), размер size на экране. */
function drawIcon(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, size: number, color: string) {
  const p = symbol(name); if (!p) return;
  ctx.save(); ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(p);
  ctx.restore();
}
function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = h / 2;
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2); ctx.closePath();
}
const circle = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); };

const NO_ROADS: ReadonlyArray<RoadSpec> = [];
export function SceneLayer({ vp, items = NO_ITEMS, roads = NO_ROADS, grid = "", className = "" }: { vp: Viewport; items?: ReadonlyArray<SceneItem>; /** Дороги и сетка гексов рисуются на этом же холсте под элементами (на один полноэкранный холст меньше за кадр). */ roads?: ReadonlyArray<RoadSpec>; grid?: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  const itemsRef = useRef(items); itemsRef.current = items;
  const roadsRef = useRef(roads); roadsRef.current = roads;
  const gridRef = useRef<Path2D | null>(null);
  useEffect(() => { gridRef.current = grid ? new Path2D(grid) : null; dirty.current = true; }, [grid]);
  const dirty = useRef(true); dirty.current = true;
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const family = getComputedStyle(host).fontFamily || "serif";
    const C = readColors();
    let W = 0, H = 0, raf = 0;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } dirty.current = true; };
    const invalidate = () => { dirty.current = true; };
    const draw = (now: number): boolean => {
      const { k, tx, ty } = vpRef.current.viewRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      if (roadsRef.current.length || gridRef.current) { drawRoads(ctx, roadsRef.current, gridRef.current, k, tx, ty, dpr, W, H); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      const ui = Math.min(1, Math.max(0.5, k / 1.6)), full = k >= 1.6;
      const sw = W / dpr, sh = H / dpr, margin = 160;
      const sx = (x: number) => x * k + tx, sy = (y: number) => y * k + ty;
      let animated = false;
      for (const it of itemsRef.current) {
        if ("minK" in it && it.minK != null && k < it.minK) continue;
        if ("maxK" in it && it.maxK != null && k >= it.maxK) continue;
        switch (it.t) {
          case "sprite": {
            const x = sx(it.x), y = sy(it.y), w = it.w * k, h = it.h * k;
            if (x + w < -margin || x > sw + margin || y + h < -margin || y > sh + margin) break;
            const im = image(it.src); if (!ready(im)) break;
            if (it.outline) {
              const px = Math.min(it.outline.width * k, it.outline.cap); // на экране
              const r = Math.max(0.6, px * (im.naturalWidth / w)); // в пикселях картинки
              const rq = Math.round(r * 2) / 2;
              const sp = outlinedSprite(im, it.outline.color, it.outline.alpha ?? 1, rq);
              if (sp) { const R = Math.ceil(rq), s = w / im.naturalWidth; ctx.drawImage(sp, x - R * s, y - R * s, sp.width * s, sp.height * s); break; }
            }
            ctx.drawImage(im, x, y, w, h);
            break;
          }
          case "dot": {
            const x = sx(it.x) + (it.dx ?? 0) * ui, y = sy(it.y) + (it.dy ?? 0) * ui;
            if (x < -margin || x > sw + margin || y < -margin || y > sh + margin) break;
            circle(ctx, x, y, it.r * ui); ctx.fillStyle = it.fill; ctx.fill();
            if (it.stroke) { ctx.strokeStyle = it.stroke; ctx.lineWidth = (it.sw ?? 1) * ui; ctx.stroke(); }
            break;
          }
          case "label": {
            const x = sx(it.x) + (it.dx ?? 0) * ui, y = sy(it.y) + (it.dy ?? 0) * k;
            if (x < -margin || x > sw + margin || y < -margin || y > sh + margin) break;
            const fs = (full ? it.fs ?? 11 : it.fsSm ?? 9) * ui;
            const text = full ? it.text : it.textSm ?? it.text;
            ctx.font = `700 ${fs}px ${family}`;
            const tw = ctx.measureText(text).width;
            const crownW = it.crown ? fs + 4 : 0;
            const dots = full ? it.dots ?? [] : [];
            const dotR = fs * 0.42, dotsW = dots.length ? dots.length * (dotR * 2 + 2) + 4 : 0;
            const w = tw + crownW + dotsW + 14 * ui, h = fs + 9 * ui;
            const x0 = it.left ? x : x - w / 2;
            ctx.globalAlpha = full ? 1 : it.alphaSm ?? 0.92;
            pill(ctx, x0, y - h / 2, w, h); ctx.fillStyle = it.fill; ctx.fill();
            if (it.stroke) { ctx.strokeStyle = it.stroke; ctx.lineWidth = 1; ctx.stroke(); }
            if (it.crown) drawIcon(ctx, "crown", x0 + 6 * ui + (fs + 1) / 2, y, fs + 1, it.color);
            ctx.fillStyle = it.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(text, x0 + w / 2 + (crownW - dotsW) / 2, y + fs * 0.05);
            dots.forEach((c, i) => { const cx = x0 + w - 7 * ui - dotR - (dots.length - 1 - i) * (dotR * 2 + 2); circle(ctx, cx, y, dotR); ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2; ctx.stroke(); });
            if (it.battle) { const bx = it.battleRight ? x0 + w + 2 * ui : x + 18 * ui, by = y - (it.battleRight ? 12 : 30) * ui, col = it.battle === "att" ? C.info : C.danger; circle(ctx, bx, by, 10 * ui); ctx.fillStyle = C.surface; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 2 * ui; ctx.stroke(); drawIcon(ctx, "wave", bx, by, 14 * ui, col); }
            ctx.globalAlpha = 1;
            break;
          }
          case "icon": {
            const x = sx(it.x), y = sy(it.y) + (it.dy ?? 0) * ui;
            if (x < -margin || x > sw + margin || y < -margin || y > sh + margin) break;
            const r = (full ? it.r : it.rSm ?? it.r) * ui;
            circle(ctx, x, y, r); ctx.fillStyle = it.fill; ctx.fill(); ctx.strokeStyle = it.stroke; ctx.lineWidth = (it.sw ?? 1.3) * ui; ctx.stroke();
            drawIcon(ctx, it.icon, x, y, r * (it.is ?? 1.2), it.color);
            break;
          }
          case "line": {
            ctx.save(); ctx.globalAlpha = it.alpha ?? 1; ctx.strokeStyle = it.color; ctx.lineWidth = it.w; if (it.dash) ctx.setLineDash([it.dash, it.dash]);
            ctx.beginPath(); ctx.moveTo(sx(it.x1), sy(it.y1)); ctx.lineTo(sx(it.x2), sy(it.y2)); ctx.stroke(); ctx.restore();
            break;
          }
          case "pulse": {
            animated = true;
            const x = sx(it.x), y = sy(it.y);
            const ph = (now % 1600) / 1600, pr = 14 * ui * (0.6 + 0.9 * ph);
            ctx.globalAlpha = 1 - ph; circle(ctx, x, y, pr); ctx.fillStyle = it.fill; ctx.fill(); ctx.strokeStyle = it.color; ctx.lineWidth = 2 * ui; ctx.stroke(); ctx.globalAlpha = 1;
            circle(ctx, x, y, 6 * ui); ctx.fillStyle = C.surface; ctx.fill(); ctx.strokeStyle = it.color; ctx.lineWidth = 2 * ui; ctx.stroke();
            drawIcon(ctx, it.icon, x, y, 10 * ui, it.color);
            break;
          }
          case "ripple": {
            const age = (now - it.born) / 600; if (age >= 1) break;
            animated = true;
            circle(ctx, sx(it.x), sy(it.y), (6 + 40 * age) * ui); ctx.globalAlpha = 0.9 * (1 - age); ctx.strokeStyle = it.color; ctx.lineWidth = 3 * ui; ctx.stroke(); ctx.globalAlpha = 1;
            break;
          }
          case "mark": {
            const x = sx(it.x), y = sy(it.y) - 12 * ui;
            if (x < -margin || x > sw + margin || y < -margin || y > sh + margin) break;
            circle(ctx, x, y, 11 * ui); ctx.fillStyle = it.color; ctx.fill(); ctx.strokeStyle = it.stroke; ctx.lineWidth = 1.5 * ui; ctx.stroke();
            drawIcon(ctx, "pin", x, y, 14 * ui, "#fff");
            if (it.note || it.by) {
              ctx.font = `600 ${11 * ui}px ${family}`; const nw = it.note ? ctx.measureText(it.note).width : 0;
              ctx.font = `500 ${9 * ui}px ${family}`; const bw = it.by ? ctx.measureText(it.by).width : 0;
              const two = Boolean(it.note && it.by), w = Math.max(nw, bw) + 14 * ui, h = (two ? 30 : 18) * ui, ty0 = y + 21 * ui;
              pill(ctx, x - w / 2, ty0 - 9 * ui, w, h); ctx.fillStyle = it.fill; ctx.fill(); ctx.strokeStyle = it.textColor; ctx.lineWidth = 1; ctx.stroke();
              ctx.textAlign = "center"; ctx.textBaseline = "middle";
              if (it.note) { ctx.font = `600 ${11 * ui}px ${family}`; ctx.fillStyle = it.textColor; ctx.fillText(it.note, x, ty0 + 0.5); }
              if (it.by) { ctx.font = `500 ${9 * ui}px ${family}`; ctx.fillStyle = it.byColor; ctx.fillText(it.by, x, ty0 + (two ? 12 : 0) * ui + 0.5); }
            }
            break;
          }
          case "pill": {
            const x = sx(it.x), y = sy(it.y);
            if (x < -margin || x > sw + margin || y < -margin || y > sh + margin) break;
            const fs = (full ? it.fs : it.fsSm ?? it.fs) * ui;
            ctx.font = `700 ${fs}px ${family}`;
            const tw = ctx.measureText(it.text).width, w = tw + 34 * ui, h = fs + 12 * ui;
            pill(ctx, x - w / 2, y - h / 2, w, h); ctx.fillStyle = it.fill; ctx.fill(); ctx.strokeStyle = it.stroke; ctx.lineWidth = 1; ctx.stroke();
            drawIcon(ctx, it.icon, x - w / 2 + 8 * ui + (fs + 2) / 2, y, fs + 2, it.color);
            ctx.fillStyle = it.color; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(it.text, x + 9 * ui, y + fs * 0.05);
            break;
          }
          case "badge": {
            const x = sx(it.x), y = sy(it.y) + (it.dy ?? 0) * ui;
            if (x < -margin || x > sw + margin || y < -margin || y > sh + margin) break;
            circle(ctx, x, y, it.r * ui); ctx.fillStyle = it.fill; ctx.fill(); ctx.strokeStyle = it.stroke; ctx.lineWidth = 1; ctx.stroke();
            ctx.font = `700 ${9 * ui}px ${family}`; ctx.fillStyle = it.color; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(it.text, x, y + 0.5);
            if (it.crown) drawIcon(ctx, "crown", x + 13.5 * ui, y - 10.5 * ui, 11 * ui, it.crown);
            if (it.battle) { const bx = x - 16 * ui, by = y - 14 * ui; circle(ctx, bx, by, 8 * ui); ctx.fillStyle = C.surface; ctx.fill(); ctx.strokeStyle = C.danger; ctx.lineWidth = 2 * ui; ctx.stroke(); drawIcon(ctx, "wave", bx, by, 11 * ui, C.danger); }
            break;
          }
        }
      }
      return animated;
    };
    let lastAnim = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const anim = lastAnim > 0 && t - lastAnim >= 1000 / 30;
      if (!dirty.current && !anim) return;
      dirty.current = false;
      lastAnim = draw(t) ? t : 0;
    };
    const unsub = vpRef.current.subscribe(invalidate);
    onImage.add(invalidate);
    const ro = new ResizeObserver(resize); ro.observe(host);
    resize(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); unsub(); onImage.delete(invalidate); ro.disconnect(); };
  }, [vp.subscribe, vp.viewRef]);
  return <canvas ref={ref} className={"fx-layer scene" + (className ? " " + className : "")} aria-hidden="true" />;
}

/** Цвета темы для холста: читаются из CSS-переменных один раз при построении сцены (на карте тема одна). */
export const COLORS = { surface: "#FBF6EA", text: "#1F1B16", muted: "#6B5F52", paper: "#F3EAD3", far: "#B9B1A5", onAccent: "#FBF6EA", accent: "#9A6B2F", info: "#2F6F9F", infoSoft: "#DCE9F2", warn: "#8A6A1E", warnSoft: "#F3E6C4", danger: "#8B3A2F", dangerSoft: "#F0D9D4", success: "#4C6B2F" };
export function readColors(): typeof COLORS {
  if (typeof getComputedStyle !== "function") return COLORS;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return { surface: v("--surface", COLORS.surface), text: v("--text", COLORS.text), muted: v("--muted", COLORS.muted), paper: v("--map-paper", COLORS.paper), far: v("--map-far", COLORS.far), onAccent: v("--on-accent", COLORS.onAccent), accent: v("--accent", COLORS.accent), info: v("--info", COLORS.info), infoSoft: v("--info-soft", COLORS.infoSoft), warn: v("--warn", COLORS.warn), warnSoft: v("--warn-soft", COLORS.warnSoft), danger: v("--danger", COLORS.danger), dangerSoft: v("--danger-soft", COLORS.dangerSoft), success: v("--success", COLORS.success) };
}
