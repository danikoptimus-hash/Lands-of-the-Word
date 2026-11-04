/**
 * Замер плавности карты (этап Э0 плана docs/proposals/map-gpu.md, методика раздела 4.1). Ничего не меняет — только мерит.
 *
 * Запуск (из корня, при поднятом локальном сервере с тестовыми данными):
 *   MAP_GAME=<id тяжёлой партии> MAP_CAPTAIN=<ник капитана> MAP_ADMIN=<ник администратора> MAP_PASS=<пароль тестовых аккаунтов> \
 *   [MAP_GAME_LIGHT=<id лёгкой партии>] [MAP_BASE=http://localhost:3000] [MAP_OUT=/путь/map-perf.json] [MAP_CPU=4] [MAP_TRACE=1] \
 *   [MAP_RUNS=phone:team:full,phone:team:early,...] [MAP_QUERY=routes=gl] [MAP_STYLE='image[filter]{filter:none}'] node scripts/map-perf.mjs
 * MAP_STYLE — дополнительный CSS на страницу (опыты: например, выключить фильтр обводки городов).
 * Ники и пароль — только из переменных окружения. Нужен Playwright (devDependencies) и Chromium (PW_CHROMIUM,
 * по умолчанию /opt/pw-browsers/chromium).
 *
 * Прогон = профиль : карта : вариант.
 *   Профили: phone — 390×844, плотность 2, пальцы (перетаскивание по кругу радиусом 130 px и щипок 40 → 190 → 40 px);
 *            desktop — 1280×900, плотность 2, мышь (перетаскивание по кругу и колесо: по делению на кадр, 30 к себе, 30 от себя).
 *            Компьютер в списке не зря: владелец замечает рывки на нём сильнее, чем на телефоне (04.11).
 *   Карты:   team — карта команды капитана; admin — карта администратора (все команды).
 *   Варианты: full — как есть; early — «ранняя партия» (ответ карты подменён: без дел, чужих дорог и меток);
 *            nofauna — слой живности выключен (getContext → null); nosvg — оба SVG-слоя мира скрыты.
 * Постоянные слои (море и озёра на WebGL, гексы, островки, салют) по умолчанию выключены (`getContext` → null): в Chromium
 * без видеокарты WebGL считается процессором и при замедлении ×4 даёт по 200 мс на кадр — это шум эмулятора, а не карта.
 * Остаются мир (оба SVG) и живность, то есть всё, что зависит от дорог и жестов. MAP_LAYERS=all — включить всё.
 * Процессор замедлен в MAP_CPU раз (по умолчанию 4). Жесты — синтетические PointerEvent/WheelEvent по кадру, 60 кадров.
 * Кадры меряются своим циклом requestAnimationFrame и сверяются с итогом жеста из `?perf=1` (window.__perf.gesture).
 * Абсолютные числа с эмулятора не равны телефонным — важны пропорции между прогонами.
 */
