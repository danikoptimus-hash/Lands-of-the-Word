import { useEffect, useRef } from "react";
import { fireworksUntil } from "@lotw/domain";
import type { Viewport } from "./MapLayers";

/**
 * Салют над взятыми городами (решение владельца 24.10): пять минут после взятия и пять минут с наступления ночи того же дня
 * (`fireworksUntil` из домена, по часам сервера и поясу игры). Один canvas 2D поверх карты, 30 кадров в секунду, частицы
 * в координатах карты (салют едет вместе с картой при перетаскивании), сложение света (`lighter`) даёт свечение без
 * размытия. Ракета поднимается от города и лопается шаром искр своего цвета; искры тянет вниз и гасит сопротивление;
 * часть искр мерцает. Частиц не больше ~600 на все города; пока салюта нет, цикл ничего не рисует.
 * При `prefers-reduced-motion` салюта нет.
 */
export interface FireworkSite { key: string; x: number; y: number; /** Момент взятия, мс эпохи. */ at: number }

const HUES = [45, 0, 120, 200, 275, 320, 20, 160];
const MAX_PARTICLES = 600;

export function FireworksLayer({ vp, sites, clock, timeZone }: { vp: Viewport; sites: FireworkSite[]; clock: () => number; timeZone: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  const sitesRef = useRef(sites); sitesRef.current = sites;
  const clockRef = useRef(clock); clockRef.current = clock;
  const tzRef = useRef(timeZone); tzRef.current = timeZone;
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let W = 0, H = 0, raf = 0, last = 0, checked = 0, cleared = true;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } };
    type P = { x: number; y: number; px: number; py: number; vx: number; vy: number; age: number; life: number; hue: number; sat: number; size: number; tw: number; flash?: boolean };
    type R = { x: number; y: number; vx: number; vy: number; age: number; rise: number; hue: number; px: number; py: number };
    const parts: P[] = [], rockets: R[] = [];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    let active: Array<{ s: FireworkSite; next: number }> = [];
    const burst = (r: R, k: number) => {
      const n = parts.length > MAX_PARTICLES - 110 ? 30 : Math.round(rnd(70, 110));
      const two = Math.random() < 0.35, hue2 = HUES[Math.floor(Math.random() * HUES.length)]!;
      const speed = rnd(45, 100) / k, ring = Math.random() < 0.3;
      parts.push({ x: r.x, y: r.y, px: r.x, py: r.y, vx: 0, vy: 0, age: 0, life: 0.22, hue: r.hue, sat: 50, size: 34 / k, tw: 0, flash: true });
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = ring ? speed * rnd(0.9, 1.05) : speed * Math.sqrt(Math.random()) * rnd(0.85, 1.1);
        parts.push({ x: r.x, y: r.y, px: r.x, py: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 8 / k, age: 0, life: rnd(1.3, 2.1), hue: two && i % 2 ? hue2 : r.hue, sat: Math.random() < 0.12 ? 0 : 100, size: rnd(1.6, 2.8) / k, tw: Math.random() < 0.45 ? rnd(18, 32) : 0 });
      }
    };
    const draw = (now: number, dt: number) => {
      const { k, tx, ty } = vpRef.current.viewRef.current;
      // Скорости и размеры заданы в пикселях экрана и делятся на масштаб: салют выглядит одинаково при любом приближении.
      const kk = Math.min(3, Math.max(0.4, k));
      // Запуски: у каждого города своя очередь, интервал растёт, если городов много.
      const gap = active.length > 4 ? 2600 : 1700;
      for (const a of active) {
        if (now < a.next) continue;
        a.next = now + rnd(gap * 0.7, gap * 1.4);
        // Подъём ~35–55 px экрана над значком города (соседние города на телефоне близко), подъём около полусекунды.
        rockets.push({ x: a.s.x + rnd(-6, 6) / kk, y: a.s.y, vx: rnd(-8, 8) / kk, vy: -rnd(70, 90) / kk, age: 0, rise: rnd(0.5, 0.65), hue: HUES[Math.floor(Math.random() * HUES.length)]!, px: a.s.x, py: a.s.y });
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]!; r.px = r.x; r.py = r.y; r.x += r.vx * dt; r.y += r.vy * dt; r.vy += 40 / kk * dt; r.age += dt;
        if (r.age >= r.rise) { burst(r, kk); rockets.splice(i, 1); }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]!; p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        if (p.flash) continue;
        const drag = 1 - Math.min(0.9, 1.3 * dt); p.px = p.x; p.py = p.y; p.vx *= drag; p.vy = p.vy * drag + 60 / kk * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      cleared = parts.length === 0 && rockets.length === 0;
      if (cleared) return;
      ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (const r of rockets) { ctx.lineWidth = 1.6 / kk; ctx.strokeStyle = `hsla(${r.hue}, 90%, 75%, 0.9)`; ctx.beginPath(); ctx.moveTo(r.px, r.py); ctx.lineTo(r.x, r.y); ctx.stroke(); }
      for (const p of parts) {
        const t = p.age / p.life;
        if (p.flash) { const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size); g.addColorStop(0, `hsla(${p.hue}, 100%, 85%, ${0.7 * (1 - t)})`); g.addColorStop(1, `hsla(${p.hue}, 100%, 70%, 0)`); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); continue; }
        let a = (1 - t) * (1 - t * 0.3);
        if (p.tw) a *= 0.55 + 0.45 * Math.sin(p.age * p.tw);
        const s = p.size * (1 - t * 0.4);
        // Искра — короткий штрих от прошлого положения к нынешнему: читается как летящий огонёк, а не точка.
        ctx.strokeStyle = `hsla(${p.hue}, ${p.sat}%, ${62 + 25 * (1 - t)}%, ${a.toFixed(3)})`; ctx.lineWidth = s;
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x + (p.x - p.px) * 0.6, p.y + (p.y - p.py) * 0.6); ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (now - checked > 1000) {
        checked = now;
        const t = clockRef.current(), tz = tzRef.current;
        const keep = new Map(active.map((a) => [a.s.key, a.next]));
        active = sitesRef.current.filter((s) => fireworksUntil(s.at, t, tz) !== null).map((s) => ({ s, next: keep.get(s.key) ?? now + rnd(0, 800) }));
      }
      if (!active.length && cleared) return;
      if (now - last < 33) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.033; last = now;
      draw(now, dt);
    };
    const ro = new ResizeObserver(resize); ro.observe(host);
    resize(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className="fx-layer fireworks" aria-hidden="true" />;
}
