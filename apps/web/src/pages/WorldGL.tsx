import { useEffect, useRef, useState } from "react";
import type { Viewport } from "./MapLayers";
import { perfMark } from "../lib/perfHud";
import { compileProgram, createLineProgram, lineMesh, type LineBuffer, type LineProgram, type Pt, type RGBA } from "../lib/glLines";

/**
 * Мир карты на WebGL (этап Э2 плана docs/proposals/map-gpu.md) — замена мирового SVG (туман-гексы, контуры гексов, берег,
 * стороны всех видов, картинки стартов и городов с обводкой, шатры). По замеру на компьютере владельца (раздел 4.5 плана)
 * рывки — это растр SVG в 3,2 экрана при каждой фиксации и ступеньке толщин; здесь геометрия загружается в видеокарту при
 * смене данных, а в кадре меняются только масштаб и сдвиг.
 *
 * Вид — ровно как у SVG (раздел 3.3 плана): толщины считаются по тем же формулам от `k_стилей`, который меняется так же
 * ступеньками — не чаще VAR_MS по ходу жеста и при фиксации (как `--k` в WorldSvg); пунктир — те же 7·ui / 6·ui с
 * круглыми концами; обводка города — как `feMorphology dilate` (квадратное ядро): расстояние Чебышёва до картинки
 * считается один раз при загрузке и хранится второй текстурой, радиус — min(0.88, 1/k₀) у незанятого и min(1.6, 2/k₀)
 * у взятого (k₀ — масштаб фиксации, как у OutlineDefs). Отдельные элементы SVG (стороны, контуры гексов) рисуются без
 * трафарета, и их наложения складываются, как в SVG; ломаные из многих отрезков (берег) — через трафарет, один раз.
 * Без WebGL или при потере контекста — `onUnsupported`, и карта возвращается к SVG.
 */
export interface WorldEdge { a: Pt; b: Pt; /** Линия только до этой точки (сторона, пройденная двумя командами у администратора: вторая половина — в extra). */ halfLine?: Pt; /** Светлая подложка (10·k/max(1.6,ks) у команды, 9 у администратора). */ halo?: { color: RGBA; px: number }; line?: { color: RGBA; px: number; /** "max16": X·k/max(1.6,ks); "k": X·k/ks. */ scale: "max16" | "k"; dash?: boolean; cap?: "round" | "butt" }; /** Чужие отрезки поверх линии. */ extra?: Array<{ a: Pt; b: Pt; color: RGBA; px: number }> }
export interface WorldImage { src: string; x: number; y: number; w: number; h: number; /** Обводка: цвет и «взятый» (толще). */ ring?: { color: RGBA; owned: boolean } }
export interface WorldScene {
  size: number;
  /** Гексы в порядке SVG: туман (многоугольник 1.03 без контура) или контур (0.995). Порядок важен: туман, нарисованный
   *  позже соседа, накрывает его контур по общему ребру — как в SVG. */
  hexes: Array<{ x: number; y: number; fog: boolean }>;
  fogColor: RGBA; gridColor: RGBA;
  /** Берег: ломаные в единицах карты (кривые уже разбиты на отрезки), цвета песка и мокрой кромки. */
  coast: Pt[][]; sand: RGBA; wet: RGBA;
  edges: WorldEdge[];
  images: WorldImage[];
}
export const VAR_MS = 120;
/** Отладка точности (только с ?perf=1): `&gloff=fog,grid,coast,edges,images` — не рисовать часть сцены. */
const OFF = new Set(typeof location !== "undefined" && /[?&]perf=1/.test(location.search) ? (/[?&]gloff=([^&]+)/.exec(location.search)?.[1] ?? "").split(",") : []);
const PAD = 24, MAX_D = 24;

