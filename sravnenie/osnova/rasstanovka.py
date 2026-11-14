#!/usr/bin/env python3
"""Правило расстановки растений и камней — образец для всех движков.

Точки не хранятся списком: каждый движок повторяет это правило у себя и получает те же самые
места. Поэтому здесь только целые числа по 32 бита и чтение карт без сглаживания — такое
одинаково считается в GDScript, C# и Python.

Слои (клетка сетки — из opisanie.json):
  деревья — канал G карты maski.png; порода — по porody.png
  кусты   — канал B
  камни   — канал R, с коэффициентом 0,22

Виды (kind):
  0, 1 — олива (две модели)   2 — широколистное   3 — сосна   4 — малое дерево
  5, 6 — вечнозелёный куст    7 — сухой куст      8 — камень

Запуск для проверки: python sravnenie/osnova/rasstanovka.py  — число точек по видам и картинка участка.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "dannye")
M = 0xFFFFFFFF


def h32(x):
    """Перемешивание 32-битного числа (Томас Ванг). x — массив uint64, считаем по модулю 2^32."""
    x = x & M
    x = ((x ^ 61) ^ (x >> 16)) & M
    x = (x * 9) & M
    x = x ^ (x >> 4)
    x = (x * 0x27D4EB2D) & M
    x = x ^ (x >> 15)
    return x & M


def rnd(ix, iz, salt, seed):
    """Число от 0 до 1 для клетки (ix, iz) и номера величины salt."""
    k = ((ix * 73856093) & M) ^ ((iz * 19349663) & M) ^ ((salt * 83492791) & M) ^ (seed & M)
    return h32(h32(k)).astype(np.float64) / 4294967296.0


class Base:
    def __init__(self):
        self.info = json.load(open(os.path.join(DATA, "opisanie.json"), encoding="utf8"))
        self.side = float(self.info["storona_m"])
        self.size = int(self.info["razmer"])
        self.seed = int(self.info["rasstanovka"]["zerno"])
        self.masks = np.asarray(Image.open(os.path.join(DATA, "maski.png")).convert("RGBA"), np.uint8)
        self.kinds = np.asarray(Image.open(os.path.join(DATA, "porody.png")).convert("RGB"), np.uint8)
        h = np.asarray(Image.open(os.path.join(DATA, "vysoty.png")), np.float64)
        self.height = self.info["vysota_min_m"] + h / 65535.0 * (self.info["vysota_max_m"] - self.info["vysota_min_m"])

    def texel(self, u, v):
        col = np.clip((u / self.side * self.size).astype(np.int64), 0, self.size - 1)
        row = np.clip(((self.side - v) / self.side * self.size).astype(np.int64), 0, self.size - 1)
        return row, col

    def layer(self, name, u0, v0, u1, v1):
        """Точки слоя name в прямоугольнике (метры основы). Возвращает u, v, kind, поворот, размер."""
        r = self.info["rasstanovka"]
        cell = {"derevya": r["derevya_kletka_m"], "kusty": r["kusty_kletka_m"], "kamni": r["kamni_kletka_m"]}[name]
        salt0 = {"derevya": 0, "kusty": 100, "kamni": 200}[name]
        ix = np.arange(int(math.floor(u0 / cell)), int(math.ceil(u1 / cell)), dtype=np.uint64)
        iz = np.arange(int(math.floor(v0 / cell)), int(math.ceil(v1 / cell)), dtype=np.uint64)
        ix, iz = np.meshgrid(ix, iz)
        ix, iz = ix.ravel(), iz.ravel()
        rn = lambda k: rnd(ix, iz, np.uint64(salt0 + k), self.seed)
        u = (ix.astype(np.float64) + 0.15 + 0.7 * rn(1)) * cell
        v = (iz.astype(np.float64) + 0.15 + 0.7 * rn(2)) * cell
        row, col = self.texel(u, v)
        m = self.masks[row, col].astype(np.float64) / 255.0
        if name == "derevya":
            keep = rn(3) < m[:, 1]
            p = self.kinds[row, col, 0] / 255.0
            b = self.kinds[row, col, 1] / 255.0 * (1.0 - p)
            r4, r7 = rn(4), rn(7)
            kind = np.where(r4 < p, 3, np.where(r4 < p + b, 2, np.where(r7 < 0.08, 4, np.where(r7 < 0.54, 0, 1))))
            scale = 0.78 + 0.44 * rn(6)
        elif name == "kusty":
            keep = rn(3) < m[:, 2]
            r4 = rn(4)
            dry = 0.2 + 0.5 * m[:, 0]
            kind = np.where(r4 < dry, 7, np.where(r4 < dry + (1.0 - dry) * 0.5, 5, 6))
            scale = 0.7 + 0.6 * rn(6)
        else:
            keep = rn(3) < m[:, 0] * 0.22
            kind = np.full(u.shape, 8)
            scale = 0.6 + 1.4 * rn(6) ** 2
        inside = (u >= u0) & (u < u1) & (v >= v0) & (v < v1)
        keep &= inside & (self.height[row, col] > 0.3)
        yaw = rn(5) * 2.0 * math.pi
        return u[keep], v[keep], kind[keep].astype(np.int64), yaw[keep], scale[keep]


def main():
    base = Base()
    total = {}
    step = 2750.0   # считаем кусками, чтобы не держать в памяти все клетки сразу
    for name in ("derevya", "kusty", "kamni"):
        for a in np.arange(0.0, base.side, step):
            for b in np.arange(0.0, base.side, step):
                _, _, kind, _, _ = base.layer(name, a, b, min(a + step, base.side), min(b + step, base.side))
                for k, n in zip(*np.unique(kind, return_counts=True)):
                    total[int(k)] = total.get(int(k), 0) + int(n)
    names = {0: "олива 1", 1: "олива 2", 2: "широколистное", 3: "сосна", 4: "малое дерево", 5: "куст 1", 6: "куст 2", 7: "сухой куст", 8: "камень"}
    for k in sorted(total):
        print(f"{names[k]:>14}: {total[k]:>9,}".replace(",", " "))
    print(f"{'всего':>14}: {sum(total.values()):>9,}".replace(",", " "))

    # Картинка участка 700 × 700 м у Палеокастрицы: каждая точка — растение в своём размере.
    u0, v0, w = 5150.0, 4700.0, 700.0
    px = 1000
    im = np.full((px, px, 3), (150, 132, 100), np.uint8)
    row, col = base.texel(*np.meshgrid(u0 + (np.arange(px) + 0.5) / px * w, v0 + w - (np.arange(px) + 0.5) / px * w))
    hh = base.height[row, col]
    im[hh <= 0.0] = (60, 130, 160)
    im[base.masks[row, col, 0] > 110] = (200, 195, 180)
    colors = {0: (92, 108, 70), 1: (84, 100, 62), 2: (70, 108, 50), 3: (48, 80, 44), 4: (100, 120, 70), 5: (98, 104, 60), 6: (86, 96, 58), 7: (140, 128, 86), 8: (170, 165, 150)}
    radius = {0: 3.6, 1: 3.6, 2: 4.2, 3: 3.0, 4: 2.4, 5: 1.1, 6: 1.1, 7: 0.8, 8: 1.0}
    from PIL import ImageDraw
    canvas = Image.fromarray(im); d = ImageDraw.Draw(canvas)
    for name in ("kamni", "kusty", "derevya"):
        u, v, kind, yaw, scale = base.layer(name, u0, v0, u0 + w, v0 + w)
        for x, y, k, s in zip((u - u0) / w * px, (v0 + w - v) / w * px, kind, scale):
            r = radius[int(k)] * s / w * px
            d.ellipse((x - r, y - r, x + r, y + r), fill=colors[int(k)])
    canvas.save(os.path.join(DATA, "rasstanovka_uchastok.jpg"), quality=88)


if __name__ == "__main__":
    main()
