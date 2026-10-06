#!/usr/bin/env python3
"""Проверка контента моря: python3 scripts/validate-sea.py content/seas/<code>.json [...]
Десять вахт (решение владельца 06.10, вторая редакция): маяк, диск кормчего, две гарнитуры, что изменилось, обрывки
карты, пеленги, счисление пути, разгрузка, прибор и устав, судовая роль. Сверяет ссылки на стихи с content/bible,
слова ответов, геометрию карты, решаемость разгрузки (поиск в ширину). Выход 1, если есть ошибки."""
import json, re, sys, os
from collections import deque
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALPHABET = "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"  # 32 буквы без Ё: пятёрка битов на букву
KINDS = {"fl", "lfl", "oc", "iso", "fl2", "fl3"}
ORDER = ["lights", "disc", "fonts", "diff", "torn", "bearings", "reckoning", "unload", "panel", "roster"]
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

def inside(poly, x, y):
    n = len(poly); r = False
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: r = not r
    return r
def is_water(chart, x, y):
    if chart.get("land") == "all": return any(inside(w["points"], x, y) for w in chart.get("water", []))
    return not any(inside(c["points"], x, y) for c in chart.get("coast", []))

def simulate_unload(level, kinds):
    """Проверка решения из контента теми же правилами, что на сервере: тюки толкаются по одному, порядок видов."""
    rows = level["map"]; order = level["order"]; solution = level.get("solution", "")
    walls, boxes, targets, pl = set(), {}, {}, None
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == "#": walls.add((x, y))
            elif ch == "@": pl = (x, y)
            elif ch.islower() and ch in kinds: boxes[(x, y)] = ch
            elif ch.isupper() and ch.lower() in kinds: targets[(x, y)] = ch.lower()
    if pl is None: return False, "нет матроса @"
    for k in kinds:
        nb = sum(1 for v in boxes.values() if v == k); nt = sum(1 for v in targets.values() if v == k)
        if nb != nt or nb == 0: return False, f"вид {k}: тюков {nb}, мест {nt}"
    if not solution: return False, "нет решения (solution): запустите scripts/gen-unload.py"
    dirs = {"U": (0, -1), "D": (0, 1), "L": (-1, 0), "R": (1, 0)}
    stage = 0
    for m in solution:
        if m not in dirs: return False, f"ход {m!r}"
        dx, dy = dirs[m]; n = (pl[0] + dx, pl[1] + dy)
        if n in walls: return False, "решение ведёт в стену"
        if n in boxes:
            t = (n[0] + dx, n[1] + dy)
            if t in walls or t in boxes: return False, "тюк упёрся"
            boxes[t] = boxes.pop(n)
        pl = n
        done = {k for k in kinds if all(boxes.get(p) == k for p, kk in targets.items() if kk == k)}
        if stage < len(order) and order[stage] in done: stage += 1
        if any(order[i] in done for i in range(stage, len(order))): return False, "нарушен порядок видов"
    ok = all(boxes.get(p) == k for p, k in targets.items()) and stage == len(order)
    return ok, "" if ok else "не все тюки на местах"

