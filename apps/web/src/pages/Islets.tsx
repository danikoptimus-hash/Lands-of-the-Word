import { useEffect, useMemo, useRef } from "react";
import { generateIslets, type Bounds, type Islet } from "@lotw/domain";
import { HEX_SIZE, hexCenter } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";
import { IMG, SHALLOW_RINGS, lightKey, shallowRings, type Viewport } from "./MapLayers";
import { perfMark } from "../lib/perfHud";
import { css, DAY_LIGHT, type Daytime } from "../lib/daytime";
import type { DayPhase } from "@lotw/domain";

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
const NO_HEXES: ReadonlyArray<MapHexDto> = [];
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
export function IsletsLayer({ vp, islets, size = HEX_SIZE, coast = "", daytime, hexes = NO_HEXES }: { vp: Viewport; islets: Islet[]; size?: number; /** Гексы поля: по ним и островкам считается охват растра берега. */ hexes?: ReadonlyArray<MapHexDto>; /** Линия берега поля (path SVG в координатах карты). */ coast?: string; /** Время суток: песок и отмель по палитре, острова — картинки двух фаз перехода. */ daytime?: Daytime }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  const from = daytime?.from ?? "day", to = daytime?.to ?? "day", blend = daytime?.t ?? 0, light = daytime?.light ?? DAY_LIGHT;
  const lkey = daytime ? lightKey(daytime) : "day";
  const hexKey = hexes.map((h) => `${h.q},${h.r}`).join(";");
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host || (!islets.length && !coast)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const canBlur = "filter" in ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, dirty = true, raf = 0;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } dirty = true; };
    const images = new Map<string, HTMLImageElement>();
    const load = (n: number, phase: DayPhase) => { const im = new Image(); im.decoding = "async"; im.onload = () => { dirty = true; }; im.src = IMG.islet(n, phase); images.set(`${n}:${phase}`, im); };
    for (const n of new Set(islets.map((i) => i.img))) { load(n, from); if (to !== from) load(n, to); }
    const ready = (im: HTMLImageElement | undefined): im is HTMLImageElement => Boolean(im && im.complete && im.naturalWidth);
    const rings = daytime ? shallowRings(light) : SHALLOW_RINGS, sand = css(light.sand);
    const coastPath = coast ? new Path2D(coast) : null;
    const paths = islets.map((isl) => ({ isl, path: isletPath(isl), sc: Math.max(0.25, (isl.r / size) * 0.32) }));
    // Растр берега (плавность 12.10, третий круг): один на всё поле в координатах карты, строится один раз на освещение
    // и дальше только переносится на экран с текущим масштабом. Раньше растр строился под вид и перестраивался по ходу
    // жеста (десятки миллисекунд с размытием) — это и были рывки. Разрешение — до ~4 Мп; кольца размыты на свой шаг.
    const SEA = Math.max(size * 4, ...islets.map((i) => i.cover));
    const xs = [...hexes.map((h) => hexCenter(h, size).x), ...islets.map((i) => i.x)], ys = [...hexes.map((h) => hexCenter(h, size).y), ...islets.map((i) => i.y)];
    const fx = Math.min(...xs) - SEA, fy = Math.min(...ys) - SEA, fw = Math.max(...xs) + SEA - fx, fh = Math.max(...ys) + SEA - fy;
    const cs = Math.min(1.5, Math.sqrt(4e6 / (fw * fh)));
    const cache = document.createElement("canvas");
    const t0 = performance.now();
    (() => {
      const blur = canBlur ? Math.max(0.6, RING_STEP * size * cs * 0.75) : 0;
      const M = Math.ceil(blur * 3);
      const off = document.createElement("canvas");
      const OW = Math.ceil(fw * cs) + 2 * M, OH = Math.ceil(fh * cs) + 2 * M;
      off.width = OW; off.height = OH;
      const octx = off.getContext("2d"); if (!octx) return;
      octx.setTransform(cs, 0, 0, cs, -fx * cs + M, -fy * cs + M);
      octx.lineJoin = "round"; octx.lineCap = "round";
      const drawRings = (c: CanvasRenderingContext2D, path: Path2D, sc: number) => {
        for (const r of rings) { c.globalAlpha = r.alpha; c.strokeStyle = r.color; c.lineWidth = r.width * size * sc; c.stroke(path); }
        c.globalAlpha = 1;
      };
      if (coastPath) {
        drawRings(octx, coastPath, 1);
        octx.strokeStyle = sand;
        for (const f of SAND_FADE) { octx.globalAlpha = f.alpha; octx.lineWidth = f.width * size; octx.stroke(coastPath); }
        octx.globalAlpha = 1; octx.lineWidth = 0.95 * size; octx.stroke(coastPath);
      }
      for (const { path, sc } of paths) drawRings(octx, path, sc);
      cache.width = Math.ceil(fw * cs); cache.height = Math.ceil(fh * cs);
      const cctx = cache.getContext("2d"); if (!cctx) return;
      if (canBlur) cctx.filter = `blur(${blur.toFixed(1)}px)`;
      cctx.drawImage(off, -M, -M);
      if (canBlur) cctx.filter = "none";
    })();
    perfMark("берег растр", performance.now() - t0);
    const draw = () => {
      const { k, tx, ty } = vpRef.current.viewRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "medium";
      if (cache.width > 1) ctx.drawImage(cache, fx, fy, fw, fh);
      ctx.imageSmoothingQuality = "high";
      const x0 = -tx / k, y0 = -ty / k, x1 = (W / dpr - tx) / k, y1 = (H / dpr - ty) / k;
      for (const { isl } of paths) {
        if (isl.x + isl.cover < x0 || isl.x - isl.cover > x1 || isl.y + isl.cover < y0 || isl.y - isl.cover > y1) continue;
        // Переход времени суток: картинка первой фазы, поверх — второй с прозрачностью доли.
        const a = images.get(`${isl.img}:${from}`), b = to !== from ? images.get(`${isl.img}:${to}`) : undefined;
        if (ready(a) && (blend < 1 || !ready(b))) ctx.drawImage(a, isl.x - isl.r, isl.y - isl.r, isl.r * 2, isl.r * 2);
        if (ready(b) && blend > 0) { ctx.globalAlpha = ready(a) ? blend : 1; ctx.drawImage(b, isl.x - isl.r, isl.y - isl.r, isl.r * 2, isl.r * 2); ctx.globalAlpha = 1; }
      }
    };
    const loop = () => { raf = requestAnimationFrame(loop); if (!dirty) return; dirty = false; draw(); };
    const unsub = vpRef.current.subscribe(() => { dirty = true; });
    const ro = new ResizeObserver(resize); ro.observe(host);
    resize(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); unsub(); ro.disconnect(); };
  }, [islets, size, coast, lkey, hexKey, vp.subscribe, vp.viewRef]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="fx-layer islets" aria-hidden="true" />;
}