import { chromium } from "playwright";
import fs from "node:fs";
const BASE = process.env.MAP_BASE ?? "http://localhost:3000", PASS = process.env.MAP_PASS;
const GAMES = { heavy: process.env.MAP_GAME, light: process.env.MAP_GAME_LIGHT };
const USERS = { team: process.env.MAP_CAPTAIN, admin: process.env.MAP_ADMIN };
if (!GAMES.heavy || !USERS.team || !USERS.admin || !PASS) { console.error("Нужны MAP_GAME, MAP_CAPTAIN, MAP_ADMIN, MAP_PASS"); process.exit(1); }
const CPU = Number(process.env.MAP_CPU ?? 4);
const DEFAULT_RUNS = ["phone:team:full", "phone:team:early", "phone:team:nofauna", "phone:team:nosvg", "phone:admin:full", "desktop:team:full", "desktop:admin:full"];
const RUNS = (process.env.MAP_RUNS ?? DEFAULT_RUNS.join(",")).split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split(":"));
const PROFILES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
};
const stats = (a) => { if (!a?.length) return null; const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, avg: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1), over34: s.filter((x) => x > 34).length }; };
const fmt = (s) => (s ? `avg ${s.avg} · p50 ${s.p50} · p95 ${s.p95} · max ${s.max} · >34мс ${s.over34}/${s.n}` : "—");
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const out = {};
for (const [profile, map, variant] of RUNS) {
  const game = GAMES[variant === "light" ? "light" : "heavy"];
  if (!PROFILES[profile] || !USERS[map] || !game) { console.warn("пропуск прогона:", profile, map, variant); continue; }
  const ctx = await browser.newContext({ baseURL: BASE, locale: "ru-RU", ...PROFILES[profile] });
  await ctx.addInitScript(({ v, all }) => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, opts) {
      const fauna = this.classList.contains("fauna");
      if ((v === "nofauna" && fauna) || (!all && this.classList.contains("fx-layer") && !fauna)) return null;
      return orig.call(this, type, opts);
    };
    const css = (v === "nosvg" ? ".map-svg.world{display:none!important}\n" : "") + (extra ?? "");
    if (css) document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st); });
  }, { v: variant, all: process.env.MAP_LAYERS === "all", extra: process.env.MAP_STYLE ?? "" });
  if (variant === "early") await ctx.route(/\/api\/games\/[^/]+\/(my-map|teams\/[^/]+\/map)(\?|$)/, async (route) => { const r = await route.fetch(); const b = await r.json(); b.tasks = []; b.foreign = []; b.marks = []; await route.fulfill({ response: r, json: b }); });
  await ctx.request.post("/api/auth/login", { data: { nickname: USERS[map], password: PASS } });
  const page = await ctx.newPage();
  await page.goto(`/games/${game}${map === "team" ? "/team" : ""}?perf=1&tod=day${process.env.MAP_QUERY ? "&" + process.env.MAP_QUERY : ""}`); // MAP_QUERY — доп. параметры адреса (переключатели вариантов)
  const host = map === "team" ? ".map-canvas" : ".admin-map-area .mapwrap";
  await page.waitForSelector(`${host} .map-svg`, { state: "attached", timeout: 60000 });
  await page.addStyleTag({ content: ".toasts{display:none!important}" });
  await page.waitForTimeout(6000); // догон живности и первая фиксация
  // Стороны и пути — из модели попадания карты (с Э1 их областей нажатия в SVG нет): window.__perf.scene.
  const counts = await page.evaluate(() => ({ svg: [...document.querySelectorAll(".map-svg")].map((s) => s.querySelectorAll("*").length), edges: window.__perf?.scene?.edges ?? document.querySelectorAll(".m-edge, .adm-edge").length, routes: window.__perf?.scene?.routes ?? 0, cityFilters: document.querySelectorAll("image[filter]").length, canvases: [...document.querySelectorAll("canvas")].map((c) => `${c.className}:${c.width}×${c.height}`) }));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const idle = await page.evaluate(() => new Promise((res) => { const f = []; let last = 0; const t0 = performance.now(); const step = (now) => { if (last) f.push(now - last); last = now; if (now - t0 < 2500) requestAnimationFrame(step); else res(f); }; requestAnimationFrame(step); }));
  await page.evaluate(() => { const p = window.__perf; if (p) { p.gestures.length = 0; p.log.clear(); } });
  if (process.env.MAP_TRACE) await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "gpu", "blink"] });
  const gestures = await page.evaluate(async ({ host, touch }) => {
    const el = document.querySelector(host), r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ptr = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: touch ? "touch" : "mouse", isPrimary: id === 1, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
    const wheel = (dy) => el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaY: dy, deltaMode: 0 }));
    const hud = () => window.__perf?.gesture ?? null;
    const run = (kind) => new Promise((resolve) => {
      const N = 60, frames = []; let i = 0, last = 0;
      if (kind === "pan") ptr("pointerdown", 1, cx, cy); else if (kind === "pinch") { ptr("pointerdown", 1, cx - 40, cy); ptr("pointerdown", 2, cx + 40, cy); }
      const step = (now) => {
        if (last) frames.push(now - last); last = now; i++;
        const t = i / N;
        if (kind === "pan") ptr("pointermove", 1, cx + Math.sin(t * Math.PI * 2) * 130, cy - 130 + Math.cos(t * Math.PI * 2) * 130);
        else if (kind === "pinch") { const d = 40 + 150 * Math.sin(t * Math.PI); ptr("pointermove", 1, cx - d, cy); ptr("pointermove", 2, cx + d, cy); }
        else wheel(i <= N / 2 ? -100 : 100); // колесо: по делению на кадр, 30 к себе, потом 30 от себя
        if (i < N) requestAnimationFrame(step);
        else {
          if (kind === "pan") ptr("pointerup", 1, cx, cy); else if (kind === "pinch") { ptr("pointerup", 1, cx, cy); ptr("pointerup", 2, cx, cy); }
          setTimeout(() => resolve({ frames, hud: hud() }), 900);
        }
      };
      requestAnimationFrame(step);
    });
    const res = { pan: await run("pan") };
    res[touch ? "pinch" : "wheel"] = await run(touch ? "pinch" : "wheel");
    return res;
  }, { host, touch: PROFILES[profile].hasTouch });
  let top = null;
  if (process.env.MAP_TRACE) {
    const trace = JSON.parse((await browser.stopTracing()).toString());
    const threads = new Map();
    for (const e of trace.traceEvents) if (e.ph === "M" && e.name === "thread_name") threads.set(`${e.pid}:${e.tid}`, e.args.name);
    const agg = {};
    for (const e of trace.traceEvents) {
      if (e.ph !== "X" || !e.dur) continue;
      const th = (threads.get(`${e.pid}:${e.tid}`) ?? "?").replace(/\d+$/, "");
      if (!/CrRendererMain|Compositor|TileWorker|VizCompositor|CrGpuMain/.test(th)) continue;
      const key = `${th} | ${e.name}`; agg[key] = (agg[key] ?? 0) + e.dur / 1000;
    }
    top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`);
  }
  const marks = await page.evaluate(() => { const p = window.__perf; if (!p) return {}; const o = {}; for (const [k, a] of p.log) if (a.length) o[k] = { n: a.length, max: +Math.max(...a).toFixed(1), avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) }; return o; });
  const key = `${profile}:${map}:${variant}`;
  const g = {}; for (const [k, v] of Object.entries(gestures)) g[k] = { ...stats(v.frames), hud: v.hud ? { n: v.hud.n, avg: +v.hud.avg.toFixed(1), p50: +v.hud.p50.toFixed(1), p95: +v.hud.p95.toFixed(1), max: +v.hud.max.toFixed(1) } : null };
  out[key] = { counts, idle: stats(idle), ...g, marks, top };
  console.log(`\n=== ${key} ===`);
  console.log("сцена   ", JSON.stringify(counts));
  console.log("покой   ", fmt(out[key].idle));
  for (const [k, v] of Object.entries(g)) console.log(k.padEnd(8), fmt(v), v.hud ? `| HUD: avg ${v.hud.avg} · p95 ${v.hud.p95} · max ${v.hud.max} · n ${v.hud.n}` : "| HUD: —");
  console.log("слои    ", Object.entries(marks).map(([k, v]) => `${k}: avg ${v.avg} · max ${v.max} · n ${v.n}`).join("\n         "));
  if (top) console.log(top.join("\n"));
  await ctx.close();
}
await browser.close();
if (process.env.MAP_OUT) { fs.writeFileSync(process.env.MAP_OUT, JSON.stringify(out, null, 1)); console.log("\nзаписано:", process.env.MAP_OUT); }
