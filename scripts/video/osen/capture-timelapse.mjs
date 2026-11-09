// Таймлапс карты администратора по истории ходов «Осени»: кадр на каждый ход + подписи (дата, команда, событие).
import { chromium } from "playwright";
import fs from "node:fs";
const [out] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
await ctx.request.post("http://localhost:3001/api/auth/login", { data: { nickname: process.env.LOCAL_ADMIN || "admin1", password: process.env.LOCAL_PASS || "" } });
await ctx.addInitScript(() => { try { localStorage.setItem("lotw.intro.seen", "1"); } catch {} });
const p = await ctx.newPage();
await p.goto("http://localhost:3001/games/cmucujbgq0008s301ran0fnt4?tod=day", { waitUntil: "networkidle" });
await p.waitForTimeout(3000);
await p.addStyleTag({ content: ".admin-top,.admin-dock,.view-as,.admin-timeline{opacity:0!important;pointer-events:none!important}" });
await p.evaluate(() => document.querySelector(".tl-toggle").click());
await p.waitForTimeout(500);
const n = await p.evaluate(() => +document.querySelector(".tl-body input[type=range]").max);
console.log("ходов:", n);
const meta = [];
const STEP = +(process.env.STEP || 2); const pos = []; for (let i = 0; i < n; i += STEP) pos.push(i); pos.push(n);
for (const [k, i] of pos.entries()) {
  const desc = await p.evaluate(async (i) => {
    const el = document.querySelector(".tl-body input[type=range]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(i));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.querySelector(".tl-desc")?.textContent ?? "";
  }, i);
  await p.waitForTimeout(i === n ? 2500 : 60);
  await p.screenshot({ path: `${out}/f${String(k).padStart(4, "0")}.jpg`, type: "jpeg", quality: 88 });
  meta.push({ k, i, desc });
  if (i % 50 === 0) console.log(i, desc);
}
fs.writeFileSync(`${out}/meta.json`, JSON.stringify(meta, null, 1));
await b.close();
console.log("готово");
