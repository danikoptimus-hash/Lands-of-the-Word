#!/usr/bin/env python3
"""Генератор уровней «Разгрузки» (сокобан с порядком видов): python3 scripts/gen-unload.py
Берёт шаблоны (стены, места, матрос) из этого файла, «вытягивает» тюки с мест случайными обратными ходами
в обратном порядке видов — так уровень гарантированно решается, а решение известно. Записывает map и solution
в content/seas/<код>.json (вахта unload). Семя фиксировано: повторный запуск даёт те же уровни."""
import json, os, random, sys
from collections import deque
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIRS = {"U": (0, -1), "D": (0, 1), "L": (-1, 0), "R": (1, 0)}
INV = {"U": "D", "D": "U", "L": "R", "R": "L"}

# Шаблоны: # стена, @ матрос (место после решения), заглавные буквы — места для видов.
TEMPLATES = {
    "adria": [
        ["##########", "#........#", "#...#....#", "#.#......#", "#......#A#", "#........#", "#S..V..W.#", "##########"],
        ["##########", "#........#", "#.#...#..#", "#.......A#", "#..#.....#", "#........#", "#.S.V.W..#", "##########"],
    ],
    "galilee": [
        ["##########", "#..F..F..#", "#........#", "#...#....#", "#........#", "#.#......#", "#..F..N..#", "##########"],
        ["##########", "#.F....F.#", "#........#", "#.#...#..#", "#........#", "#....#...#", "#.N....F.#", "##########"],
    ],
    "red": [
        ["##########", "#........#", "#..#.....#", "#........#", "#.....#..#", "#........#", "#.J.R.E.D#", "##########"],
        ["##########", "#........#", "#.#......#", "#....#...#", "#........#", "#..#.....#", "#J..R..ED#", "##########"],
    ],
    "salt": [
        ["##########", "#.F......#", "#........#", "#.#..#...#", "#........#", "#......#S#", "#..T.....#", "##########"],
        ["##########", "#......F.#", "#........#", "#.....#..#", "#.#......#", "#........#", "#S....T..#", "##########"],
    ],
    "merom": [
        ["##########", "#........#", "#...#....#", "#........#", "#.#...#..#", "#........#", "#H.H..C.C#", "##########"],
        ["##########", "#........#", "#.#......#", "#.....#..#", "#........#", "#...#....#", "#H..H.C.C#", "##########"],
    ],
}

def parse(rows):
    walls, targets = set(), {}
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == "#": walls.add((x, y))
            elif ch.isupper(): targets[(x, y)] = ch.lower()
    return walls, targets

def reach(pl, walls, boxes):
    seen = {pl}; prev = {pl: None}; q = deque([pl])
    while q:
        c = q.popleft()
        for d, (dx, dy) in DIRS.items():
            n = (c[0] + dx, c[1] + dy)
            if n in walls or n in boxes or n in seen: continue
            seen.add(n); prev[n] = (c, d); q.append(n)
    return seen, prev

def walk(prev, to):
    out = []
    while prev[to] is not None: c, d = prev[to]; out.append(d); to = c
    return list(reversed(out))

def generate(rows, order, rng, pulls_per_box=(5, 9)):
    walls, targets = parse(rows)
    boxes = dict(targets)  # решённое состояние: тюки на местах
    free = [(x, y) for y, r in enumerate(rows) for x, ch in enumerate(r) if ch != "#" and (x, y) not in boxes]
    pl = rng.choice(free)
    moves = []  # обратные ходы матроса
    # Вытягиваем виды в обратном порядке: последний вид первым.
    for kind in reversed(order):
        mine = [b for b, k in boxes.items() if k == kind]
        rng.shuffle(mine)
        for b in mine:
            n = rng.randint(*pulls_per_box)
            cur = b
            for _ in range(n):
                area, prev = reach(pl, walls, boxes)
                options = []
                for d, (dx, dy) in DIRS.items():
                    p = (cur[0] - dx, cur[1] - dy)      # матрос рядом с тюком со стороны, куда тянет
                    back = (p[0] - dx, p[1] - dy)        # куда отступает матрос
                    if p in area and back not in walls and back not in boxes: options.append((d, p, back))
                if not options: break
                d, p, back = rng.choice(options)
                moves += walk(prev, p)
                moves.append(INV[d] + "*")  # ход с тюком: матрос отступает против d
                del boxes[cur]; boxes[p] = kind; cur = p; pl = back
    if any(b in targets for b in boxes): return None  # формат карты не умеет «тюк на чужом месте»
    if pl in boxes or pl in targets: return None
    # Прямое решение: обратный порядок ходов с обращёнными направлениями.
    solution = "".join(INV[m[0]] for m in reversed(moves))
    out = []
    for y, r in enumerate(rows):
        line = ""
        for x, ch in enumerate(r):
            if (x, y) in boxes: line += boxes[(x, y)]
            elif (x, y) == pl: line += "@"
            elif ch == "@": line += "."
            else: line += ch
        out.append(line)
    return out, solution

def simulate(rows, order, solution, kinds):
    """Проверка прямого решения теми же правилами, что на сервере: тюки толкаются по одному, порядок видов."""
    walls, targets = parse(rows)
    boxes, pl = {}, None
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == "@": pl = (x, y)
            elif ch.islower() and ch in kinds: boxes[(x, y)] = ch
    stage = 0
    for m in solution:
        dx, dy = DIRS[m]
        n = (pl[0] + dx, pl[1] + dy)
        if n in walls: return False, "в стену"
        if n in boxes:
            t = (n[0] + dx, n[1] + dy)
            if t in walls or t in boxes: return False, "тюк упёрся"
            boxes[t] = boxes.pop(n)
        pl = n
        done = {k for k in kinds if all(boxes.get(p) == k for p, kk in targets.items() if kk == k)}
        if stage < len(order) and order[stage] in done: stage += 1
        if any(order[i] in done for i in range(stage, len(order))): return False, "нарушен порядок"
    ok = all(boxes.get(p) == k for p, k in targets.items()) and stage == len(order)
    return ok, "" if ok else "не все на местах"

def main():
    codes = sys.argv[1:] or list(TEMPLATES)
    for code in codes:
        path = os.path.join(ROOT, "content", "seas", f"{code}.json")
        d = json.load(open(path, encoding="utf-8"))
        task = next(t for t in d["tasks"] if t["type"] == "unload")
        order = task["levels"][0]["order"] if task.get("levels") else list(task["kinds"])
        for k in task["kinds"]:
            if k not in order: order.append(k)
        levels = []
        for li, rows in enumerate(TEMPLATES[code]):
            rng = random.Random(f"{code}|{li}|v2")
            best = None
            for attempt in range(300):
                g = generate(rows, order, rng)
                if not g: continue
                m, sol = g
                ok, why = simulate(m, order, sol, task["kinds"])
                if not ok: continue
                pushes = sum(1 for _ in sol)
                if best is None or pushes > best[2]: best = (m, sol, pushes)
                if best[2] >= 40: break
            if not best: print(f"{code}: уровень {li} не сгенерирован"); sys.exit(1)
            levels.append({"map": best[0], "order": order, "solution": best[1]})
            print(f"{code}: уровень {li}: {best[2]} ходов")
            for r in best[0]: print("   ", r)
        task["levels"] = levels
        json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        open(path, "a", encoding="utf-8").write("\n")

if __name__ == "__main__": main()
