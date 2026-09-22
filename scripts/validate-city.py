#!/usr/bin/env python3
"""Проверка контента города: python3 scripts/validate-city.py content/cities/<code>.json [...]
Проверяет схему, ссылки на стихи по content/bible/<code>.json, что ответы находятся в тексте
Синодального перевода и что название/пересказ района не выдают ответ. Выход 1, если есть ошибки."""
import json, re, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NUM_WORDS = {1:"один одна одно одного одной",2:"два две двух двое",3:"три трех трёх трое",4:"четыре четырех четырёх",5:"пять пяти",6:"шесть шести",7:"семь семи",8:"восемь восьми",9:"девять девяти",10:"десять десяти",11:"одиннадцать",12:"двенадцать двенадцати",13:"тринадцать",14:"четырнадцать",15:"пятнадцать",16:"шестнадцать",17:"семнадцать",18:"восемнадцать",19:"девятнадцать",20:"двадцать двадцати",30:"тридцать тридцати",40:"сорок сорока",50:"пятьдесят пятидесяти",60:"шестьдесят",70:"семьдесят",80:"восемьдесят",90:"девяносто",100:"сто ста",1000:"тысяча тысячу тысячи тысяч"}

def norm(s): return re.sub(r"\s+", " ", re.sub(r"[^\w]+", " ", s.lower().replace("ё", "е"), flags=re.U)).strip()

def parse_ref(ref, counts):
    """'1:1–5' | '1:1–2:3' | '3' | '3–5' | '3:7' → список (глава, стих) в русской нумерации."""
    r = ref.replace("—", "–").replace("-", "–").replace(" ", "")
    m = re.fullmatch(r"(\d+):(\d+)(?:–(?:(\d+):)?(\d+))?", r)
    if m:
        c1, v1 = int(m.group(1)), int(m.group(2)); c2 = int(m.group(3)) if m.group(3) else c1; v2 = int(m.group(4)) if m.group(4) else v1
    else:
        m = re.fullmatch(r"(\d+)(?:–(\d+))?", r)
        if not m: return None
        c1 = int(m.group(1)); c2 = int(m.group(2)) if m.group(2) else c1; v1 = 1; v2 = None
    if not (1 <= c1 <= len(counts) and 1 <= c2 <= len(counts) and c1 <= c2): return None
    out = []
    for c in range(c1, c2 + 1):
        a = v1 if c == c1 else 1; b = (v2 if v2 is not None else counts[c - 1]) if c == c2 else counts[c - 1]
        if a < 1 or b > counts[c - 1] or a > b: return None
        out += [(c, v) for v in range(a, b + 1)]
    return out

def text_of(bible, refs): return " ".join(bible["chapters"][c - 1][v - 1] for c, v in refs)

def refs_in_prompt(prompt, counts):
    out = []
    for m in re.finditer(r"(\d+):(\d+)(?:\s*[–—-]\s*(?:(\d+):)?(\d+))?", prompt):
        r = parse_ref(m.group(0), counts)
        if r: out += r
    return out

REFS_ALLOWED = {"psa", "pro", "ecc"}

