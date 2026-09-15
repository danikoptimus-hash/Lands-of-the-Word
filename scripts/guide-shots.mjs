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

ctx = await browser.newContext({ baseURL: BASE, ...phone }); page = await ctx.newPage();
await login(ctx, CAPTAIN);
await page.goto(`/games/${GAME}/team`); await page.waitForSelector(".map-svg"); await page.waitForTimeout(1800);
await shot(page, "map");
const zoomOut = page.locator('button[aria-label="Отдалить"]');
for (let i = 0; i < 3; i++) { await zoomOut.click(); await page.waitForTimeout(150); }
await page.waitForTimeout(800); await shot(page, "map-far");
for (let i = 0; i < 5; i++) { await zoomOut.click(); await page.waitForTimeout(150); }
await page.waitForTimeout(800); await shot(page, "islands");
await page.goto(`/games/${GAME}/team`); await page.waitForSelector(".map-svg"); await page.waitForTimeout(1800);
if (await clickIn(page, ".m-deed")) { await page.waitForTimeout(900); await shot(page, "deed"); }
await page.keyboard.press("Escape"); await page.waitForTimeout(500);
for (let i = 0; i < 2; i++) { await zoomOut.click(); await page.waitForTimeout(150); }
await page.waitForTimeout(800);
if (await clickIn(page, ".m-label")) { await page.waitForTimeout(1500); await shot(page, "city"); }
await page.keyboard.press("Escape"); await page.waitForTimeout(500);
await page.locator(".hud-left button").first().click(); await page.waitForTimeout(700); await shot(page, "menu");
await ctx.close();

ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5 }); page = await ctx.newPage();
await login(ctx, ADMIN);
await page.goto(`/games/${GAME}`); await page.waitForTimeout(1500); await shot(page, "admin-overview");
for (const [tab, name] of [["Команды", "admin-teams"], ["Дела", "admin-deeds"], ["Проверка", "admin-review"], ["Карта", "admin-map"]]) {
  await page.getByRole("tab", { name: tab }).or(page.getByRole("button", { name: tab })).first().click(); await page.waitForTimeout(1500); await shot(page, name);
}
await ctx.close();
await browser.close();
console.log("готово:", OUT);
