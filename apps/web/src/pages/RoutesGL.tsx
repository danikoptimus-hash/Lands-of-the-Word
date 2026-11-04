import { useEffect, useRef, useState } from "react";
import type { Viewport } from "./MapLayers";
import type { RouteSpec } from "./Fauna";
import { perfMark } from "../lib/perfHud";

/**
 * Морские пути на WebGL (этап Э3 плана docs/proposals/map-gpu.md). Раньше слой живности собирал каждый путь из ~100
 * точек заново в каждом кадре и обводил дважды (ореол и линия) — стоимость кадра росла с числом путей. Здесь геометрия
 * загружается в видеокарту один раз при смене путей, а в кадре меняются только масштаб и сдвиг; толщина считается в
 * шейдере в экранных пикселях — точно по прежним правилам и, как раньше, в каждом кадре:
 *   ореол rgba(255,250,240,0.85) шириной 10·k/max(1.6,k) px, линия цвета команды 6 (выбранная 8)·k/max(1.6,k) px,
 *   круглые концы и стыки; стрелка (−10,−7)(4,0)(−10,7) в экранных единицах ui = clamp(k/1.6, 0.5, 1), повёрнутая
 *   по курсу, залита цветом команды и обведена rgba(255,250,240,0.95) шириной 1.5·ui px.
 * Полупрозрачный ореол нельзя рисовать отрезками с наложением (стыки темнели бы): каждый цвет кладётся в два прохода
 * через трафарет — сердцевина (непрозрачные пиксели) и край (сглаживание по расстоянию до отрезка), и каждый пиксель
 * красится одним цветом один раз. Пути за экраном не рисуются. Без WebGL или при потере контекста — `onUnsupported`,
 * и пути снова рисует слой живности как раньше.
 */
const VERT = `
attribute vec2 aA; attribute vec2 aB; attribute vec2 aC; attribute vec2 aP; attribute vec2 aN;
uniform float uK; uniform vec2 uT; uniform vec2 uRes; uniform float uHalf;
varying vec2 vP; varying vec2 vA; varying vec2 vB; varying vec2 vPrev; varying vec2 vNext;
void main(){
  vec2 A = aA * uK + uT, B = aB * uK + uT;
  vec2 d = B - A; float l = length(d); d = l > 0.0 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x); float e = uHalf + 1.0;
  vec2 P = mix(A, B, aC.x) + d * (aC.x * 2.0 - 1.0) * e + n * aC.y * e;
  vA = A; vB = B; vP = P; vPrev = aP * uK + uT; vNext = aN * uK + uT;
  gl_Position = vec4((P / uRes * 2.0 - 1.0) * vec2(1.0, -1.0), 0.0, 1.0);
}`;
// Расстояние до своего отрезка и двух соседних: у стыка оба отрезка считают одно и то же покрытие, иначе первый из них
// забирал бы пиксели стыка с малой прозрачностью, и линия шла бы «бусами» с зазубринами.
const FRAG = `
precision highp float;
uniform vec4 uColor; uniform float uHalf; uniform float uPass;
varying vec2 vP; varying vec2 vA; varying vec2 vB; varying vec2 vPrev; varying vec2 vNext;
float seg(vec2 p, vec2 a, vec2 b){ vec2 d = b - a; float l2 = dot(d, d); float t = l2 > 0.0 ? clamp(dot(p - a, d) / l2, 0.0, 1.0) : 0.0; return length(p - (a + d * t)); }
void main(){
  float dist = min(seg(vP, vA, vB), min(seg(vP, vPrev, vA), seg(vP, vB, vNext)));
  float a = clamp(uHalf + 0.5 - dist, 0.0, 1.0);
  if (uPass < 0.5) { if (a < 1.0) discard; } else { if (a >= 1.0 || a <= 0.0) discard; }
  gl_FragColor = vec4(uColor.rgb * uColor.a * a, uColor.a * a);
}`;
const FILL_VERT = `attribute vec2 aP; uniform vec2 uRes; void main(){ gl_Position = vec4((aP / uRes * 2.0 - 1.0) * vec2(1.0, -1.0), 0.0, 1.0); }`;
const FILL_FRAG = `precision mediump float; uniform vec4 uColor; void main(){ gl_FragColor = vec4(uColor.rgb * uColor.a, uColor.a); }`;

