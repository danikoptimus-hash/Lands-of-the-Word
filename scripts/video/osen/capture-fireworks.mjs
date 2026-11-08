// Салют над городами «Бича народов» на карте администратора: часы браузера остановлены, кадр — ровно 1/30 с.
import { chromium } from "playwright";
const [out, frames = "240", tod = "night", zoom = "0", zx = "0.44", zy = "0.53"] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.request.post("http://localhost:3001/api/auth/login", { data: { nickname: process.env.LOCAL_ADMIN || "admin1", password: process.env.LOCAL_PASS || "" } });
await ctx.addInitScript(() => { try { localStorage.setItem("lotw.intro.seen", "1"); } catch {} });
const p = await ctx.newPage();
await p.clock.install({ time: new Date("2026-11-08T11:40:00Z") });
await p.goto(`http://localhost:3001/games/cmucujbgq0008s301ran0fnt4?tod=${tod}`, { waitUntil: "domcontentloaded" });
await p.waitForLoadState("networkidle");
await p.waitForTimeout(3000);
// Часы на паузу: без неё время в браузере идёт само, и за секунды съёмки одного кадра салют улетает вперёд (ускорение).
await p.clock.pauseAt(new Date("2026-11-08T11:42:00Z"));
await p.clock.runFor(1500);
await p.addStyleTag({ content: ".admin-top,.admin-dock,.view-as,.admin-timeline{opacity:0!important;pointer-events:none!important}" });
if (+zoom > 0) {
  await p.mouse.move(1920 * +zx, 1080 * +zy);
  for (let i = 0; i < +zoom; i++) { await p.mouse.wheel(0, -300); await p.clock.runFor(120); }
  await p.clock.runFor(1500);
}
await p.clock.runFor(2500);
for (let f = 0; f < +frames; f++) {
  await p.clock.runFor(1000 / 30);
  await p.screenshot({ path: `${out}/f${String(f).padStart(4, "0")}.jpg`, type: "jpeg", quality: 90 });
  if (f % 60 === 0) console.log("кадр", f);
}
await b.close();
console.log("готово");
