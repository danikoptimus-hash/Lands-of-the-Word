import { useEffect, useRef } from "react";
import type { Season } from "@lotw/domain";
import type { Bounds } from "../lib/useViewport";
import type { Viewport } from "./MapLayers";
import { DAY_LIGHT, type Light } from "../lib/daytime";

/**
 * Погода по временам года (решение владельца 05.10): отдельный canvas поверх карты, ничего не перехватывает.
 *   зима  — снег эпизодами (примерно десять минут идёт, десять нет): три слоя снежинок разной глубины — дальние мелкие и
 *           медленные, ближние крупные, мягкие и быстрые; ветер с порывами, в сильный ветер — метель: снег летит косыми
 *           штрихами, над картой дымка;
 *   лето  — дожди и грозы: наплывают объёмные тучи с тенью на земле, косой дождь, у грозы — ветвистые молнии со свечением
 *           и двойной вспышкой;
 *   осень — листопад порывами, изредка дождь; весна — редкий дождь.
 * Эпизоды считаются от часов сервера и семени игры, поэтому у всей команды погода одна и та же. Частицы — в координатах
 * экрана, тучи и молнии — в координатах карты. Предпросмотр: `?weather=snow|blizzard|rain|storm|leaves|none`.
 */
export type WeatherKind = "snow" | "rain" | "storm" | "leaves" | null;
export interface WeatherEpisode { kind: WeatherKind; /** Сила 0..1 с плавным нарастанием и спадом. */ intensity: number; /** Множитель скорости падения. */ speed: number; /** Ветер 0..1: у снега от тихого снегопада до метели. */ wind: number; /** Листопад: сила порыва 0..1. */ gust: number; /** Семя эпизода (тучи, молнии). */ seed: number; /** Секунды от начала эпизода. */ t: number }

