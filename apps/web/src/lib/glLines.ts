/**
 * Линии на WebGL для слоёв карты (этапы Э2–Э3 плана docs/proposals/map-gpu.md): отрезки ломаных как четырёхугольники,
 * толщина в экранных пикселях задаётся на кадр, круглые концы и стыки, сглаживание по расстоянию до отрезка (и до двух
 * соседних — чтобы стыки не рвались), пунктир с круглыми концами штрихов (как `stroke-dasharray` + `linecap: round`).
 *
 * Полупрозрачная ломаная из многих отрезков: без трафарета стыки красились бы дважды и темнели. Поэтому при `stencil`
 * линия кладётся в два прохода — сердцевина (непрозрачные пиксели) и край, и каждый пиксель красится один раз.
 * Отдельные элементы SVG (стороны, контуры гексов) рисуются без трафарета — их наложения друг на друга в SVG тоже
 * складываются, и это сохраняется.
 */
export type RGBA = [number, number, number, number];
export interface Pt { x: number; y: number }

const VERT = `
attribute vec2 aA; attribute vec2 aB; attribute vec2 aC; attribute vec2 aP; attribute vec2 aN; attribute vec2 aD;
uniform float uK; uniform vec2 uT; uniform vec2 uRes; uniform float uHalf;
varying vec2 vP; varying vec2 vA; varying vec2 vB; varying vec2 vPrev; varying vec2 vNext; varying vec2 vD;
void main(){
  vec2 A = aA * uK + uT, B = aB * uK + uT;
  vec2 d = B - A; float l = length(d); d = l > 0.0 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x); float e = uHalf + 1.0;
  vec2 P = mix(A, B, aC.x) + d * (aC.x * 2.0 - 1.0) * e + n * aC.y * e;
  vA = A; vB = B; vP = P; vPrev = aP * uK + uT; vNext = aN * uK + uT; vD = aD * uK;
  gl_Position = vec4((P / uRes * 2.0 - 1.0) * vec2(1.0, -1.0), 0.0, 1.0);
}`;
const FRAG = `
precision highp float;
uniform vec4 uColor; uniform float uHalf; uniform float uPass; uniform vec2 uDash;
varying vec2 vP; varying vec2 vA; varying vec2 vB; varying vec2 vPrev; varying vec2 vNext; varying vec2 vD;
float seg(vec2 p, vec2 a, vec2 b){ vec2 d = b - a; float l2 = dot(d, d); float t = l2 > 0.0 ? clamp(dot(p - a, d) / l2, 0.0, 1.0) : 0.0; return length(p - (a + d * t)); }
void main(){
  float dist;
  if (uDash.x > 0.0) {
    // Пунктир: положение вдоль линии в пикселях экрана, штрих со скруглёнными концами — расстояние до отрезка штриха.
    vec2 d = vB - vA; float l2 = dot(d, d); float t = l2 > 0.0 ? clamp(dot(vP - vA, d) / l2, 0.0, 1.0) : 0.0;
    float along = mix(vD.x, vD.y, t), period = uDash.x + uDash.y;
    float s = floor(along / period) * period, e = s + uDash.x;
    float dx = max(max(s - along, along - e), 0.0), pd = length(vP - (vA + d * t));
    dist = sqrt(dx * dx + pd * pd);
  } else {
    dist = min(seg(vP, vA, vB), min(seg(vP, vPrev, vA), seg(vP, vB, vNext)));
  }
  float a = clamp(uHalf + 0.5 - dist, 0.0, 1.0);
  if (uPass > 0.5) { if (a < 1.0) discard; } else if (uPass > -0.5) { if (a >= 1.0 || a <= 0.0) discard; } else { if (a <= 0.0) discard; }
  gl_FragColor = vec4(uColor.rgb * uColor.a * a, uColor.a * a);
}`;

export const VERT_FLOATS = 12;
export interface Mesh { verts: Float32Array; idx: Uint16Array | Uint32Array; segs: number; box: { x0: number; y0: number; x1: number; y1: number } }
/**
 * Сетка одной или многих ломаных: на отрезок четыре вершины (A, B, угол, точка до A, точка после B, длина вдоль ломаной
 * у A и у B в единицах карты) и шесть индексов. `closed` — последняя точка соединяется с первой (стрелка, контур гекса).
 */
export function lineMesh(lines: ReadonlyArray<ReadonlyArray<Pt>>, closed = false): Mesh {
  let segs = 0;
  for (const pts of lines) segs += Math.max(0, closed ? pts.length : pts.length - 1);
  const verts = new Float32Array(segs * 4 * VERT_FLOATS);
  const idx = segs * 4 > 65535 ? new Uint32Array(segs * 6) : new Uint16Array(segs * 6);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, s = 0;
  const corners = [[0, -1], [0, 1], [1, 1], [1, -1]] as const;
  for (const pts of lines) {
    const n = pts.length, m = Math.max(0, closed ? n : n - 1);
    const at = (i: number) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))]!;
    let along = 0;
    for (let i = 0; i < m; i++, s++) {
      const a = at(i), b = at(i + 1), p = at(i - 1), q = at(i + 2);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      x0 = Math.min(x0, a.x, b.x); y0 = Math.min(y0, a.y, b.y); x1 = Math.max(x1, a.x, b.x); y1 = Math.max(y1, a.y, b.y);
      for (let c = 0; c < 4; c++) verts.set([a.x, a.y, b.x, b.y, corners[c]![0], corners[c]![1], p.x, p.y, q.x, q.y, along, along + len], (s * 4 + c) * VERT_FLOATS);
      const v = s * 4, j = s * 6; idx[j] = v; idx[j + 1] = v + 1; idx[j + 2] = v + 2; idx[j + 3] = v; idx[j + 4] = v + 2; idx[j + 5] = v + 3;
      along += len;
    }
  }
  if (!segs) x0 = y0 = x1 = y1 = 0;
  return { verts, idx, segs, box: { x0, y0, x1, y1 } };
}

