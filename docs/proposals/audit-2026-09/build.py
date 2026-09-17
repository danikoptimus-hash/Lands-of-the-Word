#!/usr/bin/env python3
"""Сборка экспертного заключения: главы ch*.md → REPORT.md (единый Markdown) и report.html (страница с
встроенными SVG, оглавлением и сводной таблицей предложений). Использование: python3 build.py [out.html]"""
import re, sys, html, json
from pathlib import Path
import markdown

HERE = Path(__file__).resolve().parent
OUT_HTML = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "report.html"
ORDER = ["ch01-summary.md", "ch02-mechanics.md", "ch03-strategy.md", "ch04-engagement.md", "ch05-city-tasks.md",
         "ch06-deeds.md", "ch07-battles.md", "ch08-diplomacy-roles.md", "ch09-map-world.md", "ch10-admin-ops.md",
         "ch11-tech.md", "ch12-penalties.md", "ch13-roadmap.md"]
PROP = re.compile(r"^###\s+([A-Z]{1,2})-(\d{2})\.\s+(.+?)\s*$", re.M)
META = re.compile(r"\*\*Сложность:\*\*\s*([SML](?:[–-][SML])?)(?:\s*\([^)]*\))?\s*·\s*\*\*Влияние:\*\*\s*(\d)\s*·\s*\*\*Этап:\*\*\s*([^\n]+)")
EFFORT = {"S": "малая", "M": "средняя", "L": "большая", "S–M": "малая–средняя", "S-M": "малая–средняя"}
CHAPTER_OF = {"I": "2", "S": "3", "E": "4", "C": "5", "D": "6", "B": "7", "R": "8", "M": "9", "A": "10", "T": "11", "P": "12"}

def load_chapters():
    chapters = []
    for name in ORDER:
        p = HERE / name
        if p.exists():
            chapters.append((name, split_fields(p.read_text(encoding="utf-8"))))
    return chapters

FIELDS = re.compile(r"\n(?!\n)(\*\*(?:Суть|Зачем|Как работает|Риски[^*\n]*)\.\*\*)")
def split_fields(text):
    """Поля предложения (Суть/Зачем/Как работает/Риски) — отдельными абзацами, а не одной простынёй."""
    return FIELDS.sub(r"\n\n\1", text)

def collect_props(text):
    """[(id, title, effort, impact, stage)] из текста главы."""
    out = []
    for m in PROP.finditer(text):
        pid = f"{m.group(1)}-{m.group(2)}"
        rest = text[m.end(): m.end() + 4000]
        nxt = PROP.search(rest)
        block = rest[: nxt.start()] if nxt else rest
        mm = META.search(block)
        out.append((pid, m.group(3).strip(), mm.group(1) if mm else "?", mm.group(2) if mm else "?", mm.group(3).strip() if mm else "?"))
    return out

def inline_svgs(md_text):
    """![подпись](img/x.svg) → <figure> со встроенным SVG (страница должна быть одним файлом)."""
    def rep(m):
        cap, src = m.group(1), m.group(2)
        p = HERE / src
        if not p.exists():
            return f'<figure class="fig missing"><figcaption>{html.escape(cap)} (иллюстрация отсутствует: {html.escape(src)})</figcaption></figure>'
        svg = p.read_text(encoding="utf-8")
        svg = re.sub(r"<\?xml[^>]*\?>", "", svg).strip()
        svg = re.sub(r"<svg\b", '<svg class="ill"', svg, count=1)
        return f'<figure class="fig">{svg}<figcaption>{html.escape(cap)}</figcaption></figure>'
    return re.sub(r"!\[([^\]]*)\]\(([^)]+\.svg)\)", rep, md_text)

def decorate_props(md_text):
    """Строка метаданных предложения → плашки; заголовок предложения получает якорь по ID."""
    md_text = META.sub(lambda m: f'<p class="meta"><span class="chip eff-{m.group(1)[0]}">сложность: {EFFORT.get(m.group(1), m.group(1))}</span> <span class="chip imp">влияние: {m.group(2)}/5</span> <span class="chip stage">этап: {html.escape(m.group(3).strip())}</span></p>', md_text)
    md_text = PROP.sub(lambda m: f'### <span class="pid">{m.group(1)}-{m.group(2)}</span> {m.group(3)} {{#{m.group(1).lower()}-{m.group(2)}}}', md_text)
    return md_text

