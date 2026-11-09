// Съёмка экранов для ролика о Каменоломне: снимки 1920×1080 и точки нажатий (shots.json).
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
const BASE = "http://localhost:3000", G = process.env.G, OUT = process.env.OUT, K = 1.5, PASS = process.env.LOCAL_PASS;
const p = new PrismaClient();
const COAST = "N:-4,5";
const [T1, T2] = (await p.team.findMany({ where: { gameId: G }, orderBy: { index: "asc" } })).map((t) => t.id);
const shots = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch();
async function ctxFor(nick) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: K, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addInitScript(() => { try { localStorage.setItem("lotw.intro.seen", "1"); } catch {} });
  const r = await ctx.request.post(BASE + "/api/auth/login", { data: { nickname: nick, password: PASS } });
  if (!r.ok()) throw new Error("login " + nick);
  return ctx;
}
async function open(ctx, path) { const pg = await ctx.newPage(); await pg.goto(BASE + path, { waitUntil: "networkidle" }); await sleep(2500); return pg; }
async function center(loc) { const bb = await loc.boundingBox(); if (!bb) throw new Error("no box"); return [Math.round((bb.x + bb.width / 2) * K), Math.round((bb.y + bb.height / 2) * K)]; }
/** Снимок; если передан локатор — точка нажатия на нём (для кружка в ролике), затем нажатие. */
async function shot(pg, name, tapLoc, { click = true, wait = 1400 } = {}) {
  let tap = null;
  if (tapLoc) { await tapLoc.scrollIntoViewIfNeeded().catch(() => {}); await sleep(250); tap = await center(tapLoc); }
  await pg.screenshot({ path: `${OUT}/${name}.png` });
  shots[name] = { tap };
  console.log("снимок", name, tap ? `нажатие ${tap}` : "");
  if (tapLoc && click) { await tapLoc.click(); await sleep(wait); }
}
async function frameQuarry(pg, tx = 760, ty = 540, steps = 4) {
  for (let i = 0; i < steps; i++) { await pg.mouse.move(640, 400); await pg.mouse.wheel(0, 400); await sleep(450); }
  await sleep(900);
  const bb = await pg.locator(".m-quarry").boundingBox();
  const dx = tx - (bb.x + bb.width / 2), dy = ty - (bb.y + bb.height / 2);
  await drag(pg, dx, dy);
}
/** Сдвиг карты: короткий быстрый жест (долгое нажатие на месте ставит метку). */
async function drag(pg, dx, dy) {
  if (Math.hypot(dx, dy) < 25) return;
  await pg.mouse.move(640, 360); await pg.mouse.down();
  for (let k = 1; k <= 12; k++) await pg.mouse.move(640 + dx * k / 12, 360 + dy * k / 12);
  await pg.mouse.up(); await sleep(1800);
}
const rail = (pg, name) => pg.locator(`button:has-text("${name}")`).first();

// --- какие дороги мостим и какое дело «возвращено» (возврат ставится после кадра «Внимание»)
const anna = await p.user.findUniqueOrThrow({ where: { nickname: "q_anna" } });
const open1 = await p.teamEdgeTask.findMany({ where: { teamId: T1, status: "OPEN", sea: false }, orderBy: { id: "asc" } });
const paveTask = open1.find((t) => t.fromKey === "S:-2,3" && t.toKey === "N:-3,5") ?? open1.find((t) => t.fromKey !== COAST && t.toKey !== COAST);
const rejTask = open1.find((t) => t.fromKey === "N:-2,4" && t.toKey === "S:-1,2") ?? open1.find((t) => t.id !== paveTask.id && t.fromKey !== COAST);
const markReturned = () => p.teamEdgeTask.update({ where: { id: rejTask.id }, data: { status: "REJECTED", takenById: anna.id, takenAt: new Date(), submittedAt: new Date(), decidedAt: new Date(), adminComment: "На фото не видно, кто помогал", links: ["https://photos.example.com/help-1"], participants: [anna.id] } });
console.log("мостим", paveTask.id, paveTask.fromKey, "→", paveTask.toKey, "; возвращено", rejTask.id);

