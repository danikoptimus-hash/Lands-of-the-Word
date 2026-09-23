/**
 * Скриншоты для страницы «Как играть?» (apps/web/src/pages/HowToPlayPage.tsx).
 * Инструкция должна быть всегда свежей (решение владельца 15.09): перед выкладкой, меняющей экраны игры,
 * перегенерируйте картинки этим скриптом и закоммитьте их вместе с правкой текста инструкции.
 *
 * Запуск (из корня, при поднятом локальном сервере с тестовыми данными):
 *   GUIDE_BASE=http://localhost:3000 GUIDE_ADMIN=<ник администратора> GUIDE_CAPTAIN=<ник капитана> \
 *   GUIDE_GAME=<id игры с двумя островами> GUIDE_PASS=<пароль тестовых аккаунтов> node scripts/guide-shots.mjs
 * Ники и пароль берутся только из переменных окружения — в репозитории их нет. Нужен Playwright (есть в devDependencies)
 * и Chromium (переменная PW_CHROMIUM, по умолчанию /opt/pw-browsers/chromium).
 * Картинки пишутся в apps/web/public/img/guide/*.png; затем `python3 scripts/guide-webp.py` сжимает их в webp.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = process.env.GUIDE_BASE ?? "http://localhost:3000";
const ADMIN = process.env.GUIDE_ADMIN, CAPTAIN = process.env.GUIDE_CAPTAIN, GAME = process.env.GUIDE_GAME, PASS = process.env.GUIDE_PASS;
if (!ADMIN || !CAPTAIN || !GAME || !PASS) { console.error("Нужны GUIDE_ADMIN, GUIDE_CAPTAIN, GUIDE_GAME, GUIDE_PASS"); process.exit(1); }
const OUT = new URL("../apps/web/public/img/guide/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const shot = (page, name) => page.screenshot({ path: OUT + name + ".png" });
const login = (ctx, nickname) => ctx.request.post(BASE + "/api/auth/login", { data: { nickname, password: PASS } });
/** Нажать первый элемент по селектору, целиком видимый на экране (карта — SVG, обычный click скроллит мимо). */
const clickIn = async (page, sel) => {
  const pt = await page.evaluate((s) => { for (const el of document.querySelectorAll(s)) { const b = el.getBoundingClientRect(); if (b.width && b.x > 20 && b.y > 120 && b.x + b.width < innerWidth - 20 && b.y + b.height < innerHeight - 120) return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; } return null; }, sel);
  if (!pt) { console.warn("не найден на экране:", sel); return false; }
  await page.mouse.click(pt.x, pt.y); return true;
};

let ctx = await browser.newContext({ baseURL: BASE, ...phone }); let page = await ctx.newPage();
await page.goto("/login"); await page.waitForTimeout(800); await shot(page, "login");
await ctx.close();

ctx = await browser.newContext({ baseURL: BASE, ...phone }); page = await ctx.newPage();
await login(ctx, ADMIN);
await page.goto("/"); await page.waitForTimeout(1200); await shot(page, "games");
await ctx.close();

