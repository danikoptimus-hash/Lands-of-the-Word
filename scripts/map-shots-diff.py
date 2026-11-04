"""Сравнение эталонных снимков карты (scripts/map-shots.mjs) с новыми: доля пикселей, отличающихся сильнее чем на 8/255
в любом канале. Приёмка этапов плана docs/proposals/map-gpu.md: не больше 0,5 % таких пикселей на снимок.
Запуск: python3 scripts/map-shots-diff.py <папка эталона> <папка новых> [порог_процентов=0.5] [порог_канала=8]
Порог канала 8/255 — для этапов, где картинка должна совпасть точно; для сравнения холста и WebGL (другое сглаживание
краёв, в пределах пикселя) берут порог 40: тогда считаются только настоящие отличия, а не оттенки по краям линий.
Для каждой пары пишет долю отличий; рядом с новыми кладёт <имя>.diff.png с подсветкой отличий, если они есть."""
import sys, os
import numpy as np
from PIL import Image

ref, new = sys.argv[1], sys.argv[2]
limit = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
chan = int(sys.argv[4]) if len(sys.argv) > 4 else 8
bad = 0
names = sorted(f for f in os.listdir(ref) if f.endswith(".png") and not f.endswith(".diff.png"))
for f in names:
    b = os.path.join(new, f)
    if not os.path.exists(b):
        print(f"{f}: нет нового снимка"); bad += 1; continue
    a = np.asarray(Image.open(os.path.join(ref, f)).convert("RGB"), dtype=np.int16)
    c = np.asarray(Image.open(b).convert("RGB"), dtype=np.int16)
    if a.shape != c.shape:
        print(f"{f}: разный размер {a.shape[:2]} и {c.shape[:2]}"); bad += 1; continue
    mask = (np.abs(a - c) > chan).any(axis=2)
    share = mask.mean() * 100
    mark = "ОК" if share <= limit else "ОТЛИЧИЕ"
    if share > limit: bad += 1
    print(f"{f}: {share:.3f} % — {mark}")
    if mask.any():
        out = (c * 0.35).astype(np.uint8); out[mask] = [255, 0, 90]
        Image.fromarray(out).save(os.path.join(new, f[:-4] + ".diff.png"))
print(f"\n{len(names)} снимков, с отличиями больше {limit} % (порог канала {chan}): {bad}")
sys.exit(1 if bad else 0)