def check(path):
    errs, warns = [], []
    d = json.load(open(path, encoding="utf-8"))
    code = d.get("book"); bible = json.load(open(os.path.join(ROOT, "content", "bible", f"{code}.json"), encoding="utf-8"))
    counts = bible["verseCounts"]; whole = norm(text_of(bible, [(c, v) for c in range(1, len(counts) + 1) for v in range(1, counts[c - 1] + 1)]))
    ds, ts = d.get("districts", []), d.get("tasks", [])
    if len(ds) < 2: errs.append("меньше двух районов")
    if len(ds) > 16: errs.append(f"районов {len(ds)} > 16")
    if len(ts) < len(ds): errs.append(f"заданий {len(ts)} меньше районов {len(ds)}")
    for i, t in enumerate(ts):
        if i >= len(ds) and t.get("scope") == "district": errs.append(f"задание {i + 1}: сверх районов допустимы только book/group")
    seen = set()
    for i, dist in enumerate(ds, 1):
        for k in ("verses", "title", "summary"):
            if not dist.get(k): errs.append(f"район {i}: нет поля {k}")
        refs = parse_ref(dist.get("verses", ""), counts)
        if refs is None: errs.append(f"район {i}: не разобрать стихи «{dist.get('verses')}»")
        if dist.get("title") in seen: errs.append(f"район {i}: повтор названия «{dist['title']}»")
        seen.add(dist.get("title"))
        if len(dist.get("summary", "")) > 180: warns.append(f"район {i}: пересказ длинный ({len(dist['summary'])}) — на кольце замка помещается ~150 знаков (решение владельца 22.09)")
    for i, t in enumerate(ts, 1):
        p = t.get("prompt", ""); typ = t.get("type"); scope = t.get("scope")
        if scope not in ("district", "group", "book"): errs.append(f"задание {i}: scope «{scope}»")
        if scope == "group" and not t.get("groupDistricts"): errs.append(f"задание {i}: group без groupDistricts")
        if not p: errs.append(f"задание {i}: пустой prompt"); continue
        dist = ds[i - 1] if i <= len(ds) else {}
        drefs = parse_ref(dist.get("verses", ""), counts) or []
        prefs = refs_in_prompt(p, counts)
        # Решение владельца: ссылки на стихи только в книгах без чёткой структуры (Псалтирь, Притчи, Екклесиаст).
        if code in REFS_ALLOWED:
            if scope == "district" and not prefs: warns.append(f"задание {i}: в вопросе нет ссылки на стихи")
        elif (prefs or re.search(r"\d+:\d+", p)) and not (typ == "text" and all(re.fullmatch(r"\d+(:\d+)?", a) for a in t.get("answers") or [])): errs.append(f"задание {i}: в вопросе ссылка на стихи, а в этой книге ссылок быть не должно")
        scope_refs = prefs or (drefs if scope == "district" else None)
        scope_text = norm(text_of(bible, scope_refs)) if scope_refs else whole
        leak = norm(dist.get("title", "") + " " + dist.get("summary", ""))
        if typ == "text":
            answers = t.get("answers") or []
            if not answers: errs.append(f"задание {i}: text без answers"); continue
            if all(re.fullmatch(r"[\d\s,и]+", a) for a in answers) and not any(":" in a for a in answers):
                continue  # числовой ответ словами/цифрами (например номера двух псалмов) — в тексте не ищем
            if all(re.fullmatch(r"\d+(:\d+)?", a) for a in answers):
                # Поиск стиха по цитате: ответ — ссылка; цитата в «…» должна стоять именно в этом стихе.
                q = re.search(r"«([^»]+)»", p); ref = next((a for a in answers if ":" in a), "1:" + answers[0])
                ch, v = map(int, ref.split(":"))
                verse = norm(bible["chapters"][ch - 1][v - 1]) if 0 < ch <= len(bible["chapters"]) and 0 < v <= len(bible["chapters"][ch - 1]) else ""
                if not q or norm(q.group(1)) not in verse: errs.append(f"задание {i}: цитата не найдена в стихе {ref}")
                continue
            if not any(norm(a) and norm(a) in scope_text for a in answers):
                if not any(norm(a) in whole for a in answers): errs.append(f"задание {i}: ни один ответ {answers} не найден в тексте книги")
                else: warns.append(f"задание {i}: ответ {answers} есть в книге, но не в указанных стихах")
            for a in answers:
                if len(norm(a)) >= 4 and re.search(r"\b" + re.escape(norm(a)) + r"\b", leak): errs.append(f"задание {i}: ответ «{a}» виден в названии/пересказе района")
            if any(len(norm(a).split()) > 3 for a in answers): warns.append(f"задание {i}: длинный текстовый ответ, риск споров о написании")
        elif typ == "number":
            n = t.get("answer")
            if not isinstance(n, (int, float)): errs.append(f"задание {i}: number без answer"); continue
            words = NUM_WORDS.get(int(n), "").split()
            if not (str(int(n)) in scope_text.split() or any(w in scope_text.split() for w in words)):
                warns.append(f"задание {i}: число {n} не найдено словом в указанных стихах (может быть подсчёт — проверь вручную)")
        elif typ == "choice":
            opts = t.get("options") or []; c = t.get("correct")
            if len(opts) < 2 or not isinstance(c, int) or not (0 <= c < len(opts)): errs.append(f"задание {i}: choice некорректен"); continue
            if len(set(opts)) != len(opts): errs.append(f"задание {i}: повтор вариантов")
            ans = norm(opts[c])
            if ans not in scope_text and ans not in whole: warns.append(f"задание {i}: верный вариант «{opts[c]}» не найден дословно в тексте (нормально для перефраза, проверь)")
            if len(ans) >= 4 and re.search(r"\b" + re.escape(ans) + r"\b", leak): errs.append(f"задание {i}: верный вариант «{opts[c]}» виден в названии/пересказе района")
        elif typ == "order":
            items = t.get("items") or []
            if len(items) < 3: errs.append(f"задание {i}: order меньше 3 пунктов"); continue
            if len(set(items)) != len(items): errs.append(f"задание {i}: повтор пунктов order")
            # Каждый следующий пункт ищем после предыдущего: одно и то же слово может встречаться в районе и раньше.
            pos = []; cur = 0
            for x in items:
                k = scope_text.find(norm(x), cur)
                pos.append(k)
                if k >= 0: cur = k + 1
            if all(x >= 0 for x in pos): pass
            elif all(scope_text.find(norm(x)) >= 0 for x in items): errs.append(f"задание {i}: пункты order встречаются в тексте не в этом порядке")
            else: warns.append(f"задание {i}: не все пункты order найдены дословно (перефраз?) — порядок не проверен")
        elif typ == "crossword":
            words = t.get("words") or []
            if not (3 <= len(words) <= 8): errs.append(f"задание {i}: кроссворд — от 3 до 8 слов"); continue
            answers = [w.get("answer", "") for w in words]
            if len(set(grid_letters(a) for a in answers)) != len(answers): errs.append(f"задание {i}: повтор слов кроссворда")
            for w in words:
                a = w.get("answer", ""); g = grid_letters(a)
                if not w.get("clue"): errs.append(f"задание {i}: слово «{a}» без вопроса")
                if len(g) < 2 or not re.fullmatch(r"[А-Я]+", g): errs.append(f"задание {i}: слово «{a}» — только буквы, не короче двух")
                if norm(a) not in scope_text: errs.append(f"задание {i}: слово «{a}» не найдено в стихах района")
                if len(norm(a)) >= 4 and re.search(r"\b" + re.escape(norm(a)) + r"\b", leak): errs.append(f"задание {i}: слово «{a}» видно в названии/пересказе района")
            lay = layout_crossword(answers)
            if lay["rows"] > 14 or lay["cols"] > 14: warns.append(f"задание {i}: сетка кроссворда {lay['rows']}×{lay['cols']} крупная для телефона")
            if lay["loose"]: warns.append(f"задание {i}: слова без пересечений: {', '.join(answers[k] for k in lay['loose'])}")
        else: errs.append(f"задание {i}: тип «{typ}»")
    return errs, warns

