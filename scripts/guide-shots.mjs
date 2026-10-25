/**
 * Скриншоты для страницы «Как играть?» (apps/web/src/pages/HowToPlayPage.tsx).
 * Инструкция должна быть всегда свежей (решение владельца 15.09; переснято 24.10: «больше скринов, меньше текста»):
 * перед выкладкой, меняющей экраны игры, перегенерируйте картинки этим скриптом и закоммитьте их вместе с текстом.
 *
 * Запуск (из корня, при поднятом локальном сервере с тестовыми данными):
 *   GUIDE_BASE=http://localhost:3000 GUIDE_ADMIN=<ник администратора> GUIDE_CAPTAIN=<ник капитана> GUIDE_MEMBER=<ник участника> \
 *   GUIDE_GAME=<id игры с двумя островами> GUIDE_PASS=<пароль тестовых аккаунтов> node scripts/guide-shots.mjs
 * Ники и пароль — только из переменных окружения, в репозитории их нет. Нужен Playwright (devDependencies) и Chromium
 * (PW_CHROMIUM, по умолчанию /opt/pw-browsers/chromium). Для снимков заместителя, корабельного дела и салюта в базе
 * заранее помечают заместителя, одно свободное дело как морское и один город как взятый сейчас (временно, затем вернуть).
 * Картинки пишутся в apps/web/public/img/guide/*.png; затем `python3 scripts/guide-webp.py` сжимает их в webp.
 * Чтобы на снимке входа была кнопка «Войти через Google», локальный сервер запускают с непустыми GOOGLE_CLIENT_ID и
 * GOOGLE_CLIENT_SECRET. `?tod=day` / `?tod=night` и `?storm=1` — предпросмотр картинки, правил не меняют.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.env.GUIDE_BASE ?? "http://localhost:3000";
const ADMIN = process.env.GUIDE_ADMIN, CAPTAIN = process.env.GUIDE_CAPTAIN, MEMBER = process.env.GUIDE_MEMBER, GAME = process.env.GUIDE_GAME, PASS = process.env.GUIDE_PASS;
if (!ADMIN || !CAPTAIN || !MEMBER || !GAME || !PASS) { console.error("Нужны GUIDE_ADMIN, GUIDE_CAPTAIN, GUIDE_MEMBER, GUIDE_GAME, GUIDE_PASS"); process.exit(1); }
const OUT = new URL("../apps/web/public/img/guide/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const shot = (page, name) => page.screenshot({ path: OUT + name + ".png" });
const login = (ctx, nickname) => ctx.request.post(BASE + "/api/auth/login", { data: { nickname, password: PASS } });
const api = async (path, opts = {}, cookie = "") => { const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", cookie, ...(opts.headers ?? {}) } }); let b; try { b = await r.json(); } catch { b = null; } return { status: r.status, body: b, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "" }; };
const loginApi = async (n) => (await api("/api/auth/login", { method: "POST", body: JSON.stringify({ nickname: n, password: PASS }) })).cookie;
const clickIn = async (page, sel) => {
  const pt = await page.evaluate((s) => { for (const el of document.querySelectorAll(s)) { const b = el.getBoundingClientRect(); if (b.width && b.x > 20 && b.y > 120 && b.x + b.width < innerWidth - 20 && b.y + b.height < innerHeight - 90) return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; } return null; }, sel);
  if (!pt) { console.warn("не найден на экране:", sel); return false; }
  await page.mouse.click(pt.x, pt.y); return true;
};
const dispatch = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; }, sel);
const openMenu = async (page, tile) => { await page.locator(".hud-left button").first().click(); await page.waitForTimeout(600); if (tile) { await page.locator(".side-menu .menu-grid button", { hasText: tile }).first().click(); await page.waitForTimeout(900); } };
const teamPage = async (page, q = "?tod=day") => { await page.goto(`/games/${GAME}/team${q}`); await page.waitForSelector(".map-canvas canvas", { timeout: 30000 }); await page.waitForTimeout(1800); };
const zoomOut = async (page, n) => { const b = await page.locator(".map-canvas").first().boundingBox(); for (let i = 0; i < n; i++) { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.wheel(0, 240); await page.waitForTimeout(150); } await page.waitForTimeout(800); };

// Вход и главная.
let ctx = await browser.newContext({ baseURL: BASE, ...phone }); let page = await ctx.newPage();
// Вступление «о чём игра» на снимке входа не нужно: отметка «уже видел» ставится заранее.
await page.addInitScript(() => { try { localStorage.setItem("lotw.intro.seen", "1"); } catch {} });
await page.goto("/login"); await page.waitForTimeout(800); await shot(page, "login");
await ctx.close();
ctx = await browser.newContext({ baseURL: BASE, ...phone }); page = await ctx.newPage();
await login(ctx, CAPTAIN);
await page.goto("/"); await page.waitForTimeout(1500); await shot(page, "games");
await page.goto("/account"); await page.waitForTimeout(1200); await shot(page, "account");
await ctx.close();

// Метка на карте — через API капитана, на время снимка.
const capCookie = await loginApi(CAPTAIN);
const myMap = (await api(`/api/games/${GAME}/my-map`, {}, capCookie)).body;
const markHex = myMap.hexes.find((h) => h.q === -1 && h.r === 0) ?? myMap.hexes.find((h) => h.lit !== false) ?? myMap.hexes[0];
const mark = await api(`/api/games/${GAME}/my-map/marks`, { method: "POST", body: JSON.stringify({ q: markHex.q, r: markHex.r, qf: markHex.q + 0.15, rf: markHex.r + 0.5, note: "птицы сели здесь" }) }, capCookie);

// Карта и меню глазами капитана.
ctx = await browser.newContext({ baseURL: BASE, ...phone }); page = await ctx.newPage();
await login(ctx, CAPTAIN);
await teamPage(page); await shot(page, "map");
await zoomOut(page, 3); await shot(page, "map-far");
await zoomOut(page, 5); await shot(page, "islands");
await teamPage(page);
if (await clickIn(page, ".m-deed")) { await page.waitForTimeout(900); await shot(page, "deed"); }
await page.keyboard.press("Escape"); await page.waitForTimeout(500);
await zoomOut(page, 2);
if (await dispatch(page, ".m-label:not(.start)")) { await page.waitForTimeout(1500); await shot(page, "city"); } else console.warn("не найден: .m-label");
if (await page.locator(".district").count()) { await page.locator(".district").first().click(); await page.waitForTimeout(900); await shot(page, "city-task"); }
await page.keyboard.press("Escape"); await page.waitForTimeout(500);
await teamPage(page);
if (await dispatch(page, ".m-quarry")) { await page.waitForTimeout(1500); await shot(page, "quarry"); }
await page.keyboard.press("Escape"); await page.waitForTimeout(500);
await teamPage(page);
await openMenu(page, null); await shot(page, "menu");
await page.locator(".side-menu .menu-grid button", { hasText: "Дела" }).first().click(); await page.waitForTimeout(900); await shot(page, "deeds-list");
// Ночью «Взять» показывает подсказку окошком; если сейчас день — окошка нет, снимок будет без него.
const take = page.locator(".take-slot button").first();
if (await take.count()) { await take.click(); await page.waitForTimeout(500); if (await page.locator(".help-pop").count()) await shot(page, "deeds-night"); await page.keyboard.press("Escape"); await page.waitForTimeout(300); }
await page.locator(".menu-sub button").first().click().catch(() => {}); await page.waitForTimeout(400);
await page.locator(".side-menu .menu-grid button", { hasText: "Команды" }).first().click(); await page.waitForTimeout(900);
const more = page.locator(".standing .peace-slot button").first();
if (await more.count()) { await more.click(); await page.waitForTimeout(400); await shot(page, "standings"); await page.keyboard.press("Escape"); await page.waitForTimeout(300); } else await shot(page, "standings");
const mine = page.locator(".standing.expandable", { hasText: "мы" }).first();
if (await mine.count() && (await mine.getAttribute("aria-expanded")) !== "true") { await mine.click({ force: true }); await page.waitForTimeout(500); }
if (await page.locator(".role-pick").count()) { await page.locator(".role-pick").first().click(); await page.waitForTimeout(400); }
await page.locator(".roster").first().scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(300); await shot(page, "roster");
await page.locator(".menu-sub button").first().click().catch(() => {}); await page.waitForTimeout(400);
await page.locator(".side-menu .menu-grid button", { hasText: "Летопись" }).first().click(); await page.waitForTimeout(1200); await shot(page, "feed");
await page.locator(".menu-sub button").first().click().catch(() => {}); await page.waitForTimeout(400);
await page.locator(".side-menu .menu-grid button", { hasText: "Моё служение" }).first().click(); await page.waitForTimeout(1200); await shot(page, "service");
await ctx.close();
if (mark.body?.mark?.id) await api(`/api/games/${GAME}/my-map/marks/${mark.body.mark.id}`, { method: "DELETE", body: "{}" }, capCookie);

// Ночь, шторм, салют — глазами участника.
ctx = await browser.newContext({ baseURL: BASE, ...phone }); page = await ctx.newPage();
await login(ctx, MEMBER);
await teamPage(page, "?tod=night"); await shot(page, "night");
const label = page.locator(".m-label text", { hasText: /^Руфь/ }).first(); const bb = await label.boundingBox().catch(() => null);
if (bb) { await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(195, 430, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(2600); await shot(page, "fireworks"); }
await teamPage(page, "?storm=1"); await page.waitForTimeout(4500); await shot(page, "storm");
await ctx.close();

// Администратор: карта во весь экран, разделы — кнопки дока.
ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5 }); page = await ctx.newPage();
await login(ctx, ADMIN);
await page.goto(`/games/${GAME}?tod=day`); await page.waitForSelector(".map-svg"); await page.waitForTimeout(2500); await shot(page, "admin-map");
for (const [tab, name] of [["Летопись", "admin-overview"], ["Команды", "admin-teams"], ["Дела", "admin-deeds"], ["Проверка", "admin-review"], ["Аналитика", "admin-analytics"], ["Настройки", "admin-settings"]]) {
  await page.locator(".admin-dock .dock-btn", { hasText: tab }).click(); await page.waitForTimeout(1800);
  if (name === "admin-teams" && (await page.locator(".team-head").count())) { await page.locator(".team-head").first().click(); await page.waitForTimeout(500); }
  if (name === "admin-settings") { await page.locator(".storm-row, .settings-group h3", { hasText: /Шторм/ }).first().scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(300); }
  await shot(page, name);
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
}
await page.goto(`/games/${GAME}/labels`); await page.waitForTimeout(1500); await shot(page, "admin-labels");
await ctx.close();
await browser.close();
console.log("готово:", OUT);
