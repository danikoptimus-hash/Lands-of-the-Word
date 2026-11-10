import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const BASE = "http://localhost:3000", G = process.env.G, OUT = process.env.OUT, K = 1.5, PASS = process.env.LOCAL_PASS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const data = JSON.parse(readFileSync(`${OUT}/shots.json`, "utf8"));
const b = await chromium.launch();
async function ctxFor(nick) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: K });
  await ctx.addInitScript(() => { try { localStorage.setItem("lotw.intro.seen", "1"); } catch {} });
  await ctx.request.post(BASE + "/api/auth/login", { data: { nickname: nick, password: PASS } });
  return ctx;
}
const admin = await ctxFor("q_admin");
const wr = await admin.request.post(`${BASE}/api/games/${G}/deeds`, { data: { wreck: true, wreckStones: 3, wreckBlocks: 2, wreckSinkAt: new Date(Date.now() + 2 * 864e5).toISOString(), title: "Помочь пожилой семье с переездом", description: "Командой помочь собрать и перенести вещи. Сдать — отчёт и фото.", direction: "Посещение", proofType: "PHOTO_LINK", canRepeat: true } });
console.log("корабль", wr.status(), (await wr.text()).slice(0, 120));
await sleep(1500);
const david = await ctxFor("q_david");
const D = await david.newPage(); await D.goto(`${BASE}/games/${G}/team?tod=day`, { waitUntil: "networkidle" }); await sleep(3000);
const ship = D.locator("g.m-deed.wreck g circle").first();
console.log("корабль на карте:", await ship.count());
let bb = await ship.boundingBox(); console.log("где", bb);
const dx = 760 - (bb.x + bb.width / 2), dy = 420 - (bb.y + bb.height / 2);
if (Math.hypot(dx, dy) > 25) { await D.mouse.move(640, 360); await D.mouse.down(); for (let k = 1; k <= 12; k++) await D.mouse.move(640 + dx * k / 12, 360 + dy * k / 12); await D.mouse.up(); await sleep(2000); }
bb = await ship.boundingBox();
const tap = [Math.round((bb.x + bb.width / 2) * K), Math.round((bb.y + bb.height / 2) * K)];
await D.screenshot({ path: `${OUT}/t19_ship.png` }); data.shots.t19_ship = { tap };
await D.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(2000);
await D.screenshot({ path: `${OUT}/t20_wreck.png` }); data.shots.t20_wreck = { tap: null };
writeFileSync(`${OUT}/shots.json`, JSON.stringify(data, null, 1));
await b.close(); console.log("готово", tap);
