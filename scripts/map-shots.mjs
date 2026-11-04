/**
 * Эталонные снимки карты (этап Э0 плана docs/proposals/map-gpu.md): по ним попиксельно сверяются этапы Э1–Э5 —
 * карта после них должна выглядеть точно так же. Снимки хранятся вне репозитория (MAP_SHOTS), сравнение —
 * `python3 scripts/map-shots-diff.py <эталон> <новые>`.
 *
 * Запуск (из корня, при поднятом локальном сервере с тестовыми данными):
 *   MAP_SHOTS=/путь/вне/репозитория MAP_GAME=<id тяжёлой партии> [MAP_GAME_LIGHT=<id лёгкой партии>] MAP_CAPTAIN=<ник капитана> \
 *   MAP_ADMIN=<ник администратора> MAP_PASS=<пароль тестовых аккаунтов> [MAP_BASE=http://localhost:3000] \
 *   [MAP_TIME=2026-11-04T12:00:00+05:00] [MAP_RUNS=phone:heavy:team,...] node scripts/map-shots.mjs
 * Ники и пароль — только из переменных окружения. Нужен Playwright (devDependencies) и Chromium (PW_CHROMIUM).
 *
 * Чтобы снимки повторялись: часы страницы остановлены (`page.clock.setFixedTime`) — живность, время суток и костры у
 * всех прогонов одни; `?tod=day`; море, озёра, туман и салют скрыты (они живут по своим часам, и план их не трогает); подсказки,
 * плашки и панель `?perf=1` скрыты. Профили: телефон 390×844 ×3 и компьютер 1280×900 ×2; карты команды и администратора;
 * масштабы 0,6 / 1 / 1,6 / 2,4 / 4 / 8 от «вся карта» вокруг центра карты; плюс кадры посреди щипка от масштаба 1,6:
 * ×1,3 (до ступеньки фиксации) и ×1,55 (сразу после неё) — для проверки ступенек толщин.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.env.MAP_BASE ?? "http://localhost:3000", PASS = process.env.MAP_PASS, OUT = process.env.MAP_SHOTS;
const GAMES = { heavy: process.env.MAP_GAME, light: process.env.MAP_GAME_LIGHT };
const USERS = { team: process.env.MAP_CAPTAIN, admin: process.env.MAP_ADMIN };
if (!OUT || !GAMES.heavy || !USERS.team || !USERS.admin || !PASS) { console.error("Нужны MAP_SHOTS, MAP_GAME, MAP_CAPTAIN, MAP_ADMIN, MAP_PASS"); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const TIME = new Date(process.env.MAP_TIME ?? "2026-11-04T12:00:00+05:00");
const ZOOMS = [0.6, 1, 1.6, 2.4, 4, 8];
const PROFILES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
};
const all = []; for (const p of Object.keys(PROFILES)) for (const g of Object.keys(GAMES)) if (GAMES[g]) for (const m of Object.keys(USERS)) all.push(`${p}:${g}:${m}`);
const RUNS = (process.env.MAP_RUNS ?? all.join(",")).split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split(":"));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
for (const [profile, game, map] of RUNS) {
  if (!PROFILES[profile] || !GAMES[game] || !USERS[map]) { console.warn("пропуск:", profile, game, map); continue; }
  const ctx = await browser.newContext({ baseURL: BASE, locale: "ru-RU", ...PROFILES[profile] });
  await ctx.request.post("/api/auth/login", { data: { nickname: USERS[map], password: PASS } });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(TIME);
  await page.goto(`/games/${GAMES[game]}${map === "team" ? "/team" : ""}?perf=1&tod=day`);
  const host = map === "team" ? ".map-canvas" : ".admin-map-area .mapwrap";
  await page.waitForSelector(`${host} .map-svg`, { timeout: 60000 });
  // Туман (холст сразу после мирового SVG) тоже скрыт: его облака плывут по часам кадра, а не по Date, и снимки не повторялись бы.
  await page.addStyleTag({ content: ".toasts,#perf-hud,.fx-layer.sea,.fx-layer.lakes,.fx-layer.fireworks,.map-svg.world+canvas.fx-layer:not(.fauna){visibility:hidden!important}" });
  await page.waitForTimeout(4000); // догон живности до остановленной секунды
  const name = `${profile}-${game}-${map}`;
  // Центр карты — тот, что у «вся карта»: вокруг него все масштабы.
  const center = await page.evaluate(({ host }) => { const v = window.__perf.view; v.fit(); const el = document.querySelector(host); const { k, tx, ty } = v.get(); return { x: (el.clientWidth / 2 - tx) / k, y: (el.clientHeight / 2 - ty) / k }; }, { host });
  const setZoom = (z) => page.evaluate(({ host, z, center }) => { const v = window.__perf.view, el = document.querySelector(host), k = v.fitK() * z; v.set({ k, tx: el.clientWidth / 2 - center.x * k, ty: el.clientHeight / 2 - center.y * k }); }, { host, z, center });
  for (const z of ZOOMS) { await setZoom(z); await page.waitForTimeout(1500); await page.screenshot({ path: `${OUT}/${name}-z${z}.png` }); }
  // Посреди щипка: от масштаба 1,6 — ×1,3 (до ступеньки фиксации ×1,5) и ×1,55 (сразу после неё).
  await setZoom(1.6); await page.waitForTimeout(1500);
  const pinch = (ratio) => page.evaluate(({ host, ratio }) => new Promise((res) => {
    const el = document.querySelector(host), r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ev = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: "touch", isPrimary: id === 1, clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1 }));
    if (!window.__pinching) { window.__pinching = true; ev("pointerdown", 1, cx - 50, cy); ev("pointerdown", 2, cx + 50, cy); window.__pinchD = 50; }
    const target = 50 * ratio, from = window.__pinchD; let i = 0;
    const step = () => { i++; const d = from + (target - from) * Math.min(1, i / 10); ev("pointermove", 1, cx - d, cy); ev("pointermove", 2, cx + d, cy); if (i < 10) requestAnimationFrame(step); else { window.__pinchD = d; setTimeout(res, 400); } };
    requestAnimationFrame(step);
  }), { host, ratio });
  await pinch(1.3); await page.screenshot({ path: `${OUT}/${name}-pinch1.3.png` });
  await pinch(1.55); await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/${name}-pinch1.55.png` });
  console.log("готово:", name);
  await ctx.close();
}
await browser.close();
