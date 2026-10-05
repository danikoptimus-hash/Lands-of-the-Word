import { useEffect, useRef } from "react";
import type { Season } from "@lotw/domain";
import type { Bounds } from "../lib/useViewport";
import type { Viewport } from "./MapLayers";
import { DAY_LIGHT, type Light } from "../lib/daytime";

/**
 * Погода по временам года (решение владельца 05.10): отдельный canvas поверх карты, ничего не перехватывает.
 *   зима  — снег эпизодами: примерно десять минут идёт, десять не идёт (длина и начало эпизода, густота и скорость падения —
 *           случайные в каждом окне), снежинки с покачиванием, разного размера;
 *   лето  — дожди и грозы: в части получасовых окон 6–12 минут дождя, наплывают тучи, над картой тени, у грозы — молнии со вспышкой;
 *   осень — листопад: летящие по ветру листочки, то гуще, то реже (порывы), изредка дождь;
 *   весна — редкий тёплый дождь, без туч.
 * Эпизоды считаются от часов сервера и семени игры, поэтому у всей команды погода одна и та же, и после возврата
 * в приложение картина не «перезапускается». Частицы — в координатах экрана (падают на зрителя), тучи и молнии — в
 * координатах карты (плывут вместе с ней).
 */
export type WeatherKind = "snow" | "rain" | "storm" | "leaves" | null;
export interface WeatherEpisode { kind: WeatherKind; /** Сила 0..1 с плавным нарастанием и спадом. */ intensity: number; /** Множитель скорости падения. */ speed: number; /** Листопад: сила порыва 0..1. */ gust: number; /** Семя эпизода (для молний и туч). */ seed: number; /** Секунды от начала эпизода. */ t: number }

