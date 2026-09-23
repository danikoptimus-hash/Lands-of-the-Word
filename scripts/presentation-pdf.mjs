// Презентация для видео (docs/presentation/lands-of-the-word.html) → PDF тем же каталогом. Слайды 1920×1080, картинки — снимки инструкции.
// Запуск из корня: node scripts/presentation-pdf.mjs  (нужен Chromium Playwright, как для guide-shots.mjs).
import { chromium } from "playwright";
import path from "node:path";
const src = path.resolve("docs/presentation/lands-of-the-word.html"), out = path.resolve("docs/presentation/lands-of-the-word.pdf");
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto("file://" + src, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(500);
await page.pdf({ path: out, width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true });
console.log("готово:", out, "слайдов:", await page.locator("section.s").count());
await browser.close();