const MIN = 60_000;
function hash(str: string): number { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mulberry32(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const noise1 = (t: number, seed: number) => 0.5 * Math.sin(t + seed) + 0.3 * Math.sin(t * 2.17 + seed * 1.7) + 0.2 * Math.sin(t * 4.3 + seed * 2.9);
const smooth = (x: number) => { const v = Math.max(0, Math.min(1, x)); return v * v * (3 - 2 * v); };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Окно сезона: длина окна (мин) и как внутри него выпадает эпизод. */
function seasonWindow(season: Season): { len: number; chance: number; start: [number, number]; dur: [number, number]; storm: number } {
  switch (season) {
    case "winter": return { len: 20, chance: 1, start: [0, 2], dur: [8, 12], storm: 0 };
    case "summer": return { len: 30, chance: 0.45, start: [0, 10], dur: [6, 12], storm: 0.5 };
    case "spring": return { len: 30, chance: 0.25, start: [0, 12], dur: [4, 9], storm: 0.2 };
    case "autumn": return { len: 40, chance: 0.32, start: [0, 15], dur: [5, 10], storm: 0.25 };
  }
}

/** Предпросмотр погоды — только картинка, для проверки и скриншотов. */
function previewWeather(): string | null {
  if (typeof location === "undefined") return null;
  const m = /[?&]weather=([a-z]+)/.exec(location.search);
  return m && ["snow", "blizzard", "rain", "storm", "leaves", "none"].includes(m[1]!) ? m[1]! : null;
}
const PREVIEW = previewWeather();

/** Эпизод погоды в момент now (мс сервера) для сезона и семени игры. */
export function weatherAt(season: Season, seed: string, now: number): WeatherEpisode {
  const t = (now % 1_000_000_000) / 1000;
  const gust = 0.35 + 0.65 * smooth(0.5 + 0.5 * noise1(t / 9, hash(seed) % 100));
  if (PREVIEW) {
    if (PREVIEW === "none") return { kind: null, intensity: 0, speed: 1, wind: 0, gust: 0, seed: 0, t: 0 };
    if (PREVIEW === "blizzard") return { kind: "snow", intensity: 1, speed: 1.2, wind: 1, gust, seed: 1, t: 60 };
    return { kind: PREVIEW as WeatherKind, intensity: 0.9, speed: 1, wind: PREVIEW === "storm" ? 0.7 : 0.3, gust, seed: 1, t: 60 };
  }
  const w = seasonWindow(season), slotMs = w.len * MIN, slot = Math.floor(now / slotMs);
  const rng = mulberry32(hash(`${seed}:weather:${season}:${slot}`));
  const roll = rng(), a = (w.start[0] + rng() * (w.start[1] - w.start[0])) * MIN, dur = (w.dur[0] + rng() * (w.dur[1] - w.dur[0])) * MIN;
  const strength = 0.45 + rng() * 0.55, speed = 0.75 + rng() * 0.6, isStorm = rng() < w.storm, wind = Math.pow(rng(), 1.4);
  const since = now - slot * slotMs - a;
  const ramp = 25_000;
  const active = roll < w.chance && since >= 0 && since <= dur;
  const edge = active ? Math.min(smooth(since / ramp), smooth((dur - since) / ramp)) : 0;
  if (active) return { kind: season === "winter" ? "snow" : isStorm ? "storm" : "rain", intensity: strength * edge, speed, wind: isStorm ? 0.5 + wind * 0.5 : wind, gust, seed: slot, t: since / 1000 };
  return { kind: season === "autumn" ? "leaves" : null, intensity: season === "autumn" ? gust : 0, speed: 1, wind: 0.3, gust, seed: slot, t: 0 };
}

interface Flake { x: number; y: number; z: number; v: number; sway: number; ph: number; rot: number; hue: number; shape: number }
interface Lobe { dx: number; dy: number; r: number }
interface Cloud { x: number; y: number; r: number; v: number; seed: number; lobes: Lobe[]; /** Номер спрайта тучи и его поворот. */ img: number; rot: number }
/** Спрайты туч (фотореалистичные, вид сверху, прозрачный фон; переделка 05.10). Пока спрайт не загружен — рисуются лепестки. */
const CLOUD_SPRITES = 3;
let cloudImgs: HTMLImageElement[] | null = null;
function cloudImages(): HTMLImageElement[] {
  if (!cloudImgs) cloudImgs = Array.from({ length: CLOUD_SPRITES }, (_, i) => { const im = new Image(); im.decoding = "async"; im.src = `/img/sky/cloud-${i + 1}.webp`; return im; });
  return cloudImgs;
}
/** Туча, затемнённая под грозу и ночь (ступени), и её силуэт для тени: кэш холстов, без ctx.filter. */
const cloudTinted = new Map<string, HTMLCanvasElement>();
function cloudSprite(i: number, dark: number, silhouette = false): HTMLImageElement | HTMLCanvasElement | null {
  const im = cloudImages()[i]!;
  if (!im.complete || !im.naturalWidth) return null;
  const step = silhouette ? 99 : Math.round(clamp(dark, 0, 1) * 10);
  if (step === 0) return im;
  const key = `${i}:${step}`;
  let c = cloudTinted.get(key);
  if (!c) {
    c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext("2d")!; x.drawImage(im, 0, 0);
    x.globalCompositeOperation = silhouette ? "source-in" : "source-atop";
    x.fillStyle = silhouette ? "rgb(12,18,32)" : `rgba(30,38,58,${(step / 10) * 0.75})`; x.fillRect(0, 0, c.width, c.height);
    cloudTinted.set(key, c);
  }
  return c;
}

/** Мягкая снежинка: радиальный градиент, отрисованный один раз в спрайт. */
function flakeSprite(d: number, softness: number): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = c.height = Math.ceil(d);
  const g = c.getContext("2d")!, r = d / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.35 * (1 - softness) + 0.15, "rgba(255,255,255,0.85)"); grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad; g.fillRect(0, 0, d, d);
  return c;
}

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
    const big = W * H > 1.6e6;
    // Снег: три слоя по глубине (0 — далеко, 2 — близко). Спрайты для каждого слоя.
    const SNOW_N = big ? [220, 160, 70] : [150, 110, 45];
    const snow: Flake[][] = SNOW_N.map((n, z) => Array.from({ length: n }, () => ({ x: prng(0, 1), y: prng(0, 1), z, v: prng(0.75, 1.25), sway: prng(0.4, 1.2), ph: prng(0, 6.28), rot: 0, hue: 0, shape: 0 })));
    const sprites = [flakeSprite(5 * dpr, 0.2), flakeSprite(9 * dpr, 0.5), flakeSprite(16 * dpr, 0.8)];
    const rain: Flake[] = Array.from({ length: big ? 420 : 300 }, () => ({ x: prng(0, 1), y: prng(0, 1), z: prng(0.35, 1), v: prng(0.85, 1.2), sway: 0, ph: 0, rot: 0, hue: 0, shape: 0 }));
    const leaves: Flake[] = Array.from({ length: big ? 150 : 95 }, () => ({ x: prng(0, 1), y: prng(0, 1), z: prng(0.35, 1), v: prng(0.7, 1.3), sway: prng(0.4, 1.2), ph: prng(0, 6.28), rot: prng(0, 6.28), hue: prng(0, 1), shape: Math.floor(prng(0, 3)) }));
    let clouds: Cloud[] = [], cloudsFor = -1;
    const makeClouds = (ep: WeatherEpisode) => {
      const b = boundsRef.current; if (!b) { clouds = []; return; }
      const r = mulberry32(hash(`${seed}:clouds:${ep.seed}`));
      const n = ep.kind === "storm" ? 8 : 6;
      clouds = Array.from({ length: n }, (_, i) => {
        const R = size * (3.2 + r() * 2.6);
        const lobes: Lobe[] = Array.from({ length: 7 + Math.floor(r() * 5) }, () => { const a = r() * 6.283, d = r() * 0.55; return { dx: Math.cos(a) * d * R, dy: Math.sin(a) * d * R * 0.75, r: R * (0.38 + r() * 0.32) }; });
        return { x: b.minX + r() * b.width, y: b.minY + r() * b.height, r: R, v: size * (0.06 + r() * 0.08) * (ep.kind === "storm" ? 1.5 : 1), seed: i * 7.3 + r() * 10, lobes, img: Math.floor(r() * CLOUD_SPRITES), rot: r() * 6.283 };
      });
      cloudsFor = ep.seed;
    };
    // Молния: ствол с ветвями; рисуется кадрами мерцания (яркий, тусклый, яркий) около 0,3 с.
    let bolt: Array<Array<[number, number]>> = [], boltAt = 0, nextBolt = 0, boltCloud: Cloud | null = null;
    const makeBolt = (c: Cloud, r: () => number) => {
      const paths: Array<Array<[number, number]>> = [];
      const len = size * (3.5 + r() * 3.5), dir = Math.PI / 2 + (r() - 0.5) * 0.9;
      const trunk: Array<[number, number]> = []; let x = c.x + (r() - 0.5) * c.r * 0.6, y = c.y + c.r * 0.15;
      const steps = 9 + Math.floor(r() * 6);
      for (let i = 0; i <= steps; i++) { trunk.push([x, y]); const jag = (r() - 0.5) * size * 0.9; x += Math.cos(dir) * len / steps + Math.cos(dir + Math.PI / 2) * jag; y += Math.sin(dir) * len / steps + Math.sin(dir + Math.PI / 2) * jag * 0.6; }
      paths.push(trunk);
      for (let k = 0; k < 2 + Math.floor(r() * 3); k++) { // ветви от середины ствола
        const from = trunk[2 + Math.floor(r() * (steps - 4))]!; let bx = from[0], by = from[1]; const bd = dir + (r() - 0.5) * 1.6, bl = len * (0.25 + r() * 0.3), bs = 4 + Math.floor(r() * 3);
        const br: Array<[number, number]> = [[bx, by]];
        for (let i = 0; i < bs; i++) { bx += Math.cos(bd) * bl / bs + (r() - 0.5) * size * 0.5; by += Math.sin(bd) * bl / bs + (r() - 0.5) * size * 0.3; br.push([bx, by]); }
        paths.push(br);
      }
      return paths;
    };
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
      const night = 1 - clamp((lt.sand[0] + lt.sand[1] + lt.sand[2]) / 2.4, 0, 1);
      // Ветер: базовый по эпизоду плюс порывы (медленный шум); направление — слева направо с небольшим наклоном.
      const gustN = 0.5 + 0.5 * noise1(now / 6000, 11);
      const wind = ep.wind * (0.55 + 0.45 * gustN);
      // ---- тучи, тень и молнии (дождь, гроза): в координатах карты ----
      if (ep.kind === "rain" || ep.kind === "storm") {
        if (cloudsFor !== ep.seed || !clouds.length) makeClouds(ep);
        const dim = (ep.kind === "storm" ? 0.30 : 0.16) * ep.intensity;
        ctx.fillStyle = `rgba(26,32,46,${dim})`; ctx.fillRect(0, 0, W, H);
        ctx.setTransform(k * dpr, 0, 0, k * dpr, tx * dpr, ty * dpr);
        // Вспышка ~0,55 с: главный удар, спад, повторный удар, угасание (как у настоящей молнии с несколькими разрядами)
        const FLASH_MS = 550;
        const flashing = now - boltAt < FLASH_MS;
        const flashPhase = flashing ? (() => { const u = (now - boltAt) / FLASH_MS; return u < 0.18 ? 1 : u < 0.32 ? 0.3 : u < 0.5 ? 0.95 : u < 0.62 ? 0.45 : 1 - (u - 0.62) / 0.38; })() : 0;
        for (const c of clouds) {
          c.x += c.v * (0.6 + wind) * dt * 2.5; c.y += c.v * 0.25 * noise1(now / 9000, c.seed) * dt * 2.5;
          const b = boundsRef.current; if (b && c.x > b.minX + b.width + c.r * 1.5) c.x = b.minX - c.r * 1.5;
          const wob = 1 + 0.05 * noise1(now / 3500, c.seed);
          const lit = c === boltCloud ? flashPhase : 0;
          const dark = (ep.kind === "storm" ? 0.55 : 0.2) + 0.45 * night;
          const sp = cloudSprite(c.img, dark), sil = cloudSprite(c.img, 0, true);
          if (sp && sil) {
            // Спрайт: тень на земле (силуэт, смещён от светила), тело тучи, в грозу — вспышка изнутри
            const D = c.r * 2.4 * wob;
            ctx.save(); ctx.translate(c.x + c.r * 0.3 * lt.sunX, c.y + c.r * 0.35 * Math.max(0.3, lt.sunY)); ctx.rotate(c.rot);
            ctx.globalAlpha = 0.42 * ep.intensity; ctx.drawImage(sil, -D / 2, -D / 2, D, D); ctx.restore();
            ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
            ctx.globalAlpha = Math.min(1, ep.intensity * 1.4); ctx.drawImage(sp, -D / 2, -D / 2, D, D);
            if (lit > 0.05) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = lit * 0.7; ctx.drawImage(cloudImages()[c.img]!, -D / 2, -D / 2, D, D); }
            ctx.restore(); ctx.globalAlpha = 1;
            continue;
          }
          // тень тучи на земле — смещена от светила, мягкая
          ctx.globalAlpha = 0.5 * ep.intensity;
          for (const l of c.lobes) {
            const sx = c.x + l.dx + c.r * 0.25 * lt.sunX, sy = c.y + l.dy + c.r * 0.3 * Math.max(0.3, lt.sunY), sr = l.r * wob * 1.05;
            const sh = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
            sh.addColorStop(0, "rgba(14,20,34,0.35)"); sh.addColorStop(0.6, "rgba(14,20,34,0.18)"); sh.addColorStop(1, "rgba(14,20,34,0)");
            ctx.fillStyle = sh; ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
          }
          // тело тучи: тёмное основание, светлее к верхнему краю со стороны светила; в грозу темнее и синее
          const base = ep.kind === "storm" ? [72 - 30 * night, 78 - 30 * night, 96 - 26 * night] : [120 - 50 * night, 126 - 50 * night, 140 - 48 * night];
          const top = ep.kind === "storm" ? [150 - 60 * night, 156 - 60 * night, 172 - 56 * night] : [205 - 80 * night, 208 - 80 * night, 216 - 76 * night];
          ctx.globalAlpha = Math.min(1, ep.intensity * 1.4);
          for (const l of c.lobes) {
            const cx = c.x + l.dx, cy = c.y + l.dy, rr = l.r * wob;
            const g = ctx.createRadialGradient(cx - rr * 0.3 * lt.sunX, cy - rr * 0.35, 0, cx, cy, rr);
            const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t));
            const hi = mix(top, [255, 255, 255], lit * 0.8), lo = mix(base, [200, 210, 240], lit * 0.6);
            g.addColorStop(0, `rgba(${hi[0]},${hi[1]},${hi[2]},0.95)`); g.addColorStop(0.55, `rgba(${lo[0]},${lo[1]},${lo[2]},0.9)`); g.addColorStop(1, `rgba(${lo[0]},${lo[1]},${lo[2]},0)`);
            ctx.fillStyle = g; ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
          }
          ctx.globalAlpha = 1;
        }
        if (ep.kind === "storm" && ep.intensity > 0.3 && clouds.length) {
          if (!nextBolt) nextBolt = now + 2000 + 9000 * mulberry32(hash(`${seed}:bolt:${ep.seed}:${Math.floor(now / 20000)}`))();
          if (now >= nextBolt) {
            const r = mulberry32(hash(`${seed}:boltpath:${Math.floor(now / 500)}`));
            boltCloud = clouds[Math.floor(r() * clouds.length)]!; bolt = makeBolt(boltCloud, r); boltAt = now; nextBolt = now + (PREVIEW ? 1500 + r() * 2000 : 5000 + r() * 14_000);
          }
          if (flashing && flashPhase > 0.05) {
            ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round";
            // свечение, затем яркий канал
            for (const pass of [0, 1]) {
              ctx.strokeStyle = pass === 0 ? `rgba(170,200,255,${0.6 * flashPhase})` : `rgba(255,255,250,${Math.min(1, 0.6 + 0.4 * flashPhase)})`;
              ctx.shadowColor = pass === 0 ? "rgba(150,190,255,0.95)" : "rgba(230,240,255,1)"; ctx.shadowBlur = size * (pass === 0 ? 1.6 : 0.4);
              bolt.forEach((path, i) => { ctx.lineWidth = size * (i === 0 ? 0.14 : 0.07) * (pass === 0 ? 2.4 : 1); ctx.beginPath(); path.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); });
            }
            ctx.restore();
          }
        } else { nextBolt = 0; boltCloud = null; }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (flashing) { ctx.fillStyle = `rgba(235,240,255,${0.38 * flashPhase * flashPhase})`; ctx.fillRect(0, 0, W, H); }
      }
      // ---- частицы: в координатах экрана ----
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const zoomS = clamp(0.8 + k * 0.25, 0.8, 1.3);
      if (ep.kind === "snow") {
        const blizzard = clamp((wind - 0.45) / 0.45, 0, 1) * ep.intensity;
        // Дымка метели: белёсая пелена, гуще к ветру
        if (blizzard > 0.02) {
          const hz = ctx.createLinearGradient(0, 0, W, H * 0.4);
          hz.addColorStop(0, `rgba(230,236,245,${0.2 * blizzard})`); hz.addColorStop(1, `rgba(230,236,245,${0.1 * blizzard})`);
          ctx.fillStyle = hz; ctx.fillRect(0, 0, W, H);
          // полосы позёмки: широкие мягкие языки, несутся по ветру с разной скоростью
          for (let i = 0; i < 4; i++) {
            const sp = 0.08 + 0.05 * i, u = ((now / 1000) * sp * (0.6 + wind) + i * 0.37) % 1.4 - 0.2;
            const cx = u * W, cy = H * (0.15 + 0.22 * i + 0.08 * noise1(now / 4000, i * 3)), rx = W * 0.35, ry = H * (0.08 + 0.04 * noise1(now / 2500, i));
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 1);
            g.addColorStop(0, `rgba(240,244,250,${0.22 * blizzard})`); g.addColorStop(1, "rgba(240,244,250,0)");
            ctx.save(); ctx.translate(cx, cy); ctx.scale(rx, ry); ctx.translate(-cx, -cy); ctx.fillStyle = g; ctx.fillRect(cx - 1, cy - 1, 2, 2); ctx.restore();
          }
        }
        for (let z = 0; z < 3; z++) {
          const layer = snow[z]!, n = Math.round(layer.length * clamp(ep.intensity * 1.3, 0, 1) * (z === 2 ? 0.6 + 0.4 * ep.intensity : 1));
          const depth = [0.45, 0.75, 1.1][z]!;
          const fall = (0.035 + 0.05 * depth) * ep.speed * (1 + 1.6 * wind * depth); // доля высоты экрана в секунду
          const drift = (0.03 + 0.42 * wind) * depth;
          const spr = sprites[z]!, sw = spr.width * zoomS;
          const streak = blizzard * depth;
          ctx.globalAlpha = [0.55, 0.75, 0.9][z]! * clamp(ep.intensity * 1.5, 0, 1);
          for (let i = 0; i < n; i++) {
            const p = layer[i]!;
            const sw1 = 0.012 * p.sway * Math.sin(now / 900 + p.ph) * (1 - wind * 0.6) + 0.006 * noise1(now / 1300, p.ph * 10);
            p.y += fall * p.v * dt; p.x += (drift + sw1) * dt;
            if (p.y > 1.03) { p.y = -0.03; p.x = rng() * (1 + drift) - drift * 0.5; }
            if (p.x > 1.03) p.x = -0.03; else if (p.x < -0.03) p.x = 1.03;
            const px = p.x * W, py = p.y * H;
            if (streak > 0.15) { // метель: размытый след вдоль скорости — яркая голова, прозрачный хвост, у каждой снежинки своя длина
              const vx = drift * W, vy = fall * p.v * H, sp = Math.hypot(vx, vy) || 1;
              const L = clamp(streak * 1.2, 0, 1) * sp * (0.025 + 0.035 * p.sway);
              const ux = vx / sp, uy = vy / sp;
              const g = ctx.createLinearGradient(px - ux * L, py - uy * L, px, py);
              const a = (0.25 + 0.45 * p.v * 0.8) * (0.5 + 0.5 * depth);
              g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.7, `rgba(255,255,255,${a * 0.6})`); g.addColorStop(1, `rgba(255,255,255,${a})`);
              ctx.strokeStyle = g; ctx.lineWidth = sw * (0.16 + 0.12 * depth); ctx.lineCap = "round";
              ctx.beginPath(); ctx.moveTo(px - ux * L, py - uy * L); ctx.lineTo(px, py); ctx.stroke();
              if (z === 2) ctx.drawImage(spr, px - sw * 0.3, py - sw * 0.3, sw * 0.6, sw * 0.6); // ближние хлопья остаются видны
            } else ctx.drawImage(spr, px - sw / 2, py - sw / 2, sw, sw);
          }
        }
        ctx.globalAlpha = 1;
      } else if (ep.kind === "rain" || ep.kind === "storm") {
        const n = Math.round(rain.length * clamp(ep.intensity * (ep.kind === "storm" ? 1.1 : 0.75), 0, 1));
        const slant = 0.1 + 0.3 * wind;
        ctx.lineWidth = Math.max(1, 0.9 * dpr); ctx.lineCap = "round";
        for (let i = 0; i < n; i++) {
          const p = rain[i]!;
          const fall = (0.95 + 0.7 * p.z) * p.v * ep.speed;
          p.y += fall * dt; p.x += slant * fall * dt;
          if (p.y > 1.03) { p.y = -0.06; p.x = rng() * 1.3 - 0.2; }
          const L = (0.018 + 0.022 * p.z) * H, x1 = p.x * W, y1 = p.y * H;
          const g = ctx.createLinearGradient(x1 - slant * L, y1 - L, x1, y1);
          const a = (0.22 + 0.3 * p.z) * clamp(ep.intensity * 1.3, 0, 1);
          g.addColorStop(0, `rgba(${210 - 50 * night},${222 - 50 * night},${238 - 40 * night},0)`); g.addColorStop(1, `rgba(${210 - 50 * night},${222 - 50 * night},${238 - 40 * night},${a})`);
          ctx.strokeStyle = g; ctx.beginPath(); ctx.moveTo(x1 - slant * L, y1 - L); ctx.lineTo(x1, y1); ctx.stroke();
        }
      } else if (ep.kind === "leaves") {
        const n = Math.round(leaves.length * clamp(0.3 + 0.7 * ep.gust, 0, 1));
        for (let i = 0; i < n; i++) {
          const p = leaves[i]!;
          const g = 0.4 + ep.gust;
          p.y += (0.025 + 0.045 * p.z) * p.v * g * dt; p.x += (0.07 * g * p.z + 0.03 * p.sway * Math.sin(now / 700 + p.ph)) * dt;
          p.rot += (1.0 + 2 * p.sway) * g * dt;
          if (p.y > 1.04 || p.x > 1.05) { p.y = rng() < 0.5 ? -0.04 : rng(); p.x = p.y < 0 ? rng() : -0.05; }
          const s = (1.8 + 2.2 * p.z) * dpr * zoomS; // маленькие листочки (решение владельца 05.10)
          const col = p.hue < 0.4 ? "#D9A62E" : p.hue < 0.75 ? "#C8661F" : "#9E3B23";
          ctx.save(); ctx.translate(p.x * W, p.y * H); ctx.rotate(p.rot); ctx.globalAlpha = (0.7 + 0.3 * p.z) * (1 - 0.35 * night);
          ctx.fillStyle = col; ctx.beginPath();
          if (p.shape === 0) ctx.ellipse(0, 0, s, s * 0.5, 0, 0, 6.283);
          else { ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.95, -s * 0.15, 0, s); ctx.quadraticCurveTo(-s * 0.95, -s * 0.15, 0, -s); }
          ctx.fill();
          ctx.strokeStyle = "rgba(90,50,20,0.5)"; ctx.lineWidth = Math.max(0.6, s * 0.08); ctx.beginPath(); ctx.moveTo(0, -s * 0.9); ctx.lineTo(0, s * 0.9); ctx.stroke();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [season, seed, size]);

  return <canvas ref={ref} className="fx-layer weather" aria-hidden />;
}
