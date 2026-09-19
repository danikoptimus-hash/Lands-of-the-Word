/**
 * Отчёт «было/стало» по всем экранам (решение владельца 18.09): пары снимков из двух прогонов scripts/ui-tour.mjs.
 * Запуск: node scripts/ui-report.mjs <папка «было»> <папка «стало»> <папка отчёта>; заголовок — переменная UI_TITLE (необязательно).
 * Снимки сжимаются в webp (телефон 780 px, компьютер 1200 px), пишутся README.md и artifact.html (для публикации).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

const [BEFORE, AFTER, OUT] = process.argv.slice(2);
const TITLE = process.env.UI_TITLE ?? "Оформление «игра, а не сайт»: было и стало";
if (!BEFORE || !AFTER || !OUT) { console.error("нужны три папки: было, стало, отчёт"); process.exit(1); }
mkdirSync(join(OUT, "img"), { recursive: true });
const before = JSON.parse(readFileSync(join(BEFORE, "tour.json"), "utf8"));
const after = JSON.parse(readFileSync(join(AFTER, "tour.json"), "utf8"));
// Пары по имени экрана (name), порядок — как в «стало».
const pairs = after.map((a) => ({ a, b: before.find((x) => x.name === a.name) })).filter((p) => p.a.ok);
execFileSync("python3", ["-c", `
import os, sys
from PIL import Image
pairs = ${JSON.stringify(pairs.map((p) => [p.b ? join(BEFORE, p.b.file) : "", join(AFTER, p.a.file), p.a.name]))}
out = ${JSON.stringify(join(OUT, "img"))}
for b, a, name in pairs:
    for src, tag in ((b, "before"), (a, "after")):
        if not src or not os.path.exists(src): continue
        im = Image.open(src).convert("RGB")
        w = 1200 if im.width > im.height else 780
        if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        # Очень высокие снимки (полная высота меню) режем до 4 экранов, чтобы отчёт оставался обозримым.
        if im.height > im.width * 4.2: im = im.crop((0, 0, im.width, int(im.width * 4.2)))
        im.save(os.path.join(out, f"{name}-{tag}.webp"), "WEBP", quality=78, method=6)
`]);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const who = (x) => (x.who === "гость" ? "гость" : x.kind === "desk" ? "администратор, компьютер" : x.who.startsWith("tg_admin") ? "администратор, телефон" : "участник, телефон");
let md = `# ${TITLE} — по всем экранам\n\n`;
md += `Решение владельца 18.09: убрать белые фоны и «офисные» блоки, спрятать пояснения за кнопки, оформить интерфейс материалами игры — пергамент, дерево, бронза, сургуч. Снимки сделаны на стенде с данными тестовой партии (команды «Моряки», «Берег», «Пустыня»; реальных людей нет). Слева — до правок, справа — после.\n\n`;
for (const p of pairs) md += `## ${p.a.caption}\n\n*${who(p.a)}*\n\n| Было | Стало |\n|---|---|\n| ${p.b ? `![было](img/${p.a.name}-before.webp)` : "—"} | ![стало](img/${p.a.name}-after.webp) |\n\n`;
writeFileSync(join(OUT, "README.md"), md);
const html = `<title>${TITLE}</title>
<style>
:root{--bg:#F2E7CF;--ink:#2B1D12;--muted:#5C4A36;--accent:#A8722E;--line:#C9B58C;--card:#FFF6E3}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1F1B17;--ink:#EDE6DA;--muted:#A79C8E;--accent:#E0965A;--line:#3B342C;--card:#2A241E}}
:root[data-theme="dark"]{--bg:#1F1B17;--ink:#EDE6DA;--muted:#A79C8E;--accent:#E0965A;--line:#3B342C;--card:#2A241E}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 Georgia,"Times New Roman",serif}
.wrap{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.9rem;line-height:1.15;margin:0 0 8px;text-wrap:balance}h2{font-size:1.25rem;margin:36px 0 6px;padding-top:10px;border-top:2px solid var(--accent)}
p{max-width:70ch}.lead{color:var(--muted)}.who{color:var(--muted);font-size:.9rem;margin:0 0 10px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}.pair.desk{grid-template-columns:1fr}
.pair figure{margin:0}.pair img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:6px;background:var(--card)}
figcaption{font-size:.85rem;color:var(--muted);margin-top:4px;text-transform:uppercase;letter-spacing:.06em}
.toc{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.toc a{font-size:.85rem;padding:4px 10px;border-radius:999px;background:var(--card);color:var(--ink);text-decoration:none;border:1px solid var(--line)}
@media (max-width:700px){.pair{grid-template-columns:1fr}}
</style>
<div class="wrap">
<h1>${TITLE}</h1>
<p class="lead">Все экраны игрока (телефон) и администратора (компьютер и телефон) до и после правок. Стенд с данными тестовой партии; реальных людей нет.</p>
<div class="toc">${pairs.map((p, i) => `<a href="#s${i}">${esc(p.a.caption)}</a>`).join("")}</div>
${pairs.map((p, i) => `<h2 id="s${i}">${esc(p.a.caption)}</h2><p class="who">${esc(who(p.a))}</p><div class="pair${p.a.kind === "desk" ? " desk" : ""}">${p.b ? `<figure><img src="img/${p.a.name}-before.webp" alt="было" loading="lazy"><figcaption>Было</figcaption></figure>` : ""}<figure><img src="img/${p.a.name}-after.webp" alt="стало" loading="lazy"><figcaption>Стало</figcaption></figure></div>`).join("")}
</div>`;
writeFileSync(join(OUT, "artifact.html"), html);
console.log(`пар: ${pairs.length}, папка ${OUT}`);
if (!existsSync(join(OUT, "img"))) console.warn("нет папки img");