// === Администратор: Каменоломня на карте, новое дело
const admin = await ctxFor("q_admin");
let A = await open(admin, `/games/${G}`);
await frameQuarry(A, 700, 470, 3);
await shot(A, "a1_map", A.locator(".m-quarry"));
await shot(A, "a2_sheet", A.locator(".quarry-sheet button:has-text('Новое дело')"));
const TITLE = "Вся команда на уборке у дома молитвы";
await A.locator("#d-title").fill(TITLE);
await A.locator("#d-desc").fill("Вся команда вместе убирает территорию дома молитвы. Сдать — фото команды за работой.");
const dirOpts = await A.locator("#d-dir option").allTextContents();
const dir = dirOpts.find((o) => /Труд/.test(o)); if (dir) await A.locator("#d-dir").selectOption({ label: dir });
await A.locator("#d-stones").fill("2");
await sleep(400);
await shot(A, "a3_form", A.locator("button[form='deed-form']"), { wait: 2200 });
await shot(A, "a4_list");
// Готовый набор: меню «Стандартный набор»
const setBtn = A.locator(".quarry-sheet [aria-label='Стандартный набор']").first();
if (await setBtn.count()) { await shot(A, "a5_setbtn", setBtn, { wait: 800 }); await shot(A, "a5_setmenu"); await A.keyboard.press("Escape"); await sleep(600); }

// === Команда «Ковчег»: «Внимание» и лист Каменоломни
const david = await ctxFor("q_david");
let D = await open(david, `/games/${G}/team?tod=day`);
await shot(D, "t1_map", rail(D, "Внимание"));
const attItem = D.locator("li", { hasText: "Новое дело в Каменоломне" }).first();
await shot(D, "t2_attention", attItem, { click: false });
await D.keyboard.press("Escape"); await sleep(600);
await markReturned();
await D.close(); D = await open(david, `/games/${G}/team?tod=day`);
await frameQuarry(D, 760, 540, 4);
await shot(D, "t3_map", D.locator(".m-quarry"), { wait: 2200 });
await shot(D, "t4_sheet");

// === «Странники»: Каменоломня до прибрежного города
const iosif = await ctxFor("q_iosif");
const S = await open(iosif, `/games/${G}/team?tod=day`);
await frameQuarry(S, 760, 540, 4);
await shot(S, "t5_map", S.locator(".m-quarry"), { wait: 2200 });
await shot(S, "t5_sheet");
await iosif.close();

// === «Ковчег» сдаёт общее дело
const row = D.locator(".quarry-deeds li", { hasText: TITLE }).first();
await shot(D, "t6_list", row.locator("button:has-text('Сдать')"), { wait: 1200 });
await shot(D, "t7_form");
await shot(D, "t8_present", D.locator(".present-list label", { hasText: "Мириам" }), { wait: 500 });
await D.evaluate(() => navigator.clipboard.writeText("https://photos.example.com/kovcheg-uborka"));
const paste = D.locator(".quarry-sheet button:has-text('Вставить ссылку')").first();
await shot(D, "t9_beforelink", paste, { wait: 900 });
const manual = D.locator(".quarry-sheet input[type=url]").first();
if (await manual.count()) { await manual.fill("https://photos.example.com/kovcheg-uborka"); await D.locator(".quarry-sheet button:has-text('Добавить')").first().click(); await sleep(600); }
await D.locator(".quarry-sheet textarea").first().fill("Пришли все, кроме Мириам: она в отъезде. Убрали двор и дорожки.");
await sleep(500);
await shot(D, "t10_ready", D.locator(".quarry-sheet button:has-text('Сдать на проверку')"), { wait: 2000 });
await shot(D, "t11_pending");

// === Администратор: проверка
await A.close(); A = await open(admin, `/games/${G}`);
await shot(A, "a6_map", rail(A, "Проверка"), { wait: 2000 });
const card = A.locator(".review-item", { hasText: TITLE }).first();
await card.scrollIntoViewIfNeeded(); await sleep(500);
await shot(A, "a7_review", card.locator("button[aria-label='Вернуть']"), { wait: 800 });
const ta = A.locator(".return-box input").first();
if (await ta.count()) { await ta.fill("На фото видно не всю команду"); await sleep(400); }
await shot(A, "a8_return");
const cancel = A.locator(".return-box button[aria-label='Отмена']").first();
if (await cancel.count()) { await cancel.click(); await sleep(600); }
await shot(A, "a9_review", card.locator("button:has-text('Принять')"), { wait: 1200 });
await shot(A, "a10_accepted");

