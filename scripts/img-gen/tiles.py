#!/usr/bin/env python3
"""Лист «плитки сеткой на белом» → отдельные квадратные картинки (аватарки и гербы, решение владельца 14.11).

  python3 -I scripts/img-gen/tiles.py лист.png папка a 17 [--skip 3,8] [--lg 320] [--sm 128]

Плитки ищутся по белым промежуткам между ними (строки и столбцы, где почти все точки белые), идут слева направо,
сверху вниз. Каждая сохраняется дважды: папка/a017.webp (крупная) и папка/s/a017.webp (мелкая, для списков);
номер первой плитки — четвёртый аргумент, дальше по порядку. --skip — номера плиток листа (с единицы), которые
не берём. Печатает, сколько плиток сохранено и следующий свободный номер.
"""
import os, sys
from PIL import Image
import numpy as np


def runs(mask, min_len):
    out, start = [], None
    for i, v in enumerate(mask):
        if v and start is None: start = i
        if not v and start is not None:
            if i - start >= min_len: out.append((start, i))
            start = None
    if start is not None and len(mask) - start >= min_len: out.append((start, len(mask)))
    return out


def tiles(path):
    im = Image.open(path).convert("RGB")
    white = np.asarray(im).min(axis=2) > 232
    res = []
    for y0, y1 in runs(white.mean(axis=1) < 0.9, im.height // 12):
        for x0, x1 in runs(white[y0:y1].mean(axis=0) < 0.9, im.width // 12):
            s = min(x1 - x0, y1 - y0); cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
            half = s // 2 - max(2, s // 90)  # срезаем размытую кромку у белого
            res.append(im.crop((cx - half, cy - half, cx + half, cy + half)))
    return res


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 4: print(__doc__); sys.exit(2)
    src, out, prefix, first = args[0], args[1], args[2], int(args[3])
    opt = {"--skip": "", "--lg": "320", "--sm": "128"}
    for i in range(4, len(args) - 1, 2): opt[args[i]] = args[i + 1]
    skip = {int(x) for x in opt["--skip"].split(",") if x}
    width = 3 if prefix == "a" else 2
    os.makedirs(os.path.join(out, "s"), exist_ok=True)
    n = first
    for i, t in enumerate(tiles(src), start=1):
        if i in skip: continue
        name = f"{prefix}{n:0{width}d}.webp"
        t.resize((int(opt["--lg"]),) * 2, Image.LANCZOS).save(os.path.join(out, name), quality=84, method=6)
        t.resize((int(opt["--sm"]),) * 2, Image.LANCZOS).save(os.path.join(out, "s", name), quality=84, method=6)
        n += 1
    print(f"{src}: сохранено {n - first}, следующий номер {n}")
