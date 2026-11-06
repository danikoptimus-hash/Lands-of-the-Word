# Разрезка листа спрайтов на зелёном хромакее: альфа по расстоянию до цвета фона, связные области → отдельные webp.
#   python3 -I scripts/img-gen/sheet.py sheet.png outdir maxheight name1,name2,...   (имена — по порядку слева направо, сверху вниз)
# Масштаб общий для всего листа (самый высокий спрайт = maxheight), так что относительные размеры предметов сохраняются.
import sys, numpy as np
from PIL import Image
src, outdir, maxh, names = sys.argv[1], sys.argv[2].rstrip("/"), int(sys.argv[3]), sys.argv[4].split(",")
im = Image.open(src).convert("RGB"); a = np.asarray(im).astype(float); h, w, _ = a.shape
corners = np.concatenate([a[:20, :20].reshape(-1, 3), a[:20, -20:].reshape(-1, 3), a[-20:, :20].reshape(-1, 3), a[-20:, -20:].reshape(-1, 3)])
bg = np.median(corners, axis=0)
d = np.sqrt(((a - bg) ** 2).sum(axis=2)); t1, t2 = 40.0, 110.0
alpha = np.clip((d - t1) / (t2 - t1), 0, 1)
rgb = a.copy(); edge = (alpha > 0) & (alpha < 1)
g_excess = np.clip(rgb[..., 1] - (rgb[..., 0] + rgb[..., 2]) / 2, 0, None)
rgb[..., 1] = np.where(edge, rgb[..., 1] - g_excess * 0.9, rgb[..., 1])
rgba = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), "RGBA")
# связные области на уменьшенной маске (шаг 4), 8-связность, обход в ширину
step = 4; m = (alpha[::step, ::step] > 0.5); mh, mw = m.shape; lab = np.zeros(m.shape, int); comps = []
for y0 in range(mh):
    for x0 in range(mw):
        if not m[y0, x0] or lab[y0, x0]: continue
        k = len(comps) + 1; stack = [(y0, x0)]; lab[y0, x0] = k; pts = []
        while stack:
            y, x = stack.pop(); pts.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < mh and 0 <= xx < mw and m[yy, xx] and not lab[yy, xx]: lab[yy, xx] = k; stack.append((yy, xx))
        ys = [p[0] for p in pts]; xs = [p[1] for p in pts]
        comps.append({"n": len(pts), "y0": min(ys) * step, "y1": (max(ys) + 1) * step, "x0": min(xs) * step, "x1": (max(xs) + 1) * step})
big = [c for c in comps if c["n"] * step * step > 0.002 * h * w]
# слить области, чьи рамки пересекаются или почти касаются (отделившиеся детали — флаг, струя)
merged = True
while merged:
    merged = False
    for i in range(len(big)):
        for j in range(i + 1, len(big)):
            p, q = big[i], big[j]; pad = 12
            if p["x0"] - pad < q["x1"] and q["x0"] - pad < p["x1"] and p["y0"] - pad < q["y1"] and q["y0"] - pad < p["y1"]:
                big[i] = {"n": p["n"] + q["n"], "x0": min(p["x0"], q["x0"]), "x1": max(p["x1"], q["x1"]), "y0": min(p["y0"], q["y0"]), "y1": max(p["y1"], q["y1"])}; del big[j]; merged = True; break
        if merged: break
# порядок: по рядам (центр по y с допуском половины высоты), внутри ряда — по x
big.sort(key=lambda c: (c["y0"] + c["y1"]) / 2); rows = []
for c in big:
    cy = (c["y0"] + c["y1"]) / 2
    if rows and abs(cy - rows[-1][0]) < (c["y1"] - c["y0"]) * 0.6: rows[-1][1].append(c)
    else: rows.append([cy, [c]])
order = [c for _, row in rows for c in sorted(row, key=lambda c: c["x0"])]
if len(order) != len(names): print("FAIL: областей", len(order), "имён", len(names), [(c["x0"], c["y0"], c["x1"], c["y1"]) for c in order]); sys.exit(1)
scale = maxh / max(c["y1"] - c["y0"] for c in order)
for c, name in zip(order, names):
    sp = rgba.crop((max(0, c["x0"] - 4), max(0, c["y0"] - 4), min(w, c["x1"] + 4), min(h, c["y1"] + 4)))
    sp = sp.resize((max(1, round(sp.width * scale)), max(1, round(sp.height * scale))), Image.LANCZOS)
    sp.save(f"{outdir}/{name}.webp", "WEBP", quality=90, method=6); print("ok", name, sp.size)
