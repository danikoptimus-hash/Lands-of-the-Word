#!/usr/bin/env python3
"""Нагрузочный прогон стенда (workflow `loadtest`): вырезка журнала и сводная таблица прогонов.

  python3 nagruzka.py vyrezka ЖУРНАЛ.zip ФАЙЛ.txt   — шаги 5–9 из архива журнала запуска (скачивается со страницы
                                                      запуска в GitHub Actions), без служебных строк и цветовых кодов
  python3 nagruzka.py svodka ФАЙЛ.txt [ФАЙЛ.txt …]  — задержки по запросам и нагрузка сервера, прогоны рядом

Вырезки прогонов лежат в docs/perf-audit-2026-11-15/zamery/etap-2/nagruzka-*.txt.
"""
import re
import sys
import zipfile


def clean(line):
    line = line.lstrip("\ufeff")
    return re.sub(r"\x1b\[[0-9;]*m", "", line[29:] if re.match(r"^\d{4}-\d\d-\d\dT", line) else line)


def vyrezka(src, out):
    z = zipfile.ZipFile(src)
    steps = sorted((n for n in z.namelist() if re.match(r"loadtest/[5-9]_", n)), key=lambda n: int(n.split("/")[1].split("_")[0]))
    res = []
    if steps:
        parts = [(n.split("/")[1].rsplit(".", 1)[0].split("_", 1)[1], z.read(n).decode("utf-8", "replace")) for n in steps]
    else:  # у старых запусков в архиве только общий журнал
        whole = next(n for n in z.namelist() if n.endswith(".txt") and "/" not in n)
        text = z.read(whole).decode("utf-8", "replace")
        parts = [("Журнал целиком, с шага подготовки стенда", text[text.find("loadtest.js seed"):])]
    region = None
    for n in z.namelist():
        m = re.search(r"Region: ([\w-]+)", z.read(n).decode("utf-8", "replace")) if n.endswith(".txt") else None
        if m:
            region = m.group(1)
            break
    if region:
        res += [f"машина генератора: {region}", ""]
    for title, text in parts:
        res.append(f"=== {title} ===")
        skip = False
        for line in text.splitlines():
            body = clean(line)
            if body.startswith("##[group]"):
                skip = True
            elif body.startswith("##[endgroup]"):
                skip = False
            elif not skip and not body.startswith("[command]") and "Post job cleanup" not in body:
                res.append(body)
        res.append("")
    open(out, "w", encoding="utf-8").write("\n".join(res))
    print(out, len(res), "строк")


def read(path):
    t = open(path, encoding="utf-8").read()
    d = {"rows": {}, "cpu": {}, "la": []}
    seen, cur = set(), None
    m = re.search(r"машина генератора: (\S+)", t)
    d["region"] = m.group(1) if m else "?"
    for b in t.splitlines():
        b = b.strip()
        m = re.match(r"^\| (/api\S+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|", b)
        if m:
            d["rows"].setdefault(m.group(1).replace("/api/games/:id", ""), tuple(int(x) for x in m.groups()[1:]))
        m = re.match(r"^Запросов (\d+), в среднем ([\d.]+)/с, ошибок (\d+)", b)
        if m:
            d.setdefault("total", m.groups())
        if re.fullmatch(r"\d\d:\d\d:\d\d", b):
            cur = b
        m = re.match(r"^(lotw-[\w-]+) cpu=([\d.]+)% mem=([\d.]+)(MiB|GiB)", b)
        if m and cur and (cur, m.group(1)) not in seen:  # журнал печатает замеры дважды (шаг и сводка)
            seen.add((cur, m.group(1)))
            d["cpu"].setdefault(m.group(1), []).append((float(m.group(2)), float(m.group(3)) * (1024 if m.group(4) == "GiB" else 1)))
        m = re.search(r"load average: ([\d.]+)", b)
        if m and cur:
            d["la"].append(float(m.group(1)))
    return d


def svodka(paths):
    runs = [read(p) for p in paths]
    names = [re.sub(r"^nagruzka-|\.txt$", "", p.split("/")[-1]) for p in paths]
    w = max(24, max(len(n) for n in names) + 2)
    line = lambda head, cells: print(f"{head:<26}" + "".join(f"{c:>{w}}" for c in cells))
    line("прогон", names)
    line("машина генератора", [r["region"] for r in runs])
    line("запросов / в с / ошибок", [" / ".join(r.get("total", ("-",) * 3)) for r in runs])
    keys = []
    for r in runs:
        keys += [k for k in r["rows"] if k not in keys]
    for k in keys:
        print(k)
        for i, name in ((0, "всего"), (2, "p50, мс"), (3, "p95, мс"), (4, "p99, мс"), (5, "макс, мс")):
            line("  " + name, [(r["rows"].get(k) or ("-",) * 6)[i] for r in runs])
    print("сервер (замер раз в 15 с): процессор среднее / макс, %; память, МБ")
    for c in ("lotw-app-test", "lotw-db-test", "lotw-app", "lotw-db"):
        cells = []
        for r in runs:
            v = r["cpu"].get(c)
            cells.append(f"{sum(x[0] for x in v) / len(v):.1f} / {max(x[0] for x in v):.1f}; {min(x[1] for x in v):.0f}–{max(x[1] for x in v):.0f}" if v else "-")
        line("  " + c, cells)
    line("  load average (1 мин)", [f"{sum(r['la']) / len(r['la']):.2f} / {max(r['la']):.2f}" if r["la"] else "-" for r in runs])


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "vyrezka":
        vyrezka(sys.argv[2], sys.argv[3])
    elif len(sys.argv) >= 3 and sys.argv[1] == "svodka":
        svodka(sys.argv[2:])
    else:
        print(__doc__)
