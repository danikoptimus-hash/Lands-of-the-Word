#!/usr/bin/env python3
"""Готовит веб-версии картинок из assets/raw и assets/reference в apps/web/public/img.
Текстуры — квадрат 512, объекты — обрезка по прозрачности и уменьшение. Запуск: python3 scripts/process-assets.py"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/web/public/img"

def save(im: Image.Image, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "WEBP", quality=82, method=6)
    print(f"{dest.relative_to(ROOT)}  {im.size[0]}x{im.size[1]}  {dest.stat().st_size // 1024} KB")

def texture(src: Path, dest: Path, size=512):
    im = Image.open(src).convert("RGB").resize((size, size), Image.LANCZOS)
    save(im, dest)

def sprite(src: Path, dest: Path, size: int):
    im = Image.open(src).convert("RGBA")
    bbox = im.getchannel("A").getbbox()
    if bbox: im = im.crop(bbox)
    im.thumbnail((size, size), Image.LANCZOS)
    save(im, dest)

textures = {"desert": ROOT / "assets/reference/terrain_desert.png"}
for t in ["hills", "meadow", "mountains", "oasis", "water"]:
    textures[t] = ROOT / f"assets/raw/terrain/terrain_{t}.png"
for name, src in textures.items():
    texture(src, OUT / "terrain" / f"{name}.webp")

cities = {"walled_city": ROOT / "assets/reference/walled_city.png"}
for c in ["village", "fortress", "temple_city", "port", "tent_camp", "hill_city", "ruins", "capital"]:
    cities[c] = ROOT / f"assets/raw/city/{c}.png"
for name, src in cities.items():
    sprite(src, OUT / "city" / f"{name}.webp", 256)

starts = {"babylon": ROOT / "assets/reference/start_babylon.png"}
for s in ["egypt", "wilderness", "assyria", "zin", "shipwreck"]:
    starts[s] = ROOT / f"assets/raw/start/start_{s}.png"
for name, src in starts.items():
    sprite(src, OUT / "start" / f"{name}.webp", 320)

for p in ["well", "palm", "olive", "rocks", "tent", "campfire"]:
    sprite(ROOT / f"assets/raw/props/{p}.png", OUT / "props" / f"{p}.webp", 160)
