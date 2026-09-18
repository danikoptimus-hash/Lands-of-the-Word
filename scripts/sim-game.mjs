/**
 * Тестовая партия с ботами: три команды по шесть участников проходят все механики игры в ускоренном режиме,
 * а скрипт снимает экраны игроков (телефон) и администратора (компьютер) и пишет отчёт.
 *
 * Запуск (аккаунты tg_admin, tg_m1..6, tg_b1..6, tg_p1..6 уже должны существовать с подтверждённой почтой;
 * tg_admin — администратор платформы, иначе часть тестовых действий пропускается):
 *   SIM_BASE=http://localhost:3000 SIM_PASS=<пароль ботов> SIM_OUT=docs/reports/test-game-2026-09-18 node scripts/sim-game.mjs
 * Локально можно задать SIM_REGISTER=1 — аккаунты будут созданы (без SMTP почта подтверждается сразу).
 * Ники и пароль в репозитории не хранятся. Реальных людей в партии нет: команды «Моряки», «Берег», «Пустыня».
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOOKS } from "@lotw/domain";

const BASE = process.env.SIM_BASE ?? "http://localhost:3000";
const PASS = process.env.SIM_PASS;
const OUT = process.env.SIM_OUT ?? "docs/reports/test-game";
const REGISTER = process.env.SIM_REGISTER === "1";
const SKIP_SLOW = process.env.SIM_FAST === "1";
if (!PASS) { console.error("Нужен SIM_PASS"); process.exit(1); }
const IMG = join(OUT, "img");
mkdirSync(IMG, { recursive: true });
const CONTENT = new URL("../content/cities/", import.meta.url).pathname;

const TEAMS = { M: { name: "Моряки", nicks: ["tg_m1", "tg_m2", "tg_m3", "tg_m4", "tg_m5", "tg_m6"] }, B: { name: "Берег", nicks: ["tg_b1", "tg_b2", "tg_b3", "tg_b4", "tg_b5", "tg_b6"] }, P: { name: "Пустыня", nicks: ["tg_p1", "tg_p2", "tg_p3", "tg_p4", "tg_p5", "tg_p6"] } };
const ADMIN = "tg_admin";
const ALL = [ADMIN, ...Object.values(TEAMS).flatMap((t) => t.nicks)];
const cookies = new Map();
const S = { gameId: "", teams: {}, users: {}, superadmin: false, nodes: [], edges: [], adj: new Map(), t0: Date.now() };
const report = []; const failures = []; const log = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (s) => { const line = `[${((Date.now() - S.t0) / 60000).toFixed(1)} мин] ${s}`; console.log(line); log.push(line); };

/* ---------- API ---------- */
async function raw(nick, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie: cookies.get(nick) ?? "" }, body: body === undefined ? (method === "POST" ? "{}" : undefined) : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
async function api(nick, method, path, body) {
  const r = await raw(nick, method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${typeof r.body === "string" ? r.body.slice(0, 120) : r.body?.message ?? JSON.stringify(r.body).slice(0, 160)}`);
  return r.body;
}
const get = (nick, path) => api(nick, "GET", path);
const post = (nick, path, body) => api(nick, "POST", path, body);
async function login(nick) {
  const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: nick, password: PASS }) });
  if (r.status !== 200) throw new Error(`login ${nick}: ${r.status}`);
  cookies.set(nick, (r.headers.get("set-cookie") ?? "").split(";")[0]);
}
async function step(title, fn) {
  say(`▶ ${title}`);
  try { await fn(); } catch (e) { const msg = e instanceof Error ? e.message : String(e); say(`✗ ${title}: ${msg}`); failures.push({ title, error: msg }); }
}

/* ---------- Снимки экрана ---------- */
let browser; const ctxs = new Map(); let shotN = 0;
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const desk = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 };
async function ctxFor(nick) {
  if (ctxs.has(nick)) return ctxs.get(nick);
  const ctx = await browser.newContext({ baseURL: BASE, ...(nick === ADMIN ? desk : phone) });
  // Сессия из уже сделанного входа: повторный вход упёрся бы в лимит попыток (20 в минуту на адрес).
  const [name, ...rest] = (cookies.get(nick) ?? "").split("="); const u = new URL(BASE);
  await ctx.addCookies([{ name, value: rest.join("="), domain: u.hostname, path: "/", httpOnly: true, secure: u.protocol === "https:", sameSite: "Lax" }]);
  ctxs.set(nick, ctx); return ctx;
}
function entry(phase, title, text) { const e = { phase, title, text, shots: [] }; report.push(e); return e; }
/** Снимок страницы: file — имя без расширения. */
async function snap(e, nick, path, name, caption, act) {
  const ctx = await ctxFor(nick); const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (x) => errors.push(x.message));
  try {
    await page.goto(path); await page.waitForTimeout(nick === ADMIN ? 1800 : 1500);
    if (act) await act(page);
    await page.waitForTimeout(500);
    const file = `${String(++shotN).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: join(IMG, file) });
    e.shots.push({ file, caption, who: nick });
    if (errors.length) failures.push({ title: `ошибка в браузере на снимке ${file}`, error: errors.join(" | ").slice(0, 300) });
    return page;
  } catch (err) { failures.push({ title: `снимок ${name} (${nick})`, error: String(err).slice(0, 200) }); }
  finally { await page.close(); }
}
const openMenu = async (page) => { await page.locator(".hud-left button").first().click(); await page.waitForTimeout(700); };
const openCity = (book) => async (page) => { await page.waitForSelector(".map-svg"); const ok = await page.evaluate((b) => { for (const el of document.querySelectorAll(".m-label")) if (el.textContent?.includes(b)) { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); return true; } return false; }, book); if (!ok) throw new Error("нет подписи города " + book); await page.waitForSelector(".city-sheet"); await page.waitForTimeout(700); };
const adminTab = (tab) => async (page) => { await page.waitForSelector(".map-svg"); await page.locator(".admin-dock .dock-btn", { hasText: tab }).click(); await page.waitForTimeout(1200); };
const scrollTo = (text) => async (page) => { await page.evaluate((tx) => { const h = [...document.querySelectorAll("h2,h3,summary")].find((x) => x.textContent?.includes(tx)); if (!h) return; h.scrollIntoView({ block: "start" }); let el = h.parentElement; while (el && el !== document.body) { if (el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== "visible") { el.scrollTop -= 96; break; } el = el.parentElement; } window.scrollBy(0, -96); }, text); await page.waitForTimeout(300); };

/* ---------- Карта (знание администратора) ---------- */
const bookName = (code) => BOOKS.find((b) => b.code === code)?.nameRu ?? code;
async function loadWorld() {
  const g = await get(ADMIN, `/api/games/${S.gameId}`);
  S.nodes = g.nodes; S.edges = g.edges; S.game = g.game;
  S.adj = new Map();
  for (const e of g.edges) { S.adj.set(e.aKey, [...(S.adj.get(e.aKey) ?? []), e.bKey]); S.adj.set(e.bKey, [...(S.adj.get(e.bKey) ?? []), e.aKey]); }
}
const nodeOf = (key) => S.nodes.find((n) => n.key === key);
function distances(from) {
  const d = new Map([[from, 0]]); const q = [from];
  while (q.length) { const k = q.shift(); for (const n of S.adj.get(k) ?? []) if (!d.has(n)) { d.set(n, d.get(k) + 1); q.push(n); } }
  return d;
}
/** Расстояние от узла до ближайшего города (не морской переход). */
function toNearestCity(key, exclude = new Set()) {
  const d = distances(key); let best = Infinity, target = null;
  for (const n of S.nodes) if (n.kind === "CITY" && !exclude.has(n.key) && d.has(n.key) && d.get(n.key) < best) { best = d.get(n.key); target = n.key; }
  return { dist: best, target };
}
const isSea = (k) => k.startsWith("SEA:") || k.startsWith("sea:");
const content = (book) => JSON.parse(readFileSync(join(CONTENT, book + ".json"), "utf8"));

