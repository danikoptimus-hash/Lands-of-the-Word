/**
 * Обход всех экранов игры для отчёта «было/стало» (решение владельца 18.09): снимки игрока (телефон) и администратора
 * (компьютер) на локальном стенде с данными тестовой партии. Запуск:
 *   UI_BASE=http://localhost:3000 UI_GAME=<id партии> UI_ADMIN=<ник администратора> UI_PLAYER=<ник участника>
 *   UI_PLAYER2=<ник участника другой команды> UI_PASS=<пароль> UI_OUT=<папка> node scripts/ui-tour.mjs
 * Ники и пароль — только в переменных окружения. Каждый снимок — отдельная попытка: сбой одного не останавливает обход.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const BASE = process.env.UI_BASE ?? "http://localhost:3000", GAME = process.env.UI_GAME, ADMIN = process.env.UI_ADMIN, P1 = process.env.UI_PLAYER, P2 = process.env.UI_PLAYER2, PASS = process.env.UI_PASS, OUT = process.env.UI_OUT ?? "ui-tour";
if (!GAME || !ADMIN || !P1 || !PASS) { console.error("Нужны UI_GAME, UI_ADMIN, UI_PLAYER, UI_PASS"); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const desk = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 };
const ctxs = new Map();
async function ctxFor(nick, kind) {
  const key = nick + kind; if (ctxs.has(key)) return ctxs.get(key);
  const ctx = await browser.newContext({ baseURL: BASE, ...(kind === "desk" ? desk : phone), locale: "ru-RU" });
  if (nick) { const r = await ctx.request.post(BASE + "/api/auth/login", { data: { nickname: nick, password: PASS } }); if (!r.ok()) console.error("вход", nick, r.status()); }
  ctxs.set(key, ctx); return ctx;
}
const log = [];
let n = 0;
async function shot(nick, kind, path, name, caption, act, opts = {}) {
  const ctx = await ctxFor(nick, kind); const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (x) => errors.push(x.message));
  const file = `${String(++n).padStart(2, "0")}-${name}.png`;
  try {
    await page.goto(path); await page.waitForTimeout(kind === "desk" ? 1800 : 1400);
    if (act) await act(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, file), fullPage: !!opts.full });
    log.push({ file, name, caption, who: nick ?? "гость", kind, ok: true, errors });
    console.log("✓", file);
  } catch (e) { log.push({ file, name, caption, who: nick ?? "гость", kind, ok: false, error: String(e).slice(0, 200) }); console.log("✗", file, String(e).slice(0, 120)); }
  finally { await page.close(); }
}
const waitMap = async (p) => { await p.waitForSelector(".map-svg", { timeout: 15000 }); await p.waitForTimeout(800); };
const openMenu = async (p) => { await waitMap(p); await p.locator(".hud-left button").first().click(); await p.waitForTimeout(800); };
const openCity = (book) => async (p) => { await waitMap(p); const ok = await p.evaluate((b) => { for (const el of document.querySelectorAll(".m-label")) if (el.textContent?.includes(b)) { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; } return false; }, book); if (!ok) throw new Error("нет города " + book); await p.waitForSelector(".city-sheet"); await p.waitForTimeout(900); };
const openDeed = async (p) => { await waitMap(p); await p.evaluate(() => { const el = document.querySelector(".m-deed.taken, .m-deed"); el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await p.waitForTimeout(900); };
const adminTab = (tab) => async (p) => { await waitMap(p); await p.locator(".admin-dock .dock-btn", { hasText: tab }).click(); await p.waitForTimeout(1500); };
const disclose = (text) => async (p) => { const s = p.locator("details.disclose summary", { hasText: text }); if (await s.count()) { await s.first().click(); await p.waitForTimeout(700); } };
const T = `/games/${GAME}/team`, G = `/games/${GAME}`;

// Гость.
await shot(null, "phone", "/login", "login", "Вход");
await shot(null, "phone", "/how-to-play", "how-to-play", "Как играть (начало)");
// Игрок.
await shot(P1, "phone", "/", "games", "Мои игры");
await shot(P1, "phone", T, "map", "Карта команды", waitMap);
await shot(P1, "phone", T, "menu", "Меню команды (вся высота)", openMenu, { full: true });
await shot(P1, "phone", T, "deed", "Карточка дела", openDeed, { full: true });
await shot(P1, "phone", T, "city-order", "Город: порядок районов (замок)", openCity("Даниил"), { full: true });
await shot(P2 ?? P1, "phone", T, "city-districts", "Город: районы", openCity("Судьи"), { full: true });
await shot(P2 ?? P1, "phone", T, "city-task", "Город: задание района", async (p) => { await openCity("Судьи")(p); await p.locator(".district").nth(6).click(); await p.waitForTimeout(800); }, { full: true });
await shot(P1, "phone", T, "city-envelope", "Город: конверт с ключом", openCity("Есфирь"), { full: true });
await shot(P1, "phone", T, "city-captured", "Город взят: грамота и испытание", async (p) => { await openCity("Руфь")(p); await disclose("Испытание")(p); }, { full: true });
await shot(P1, "phone", "/account", "account", "Аккаунт", null, { full: true });
await shot(P1, "phone", "/whats-new", "whats-new", "Что нового");
// Администратор.
await shot(ADMIN, "desk", G, "admin-map", "Администратор: карта", waitMap);
for (const [tab, name] of [["Обзор", "admin-overview"], ["Команды", "admin-teams"], ["Дела", "admin-deeds"], ["Проверка", "admin-review"], ["Настройки", "admin-settings"]]) await shot(ADMIN, "desk", G, name, `Администратор: ${tab}`, adminTab(tab), { full: true });
await shot(ADMIN, "desk", `${G}/book`, "admin-season-book", "Книга сезона", null, { full: true });
await shot(ADMIN, "desk", `${G}/labels`, "admin-labels", "Ярлыки конвертов");
await shot(ADMIN, "desk", "/", "admin-games", "Мои игры (компьютер)");
await shot(ADMIN, "desk", "/games/new", "admin-new-game", "Новая игра");
await shot(ADMIN, "desk", "/admin", "admin-platform", "Администратор платформы", null, { full: true });
await shot(ADMIN, "phone", G, "admin-map-phone", "Администратор на телефоне: карта", waitMap);
await shot(ADMIN, "phone", G, "admin-review-phone", "Администратор на телефоне: проверка", adminTab("Проверка"), { full: true });
writeFileSync(join(OUT, "tour.json"), JSON.stringify(log, null, 2));
await browser.close();
console.log(`снимков: ${log.filter((x) => x.ok).length}, сбоев: ${log.filter((x) => !x.ok).length}`);