def main():
    chapters = load_chapters()
    all_props = []
    for name, text in chapters:
        all_props += [(name,) + p for p in collect_props(text)]
    # ── единый Markdown ──
    full = ["# Земли Слова — экспертное заключение по механикам, стратегии и развитию игры\n",
            "_Сентябрь 2026. Сводный отчёт экспертного совета: механики как есть, дыры в стратегии, вовлечение, "
            "мини-фишки заданий, дела, испытания, дипломатия, карта, администрирование, техническая реализуемость, дорожная карта._\n",
            "\n## Оглавление\n"]
    for name, text in chapters:
        h = re.search(r"^#\s+(.+)$", text, re.M)
        full.append(f"- {h.group(1).strip() if h else name}")
    full.append(f"- Приложение. Сводный список предложений ({len(all_props)})\n")
    for name, text in chapters:
        full.append("\n---\n")
        full.append(text.strip() + "\n")
    full.append("\n---\n\n## Приложение. Сводный список предложений\n\n| № | Предложение | Сложность | Влияние | Этап |\n|---|---|---|---|---|")
    for _, pid, title, eff, imp, stage in all_props:
        full.append(f"| {pid} | {title} | {EFFORT.get(eff, eff)} | {imp} | {stage} |")
    (HERE / "REPORT.md").write_text("\n".join(full) + "\n", encoding="utf-8")

    # ── HTML ──
    md = markdown.Markdown(extensions=["tables", "fenced_code", "attr_list", "toc", "sane_lists"], extension_configs={"toc": {"toc_depth": "1-2"}})
    parts, toc_items = [], []
    for name, text in chapters:
        body = decorate_props(inline_svgs(text))
        h = re.search(r"^#\s+(.+)$", text, re.M)
        title = h.group(1).strip() if h else name
        cid = "ch-" + name[:4]
        toc_items.append((cid, title))
        md.reset()
        conv = md.convert(body).replace('<table>', '<div class="scroll"><table>').replace('</table>', '</table></div>')
        parts.append(f'<section class="chapter" id="{cid}">{conv}</section>')
    rows = "".join(f'<tr><td><a href="#{pid.lower()}">{pid}</a></td><td>{html.escape(t)}</td><td><span class="chip eff-{e[0]}">{EFFORT.get(e, e)}</span></td><td class="num">{i}</td><td>{html.escape(s)}</td></tr>' for _, pid, t, e, i, s in all_props)
    appendix = f'<section class="chapter" id="appendix"><h1>Приложение. Сводный список предложений</h1><p class="lead">{len(all_props)} предложений из всех глав. Нажмите номер, чтобы перейти к описанию.</p><div class="scroll"><table class="index"><thead><tr><th>№</th><th>Предложение</th><th>Сложность</th><th>Влияние</th><th>Этап</th></tr></thead><tbody>{rows}</tbody></table></div></section>'
    toc = "".join(f'<li><a href="#{cid}">{html.escape(t)}</a></li>' for cid, t in toc_items) + '<li><a href="#appendix">Приложение. Сводный список предложений</a></li>'
    words = sum(len(re.findall(r"\w+", t)) for _, t in chapters)
    page = TEMPLATE.replace("{{TOC}}", toc).replace("{{BODY}}", "".join(parts) + appendix).replace("{{WORDS}}", f"{words:,}".replace(",", " ")).replace("{{NPROPS}}", str(len(all_props)))
    OUT_HTML.write_text(page, encoding="utf-8")
    print(f"глав: {len(chapters)}, предложений: {len(all_props)}, слов: {words}, html: {OUT_HTML} ({OUT_HTML.stat().st_size // 1024} КБ)")