export interface LineBuffer { vbo: WebGLBuffer; ibo: WebGLBuffer; count: number; wide: boolean; box: Mesh["box"] }
export interface LineDraw { k: number; tx: number; ty: number; halfPx: number; color: RGBA; /** Пунктир в пикселях экрана: [штрих, промежуток]. */ dash?: [number, number]; /** Номер трафарета (1..255): элемент из многих отрезков красится один раз; без него — простой проход с наложением. */ stencil?: number }

export interface LineProgram {
  upload(mesh: Mesh, dynamic?: boolean): LineBuffer;
  update(buf: LineBuffer, mesh: Mesh): void;
  free(buf: LineBuffer): void;
  /** Нарисовать буфер; экран в CSS-пикселях задаётся заранее через setViewport. */
  draw(buf: LineBuffer, o: LineDraw): void;
  setViewport(wCss: number, hCss: number): void;
  dispose(): void;
}

export function compileProgram(gl: WebGLRenderingContext, vert: string, frag: string): WebGLProgram {
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader"); return s; };
  const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, vert)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

/** Программа линий. Контекст должен быть создан с `stencil: true` и блендингом ONE / ONE_MINUS_SRC_ALPHA (премультиплицированные цвета). */
export function createLineProgram(gl: WebGLRenderingContext): LineProgram {
  const prog = compileProgram(gl, VERT, FRAG);
  const u32 = gl.getExtension("OES_element_index_uint");
  const A = ["aA", "aB", "aC", "aP", "aN", "aD"].map((n) => gl.getAttribLocation(prog, n));
  const U = { uK: gl.getUniformLocation(prog, "uK"), uT: gl.getUniformLocation(prog, "uT"), uRes: gl.getUniformLocation(prog, "uRes"), uHalf: gl.getUniformLocation(prog, "uHalf"), uColor: gl.getUniformLocation(prog, "uColor"), uPass: gl.getUniformLocation(prog, "uPass"), uDash: gl.getUniformLocation(prog, "uDash") };
  let res: [number, number] = [1, 1];
  const bind = (buf: LineBuffer) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.ibo);
    const st = VERT_FLOATS * 4;
    A.forEach((loc, i) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, st, i * 8); });
  };
  return {
    upload(mesh, dynamic = false) {
      const vbo = gl.createBuffer()!, ibo = gl.createBuffer()!;
      const wide = mesh.idx instanceof Uint32Array;
      if (wide && !u32) throw new Error("OES_element_index_uint");
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      return { vbo, ibo, count: mesh.idx.length, wide, box: mesh.box };
    },
    update(buf, mesh) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.vbo); gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.DYNAMIC_DRAW);
      buf.count = mesh.idx.length; buf.wide = mesh.idx instanceof Uint32Array; buf.box = mesh.box;
    },
    free(buf) { gl.deleteBuffer(buf.vbo); gl.deleteBuffer(buf.ibo); },
    setViewport(w, h) { res = [w, h]; },
    draw(buf, o) {
      if (!buf.count || o.halfPx <= 0 || o.color[3] <= 0) return;
      gl.useProgram(prog); bind(buf);
      gl.uniform2f(U.uRes, res[0], res[1]); gl.uniform1f(U.uK, o.k); gl.uniform2f(U.uT, o.tx, o.ty); gl.uniform1f(U.uHalf, o.halfPx);
      gl.uniform4f(U.uColor, o.color[0], o.color[1], o.color[2], o.color[3]); gl.uniform2f(U.uDash, o.dash?.[0] ?? 0, o.dash?.[1] ?? 0);
      const type = buf.wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      if (o.stencil) {
        gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.NOTEQUAL, o.stencil, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        gl.uniform1f(U.uPass, 1); gl.drawElements(gl.TRIANGLES, buf.count, type, 0);
        gl.uniform1f(U.uPass, 0); gl.drawElements(gl.TRIANGLES, buf.count, type, 0);
        gl.disable(gl.STENCIL_TEST);
      } else {
        gl.uniform1f(U.uPass, -1); gl.drawElements(gl.TRIANGLES, buf.count, type, 0);
      }
      for (const loc of A) gl.disableVertexAttribArray(loc);
    },
    dispose() { gl.deleteProgram(prog); },
  };
}

const colorCache = new Map<string, RGBA>();
/** Цвет CSS → [r, g, b, a] в 0..1: hex и rgb/rgba разбираются сами, остальное (имена, color-mix) — через 2D-холст. */
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
    const g = c.getContext("2d", { willReadFrequently: true });
    if (g) { g.clearRect(0, 0, 1, 1); g.fillStyle = css; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; const a = d[3]! / 255; out = a > 0 ? [d[0]! / 255 / 1, d[1]! / 255, d[2]! / 255, a] : [0, 0, 0, 0]; }
  }
  colorCache.set(css, out);
  return out;
}
