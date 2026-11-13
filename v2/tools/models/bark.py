#!/usr/bin/env python3
"""Кора для модели из Blender: фотоскан Poly Haven (CC0) — цвет и карта нормалей, уменьшенные до нужного размера.

Запуск:  python3 v2/tools/models/bark.py имя_материала ПАПКА_ВИДА [размер] [насыщенность] [r,g,b]
Пишет ПАПКА_ВИДА/kora.jpg и kora_n.jpg. Кэш — ~/.cache/zemli-slova/models. Нужны numpy и Pillow.
"""
import os
import sys
import urllib.request

import numpy as np
from PIL import Image

CACHE = os.path.expanduser("~/.cache/zemli-slova/models")


def fetch(name, tag):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, "%s_%s.jpg" % (name, tag))
    if not os.path.exists(path):
        url = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/%s/%s_%s_1k.jpg" % (name, name, tag)
        request = urllib.request.Request(url, headers={"User-Agent": "zemli-slova-tools"})
        with urllib.request.urlopen(request, timeout=180) as response:
            data = response.read()
        with open(path, "wb") as file:
            file.write(data)
    return path


def main():
    name, folder = sys.argv[1], sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 512
    saturation = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
    tint = tuple(float(v) for v in sys.argv[5].split(",")) if len(sys.argv) > 5 else (1.0, 1.0, 1.0)
    color = np.asarray(Image.open(fetch(name, "diff")).convert("RGB").resize((size, size), Image.LANCZOS), dtype=np.float32) / 255.0
    grey = color.mean(axis=2, keepdims=True)
    color = np.clip((grey + (color - grey) * saturation) * np.array(tint, dtype=np.float32), 0.0, 1.0)
    Image.fromarray((color * 255.0).astype(np.uint8)).save(os.path.join(folder, "kora.jpg"), quality=90)
    Image.open(fetch(name, "nor_gl")).convert("RGB").resize((size, size), Image.LANCZOS).save(os.path.join(folder, "kora_n.jpg"), quality=90)
    print("кора %s: %d×%d" % (name, size, size))


if __name__ == "__main__":
    main()