TEMPLATE = """<title>Земли Слова · Экспертный совет</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Philosopher:wght@400;700&family=PT+Serif:ital,wght@0,400;0,700;1,400&family=PT+Sans:wght@400;700&display=swap">
<style>
:root{--bg:#f6f4ef;--paper:#fffdf9;--ink:#1f1b16;--muted:#6b645a;--line:#e3ddd0;--accent:#c7742a;--accent-soft:#f7e6d6;--sea:#2e627e;--sea-soft:#dfeaf0;--moss:#4c7a3f;--moss-soft:#e3ecdd;--wine:#8a3b32;--wine-soft:#f2dcd9;--chip:#efe9dd}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#17150f;--paper:#1f1c15;--ink:#ece6da;--muted:#a59d8e;--line:#3a3529;--accent:#e08a3e;--accent-soft:#3a2a1a;--sea:#7fb0cc;--sea-soft:#1c2c36;--moss:#8fbf7f;--moss-soft:#1e2a1a;--wine:#d9877b;--wine-soft:#3a201d;--chip:#2a261d}}
:root[data-theme="dark"]{--bg:#17150f;--paper:#1f1c15;--ink:#ece6da;--muted:#a59d8e;--line:#3a3529;--accent:#e08a3e;--accent-soft:#3a2a1a;--sea:#7fb0cc;--sea-soft:#1c2c36;--moss:#8fbf7f;--moss-soft:#1e2a1a;--wine:#d9877b;--wine-soft:#3a201d;--chip:#2a261d}
body{background:var(--bg);color:var(--ink);font-family:"PT Serif",Georgia,serif;font-size:17px;line-height:1.6;margin:0}
.wrap{max-width:1180px;margin:0 auto;padding-block:32px 80px;padding-inline:16px;display:grid;grid-template-columns:1fr;gap:32px}
@media(min-width:1100px){.wrap{grid-template-columns:280px minmax(0,1fr)}nav.toc{position:sticky;top:env(safe-area-inset-top,0px);max-height:calc(100vh - 24px);overflow:auto}}
nav.toc{align-self:start;font-family:"PT Sans",Arial,sans-serif;font-size:14px;padding:16px;border:1px solid var(--line);background:var(--paper);border-radius:8px}
nav.toc h2{font-family:Philosopher,serif;font-size:15px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 10px;color:var(--muted)}
nav.toc ol{list-style:none;margin:0;padding:0;display:grid;gap:6px}nav.toc a{color:var(--ink);text-decoration:none}nav.toc a:hover{color:var(--accent)}
header.head{grid-column:1/-1;border-bottom:2px solid var(--accent);padding-bottom:20px}
header.head h1{font-family:Philosopher,serif;font-size:clamp(30px,4.6vw,46px);line-height:1.1;margin:0 0 10px;text-wrap:balance}
header.head .sub{color:var(--muted);font-family:"PT Sans",Arial,sans-serif;font-size:15px;display:flex;flex-wrap:wrap;gap:8px 20px}
main{min-width:0}
.chapter{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:clamp(18px,3vw,40px);margin-bottom:28px}
.chapter h1{font-family:Philosopher,serif;font-size:clamp(26px,3.4vw,36px);line-height:1.15;margin:0 0 16px;text-wrap:balance;color:var(--accent)}
.chapter h2{font-family:Philosopher,serif;font-size:24px;margin:40px 0 12px;padding-top:16px;border-top:1px solid var(--line);text-wrap:balance}
.chapter h3{font-family:Philosopher,serif;font-size:20px;margin:32px 0 8px;text-wrap:balance}
.chapter h4{font-family:"PT Sans",Arial,sans-serif;font-size:16px;margin:20px 0 6px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.chapter p,.chapter li{max-width:72ch}.chapter ul,.chapter ol{padding-left:1.3em}
.chapter blockquote{border-left:3px solid var(--sea);margin:16px 0;padding:6px 16px;background:var(--sea-soft);color:var(--ink);border-radius:0 6px 6px 0}
.chapter code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em;background:var(--chip);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}
.chapter p,.chapter li,.chapter td,.chapter th{overflow-wrap:anywhere}
.chapter pre{overflow-x:auto;background:var(--chip);padding:12px 14px;border-radius:6px;font-size:14px;line-height:1.45}.chapter pre code{background:none;padding:0}
.pid{display:inline-block;font-family:"PT Sans",Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:.05em;background:var(--accent);color:#fff;padding:2px 8px;border-radius:999px;vertical-align:middle;margin-right:6px}
p.meta{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 14px}
.chip{display:inline-block;font-family:"PT Sans",Arial,sans-serif;font-size:13px;padding:2px 10px;border-radius:999px;background:var(--chip);color:var(--ink);white-space:nowrap}
.chip.eff-S{background:var(--moss-soft);color:var(--moss)}.chip.eff-M{background:var(--accent-soft);color:var(--accent)}.chip.eff-L{background:var(--wine-soft);color:var(--wine)}.chip.imp{background:var(--sea-soft);color:var(--sea)}
figure.fig{margin:22px 0;padding:12px;border:1px solid var(--line);border-radius:8px;background:#fff}
figure.fig svg.ill{width:100%;height:auto;display:block}figcaption{font-family:"PT Sans",Arial,sans-serif;font-size:14px;color:var(--muted);margin-top:8px}
figure.missing{background:var(--wine-soft);color:var(--wine)}
.scroll{overflow-x:auto;max-width:100%}table{border-collapse:collapse;width:100%;font-family:"PT Sans",Arial,sans-serif;font-size:14.5px;margin:14px 0}
th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}th{font-weight:700;background:var(--chip);position:sticky;top:0}
td.num{font-variant-numeric:tabular-nums;text-align:center}table.index a{color:var(--accent);font-weight:700;text-decoration:none}table.index th,table.index td:first-child{white-space:nowrap}
.lead{font-size:18px;color:var(--muted)}a{color:var(--sea)}
@media(prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
</style>
<div class="wrap">
<header class="head"><h1>Земли Слова. Экспертное заключение по механикам, стратегии и развитию</h1>
<div class="sub"><span>Сентябрь 2026</span><span>Экспертный совет: 13 глав, 10 направлений</span><span>{{NPROPS}} предложений</span><span>≈ {{WORDS}} слов</span></div></header>
<nav class="toc"><h2>Главы</h2><ol>{{TOC}}</ol></nav>
<main>{{BODY}}</main>
</div>
"""

if __name__ == "__main__":
    main()
