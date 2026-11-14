#!/usr/bin/env python3
"""Атлас листвы из снимков ветвей, сделанных в Blender (v2/tools/blender/*_atlas.py).

Снимки клеток (цвет с прозрачностью и нормали) уменьшаются и раскладываются в одну текстуру; прозрачные места
заливаются цветом соседних листьев (иначе на уменьшенных копиях — тёмная кайма). Рядом пишется таблица клеток:
где клетка лежит в текстуре и какого размера ветвь в метрах — по ней скрипт дерева ставит карточки.

Запуск:  python3 v2/tools/models/atlas.py ПАПКА_СНИМКОВ ВЫХОД_БЕЗ_РАСШИРЕНИЯ РАЗМЕР [--sat 0.8] [--gain 1.1] [--tint r,g,b] имя:ширина_м:высота_м …
Ключи --sat, --gain, --tint — правка цвета листвы (насыщенность, яркость, оттенок): фотография ветки снята вплотную,
а крона издали серее и светлее (небо отражается в листьях).
Клетки кладутся рядами слева направо в порядке перечисления; масштаб у всех один (точек на метр — по самой
тесной раскладке). Нужны numpy, Pillow, scipy.
"""
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage


def bleed(color, alpha, passes=8):
    """Цвет листьев растекается на прозрачные точки."""
    weight = (alpha > 0.5).astype(np.float32)
    spread = color * weight[..., None]
    filled = color.copy()
    known = weight > 0.0
    for _ in range(passes):
        spread = ndimage.gaussian_filter(spread, (2.5, 2.5, 0))
        weight = ndimage.gaussian_filter(weight, 2.5)
        fresh = (~known) & (weight > 0.01)
        filled[fresh] = (spread / np.maximum(weight[..., None], 1.0e-5))[fresh]
        known |= fresh
        spread = filled * known[..., None]
        weight = known.astype(np.float32)
    mean = (color * (alpha > 0.5)[..., None]).sum(axis=(0, 1)) / max((alpha > 0.5).sum(), 1)
    filled[~known] = mean
    return filled


def main():
    folder, out, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
    cells = []
    saturation, gain, tint = 1.0, 1.0, (1.0, 1.0, 1.0)
    items = sys.argv[4:]
    while items:
        item = items.pop(0)
        if item == "--sat":
            saturation = float(items.pop(0))
        elif item == "--gain":
            gain = float(items.pop(0))
        elif item == "--tint":
            tint = tuple(float(v) for v in items.pop(0).split(","))
        else:
            name, wide, tall = item.split(":")
            cells.append((name, float(wide), float(tall)))
    # Раскладка рядами: подобрать наибольший масштаб, при котором всё помещается.
    def layout(scale):
        x = y = row = 0
        places = []
        pad = 6
        for name, wide, tall in cells:
            w, h = int(wide * scale) + pad, int(tall * scale) + pad
            if x + w > size:
                x, y, row = 0, y + row, 0
            if x + w > size or y + h > size:
                return None
            places.append((name, x + pad // 2, y + pad // 2, w - pad, h - pad))
            x += w
            row = max(row, h)
        return places
    low, high = 10.0, 4000.0
    for _ in range(40):
        middle = (low + high) / 2
        if layout(middle) is None:
            high = middle
        else:
            low = middle
    places = layout(low)
    color = np.zeros((size, size, 3), dtype=np.float32)
    alpha = np.zeros((size, size), dtype=np.float32)
    normal = np.zeros((size, size, 3), dtype=np.float32)
    normal[...] = (0.5, 0.5, 1.0)
    table = {"size": size, "pixels_per_metre": low, "cells": {}}
    for (name, x, y, w, h), (_, wide, tall) in zip(places, cells):
        shot = Image.open("%s/%s_color.png" % (folder, name)).convert("RGBA").resize((w, h), Image.LANCZOS)
        relief = Image.open("%s/%s_normal.png" % (folder, name)).convert("RGBA").resize((w, h), Image.LANCZOS)
        pixels = np.asarray(shot, dtype=np.float32) / 255.0
        a = pixels[..., 3]
        color[y:y + h, x:x + w] = pixels[..., :3] / np.maximum(a[..., None], 0.05) * (a[..., None] > 0.02)
        alpha[y:y + h, x:x + w] = a
        bump = np.asarray(relief, dtype=np.float32) / 255.0
        covered = bump[..., 3:4]
        normal[y:y + h, x:x + w] = bump[..., :3] / np.maximum(covered, 0.05) * (covered > 0.3) + np.array([0.5, 0.5, 1.0]) * (covered <= 0.3)
        table["cells"][name] = {"u0": x / size, "v0": y / size, "u1": (x + w) / size, "v1": (y + h) / size, "width": wide, "height": tall}
    color = np.clip(bleed(np.clip(color, 0.0, 1.0), alpha), 0.0, 1.0)
    grey = color.mean(axis=2, keepdims=True)
    color = np.clip((grey + (color - grey) * saturation) * gain * np.array(tint, dtype=np.float32), 0.0, 1.0)
    rgba = np.dstack([color, alpha])
    Image.fromarray((rgba * 255.0 + 0.5).astype(np.uint8), "RGBA").save(out + ".png")
    Image.fromarray((np.clip(normal, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8), "RGB").save(out + "_n.png")
    with open(out + ".json", "w", encoding="utf-8") as file:
        json.dump(table, file, ensure_ascii=False, indent=1)
    print("атлас %d×%d, точек на метр %.0f, клеток %d, покрытие %.0f %%" % (size, size, low, len(cells), 100.0 * (alpha > 0.5).mean()))


if __name__ == "__main__":
    main()