def grid_letters(s): return re.sub(r"[^А-ЯA-Z]", "", s.upper().replace("Ё", "Е"))

def layout_crossword(answers):
    """Тот же жадный алгоритм, что в apps/api/src/services/crossword.ts: длинное слово по горизонтали, остальные
    цепляются перпендикулярно за общую букву; без пересечений — отдельной строкой ниже. Возвращает размер и «отдельные» слова."""
    cells = {}; placed = []; loose = []
    order = sorted(range(len(answers)), key=lambda k: (-len(grid_letters(answers[k])), k))
    def fits(letters, row, col, d):
        dr, dc = (1, 0) if d == "down" else (0, 1)
        if cells.get((row - dr, col - dc)) or cells.get((row + dr * len(letters), col + dc * len(letters))): return -1
        cross = 0
        for k, ch in enumerate(letters):
            r, c = row + dr * k, col + dc * k
            cur = cells.get((r, c))
            if cur:
                if cur != ch: return -1
                cross += 1; continue
            if cells.get((r + dc, c + dr)) or cells.get((r - dc, c - dr)): return -1
        return cross
    def put(letters, row, col, d):
        dr, dc = (1, 0) if d == "down" else (0, 1)
        for k, ch in enumerate(letters): cells[(row + dr * k, col + dc * k)] = ch
        placed.append((row, col, d, letters))
    for src in order:
        letters = grid_letters(answers[src])
        if not placed: put(letters, 0, 0, "across"); continue
        best = None
        for (prow, pcol, pd, pl) in placed:
            d = "down" if pd == "across" else "across"
            for pi, ch in enumerate(pl):
                for wi, wc in enumerate(letters):
                    if ch != wc: continue
                    pr = prow + (pi if pd == "down" else 0); pc = pcol + (pi if pd == "across" else 0)
                    row = pr - (wi if d == "down" else 0); col = pc - (wi if d == "across" else 0)
                    cross = fits(letters, row, col, d)
                    if cross > 0 and (best is None or cross > best[3]): best = (row, col, d, cross)
        if best: put(letters, best[0], best[1], best[2]); continue
        loose.append(src)
        put(letters, max(r for r, _ in cells) + 2, min(c for _, c in cells), "across")
    rs = [r for r, _ in cells]; cs = [c for _, c in cells]
    return {"rows": max(rs) - min(rs) + 1, "cols": max(cs) - min(cs) + 1, "loose": loose}

bad = 0
for path in sys.argv[1:]:
    errs, warns = check(path)
    print(f"== {path}: {'ОК' if not errs else 'ОШИБКИ ' + str(len(errs))}, предупреждений {len(warns)}")
    for e in errs: print("  ERR ", e)
    for w in warns: print("  warn", w)
    bad += bool(errs)
sys.exit(1 if bad else 0)
