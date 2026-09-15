import { useEffect, useRef, useState } from "react";
import { HEX_SIZE, hexCenter } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";
import { IMG, type Viewport } from "./MapLayers";
import { NOISE_GLSL, compile } from "./SeaGL";

const VERT = `
attribute vec2 a; uniform vec2 uCenter; uniform float uSize; uniform vec3 uView; uniform vec2 uRes; uniform float uDpr;
varying vec2 vP;
void main(){ vP = a; vec2 world = uCenter + a * uSize; vec2 scr = (world * uView.x + uView.yz) * uDpr;
  gl_Position = vec4(scr.x / uRes.x * 2.0 - 1.0, 1.0 - scr.y / uRes.y * 2.0, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform sampler2D uTex; uniform float uT; uniform float uRot; uniform vec2 uSeed; uniform float uK;
varying vec2 vP;
${NOISE_GLSL}
// Расстояние до края шестиугольника с острым верхом: 0 в центре, 1 на ребре (нормали рёбер на 0°, 60°, 120°).
float hexDist(vec2 p){ p = abs(p); return max(p.x, max(abs(p.x * 0.5 + p.y * 0.866), abs(p.x * 0.5 - p.y * 0.866))) / 0.866; }
void main(){
  vec2 p = vP;                                   // координаты внутри гекса, радиус до угла = 1
  float hd = hexDist(p);
  float c = cos(uRot), s = sin(uRot);
  vec2 q = mat2(c, -s, s, c) * p;                // картинка озера повёрнута, как в гексе на карте
  // Преломление: картинка воды плавно колышется двумя шумами разного масштаба — поверхность живая, а не ползёт.
  vec2 n1 = vec2(fbm(p * 2.2 + uSeed + uT * 0.14), fbm(p * 2.2 + uSeed + vec2(4.7, 1.3) - uT * 0.12)) - 0.5;
  vec2 n2 = vec2(fbm(p * 6.0 + uSeed * 1.7 + uT * 0.35), fbm(p * 6.0 + uSeed * 1.7 + vec2(2.1, 8.4) - uT * 0.3)) - 0.5;
  vec2 uv = q / 1.4 * 0.5 + 0.5 + n1 * 0.05 + n2 * 0.014;
  vec3 col = texture2D(uTex, uv).rgb;
  // Глубина: середина темнее, к берегу мельче и светлее; у самого края светлая мелководная кайма.
  col *= 0.82 + 0.18 * hd;
  float shore = smoothstep(0.72, 1.0, hd);
  col = mix(col, vec3(0.56, 0.78, 0.78), shore * 0.4);
  // Блики каустики: две сети перемножаются, ярче на мели.
  vec2 w = n1 * 1.6;
  float c1 = caustic(p * 4.5 + uSeed + w, uT * 0.4, 0.2), c2 = caustic(mat2(0.8, -0.6, 0.6, 0.8) * p * 3.0 + uSeed + w * 0.7 + 7.0, uT * 0.3 + 2.0, 0.22);
  float cau = c1 * (0.3 + 0.7 * c2) + 0.3 * c2 * c1 * c1;
  float mask = smoothstep(0.3, 0.8, fbm(p * 1.5 + uSeed * 0.5 - uT * 0.05));
  col += vec3(0.8, 0.93, 0.95) * cau * (0.3 + 0.7 * mask) * (0.16 + 0.16 * shore) * smoothstep(0.35, 1.2, uK);
  // Ветровая рябь: пологие гребни бегут по озеру, фаза сломана шумом; искры солнца на гребнях.
  float ph = fbm(p * 3.0 + uSeed) * 6.0;
  float rip = sin(dot(p, vec2(0.86, 0.5)) * 16.0 - uT * 2.4 + ph);
  col += vec3(0.05, 0.06, 0.06) * rip * (1.0 - shore * 0.5);
  float glint = pow(max(0.0, vnoise(p * 18.0 + uSeed * 3.0 + vec2(uT * 0.7, -uT * 0.5))), 10.0) * smoothstep(0.2, 0.6, rip) * smoothstep(0.6, 1.6, uK);
  col += vec3(0.9, 0.95, 0.95) * glint * 0.55;
  // Сглаженный край.
  float alpha = 1.0 - smoothstep(0.975, 1.0, hd);
  gl_FragColor = vec4(col * alpha, alpha);
}`;

