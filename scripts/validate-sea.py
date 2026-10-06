#!/usr/bin/env python3
"""Проверка контента моря: python3 scripts/validate-sea.py content/seas/<code>.json [...]
Сверяет ссылки на стихи с content/bible/<книга>.json, слова маяка и флагов, длину стихов для курса и шторма,
считает ответ лота, проверяет текстовые ответы по показанным отрывкам и книге. Выход 1, если есть ошибки."""
import json, re, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def norm(s): return re.sub(r"\s+", " ", re.sub(r"[^\w]+", " ", s.lower().replace("ё", "е"), flags=re.U)).strip()
def words(text): return [w for w in (re.sub(r"^[^\w‐-]+|[^\w‐-]+$", "", t) for t in text.split()) if re.search(r"[^\W\d_]", w)]
BIBLE = {}
def book(code):
    if code not in BIBLE: BIBLE[code] = json.load(open(os.path.join(ROOT, "content", "bible", f"{code}.json"), encoding="utf-8"))
    return BIBLE[code]
def verse(code, ch, v):
    b = book(code); chs = b.get("chapters")
    if not chs or ch < 1 or ch > len(chs) or v < 1 or v > len(chs[ch - 1]): return None
    return chs[ch - 1][v - 1]
def pick(ws, which): return ws[0] if which == "first" else ws[-1] if which == "last" else (ws[which - 1] if 1 <= which <= len(ws) else None)

def check(path):
    errs, info = [], []
    d = json.load(open(path, encoding="utf-8"))
    ts = d.get("tasks", [])
    if len(ts) != 10: errs.append(f"вахт {len(ts)}, нужно 10")
    for k in ("code", "name", "nameEn", "intro"):
        if not d.get(k): errs.append(f"нет поля {k}")
    types = [t.get("type") for t in ts]
    for need in ("beacon", "wordpath", "flags", "storm", "count"):
        if need not in types: errs.append(f"нет вахты типа {need}")
    for i, t in enumerate(ts, 1):
        ty = t.get("type"); p = f"вахта {i} ({ty})"
        if not t.get("title") or not t.get("prompt"): errs.append(f"{p}: нет title/prompt")
        for sh in t.get("show", []):
            for v in range(sh["from"], sh["to"] + 1):
                if verse(sh["book"], sh["chapter"], v) is None: errs.append(f"{p}: нет стиха {sh['book']} {sh['chapter']}:{v}")
        if ty in ("beacon", "flags"):
            for v in t["verses"]:
                txt = verse(t["book"], t["chapter"], v)
                if txt is None: errs.append(f"{p}: нет стиха {t['book']} {t['chapter']}:{v}"); continue
                w = pick(words(txt), t["word"])
                if not w or len(w) < 2: errs.append(f"{p}: слово стиха {v} не годится: {w!r}")
                else: info.append(f"{p}: {t['chapter']}:{v} → «{w}»")
            if ty == "beacon" and any(v > 99 for v in t["verses"]): errs.append(f"{p}: маяк показывает только стихи до 99")
        elif ty in ("wordpath", "storm"):
            txt = verse(t["book"], t["chapter"], t["verse"])
            if txt is None: errs.append(f"{p}: нет стиха"); continue
            ws = words(txt); n = t.get("words") or (10 if ty == "wordpath" else 20)
            take = ws[:n]
            if ty == "wordpath" and (len(take) < 5 or len(take) > 14): errs.append(f"{p}: слов {len(take)}, нужно 5–14")
            if ty == "storm" and (len(take) < 5 or len(take) > 20): errs.append(f"{p}: слов {len(take)}, нужно 5–20")
            if ty == "storm" and t.get("words") and t["words"] < len(ws): errs.append(f"{p}: шторм собирает стих целиком, а words меньше длины стиха ({len(ws)})")
            info.append(f"{p}: {len(take)} слов: {' '.join(take)}")
        elif ty == "count":
            stem = norm(t["stem"]); n = 0
            for v in range(t["from"], t["to"] + 1):
                txt = verse(t["book"], t["chapter"], v)
                if txt is None: errs.append(f"{p}: нет стиха {v}"); break
                n += sum(1 for w in words(txt) if norm(w).startswith(stem))
            if n < 3: errs.append(f"{p}: корень «{t['stem']}» встречается всего {n} раз")
            info.append(f"{p}: «{t['stem']}» × {n}")
        elif ty == "text":
            src = " ".join(verse(sh["book"], sh["chapter"], v) or "" for sh in t.get("show", []) for v in range(sh["from"], sh["to"] + 1))
            if src and not any(norm(a) in norm(src) for a in t["answers"]): errs.append(f"{p}: ни один ответ не найден в показанных стихах")
            if "…" in t["prompt"] and not src:
                m = re.search(r"([^:]+?)(\d+):(\d+)", t["prompt"])
                if not m: errs.append(f"{p}: в задании с пропуском нет ссылки на стих")
        elif ty == "choice":
            if not (0 <= t["correct"] < len(t["options"])): errs.append(f"{p}: correct вне вариантов")
        elif ty == "order":
            if len(t["items"]) < 3: errs.append(f"{p}: меньше трёх пунктов")
        elif ty == "number":
            if not isinstance(t["answer"], (int, float)): errs.append(f"{p}: ответ не число")
        else: errs.append(f"{p}: неизвестный тип")
    return errs, info

bad = 0
for path in sys.argv[1:]:
    errs, info = check(path)
    print(f"== {path}")
    for l in info: print("   ", l)
    for e in errs: print("   ОШИБКА:", e)
    bad += len(errs)
sys.exit(1 if bad else 0)