// === Участник: «Служение»
const sam = await ctxFor("q_samuil");
const SM = await open(sam, `/games/${G}/team?tod=day`);
await shot(SM, "t12_map", rail(SM, "Служение"), { wait: 2000 });
await shot(SM, "t12_service");
await sam.close();

// === «Ковчег»: камни и мощение
await D.close(); D = await open(david, `/games/${G}/team?tod=day`);
await frameQuarry(D, 760, 540, 4);
await D.locator(".m-quarry").click(); await sleep(2200);
await shot(D, "t13_stones");
await D.locator(".quarry-sheet .overlay-body, .quarry-sheet").first().evaluate((el) => { const sc = el.closest(".overlay-body") ?? el.querySelector(".overlay-body") ?? el; sc.scrollTop = sc.scrollHeight; });
await sleep(700);
await shot(D, "t13b_works");
await D.keyboard.press("Escape"); await sleep(600);
await D.close(); D = await open(david, `/games/${G}/team?tod=day`);
const mark = D.locator(`g.m-deed[data-id="${paveTask.id}"] circle`).first();
await shot(D, "t14_map", mark, { click: false });
{ const bb = await mark.boundingBox(); await D.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(1600); }
const paveBtn = D.locator("button:has-text('Вымостить дорогу')").first();
await shot(D, "t15_deed", paveBtn, { wait: 900 });
await shot(D, "t16_confirm", D.locator(".modal button").last(), { wait: 2600 });
await shot(D, "t17_paved");
await D.keyboard.press("Escape"); await sleep(500);
const rmark = D.locator(`g.m-deed[data-id="${rejTask.id}"] circle`).first();
await shot(D, "t18_map", rmark, { click: false });
{ const bb = await rmark.boundingBox(); await D.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(1600); }
await shot(D, "t18_returned");
await D.keyboard.press("Escape"); await sleep(500);

// === Разбитый корабль с камнями (груз)
const wr = await admin.request.post(`${BASE}/api/games/${G}/deeds`, { data: { wreck: true, wreckStones: 3, wreckBlocks: 2, wreckSinkAt: null, quarry: false, stones: 1, title: "Помочь пожилой семье с переездом", description: "Командой помочь собрать и перенести вещи. Сдать — отчёт и фото.", direction: "Посещение (в церкви, больных, одиноких)", proofType: "PHOTO_LINK", canRepeat: true, bookCodes: [], chance: 60, secret: false, remote: false, siegePoints: null, donationMin: null } });
console.log("корабль", wr.status());
await D.close(); D = await open(david, `/games/${G}/team?tod=day`);
const ship = D.locator("g.m-deed.wreck").first();
if (await ship.count()) {
  const bb = await ship.boundingBox(); await drag(D, 760 - (bb.x + bb.width / 2), 400 - (bb.y + bb.height / 2));
  const hit = D.locator("g.m-deed.wreck g circle").first();
  await shot(D, "t19_ship", hit, { click: false });
  const hb = await hit.boundingBox(); await D.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2); await sleep(1800);
  await shot(D, "t20_wreck");
  await D.keyboard.press("Escape"); await sleep(500);
}

// === Ещё раз то же общее дело (сдавать можно сколько угодно раз): сдача и приём через API
const deed = await p.deed.findFirstOrThrow({ where: { gameId: G, title: TITLE } });
const members = (await p.membership.findMany({ where: { teamId: T1 } })).map((m) => m.userId);
const sub = await david.request.post(`${BASE}/api/games/${G}/quarry/${deed.id}/submit`, { data: { links: ["https://photos.example.com/kovcheg-uborka-2"], note: "Снова всей командой.", participants: members } });
const wid = (await sub.json()).work.id;
await admin.request.post(`${BASE}/api/games/${G}/quarry/works/${wid}/decide`, { data: { approve: true, comment: "" } });
await sleep(800);
await D.close(); D = await open(david, `/games/${G}/team?tod=day`);
await frameQuarry(D, 760, 540, 4);
await D.locator(".m-quarry").click(); await sleep(2200);
await D.locator(".quarry-sheet").first().evaluate((el) => { const sc = el.closest(".overlay-body") ?? el.querySelector(".overlay-body") ?? el; sc.scrollTop = sc.scrollHeight; });
await sleep(700);
await shot(D, "t21_works");

writeFileSync(`${OUT}/shots.json`, JSON.stringify({ shots, paveTask: paveTask.id, rejTask: rejTask.id }, null, 1));
await b.close(); await p.$disconnect();
console.log("готово");
