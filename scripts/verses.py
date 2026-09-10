#!/usr/bin/env python3
"""Печатает стихи Синодального перевода: python3 scripts/verses.py rut 1:1–5   |   python3 scripts/verses.py rut 2   |   python3 scripts/verses.py rut 3–4
Поиск слова по книге: python3 scripts/verses.py rut --find крыло"""
import json, sys, os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
code = sys.argv[1]; b = json.load(open(os.path.join(ROOT, "content", "bible", f"{code}.json"), encoding="utf-8"))
counts = b["verseCounts"]
if sys.argv[2] == "--find":
    q = sys.argv[3].lower().replace("ё", "е")
    for c, ch in enumerate(b["chapters"], 1):
        for v, txt in enumerate(ch, 1):
            if q in txt.lower().replace("ё", "е"): print(f"{c}:{v} {txt}")
    sys.exit()
r = sys.argv[2].replace("—", "–").replace("-", "–")
m = re.fullmatch(r"(\d+):(\d+)(?:–(?:(\d+):)?(\d+))?", r)
if m: c1, v1 = int(m[1]), int(m[2]); c2 = int(m[3]) if m[3] else c1; v2 = int(m[4]) if m[4] else v1
else:
    m = re.fullmatch(r"(\d+)(?:–(\d+))?", r); c1 = int(m[1]); c2 = int(m[2]) if m[2] else c1; v1, v2 = 1, None
for c in range(c1, c2 + 1):
    a = v1 if c == c1 else 1; z = (v2 if v2 is not None else counts[c - 1]) if c == c2 else counts[c - 1]
    for v in range(a, z + 1): print(f"{c}:{v} {b['chapters'][c-1][v-1]}")