const FILL_VERT = `attribute vec2 aP; uniform float uK; uniform vec2 uT; uniform vec2 uRes; void main(){ vec2 P = aP * uK + uT; gl_Position = vec4((P / uRes * 2.0 - 1.0) * vec2(1.0, -1.0), 0.0, 1.0); }`;
const FILL_FRAG = `precision mediump float; uniform vec4 uColor; void main(){ gl_FragColor = vec4(uColor.rgb * uColor.a, uColor.a); }`;
const IMG_VERT = `attribute vec2 aP; attribute vec2 aUV; uniform float uK; uniform vec2 uT; uniform vec2 uRes; varying vec2 vUV; void main(){ vec2 P = aP * uK + uT; vUV = aUV; gl_Position = vec4((P / uRes * 2.0 - 1.0) * vec2(1.0, -1.0), 0.0, 1.0); }`;
const IMG_FRAG = `
precision mediump float;
uniform sampler2D uImg; uniform sampler2D uDist; uniform float uR; uniform float uRing; uniform vec4 uRingColor;
varying vec2 vUV;
void main(){
  vec4 c = texture2D(uImg, vUV);
  float d = texture2D(uDist, vUV).r * 255.0;
  float ring = uRing * clamp(uR + 0.5 - d, 0.0, 1.0);
  vec4 rc = vec4(uRingColor.rgb * uRingColor.a, uRingColor.a) * ring;
  gl_FragColor = c + rc * (1.0 - c.a);
}`;

interface Tex { img: WebGLTexture; dist: WebGLTexture; sx: number; sy: number; P: number; ready: boolean }
/** Текстуры картинки и расстояния Чебышёва до неё (для обводки): квадрат со стороной-степенью двойки, с полями PAD. */
function loadTex(gl: WebGLRenderingContext, src: string, onReady: () => void): Tex {
  const img = gl.createTexture()!, dist = gl.createTexture()!;
  const t: Tex = { img, dist, sx: 1, sy: 1, P: 2, ready: false };
  const el = new Image(); el.decoding = "async"; el.src = src;
  el.onload = () => {
    const w = el.naturalWidth, h = el.naturalHeight;
    let P = 2; while (P < Math.max(w, h) + 2 * PAD) P *= 2;
    const c = document.createElement("canvas"); c.width = c.height = P;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(el, PAD, PAD, w, h);
    const data = g.getImageData(0, 0, P, P).data;
    // Расстояние Чебышёва до ближайшего непрозрачного пикселя: шаги расширения квадратным ядром 3×3, не дальше MAX_D.
    let cur = new Uint8Array(P * P), next = new Uint8Array(P * P); const out = new Uint8Array(P * P).fill(255);
    for (let i = 0; i < P * P; i++) if (data[i * 4 + 3]! >= 128) { cur[i] = 1; out[i] = 0; }
    for (let step = 1; step <= MAX_D; step++) {
      let any = false;
      for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
        const i = y * P + x; if (cur[i]) { next[i] = 1; continue; }
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) { const yy = y + dy; if (yy < 0 || yy >= P) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= P) continue; if (cur[yy * P + xx]) { on = 1; break; } } }
        next[i] = on; if (on) { out[i] = step; any = true; }
      }
      [cur, next] = [next, cur]; if (!any) break;
    }
    gl.bindTexture(gl.TEXTURE_2D, img);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, dist);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, P, P, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, out);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    t.sx = w; t.sy = h; t.P = P; t.ready = true;
    onReady();
  };
  return t;
}

const hexPoly = (c: Pt, size: number, scale: number): Pt[] => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 180) * (60 * i - 30); return { x: c.x + Math.cos(a) * size * scale, y: c.y + Math.sin(a) * size * scale }; });
/** Веер треугольников многоугольника в плоский массив координат. */
function fanTriangles(polys: Pt[][]): Float32Array {
  let n = 0; for (const p of polys) n += Math.max(0, p.length - 2) * 6;
  const out = new Float32Array(n); let o = 0;
  for (const p of polys) for (let i = 1; i + 1 < p.length; i++) { out.set([p[0]!.x, p[0]!.y, p[i]!.x, p[i]!.y, p[i + 1]!.x, p[i + 1]!.y], o); o += 6; }
  return out;
}
const sig = (e: WorldEdge) => (e.halo || e.extra?.length ? "" : `${e.line?.color.join(",")}|${e.line?.px}|${e.line?.scale}|${e.line?.dash ? 1 : 0}|${e.line?.cap ?? "round"}`);

