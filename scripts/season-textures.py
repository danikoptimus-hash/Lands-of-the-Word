#!/usr/bin/env python3
"""
Сезонные картинки карты (решение владельца 05.10): зима, весна, осень.

Исходники местности для каждого сезона лежат в папке (по умолчанию assets/raw/season) как PNG 512×512 (сгенерированы через OpenAI images в 1024 и уменьшены) с именами
<сезон>-<вид>.png, где вид: steppe (desert), hills, meadow, mountains, forest (oasis), lake (water). Скрипт:
  1. летние (summer-*) кладёт в apps/web/public/img/terrain/<имя>.webp (512 px) — это и есть «обычные» картинки;
  2. остальные сезоны — в apps/web/public/img/terrain/<сезон>/<имя>.webp;
  3. для городов, стартов и островков делает сезонные копии цветокоррекцией (зима — холоднее и светлее, как под снегом;
     весна — свежее; осень — теплее и чуть темнее) в apps/web/public/img/<набор>/<сезон>/…; если для островка есть
     сгенерированный <сезон>-islet-N.png, берётся он;
  4. для всего созданного строит утро/вечер/ночь тем же способом, что scripts/tod-textures.py.

Запуск из корня: python3 scripts/season-textures.py [папка-с-исходниками]
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

import importlib.util

_spec = importlib.util.spec_from_file_location("tod_textures", Path(__file__).resolve().parent / "tod-textures.py")
_tod = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_tod)  # type: ignore[union-attr]
GRADES, ROOT, grade = _tod.GRADES, _tod.ROOT, _tod.grade

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "assets" / "raw" / "season")
SEASONS = ["winter", "spring", "autumn"]
TERRAIN = {"steppe": "desert", "hills": "hills", "meadow": "meadow", "mountains": "mountains", "forest": "oasis", "lake": "water"}
SETS = {
    "city": ["village", "capital", "fortress", "hill_city", "port", "ruins", "temple_city", "tent_camp", "walled_city"],
    "start": ["assyria", "babylon", "egypt", "shipwreck", "wilderness", "zin"],
    "islet": ["islet-1", "islet-2", "islet-3", "islet-4", "islet-5", "islet-6", "islet-7"],
}
# Сезонная цветокоррекция для картинок, которых нет в сгенерированном виде (города, старты, островки без своей картинки).
SEASON_GRADES = {
    "winter": dict(mult=(0.98, 1.00, 1.06), bright=1.10, sat=0.55, contrast=0.92, shadow=(0.92, 0.96, 1.08), high=(1.02, 1.03, 1.06), tone=0.8, lift=0.08),
    "spring": dict(mult=(0.98, 1.04, 0.98), bright=1.04, sat=1.08, contrast=1.0, shadow=(0.96, 1.0, 0.98), high=(1.0, 1.02, 0.96), tone=0.5, lift=0.0),
    "autumn": dict(mult=(1.06, 0.96, 0.86), bright=0.97, sat=1.05, contrast=1.02, shadow=(0.96, 0.90, 0.86), high=(1.06, 0.98, 0.84), tone=0.7, lift=0.0),
}


def save_webp(img: Image.Image, dst: Path, quality: int = 84) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    img.save(dst, "WEBP", quality=quality, method=6)


def graded(img: Image.Image, g: dict) -> Image.Image:
    arr = np.asarray(img.convert("RGBA")).astype(np.float32) / 255
    rgb = grade(arr[..., :3], g)
    out = np.concatenate([rgb, arr[..., 3:4]], axis=-1)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")


def tod_variants(day: Image.Image, dst_day: Path) -> None:
    """Рядом с дневной картинкой — утро, вечер, ночь."""
    for ph, g in GRADES.items():
        save_webp(graded(day, g), dst_day.with_name(f"{dst_day.stem}-{ph}.webp"))


def terrain_from_png(src: Path, dst: Path) -> None:
    im = Image.open(src).convert("RGB").resize((512, 512), Image.LANCZOS)
    save_webp(im, dst)
    tod_variants(im, dst)
    print(dst.relative_to(ROOT))


def main() -> None:
    # 1–2. Местность.
    for season in ["summer", *SEASONS]:
        for kind, name in TERRAIN.items():
            src = SRC / f"{season}-{kind}.png"
            if not src.exists():
                continue
            dst = ROOT / "terrain" / (name + ".webp") if season == "summer" else ROOT / "terrain" / season / (name + ".webp")
            terrain_from_png(src, dst)
    # 3–4. Города, старты, островки: своя картинка сезона или цветокоррекция летней.
    for season in SEASONS:
        for folder, names in SETS.items():
            for n in names:
                own = SRC / f"{season}-{n}.png"
                base = ROOT / folder / f"{n}.webp"
                if not base.exists():
                    print("нет файла", base); continue
                dst = ROOT / folder / season / f"{n}.webp"
                if own.exists():
                    im = Image.open(own).convert("RGBA")
                    if folder == "islet":
                        # Островок: контур берётся с летней картинки (альфа), чтобы форма на карте не менялась.
                        b = Image.open(base).convert("RGBA").resize(im.size, Image.LANCZOS)
                        im.putalpha(b.getchannel("A"))
                        im = im.resize(Image.open(base).size, Image.LANCZOS)
                else:
                    im = graded(Image.open(base), SEASON_GRADES[season])
                save_webp(im, dst, 88 if folder == "islet" else 84)
                tod_variants(im, dst)
                print(dst.relative_to(ROOT))


if __name__ == "__main__":
    main()
