#!/usr/bin/env python3
"""Вырезка фотографий веток с зелёного фона (хромакей) — заготовки листвы для моделей из Blender.

Картинка — несколько веток на ровном зелёном фоне (их делает генератор картинок, см. scripts/img-gen). Здесь фон
убирается: прозрачность — по «зелёности» точки (зелёный канал против большего из красного и синего), у края ветки
цвет очищается от примеси фона. Потом картинка режется на отдельные ветки (связные области), каждая — в свой файл
с прозрачностью, стеблем вниз.

Запуск:  python3 v2/tools/models/key.py картинка.png папка/имя  → папка/имя_1.png, папка/имя_2.png, …
Нужны numpy, Pillow, scipy.
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage


def key(image):
    pixels = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    corners = np.concatenate([pixels[:8, :8].reshape(-1, 3), pixels[:8, -8:].reshape(-1, 3), pixels[-8:, :8].reshape(-1, 3), pixels[-8:, -8:].reshape(-1, 3)])
    back = np.median(corners, axis=0)
    green = pixels[..., 1] - np.maximum(pixels[..., 0], pixels[..., 2])
    full = back[1] - max(back[0], back[2])
    # Лист оливы серо-зелёный: его «зелёность» — до 0,15; фон — около 0,9.
    alpha = 1.0 - np.clip((green - 0.22 * full) / (0.6 * full), 0.0, 1.0)
    # У края точка — смесь ветки и фона: вычесть долю фона и убрать зелёную примесь.
    safe = np.maximum(alpha, 0.05)[..., None]
    color = np.clip((pixels - (1.0 - alpha[..., None]) * back) / safe, 0.0, 1.0)
    limit = np.maximum(color[..., 0], color[..., 2]) * 1.12 + 0.02
    edge = alpha < 0.98
    color[..., 1] = np.where(edge, np.minimum(color[..., 1], limit), color[..., 1])
    alpha = ndimage.gaussian_filter(alpha, 0.6)
    alpha = np.clip((alpha - 0.08) / 0.84, 0.0, 1.0)
    return color, alpha


def main():
    source, prefix = sys.argv[1], sys.argv[2]
    color, alpha = key(Image.open(source))
    labels, count = ndimage.label(alpha > 0.5)
    boxes = ndimage.find_objects(labels)
    parts = []
    for index, box in enumerate(boxes):
        area = int((labels[box] == index + 1).sum())
        if area > 0.004 * alpha.size:
            parts.append((box[1].start, index + 1, box))
    parts.sort()
    # Прозрачные места — средним цветом ветки: на уменьшенных копиях текстуры не будет тёмной каймы.
    for number, (_, label, box) in enumerate(parts, 1):
        pad = 12
        rows = slice(max(box[0].start - pad, 0), min(box[0].stop + pad, alpha.shape[0]))
        columns = slice(max(box[1].start - pad, 0), min(box[1].stop + pad, alpha.shape[1]))
        mask = ndimage.binary_dilation(labels[rows, columns] == label, iterations=4)
        a = alpha[rows, columns] * mask
        c = color[rows, columns]
        mean = (c * a[..., None]).sum(axis=(0, 1)) / max(a.sum(), 1.0)
        # Размазать цвет ветки на прозрачные точки рядом (несколько проходов размытия), дальше — средний цвет.
        spread = c * a[..., None]
        weight = a.copy()
        for _ in range(6):
            spread = ndimage.gaussian_filter(spread, (3, 3, 0))
            weight = ndimage.gaussian_filter(weight, 3)
        filled = np.where(weight[..., None] > 0.02, spread / np.maximum(weight[..., None], 1.0e-4), mean)
        out = np.where(a[..., None] > 0.9, c, filled * (1.0 - a[..., None]) + c * a[..., None])
        rgba = np.dstack([np.clip(out, 0.0, 1.0), a])
        Image.fromarray((rgba * 255.0 + 0.5).astype(np.uint8), "RGBA").save("%s_%d.png" % (prefix, number))
        print("%s_%d.png: %d×%d" % (prefix, number, rgba.shape[1], rgba.shape[0]))


if __name__ == "__main__":
    main()
