import { useEffect, useRef, useState } from "react";
import type { Viewport } from "./MapLayers";

/**
 * Море на WebGL: цвет каждого пикселя считается шейдером прямо в координатах карты, без плиток и узоров —
 * повторяться нечему ни на каком масштабе. Вода: две сети живой каустики (клеточный шум, точки ячеек медленно
 * чуть дрожат, а вся сеть плывёт по ветру), координаты искажены плавным шумом (линии изогнутые), блики гаснут
 * пятнами по маске, крупная зыбь темнит воду и идёт тем же ветром медленнее; при отдалении рябь тает. ~30 кадров в
 * секунду при видимой вкладке, разрешение не выше 1 пикселя на CSS-пиксель — воде хватает, телефону легче.
 */
const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uT; uniform float uK; uniform vec2 uTxy; uniform float uDpr;
vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i).x, b = hash2(i + vec2(1.0, 0.0)).x, c = hash2(i + vec2(0.0, 1.0)).x, d = hash2(i + vec2(1.0, 1.0)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; } return v; }
// Живая каустика: F2 − F1 клеточного шума, точки ячеек ходят по кругу со временем; мягкая линия по границам.
float caustic(vec2 p, float t, float w){ vec2 i = floor(p), f = fract(p); float f1 = 8.0, f2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)); vec2 o = hash2(i + g); o = 0.5 + 0.28 * sin(t + 6.2831 * o);
    float d = length(g + o - f); if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; } }
  float e = (f2 - f1) / w; return exp(-e * e); }
void main(){
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 wp = (fc - uTxy) / uK;                       // координаты карты
  // Ветер: рябь, блики и зыбь идут в одну сторону (мелкая рябь быстрее, зыбь медленнее — как на настоящей воде),
  // а точки ячеек лишь чуть дрожат на месте. Так движение согласованное, а не хаотичное.
  vec2 wind = vec2(0.86, 0.5);
  vec2 w1 = wp - wind * uT * 5.0, w2 = wp - wind * uT * 3.0;
  // Искажение координат двумя шумами: крупный неподвижен (форма сетки), мелкий плывёт по ветру (по воде бегут волны).
  vec2 warp = (vec2(fbm(wp * 0.008 + vec2(3.1, 7.7)), fbm(wp * 0.008 + vec2(9.2, 1.3))) - 0.5) * 2.4
            + (vec2(fbm(w2 * 0.03 + vec2(1.7, 4.4)), fbm(w2 * 0.03 + vec2(6.6, 2.9))) - 0.5) * 1.1;
  // Рябь мелкая в единицах карты (ячейка ≈ половина гекса); при отдалении она тает — с высоты воду видно гладкой.
  float lod = smoothstep(0.45, 1.5, uK);
  vec2 p1 = w1 / 9.0 + warp;
  vec2 p2 = mat2(0.8, -0.6, 0.6, 0.8) * w2 / 16.0 + warp * 0.7 + vec2(50.0);
  float c1 = caustic(p1, uT * 0.35, 0.20), c2 = caustic(p2, uT * 0.25 + 2.0, 0.22);
  // Две сети перемножаются: светятся пересечения и пятна, а не вся паутина (приём «правдоподобной каустики»).
  float cau = c1 * (0.25 + 0.75 * c2) + 0.35 * c2 * c1 * c1;
  float m1 = smoothstep(0.25, 0.8, fbm((wp - wind * uT * 2.0) * 0.006));
  float swell = fbm((wp - wind * uT * 1.5) * 0.0035);
  vec3 deep = vec3(0.15, 0.40, 0.55), mid = vec3(0.25, 0.54, 0.67);
  vec3 col = mix(deep, mid, swell);
  float light = lod * cau * (0.25 + 0.75 * m1) * 0.36;
  col += vec3(0.82, 0.94, 0.96) * light;
  // Ветровые волны: пологие гребни бегут по ветру двумя чуть разными фронтами, фаза сломана шумом, а видны
  // они лишь пятнами (маска) — никакой правильной полосатости, только живое дыхание воды. Гаснут при отдалении.
  float ph = fbm(wp * 0.03 + vec2(4.2, 8.8)) * 9.0;
  float rip = sin(dot(wp, wind) * 0.45 - uT * 2.2 + ph) + 0.7 * sin(dot(wp, vec2(0.62, 0.78)) * 0.31 - uT * 1.6 + ph * 0.6);
  float patch = smoothstep(0.35, 0.8, fbm(wp * 0.01 + vec2(2.0, 5.0) - wind * uT * 0.02));
  col += vec3(0.045, 0.06, 0.06) * rip * patch * (0.35 + 0.65 * lod) * smoothstep(0.2, 0.9, uK);
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type); if (!sh) return null;
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.warn("sea shader:", gl.getShaderInfoLog(sh)); return null; }
  return sh;
}

/** Возвращает false, если WebGL недоступен: тогда вызывающий рисует запасной вариант. */
export function SeaGL({ vp, onUnsupported }: { vp: Viewport; onUnsupported: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
    const fail = () => { setFailed(true); onUnsupported(); };
    if (!gl) { fail(); return; }
    const vs = compile(gl, gl.VERTEX_SHADER, VERT), fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) { fail(); return; }
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn("sea program:", gl.getProgramInfoLog(prog)); fail(); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "uRes"), uT = gl.getUniformLocation(prog, "uT"), uK = gl.getUniformLocation(prog, "uK"), uTxy = gl.getUniformLocation(prog, "uTxy"), uDpr = gl.getUniformLocation(prog, "uDpr");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1);
    let W = 0, H = 0, dirty = true, raf = 0, last = 0;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; gl.viewport(0, 0, W, H); } dirty = true; };
    const draw = (now: number) => {
      const { k, tx, ty } = vpRef.current.viewRef.current;
      gl.uniform2f(uRes, W, H); gl.uniform1f(uT, still ? 0 : now / 1000); gl.uniform1f(uK, k); gl.uniform2f(uTxy, tx, ty); gl.uniform1f(uDpr, dpr);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (!dirty && (still || now - last < 33)) return;
      dirty = false; last = now; draw(now);
    };
    const unsub = vpRef.current.subscribe(() => { dirty = true; });
    const ro = new ResizeObserver(resize); ro.observe(host);
    const onLost = (e: Event) => { e.preventDefault(); fail(); };
    canvas.addEventListener("webglcontextlost", onLost);
    resize(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); unsub(); ro.disconnect(); canvas.removeEventListener("webglcontextlost", onLost); gl.getExtension("WEBGL_lose_context")?.loseContext(); };
  }, [vp.subscribe, vp.viewRef]); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return null;
  return <canvas ref={ref} className="fx-layer sea" aria-hidden="true" />;
}