/* ---------- Команда: люди и дела ---------- */
const cap = (T) => TEAMS[T].nicks[0];
/** Текущий состав (после переводов участников администратором состав меняется). */
const members = (T) => (S.teams[T]?.members?.length ? S.teams[T].members.map((m) => m.user.nickname) : TEAMS[T].nicks);
const memberAt = (T, i) => { const ms = members(T); return ms[i % ms.length]; };
const userId = (nick) => S.users[nick];
async function refreshTeams() {
  const r = await get(ADMIN, `/api/games/${S.gameId}/teams`);
  for (const t of r.teams) { const key = Object.keys(TEAMS).find((k) => TEAMS[k].name === t.name); if (key) { S.teams[key] = t; for (const m of t.members) S.users[m.user.nickname] = m.user.id; } }
}
const myMap = (nick) => get(nick, `/api/games/${S.gameId}/my-map`);

/** Один шаг по делам: взять дело в сторону ближайшего города, сдать группой, администратор одобряет. */
async function doDeed(T, i, opts = {}) {
  const who = memberAt(T, i);
  const m = await myMap(cap(T));
  const owned = new Set((m.cities ?? []).filter((c) => c.captured).map((c) => c.nodeKey));
  const open = m.tasks.filter((t) => t.status === "OPEN" && !t.sea);
  if (!open.length) return null;
  const scored = open.map((t) => ({ t, ...toNearestCity(t.toKey, owned) })).sort((a, b) => a.dist - b.dist);
  const pick = (opts.pick ?? ((xs) => xs[0]))(scored).t;
  await post(who, `/api/games/${S.gameId}/edge-tasks/${pick.id}/take`);
  const mates = members(T).filter((n) => n !== who).slice(0, 2).map(userId);
  const links = pick.deed.proofType === "VIDEO_LINK" ? ["https://example.com/video/" + pick.id] : ["https://example.com/photo/" + pick.id];
  const note = pick.deed.proofType === "REPORT" ? "Что сделали: сходили и помогли. Кому: соседям. Что услышали: благодарность." : "Сделали вместе, фото приложено.";
  await post(who, `/api/games/${S.gameId}/edge-tasks/${pick.id}/submit`, { links, note, participants: mates });
  if (opts.noApprove) return pick;
  if (opts.returnFirst) {
    await post(ADMIN, `/api/games/${S.gameId}/edge-tasks/${pick.id}/decide`, { approve: false, comment: "Не видно людей на фото: добавьте ещё одно" });
    await post(who, `/api/games/${S.gameId}/edge-tasks/${pick.id}/submit`, { links: [...links, "https://example.com/photo/again-" + pick.id], note: note + " Добавили второе фото.", participants: mates });
  }
  await post(ADMIN, `/api/games/${S.gameId}/edge-tasks/${pick.id}/decide`, { approve: true });
  return pick;
}
/** Идти делами, пока команда не дойдёт до города (или до предела шагов). Возвращает ключ города. */
async function reachCity(T, max = 8) {
  for (let i = 0; i < max; i++) {
    const m = await myMap(cap(T));
    const city = m.revealed.find((n) => n.kind === "CITY" && !(m.cities ?? []).find((c) => c.nodeKey === n.key && c.captured));
    if (city) return city.key;
    if (!(await doDeed(T, i))) break;
  }
  const m = await myMap(cap(T));
  return m.revealed.find((n) => n.kind === "CITY")?.key ?? null;
}
/** Тестовое действие суперадмина: открыть узел команде (если tg_admin — суперадмин). */
async function reveal(T, key) {
  if (!S.superadmin) throw new Error("tg_admin не суперадмин: нельзя открыть узел командe");
  const r = await raw(ADMIN, "POST", `/api/games/${S.gameId}/teams/${S.teams[T].id}/reveal`, { nodeKey: key });
  if (r.status >= 400 && r.status !== 409) throw new Error(`reveal ${key}: ${r.status} ${r.body?.message ?? ""}`);
}

/* ---------- Город ---------- */
const rulesFast = { minBid: 10, attackDays: 0.006, burnPenalty: 5, minAnswerSeconds: 120, passageDays: 0.01, lockWeeks: 0.0008, fatigueAfterDays: 0.01, fatigueStepDays: 0.002, fatigueStep: 1, deedReturnDays: 0.004, roleChangeDays: 0, roleCooldownDays: 0.001, pauseSteps: [3, 5, 10], siegeDays: 0.004, siegeDeedPoints: 1, chronicleWeekday: 0, chronicleHourUtc: 0, adminDigest: "instant" };
async function cityView(nick, key) { return get(nick, `/api/games/${S.gameId}/my-city/${encodeURIComponent(key)}`); }
function answerFor(src, pub) {
  if (src.type === "number") return String(src.answer);
  if (src.type === "text") return src.answers[0];
  if (src.type === "choice") return pub.options.indexOf(src.options[src.correct]);
  if (src.type === "order") return src.items.map((text) => pub.items.find((i) => i.text === text).id);
  if (src.type === "crossword") return pub.words.map((w) => src.words.find((x) => x.clue === w.clue).answer);
  return "";
}
/** Решить город: порядок районов, все задания (по очереди участниками), с одной ошибкой для паузы. */
async function solveCity(T, key, opts = {}) {
  const book = nodeOf(key).bookCode; const src = content(book);
  let c = await cityView(cap(T), key);
  if (!c.content) throw new Error("город без контента " + book);
  if (!c.state.orderSolved) {
    // Сначала заведомо неверный порядок (штифты), затем верный.
    const ids = src.districts.map((d) => c.content.districts.find((x) => x.title === d.title).id);
    if (opts.wrongFirst) { const w = ids.slice().reverse(); await post(cap(T), `/api/games/${S.gameId}/my-city/${encodeURIComponent(key)}/order`, { ids: w }); if (opts.afterWrongOrder) await opts.afterWrongOrder(); }
    await post(cap(T), `/api/games/${S.gameId}/my-city/${encodeURIComponent(key)}/order`, { ids });
    if (opts.afterOrder) await opts.afterOrder();
    c = await cityView(cap(T), key);
  }
  for (const pub of c.content.tasks) {
    if (c.state.doneTasks.includes(pub.index)) continue;
    const who = memberAt(T, pub.index);
    if (opts.beforeTask) await opts.beforeTask(pub, who);
    if (opts.wrongOn === pub.type) {
      const wrong = pub.type === "choice" ? (answerFor(src.tasks[pub.index], pub) + 1) % pub.options.length : pub.type === "number" ? "9999" : pub.type === "text" ? "неверно" : pub.type === "order" ? pub.items.map((i) => i.id).reverse() : pub.words.map(() => "абв");
      await post(who, `/api/games/${S.gameId}/my-city/${encodeURIComponent(key)}/tasks/${pub.index}/answer`, { answer: wrong });
      if (opts.afterWrong) await opts.afterWrong(pub, who);
      await sleep(rulesFast.pauseSteps[0] * 1000 + 800);
      opts.wrongOn = null;
    }
    await post(who, `/api/games/${S.gameId}/my-city/${encodeURIComponent(key)}/tasks/${pub.index}/answer`, { answer: answerFor(src.tasks[pub.index], pub) });
  }
  return book;
}
async function cityKey(key) { return (await get(ADMIN, `/api/games/${S.gameId}/cities/${encodeURIComponent(key)}`)).node.cityKey; }
async function capture(T, key, nick = cap(T)) { return post(nick, `/api/games/${S.gameId}/my-city/${encodeURIComponent(key)}/capture`, { key: await cityKey(key) }); }

