#!/usr/bin/env python3
"""Делает из apps/web/public/img/brand/logo.png все иконки сайта. Запуск из корня репозитория: python3 scripts/brand-assets.py"""
from PIL import Image
import os
os.chdir(os.path.join(os.path.dirname(__file__), "..", "apps", "web", "public"))
src = Image.open("img/brand/logo.png").convert("RGBA"); src = src.crop(src.getbbox())
w, h = src.size; side = max(w, h)
sq = Image.new("RGBA", (side, side), (0, 0, 0, 0)); sq.paste(src, ((side - w) // 2, (side - h) // 2))
BG = (246, 244, 239, 255)
def fit(size, pad=0.0, bg=None):
    inner = int(size * (1 - 2 * pad)); im = sq.resize((inner, inner), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), bg or (0, 0, 0, 0)); out.paste(im, ((size - inner) // 2, (size - inner) // 2), im); return out
for n in (64, 128, 256, 512): fit(n).save(f"img/brand/logo-{n}.png", optimize=True)
fit(32).save("favicon-32.png", optimize=True)
fit(64).save("favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
fit(180, pad=0.1, bg=BG).convert("RGB").save("apple-touch-icon.png", optimize=True)  # iOS не любит прозрачность
fit(192).save("icon-192.png", optimize=True); fit(512).save("icon-512.png", optimize=True)
fit(512, pad=0.16, bg=BG).save("icon-maskable-512.png", optimize=True)  # безопасная зона для скруглённых масок
og = Image.new("RGB", (1200, 630), BG[:3]); mark = fit(480); og.paste(mark, (75, 75), mark); og.save("og-image.png", optimize=True)
print("ok")
