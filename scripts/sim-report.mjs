/**
 * Отчёт о тестовой партии из report.json (scripts/sim-game.mjs): сжимает снимки в webp, пишет README.md
 * и одностраничный report.html (для просмотра вне репозитория). Запуск: node scripts/sim-report.mjs <папка отчёта>
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const DIR = process.argv[2] ?? "docs/reports/test-game-2026-09-18";
const R = JSON.parse(readFileSync(join(DIR, "report.json"), "utf8"));
// Сжатие PNG → webp (телефон 780 px, экран администратора 1200 px), через pillow.
execFileSync("python3", ["-c", `
import glob, os
from PIL import Image
D = ${JSON.stringify(join(DIR, "img"))}
for p in sorted(glob.glob(os.path.join(D, "*.png"))):
    im = Image.open(p).convert("RGB")
    w = 1200 if im.width > im.height else 780
    if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(p[:-4] + ".webp", "WEBP", quality=80, method=6); os.remove(p)
`]);
const WHO = (n) => (n === "tg_admin" ? "администратор, компьютер" : `участник ${n.replace("tg_", "")}, телефон`);
const webp = (f) => f.replace(/\.png$/, ".webp");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const mins = Math.round(R.minutes ?? 0);

let md = `# Тестовая партия 18.09: три команды по шесть, все механики за ${mins} минут\n\n`;
md += `Игра сыграна ботами на стенде (${R.base}) в ускоренном режиме: сроки вызовов, осад и возврата дел заданы в долях дня в продвинутых настройках. Команды «Моряки», «Берег», «Пустыня» — по шесть участников с капитаном, заместителем и ролями (разведчик, пророк, посол, кормчий). Реальных людей в партии нет.\n\n`;
md += `Снимки: телефон — экраны участников, компьютер — администратор. Подписи объясняют, что происходит на экране.\n\n`;
const phases = [...new Set(R.entries.map((e) => e.phase))];
md += `## Содержание\n\n` + phases.map((p) => `- ${p}`).join("\n") + `\n- Что не сработало\n\n`;
for (const p of phases) {
  md += `## ${p}\n\n`;
  for (const e of R.entries.filter((x) => x.phase === p)) {
    md += `### ${e.title}\n\n${e.text}\n\n`;
    for (const s of e.shots) md += `![${s.caption}](img/${webp(s.file)})\n\n*${s.caption}* (${WHO(s.who)})\n\n`;
  }
}
md += `## Что не сработало\n\n`;
md += R.failures.length ? R.failures.map((f) => `- **${f.title}** — ${f.error}`).join("\n") + "\n\n" : "Сбоев не зафиксировано.\n\n";
md += `## Журнал прогона\n\n\`\`\`\n${(R.log ?? []).join("\n")}\n\`\`\`\n`;
writeFileSync(join(DIR, "README.md"), md);

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Тестовая партия 18.09</title>
<style>
:root{--bg:#F6F4EF;--ink:#2A241E;--muted:#6B645A;--accent:#C7742A;--line:#E3DDD0;--card:#fff}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 Inter,system-ui,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.8rem;line-height:1.2;margin:0 0 8px}h2{font-size:1.35rem;margin:40px 0 12px;padding-top:12px;border-top:2px solid var(--accent)}h3{font-size:1.1rem;margin:24px 0 6px}
p{max-width:70ch}.lead{color:var(--muted)}
.toc{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.toc a{font-size:.9rem;padding:4px 10px;border-radius:999px;background:#FBEEDF;color:var(--ink);text-decoration:none}
.shots{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;margin:12px 0 20px}
figure{margin:0;flex:1 1 240px;max-width:300px}figure.wide{flex-basis:100%;max-width:100%}
figure img{display:block;width:100%;height:auto;border-radius:8px;border:1px solid var(--line);box-shadow:0 1px 3px rgba(0,0,0,.08)}
figcaption{font-size:.9rem;color:var(--muted);margin-top:6px}figcaption b{color:var(--ink);font-weight:600}
.fail{background:#FBE9E5;border-left:4px solid #B3402F;padding:10px 14px;border-radius:6px;margin:8px 0}
.ok{background:#E6F2E9;border-left:4px solid #356A44;padding:10px 14px;border-radius:6px}
pre{background:#fff;border:1px solid var(--line);border-radius:8px;padding:12px;font-size:.8rem;overflow:auto}
</style></head><body><div class="wrap">
<h1>Тестовая партия 18.09</h1>
<p class="lead">Три команды по шесть ботов, все механики игры за ${mins} минут в ускоренном режиме на стенде. Снимки: телефон — участники, компьютер — администратор.</p>
<div class="toc">${phases.map((p, i) => `<a href="#p${i}">${esc(p)}</a>`).join("")}<a href="#fail">Что не сработало</a></div>
${phases.map((p, i) => `<h2 id="p${i}">${esc(p)}</h2>` + R.entries.filter((x) => x.phase === p).map((e) => `<h3>${esc(e.title)}</h3><p>${esc(e.text)}</p><div class="shots">${e.shots.map((s) => `<figure class="${s.who === "tg_admin" ? "wide" : ""}"><img src="img/${webp(s.file)}" alt="${esc(s.caption)}" loading="lazy"><figcaption><b>${esc(s.caption)}</b><br>${esc(WHO(s.who))}</figcaption></figure>`).join("")}</div>`).join("")).join("")}
<h2 id="fail">Что не сработало</h2>
${R.failures.length ? R.failures.map((f) => `<div class="fail"><b>${esc(f.title)}</b> — ${esc(f.error)}</div>`).join("") : `<div class="ok">Сбоев не зафиксировано.</div>`}
<h2>Журнал прогона</h2><pre>${esc((R.log ?? []).join("\n"))}</pre>
</div></body></html>`;
writeFileSync(join(DIR, "report.html"), html);
console.log(`готово: ${R.entries.reduce((a, e) => a + e.shots.length, 0)} снимков, сбоев ${R.failures.length}`);
if (!existsSync(join(DIR, "img"))) console.warn("нет папки img");