/* ---------- Испытания ---------- */
async function adminBattle(id) { return (await get(ADMIN, `/api/games/${S.gameId}/battles`)).battles.find((b) => b.id === id); }
async function approveEntries(id, side) {
  const b = await adminBattle(id);
  for (const e of b.entries.filter((x) => x.side === side && x.status === "SUBMITTED")) await post(ADMIN, `/api/games/${S.gameId}/battles/${id}/entries/${e.id}/decide`, { approve: true });
}
async function refOf(bookInfo, idx) { let i = idx; for (let ch = 0; ch < bookInfo.verseCounts.length; ch++) { if (i < bookInfo.verseCounts[ch]) return `${ch + 1}:${i + 1}`; i -= bookInfo.verseCounts[ch]; } return null; }
/** Претенденты учат ставку (по частям участниками), отправляют; администратор принимает. */
async function attackPhase(A, id, bid, beforeApprove) {
  const mine = (await get(cap(A), `/api/games/${S.gameId}/my-battles`)).battles.find((b) => b.id === id);
  const start = mine.passage.start, per = Math.ceil(bid / 3);
  const ms = members(A);
  for (let k = 0; k < 3; k++) { const vs = Array.from({ length: per }, (_, i) => start + k * per + i).filter((v) => v < start + bid); if (vs.length) await post(ms[k + 1], `/api/games/${S.gameId}/battles/${id}/entries`, { verses: vs, links: ["https://example.com/video/" + id + "-" + k] }); }
  await post(cap(A), `/api/games/${S.gameId}/battles/${id}/submit`);
  if (beforeApprove) await beforeApprove();
  await approveEntries(id, "ATTACK");
}
/** Хранители: капитан выбирает отрывок с начала книги, участники учат, отправка, приём. count — сколько стихов выучить. */
async function defendPhase(D, id, count, per = 3) {
  const info = await get(cap(D), `/api/games/${S.gameId}/battles/${id}/book`);
  const from = await refOf(info, 0), to = await refOf(info, Math.min(count, info.total) - 1);
  await post(cap(D), `/api/games/${S.gameId}/battles/${id}/defense-passage`, { from, to });
  const ms = members(D); const chunk = Math.ceil(count / per);
  for (let k = 0; k < per; k++) { const vs = Array.from({ length: chunk }, (_, i) => k * chunk + i).filter((v) => v < count); if (vs.length) await post(ms[k], `/api/games/${S.gameId}/battles/${id}/entries`, { verses: vs, links: ["https://example.com/video/d" + id + "-" + k] }); }
  await post(cap(D), `/api/games/${S.gameId}/battles/${id}/submit`);
  await approveEntries(id, "DEFENSE");
}
async function waitBattle(id, statuses, maxMin = 12) {
  for (let i = 0; i < maxMin * 6; i++) { const b = await adminBattle(id); if (statuses.includes(b.status)) return b; await sleep(10_000); }
  throw new Error(`испытание ${id} не дошло до ${statuses.join("/")} за ${maxMin} мин`);
}