interface Run { buf: LineBuffer; line: NonNullable<WorldEdge["line"]> }
interface Single { buf: LineBuffer; lineBuf: LineBuffer | null; edge: WorldEdge; extras: LineBuffer[] }

export function WorldGL({ vp, scene, onUnsupported }: { vp: Viewport; scene: WorldScene; onUnsupported: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const sceneRef = useRef(scene); sceneRef.current = scene;
  const vpRef = useRef(vp); vpRef.current = vp;
  const rebuild = useRef<() => void>(() => {});
  const commit = useRef<() => void>(() => {});
  useEffect(() => { rebuild.current(); }, [scene]);
  useEffect(() => { commit.current(); }, [vp.view]);
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: true, preserveDrawingBuffer: false });
    const fail = () => { setFailed(true); onUnsupported(); };
    if (!gl || gl.getContextAttributes()?.stencil !== true) { fail(); return; }
    let lines: LineProgram, fill: WebGLProgram, image: WebGLProgram;
    try { lines = createLineProgram(gl); fill = compileProgram(gl, FILL_VERT, FILL_FRAG); image = compileProgram(gl, IMG_VERT, IMG_FRAG); } catch { fail(); return; }
    const F = { aP: gl.getAttribLocation(fill, "aP"), uK: gl.getUniformLocation(fill, "uK"), uT: gl.getUniformLocation(fill, "uT"), uRes: gl.getUniformLocation(fill, "uRes"), uColor: gl.getUniformLocation(fill, "uColor") };
    const I = { aP: gl.getAttribLocation(image, "aP"), aUV: gl.getAttribLocation(image, "aUV"), uK: gl.getUniformLocation(image, "uK"), uT: gl.getUniformLocation(image, "uT"), uRes: gl.getUniformLocation(image, "uRes"), uImg: gl.getUniformLocation(image, "uImg"), uDist: gl.getUniformLocation(image, "uDist"), uR: gl.getUniformLocation(image, "uR"), uRing: gl.getUniformLocation(image, "uRing"), uRingColor: gl.getUniformLocation(image, "uRingColor") };
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let W = 0, H = 0, dirty = true;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } gl.viewport(0, 0, W, H); lines.setViewport(W / dpr, H / dpr); dirty = true; };
    // Ступенька толщин: k_стилей обновляется не чаще VAR_MS по ходу жеста и всегда при фиксации (как --k в WorldSvg).
    let kStyles = vpRef.current.viewRef.current.k, k0 = vpRef.current.view.k, lastVars = 0;
    commit.current = () => { kStyles = vpRef.current.viewRef.current.k; k0 = vpRef.current.view.k; lastVars = performance.now(); dirty = true; };
    const unsub = vpRef.current.subscribe((v) => { const now = performance.now(); if (now - lastVars >= VAR_MS) { lastVars = now; kStyles = v.k; } dirty = true; });

    const textures = new Map<string, Tex>();
    const tex = (src: string) => { let t = textures.get(src); if (!t) { t = loadTex(gl, src, () => { dirty = true; }); textures.set(src, t); } return t; };
    const quadVbo = gl.createBuffer()!;
    let coastBuf: LineBuffer | null = null;
    type HexRun = { fog: true; vbo: WebGLBuffer; count: number } | { fog: false; buf: LineBuffer };
    let hexRuns: HexRun[] = [];
    let items: Array<Run | Single> = [];
    const drop = () => {
      for (const it of items) { lines.free(it.buf); if ("extras" in it) { for (const b of it.extras) lines.free(b); if (it.lineBuf) lines.free(it.lineBuf); } } items = [];
      for (const r of hexRuns) { if (r.fog) gl.deleteBuffer(r.vbo); else lines.free(r.buf); } hexRuns = [];
      if (coastBuf) lines.free(coastBuf); coastBuf = null;
    };
    rebuild.current = () => {
      drop();
      const s = sceneRef.current;
      // Гексы — пачками подряд идущих одного вида, в порядке SVG.
      let i = 0;
      while (i < s.hexes.length) {
        const fog = s.hexes[i]!.fog; let j = i; while (j < s.hexes.length && s.hexes[j]!.fog === fog) j++;
        const polys = s.hexes.slice(i, j).map((c) => hexPoly(c, s.size, fog ? 1.03 : 0.995));
        if (fog) { const tris = fanTriangles(polys); const vbo = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, tris, gl.STATIC_DRAW); hexRuns.push({ fog: true, vbo, count: tris.length / 2 }); }
        else hexRuns.push({ fog: false, buf: lines.upload(lineMesh(polys, true)) });
        i = j;
      }
      if (s.coast.length) coastBuf = lines.upload(lineMesh(s.coast));
      // Стороны: подряд идущие одинаковые без подложки — одним буфером (их наложения складываются, как в SVG);
      // с подложкой или чужими отрезками — по одной, в порядке SVG (подложка следующей ложится на конец предыдущей).
      let run: { key: string; pts: Pt[][]; line: NonNullable<WorldEdge["line"]> } | null = null;
      const flush = () => { if (run && run.pts.length) items.push({ buf: lines.upload(lineMesh(run.pts)), line: run.line }); run = null; };
      for (const e of s.edges) {
        const key = sig(e);
        if (key && e.line) { if (!run || run.key !== key) { flush(); run = { key, pts: [], line: e.line }; } run.pts.push([e.a, e.b]); continue; }
        flush();
        items.push({ buf: lines.upload(lineMesh([[e.a, e.b]])), lineBuf: e.halfLine ? lines.upload(lineMesh([[e.a, e.halfLine]])) : null, edge: e, extras: (e.extra ?? []).map((x) => lines.upload(lineMesh([[x.a, x.b]]))) });
      }
      flush();
      for (const im of s.images) tex(im.src);
      dirty = true;
    };
    rebuild.current();

    const draw = () => {
      const t0 = performance.now();
      const s = sceneRef.current, { k, tx, ty } = vpRef.current.viewRef.current;
      const ks = kStyles, m16 = Math.max(1.6, ks), ui = Math.min(1, Math.max(0.5, ks / 1.6));
      const sw = W / dpr, sh = H / dpr;
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      const pad = 40 / k, vx0 = -tx / k - pad, vy0 = -ty / k - pad, vx1 = (sw - tx) / k + pad, vy1 = (sh - ty) / k + pad;
      const visible = (b: { x0: number; y0: number; x1: number; y1: number }) => !(b.x1 < vx0 || b.x0 > vx1 || b.y1 < vy0 || b.y0 > vy1);
      // 1. Туман и контуры гексов.
      for (const r of hexRuns) {
        if (r.fog) {
          if (OFF.has("fog")) continue;
          gl.useProgram(fill); gl.uniform2f(F.uRes, sw, sh); gl.uniform1f(F.uK, k); gl.uniform2f(F.uT, tx, ty); gl.uniform4f(F.uColor, s.fogColor[0], s.fogColor[1], s.fogColor[2], s.fogColor[3]);
          gl.bindBuffer(gl.ARRAY_BUFFER, r.vbo); gl.enableVertexAttribArray(F.aP); gl.vertexAttribPointer(F.aP, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, r.count); gl.disableVertexAttribArray(F.aP);
        } else if (!OFF.has("grid")) lines.draw(r.buf, { k, tx, ty, halfPx: 0.5 * k / ks, color: s.gridColor });
      }
      // 2. Берег: широкая песчаная кайма 13 слоями с угасающей прозрачностью и мокрая кромка (как CoastOver).
      if (coastBuf && !OFF.has("coast")) {
        const N = 12;
        lines.draw(coastBuf, { k, tx, ty, halfPx: s.size * 0.25 * k, color: s.sand, stencil: 1 });
        for (let i = 0; i < N; i++) { const t = (i + 1) / N; const a = 0.55 * (1 - t) * (1 - t) + 0.06; lines.draw(coastBuf, { k, tx, ty, halfPx: s.size * (0.5 + 0.65 * t) * 0.5 * k, color: [s.sand[0], s.sand[1], s.sand[2], s.sand[3] * a], stencil: 2 + i }); }
        lines.draw(coastBuf, { k, tx, ty, halfPx: 0.6 * k / ks, color: [s.wet[0], s.wet[1], s.wet[2], s.wet[3] * 0.35], stencil: 15 });
      }
      // 3. Стороны.
      const widthPx = (px: number, scale: "max16" | "k") => (scale === "max16" ? px * k / m16 : px * k / ks);
      const dash: [number, number] = [7 * ui * k / ks, 6 * ui * k / ks];
      for (const it of OFF.has("edges") ? [] : items) {
        if (!visible(it.buf.box)) continue;
        if ("line" in it) { lines.draw(it.buf, { k, tx, ty, halfPx: widthPx(it.line.px, it.line.scale) / 2, color: it.line.color, dash: it.line.dash ? dash : undefined }); continue; }
        const e = it.edge;
        if (e.halo) lines.draw(it.buf, { k, tx, ty, halfPx: widthPx(e.halo.px, "max16") / 2, color: e.halo.color });
        if (e.line) lines.draw(it.lineBuf ?? it.buf, { k, tx, ty, halfPx: widthPx(e.line.px, e.line.scale) / 2, color: e.line.color, dash: e.line.dash ? dash : undefined });
        e.extra?.forEach((x, i) => { const b = it.extras[i]; if (b) lines.draw(b, { k, tx, ty, halfPx: widthPx(x.px, "max16") / 2, color: x.color }); });
      }
      // 4. Картинки стартов и городов с обводкой.
      gl.useProgram(image); gl.uniform2f(I.uRes, sw, sh); gl.uniform1f(I.uK, k); gl.uniform2f(I.uT, tx, ty); gl.uniform1i(I.uImg, 0); gl.uniform1i(I.uDist, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
      gl.enableVertexAttribArray(I.aP); gl.enableVertexAttribArray(I.aUV);
      const quad = new Float32Array(24);
      for (const im of OFF.has("images") ? [] : s.images) {
        if (im.x + im.w < vx0 || im.x > vx1 || im.y + im.h < vy0 || im.y > vy1) continue;
        const t = tex(im.src); if (!t.ready) continue;
        // Квадрат текстуры (с полями) в единицах карты: картинка занимает [PAD, PAD+w] текселей.
        const ux = im.w / t.sx, uy = im.h / t.sy; // единиц карты на тексель
        const x0 = im.x - PAD * ux, y0 = im.y - PAD * uy, x1 = x0 + t.P * ux, y1 = y0 + t.P * uy;
        quad.set([x0, y0, 0, 0, x1, y0, 1, 0, x0, y1, 0, 1, x0, y1, 0, 1, x1, y0, 1, 0, x1, y1, 1, 1]);
        gl.bufferData(gl.ARRAY_BUFFER, quad, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(I.aP, 2, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(I.aUV, 2, gl.FLOAT, false, 16, 8);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.img); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, t.dist);
        if (im.ring) {
          const rMap = im.ring.owned ? Math.min(1.6, 2 / Math.max(k0, 0.01)) : Math.min(0.88, 1 / Math.max(k0, 0.01));
          gl.uniform1f(I.uRing, 1); gl.uniform1f(I.uR, rMap / ((ux + uy) / 2)); gl.uniform4f(I.uRingColor, im.ring.color[0], im.ring.color[1], im.ring.color[2], im.ring.color[3]);
        } else { gl.uniform1f(I.uRing, 0); gl.uniform1f(I.uR, 0); }
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.disableVertexAttribArray(I.aP); gl.disableVertexAttribArray(I.aUV);
      perfMark("мир (gl)", performance.now() - t0);
    };
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); if (!dirty || document.hidden) return; dirty = false; draw(); };
    const ro = new ResizeObserver(resize); ro.observe(host);
    const onLost = (e: Event) => { e.preventDefault(); fail(); };
    canvas.addEventListener("webglcontextlost", onLost);
    resize(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); unsub(); ro.disconnect(); canvas.removeEventListener("webglcontextlost", onLost); drop(); lines.dispose(); for (const t of textures.values()) { gl.deleteTexture(t.img); gl.deleteTexture(t.dist); } gl.getExtension("WEBGL_lose_context")?.loseContext(); };
  }, [vp.subscribe, vp.viewRef]); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return null;
  return <canvas ref={ref} className="fx-layer world-gl" aria-hidden="true" />;
}
