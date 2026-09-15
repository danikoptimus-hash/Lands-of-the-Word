"""Сжимает скриншоты инструкции apps/web/public/img/guide/*.png в webp (телефон — 780 px по ширине, экран администратора — 1200 px) и удаляет png."""
import glob, os
from PIL import Image
D = os.path.join(os.path.dirname(__file__), "..", "apps", "web", "public", "img", "guide")
for p in sorted(glob.glob(os.path.join(D, "*.png"))):
    im = Image.open(p).convert("RGB")
    w = 1200 if os.path.basename(p).startswith("admin-") else 780
    if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    out = p[:-4] + ".webp"; im.save(out, "WEBP", quality=82, method=6); os.remove(p)
    print(os.path.basename(out), im.size, os.path.getsize(out) // 1024, "KB")
