import { useEffect, useRef } from "react";
import { HEX_SIZE, hexCenter } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";
import { CLOUD_TILE, seaTiles } from "../lib/noise";
import type { Viewport } from "./MapLayers";

/** Размер плитки каустики в единицах карты для озёр: ячейка блика около трети гекса. */
const LAKE_TILE_WORLD = 120;
const LAYERS = [
  { tile: "causticA" as const, scale: 1.0, angle: 20, vx: 1.6, vy: 1.1, alpha: 0.2, phase: 0 },
  { tile: "causticB" as const, scale: 0.8, angle: -35, vx: -1.2, vy: 1.5, alpha: 0.18, phase: 2.1 },
];

/**
 * Живая вода на гексах-озёрах (решение владельца 15.09): поверх картинки озера бегут светлые блики каустики —
 * два узора клеточного шума (те же плитки, что у запасного моря) плывут в разные стороны и чуть «дышат»,
 * складываются светом и обрезаны по шестиугольнику. Canvas без событий между миром и туманом; только открытые
 * гексы; ~20 кадров в секунду при видимой вкладке; при «уменьшить движение» — блики стоят.
 */
export function LakesLayer({ vp, hexes, size = HEX_SIZE }: { vp: Viewport; hexes: MapHexDto[]; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  const key = hexes.filter((h) => h.terrain === "water" && h.lit !== false).map((h) => `${h.q},${h.r}`).join(";");
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const lakes = hexes.filter((h) => h.terrain === "water" && h.lit !== false).map((h) => hexCenter(h, size));
    if (!lakes.length) { canvas.width = 1; canvas.height = 1; return; }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const tiles = seaTiles();
    const patterns = LAYERS.map((l) => ctx.createPattern(tiles[l.tile], "repeat")!);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Шестиугольник чуть меньше гекса, чтобы блики не выходили на границу.
    const hex = new Path2D();
    for (let i = 0; i < 6; i++) { const a = (Math.PI / 180) * (60 * i - 30), x = Math.cos(a) * size * 0.97, y = Math.sin(a) * size * 0.97; if (i === 0) hex.moveTo(x, y); else hex.lineTo(x, y); }
    hex.closePath();
    let W = 0, H = 0, dirty = true, raf = 0, last = 0;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } dirty = true; };
    const draw = (now: number) => {
      const { k, tx, ty } = vpRef.current.viewRef.current;
      const t = still ? 0 : now / 1000;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
      const x0 = -tx / k, y0 = -ty / k, x1 = (W / dpr - tx) / k, y1 = (H / dpr - ty) / k;
      LAYERS.forEach((l, i) => {
        const s = (LAKE_TILE_WORLD * l.scale) / CLOUD_TILE;
        patterns[i]!.setTransform(new DOMMatrix().translate(l.vx * t, l.vy * t).rotate(l.angle).scale(s));
      });
      ctx.globalCompositeOperation = "lighter";
      for (const c of lakes) {
        if (c.x + size < x0 || c.x - size > x1 || c.y + size < y0 || c.y - size > y1) continue;
        ctx.save(); ctx.translate(c.x, c.y); ctx.clip(hex); ctx.translate(-c.x, -c.y);
        LAYERS.forEach((l, i) => {
          ctx.globalAlpha = l.alpha * (0.75 + 0.25 * Math.sin(t * 0.5 + l.phase + c.x * 0.01));
          ctx.fillStyle = patterns[i]!;
          ctx.fillRect(c.x - size, c.y - size, size * 2, size * 2);
        });
        ctx.restore();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (!dirty && (still || now - last < 50)) return;
      dirty = false; last = now; draw(now);
    };
    const unsub = vpRef.current.subscribe(() => { dirty = true; });
    const ro = new ResizeObserver(resize); ro.observe(host);
    resize(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); unsub(); ro.disconnect(); };
  }, [key, size, vp.subscribe, vp.viewRef]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="fx-layer lakes" aria-hidden="true" />;
}