def check(path):
    errs, info = [], []
    d = json.load(open(path, encoding="utf-8"))
    ts = d.get("tasks", [])
    for k in ("code", "name", "nameEn", "intro", "chart"):
        if not d.get(k): errs.append(f"нет поля {k}")
    chart = d.get("chart", {})
    places = {p["id"]: p for p in chart.get("places", [])}
    if [t.get("type") for t in ts] != ORDER: errs.append(f"порядок типов должен быть {ORDER}, сейчас {[t.get('type') for t in ts]}")
    for i, t in enumerate(ts, 1):
        ty = t.get("type"); p = f"вахта {i} ({ty})"
        if not t.get("title") or not t.get("prompt"): errs.append(f"{p}: нет title/prompt")
        if ty == "lights":
            periods = set()
            for l in t["lights"]:
                if l["kind"] not in KINDS: errs.append(f"{p}: характеристика {l['kind']}")
                if l["period"] in periods: errs.append(f"{p}: период {l['period']} повторяется")
                periods.add(l["period"])
                if l["period"] < 4: errs.append(f"{p}: период {l['period']} с — слишком быстро для секундомера")
                txt = verse(t["book"], t["chapter"], l["period"])
                if txt is None: errs.append(f"{p}: нет стиха {t['book']} {t['chapter']}:{l['period']}"); continue
                w = pick(words(txt), t["word"])
                if not w or len(w) < 2: errs.append(f"{p}: слово стиха {l['period']} не годится: {w!r}")
                else: info.append(f"{p}: {l['name']} {l['kind']} {l['period']}с → «{w}»")
            if t["decoy"]["period"] in periods: errs.append(f"{p}: период ложного огня совпадает")
            if len(t["lights"]) < 4: errs.append(f"{p}: огней меньше четырёх")
        elif ty == "disc":
            if not re.fullmatch(r"[А-ЯЁ ]+", t["text"]): errs.append(f"{p}: текст только заглавными буквами и пробелами")
            if any("Ё" in t["text"] for _ in [0]): errs.append(f"{p}: в тексте Ё — на диске её нет")
            if not t.get("answers"): errs.append(f"{p}: нет answers")
            info.append(f"{p}: «{t['text']}» → {t['answers'][0]}")
        elif ty == "fonts":
            src = ""
            for v in range(t["from"], t["to"] + 1):
                txt = verse(t["book"], t["chapter"], v)
                if txt is None: errs.append(f"{p}: нет стиха {v}")
                else: src += " " + txt
            w = t["word"].upper()
            if not all(ch in ALPHABET for ch in w): errs.append(f"{p}: слово {w} содержит буквы вне азбуки без Ё")
            if norm(w) not in norm(src): errs.append(f"{p}: слова «{w}» нет в отрывке")
            letters = len(re.findall(r"[А-Яа-яЁё]", src))
            if letters < len(w) * 5 + 20: errs.append(f"{p}: в отрывке {letters} букв, мало для {len(w)} букв слова")
            info.append(f"{p}: «{w}» в {letters} буквах")
        elif ty == "diff":
            ids = [c["id"] for c in t["changes"]]
            if len(set(ids)) != len(ids): errs.append(f"{p}: id отличий повторяются")
            if t["pick"] > len(t["changes"]): errs.append(f"{p}: pick больше числа отличий")
            for c in t["changes"]:
                if c["before"] == c["after"]: errs.append(f"{p}: отличие {c['id']} не отличается")
                if not (0 <= c["x"] <= 100 and 0 <= c["y"] <= 75): errs.append(f"{p}: отличие {c['id']} вне сцены")
            info.append(f"{p}: сцена {t['scene']}, отличий {len(t['changes'])}, показывается {t['pick']}")
        elif ty == "torn":
            if t["place"] not in places: errs.append(f"{p}: место {t['place']} не на карте")
            if t["cols"] * t["rows"] < 4: errs.append(f"{p}: меньше четырёх клочков")
        elif ty == "bearings":
            for l in t["landmarks"]:
                if l not in places: errs.append(f"{p}: ориентир {l} не на карте")
            if len(t["landmarks"]) < 2: errs.append(f"{p}: меньше двух ориентиров")
            for x, y in t["targets"]:
                if not is_water(chart, x, y): errs.append(f"{p}: цель ({x},{y}) на суше")
            info.append(f"{p}: ориентиры {t['landmarks']}, целей {len(t['targets'])}")
        elif ty == "reckoning":
            import math
            for s in t["starts"]:
                if s not in places: errs.append(f"{p}: старт {s} не на карте"); continue
                for di, drift in enumerate([None] + t.get("drifts", [])):
                    x, y = places[s]["x"], places[s]["y"]
                    legs = list(t["legs"])
                    if drift: legs.insert(min(2, len(legs)), drift)
                    for leg in legs:
                        a = math.radians(leg["course"]); dist = leg["miles"] * t["mile"]
                        x += math.sin(a) * dist; y -= math.cos(a) * dist
                    if not (3 <= x <= 97 and 3 <= y <= 72): errs.append(f"{p}: конец пути {s}+снос{di} вне карты: ({x:.0f},{y:.0f})")
                    near = min(places.values(), key=lambda q: (q["x"] - x) ** 2 + (q["y"] - y) ** 2)
                    info.append(f"{p}: {s} снос{di} → ({x:.0f},{y:.0f}), ближе всего {near['name']}")
        elif ty == "unload":
            for li, level in enumerate(t["levels"]):
                if len(set(len(r) for r in level["map"])) != 1: errs.append(f"{p}: уровень {li}: строки разной длины")
                for k in level["order"]:
                    if k not in t["kinds"]: errs.append(f"{p}: уровень {li}: вид {k} не описан")
                ok, why = simulate_unload(level, t["kinds"])
                if not ok: errs.append(f"{p}: уровень {li}: {why}")
                else: info.append(f"{p}: уровень {li}: решение из {len(level['solution'])} ходов проверено")
        elif ty == "panel":
            if not t["rules"] or t["rules"][-1].get("when"): errs.append(f"{p}: последнее правило должно быть без условий")
            for ri, r in enumerate(t["rules"]):
                txt = verse(r["book"], r["chapter"], r["verse"])
                if txt is None: errs.append(f"{p}: правило {ri}: нет стиха"); continue
                if norm(r["word"]) not in [norm(w) for w in words(txt)]: errs.append(f"{p}: правило {ri}: слова «{r['word']}» нет в стихе")
                for k, v in r.get("when", {}).items():
                    ok = {"pennant": ["red", "white", "blue", "yellow"], "flashes": [1, 2, 3, 4], "symbol": ["anchor", "fish", "star", "wave"], "needle": ["N", "E", "S", "W"]}
                    if k not in ok or v not in ok[k]: errs.append(f"{p}: правило {ri}: условие {k}={v}")
            info.append(f"{p}: правил {len(t['rules'])}, раундов {t['rounds']}")
        elif ty == "roster":
            whos, thens = t["whos"], t["thens"]
            if len(set(whos)) != len(whos) or len(set(thens)) != len(thens): errs.append(f"{p}: повторы в whos/thens")
            if t["show"] > len(t["cards"]) or t["show"] < 4: errs.append(f"{p}: show вне 4..{len(t['cards'])}")
            for c in t["cards"]:
                if c["who"] not in whos: errs.append(f"{p}: карточка {c['id']}: who «{c['who']}» не в списке")
                if c["then"] not in thens: errs.append(f"{p}: карточка {c['id']}: then не в списке")
            if len({c["who"] for c in t["cards"]}) != len(t["cards"]) or len({c["then"] for c in t["cards"]}) != len(t["cards"]): errs.append(f"{p}: у карточек должны быть разные who и then")
            info.append(f"{p}: карточек {len(t['cards'])}, показывается {t['show']}")
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
