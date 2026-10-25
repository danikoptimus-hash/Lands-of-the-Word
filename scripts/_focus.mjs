import { chromium } from "playwright";
const S = process.argv[2], PASS = process.env.SIM_PASS, GID = "cmv2i9igd00pc7dk80kcj7kcz";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, baseURL: "http://localhost:3000" });
await ctx.request.post("/api/auth/login", { data: { nickname: "tg_admin", password: PASS } });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await p.goto(`/games/${GID}#journal`);
await p.waitForSelector(".feed button.linkish", { timeout: 30000 });
await p.waitForTimeout(1500);
const measure = async (label) => {
  const r = await p.evaluate(() => {
    const dot = document.querySelector(".adm-flash .dot"), wrap = document.querySelector(".mapwrap");
    if (!dot || !wrap) return null;
    const d = dot.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(wrap).getPropertyValue("--map-pad-left")) || 0;
    return { dx: Math.round(d.x + d.width / 2 - (w.x + pad + (w.width - pad) / 2)), dy: Math.round(d.y + d.height / 2 - (w.y + w.height / 2)), wrapW: w.width, pad };
  });
  console.log(label, JSON.stringify(r));
};
for (let i = 0; i < 4; i++) {
  if (i > 0) { await p.locator(".dock-btn", { hasText: "Летопись" }).click(); await p.waitForSelector(".feed button.linkish"); await p.waitForTimeout(400); }
  await p.locator(".feed button.linkish").nth(i).click();
  await p.waitForSelector(".task-report");
  await p.waitForTimeout(500);
  await p.locator(".task-report button[aria-label='Посмотреть на карте']").click();
  await p.waitForTimeout(150); await measure(`try${i} @150ms`);
  await p.waitForTimeout(1200); await measure(`try${i} @1350ms`);
  if (i === 0) await p.screenshot({ path: S + "/focus-0.png" });
}
await b.close();
