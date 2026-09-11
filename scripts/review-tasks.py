#!/usr/bin/env python3
"""Сводный файл всех заданий городов для ревизии: нумерация сквозная, способ ввода, ответы.
Использование: python3 scripts/review-tasks.py > docs/review/tasks.html
"""
import json, html, sys, re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
ROOT = Path(__file__).resolve().parent.parent
BOOKS = ROOT / "packages/domain/src/books.ts"
order = re.findall(r'^\s*\["([a-z0-9]+)",', BOOKS.read_text(), re.M)
e = html.escape
INPUT = {
    "number": "число (поле для числа)",
    "text": "слово (текстовое поле; засчитывается любой из перечисленных вариантов, регистр не важен)",
    "choice": "выбор одного из 4 вариантов",
    "order": "расставить пункты по порядку (перетаскиванием)",
}
SCOPE = {"district": "район", "group": "несколько районов", "book": "вся книга"}
out = []
out.append("""<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Земли Слова — задания городов</title>
<style>
@page { size: A4; margin: 16mm 14mm 18mm 14mm; }
body { font-family: "DejaVu Sans", "Noto Sans", sans-serif; font-size: 9.6pt; line-height: 1.4; color: #1F1B16; }
h1 { font-size: 20pt; margin: 0 0 .2em; } h2 { font-size: 14pt; margin: 1.4em 0 .3em; border-bottom: 1.5px solid #C7742A; padding-bottom: .1em; page-break-after: avoid; page-break-before: always; }
h2:first-of-type { page-break-before: auto; }
.task { border: 1px solid #DDD6C8; border-radius: 6px; padding: 6px 9px; margin: 7px 0; page-break-inside: avoid; }
.num { font-weight: bold; color: #C7742A; font-size: 11pt; margin-right: .4em; }
.meta { color: #6B645A; font-size: 8.6pt; margin-bottom: 3px; }
.prompt { margin: 3px 0; }
.ans { background: #F6F4EF; border-radius: 4px; padding: 4px 7px; margin-top: 4px; }
.ans b { color: #2F6B3A; }
ol.opts { margin: 2px 0 0 0; padding-left: 1.5em; } ol.opts li.ok { font-weight: bold; color: #2F6B3A; }
.summary { color: #6B645A; font-style: italic; }
.toc { columns: 3; font-size: 9pt; } .toc div { break-inside: avoid; }
</style></head><body>""")
out.append("<h1>Земли Слова — все задания городов</h1>")
out.append("<p>Сквозная нумерация: отвечать можно по номерам («№ 57 — заменить ответ на …»). У каждого задания: книга, район (номер, стихи, название), тип ввода, текст задания и ответ. Ответы выделены зелёным. Перевод — Синодальный, русская нумерация стихов.</p>")
books = []
n = 0
body = []
for code in order:
    f = ROOT / "content/cities" / f"{code}.json"
    if not f.exists(): continue
    d = json.loads(f.read_text())
    ds, ts = d["districts"], d["tasks"]
    start = n + 1
    body.append(f'<h2 id="{code}">{e(d["title"])} <span class="meta">({code}, районов: {len(ds)}, заданий: {len(ts)})</span></h2>')
    for i, t in enumerate(ts):
        n += 1
        if t["scope"] == "district" and i < len(ds):
            dd = ds[i]; where = f'Район {i+1} · {e(dd["verses"])} · {e(dd["title"])}'
            summ = f'<div class="summary">{e(dd["summary"])}</div>'
        elif t["scope"] == "group":
            where = "Районы " + ", ".join(str(x) for x in t.get("groupDistricts", [])); summ = ""
        else:
            where = "Вся книга"; summ = ""
        body.append(f'<div class="task"><div class="meta"><span class="num">№ {n}</span>{where} · <b>ввод: {INPUT[t["type"]]}</b></div>{summ}<div class="prompt">{e(t["prompt"])}</div>')
        if t["type"] == "number":
            body.append(f'<div class="ans">Ответ: <b>{e(str(t["answer"]))}</b></div>')
        elif t["type"] == "text":
            body.append('<div class="ans">Принимаются: ' + ", ".join(f"<b>{e(a)}</b>" for a in t["answers"]) + "</div>")
        elif t["type"] == "choice":
            body.append('<div class="ans">Варианты (верный выделен):<ol class="opts">' + "".join(f'<li class="{"ok" if j == t["correct"] else ""}">{e(o)}</li>' for j, o in enumerate(t["options"])) + "</ol></div>")
        elif t["type"] == "order":
            body.append('<div class="ans">Правильный порядок:<ol class="opts">' + "".join(f"<li>{e(x)}</li>" for x in t["items"]) + "</ol></div>")
        body.append("</div>")
    books.append((code, d["title"], start, n))
out.append('<div class="toc">' + "".join(f'<div><a href="#{c}">{e(t)}</a> — № {a}–{b}</div>' for c, t, a, b in books) + "</div>")
out.append(f"<p>Всего заданий: {n}.</p>")
out.extend(body)
out.append("</body></html>")
print("\n".join(out))