/**
 * Живая вода на гексах-озёрах (решение владельца 15.09, «не просто наложение сверху»): WebGL-слой под миром рисует
 * каждое открытое озеро целиком — картинка воды преломляется (колышется) двумя шумами, к берегу мельче и светлее,
 * блики каустики, ветровая рябь и искры солнца, край сглажен. В SVG мира такой гекс без заливки, только граница;
 * без WebGL — обычная картинка (onUnsupported). ~30 кадров в секунду при видимой вкладке; при «уменьшить
 * движение» — неподвижно. Только гексы в кадре, по одному вызову на озеро.
 */
export function LakesLayer({ vp, hexes, size = HEX_SIZE, onUnsupported }: { vp: Viewport; hexes: MapHexDto[]; size?: number; onUnsupported: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef(vp); vpRef.current = vp;
  const [failed, setFailed] = useState(false);
  const lakesKey = hexes.filter((h) => h.terrain === "water" && h.lit !== false).map((h) => `${h.q},${h.r}:${h.rotation ?? 0}`).join(";");
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const lakes = hexes.filter((h) => h.terrain === "water" && h.lit !== false).map((h) => ({ c: hexCenter(h, size), rot: ((h.rotation ?? 0) % 6) * Math.PI / 3 }));
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
    const fail = () => { setFailed(true); onUnsupported(); };
    if (!gl) { fail(); return; }
    const vs = compile(gl, gl.VERTEX_SHADER, VERT), fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) { fail(); return; }
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn("lakes program:", gl.getProgramInfoLog(prog)); fail(); return; }
    gl.useProgram(prog);
    // Веер: центр и шесть углов (радиус до угла 1, острый верх).
    const verts = [0, 0];
    for (let i = 0; i <= 6; i++) { const a = (Math.PI / 180) * (60 * i - 30); verts.push(Math.cos(a), Math.sin(a)); }
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const uCenter = U("uCenter"), uSize = U("uSize"), uView = U("uView"), uRes = U("uRes"), uDpr = U("uDpr"), uT = U("uT"), uRot = U("uRot"), uSeed = U("uSeed"), uK = U("uK");
    gl.uniform1i(U("uTex"), 0);
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([70, 130, 160, 255]));
    let ready = false, dirty = true, raf = 0, last = 0, W = 0, H = 0;
    const im = new Image(); im.decoding = "async";
    im.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.generateMipmap(gl.TEXTURE_2D);
      ready = true; dirty = true;
    };
    im.src = IMG.terrain("water");
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; gl.viewport(0, 0, W, H); } dirty = true; };
    const draw = (now: number) => {
      const { k, tx, ty } = vpRef.current.viewRef.current;
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (!ready) return;
      gl.uniform2f(uRes, W, H); gl.uniform1f(uDpr, dpr); gl.uniform3f(uView, k, tx, ty); gl.uniform1f(uSize, size * 0.995);
      gl.uniform1f(uT, still ? 0 : (now / 1000) % (40 * Math.PI)); gl.uniform1f(uK, k);
      const x0 = -tx / k, y0 = -ty / k, x1 = (W / dpr - tx) / k, y1 = (H / dpr - ty) / k;
      for (const l of lakes) {
        if (l.c.x + size < x0 || l.c.x - size > x1 || l.c.y + size < y0 || l.c.y - size > y1) continue;
        gl.uniform2f(uCenter, l.c.x, l.c.y); gl.uniform1f(uRot, l.rot); gl.uniform2f(uSeed, (l.c.x % 97) * 0.13, (l.c.y % 89) * 0.17);
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 8);
      }
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
  }, [lakesKey, size, vp.subscribe, vp.viewRef]); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return null;
  return <canvas ref={ref} className="fx-layer lakes" aria-hidden="true" />;
}
