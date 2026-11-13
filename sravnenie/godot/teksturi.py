#!/usr/bin/env python3
"""Материалы земли и карта их раскладки для сцены Godot (дополнение Terrain3D).

Материалы — свободные фотосканы Poly Haven (CC0), те же, что уже лежат в кэше игры; скачивание и
чтение карт — из v2/tools/surfaces/make.py. Terrain3D ждёт на каждый материал две картинки одного
размера: цвет + высота фактуры (в прозрачности) и нормаль + шероховатость (в прозрачности).

Что получается:
  sravnenie/godot/teksturi/<имя>_alb.png, <имя>_nrm.png и настройки импорта к ним
  sravnenie/godot/dannye/kontrol.u32 — карта раскладки: на каждую точку земли 32 бита в виде Terrain3D
      (основной материал, второй материал и доля второго), по картам общей основы

Запуск: python sravnenie/godot/teksturi.py   (numpy и Pillow; в рабочей среде — scratchpad/gdvenv)
"""
import importlib.util
import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BASE = os.path.join(ROOT, "sravnenie", "osnova", "dannye")

spec = importlib.util.spec_from_file_location("surfaces", os.path.join(ROOT, "v2", "tools", "surfaces", "make.py"))
surfaces = importlib.util.module_from_spec(spec)
spec.loader.exec_module(surfaces)

# Порядок — номера материалов в Terrain3D. tile — сколько метров занимает плитка.
# mean — средний цвет на берегу Корфу (sRGB): светлый известняк, сухая бурая почва, выгоревшая трава.
MATERIALS = [
    dict(key="pochva", name="dry_ground_rocks", source="ph", tile=5.0, mean=(126, 108, 82), sat=0.85, contrast=1.05),
    dict(key="skala", name="marble_cliff_03", source="ph", tile=16.0, mean=(196, 190, 174), sat=0.55, contrast=1.15),
    dict(key="galka", name="ganges_river_pebbles", source="ph", tile=3.0, mean=(192, 184, 166), sat=0.6, contrast=1.05),
    dict(key="trava", name="aerial_rocks_01", source="ph", tile=70.0, mean=(128, 124, 86), sat=0.85, contrast=1.1),
]

IMPORT = """[remap]

importer="texture"
type="CompressedTexture2D"

[deps]

source_file="res://teksturi/{file}"

[params]

compress/mode=2
compress/high_quality=false
compress/lossy_quality=0.7
compress/hdr_compression=1
compress/normal_map=2
compress/channel_pack=0
mipmaps/generate=true
mipmaps/limit=-1
roughness/mode=0
process/fix_alpha_border=false
process/premult_alpha=false
detect_3d/compress_to=0
"""


def textures():
    out = os.path.join(HERE, "teksturi")
    os.makedirs(out, exist_ok=True)
    table = []
    for layer in MATERIALS:
        color, height, normal, rough = surfaces.load_maps(layer)
        color = surfaces.grade(color, layer)
        to8 = lambda a: np.round(np.clip(a, 0.0, 1.0) * 255.0).astype(np.uint8)
        alb = np.dstack([to8(color), to8(height)])
        nrm = np.dstack([to8(normal), to8(rough)])
        for tag, data in (("alb", alb), ("nrm", nrm)):
            name = f"{layer['key']}_{tag}.png"
            Image.fromarray(data, "RGBA").save(os.path.join(out, name), optimize=True)
            with open(os.path.join(out, name + ".import"), "w", encoding="utf8") as f:
                f.write(IMPORT.format(file=name))
        table.append({"imya": layer["key"], "plitka_m": layer["tile"], "sredniy_tsvet": [int(v) for v in color.reshape(-1, 3).mean(0) * 255]})
        print(layer["key"], "←", layer["name"], "средний цвет", table[-1]["sredniy_tsvet"])
    json.dump(table, open(os.path.join(HERE, "dannye", "materialy.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)


def control_map():
    info = json.load(open(os.path.join(BASE, "opisanie.json"), encoding="utf8"))
    size = int(info["razmer"])
    masks = np.asarray(Image.open(os.path.join(BASE, "maski.png")).convert("RGBA"), np.float64) / 255.0
    h = np.fromfile(os.path.join(BASE, "vysoty.r16"), "<u2").reshape(size, size).astype(np.float64)
    h = info["vysota_min_m"] + h / 65535.0 * (info["vysota_max_m"] - info["vysota_min_m"])
    rock, trees, shrubs, beach = masks[..., 0], masks[..., 1], masks[..., 2], masks[..., 3]
    under = h <= 0.0
    cell = info["shag_m"]
    gy, gx = np.gradient(h, cell)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    # Вес каждого материала в точке. Под водой — галька и песок, на крутом дне камень.
    w = np.zeros((size, size, 4))
    w[..., 0] = np.clip(0.25 + trees - 0.5 * rock, 0.0, 1.0)          # почва: под деревьями и везде понемногу
    w[..., 1] = rock * 1.6                                             # скала
    w[..., 2] = beach * 2.0                                            # галька
    w[..., 3] = np.clip(shrubs * 1.1 - 0.35 * trees, 0.0, 1.0)         # сухая трава: поляны, склоны, вершины
    sea_rock = np.clip((slope - 14.0) / 16.0, 0.0, 1.0)
    w[under] = 0.0
    w[..., 2][under] = 1.0 - 0.8 * sea_rock[under]
    w[..., 1][under] = sea_rock[under]
    order = np.argsort(-w, axis=2)
    first, second = order[..., 0], order[..., 1]
    w1 = np.take_along_axis(w, first[..., None], 2)[..., 0]
    w2 = np.take_along_axis(w, second[..., None], 2)[..., 0]
    blend = np.round(255.0 * w2 / np.maximum(w1 + w2, 1e-6)).astype(np.uint32)
    bits = (first.astype(np.uint32) << 27) | (second.astype(np.uint32) << 22) | (blend << 14)
    bits.astype("<u4").tofile(os.path.join(HERE, "dannye", "kontrol.u32"))
    share = [round(float((first == i).mean()), 3) for i in range(4)]
    print("карта раскладки записана; доли основных материалов:", dict(zip([m["key"] for m in MATERIALS], share)))


if __name__ == "__main__":
    textures()
    control_map()