const MIN = 60_000;
function hash(str: string): number { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mulberry32(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const noise1 = (t: number, seed: number) => 0.5 * Math.sin(t + seed) + 0.3 * Math.sin(t * 2.17 + seed * 1.7) + 0.2 * Math.sin(t * 4.3 + seed * 2.9);
const smooth = (x: number) => { const v = Math.max(0, Math.min(1, x)); return v * v * (3 - 2 * v); };

/** Окно сезона: длина окна и как внутри него выпадает эпизод. */
function seasonWindow(season: Season): { len: number; chance: number; start: [number, number]; dur: [number, number]; storm: number } {
  switch (season) {
    case "winter": return { len: 20, chance: 1, start: [0, 2], dur: [8, 12], storm: 0 }; // примерно 10 минут идёт, 10 — нет
    case "summer": return { len: 30, chance: 0.42, start: [0, 10], dur: [6, 12], storm: 0.5 };
    case "spring": return { len: 30, chance: 0.22, start: [0, 12], dur: [4, 9], storm: 0.1 };
    case "autumn": return { len: 40, chance: 0.3, start: [0, 15], dur: [5, 10], storm: 0.15 };
  }
}

/** Предпросмотр погоды: `?weather=snow|rain|storm|leaves|none` — только картинка, для проверки и скриншотов. */
function previewWeather(): WeatherKind | "none" | null {
  if (typeof location === "undefined") return null;
  const m = /[?&]weather=([a-z]+)/.exec(location.search);
  return m && ["snow", "rain", "storm", "leaves", "none"].includes(m[1]!) ? (m[1] as WeatherKind | "none") : null;
}
const PREVIEW = previewWeather();

/** Эпизод погоды в момент now (мс сервера) для сезона и семени игры. */
export function weatherAt(season: Season, seed: string, now: number): WeatherEpisode {
  if (PREVIEW) return PREVIEW === "none" ? { kind: null, intensity: 0, speed: 1, gust: 0, seed: 0, t: 0 } : { kind: PREVIEW, intensity: 0.85, speed: 1, gust: 0.7, seed: 1, t: 60 };
  const w = seasonWindow(season), slotMs = w.len * MIN, slot = Math.floor(now / slotMs);
  const rng = mulberry32(hash(`${seed}:weather:${season}:${slot}`));
  const roll = rng(), a = (w.start[0] + rng() * (w.start[1] - w.start[0])) * MIN, dur = (w.dur[0] + rng() * (w.dur[1] - w.dur[0])) * MIN;
  const strength = 0.45 + rng() * 0.55, speed = 0.75 + rng() * 0.6, isStorm = rng() < w.storm;
  const since = now - slot * slotMs - a;
  const ramp = 25_000;
  const active = roll < w.chance && since >= 0 && since <= dur;
  const edge = active ? Math.min(smooth(since / ramp), smooth((dur - since) / ramp)) : 0;
  const t = (now % 1_000_000_000) / 1000;
  const gust = season === "autumn" ? 0.35 + 0.65 * smooth(0.5 + 0.5 * noise1(t / 9, hash(seed) % 100)) : 0;
  if (active) return { kind: season === "winter" ? "snow" : isStorm ? "storm" : "rain", intensity: strength * edge, speed, gust, seed: slot, t: since / 1000 };
  return { kind: season === "autumn" ? "leaves" : null, intensity: season === "autumn" ? gust : 0, speed: 1, gust, seed: slot, t: 0 };
}

interface Particle { x: number; y: number; z: number; v: number; sway: number; ph: number; rot: number; hue: number; shape: number }
interface Cloud { x: number; y: number; r: number; v: number; seed: number }

export function WeatherLayer({ vp, bounds, season, seed = "", clock = Date.now, light = DAY_LIGHT, size = 26 }: { vp: Viewport; bounds: Bounds | null; season: Season; seed?: string; clock?: () => number; light?: Light; /** Размер гекса: масштаб туч и молний. */ size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const clockRef = useRef(clock); clockRef.current = clock;
  const lightRef = useRef(light); lightRef.current = light;
  const vpRef = useRef(vp); vpRef.current = vp;
  const boundsRef = useRef(bounds); boundsRef.current = bounds;

  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(host);
    const rng = mulberry32(hash(`${seed}:particles`));
    const prng = (a: number, b: number) => a + rng() * (b - a);
    // Частицы заводятся с запасом и показываются по силе эпизода: без пересоздания при каждом изменении.
    const MAXP = season === "winter" ? (W * H > 1.5e6 ? 420 : 260) : season === "autumn" ? 90 : 320;
    const parts: Particle[] = Array.from({ length: MAXP }, () => ({ x: prng(0, 1), y: prng(0, 1), z: prng(0.35, 1), v: prng(0.7, 1.3), sway: prng(0.4, 1.2), ph: prng(0, 6.28), rot: prng(0, 6.28), hue: prng(0, 1), shape: Math.floor(prng(0, 3)) }));
    const rainParts: Particle[] = season === "winter" ? [] : Array.from({ length: 320 }, () => ({ x: prng(0, 1), y: prng(0, 1), z: prng(0.4, 1), v: prng(0.8, 1.2), sway: 0, ph: 0, rot: 0, hue: 0, shape: 0 }));
    let clouds: Cloud[] = [], cloudsFor = -1;
    const makeClouds = (ep: WeatherEpisode) => {
      const b = boundsRef.current; if (!b) { clouds = []; return; }
      const r = mulberry32(hash(`${seed}:clouds:${ep.seed}`));
      const n = ep.kind === "storm" ? 9 : 6;
      clouds = Array.from({ length: n }, (_, i) => ({ x: b.minX + r() * b.width, y: b.minY + r() * b.height, r: size * (4 + r() * 4), v: size * (0.08 + r() * 0.08) * (ep.kind === "storm" ? 1.4 : 1), seed: i * 7.3 + r() * 10 }));
      cloudsFor = ep.seed;
    };
    let flashUntil = 0, boltUntil = 0, bolt: Array<[number, number]> = [], nextBolt = 0;
    let raf = 0, last = performance.now();
    const draw = (nowPerf: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      const dt = Math.min(0.05, (nowPerf - last) / 1000); last = nowPerf;
      const now = clockRef.current();
      const ep = weatherAt(season, seed, now);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      if (!ep.kind || ep.intensity <= 0.001) { clouds = []; return; }
      const { k, tx, ty } = vpRef.current.viewRef.current;
      const lt = lightRef.current;
      const nightness = 1 - Math.min(1, (lt.sand[0] + lt.sand[1] + lt.sand[2]) / 2.4); // 0 днём, ~1 ночью
      const wind = 0.35 + 0.25 * noise1(now / 7000, 3);
      // ---- тучи и тень от них (дождь, гроза): в координатах карты ----
      if (ep.kind === "rain" || ep.kind === "storm") {
        if (cloudsFor !== ep.seed || !clouds.length) makeClouds(ep);
        ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
        const dim = (ep.kind === "storm" ? 0.28 : 0.16) * ep.intensity;
        // общий полумрак
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(30,38,52,${dim})`; ctx.fillRect(0, 0, W, H);
        ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
        for (const c of clouds) {
          c.x += c.v * wind * dt * 3; c.y += c.v * 0.3 * noise1(now / 9000, c.seed) * dt * 3;
          const b = boundsRef.current; if (b && c.x > b.minX + b.width + c.r) c.x = b.minX - c.r;
          const wob = 1 + 0.06 * noise1(now / 3000, c.seed);
          // тень на земле — смещена, затем сама туча: мягкая серо-синяя масса с более светлым верхом
          const sh = ctx.createRadialGradient(c.x + c.r * 0.25, c.y + c.r * 0.35, 0, c.x + c.r * 0.25, c.y + c.r * 0.35, c.r * wob);
          sh.addColorStop(0, `rgba(20,26,40,${0.28 * ep.intensity})`); sh.addColorStop(1, "rgba(20,26,40,0)");
          ctx.fillStyle = sh; ctx.fillRect(c.x - c.r * 1.5, c.y - c.r * 1.5, c.r * 3, c.r * 3);
          const g = ctx.createRadialGradient(c.x - c.r * 0.2, c.y - c.r * 0.25, 0, c.x, c.y, c.r * wob);
          const dark = ep.kind === "storm" ? 0.62 : 0.5;
          g.addColorStop(0, `rgba(${Math.round(150 - 60 * nightness)},${Math.round(156 - 60 * nightness)},${Math.round(168 - 56 * nightness)},${dark * ep.intensity})`);
          g.addColorStop(0.55, `rgba(${Math.round(110 - 50 * nightness)},${Math.round(118 - 50 * nightness)},${Math.round(136 - 50 * nightness)},${0.75 * dark * ep.intensity})`);
          g.addColorStop(1, "rgba(90,98,118,0)");
          ctx.fillStyle = g; ctx.fillRect(c.x - c.r * 1.5, c.y - c.r * 1.5, c.r * 3, c.r * 3);
        }
        // ---- молнии (гроза): раз в 12–40 с, вспышка на весь экран и зигзаг от тучи вниз ----
        if (ep.kind === "storm" && ep.intensity > 0.3) {
          if (!nextBolt) nextBolt = now + 4000 + 20_000 * mulberry32(hash(`${seed}:bolt:${ep.seed}:${Math.floor(now / 30000)}`))();
          if (now >= nextBolt) {
            const r = mulberry32(hash(`${seed}:boltpath:${Math.floor(now / 1000)}`));
            const c = clouds[Math.floor(r() * clouds.length)]!;
            let x = c.x + (r() - 0.5) * c.r, y = c.y + c.r * 0.2; bolt = [[x, y]];
            const len = size * (3 + r() * 3), steps = 7 + Math.floor(r() * 5);
            for (let i = 0; i < steps; i++) { x += (r() - 0.5) * size * 1.2; y += len / steps; bolt.push([x, y]); }
            flashUntil = now + 140; boltUntil = now + 220; nextBolt = now + 12_000 + r() * 28_000;
          }
          if (now < boltUntil) {
            ctx.save(); ctx.strokeStyle = "rgba(255,255,240,0.95)"; ctx.lineWidth = size * 0.08; ctx.shadowColor = "rgba(200,220,255,0.9)"; ctx.shadowBlur = size * 0.6; ctx.lineJoin = "round";
            ctx.beginPath(); bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore();
          }
        } else nextBolt = 0;
      }
      // ---- частицы: в координатах экрана ----
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const area = W * H / (dpr * dpr);
      if (ep.kind === "snow") {
        const n = Math.round(parts.length * Math.min(1, ep.intensity * (area > 1.5e6 ? 1 : 0.8)));
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        for (let i = 0; i < n; i++) {
          const p = parts[i]!;
          const fall = (0.045 + 0.07 * p.z) * p.v * ep.speed; // доля высоты экрана в секунду
          p.y += fall * dt; p.x += (wind * 0.05 * p.z + 0.012 * p.sway * Math.sin(now / 900 + p.ph)) * dt * 3;
          if (p.y > 1.02) { p.y = -0.02; p.x = rng(); } if (p.x > 1.02) p.x = -0.02; else if (p.x < -0.02) p.x = 1.02;
          const r = (0.9 + 2.4 * p.z) * dpr * Math.min(1.3, 0.8 + k * 0.3);
          ctx.globalAlpha = (0.45 + 0.5 * p.z) * Math.min(1, ep.intensity * 1.6);
          ctx.beginPath(); ctx.arc(p.x * W, p.y * H, r, 0, 6.283); ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (ep.kind === "rain" || ep.kind === "storm") {
        const n = Math.round(rainParts.length * Math.min(1, ep.intensity * (ep.kind === "storm" ? 1 : 0.7)));
        const slant = 0.12 + 0.1 * wind;
        ctx.strokeStyle = `rgba(${Math.round(205 - 40 * nightness)},${Math.round(220 - 40 * nightness)},${Math.round(235 - 30 * nightness)},0.5)`;
        ctx.lineWidth = Math.max(1, 0.9 * dpr); ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const p = rainParts[i]!;
          const fall = (0.9 + 0.6 * p.z) * p.v * ep.speed;
          p.y += fall * dt; p.x += slant * fall * dt;
          if (p.y > 1.02) { p.y = -0.05; p.x = rng() * 1.2 - 0.15; }
          const L = (0.02 + 0.02 * p.z) * H;
          ctx.moveTo(p.x * W, p.y * H); ctx.lineTo(p.x * W - slant * L, p.y * H - L);
        }
        ctx.stroke();
        // вспышка молнии — поверх всего
        if (now < flashUntil) { ctx.fillStyle = `rgba(255,255,255,${0.55 * (flashUntil - now) / 140})`; ctx.fillRect(0, 0, W, H); }
      } else if (ep.kind === "leaves") {
        const n = Math.round(parts.length * Math.min(1, 0.35 + 0.65 * ep.gust));
        for (let i = 0; i < n; i++) {
          const p = parts[i]!;
          const g = 0.5 + ep.gust;
          p.y += (0.03 + 0.05 * p.z) * p.v * g * dt; p.x += (0.08 * g * p.z + 0.03 * p.sway * Math.sin(now / 700 + p.ph)) * dt;
          p.rot += (1.2 + 2 * p.sway) * dt;
          if (p.y > 1.03 || p.x > 1.05) { p.y = rng() < 0.5 ? -0.03 : rng(); p.x = p.y < 0 ? rng() : -0.04; }
          const s = (3 + 3.5 * p.z) * dpr * Math.min(1.2, 0.8 + k * 0.25);
          const hue = p.hue < 0.45 ? "#E3B23C" : p.hue < 0.8 ? "#D9792A" : "#B8432C";
          ctx.save(); ctx.translate(p.x * W, p.y * H); ctx.rotate(p.rot); ctx.globalAlpha = 0.75 + 0.25 * p.z;
          ctx.fillStyle = hue; ctx.beginPath();
          if (p.shape === 0) ctx.ellipse(0, 0, s, s * 0.55, 0, 0, 6.283);
          else { ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.9, -s * 0.2, 0, s); ctx.quadraticCurveTo(-s * 0.9, -s * 0.2, 0, -s); }
          ctx.fill(); ctx.restore();
        }
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [season, seed, size]);

  return <canvas ref={ref} className="fx-layer weather" aria-hidden />;
}
