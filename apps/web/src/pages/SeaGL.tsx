import { useEffect, useRef, useState } from "react";
import type { Viewport } from "./MapLayers";
import { SEA_DEEP, SEA_MID, SEA_SHALLOW, type Seabed } from "./Seabed";

/**
 * Море на WebGL: цвет каждого пикселя считается шейдером прямо в координатах карты, без плиток и узоров —
 * повторяться нечему ни на каком масштабе. Вода: две сети живой каустики (клеточный шум, точки ячеек медленно
 * чуть дрожат, а вся сеть плывёт по ветру), координаты искажены плавным шумом (линии изогнутые), блики гаснут
 * пятнами по маске, крупная зыбь темнит воду и идёт тем же ветром медленнее; при отдалении рябь тает. Цвет воды —
 * по глубине из поля дна (`Seabed.ts`): светлый шельф у берегов и между близкими островами, тёмная глубина вдали,
 * в глубине — гряды и впадины шумом. ~30 кадров в
 * секунду при видимой вкладке, разрешение не выше 1 пикселя на CSS-пиксель — воде хватает, телефону легче.
 */
/** Общие функции шума для шейдеров воды (море и озёра). */
export const NOISE_GLSL = `
// Хэш без sin: на телефонных GPU sin от больших чисел (далёкие клетки решётки, долгий дрейф) вырождается, и шум
// шёл ровными прямоугольными пятнами по клеткам решётки. Клетки заворачиваются по 1024 — числа малые, точности хватает.
vec2 hash2(vec2 p){ p = mod(p, 1024.0); vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash2(i).x, b = hash2(i + vec2(1.0, 0.0)).x, c = hash2(i + vec2(0.0, 1.0)).x, d = hash2(i + vec2(1.0, 1.0)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; } return v; }
// Живая каустика: F2 − F1 клеточного шума, точки ячеек ходят по кругу со временем; мягкая линия по границам.
float caustic(vec2 p, float t, float w){ vec2 i = floor(p), f = fract(p); float f1 = 8.0, f2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)); vec2 o = hash2(i + g); o = 0.5 + 0.28 * sin(t + 6.2831 * o);
    float d = length(g + o - f); if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; } }
  float e = (f2 - f1) / w; return exp(-e * e); }
`;
const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uT; uniform float uD; uniform float uK; uniform vec2 uTxy; uniform float uDpr;
uniform sampler2D uBed; uniform vec4 uBedRect; uniform vec3 uShallow, uMid, uDeep;
${NOISE_GLSL}
void main(){
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 wp = (fc - uTxy) / uK;                       // координаты карты
  // Ветер: рябь, блики и зыбь идут в одну сторону (мелкая рябь быстрее, зыбь медленнее — как на настоящей воде),
  // а точки ячеек лишь чуть дрожат на месте. Так движение согласованное, а не хаотичное.
  vec2 wind = vec2(0.86, 0.5);
  vec2 w1 = wp - wind * uD * 5.0, w2 = wp - wind * uD * 3.0;
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
  float m1 = smoothstep(0.25, 0.8, fbm((wp - wind * uD * 2.0) * 0.006));
  float swell = fbm((wp - wind * uD * 1.5) * 0.0035);
  // Глубина по полю дна (0 — мель у берега, 1 — открытое море); за пределами поля — глубина.
  vec2 buv = (wp - uBedRect.xy) / uBedRect.zw;
  float depth = texture2D(uBed, clamp(buv, 0.0, 1.0)).r;
  // Рельеф дна только в глубокой воде: светлые гряды (хребты) и тёмные впадины, как на снимке океана.
  float rel = fbm(wp * 0.004 + vec2(7.3, 2.1)) - 0.5;
  float ridge = pow(1.0 - abs(fbm(wp * 0.0025 + vec2(3.0, 9.0)) * 2.0 - 1.0), 4.0);
  float dz = clamp(depth + depth * (rel * 0.5 - ridge * 0.35), 0.0, 1.0);
  vec3 col = dz < 0.5 ? mix(uShallow, uMid, dz * 2.0) : mix(uMid, uDeep, (dz - 0.5) * 2.0);
  col *= 0.94 + 0.14 * swell;
  // Блики каустики ярче на мели, в глубине почти гаснут.
  float light = lod * cau * (0.25 + 0.75 * m1) * 0.36 * (0.45 + 0.55 * (1.0 - dz));
  col += vec3(0.82, 0.94, 0.96) * light;
  // Ветровые волны: пологие гребни бегут по ветру двумя чуть разными фронтами, фаза сломана шумом, а видны
  // они лишь пятнами (маска) — никакой правильной полосатости, только живое дыхание воды. Гаснут при отдалении.
  float ph = fbm(wp * 0.03 + vec2(4.2, 8.8)) * 9.0;
  float rip = sin(mod(dot(wp, wind) * 0.45 - uT * 2.2 + ph, 6.2832)) + 0.7 * sin(mod(dot(wp, vec2(0.62, 0.78)) * 0.31 - uT * 1.6 + ph * 0.6, 6.2832));
  float patch = smoothstep(0.35, 0.8, fbm(wp * 0.01 + vec2(2.0, 5.0) - wind * uD * 0.02));
  col += vec3(0.045, 0.06, 0.06) * rip * patch * (0.35 + 0.65 * lod) * smoothstep(0.2, 0.9, uK);
  gl_FragColor = vec4(col, 1.0);
}`;

export function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type); if (!sh) return null;
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { console.warn("sea shader:", gl.getShaderInfoLog(sh)); return null; }
  return sh;
}

/** Возвращает false, если WebGL недоступен: тогда вызывающий рисует запасной вариант. */
export function SeaGL({ vp, bed, onUnsupported }: { vp: Viewport; bed: Seabed | null; onUnsupported: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  const [failed, setFailed] = useState(false);
  /** Живой контекст для загрузки поля дна без пересоздания (пересоздание теряло контекст и роняло море на запасной canvas). */
  const glRef = useRef<{ gl: WebGLRenderingContext; tex: WebGLTexture; uBedRect: WebGLUniformLocation | null; touch: () => void } | null>(null);
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
    // Поле глубины — текстура с плавной интерполяцией, за краем — крайнее значение (глубина). Без поля — 1×1 «глубина».
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 0, 255]));
    gl.uniform1i(gl.getUniformLocation(prog, "uBed"), 0);
    const uBedRect = gl.getUniformLocation(prog, "uBedRect");
    gl.uniform4f(uBedRect, 0, 0, 1, 1);
    gl.uniform3fv(gl.getUniformLocation(prog, "uShallow"), SEA_SHALLOW); gl.uniform3fv(gl.getUniformLocation(prog, "uMid"), SEA_MID); gl.uniform3fv(gl.getUniformLocation(prog, "uDeep"), SEA_DEEP);
    const uRes = gl.getUniformLocation(prog, "uRes"), uT = gl.getUniformLocation(prog, "uT"), uD = gl.getUniformLocation(prog, "uD"), uK = gl.getUniformLocation(prog, "uK"), uTxy = gl.getUniformLocation(prog, "uTxy"), uDpr = gl.getUniformLocation(prog, "uDpr");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Разрешение ниже экрана: воде хватает, а шейдер считается на каждый пиксель — на большом экране это главная нагрузка.
    const area = host.clientWidth * host.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1) * (area > 1_000_000 ? 0.55 : 0.7);
    let W = 0, H = 0, dirty = true, raf = 0, last = 0;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; gl.viewport(0, 0, W, H); } dirty = true; };
    const draw = (now: number) => {
      const { k, tx, ty } = vpRef.current.viewRef.current;
      // uT — фаза дрожания и волн (все частоты кратны 0.05, период 40π с: заворачивается без скачка, sin получает малые
      // числа); uD — время дрейфа по ветру, не заворачивается (координаты решётки заворачивает сам хэш).
      gl.uniform2f(uRes, W, H); gl.uniform1f(uT, still ? 0 : (now / 1000) % (40 * Math.PI)); gl.uniform1f(uD, still ? 0 : now / 1000); gl.uniform1f(uK, k); gl.uniform2f(uTxy, tx, ty); gl.uniform1f(uDpr, dpr);
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
    glRef.current = { gl, tex: tex!, uBedRect, touch: () => { dirty = true; } };
    setBedReady((n) => n + 1);
    return () => { cancelAnimationFrame(raf); unsub(); ro.disconnect(); canvas.removeEventListener("webglcontextlost", onLost); glRef.current = null; gl.getExtension("WEBGL_lose_context")?.loseContext(); };
  }, [vp.subscribe, vp.viewRef]); // eslint-disable-line react-hooks/exhaustive-deps
  // Поле дна загружается в живой контекст при появлении или смене (перезагрузка карты по событиям игры).
  const [bedReady, setBedReady] = useState(0);
  useEffect(() => {
    const g = glRef.current; if (!g) return;
    const { gl } = g;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tex);
    if (bed) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bed.canvas);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 0, 255]));
    gl.uniform4f(g.uBedRect, bed?.x ?? 0, bed?.y ?? 0, bed?.w ?? 1, bed?.h ?? 1);
    g.touch();
  }, [bed, bedReady]);
  if (failed) return null;
  return <canvas ref={ref} className="fx-layer sea" aria-hidden="true" />;
}
