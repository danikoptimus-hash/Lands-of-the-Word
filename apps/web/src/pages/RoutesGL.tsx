import { useEffect, useRef, useState } from "react";
import type { Viewport } from "./MapLayers";
import type { RouteSpec } from "./Fauna";
import { perfMark } from "../lib/perfHud";
import { compileProgram, createLineProgram, lineMesh, parseColor, type LineBuffer, type LineProgram, type RGBA } from "../lib/glLines";
export { lineMesh, parseColor } from "../lib/glLines";

/**
 * Морские пути на WebGL (этап Э3 плана docs/proposals/map-gpu.md). Раньше слой живности собирал каждый путь из ~100
 * точек заново в каждом кадре и обводил дважды (ореол и линия) — стоимость кадра росла с числом путей. Здесь геометрия
 * загружается в видеокарту один раз при смене путей, а в кадре меняются только масштаб и сдвиг; толщина считается в
 * шейдере в экранных пикселях — точно по прежним правилам и, как раньше, в каждом кадре:
 *   ореол rgba(255,250,240,0.85) шириной 10·k/max(1.6,k) px, линия цвета команды 6 (выбранная 8)·k/max(1.6,k) px,
 *   круглые концы и стыки; стрелка (−10,−7)(4,0)(−10,7) в экранных единицах ui = clamp(k/1.6, 0.5, 1), повёрнутая
 *   по курсу, залита цветом команды и обведена rgba(255,250,240,0.95) шириной 1.5·ui px.
 * Линии — общий рисовальщик lib/glLines.ts (ломаная из многих отрезков красится через трафарет один раз). Пути за экраном
 * не рисуются. Без WebGL или при потере контекста — `onUnsupported`, и пути снова рисует слой живности как раньше.
 */
const FILL_VERT = `attribute vec2 aP; uniform vec2 uRes; void main(){ gl_Position = vec4((aP / uRes * 2.0 - 1.0) * vec2(1.0, -1.0), 0.0, 1.0); }`;
const FILL_FRAG = `precision mediump float; uniform vec4 uColor; void main(){ gl_FragColor = vec4(uColor.rgb * uColor.a, uColor.a); }`;
const HALO: RGBA = [1, 250 / 255, 240 / 255, 0.85], ARROW_EDGE: RGBA = [1, 250 / 255, 240 / 255, 0.95];

interface Built { buf: LineBuffer; color: RGBA; selected: boolean; arrow: RouteSpec["arrow"] }

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
    let lines: LineProgram, fill: WebGLProgram;
    try { lines = createLineProgram(gl); fill = compileProgram(gl, FILL_VERT, FILL_FRAG); } catch { fail(); return; }
    const F = { aP: gl.getAttribLocation(fill, "aP"), uRes: gl.getUniformLocation(fill, "uRes"), uColor: gl.getUniformLocation(fill, "uColor") };
    const triVbo = gl.createBuffer()!;
    const arrowBuf = lines.upload(lineMesh([[{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]], true), true);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, dirty = true;
    const resize = () => { W = Math.round(host.clientWidth * dpr); H = Math.round(host.clientHeight * dpr); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } gl.viewport(0, 0, W, H); lines.setViewport(W / dpr, H / dpr); dirty = true; };
    let built: Built[] = [];
    const drop = () => { for (const b of built) lines.free(b.buf); built = []; };
    rebuild.current = () => {
      drop();
      for (const r of routesRef.current) if (r.pts.length >= 2) built.push({ buf: lines.upload(lineMesh([r.pts])), color: parseColor(r.color), selected: !!r.selected, arrow: r.arrow });
      dirty = true;
    };
    rebuild.current();
    const tri = new Float32Array(6), arrowPts = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    const draw = () => {
      const t0 = performance.now();
      const { k, tx, ty } = vpRef.current.viewRef.current;
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      if (!built.length) return;
      const m = Math.max(1.6, k), ui = Math.min(1, Math.max(0.5, k / 1.6));
      const sw = W / dpr, shh = H / dpr;
      // Видимая область в единицах карты с запасом на толщину и стрелку.
      const pad = 24 / k, vx0 = -tx / k - pad, vy0 = -ty / k - pad, vx1 = (sw - tx) / k + pad, vy1 = (shh - ty) / k + pad;
      let ref = 0;
      for (const b of built) {
        const bx = b.buf.box;
        if (bx.x1 < vx0 || bx.x0 > vx1 || bx.y1 < vy0 || bx.y0 > vy1) continue;
        ref = (ref % 84) + 1;
        lines.draw(b.buf, { k, tx, ty, halfPx: 5 * k / m, color: HALO, stencil: ref * 3 - 2 });
        lines.draw(b.buf, { k, tx, ty, halfPx: (b.selected ? 4 : 3) * k / m, color: b.color, stencil: ref * 3 - 1 });
        // Стрелка: в экранных пикселях (масштаб ui), повёрнута по курсу; залита, затем обведена.
        const ax = b.arrow.x * k + tx, ay = b.arrow.y * k + ty, h = (b.arrow.heading * Math.PI) / 180, c = Math.cos(h), s = Math.sin(h);
        const local = [[-10, -7], [4, 0], [-10, 7]] as const;
        for (let i = 0; i < 3; i++) { const [lx, ly] = local[i]!; const x = ax + (lx * c - ly * s) * ui, y = ay + (lx * s + ly * c) * ui; tri[i * 2] = x; tri[i * 2 + 1] = y; arrowPts[i]!.x = x; arrowPts[i]!.y = y; }
        gl.useProgram(fill); gl.uniform2f(F.uRes, sw, shh); gl.uniform4f(F.uColor, b.color[0], b.color[1], b.color[2], b.color[3]);
        gl.bindBuffer(gl.ARRAY_BUFFER, triVbo); gl.bufferData(gl.ARRAY_BUFFER, tri, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(F.aP); gl.vertexAttribPointer(F.aP, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.disableVertexAttribArray(F.aP);
        lines.update(arrowBuf, lineMesh([arrowPts], true));
        lines.draw(arrowBuf, { k: 1, tx: 0, ty: 0, halfPx: 0.75 * ui, color: ARROW_EDGE, stencil: ref * 3 });
      }
      perfMark("пути (gl)", performance.now() - t0);
    };
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); if (!dirty || document.hidden) return; dirty = false; draw(); };
    const unsub = vpRef.current.subscribe(() => { dirty = true; });
    const ro = new ResizeObserver(resize); ro.observe(host);
    const onLost = (e: Event) => { e.preventDefault(); fail(); };
    canvas.addEventListener("webglcontextlost", onLost);
    resize(); raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); unsub(); ro.disconnect(); canvas.removeEventListener("webglcontextlost", onLost); drop(); lines.free(arrowBuf); lines.dispose(); gl.getExtension("WEBGL_lose_context")?.loseContext(); };
  }, [vp.subscribe, vp.viewRef]); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) return null;
  return <canvas ref={ref} className="fx-layer routes" aria-hidden="true" />;
}
