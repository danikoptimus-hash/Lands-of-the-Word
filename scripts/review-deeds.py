#!/usr/bin/env python3
"""Список дел по умолчанию (content/deeds-default.json) для ревизии, с нумерацией."""
import json, html
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
e = html.escape
PROOF = {"CONFIRMATION": "подтверждение админом", "PHOTO_LINK": "ссылка на фото", "VIDEO_LINK": "ссылка на видео", "REPORT": "отчёт текстом"}
deeds = json.loads((ROOT / "content/deeds-default.json").read_text())
print("""<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Земли Слова — дела</title>
<style>@page { size: A4; margin: 16mm 14mm; } body { font-family: "DejaVu Sans", sans-serif; font-size: 10pt; color: #1F1B16; }
h1 { font-size: 20pt; } table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #CFC7B8; padding: 4px 6px; vertical-align: top; text-align: left; } th { background: #FBEEDF; }
</style></head><body><h1>Земли Слова — дела по умолчанию</h1>
<p>Это стартовый список, который админ получает в новой игре и может менять (добавлять, править, удалять). Сложность — очки за одно выполнение. «Повтор» — можно ли сдавать дело несколько раз. Ответить можно по номерам.</p>
<table><tr><th>№</th><th>Дело</th><th>Описание</th><th>Направление</th><th>Подтверждение</th><th>Очки</th><th>Повтор</th></tr>""")
for i, d in enumerate(deeds, 1):
    print(f'<tr><td>{i}</td><td><b>{e(d["title"])}</b></td><td>{e(d["description"])}</td><td>{e(d["direction"])}</td><td>{PROOF.get(d["proofType"], d["proofType"])}</td><td>{d["difficulty"]}</td><td>{"да" if d["canRepeat"] else "нет"}</td></tr>')
print(f"</table><p>Всего дел: {len(deeds)}. Направления: {e(', '.join(sorted(set(d['direction'] for d in deeds))))}.</p></body></html>")
