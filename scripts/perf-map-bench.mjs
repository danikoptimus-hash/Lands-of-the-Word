// Бенчмарк плавности карты (12.10): трассировка главного потока и растеризации (CDP Tracing) во время зума колесом
// и перетаскивания на локальном сервере. Запуск: SIM_PASS=<пароль ботов> GID=<id партии> NICK=tg_m1 node scripts/perf-map-bench.mjs
// Нужен локальный сервер на :3000 и партия с ботами (см. scripts/sim-game.mjs). Ничего не хранит и никуда не шлёт.
import { chromium } from "playwright";
const BASE = "http://localhost:3000", G = process.env.GID, PASS = process.env.SIM_PASS;
const NICK = process.env.NICK ?? "tg_m1", PATH = process.env.PATHX ?? `/games/${G}/team`, MOBILE = process.env.MOBILE === "1";
const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: NICK, password: PASS }) });
const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0]; const [name, ...rest] = cookie.split("=");
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ baseURL: BASE, ...(MOBILE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }) });
await ctx.addCookies([{ name, value: rest.join("="), domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await p.goto(PATH + (PATH.includes("?") ? "&" : "?") + "perf=1"); await p.waitForSelector(".map-svg"); if (process.env.EXTRA_CSS) await p.addStyleTag({ content: process.env.EXTRA_CSS }); await p.waitForTimeout(3500);
const box = await p.locator(".map-svg").first().boundingBox();
const cx = box.x + box.width / 2 + 60, cy = box.y + box.height / 2;
let events = [];
cdp.on("Tracing.dataCollected", (e) => { events.push(...e.value); });
const traceStart = async () => { events = []; await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink", "cc", "v8.execute"], recordMode: "recordContinuously" } }); };
const traceStop = async () => { const done = new Promise((res) => cdp.once("Tracing.tracingComplete", res)); await cdp.send("Tracing.end"); await done; return summarize(events); };
function summarize(evs) {
  // Длительности: события ph X (с dur) и пары B/E; по потокам; главный поток — где больше всего RunTask.
  const byThread = new Map(); const open = new Map();
  const add = (e, dur) => { const k = e.pid + ":" + e.tid; const t = byThread.get(k) ?? { tasks: 0, by: {}, long: 0 }; if (e.name === "RunTask") { t.tasks++; if (dur > 50000) t.long++; } t.by[e.name] = (t.by[e.name] ?? 0) + dur / 1000; byThread.set(k, t); };
  for (const e of evs) {
    if (e.ph === "X" && e.dur != null) add(e, e.dur);
    else if (e.ph === "B") { const k = e.pid + ":" + e.tid + ":" + e.name; (open.get(k) ?? open.set(k, []).get(k)).push(e.ts); }
    else if (e.ph === "E") { const k = e.pid + ":" + e.tid + ":" + e.name; const st = open.get(k)?.pop(); if (st != null) add(e, e.ts - st); }
  }
  // Главный поток рендерера — по имени потока из метаданных трассы.
  const names = new Map(); for (const e of evs) if (e.ph === "M" && e.name === "thread_name") names.set(e.pid + ":" + e.tid, e.args?.name);
  let main = null, mainTasks = -1;
  for (const [k, t] of byThread) if (names.get(k) === "CrRendererMain" && t.tasks > mainTasks) { main = t; mainTasks = t.tasks; }
  const by = main?.by ?? {};
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 22).map(([n, v]) => n + "=" + v.toFixed(0));
  const rasterAll = evs.filter((e) => e.name === "RasterTask" && e.ph === "X").reduce((a, e) => a + e.dur / 1000, 0);
  return { longTasks: main?.long ?? 0, raster: Number(rasterAll.toFixed(0)), top };
}
const out = {};
await traceStart();
await p.mouse.move(cx, cy);
for (let i = 0; i < 24; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(40); }
await p.waitForTimeout(500);
for (let i = 0; i < 24; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(40); }
await p.waitForTimeout(500);
out.wheel = await traceStop();
await traceStart();
await p.mouse.move(cx, cy); await p.mouse.down();
for (let i = 0; i < 90; i++) { await p.mouse.move(cx + i * 6, cy + Math.sin(i / 9) * 40); await p.waitForTimeout(16); }
for (let i = 90; i > 0; i--) { await p.mouse.move(cx + i * 6, cy + Math.sin(i / 9) * 40); await p.waitForTimeout(16); }
await p.mouse.up(); await p.waitForTimeout(500);
out.drag = await traceStop();
for (let i = 0; i < 10; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(40); } await p.waitForTimeout(800);
await traceStart();
await p.mouse.move(cx, cy); await p.mouse.down();
for (let i = 0; i < 60; i++) { await p.mouse.move(cx - i * 8, cy + i * 3); await p.waitForTimeout(16); }
await p.mouse.up(); await p.waitForTimeout(500);
out.dragZoomed = await traceStop();
await traceStart(); await p.waitForTimeout(2000); out.idle2s = await traceStop();
out.hud = await p.evaluate(() => document.querySelector("pre")?.textContent ?? "");
console.log(JSON.stringify({ nick: NICK, mobile: MOBILE, ...out }));
await b.close();
