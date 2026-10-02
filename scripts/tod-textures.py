#!/usr/bin/env python3
"""
Окрашенные копии текстур карты под времена суток (решение владельца 03.10): утро, вечер, ночь.
Текстуры не меняются — те же картинки, только цветокоррекция, как фотография при другом освещении.
Дневные файлы остаются как есть; рядом создаются <имя>-morning.webp, <имя>-evening.webp, <имя>-night.webp.

Палитры подобраны по фотографиям моря и берега (заря, закат, лунная ночь):
  вечер — тёплый оранжево-золотой свет, тени уходят в лиловое, чуть темнее дня;
  утро  — светлее и мягче, жёлто-золотые света, розовато-сизые тени, лёгкая дымка;
  ночь  — тёмная синева, краски приглушены, но всё разборчиво: тени приподняты.

Запуск из корня репозитория: python3 scripts/tod-textures.py  (нужны Pillow и numpy).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "apps" / "web" / "public" / "img"
SETS = {
    "terrain": ["desert", "hills", "meadow", "mountains", "water", "oasis"],
    "city": ["village", "capital", "fortress", "hill_city", "port", "ruins", "temple_city", "tent_camp", "walled_city"],
    "start": ["assyria", "babylon", "egypt", "shipwreck", "wilderness", "zin"],
    "islet": ["islet-1", "islet-2", "islet-3", "islet-4", "islet-5", "islet-6"],
}

# Параметры цветокоррекции: множитель каналов, яркость, насыщенность, контраст, тон теней и светов (множители) и сила тонирования.
GRADES = {
    "morning": dict(mult=(1.08, 1.00, 0.84), bright=1.06, sat=0.98, contrast=0.90, shadow=(0.96, 0.87, 1.00), high=(1.08, 1.00, 0.78), tone=0.9, lift=0.04),
    "evening": dict(mult=(1.03, 0.90, 0.76), bright=0.90, sat=1.00, contrast=1.03, shadow=(0.72, 0.66, 0.94), high=(1.10, 0.94, 0.70), tone=0.85, lift=0.0),
    "night": dict(mult=(0.55, 0.68, 1.06), bright=0.60, sat=0.75, contrast=0.95, shadow=(0.85, 0.90, 1.20), high=(1.0, 1.0, 1.0), tone=0.5, lift=0.04),
}


def grade(rgb: np.ndarray, g: dict) -> np.ndarray:
    """rgb — float 0..1, форма (h, w, 3)."""
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    out = lum[..., None] + (rgb - lum[..., None]) * g["sat"]
    out = out * np.array(g["mult"]) * g["bright"]
    out = (out - 0.5) * g["contrast"] + 0.5
    # Раздельное тонирование: тени и света умножаются на свои оттенки, между ними — по яркости.
    l2 = np.clip(lum[..., None], 0, 1)
    tone = np.array(g["shadow"]) * (1 - l2) + np.array(g["high"]) * l2
    out = out * (1 - g["tone"]) + out * tone * g["tone"]
    out = out + g["lift"]
    return np.clip(out, 0, 1)


def convert(src: Path, phase: str) -> Path:
    im = Image.open(src).convert("RGBA")
    arr = np.asarray(im).astype(np.float32) / 255
    rgb = grade(arr[..., :3], GRADES[phase])
    out = np.concatenate([rgb, arr[..., 3:4]], axis=-1)
    dst = src.with_name(f"{src.stem}-{phase}.webp")
    Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA").save(dst, "WEBP", quality=84, method=6)
    return dst


def main() -> None:
    phases = sys.argv[1:] or list(GRADES)
    for folder, names in SETS.items():
        for n in names:
            src = ROOT / folder / f"{n}.webp"
            if not src.exists():
                print("нет файла", src); continue
            for ph in phases:
                dst = convert(src, ph)
                print(dst.relative_to(ROOT), f"{dst.stat().st_size // 1024} КБ")


if __name__ == "__main__":
    main()
