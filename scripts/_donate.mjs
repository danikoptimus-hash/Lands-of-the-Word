import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const [name, vp] of [["desk", { viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1.5 }], ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const p = await b.newPage(vp); await p.goto("http://localhost:3000/donate"); await p.waitForTimeout(1200);
  await p.screenshot({ path: "/tmp/claude-0/-home-user-Lands-of-the-Word/d8e856f4-8e32-5733-84dd-3357c8f44241/scratchpad/donate-" + name + ".png", fullPage: true }); await p.close();
}
await b.close();
