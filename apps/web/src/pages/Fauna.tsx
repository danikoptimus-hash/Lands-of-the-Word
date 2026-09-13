import { useEffect, useMemo, useRef } from "react";
import { HEX_SIZE, hexCenter } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";
import type { Viewport } from "./MapLayers";

/**
 * Живность на карте: киты, косатки и дельфины плывут вокруг острова только по воде (по профилю берега),
 * чайки кружат у берега, стайки птиц перелетают остров. Всё рисуется кодом на canvas, без картинок,
 * в единицах карты (масштабируется вместе с ней), ~24 кадра в секунду только в видимой области.
 * При «уменьшить движение» слой не показывается.
 */
const BINS = 72;
interface Profile { cx: number; cy: number; r: number[]; maxR: number }

/** Профиль острова: для каждого сектора угла — наибольшее расстояние до края гекса от центра острова. */
function islandProfile(hexes: MapHexDto[], size: number): Profile | null {
  if (!hexes.length) return null;
  const cs = hexes.map((h) => hexCenter(h, size));
  const cx = cs.reduce((a, c) => a + c.x, 0) / cs.length, cy = cs.reduce((a, c) => a + c.y, 0) / cs.length;
  const r = new Array<number>(BINS).fill(0);
  for (const c of cs) {
    const d = Math.hypot(c.x - cx, c.y - cy) + size * 1.1;
    const a = Math.atan2(c.y - cy, c.x - cx);
    const b = Math.floor(((a + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
    for (const k of [-2, -1, 0, 1, 2]) { const i = (b + k + BINS) % BINS; if (d > r[i]!) r[i] = d; }
  }
  const maxR = Math.max(...r);
  for (let i = 0; i < BINS; i++) if (r[i] === 0) r[i] = maxR;
  return { cx, cy, r, maxR };
}
function radiusAt(p: Profile, angle: number): number {
  const f = ((angle + Math.PI) / (2 * Math.PI)) * BINS;
  const i = Math.floor(f) % BINS, j = (i + 1) % BINS, t = f - Math.floor(f);
  return p.r[((i % BINS) + BINS) % BINS]! * (1 - t) + p.r[j]! * t;
}

type Kind = "whale" | "orca" | "dolphin" | "gull";
interface Swimmer { kind: Kind; angle: number; dir: 1 | -1; speed: number; off: number; phase: number; wobble: number; pod: number }
interface Flock { x0: number; y0: number; x1: number; y1: number; t0: number; dur: number; members: Array<{ dx: number; dy: number; phase: number }>; next: number }

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function makeSwimmers(size: number): Swimmer[] {
  const s = (kind: Kind, speed: number, off: number, pod = 1): Swimmer => ({ kind, angle: rnd(-Math.PI, Math.PI), dir: Math.random() < 0.5 ? 1 : -1, speed, off, phase: rnd(0, 6.28), wobble: rnd(0.15, 0.35), pod });
  return [
    s("whale", size * 0.25, size * rnd(2.2, 3.6)),
    s("orca", size * 0.45, size * rnd(1.8, 3)),
    s("dolphin", size * 0.6, size * rnd(1.2, 2.2), 3),
    s("gull", size * 0.8, size * rnd(-0.4, 0.8)),
    s("gull", size * 0.95, size * rnd(-0.2, 1.2)),
    s("gull", size * 0.7, size * rnd(0, 1.4)),
  ];
}
function makeFlock(p: Profile, now: number, first: boolean): Flock {
  const a = rnd(-Math.PI, Math.PI), R = p.maxR * 1.25;
  const n = Math.floor(rnd(5, 8));
  return {
    x0: p.cx + Math.cos(a) * R, y0: p.cy + Math.sin(a) * R,
    x1: p.cx + Math.cos(a + Math.PI + rnd(-0.6, 0.6)) * R, y1: p.cy + Math.sin(a + Math.PI + rnd(-0.6, 0.6)) * R,
    t0: now + (first ? rnd(2, 8) : rnd(8, 25)) * 1000, dur: rnd(28, 45) * 1000,
    // Клин: ведущая птица впереди, остальные по бокам со сдвигом назад.
    members: Array.from({ length: n }, (_, i) => ({ dx: -Math.ceil(i / 2) * 9, dy: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 6, phase: rnd(0, 6.28) })),
    next: 0,
  };
}

/** Кит сверху: тело каплей, хвостовые лопасти сзади. Голова — по +x. */
function drawWhale(ctx: CanvasRenderingContext2D, L: number, color: string, light: string, t: number) {
  const sway = Math.sin(t * 1.4) * 0.06;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(L * 0.5, 0);
  ctx.bezierCurveTo(L * 0.45, -L * 0.17, L * 0.05, -L * 0.2, -L * 0.3, -L * 0.07);
  ctx.lineTo(-L * 0.45, -L * 0.03);
  ctx.lineTo(-L * 0.45, L * 0.03);
  ctx.lineTo(-L * 0.3, L * 0.07);
  ctx.bezierCurveTo(L * 0.05, L * 0.2, L * 0.45, L * 0.17, L * 0.5, 0);
  ctx.fill();
  // хвост
  ctx.save(); ctx.translate(-L * 0.45, 0); ctx.rotate(sway);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-L * 0.12, -L * 0.16, -L * 0.2, -L * 0.09); ctx.quadraticCurveTo(-L * 0.1, -L * 0.03, -L * 0.06, 0);
  ctx.quadraticCurveTo(-L * 0.1, L * 0.03, -L * 0.2, L * 0.09); ctx.quadraticCurveTo(-L * 0.12, L * 0.16, 0, 0); ctx.fill(); ctx.restore();
  // светлая спина
  ctx.fillStyle = light; ctx.globalAlpha *= 0.5;
  ctx.beginPath(); ctx.ellipse(L * 0.05, 0, L * 0.3, L * 0.06, 0, 0, Math.PI * 2); ctx.fill();
}
function drawOrca(ctx: CanvasRenderingContext2D, L: number, t: number) {
  drawWhale(ctx, L, "#1F262D", "#2B343C", t);
  ctx.globalAlpha = 1; ctx.fillStyle = "#F4F6F7";
  ctx.beginPath(); ctx.ellipse(L * 0.28, -L * 0.09, L * 0.07, L * 0.035, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(L * 0.28, L * 0.09, L * 0.07, L * 0.035, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-L * 0.05, 0, L * 0.12, L * 0.03, 0, 0, Math.PI * 2); ctx.fill();
}
function drawBird(ctx: CanvasRenderingContext2D, w: number, color: string, flap: number) {
  // Две дуги-крыла; flap 0..1 — от опущенных к поднятым.
  const lift = (flap - 0.5) * w * 0.9;
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.6, w * 0.16); ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-w, lift * 0.6); ctx.quadraticCurveTo(-w * 0.5, -w * 0.35 + lift, 0, 0);
  ctx.quadraticCurveTo(w * 0.5, -w * 0.35 + lift, w, lift * 0.6);
  ctx.stroke();
}

export function FaunaLayer({ vp, hexes, size = HEX_SIZE }: { vp: Viewport; hexes: MapHexDto[]; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = hexes.length ? `${hexes.length}:${hexes[0]!.q},${hexes[0]!.r}` : "";
  const profile = useMemo(() => islandProfile(hexes, size), [key, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const profileRef = useRef(profile); profileRef.current = profile;

  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host || !profileRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(host);
    const swimmers = makeSwimmers(size);
    let flock = makeFlock(profileRef.current, performance.now(), true);
    let last = performance.now(), lastDraw = 0, raf = 0;

    const draw = (now: number) => {
      const p = profileRef.current; if (!p) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const { k, tx, ty } = vp.viewRef.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
      const vx0 = -tx / k - size * 3, vy0 = -ty / k - size * 3, vx1 = (W / dpr - tx) / k + size * 3, vy1 = (H / dpr - ty) / k + size * 3;
      const visible = (x: number, y: number) => x > vx0 && x < vx1 && y > vy0 && y < vy1;
      const sec = now / 1000;
      for (const s of swimmers) {
        // speed — линейная скорость в единицах карты в секунду; угловая = линейная / радиус.
        const rNow = radiusAt(p, s.angle) + s.off;
        s.angle += s.dir * (s.speed / Math.max(size, rNow)) * dt;
        const r = radiusAt(p, s.angle) + s.off + Math.sin(sec * s.wobble + s.phase) * size * 0.5;
        const x = p.cx + Math.cos(s.angle) * r, y = p.cy + Math.sin(s.angle) * r;
        // Курс — по касательной к траектории (чуть вперёд по углу).
        const r2 = radiusAt(p, s.angle + s.dir * 0.02) + s.off;
        const x2 = p.cx + Math.cos(s.angle + s.dir * 0.02) * r2, y2 = p.cy + Math.sin(s.angle + s.dir * 0.02) * r2;
        const heading = Math.atan2(y2 - y, x2 - x);
        if (!visible(x, y)) continue;
        const count = s.pod;
        for (let i = 0; i < count; i++) {
          ctx.save();
          const back = i * size * 0.55, side = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * size * 0.35;
          ctx.translate(x - Math.cos(heading) * back - Math.sin(heading) * side, y - Math.sin(heading) * back + Math.cos(heading) * side);
          ctx.rotate(heading);
          if (s.kind === "whale") { ctx.globalAlpha = 0.9; drawWhale(ctx, size * 1.7, "#3D5A6C", "#5B7C8F", sec + s.phase); }
          else if (s.kind === "orca") { ctx.globalAlpha = 0.95; drawOrca(ctx, size * 1.05, sec + s.phase); }
          else if (s.kind === "dolphin") {
            // Прыжок: короткое увеличение и белый всплеск.
            const j = Math.max(0, Math.sin(sec * 0.9 + s.phase + i * 1.3) - 0.85) / 0.15;
            ctx.scale(1 + j * 0.25, 1 + j * 0.25); ctx.globalAlpha = 0.9;
            drawWhale(ctx, size * 0.6, "#6F8593", "#9DB0BA", sec * 2 + s.phase + i);
            if (j > 0) { ctx.globalAlpha = 0.6 * j; ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(-size * 0.2, 0, size * 0.35 * (1 + j), size * 0.15 * (1 + j), 0, 0, Math.PI * 2); ctx.stroke(); }
          } else {
            ctx.globalAlpha = 0.95;
            drawBird(ctx, size * 0.2, "#FFFFFF", 0.5 + 0.5 * Math.sin(sec * 9 + s.phase));
            ctx.globalAlpha = 0.35; ctx.translate(0, size * 0.25); drawBird(ctx, size * 0.2, "#1F2A33", 0.5 + 0.5 * Math.sin(sec * 9 + s.phase));
          }
          ctx.restore();
        }
      }
      // Стайка над сушей: перелёт с одного края острова на другой, потом пауза и новый маршрут.
      if (now >= flock.t0) {
        const u = (now - flock.t0) / flock.dur;
        if (u >= 1) flock = makeFlock(p, now, false);
        else {
          const ease = u; const fx = flock.x0 + (flock.x1 - flock.x0) * ease, fy = flock.y0 + (flock.y1 - flock.y0) * ease;
          const heading = Math.atan2(flock.y1 - flock.y0, flock.x1 - flock.x0);
          if (visible(fx, fy)) {
            for (const m of flock.members) {
              ctx.save();
              ctx.translate(fx + Math.cos(heading) * m.dx - Math.sin(heading) * m.dy, fy + Math.sin(heading) * m.dx + Math.cos(heading) * m.dy);
              ctx.rotate(heading); ctx.globalAlpha = 0.85;
              drawBird(ctx, size * 0.15, "#3B3128", 0.5 + 0.5 * Math.sin(sec * 8 + m.phase));
              ctx.restore();
            }
          }
        }
      }
    };
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) { last = t; return; }
      if (t - lastDraw < 1000 / 24) return;
      lastDraw = t; draw(t);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [vp, size, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile) return null;
  return <canvas ref={ref} className="fx-layer fauna" aria-hidden />;
}

