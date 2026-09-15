/**
 * Диагностика плавности карты (только по запросу владельца): с `?perf=1` в адресе в углу показываются самый
 * длинный кадр за последнюю секунду и время работы слоёв (растр гексов, берег, море, озёра, фиксация мира).
 * Ничего никуда не отправляется — только на экран; без параметра код ничего не делает.
 */
const on = typeof location !== "undefined" && /[?&]perf=1/.test(location.search);
const samples = new Map<string, number[]>();
export function perfMark(name: string, ms: number): void {
  if (!on) return;
  const arr = samples.get(name) ?? []; arr.push(ms); if (arr.length > 60) arr.shift(); samples.set(name, arr);
}
if (on && typeof document !== "undefined") {
  const box = document.createElement("pre");
  box.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9999;margin:0;padding:6px 8px;font:11px/1.35 monospace;background:rgba(0,0,0,.75);color:#9f9;border-radius:6px;pointer-events:none;white-space:pre";
  document.body.appendChild(box);
  let last = performance.now(), worst = 0, frames = 0, tick = last;
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    worst = Math.max(worst, now - last); last = now; frames++;
    if (now - tick >= 1000) {
      const lines = [`кадр max ${worst.toFixed(0)} мс · ${frames} fps`];
      for (const [name, arr] of samples) { if (!arr.length) continue; const mx = Math.max(...arr), avg = arr.reduce((a, b) => a + b, 0) / arr.length; lines.push(`${name}: max ${mx.toFixed(1)} · avg ${avg.toFixed(1)} · n ${arr.length}`); arr.length = 0; }
      box.textContent = lines.join("\n");
      worst = 0; frames = 0; tick = now;
    }
  };
  requestAnimationFrame(loop);
}
