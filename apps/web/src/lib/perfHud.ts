/**
 * Диагностика плавности карты (только по запросу владельца): с `?perf=1` в адресе в углу показываются самый
 * длинный кадр за последнюю секунду, время работы слоёв (растр гексов, берег, море, живность, фиксация мира),
 * кадры последнего жеста (медиана, 95-й процентиль, максимум) и размер сцены (элементы SVG, стороны, морские пути).
 * Ничего никуда не отправляется — только на экран; без параметра код ничего не делает.
 * Этап Э0 плана ускорения карты (docs/proposals/map-gpu.md): по этим числам сверяются этапы Э1–Э5.
 */
const on = typeof location !== "undefined" && /[?&]perf=1/.test(location.search);
const samples = new Map<string, number[]>();
/** Итог жеста: кадры от начала перетаскивания, щипка или прокрутки колесом до фиксации в конце. */
export interface GestureStats { n: number; avg: number; p50: number; p95: number; max: number; frames: number[] }
/** Для замеров автоматикой (Playwright): с ?perf=1 всё доступно как window.__perf (и __perfSamples, как раньше). */
/** Полный журнал меток для автоматики (экранные `samples` обнуляются каждую секунду): по 600 последних на имя. */
const log = new Map<string, number[]>();
const perf = { samples, log, gesture: null as GestureStats | null, gestures: [] as GestureStats[], counts: { svg: 0, edges: 0, routes: 0 }, view: null as unknown, scene: null as { edges: number; routes: number } | null };
if (on && typeof window !== "undefined") { const w = window as unknown as Record<string, unknown>; w.__perf = perf; w.__perfSamples = samples; }
export function perfMark(name: string, ms: number): void {
  if (!on) return;
  const arr = samples.get(name) ?? []; arr.push(ms); if (arr.length > 60) arr.shift(); samples.set(name, arr);
  const all = log.get(name) ?? []; all.push(ms); if (all.length > 600) all.shift(); log.set(name, all);
}
/** Показать объект автоматике (window.__perf[name]); без ?perf=1 ничего не делает. */
export function perfExpose(name: "view" | "scene", value: unknown): void { if (on) (perf as Record<string, unknown>)[name] = value; }
let gestureFrames: number[] | null = null;
/** Начало и конец жеста: пока жест идёт, цикл ниже копит длительности кадров; в конце считается итог. */
export function perfGesture(phase: "start" | "end"): void {
  if (!on) return;
  if (phase === "start") { if (!gestureFrames) gestureFrames = []; return; }
  const f = gestureFrames; gestureFrames = null;
  if (!f || f.length < 2) return;
  const s = [...f].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  perf.gesture = { n: s.length, avg: s.reduce((a, b) => a + b, 0) / s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1]!, frames: f };
  perf.gestures.push(perf.gesture); if (perf.gestures.length > 20) perf.gestures.shift();
}
/** Фиксация вида (React перерисовывает слои под новый масштаб): сколько прошло до первого кадра после неё и до второго. */
export function perfCommit(): void {
  if (!on) return;
  const t0 = performance.now();
  requestAnimationFrame(() => { perfMark("фиксация → кадр", performance.now() - t0); requestAnimationFrame(() => perfMark("фиксация → 2-й кадр", performance.now() - t0)); });
}
if (on && typeof document !== "undefined") {
  const box = document.createElement("pre"); box.id = "perf-hud";
  box.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9999;margin:0;padding:6px 8px;font:11px/1.35 monospace;background:rgba(0,0,0,.75);color:#9f9;border-radius:6px;pointer-events:none;white-space:pre";
  document.body.appendChild(box);
  let last = performance.now(), worst = 0, frames = 0, tick = last;
  const count = () => {
    // Стороны и пути: с Э1 их области нажатия не в SVG — карта сообщает числа сама (perfExpose("scene")).
    perf.counts = { svg: document.querySelectorAll(".map-svg *").length, edges: perf.scene?.edges ?? document.querySelectorAll(".m-edge, .adm-edge").length, routes: perf.scene?.routes ?? 0 };
    return perf.counts;
  };
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = now - last;
    worst = Math.max(worst, dt); last = now; frames++;
    if (gestureFrames) gestureFrames.push(dt);
    if (now - tick >= 1000) {
      const lines = [`кадр max ${worst.toFixed(0)} мс · ${frames} fps`];
      const g = perf.gesture;
      if (g) lines.push(`жест: p50 ${g.p50.toFixed(0)} · p95 ${g.p95.toFixed(0)} · max ${g.max.toFixed(0)} · n ${g.n}`);
      const c = count();
      lines.push(`SVG ${c.svg} · стороны ${c.edges} · пути ${c.routes}`);
      for (const [name, arr] of samples) { if (!arr.length) continue; const mx = Math.max(...arr), avg = arr.reduce((a, b) => a + b, 0) / arr.length; lines.push(`${name}: max ${mx.toFixed(1)} · avg ${avg.toFixed(1)} · n ${arr.length}`); arr.length = 0; }
      box.textContent = lines.join("\n");
      worst = 0; frames = 0; tick = now;
    }
  };
  requestAnimationFrame(loop);
}