/* ---------- Ход партии ---------- */
async function main() {
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });

  await step("Аккаунты: вход", async () => {
    if (REGISTER) for (const n of ALL) { const r = await fetch(BASE + "/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: n, password: PASS, email: `${n}@example.com` }) }); if (r.status !== 201 && r.status !== 409) say(`регистрация ${n}: ${r.status}`); }
    for (const n of ALL) await login(n);
    const me = await get(ADMIN, "/api/auth/me");
    S.superadmin = me.user?.platformRole === "SUPERADMIN";
    say(`tg_admin суперадмин: ${S.superadmin}`);
  });

  // 1. Подготовка игры администратором
  const e1 = entry("Подготовка", "Администратор создаёт игру, карту и команды", "Игра «Тестовая партия», три команды по шесть участников, адресаты конвертов, стандартный набор дел, ускоренные сроки в продвинутых настройках.");
  await step("Игра и карта", async () => {
    const g = await post(ADMIN, "/api/games", { name: "Тестовая партия 18.09", orgName: "Церковь (тестовая партия)", teamCount: 3, settings: { equidistantStarts: true, maxStartDistanceDiff: 2 } });
    S.gameId = g.game.id;
    await post(ADMIN, `/api/games/${S.gameId}/generate`, { seed: 20260918 });
    for (const [k, t] of Object.entries(TEAMS)) {
      const team = await post(ADMIN, `/api/games/${S.gameId}/teams`, { name: t.name });
      const capInv = await post(ADMIN, `/api/games/${S.gameId}/teams/${team.team.id}/invites`, { role: "CAPTAIN" });
      await post(t.nicks[0], `/api/invites/${capInv.invite.token}/accept`);
      const memInv = await post(ADMIN, `/api/games/${S.gameId}/teams/${team.team.id}/invites`, { role: "MEMBER" });
      for (const n of t.nicks.slice(1)) await post(n, `/api/invites/${memInv.invite.token}/accept`);
      S.teams[k] = team.team;
    }
    await refreshTeams();
    for (const [label, kind] of [["Семья у вокзала", "FAMILY"], ["Бабушка с третьего этажа", "WIDOW"], ["Дедушка у рынка", "ELDER"]]) await post(ADMIN, `/api/games/${S.gameId}/recipients`, { label, kind });
    await post(ADMIN, `/api/games/${S.gameId}/deeds/import-default`);
    await api(ADMIN, "PATCH", `/api/games/${S.gameId}`, { settings: { rules: rulesFast } });
    await loadWorld();
  });
  await snap(e1, ADMIN, `/games/${S.gameId}`, "admin-draft-overview", "Черновик игры у администратора: чек-лист готовности, адресаты конвертов, команды.");
  await snap(e1, ADMIN, `/games/${S.gameId}`, "admin-settings-advanced", "Продвинутые настройки: сроки в днях (дробные — для ускоренной партии), пауза, дайджест писем.", async (p) => { await adminTab("Настройки")(p); await p.locator("details.settings-group summary").click(); await p.waitForTimeout(400); await scrollTo("Продвинутые")(p); });
  await snap(e1, ADMIN, `/games/${S.gameId}/labels`, "admin-labels", "Ярлыки для конвертов: шифр и ключ каждого города, адресат.");

  const e2 = entry("Подготовка", "Роли в командах", "Капитан назначает заместителя и просит роли (разведчик, пророк, посол, кормчий); администратор одобряет запросы в блоке «Команды».");
  await step("Роли", async () => {
    for (const k of Object.keys(TEAMS)) {
      const t = S.teams[k]; const n = TEAMS[k].nicks;
      await api(n[0], "PATCH", `/api/games/${S.gameId}/teams/${t.id}/members/${userId(n[1])}`, { role: "DEPUTY" });
      const roles = [["SCOUT", n[2]], ["PROPHET", n[3]], ["AMBASSADOR", n[4]], ["HELMSMAN", n[5]]];
      for (const [role, nick] of roles) await api(n[0], "PATCH", `/api/games/${S.gameId}/teams/${t.id}/members/${userId(nick)}`, { gameRole: role });
      if (k === "M") await snap(e2, ADMIN, `/games/${S.gameId}`, "admin-roles-pending", "Запросы ролей от капитана ждут одобрения администратора.", adminTab("Команды"));
      for (const [, nick] of roles) await post(ADMIN, `/api/games/${S.gameId}/teams/${t.id}/members/${userId(nick)}/role-decide`, { approve: true });
    }
    await refreshTeams();
  });
  await snap(e2, "tg_m1", `/games/${S.gameId}/team`, "player-roster", "Состав команды у капитана до старта: заместитель и роли утверждены.", async (p) => { await p.waitForTimeout(800); });

  const e3 = entry("Старт", "Старт игры", "Администратор запускает игру: команды получают стартовые точки на карте, вокруг — дела на сторонах.");
  await step("Старт", async () => { await post(ADMIN, `/api/games/${S.gameId}/start`); await loadWorld(); await refreshTeams(); });
  await snap(e3, ADMIN, `/games/${S.gameId}`, "admin-map-start", "Карта администратора после старта: три стартовые точки.");
  await snap(e3, "tg_m1", `/games/${S.gameId}/team`, "player-map-start", "Карта команды «Моряки»: туман, стартовая точка, свитки дел на сторонах.", async (p) => { await p.waitForSelector(".map-svg"); });

  // 2. Дела
  const e4 = entry("Дела", "Команды берут и сдают дела", "Участник берёт дело на стороне, делает его вместе с двумя товарищами (дело группой), сдаёт фото или отчёт из трёх вопросов. Администратор принимает или возвращает с комментарием. Принятое дело открывает перекрёсток.");
  await step("Дела: первые сдачи", async () => {
    const m = await myMap("tg_m1");
    const open = m.tasks.find((t) => t.status === "OPEN" && !t.sea);
    await post("tg_m2", `/api/games/${S.gameId}/edge-tasks/${open.id}/take`);
    await snap(e4, "tg_m2", `/games/${S.gameId}/team`, "player-deed-sheet", "Карточка дела у взявшего: описание, кодекс дела, форма сдачи с участниками.", async (p) => { await p.waitForSelector(".map-svg"); await p.evaluate(() => { const el = document.querySelector(".m-deed.taken, .m-deed"); el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await p.waitForTimeout(900); });
    await post("tg_m2", `/api/games/${S.gameId}/edge-tasks/${open.id}/submit`, { links: ["https://example.com/photo/first"], note: "Что сделали: помогли соседям. Кому: семье с детьми. Что услышали: спасибо.", participants: [userId("tg_m3"), userId("tg_m4")] });
    await doDeed("B", 0, { noApprove: true });
    await doDeed("P", 0, { noApprove: true });
    await snap(e4, ADMIN, `/games/${S.gameId}`, "admin-review-submissions", "Проверка у администратора: сдачи трёх команд, фильтры, возраст сдачи, выбор нескольких для пакетного принятия.", adminTab("Проверка"));
    const subs = await get(ADMIN, `/api/games/${S.gameId}/submissions`);
    const ids = subs.tasks.map((t) => t.id);
    await post(ADMIN, `/api/games/${S.gameId}/edge-tasks/${ids[0]}/decide`, { approve: false, comment: "На фото не видно, что сделано: добавьте ещё одно" });
    await post(ADMIN, `/api/games/${S.gameId}/edge-tasks/decide-batch`, { ids: ids.slice(1), approve: true });
    await post("tg_m2", `/api/games/${S.gameId}/edge-tasks/${open.id}/submit`, { links: ["https://example.com/photo/first", "https://example.com/photo/second"], note: "Добавили второе фото.", participants: [userId("tg_m3"), userId("tg_m4")] });
    await post(ADMIN, `/api/games/${S.gameId}/edge-tasks/${open.id}/decide`, { approve: true });
  });
  await snap(e4, "tg_m2", `/games/${S.gameId}/team`, "player-menu-after-deed", "Меню команды после принятого дела: лента «Что случилось» с возвратом и принятием, «Моё служение».", openMenu);
  await snap(e4, "tg_m1", `/games/${S.gameId}/team`, "player-map-revealed", "Карта после принятого дела: перекрёсток открыт, дальше новые стороны.", async (p) => { await p.waitForSelector(".map-svg"); });

  let cityM, cityB, cityP;
  await step("Дела: дойти до городов", async () => {
    cityM = await reachCity("M"); cityB = await reachCity("B"); cityP = await reachCity("P");
    say(`города: M=${cityM} B=${cityB} P=${cityP}`);
    for (const [T, c] of [["M", cityM], ["B", cityB], ["P", cityP]]) if (!c) { const { target } = toNearestCity(S.teams[T].startNodeKey); await reveal(T, target); if (T === "M") cityM = target; else if (T === "B") cityB = target; else cityP = target; }
    // Кроссворд должен попасть в партию: если книга города «Моряков» без кроссворда — открыть им ближайший город с кроссвордом.
    const hasCrossword = (key) => { const b = nodeOf(key)?.bookCode; return !!b && content(b).tasks.some((t) => t.type === "crossword"); };
    if (cityM && !hasCrossword(cityM)) {
      const d = distances(cityM); let best = Infinity, target = null;
      for (const n of S.nodes) if (n.kind === "CITY" && n.cityType !== "port" && ![cityB, cityP].includes(n.key) && d.has(n.key) && d.get(n.key) < best && hasCrossword(n.key)) { best = d.get(n.key); target = n.key; }
      if (target) { await reveal("M", target); cityM = target; say(`город с кроссвордом для «Моряков»: ${target}`); }
    }
  });
  await snap(e4, ADMIN, `/games/${S.gameId}`, "admin-map-paths", "Карта администратора: пройденные стороны трёх команд, ползунок истории ходов внизу.");

  // 3. Город команды «Моряки» — все формы
  const e5 = entry("Город", "«Моряки» изучают свой первый город", "Замок с кольцами для порядка районов, районы окрашиваются, задания в разных формах (замок с одним кольцом, обгоревший свиток, замок с кольцами, число, кроссворд), печать шифра, остывающая отмычка, подсказка пророка, обращение в поддержку.");
  await step("Город M", async () => {
    const book = nodeOf(cityM).bookCode; const bn = bookName(book);
    S.bookM = book; S.bookMName = bn;
    await snap(e5, "tg_m1", `/games/${S.gameId}/team`, "city-lock", "Шаг «Порядок»: замок с кольцами, район на каждом кольце, стрелки листают.", openCity(bn));
    await solveCity("M", cityM, {
      wrongFirst: true,
      afterWrongOrder: async () => { await snap(e5, "tg_m1", `/games/${S.gameId}/team`, "city-lock-pins", "Неверный порядок: замок показывает, сколько штифтов не село, но не каких.", async (p) => { await openCity(bn)(p); await p.getByRole("button", { name: "Провернуть замок" }).click().catch(() => {}); await p.waitForTimeout(900); }); },
      afterOrder: async () => { await snap(e5, "tg_m1", `/games/${S.gameId}/team`, "city-districts", "Порядок собран: районы окрашены и застыли, у каждого своё задание; печать шифра пока пустая.", async (p) => { await openCity(bn)(p); await scrollTo("Печать")(p); }); },
      wrongOn: "choice",
      beforeTask: async (pub, who) => {
        const name = { choice: "scales", text: "burnt", order: "lock-strips", number: "number", crossword: "crossword" }[pub.type];
        if (!S.shown) S.shown = new Set();
        if (S.shown.has(pub.type)) return;
        S.shown.add(pub.type);
        if (pub.index === 2) {
          await post("tg_m4", `/api/games/${S.gameId}/my-city/${encodeURIComponent(cityM)}/hint`, { index: 2 }).catch((e) => failures.push({ title: "подсказка пророка", error: String(e.message) }));
          await snap(e5, "tg_m4", `/games/${S.gameId}/team`, "city-prophet-letter", "Пророк: свеча в шапке города и «Письмо пророка» с текстом района (видит только пророк).", async (p) => { await openCity(bn)(p); await p.locator(".district").nth(2).click(); await p.waitForTimeout(700); await scrollTo("Письмо")(p); });
        }
        const cap = { choice: "Задание с выбором: замок с одним кольцом — листайте до верного варианта и проверните.", text: "Текстовое задание: обгоревший свиток с пропуском в цитате или обычное поле.", order: "«Расставьте по порядку»: замок, пункты — разорванные полоски.", number: "Числовое задание.", crossword: "Кроссворд по району: сетка и вопросы." }[pub.type];
        await snap(e5, who, `/games/${S.gameId}/team`, "city-task-" + name, cap, async (p) => { await openCity(bn)(p); await p.locator(".district").nth(pub.index).click(); await p.waitForTimeout(700); if (pub.type === "choice") { await p.locator(".ring .turn").first().click(); await p.waitForTimeout(300); } });
      },
      afterWrong: async (pub, who) => { await snap(e5, who, `/games/${S.gameId}/team`, "city-task-cooldown", "Неверный ответ: отмычка остывает, кольцо-таймер и точное время следующей попытки.", async (p) => { await openCity(bn)(p); await p.locator(".district").nth(pub.index).click(); await p.waitForTimeout(700); }); },
    });
    await post("tg_m5", `/api/games/${S.gameId}/support`, { nodeKey: cityM, taskIndex: 1, message: "Мы уверены, что ответ был верный: проверьте, пожалуйста" });
    await snap(e5, "tg_m1", `/games/${S.gameId}/team`, "city-envelope", "Все районы решены: печать собрана, конверт с сургучом, шифр для адресата и ячейки ключа.", async (p) => { await openCity(bn)(p); await scrollTo("Получите")(p); });
    await snap(e5, "tg_m1", `/games/${S.gameId}/team`, "city-envelope-wrong", "Неверный ключ: печать царапается, растущая пауза.", async (p) => { await openCity(bn)(p); await p.locator("#city-key").fill("ABCDEF"); await p.getByRole("button", { name: "Сломать печать" }).click(); await p.waitForTimeout(1500); });
    await sleep(rulesFast.pauseSteps[0] * 1000 + 500);
    const keyM = await cityKey(cityM);
    await snap(e5, "tg_m1", `/games/${S.gameId}/team`, "city-captured", "Верный ключ: сургуч сломан, грамота «Город ваш», первая столица команды.", async (p) => { await openCity(bn)(p); await p.locator("#city-key").fill(keyM); await p.getByRole("button", { name: "Сломать печать" }).click(); await p.waitForTimeout(2500); });
    const c = await cityView("tg_m1", cityM); if (!c.state.capturedAt) await capture("M", cityM);
  });
  await snap(e5, "tg_m1", `/games/${S.gameId}/team`, "map-capital", "Карта: город стал столицей «Моряков» (корона у подписи).", async (p) => { await p.waitForSelector(".map-svg"); });

  await step("Города B и P", async () => {
    await solveCity("B", cityB); await capture("B", cityB);
    await solveCity("P", cityP); await capture("P", cityP);
    await loadWorld();
  });
  await snap(e5, ADMIN, `/games/${S.gameId}`, "admin-city-card", "Карточка города у администратора: ключ конверта, шифр, задания, прогресс команд.", async (p) => { await p.waitForSelector(".map-svg"); await p.evaluate((b) => { for (const el of document.querySelectorAll(".m-label")) if (el.textContent?.includes(b)) { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); return; } }, S.bookMName); await p.waitForTimeout(1200); });

  // 4. Разведчик, проход, мир
  const e6 = entry("Дипломатия", "Разведка, проход через чужой город, мир", "Разведчик заглядывает за сторону; «Берег» подходит к городу «Моряков» и просит проход — посол «Моряков» разрешает. «Пустыня» предлагает «Морякам» мир: пока он действует, вызовы невозможны.");
  await step("Разведчик", async () => {
    const m = await myMap("tg_m3"); const fr = m.tasks.find((t) => t.status === "OPEN" && !t.sea);
    if (fr) await post("tg_m3", `/api/games/${S.gameId}/my-map/peek`, { nodeKey: fr.toKey });
  });
  await step("Проход", async () => {
    await reveal("B", cityM);
    await post("tg_b5", `/api/games/${S.gameId}/my-city/${encodeURIComponent(cityM)}/passage`, { message: "Пропустите нас, идём дальше на восток" });
    await snap(e6, "tg_b5", `/games/${S.gameId}/team`, "passage-request", "Посол «Берега» в чужом городе: запрос прохода отправлен.", async (p) => { await openCity(S.bookMName)(p); await p.locator("details.disclose summary", { hasText: "Проход" }).click(); await p.waitForTimeout(600); });
    await snap(e6, "tg_m5", `/games/${S.gameId}/team`, "passage-decide", "Посол «Моряков» видит запрос в меню: ответить можно с сообщением.", async (p) => { await openMenu(p); await scrollTo("Проходы")(p); });
    const mine = await get("tg_m5", `/api/games/${S.gameId}/my-passages`);
    const req = mine.incoming.find((r) => r.status === "PENDING");
    await post("tg_m5", `/api/games/${S.gameId}/passages/${req.id}/decide`, { approve: true, answer: "Проходите с миром" });
  });
  await step("Мир", async () => {
    await post("tg_p1", `/api/games/${S.gameId}/peace`, { teamId: S.teams.M.id });
    await snap(e6, "tg_m1", `/games/${S.gameId}/team`, "peace-offer", "Капитан «Моряков» видит предложение мира от «Пустыни».", async (p) => { await openMenu(p); await scrollTo("Мир")(p); });
    const v = await get("tg_m1", `/api/games/${S.gameId}/peace`); const inc = v.teams.find((x) => x.state === "incoming");
    await post("tg_m1", `/api/games/${S.gameId}/peace/${inc.peaceId}/accept`);
    await reveal("P", cityM);
    const w = await get("tg_p1", `/api/games/${S.gameId}/my-city/${encodeURIComponent(cityM)}/war`);
    say(`вызов при мире: canDeclare=${w.canDeclare} (${w.reason})`);
    if (w.canDeclare) failures.push({ title: "мир не закрыл вызов", error: "canDeclare=true при действующем мире" });
    await snap(e6, "tg_p1", `/games/${S.gameId}/team`, "peace-blocks-war", "При действующем мире вызов городу «Моряков» невозможен: об этом сказано в разделе «Испытание».", async (p) => { await openCity(S.bookMName)(p); await p.locator("details.disclose summary", { hasText: "Испытание" }).first().click(); await p.waitForTimeout(600); });
    await post("tg_p1", `/api/games/${S.gameId}/peace/${inc.peaceId}/break`);
  });

  // 5. Испытания
  const e7 = entry("Испытания", "Вызов городу: хранители отбиваются", "«Берег» изучает город «Моряков» и бросает вызов со ставкой 10 стихов. Претенденты учат отрывок, сдают записи, администратор принимает; у хранителей идёт время ответа: капитан выбирает отрывок, участники учат, ответ принят — город устоял.");
  let battle1;
  await step("Испытание 1: отбито", async () => {
    await solveCity("B", cityM);
    const r = await post("tg_b1", `/api/games/${S.gameId}/my-city/${encodeURIComponent(cityM)}/war`, { bid: 10 });
    battle1 = r.id;
    await snap(e7, "tg_b1", `/games/${S.gameId}/team`, "war-attack", "Претенденты «Берега»: вызов брошен, отрывок выдан, участники отмечают выученные стихи и прикрепляют видео.", async (p) => { await openCity(S.bookMName)(p); await p.locator("details.disclose summary", { hasText: "Испытание" }).first().click(); await p.waitForTimeout(700); });
    await snap(e7, "tg_m1", `/games/${S.gameId}/team`, "war-defend-alert", "Хранители «Моряков» видят вызов своему городу: ставка, срок; отрывок и суммы претендентов скрыты.", async (p) => { await openMenu(p); await scrollTo("Испытания")(p); });
    await attackPhase("B", battle1, 10, async () => { await snap(e7, ADMIN, `/games/${S.gameId}`, "admin-review-battle", "Проверка у администратора: записи стихов претендентов с видео ждут приёма или возврата.", adminTab("Проверка")); });
    await defendPhase("M", battle1, 10);
    const b = await waitBattle(battle1, ["REPELLED", "WON"], 3);
    say(`испытание 1: ${b.status}`);
    if (b.status !== "REPELLED") failures.push({ title: "испытание 1", error: "ожидалось REPELLED, получено " + b.status });
  });
  await snap(e7, "tg_m1", `/games/${S.gameId}/team`, "war-repelled", "Итог у хранителей: город устоял, уровень защиты вырос до ставки.", async (p) => { await openCity(S.bookMName)(p); await p.locator("details.disclose summary", { hasText: "Испытание" }).first().click(); await p.waitForTimeout(700); });
  await snap(e7, "tg_p2", `/games/${S.gameId}/team`, "news-for-all", "Новость у третьей команды: кто кому бросил вызов и итог — без ставок и чисел стихов.", async (p) => { await openMenu(p); await scrollTo("Что случилось")(p); });

  const e8 = entry("Испытания", "Вызов удался: город переходит", "«Пустыня» бросает вызов городу «Берега». Хранители не отвечают в срок — город переходит претендентам с уровнем защиты, равным ставке. Отдельно: вызов «Моряков» городу «Пустыни» не сдан вовремя и сгорает со штрафом к ставке.");
  let battle2, battle3;
  let ruinNode;
  await step("Испытание 2: взят (хранители не ответили)", async () => {
    // Второй город «Берегу» заранее: когда падёт столица, он станет руинами.
    ruinNode = S.nodes.find((n) => n.kind === "CITY" && n.cityType !== "port" && ![cityM, cityB, cityP].includes(n.key) && toNearestCity(n.key).dist === 0);
    await raw(ADMIN, "POST", `/api/games/${S.gameId}/cities/${encodeURIComponent(ruinNode.key)}/assign`, { teamId: S.teams.B.id });
    await reveal("P", cityB); await solveCity("P", cityB);
    const r = await post("tg_p1", `/api/games/${S.gameId}/my-city/${encodeURIComponent(cityB)}/war`, { bid: 10 });
    battle2 = r.id; await attackPhase("P", battle2, 10);
    // Хранители молчат: время ответа равно времени вызова (стоп-часы), ждём разрешения по сроку.
  });
  await step("Испытание 3: сгорает", async () => {
    await reveal("M", cityP); await solveCity("M", cityP);
    const r = await post("tg_m1", `/api/games/${S.gameId}/my-city/${encodeURIComponent(cityP)}/war`, { bid: 10 });
    battle3 = r.id;
  });
  await step("Очередь на город", async () => {
    // «Берег» встаёт в очередь на город «Пустыни», пока идёт вызов «Моряков».
    await reveal("B", cityP); await solveCity("B", cityP);
    await post("tg_b1", `/api/games/${S.gameId}/my-city/${encodeURIComponent(cityP)}/war`, { bid: 12 });
    await snap(e8, "tg_b1", `/games/${S.gameId}/team`, "war-queue", "Очередь: «Берег» стоит вторым на город «Пустыни» (буква очереди).", async (p) => { await openCity(bookName(nodeOf(cityP).bookCode))(p); await p.locator("details.disclose summary", { hasText: "Испытание" }).first().click(); await p.waitForTimeout(700); });
  });

  // 6. Столица, штраф, роли, перевод участника — пока идут сроки
  const e9 = entry("Команды", "Инструменты администратора и капитана", "Перенос столицы, штраф за телефон на собрании (аннулируется концевой участок пути), смена роли раз в неделю с одобрением, перевод участника в другую команду.");
  await step("Штраф и перевод", async () => {
    await snap(e9, ADMIN, `/games/${S.gameId}`, "admin-teams-before-penalty", "Блок «Команды» у администратора: действия по команде и участникам.", adminTab("Команды"));
    // Штраф бьёт по концевому участку пути, а не по городу: пусть «Берег» сначала пройдёт две стороны.
    await doDeed("B", 2); await doDeed("B", 3);
    const pen = await raw(ADMIN, "POST", `/api/games/${S.gameId}/teams/${S.teams.B.id}/penalty`);
    say(`штраф: ${pen.status} ${JSON.stringify(pen.body).slice(0, 120)}`);
    if (pen.status >= 400) failures.push({ title: "штраф", error: pen.body?.message ?? String(pen.status) });
    await snap(e9, "tg_b1", `/games/${S.gameId}/team`, "penalty-feed", "Команда «Берег» видит штраф в ленте.", async (p) => { await openMenu(p); await scrollTo("Что случилось")(p); });
    await post(ADMIN, `/api/games/${S.gameId}/teams/${S.teams.P.id}/members/${userId("tg_p6")}/move`, { toTeamId: S.teams.M.id });
    await refreshTeams();
    // Смена роли: капитан «Пустыни» просит нового кормчего, администратор одобряет.
    await api("tg_p1", "PATCH", `/api/games/${S.gameId}/teams/${S.teams.P.id}/members/${userId("tg_p5")}`, { gameRole: "HELMSMAN" });
    await post(ADMIN, `/api/games/${S.gameId}/teams/${S.teams.P.id}/members/${userId("tg_p5")}/role-decide`, { approve: true });
  });

  // 7. Ждём срок ответа хранителей (испытание 2) и сгорание вызова (испытание 3)
  await step("Ожидание сроков испытаний", async () => {
    const b2 = await waitBattle(battle2, ["WON", "REPELLED", "EXPIRED"], 14); say(`испытание 2: ${b2.status}`);
    if (b2.status !== "WON") failures.push({ title: "испытание 2", error: "ожидалось WON, получено " + b2.status });
    const b3 = await waitBattle(battle3, ["EXPIRED", "WON", "REPELLED", "CANCELLED"], 14); say(`испытание 3: ${b3.status}`);
    if (b3.status !== "EXPIRED") failures.push({ title: "испытание 3", error: "ожидалось EXPIRED (сгорел), получено " + b3.status });
    await loadWorld();
  });
  await snap(e8, "tg_p1", `/games/${S.gameId}/team`, "war-won", "«Пустыня» взяла город «Берега»: город на карте сменил владельца.", async (p) => { await p.waitForSelector(".map-svg"); });
  await snap(e8, "tg_m1", `/games/${S.gameId}/team`, "war-burnt", "Сгоревший вызов «Моряков»: штраф к минимальной ставке на этот город; очередь пошла дальше.", async (p) => { await openCity(bookName(nodeOf(cityP).bookCode))(p); await p.locator("details.disclose summary", { hasText: "Испытание" }).first().click(); await p.waitForTimeout(700); });

  // 8. Столица «Берега» потеряна → команда выбыла, руины, сокровище
  const e10 = entry("Выбывание", "Потеря столицы: руины и находка", "Город «Берега» был его столицей: команда выбыла, её остальные города — руины. «Моряки» изучают руины и получают находку — район ближайшего города; руины занимают без конверта.");
  await step("Руины и сокровище", async () => {
    const st = (await get(ADMIN, `/api/games/${S.gameId}/standings`)).standings;
    const bRow = st.find((s) => s.teamId === S.teams.B.id);
    say(`Берег: статус ${bRow?.status}`);
    if (bRow?.status !== "defeated") failures.push({ title: "выбывание", error: "«Берег» не выбыл после потери столицы" });
    await loadWorld();
    await reveal("M", ruinNode.key);
    await solveCity("M", ruinNode.key);
    await snap(e10, "tg_m1", `/games/${S.gameId}/team`, "ruins-envelope", "Руины: сухая печать, занять можно без конверта.", async (p) => { await openCity(bookName(ruinNode.bookCode))(p); await scrollTo("Получите")(p); });
    await post("tg_m1", `/api/games/${S.gameId}/my-city/${encodeURIComponent(ruinNode.key)}/capture`, { key: "" }).catch(async () => capture("M", ruinNode.key));
    await snap(e10, "tg_m1", `/games/${S.gameId}/team`, "treasure-feed", "Лента «Моряков»: находка в руинах — знак шифра ближайшего города; руины заняты.", async (p) => { await openMenu(p); await scrollTo("Что случилось")(p); });
    await post(ADMIN, `/api/games/${S.gameId}/teams/${S.teams.B.id}/members/${userId("tg_b2")}/move`, { toTeamId: S.teams.P.id }).catch((e) => failures.push({ title: "перевод из выбывшей команды", error: e.message }));
    await refreshTeams();
  });

  // 9. Столица: перенос
  await step("Перенос столицы", async () => {
    const owned = (await myMap("tg_m1")).cities.filter((c) => c.captured && !c.isCapital);
    if (!owned.length) throw new Error("у «Моряков» нет второго города");
    await post("tg_m1", `/api/games/${S.gameId}/my-city/${encodeURIComponent(owned[0].nodeKey)}/make-capital`);
    await snap(e9, "tg_m1", `/games/${S.gameId}/team`, "capital-moved", "Капитан перенёс столицу в другой город (один раз за игру, тайно).", async (p) => { await p.waitForSelector(".map-svg"); });
  });

  // 10. Максимум защиты и осада делами
  const e11 = entry("Осада", "Максимум защиты и осада делами", "Хранители «Моряков» отбили вызов, выучив всю книгу каждым участником: город закреплён на срок, после которого его берут не стихами, а делами — «Пустыня» объявляет осаду, обе команды делают дела, побеждает та, у которой больше принятых дел.");
  let siegeCity = cityM;
  await step("Максимум защиты", async () => {
    await solveCity("P", cityM);
    const info = await get("tg_m1", `/api/games/${S.gameId}/my-city/${encodeURIComponent(cityM)}/war`);
    const total = info.bookVerses ?? (await get("tg_p1", `/api/games/${S.gameId}/battles/${battle2}/book`)).total;
    const r = await post("tg_p1", `/api/games/${S.gameId}/my-city/${encodeURIComponent(cityM)}/war`, { bid: total });
    const id = r.id;
    // Претенденты: один участник учит всю книгу; хранители: каждый участник учит всю книгу.
    const mine = (await get("tg_p1", `/api/games/${S.gameId}/my-battles`)).battles.find((b) => b.id === id);
    await post("tg_p2", `/api/games/${S.gameId}/battles/${id}/entries`, { verses: Array.from({ length: total }, (_, i) => mine.passage.start + i), links: ["https://example.com/video/all"] });
    await post("tg_p1", `/api/games/${S.gameId}/battles/${id}/submit`); await approveEntries(id, "ATTACK");
    const bi = await get("tg_m1", `/api/games/${S.gameId}/battles/${id}/book`);
    await post("tg_m1", `/api/games/${S.gameId}/battles/${id}/defense-passage`, { from: await refOf(bi, 0), to: await refOf(bi, total - 1) });
    await refreshTeams();
    for (const m of S.teams.M.members) await post(m.user.nickname, `/api/games/${S.gameId}/battles/${id}/entries`, { verses: Array.from({ length: total }, (_, i) => i), links: ["https://example.com/video/max-" + m.user.nickname] });
    await post("tg_m1", `/api/games/${S.gameId}/battles/${id}/submit`); await approveEntries(id, "DEFENSE");
    const b = await waitBattle(id, ["REPELLED", "WON"], 3); say(`максимум: ${b.status}`);
    const w = await get("tg_p1", `/api/games/${S.gameId}/my-city/${encodeURIComponent(cityM)}/war`);
    say(`после максимума: locked=${w.locked} maxed=${w.maxed} до ${w.lockedUntil}`);
    if (!w.maxed) failures.push({ title: "максимум защиты", error: "город не отмечен как достигший максимума" });
  });
  await snap(e11, "tg_p1", `/games/${S.gameId}/team`, "city-locked", "Город закреплён: вызов невозможен до срока, дальше — осада делами.", async (p) => { await openCity(S.bookMName)(p); await p.locator("details.disclose summary", { hasText: "Испытание" }).first().click(); await p.waitForTimeout(700); });
  await step("Осада", async () => {
    await sleep(Math.max(0, rulesFast.lockWeeks * 7 * 86_400_000 + 65_000));
    const r = await raw("tg_p1", "POST", `/api/games/${S.gameId}/my-city/${encodeURIComponent(siegeCity)}/siege`);
    say(`осада: ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    if (r.status >= 400) { failures.push({ title: "осада", error: r.body?.message ?? String(r.status) }); return; }
    await snap(e11, "tg_m1", `/games/${S.gameId}/team`, "siege-declared", "Осада объявлена: у обеих команд считаются принятые дела до срока.", async (p) => { await openCity(S.bookMName)(p); await p.locator("details.disclose summary", { hasText: "Испытание" }).first().click(); await p.waitForTimeout(700); });
    // Дела во время осады: «Пустыня» два, «Моряки» одно.
    await doDeed("P", 1); await doDeed("P", 2); await doDeed("M", 3);
    const until = Date.now() + rulesFast.siegeDays * 86_400_000 + 70_000;
    let done = null;
    while (Date.now() < until) { await sleep(15_000); const list = (await get(ADMIN, `/api/games/${S.gameId}/sieges`).catch(() => ({ sieges: [] }))).sieges ?? []; const s = list.find((x) => x.nodeKey === siegeCity); if (s && s.status !== "ACTIVE") { done = s; break; } }
    say(`итог осады: ${done?.status} ${done?.attackerPoints}:${done?.defenderPoints}`);
    if (!done || done.status !== "WON") failures.push({ title: "осада", error: "ожидалось WON, получено " + (done?.status ?? "не завершена в срок") });
  });
  await snap(e11, "tg_p1", `/games/${S.gameId}/team`, "siege-result", "Итог осады у «Пустыни»: город перешёл по числу дел.", async (p) => { await openMenu(p); await scrollTo("Что случилось")(p); });

  // 11. Морской переход
  const e12 = entry("Море", "Порт, корабль и высадка", "Из взятого порта команда уходит в море морским делом; после его приёма кормчий выбирает место высадки на другом острове. Над портом кружат чайки, дельфины сопровождают корабль.");
  await step("Морской переход", async () => {
    const port = S.nodes.find((n) => n.kind === "CITY" && n.cityType === "port" && ![cityM, cityB, cityP].includes(n.key));
    if (!port) throw new Error("нет свободного порта");
    await raw(ADMIN, "POST", `/api/games/${S.gameId}/cities/${encodeURIComponent(port.key)}/assign`, { teamId: S.teams.M.id });
    const m = await myMap("tg_m1"); const sea = m.tasks.find((t) => t.sea && t.status === "OPEN");
    if (!sea) throw new Error("морское дело не появилось");
    await post("tg_m6", `/api/games/${S.gameId}/edge-tasks/${sea.id}/take`);
    await post("tg_m6", `/api/games/${S.gameId}/edge-tasks/${sea.id}/submit`, { links: ["https://example.com/photo/sea"], note: "Сделали морское дело всей командой.", participants: [userId("tg_m1")] });
    await post(ADMIN, `/api/games/${S.gameId}/edge-tasks/${sea.id}/decide`, { approve: true });
    await snap(e12, "tg_m6", `/games/${S.gameId}/team`, "sea-ship", "Корабль у порта после принятого морского дела: кормчий выбирает место высадки.", async (p) => { await p.waitForSelector(".map-svg"); for (let i = 0; i < 4; i++) { await p.locator('button[aria-label="Отдалить"]').click(); await p.waitForTimeout(150); } await p.waitForTimeout(800); });
    const m2 = await myMap("tg_m6"); const t = m2.tasks.find((x) => x.id === sea.id);
    const target = t.candidates?.[0]; if (!target) throw new Error("нет мест высадки");
    await post("tg_m6", `/api/games/${S.gameId}/edge-tasks/${sea.id}/land`, { nodeKey: target });
    await snap(e12, "tg_m6", `/games/${S.gameId}/team`, "sea-landed", "Высадка на другом острове: новый берег открыт.", async (p) => { await p.waitForSelector(".map-svg"); for (let i = 0; i < 5; i++) { await p.locator('button[aria-label="Отдалить"]').click(); await p.waitForTimeout(150); } await p.waitForTimeout(800); });
  });

  // 12. Летопись, журнал, доска, книга сезона, финиш
  const e13 = entry("Итоги", "Летопись, журнал, доска активности, Книга сезона, финиш", "Администратор отправляет летопись недели, смотрит журнал событий и доску активности, завершает игру и открывает «Книгу сезона» для показа на собрании.");
  await step("Летопись и итоги", async () => {
    await post(ADMIN, `/api/games/${S.gameId}/chronicle`);
    await snap(e13, "tg_m2", `/games/${S.gameId}/team`, "chronicle-feed", "Летопись недели пришла в ленту каждой команды (и письмом, и уведомлением).", async (p) => { await openMenu(p); await scrollTo("Что случилось")(p); await p.locator(".feed details summary").first().click().catch(() => {}); await p.waitForTimeout(300); });
    await snap(e13, "tg_m2", `/games/${S.gameId}/team`, "my-service", "«Моё служение»: дела, районы, стихи, города участника.", async (p) => { await openMenu(p); await scrollTo("Моё служение")(p); });
    await snap(e13, ADMIN, `/games/${S.gameId}`, "admin-activity", "Доска активности участников в блоке «Команды».", async (p) => { await adminTab("Команды")(p); await p.locator("details.fold-card summary").first().click(); await p.waitForTimeout(800); await scrollTo("Активность")(p); });
    await snap(e13, ADMIN, `/games/${S.gameId}`, "admin-journal", "Журнал событий и кнопка «Отправить летопись сейчас» в «Обзоре».", async (p) => { await adminTab("Обзор")(p); await scrollTo("Журнал событий")(p); });
    await post(ADMIN, `/api/games/${S.gameId}/finish`);
    await snap(e13, ADMIN, `/games/${S.gameId}`, "admin-finished", "Игра завершена: победитель и положение команд.", adminTab("Обзор"));
    await snap(e13, "tg_p1", `/games/${S.gameId}/team`, "player-finished", "Страница команды после завершения игры.");
    await snap(e13, ADMIN, `/games/${S.gameId}/book`, "season-book", "«Книга сезона»: положение, участники, города, дела, испытания, летописи — для показа на собрании и печати.");
  });

  await browser.close();
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ base: BASE, gameId: S.gameId, startedAt: new Date(S.t0).toISOString(), minutes: (Date.now() - S.t0) / 60000, entries: report, failures, log }, null, 2));
  say(`Готово: ${report.length} разделов, ${shotN} снимков, сбоев ${failures.length}`);
  for (const f of failures) say(`  ✗ ${f.title}: ${f.error}`);
}

main().catch(async (e) => { console.error(e); failures.push({ title: "скрипт остановился", error: String(e) }); writeFileSync(join(OUT, "report.json"), JSON.stringify({ base: BASE, gameId: S.gameId, entries: report, failures, log }, null, 2)); if (browser) await browser.close(); process.exit(1); });
