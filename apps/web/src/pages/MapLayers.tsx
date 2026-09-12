import { useEffect, useMemo, useRef } from "react";
import { FOG_COLOR, HEX_SIZE, TERRAIN_COLOR, coastPath, hexCenter, hexPoints } from "../lib/hexmap";
import { CLOUD_TILE, cloudTile } from "../lib/noise";
import type { View } from "../lib/useViewport";
import type { MapHexDto } from "../lib/api";

export const IMG = {
  terrain: (t: string) => `/img/terrain/${t}.webp`,
  city: (type: string | null | undefined) => `/img/city/${type && type !== "" ? type : "village"}.webp`,
  start: (i: number) => `/img/start/${["babylon", "egypt", "wilderness", "assyria", "zin", "shipwreck"][i % 6]}.webp`,
};

/**
 * Море: не в SVG, а отдельный слой DOM под картой. Две плитки текстуры (вторая перевёрнута, полупрозрачна и
 * медленно плывёт CSS-анимацией), позиция следует за картой сдвигом контейнера. Так море анимируется
 * композитором без перерисовки SVG. Размер плитки округляется до целых пикселей, иначе на стыках видны швы.
 */
export function SeaLayer({ view, size = HEX_SIZE }: { view: View; size?: number }) {
  const T = Math.max(48, Math.round(size * 6 * view.k));
  const ox = ((view.tx % T) + T) % T, oy = ((view.ty % T) + T) % T;
  return (
    <div className="sea-layer" style={{ ["--tile" as string]: `${T}px` }} aria-hidden>
      <div className="sea-pos" style={{ transform: `translate(${(ox - 2 * T).toFixed(2)}px, ${(oy - 2 * T).toFixed(2)}px)` }}>
        <div className="sea-base" />
        <div className="sea-waves" />
      </div>
    </div>
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
export function CoastUnder({ d, size = HEX_SIZE }: { d: string; size?: number }) {
  if (!d) return null;
  return (
    <g className="coast" fill="none" strokeLinejoin="round" strokeLinecap="round">
      <g opacity={0.16}><path d={d} stroke="#CFEAF0" strokeWidth={size * 3.2} /></g>
      <g opacity={0.2}><path d={d} stroke="#CFEAF0" strokeWidth={size * 2.6} /></g>
      <g opacity={0.26}><path d={d} stroke="#D7EEF2" strokeWidth={size * 2.0} /></g>
      <g opacity={0.36}><path d={d} stroke="#E0F2F5" strokeWidth={size * 1.5} /></g>
      <path d={d} stroke="#E6D3A6" strokeWidth={size * 0.95} />
    </g>
  );
}

/** Берег над гексами: песок, растворяющийся в местность тремя ступенями, и тёмная линия влажного песка у воды. */
export function CoastOver({ d, size = HEX_SIZE }: { d: string; size?: number }) {
  if (!d) return null;
  return (
    <g className="coast" fill="none" strokeLinejoin="round" strokeLinecap="round">
      <path d={d} stroke="#E6D3A6" strokeWidth={size * 0.5} />
      <g opacity={0.55}><path d={d} stroke="#E6D3A6" strokeWidth={size * 0.8} /></g>
      <g opacity={0.3}><path d={d} stroke="#E6D3A6" strokeWidth={size * 1.1} /></g>
      <g opacity={0.35}><path d={d} stroke="#B8975E" strokeWidth={1.2} vectorEffect="non-scaling-stroke" /></g>
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
  const pad = size * 1.2;
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
  return { canvas, x, y, w, h };
}

/**
 * Слой эффектов поверх карты (canvas, без событий): пена у берега и облака тумана. Рисуется ~24 раза в секунду,
 * только пока вкладка видна; при «уменьшить движение» — один кадр без дрейфа. Вид карты читается из ref,
 * чтобы не гонять каждое движение пальца через React.
 */
export function EffectsLayer({ view, size = HEX_SIZE, coast, fogHexes }: { view: View; size?: number; coast: string; fogHexes?: MapHexDto[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const dirty = useRef(true); dirty.current = true;
  const fogKey = (fogHexes ?? []).map((h) => `${h.q},${h.r}`).join(";");
  const mask = useMemo(() => (fogHexes && fogHexes.length ? buildFogMask(fogHexes, size) : null), [fogKey, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const path = useMemo(() => (coast ? new Path2D(coast) : null), [coast]);
  const maskRef = useRef(mask); maskRef.current = mask;
  const pathRef = useRef(path); pathRef.current = path;

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } dirty.current = true; };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(host);
    let pats: { s: CanvasPattern; a: CanvasPattern; b: CanvasPattern } | null = null;
    const draw = (t: number) => {
      const { k, tx, ty } = viewRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
      const m = maskRef.current;
      if (m) {
        // Видимая часть тумана в координатах карты — вне её ничего не рисуем.
        const vx0 = -tx / k, vy0 = -ty / k, vx1 = (W / dpr - tx) / k, vy1 = (H / dpr - ty) / k;
        const bx = Math.max(m.x, vx0), by = Math.max(m.y, vy0), bw = Math.min(m.x + m.w, vx1) - bx, bh = Math.min(m.y + m.h, vy1) - by;
        if (bw > 0 && bh > 0) {
          pats ??= (() => { const tl = getTiles(); return { s: ctx.createPattern(tl.s, "repeat")!, a: ctx.createPattern(tl.a, "repeat")!, b: ctx.createPattern(tl.b, "repeat")! }; })();
          ctx.save();
          ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
          ctx.fillStyle = FOG_BASE; ctx.fillRect(bx, by, bw, bh);
          const sec = reduced ? 0 : t / 1000;
          const layer = (pat: CanvasPattern, span: number, vx: number, vy: number, alpha: number) => {
            const sc = span / CLOUD_TILE, ox = sec * vx, oy = sec * vy;
            ctx.save(); ctx.globalAlpha = alpha; ctx.translate(ox, oy); ctx.scale(sc, sc); ctx.fillStyle = pat;
            ctx.fillRect((bx - ox) / sc, (by - oy) / sc, bw / sc, bh / sc); ctx.restore();
          };
          layer(pats.s, size * 5, -1.6, 1.2, 1);
          layer(pats.a, size * 6.5, 2.2, 0.9, 1);
          layer(pats.b, size * 3, -1.2, 2.8, 0.9);
          ctx.globalCompositeOperation = "destination-in";
          ctx.drawImage(m.canvas, m.x, m.y, m.w, m.h);
          ctx.restore();
        }
      }
      const p = pathRef.current;
      if (p) {
        // Пена: пунктир бежит вдоль берега; рисуется под туманом (destination-over), чтобы не светиться сквозь облака.
        ctx.save(); ctx.globalCompositeOperation = "destination-over"; ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 2.2 / k; ctx.setLineDash([7 / k, 9 / k]); ctx.lineDashOffset = reduced ? 0 : -(t / 1000) * 10 / k;
        ctx.stroke(p);
        ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 7 / k; ctx.setLineDash([]);
        ctx.stroke(p);
        ctx.restore();
      }
    };
    let raf = 0, last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const animated = !reduced && (pathRef.current || maskRef.current);
      if (!dirty.current && (!animated || t - last < 1000 / 24)) return;
      dirty.current = false; last = t;
      draw(t);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [size]);

  return <canvas ref={ref} className="fx-layer" aria-hidden />;
}

const TERRAINS = ["desert", "hills", "meadow", "mountains", "water", "oasis"];

/**
 * Слой гексов. Текстуры не вставляются в каждый гекс отдельной картинкой (270 картинок с обрезкой тяжело
 * рисовать на телефоне), а задаются паттернами: по одному на местность и поворот (6 × 6). Под паттерном —
 * цвет местности, поэтому карта видна сразу, ещё до загрузки текстур. Туман — тёмные гексы.
 */
export function HexTiles({ hexes, size = HEX_SIZE, clipId }: { hexes: MapHexDto[]; size?: number; clipId: string }) {
  const poly = hexPoints(size, 0.995);
  const fogPoly = hexPoints(size, 1.03);
  return (
    <>
      <defs>
        {TERRAINS.map((t) => Array.from({ length: 6 }, (_, r) => (
          <pattern key={`${t}${r}`} id={`${clipId}-${t}-${r}`} patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width={1} height={1}>
            <rect width={1} height={1} fill={TERRAIN_COLOR[t] ?? TERRAIN_COLOR.desert} />
            {/* Квадрат текстуры повёрнут вокруг центра и увеличен, чтобы закрыть углы гекса при любом повороте. */}
            <image href={IMG.terrain(t)} x={-0.2} y={-0.2} width={1.4} height={1.4} preserveAspectRatio="none" transform={`rotate(${r * 60} .5 .5)`} />
          </pattern>
        )))}
      </defs>
      {hexes.map((h) => {
        const c = hexCenter(h, size);
        if (!h.lit && h.lit !== undefined) return <polygon key={`f${h.q},${h.r}`} className="hex-fog" points={fogPoly} transform={`translate(${c.x},${c.y})`} fill={FOG_COLOR} />;
        const t = TERRAINS.includes(h.terrain ?? "") ? h.terrain! : "desert";
        return <polygon key={`t${h.q},${h.r}`} className="hex-tile" points={poly} transform={`translate(${c.x},${c.y})`} fill={`url(#${clipId}-${t}-${(h.rotation ?? 0) % 6})`} vectorEffect="non-scaling-stroke" />;
      })}
    </>
  );
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
  const urls = [...TERRAINS.map(IMG.terrain), "/img/brand/sea.webp", ...["village", "capital", "fortress", "hill_city", "port", "ruins", "temple_city", "tent_camp", "walled_city"].map((c) => IMG.city(c)), ...Array.from({ length: 6 }, (_, i) => IMG.start(i))];
  const go = () => urls.forEach((u) => { const im = new Image(); im.decoding = "async"; im.src = u; });
  if ("requestIdleCallback" in window) (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(go); else setTimeout(go, 300);
}

export { TERRAIN_COLOR };
