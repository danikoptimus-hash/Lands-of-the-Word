import { useEffect, useMemo, useRef } from "react";
import { generateIslets, type Bounds, type Islet } from "@lotw/domain";
import { HEX_SIZE } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";
import { IMG, SHALLOW_RINGS, type Viewport } from "./MapLayers";
import { perfMark } from "../lib/perfHud";

/** Раскладка островов по гексам поля (детерминирована, считается один раз на карту). */
export function useIslets(hexes: MapHexDto[], size: number, bounds: Bounds | null): Islet[] {
  const key = hexes.map((h) => `${h.q},${h.r}`).join(";");
  // Зависимость только от ключа гексов: bounds выводится из них же, а новый объект при перезагрузке карты не должен всё пересчитывать.
  return useMemo(() => (bounds && hexes.length ? generateIslets(hexes, size, bounds) : []), [key, size, Boolean(bounds)]); // eslint-disable-line react-hooks/exhaustive-deps
}


/** Замкнутый гладкий контур острова по снятому профилю (Катмулл-Ром → кубические Безье) в координатах карты. */
function isletPath(isl: Islet): Path2D {
  const n = isl.shape.length;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, d = isl.r * isl.shape[i]!;
    pts.push([isl.x + Math.cos(a) * d, isl.y + Math.sin(a) * d]);
  }
  const P = (i: number) => pts[((i % n) + n) % n]!;
  const p = new Path2D();
  p.moveTo(P(0)[0], P(0)[1]);
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
  p.closePath();
  return p;
}

/** Песок за краем полосы песка растворяется в отмель: кольца от 0.95 до 1.5 радиуса гекса, прозрачность падает. */
const SAND_FADE: ReadonlyArray<{ width: number; alpha: number }> = Array.from({ length: 10 }, (_, i) => { const t = (i + 1) / 10; return { width: 0.95 + 0.55 * t, alpha: 0.5 * Math.pow(1 - t, 1.6) }; });
const SAND = "#E6D3A6";
/** Шаг между кольцами отмели в радиусах гекса — на него и размывается слой, чтобы колец не было видно. */
const RING_STEP = (SHALLOW_RINGS[0]!.width - SHALLOW_RINGS[SHALLOW_RINGS.length - 1]!.width) / (SHALLOW_RINGS.length - 1);

/**
 * Берег и острова на canvas в пикселях экрана при каждом изменении вида. Слой без событий, лежит между морем и миром.
 * Берег поля (отмель кольцами, песок, песок растворяется в отмель) и отмели островков рисуются во временный canvas и
 * переносятся на экран с размытием на шаг колец — переход воды в песок сплошной, без ступенек и резкой кромки
 * (решение владельца 15.09). Поверх — картинки островов без размытия (пляж уже на них). В SVG мира так нельзя:
 * там браузер растягивал бы готовый растр при приближении, а фильтр размытия на весь остров дорог для телефона;
 * здесь же canvas всегда размером с экран, и стоимость не зависит от масштаба. Без поддержки фильтров canvas
 * (старый Safari) — те же кольца без размытия.
 */
