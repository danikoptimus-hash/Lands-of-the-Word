"""Снимает контуры островков по прозрачности PNG и пишет packages/domain/src/isletShapes.ts, а также делает WebP 1024.
Запуск из корня: python3 scripts/islet-shapes.py (нужен Pillow). Исходники: apps/web/public/img/islet/islet-N.png."""
from PIL import Image
import math, os
BINS = 72
out = []
for n in range(1, 7):
    p = f"apps/web/public/img/islet/islet-{n}.png"
    im = Image.open(p).convert("RGBA")
    W, H = im.size; cx, cy = W / 2, H / 2; half = max(W, H) / 2
    px = im.load()
    prof = []
    for i in range(BINS):
        a = (i / BINS) * 2 * math.pi
        r = half; found = 0.0
        while r > 0:
            x = cx + math.cos(a) * r; y = cy + math.sin(a) * r
            if 0 <= x < W and 0 <= y < H and px[int(x), int(y)][3] > 96: found = r / half; break
            r -= 1.0
        prof.append(round(found, 4))
    sm = [round(sorted([prof[(i - 1) % BINS], prof[i], prof[(i + 1) % BINS]])[1], 4) for i in range(BINS)]
    out.append((n, sm))
    w = im.copy(); w.thumbnail((2048, 2048), Image.LANCZOS)  # не уменьшаем ниже исходника до 2048: на максимальном зуме нужна резкость
    w.save(f"apps/web/public/img/islet/islet-{n}.webp", "WEBP", quality=86, method=6)
ts = "/** Контуры нарисованных островков (`apps/web/public/img/islet/islet-N.webp`): радиус края острова по 72 углам от центра картинки,\n * в долях половины стороны картинки. Снято по прозрачности скриптом `scripts/islet-shapes.py`; при замене картинок пересчитать. */\nexport const ISLET_SHAPE_N = 72;\nexport const ISLET_IMAGES: ReadonlyArray<{ img: number; shape: number[]; maxR: number }> = [\n"
for n, sm in out:
    ts += "  { img: %d, maxR: %s, shape: [%s] },\n" % (n, max(sm), ", ".join(str(v) for v in sm))
ts += "];\n"
open("packages/domain/src/isletShapes.ts", "w").write(ts)
print("ok")