type RGBA = [number, number, number, number];
const HALO: RGBA = [1, 250 / 255, 240 / 255, 0.85], ARROW_EDGE: RGBA = [1, 250 / 255, 240 / 255, 0.95];
const colorCache = new Map<string, RGBA>();
/** Цвет CSS → [r, g, b, a] в 0..1: hex и rgb/rgba разбираются сами, остальное — через 2D-холст. */
export function parseColor(css: string): RGBA {
  const hit = colorCache.get(css); if (hit) return hit;
  let out: RGBA = [0, 0, 0, 1];
  const hex = /^#([0-9a-f]{3,8})$/i.exec(css.trim());
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(css.trim());
  if (hex) {
    const h = hex[1]!; const n = h.length <= 4 ? h.split("").map((c) => c + c).join("") : h;
    out = [parseInt(n.slice(0, 2), 16) / 255, parseInt(n.slice(2, 4), 16) / 255, parseInt(n.slice(4, 6), 16) / 255, n.length >= 8 ? parseInt(n.slice(6, 8), 16) / 255 : 1];
  } else if (rgb) {
    out = [+rgb[1]! / 255, +rgb[2]! / 255, +rgb[3]! / 255, rgb[4] === undefined ? 1 : +rgb[4]];
  } else if (typeof document !== "undefined") {
    const c = document.createElement("canvas"); c.width = c.height = 1;
    const g = c.getContext("2d");
    if (g) { g.fillStyle = css; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; out = [d[0]! / 255, d[1]! / 255, d[2]! / 255, d[3]! / 255]; }
  }
  colorCache.set(css, out);
  return out;
}

/** Сетка отрезков ломаной: на отрезок четыре вершины (концы A и B, угол, соседние точки до A и после B) и шесть индексов. */
export const VERT_FLOATS = 10;
export function lineMesh(pts: ReadonlyArray<{ x: number; y: number }>, closed = false): { verts: Float32Array; idx: Uint16Array; segs: number } {
  const n = pts.length, segs = Math.max(0, closed ? n : n - 1);
  const verts = new Float32Array(segs * 4 * VERT_FLOATS), idx = new Uint16Array(segs * 6);
  const at = (i: number) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))]!;
  for (let s = 0; s < segs; s++) {
    const a = at(s), b = at(s + 1), p = at(s - 1), q = at(s + 2);
    const corners = [[0, -1], [0, 1], [1, 1], [1, -1]] as const;
    for (let c = 0; c < 4; c++) { const o = (s * 4 + c) * VERT_FLOATS; verts.set([a.x, a.y, b.x, b.y, corners[c]![0], corners[c]![1], p.x, p.y, q.x, q.y], o); }
    const v = s * 4, i = s * 6; idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2; idx[i + 3] = v; idx[i + 4] = v + 2; idx[i + 5] = v + 3;
  }
  return { verts, idx, segs };
}

interface Built { vbo: WebGLBuffer; ibo: WebGLBuffer; count: number; color: RGBA; selected: boolean; arrow: RouteSpec["arrow"]; box: { x0: number; y0: number; x1: number; y1: number } }