// Участник-фикстура (GUIDE_MEMBER, по умолчанию <капитан>_m) для снимков состава с ролями и метка на карте для снимка карты.
const MEMBER = process.env.GUIDE_MEMBER ?? `${CAPTAIN}_m`;
const api = async (path, opts = {}, cookie = "") => { const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", cookie, ...(opts.headers ?? {}) } }); let b; try { b = await r.json(); } catch { b = null; } return { status: r.status, body: b, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] }; };
const loginApi = async (n) => (await api("/api/auth/login", { method: "POST", body: JSON.stringify({ nickname: n, password: PASS }) })).cookie;
const capCookie = await loginApi(CAPTAIN);
let memCookie = await loginApi(MEMBER);
if (!memCookie) memCookie = (await api("/api/auth/register", { method: "POST", body: JSON.stringify({ nickname: MEMBER, password: PASS, email: `${MEMBER}@example.com` }) })).cookie;
let teams = (await api(`/api/games/${GAME}/teams`, {}, capCookie)).body.teams;
let myTeam = teams.find((tm) => tm.members.some((m) => m.user.nickname === CAPTAIN));
if (myTeam && !myTeam.members.some((m) => m.user.nickname === MEMBER)) {
  const inv = await api(`/api/games/${GAME}/teams/${myTeam.id}/invites`, { method: "POST", body: JSON.stringify({ role: "MEMBER" }) }, capCookie);
  await api(`/api/invites/${inv.body.invite.token}/accept`, { method: "POST", body: "{}" }, memCookie);
  teams = (await api(`/api/games/${GAME}/teams`, {}, capCookie)).body.teams; myTeam = teams.find((tm) => tm.id === myTeam.id);
}
const mem = myTeam?.members.find((m) => m.user.nickname === MEMBER);
if (mem && mem.gameRole === "NONE") await api(`/api/games/${GAME}/teams/${myTeam.id}/members/${mem.user.id}`, { method: "PATCH", body: JSON.stringify({ gameRole: "SCOUT" }) }, capCookie);
const myMap = (await api(`/api/games/${GAME}/my-map`, {}, capCookie)).body;
const markHex = myMap.hexes.find((h) => h.q === -3 && h.r === 0) ?? myMap.hexes.find((h) => h.lit !== false) ?? myMap.hexes[0];
const mark = await api(`/api/games/${GAME}/my-map/marks`, { method: "POST", body: JSON.stringify({ q: markHex.q, r: markHex.r, note: "птицы сели здесь" }) }, capCookie);

ctx = await browser.newContext({ baseURL: BASE, ...phone }); page = await ctx.newPage();
await login(ctx, CAPTAIN);
await page.goto(`/games/${GAME}/team`); await page.waitForSelector(".map-svg"); await page.waitForTimeout(1800);
await shot(page, "map");
// Кнопок «+/−» на карте нет (решение владельца 20.09): отдаляем колёсиком над центром карты.
const zoomOut = { click: async () => { const b = await page.locator(".map-svg").first().boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.wheel(0, 240); } };
for (let i = 0; i < 3; i++) { await zoomOut.click(); await page.waitForTimeout(150); }
await page.waitForTimeout(800); await shot(page, "map-far");
for (let i = 0; i < 5; i++) { await zoomOut.click(); await page.waitForTimeout(150); }
await page.waitForTimeout(800); await shot(page, "islands");
await page.goto(`/games/${GAME}/team`); await page.waitForSelector(".map-svg"); await page.waitForTimeout(1800);
if (await clickIn(page, ".m-deed")) { await page.waitForTimeout(900); await shot(page, "deed"); }
await page.keyboard.press("Escape"); await page.waitForTimeout(500);
for (let i = 0; i < 2; i++) { await zoomOut.click(); await page.waitForTimeout(150); }
await page.waitForTimeout(800);
// Подпись города может перекрывать значок дела на стороне — кликаем сам элемент подписи, а не точку экрана.
if (await page.evaluate(() => { const el = document.querySelector(".m-label:not(.start)"); if (!el) return false; el.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; })) { await page.waitForTimeout(1500); await shot(page, "city"); }
else console.warn("не найден: .m-label");
// Задание района: страница задания с формой ответа (и свечой пророка, если капитан — пророк в фикстуре).
if (await page.locator(".district").count()) { await page.locator(".district").first().click(); await page.waitForTimeout(900); await shot(page, "city-task"); }
await page.keyboard.press("Escape"); await page.waitForTimeout(500);
await page.locator(".hud-left button").first().click(); await page.waitForTimeout(700); await shot(page, "menu");
// Состав своей команды с рядом ролей (раздел «Команды», строка своей команды раскрыта).
const teamsTile = page.locator(".side-menu .menu-grid button", { hasText: "Команды" }).first();
if (await teamsTile.count()) {
  await teamsTile.click(); await page.waitForTimeout(700);
  const mine = page.locator(".standing.expandable", { hasText: "мы" }).first();
  if (await mine.count() && (await mine.getAttribute("aria-expanded")) !== "true") { await mine.click({ force: true }); await page.waitForTimeout(500); }
  if (await page.locator(".role-pick").count()) { await page.locator(".role-pick").first().click(); await page.waitForTimeout(400); }
  await shot(page, "roster");
}
await ctx.close();
if (mark.body?.mark?.id) await api(`/api/games/${GAME}/my-map/marks/${mark.body.mark.id}`, { method: "DELETE" }, capCookie);

ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5 }); page = await ctx.newPage();
await login(ctx, ADMIN);
// Экран администратора: карта во весь экран, разделы — кнопки дока, содержимое — попап над картой.
await page.goto(`/games/${GAME}`); await page.waitForSelector(".map-svg"); await page.waitForTimeout(1800); await shot(page, "admin-map");
for (const [tab, name] of [["Летопись", "admin-overview"], ["Команды", "admin-teams"], ["Дела", "admin-deeds"], ["Проверка", "admin-review"], ["Настройки", "admin-settings"]]) {
  await page.locator(".admin-dock .dock-btn", { hasText: tab }).click(); await page.waitForTimeout(1500);
  // Блок «Команды»: строка команды раскрыта — видны участники, приглашения и роли.
  if (name === "admin-teams" && (await page.locator(".team-head").count())) { await page.locator(".team-head").first().click(); await page.waitForTimeout(500); }
  await shot(page, name);
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
}
await page.goto(`/games/${GAME}/labels`); await page.waitForTimeout(1500); await shot(page, "admin-labels");
await ctx.close();
await browser.close();
console.log("готово:", OUT);
