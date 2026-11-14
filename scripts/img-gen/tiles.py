#!/usr/bin/env python3
"""Лист «плитки сеткой на белом» → отдельные квадратные картинки (аватарки и гербы, решение владельца 14.11).

  python3 -I scripts/img-gen/tiles.py лист.png папка a 17 [--skip 3,8] [--lg 320] [--sm 128] [--fit 1] [--pad 0.12] [--whole 1]

Плитки ищутся по белым промежуткам между ними (строки и столбцы, где почти все точки белые), идут слева направо,
сверху вниз. Каждая сохраняется дважды: папка/a017.webp (крупная) и папка/s/a017.webp (мелкая, для списков);
номер первой плитки — четвёртый аргумент, дальше по порядку. --skip — номера плиток листа (с единицы), которые
не берём. --fit 1 — если картинка сидит во внутреннем круге на цветном поле, кадр берётся по этому кругу с тонким
ровным кольцом (чтобы у всего набора кольцо было одной толщины). --pad 0.12 — поля цвета углов вокруг плитки, если
предмет нарисован во всю плитку и круг аватарки его срезал бы. --whole 1 — для круглых медальонов на белом листе
(гербы): медальон берётся целиком, от края до края, и приводится к квадрату — рамка не срезается. Печатает, сколько плиток сохранено и следующий
свободный номер.
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


def tiles(path, whole=False):
    im = Image.open(path).convert("RGB")
    white = np.asarray(im).min(axis=2) > 232
    res = []
    for y0, y1 in runs(white.mean(axis=1) < 0.9, im.height // 12):
        for x0, x1 in runs(white[y0:y1].mean(axis=0) < 0.9, im.width // 12):
            # Плитки одного ряда стоят не строго на одной высоте: верх и низ каждой ищем по её собственным столбцам,
            # иначе круглый герб режется со сдвигом (срезанная рамка сверху или снизу).
            own = np.where(white[y0:y1, x0:x1].mean(axis=1) < 0.97)[0]
            ty0, ty1 = (y0 + own[0], y0 + own[-1] + 1) if len(own) else (y0, y1)
            if whole:  # круглый медальон на белом: берём его целиком (он бывает чуть выше, чем шире) и приводим к квадрату
                m = max(2, (x1 - x0) // 150)
                res.append(im.crop((x0 + m, ty0 + m, x1 - m, ty1 - m)).resize((x1 - x0 - 2 * m,) * 2, Image.LANCZOS))
                continue
            s = min(x1 - x0, ty1 - ty0); cx, cy = (x0 + x1) // 2, (ty0 + ty1) // 2
            half = s // 2 - max(2, s // 90)  # срезаем размытую кромку у белого
            res.append(im.crop((cx - half, cy - half, cx + half, cy + half)))
    return res


def fit_disc(t, margin=0.06):
    """Плитка «картинка во внутреннем круге на ровном цветном поле» → кадр по внутреннему кругу с тонким ровным кольцом.
    Круг ищется как область, не похожая на цвет углов; если она не круглая (картинка во всю плитку) — плитка не меняется."""
    a = np.asarray(t).astype(int); h, w = a.shape[:2]; k = max(4, w // 30)
    bg = np.median(np.concatenate([a[:k, :k].reshape(-1, 3), a[:k, -k:].reshape(-1, 3), a[-k:, :k].reshape(-1, 3), a[-k:, -k:].reshape(-1, 3)]), axis=0)
    mask = np.abs(a - bg).sum(axis=2) > 70
    cols = np.where(mask.mean(axis=0) > 0.04)[0]; rows = np.where(mask.mean(axis=1) > 0.04)[0]
    if len(cols) < w * 0.4 or len(rows) < h * 0.4: return t
    x0, x1, y0, y1 = cols[0], cols[-1], rows[0], rows[-1]; bw, bh = x1 - x0 + 1, y1 - y0 + 1
    if abs(bw - bh) > 0.06 * max(bw, bh) or max(bw, bh) > 0.97 * w: return t
    spans = [np.where(r)[0] for r in mask[y0:y1 + 1, x0:x1 + 1]]
    area = sum(s[-1] - s[0] + 1 for s in spans if len(s)) / (bw * bh)  # у круга — около 0,785
    if not 0.72 < area < 0.84: return t
    r = max(bw, bh) / 2 * (1 + margin); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box = tuple(int(round(v)) for v in (cx - r, cy - r, cx + r, cy + r))
    out = Image.new("RGB", (box[2] - box[0], box[3] - box[1]), tuple(int(v) for v in bg))
    out.paste(t, (-box[0], -box[1]))
    return out


def pad(t, share):
    """Поля цвета углов вокруг плитки: чтобы предмет во всю плитку не срезался кругом аватарки."""
    a = np.asarray(t).astype(int); w, h = t.size; k = max(4, w // 30)
    bg = np.median(np.concatenate([a[:k, :k].reshape(-1, 3), a[:k, -k:].reshape(-1, 3), a[-k:, :k].reshape(-1, 3), a[-k:, -k:].reshape(-1, 3)]), axis=0)
    m = int(round(w * share))
    out = Image.new("RGB", (w + 2 * m, h + 2 * m), tuple(int(v) for v in bg))
    out.paste(t, (m, m))
    return out


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 4: print(__doc__); sys.exit(2)
    src, out, prefix, first = args[0], args[1], args[2], int(args[3])
    opt = {"--skip": "", "--lg": "320", "--sm": "128", "--fit": "0", "--pad": "0", "--whole": "0"}
    for i in range(4, len(args) - 1, 2): opt[args[i]] = args[i + 1]
    skip = {int(x) for x in opt["--skip"].split(",") if x}
    width = 3 if prefix == "a" else 2
    os.makedirs(os.path.join(out, "s"), exist_ok=True)
    n = first
    for i, t in enumerate(tiles(src, whole=opt["--whole"] == "1"), start=1):
        if i in skip: continue
        if opt["--fit"] == "1": t = fit_disc(t)
        if float(opt["--pad"]) > 0: t = pad(t, float(opt["--pad"]))
        name = f"{prefix}{n:0{width}d}.webp"
        t.resize((int(opt["--lg"]),) * 2, Image.LANCZOS).save(os.path.join(out, name), quality=84, method=6)
        t.resize((int(opt["--sm"]),) * 2, Image.LANCZOS).save(os.path.join(out, "s", name), quality=84, method=6)
        n += 1
    print(f"{src}: сохранено {n - first}, следующий номер {n}")
