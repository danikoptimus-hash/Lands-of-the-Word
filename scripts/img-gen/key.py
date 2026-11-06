# Удаление хромакей-фона: альфа по расстоянию до цвета фона (медиана углов), обрезка, уменьшение, webp с прозрачностью.
import sys, numpy as np
from PIL import Image
src, dst, width = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert("RGB"); a = np.asarray(im).astype(float)
h, w, _ = a.shape
corners = np.concatenate([a[:20, :20].reshape(-1, 3), a[:20, -20:].reshape(-1, 3), a[-20:, :20].reshape(-1, 3), a[-20:, -20:].reshape(-1, 3)])
bg = np.median(corners, axis=0)
d = np.sqrt(((a - bg) ** 2).sum(axis=2))
t1, t2 = 40.0, 110.0
alpha = np.clip((d - t1) / (t2 - t1), 0, 1)
# зелёный ореол по краю: приглушить зелёный канал там, где альфа частичная
rgb = a.copy()
edge = (alpha > 0) & (alpha < 1)
g_excess = np.clip(rgb[..., 1] - (rgb[..., 0] + rgb[..., 2]) / 2, 0, None)
rgb[..., 1] = np.where(edge, rgb[..., 1] - g_excess * 0.9, rgb[..., 1])
out = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
img = Image.fromarray(out, "RGBA")
bbox = Image.fromarray((alpha > 0.5).astype(np.uint8) * 255).getbbox()
if bbox: img = img.crop((max(0, bbox[0] - 6), max(0, bbox[1] - 6), min(w, bbox[2] + 6), min(h, bbox[3] + 6)))
ratio = width / img.width
img = img.resize((width, max(1, round(img.height * ratio))), Image.LANCZOS)
img.save(dst, "WEBP", quality=90, method=6)
print("ok", dst, img.size, "bg", bg.astype(int).tolist())