export function RoutesGL({ vp, routes, onUnsupported }: { vp: Viewport; routes: ReadonlyArray<RouteSpec>; /** WebGL недоступен или контекст потерян: пути рисует слой живности. */ onUnsupported: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const routesRef = useRef(routes); routesRef.current = routes;
  const vpRef = useRef(vp); vpRef.current = vp;
  const rebuild = useRef<() => void>(() => {});
  useEffect(() => { rebuild.current(); }, [routes]);
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: true, preserveDrawingBuffer: false, powerPreference: "low-power" });
    const fail = () => { setFailed(true); onUnsupported(); };
    if (!gl || gl.getContextAttributes()?.stencil !== true) { fail(); return; }
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader"); return s; };
    const prog = (v: string, f: string) => { const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link"); return p; };
    let line: WebGLProgram, fill: WebGLProgram;
    try { line = prog(VERT, FRAG); fill = prog(FILL_VERT, FILL_FRAG); } catch { fail(); return; }
    const L = { aA: gl.getAttribLocation(line, "aA"), aB: gl.getAttribLocation(line, "aB"), aC: gl.getAttribLocation(line, "aC"), aP: gl.getAttribLocation(line, "aP"), aN: gl.getAttribLocation(line, "aN"), uK: gl.getUniformLocation(line, "uK"), uT: gl.getUniformLocation(line, "uT"), uRes: gl.getUniformLocation(line, "uRes"), uHalf: gl.getUniformLocation(line, "uHalf"), uColor: gl.getUniformLocation(line, "uColor"), uPass: gl.getUniformLocation(line, "uPass") };
    const F = { aP: gl.getAttribLocation(fill, "aP"), uRes: gl.getUniformLocation(fill, "uRes"), uColor: gl.getUniformLocation(fill, "uColor") };
    const arrowVbo = gl.createBuffer()!, arrowIbo = gl.createBuffer()!, triVbo = gl.createBuffer()!;
    const arrowMesh = lineMesh([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], true);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, arrowIbo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arrowMesh.idx, gl.STATIC_DRAW);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.STENCIL_TEST);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, dirty = true;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } gl.viewport(0, 0, W, H); dirty = true; };
    let built: Built[] = [];
    const drop = () => { for (const b of built) { gl.deleteBuffer(b.vbo); gl.deleteBuffer(b.ibo); } built = []; };
    rebuild.current = () => {
      drop();
      for (const r of routesRef.current) {
        if (r.pts.length < 2) continue;
        const m = lineMesh(r.pts);
        const vbo = gl.createBuffer()!, ibo = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, m.verts, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of r.pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
        built.push({ vbo, ibo, count: m.idx.length, color: parseColor(r.color), selected: !!r.selected, arrow: r.arrow, box: { x0, y0, x1, y1 } });
      }
      dirty = true;
    };
    rebuild.current();
    /** Отрезки буфера: два прохода (сердцевина с записью трафарета, край — только где трафарет ещё не этот). */
    const strokes = (vbo: WebGLBuffer, ibo: WebGLBuffer, count: number, color: RGBA, halfPx: number, k: number, tx: number, ty: number, ref: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      // Номера атрибутов у программ общие (aP заливки = aA линии): включаем свои перед каждым рисованием.
      for (const a of [L.aA, L.aB, L.aC, L.aP, L.aN]) gl.enableVertexAttribArray(a);
      const st = VERT_FLOATS * 4;
      gl.vertexAttribPointer(L.aA, 2, gl.FLOAT, false, st, 0); gl.vertexAttribPointer(L.aB, 2, gl.FLOAT, false, st, 8); gl.vertexAttribPointer(L.aC, 2, gl.FLOAT, false, st, 16); gl.vertexAttribPointer(L.aP, 2, gl.FLOAT, false, st, 24); gl.vertexAttribPointer(L.aN, 2, gl.FLOAT, false, st, 32);
      gl.uniform1f(L.uK, k); gl.uniform2f(L.uT, tx, ty); gl.uniform1f(L.uHalf, halfPx); gl.uniform4f(L.uColor, color[0], color[1], color[2], color[3]);
      gl.stencilFunc(gl.NOTEQUAL, ref, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.uniform1f(L.uPass, 0); gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
      gl.uniform1f(L.uPass, 1); gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    };
    const draw = () => {
      const t0 = performance.now();
      const { k, tx, ty } = vpRef.current.viewRef.current;
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      if (!built.length) return;
      const m = Math.max(1.6, k), ui = Math.min(1, Math.max(0.5, k / 1.6));
      const sw = W / dpr, shh = H / dpr; // экран в CSS-пикселях
      // Видимая область в единицах карты с запасом на толщину и стрелку.
      const pad = 24 / k, vx0 = -tx / k - pad, vy0 = -ty / k - pad, vx1 = (sw - tx) / k + pad, vy1 = (shh - ty) / k + pad;
      gl.useProgram(line); gl.uniform2f(L.uRes, sw, shh);
      let ref = 0;
      const tri = new Float32Array(6);
      const arrowPts = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
      for (const b of built) {
        if (b.box.x1 < vx0 || b.box.x0 > vx1 || b.box.y1 < vy0 || b.box.y0 > vy1) continue;
        ref = (ref % 84) + 1;
        strokes(b.vbo, b.ibo, b.count, HALO, 5 * k / m, k, tx, ty, ref * 3 - 2);
        strokes(b.vbo, b.ibo, b.count, b.color, (b.selected ? 4 : 3) * k / m, k, tx, ty, ref * 3 - 1);
        // Стрелка: в экранных пикселях (масштаб ui), повёрнута по курсу; залита, затем обведена.
        const ax = b.arrow.x * k + tx, ay = b.arrow.y * k + ty, h = (b.arrow.heading * Math.PI) / 180, c = Math.cos(h), s = Math.sin(h);
        const local = [[-10, -7], [4, 0], [-10, 7]] as const;
        for (let i = 0; i < 3; i++) { const [lx, ly] = local[i]!; const x = ax + (lx * c - ly * s) * ui, y = ay + (lx * s + ly * c) * ui; tri[i * 2] = x; tri[i * 2 + 1] = y; arrowPts[i]!.x = x; arrowPts[i]!.y = y; }
        gl.useProgram(fill); gl.uniform2f(F.uRes, sw, shh); gl.uniform4f(F.uColor, b.color[0], b.color[1], b.color[2], b.color[3]);
        gl.disable(gl.STENCIL_TEST);
        gl.bindBuffer(gl.ARRAY_BUFFER, triVbo); gl.bufferData(gl.ARRAY_BUFFER, tri, gl.DYNAMIC_DRAW);
        for (const a of [L.aB, L.aC, L.aP, L.aN]) gl.disableVertexAttribArray(a); gl.enableVertexAttribArray(F.aP); gl.vertexAttribPointer(F.aP, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.STENCIL_TEST);
        gl.useProgram(line);
        const am = lineMesh(arrowPts, true);
        gl.bindBuffer(gl.ARRAY_BUFFER, arrowVbo); gl.bufferData(gl.ARRAY_BUFFER, am.verts, gl.DYNAMIC_DRAW);
        strokes(arrowVbo, arrowIbo, am.idx.length, ARROW_EDGE, 0.75 * ui, 1, 0, 0, ref * 3);
      }
      for (const a of [L.aA, L.aB, L.aC, L.aP, L.aN]) gl.disableVertexAttribArray(a);
      perfMark("пути (gl)", performance.now() - t0);
    };
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); if (!dirty || document.hidden) return; dirty = false; draw(); };
    const unsub = vpRef.current.subscribe(() => { dirty = true; });
    const ro = new ResizeObserver(resize); ro.observe(host);
    const onLost = (e: Event) => { e.preventDefault(); fail(); };
    canvas.addEventListener("webglcontextlost", onLost);
    resize(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); unsub(); ro.disconnect(); canvas.removeEventListener("webglcontextlost", onLost); drop(); gl.getExtension("WEBGL_lose_context")?.loseContext(); };
  }, [vp.subscribe, vp.viewRef]); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return null;
  return <canvas ref={ref} className="fx-layer routes" aria-hidden="true" />;
}
