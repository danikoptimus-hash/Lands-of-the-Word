// Покадровый рендер ролика о Каменоломне: preview <t1,t2,...> — снимки JPEG в R/prev; video <from> <to> <out.mp4>.
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { spawn } from "node:child_process";
import path from "node:path";
const D = path.dirname(new URL(import.meta.url).pathname);
const [mode, a, b, out] = process.argv.slice(2);
const br = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--allow-file-access-from-files"] });
const p = await br.newPage({ viewport: { width: 1920, height: 1080 } });
p.on("pageerror", (e) => console.log("pageerror:", e.message));
await p.goto("file://" + path.join(D, "index.html"));
await p.evaluate(() => window.ready);
if (mode === "preview") {
  for (const t of a.split(",").map(Number)) { await p.evaluate((t) => window.render(t), t); await p.screenshot({ path: path.join(process.env.R ?? path.join(D, ".."), "prev", `t${String(t).replace(".", "_")}.jpg`), type: "jpeg", quality: 85 }); }
} else {
  const fps = 30, f0 = Math.round(+a * fps), f1 = Math.round(+b * fps);
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(fps), out], { stdio: ["pipe", "inherit", "inherit"] });
  const t0 = Date.now();
  for (let f = f0; f < f1; f++) {
    await p.evaluate((t) => window.render(t), f / fps);
    const buf = await p.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if ((f - f0) % 300 === 0) console.log(`кадр ${f - f0}/${f1 - f0}, ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  }
  ff.stdin.end(); await new Promise((r) => ff.on("close", r));
}
await br.close(); console.log("готово");
