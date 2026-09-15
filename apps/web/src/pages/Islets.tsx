import { useEffect, useMemo, useRef } from "react";
import { generateIslets, type Bounds, type Islet } from "@lotw/domain";
import { HEX_SIZE } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";
import { IMG, SHALLOW_RINGS, type Viewport } from "./MapLayers";

/** Раскладка островов по гексам поля (детерминирована, считается один раз на карту). */
export function useIslets(hexes: MapHexDto[], size: number, bounds: Bounds | null): Islet[] {
  const key = hexes.map((h) => `${h.q},${h.r}`).join(";");
  return useMemo(() => (bounds && hexes.length ? generateIslets(hexes, size, bounds) : []), [key, size, bounds]); // eslint-disable-line react-hooks/exhaustive-deps
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

/** Отмель кольцами, как у берега поля: цвет, ширина в долях размера гекса, прозрачность. */

/**
 * Острова: нарисованные картинки (пляж уже на них) и отмель под каждой по снятому контуру. Рисуются на canvas в
 * пикселях экрана при каждом изменении вида (а не в SVG мира): браузер не растягивает готовый растр при
 * приближении, поэтому резкость ограничена только самой картинкой. Слой без событий, лежит между морем и миром.
 */
export function IsletsLayer({ vp, islets, size = HEX_SIZE }: { vp: Viewport; islets: Islet[]; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host || !islets.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let W = 0, H = 0, dirty = true, raf = 0;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } dirty = true; };
    const images = new Map<number, HTMLImageElement>();
    for (const n of new Set(islets.map((i) => i.img))) {
      const im = new Image(); im.decoding = "async"; im.onload = () => { dirty = true; }; im.src = IMG.islet(n); images.set(n, im);
    }
    const paths = islets.map((isl) => ({ isl, path: isletPath(isl), sc: Math.max(0.25, (isl.r / size) * 0.32) }));
    const draw = () => {
      const { k, tx, ty } = vpRef.current.viewRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      const x0 = -tx / k, y0 = -ty / k, x1 = (W / dpr - tx) / k, y1 = (H / dpr - ty) / k;
      for (const { isl, path, sc } of paths) {
        if (isl.x + isl.cover < x0 || isl.x - isl.cover > x1 || isl.y + isl.cover < y0 || isl.y - isl.cover > y1) continue;
        for (const r of SHALLOW_RINGS) { ctx.globalAlpha = r.alpha; ctx.strokeStyle = r.color; ctx.lineWidth = r.width * size * sc; ctx.stroke(path); }
        ctx.globalAlpha = 1;
        const im = images.get(isl.img);
        if (im && im.complete && im.naturalWidth) ctx.drawImage(im, isl.x - isl.r, isl.y - isl.r, isl.r * 2, isl.r * 2);
      }
    };
    const loop = () => { raf = requestAnimationFrame(loop); if (!dirty) return; dirty = false; draw(); };
    const unsub = vpRef.current.subscribe(() => { dirty = true; });
    const ro = new ResizeObserver(resize); ro.observe(host);
    resize(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); unsub(); ro.disconnect(); };
  }, [islets, size, vp.subscribe, vp.viewRef]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="fx-layer islets" aria-hidden="true" />;
}