export function IsletsLayer({ vp, islets, size = HEX_SIZE, coast = "" }: { vp: Viewport; islets: Islet[]; size?: number; /** Линия берега поля (path SVG в координатах карты). */ coast?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host || (!islets.length && !coast)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const off = document.createElement("canvas");
    const octx = off.getContext("2d");
    if (!octx) return;
    const canBlur = "filter" in ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Растр берега — в половинном разрешении CSS-пикселя: он и так размыт, а размытие полноэкранного canvas в 2–3× плотности на ноутбуке «фризило» зум.
    const cs = Math.min(window.devicePixelRatio || 1, 1) * 0.5;
    let W = 0, H = 0, dirty = true, raf = 0;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } dirty = true; };
    const images = new Map<number, HTMLImageElement>();
    for (const n of new Set(islets.map((i) => i.img))) {
      const im = new Image(); im.decoding = "async"; im.onload = () => { dirty = true; }; im.src = IMG.islet(n); images.set(n, im);
    }
    const coastPath = coast ? new Path2D(coast) : null;
    const paths = islets.map((isl) => ({ isl, path: isletPath(isl), sc: Math.max(0.25, (isl.r / size) * 0.32) }));
    // Кэш берега: размытый растр считается один раз для вида (масштаб, сдвиг) с запасом PAD вокруг экрана; при
    // перетаскивании он просто сдвигается, при щипке — масштабируется как картинка, а заново рисуется, когда вид
    // устоялся (SETTLE_MS без изменений). Иначе размытие полноэкранного canvas на каждый кадр съедало плавность.
    const PAD = 0.25, RERENDER_MS = 180;
    let lastRender = 0;
    const cache = { canvas: document.createElement("canvas"), k: 0, tx: 0, ty: 0, pad: 0, valid: false };
    const cctx = cache.canvas.getContext("2d");
    if (!cctx) return;
    let settle = 0;
    const render = (k: number, tx: number, ty: number) => {
      const CWs = Math.ceil(W * cs / dpr), CHs = Math.ceil(H * cs / dpr); // экран в пикселях растра берега
      const pad = Math.ceil(Math.max(CWs, CHs) * PAD);
      const blur = canBlur ? Math.max(0.6, RING_STEP * size * k * cs * 0.75) : 0;
      const M = Math.ceil(blur * 3);
      const OW = CWs + 2 * pad + 2 * M, OH = CHs + 2 * pad + 2 * M;
      if (off.width !== OW || off.height !== OH) { off.width = OW; off.height = OH; }
      octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, OW, OH);
      octx.setTransform(k * cs, 0, 0, k * cs, tx * cs + pad + M, ty * cs + pad + M);
      octx.lineJoin = "round"; octx.lineCap = "round";
      const x0 = (-pad / cs - tx) / k, y0 = (-pad / cs - ty) / k, x1 = ((CWs + pad) / cs - tx) / k, y1 = ((CHs + pad) / cs - ty) / k;
      const rings = (c: CanvasRenderingContext2D, path: Path2D, sc: number) => {
        for (const r of SHALLOW_RINGS) { c.globalAlpha = r.alpha; c.strokeStyle = r.color; c.lineWidth = r.width * size * sc; c.stroke(path); }
        c.globalAlpha = 1;
      };
      if (coastPath) {
        rings(octx, coastPath, 1);
        octx.strokeStyle = SAND;
        for (const f of SAND_FADE) { octx.globalAlpha = f.alpha; octx.lineWidth = f.width * size; octx.stroke(coastPath); }
        octx.globalAlpha = 1; octx.lineWidth = 0.95 * size; octx.stroke(coastPath);
      }
      for (const { isl, path, sc } of paths) if (!(isl.x + isl.cover < x0 || isl.x - isl.cover > x1 || isl.y + isl.cover < y0 || isl.y - isl.cover > y1)) rings(octx, path, sc);
      const CW = CWs + 2 * pad, CH = CHs + 2 * pad;
      if (cache.canvas.width !== CW || cache.canvas.height !== CH) { cache.canvas.width = CW; cache.canvas.height = CH; }
      cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.clearRect(0, 0, CW, CH);
      if (canBlur) cctx.filter = `blur(${blur.toFixed(1)}px)`;
      cctx.drawImage(off, -M, -M);
      if (canBlur) cctx.filter = "none";
      Object.assign(cache, { k, tx, ty, pad, valid: true });
    };
    const draw = () => {
      const { k, tx, ty } = vpRef.current.viewRef.current;
      const dx = (tx - cache.tx) * cs, dy = (ty - cache.ty) * cs;
      const fresh = cache.valid && cache.k === k && Math.abs(dx) <= cache.pad && Math.abs(dy) <= cache.pad;
      // Пока идёт жест, растр всё же обновляется не чаще RERENDER_MS — иначе при щипке картинка размыта до отпускания
      // пальцев (замечание владельца 15.09); окончательный пересчёт — когда вид устоится.
      const now = performance.now();
      if (!cache.valid || (!fresh && (!settle || now - lastRender >= RERENDER_MS))) { render(k, tx, ty); lastRender = now; perfMark("берег растр", performance.now() - now); }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      // Растр построен под вид cache (масштаб k0, сдвиг t0) в пикселях cs: точка растра p → экран p·(f·dpr/cs) + t·dpr − (pad/cs + t0)·f·dpr.
      const f = k / cache.k, a = f * dpr / cs;
      ctx.setTransform(a, 0, 0, a, tx * dpr - (cache.pad / cs + cache.tx) * f * dpr, ty * dpr - (cache.pad / cs + cache.ty) * f * dpr);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "medium";
      ctx.drawImage(cache.canvas, 0, 0);
      ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
      ctx.imageSmoothingQuality = "high";
      const x0 = -tx / k, y0 = -ty / k, x1 = (W / dpr - tx) / k, y1 = (H / dpr - ty) / k;
      for (const { isl } of paths) {
        if (isl.x + isl.cover < x0 || isl.x - isl.cover > x1 || isl.y + isl.cover < y0 || isl.y - isl.cover > y1) continue;
        const im = images.get(isl.img);
        if (im && im.complete && im.naturalWidth) ctx.drawImage(im, isl.x - isl.r, isl.y - isl.r, isl.r * 2, isl.r * 2);
      }
    };
    const loop = () => { raf = requestAnimationFrame(loop); if (!dirty) return; dirty = false; draw(); };
    const SETTLE_MS = 140;
    const unsub = vpRef.current.subscribe(() => {
      dirty = true;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => { settle = 0; cache.valid = false; dirty = true; }, SETTLE_MS);
    });
    const ro = new ResizeObserver(() => { resize(); cache.valid = false; }); ro.observe(host);
    resize(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); unsub(); ro.disconnect(); window.clearTimeout(settle); };
  }, [islets, size, coast, vp.subscribe, vp.viewRef]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="fx-layer islets" aria-hidden="true" />;
}
