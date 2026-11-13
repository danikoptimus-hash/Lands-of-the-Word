#!/usr/bin/env python3
"""Модели деревьев версии 2 (задание владельца 13.11: «не шары и многогранники»): олива, кипарис, сосна-пиния.

Дерево строится по правилам вида: ствол и ветви — трубки по ломаным с сужением и изгибами, листва — «карточки»
(плоские четырёхугольники с рисунком ветки и вырезкой по прозрачности) на концах ветвей. У каждого варианта три
уровня подробности из одного и того же скелета — силуэт, размер кроны и тон одинаковы, упрощается только мелкое:
  _LOD0 — все ветви и мелкие карточки-ветки; _LOD1 — ствол с главными ветвями и карточки-охапки;
  _LOD2 — ствол и два десятка больших карточек.
Кора — фотоматериалы ambientCG (CC0), рисунок листвы рисуется здесь же (лист за листом, по форме вида).
На выходе — файлы glTF (.glb) в v2/assets/models/flora/ по правилам v2/assets/models/README.md: метры, опора
в основании ствола, вверх +Y, два материала (kora, listva), цвет вершин: красный — гибкость для ветра,
зелёный — затенение в глубине кроны.

Запуск из корня репозитория:  python3 v2/tools/models/make.py [--sheet файл.jpg]
Нужны numpy и Pillow. Кэш текстур — ~/.cache/zemli-slova/models.
"""
import io
import json
import math
import os
import struct
import sys
import urllib.request
import zipfile

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "models", "flora")
CACHE = os.path.expanduser("~/.cache/zemli-slova/models")
UP = np.array([0.0, 1.0, 0.0])


# ───────────────────────── текстуры ─────────────────────────

def bark_texture(asset, tint, size=512):
    """Кора: цвет фотоматериала ambientCG, приведённый к тону вида."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, asset + ".zip")
    if not os.path.exists(path):
        request = urllib.request.Request("https://ambientcg.com/get?file=%s_1K-JPG.zip" % asset, headers={"User-Agent": "zemli-slova-tools"})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
        with open(path, "wb") as file:
            file.write(data)
    with zipfile.ZipFile(path) as archive:
        name = [n for n in archive.namelist() if n.endswith("_Color.jpg")][0]
        image = Image.open(io.BytesIO(archive.read(name))).convert("RGB").resize((size, size), Image.LANCZOS)
    pixels = np.asarray(image, dtype=np.float32) / 255.0
    grey = pixels.mean(axis=2, keepdims=True)
    grey = (grey - grey.mean()) * 1.25 + 0.5
    pixels = np.clip(grey * np.array(tint, dtype=np.float32) * 2.0, 0.0, 1.0)
    return Image.fromarray((pixels * 255.0).astype(np.uint8))


def _leaf(draw, at, angle, length, width, color, rib):
    """Ланцетный лист: вытянутый овал с жилкой."""
    ax, ay = math.cos(angle), math.sin(angle)
    px, py = -ay, ax
    points = []
    for i in range(13):
        t = i / 12.0
        half = width * math.sin(math.pi * t) ** 0.8 * 0.5
        points.append((at[0] + ax * length * t + px * half, at[1] + ay * length * t + py * half))
    for i in range(12, -1, -1):
        t = i / 12.0
        half = width * math.sin(math.pi * t) ** 0.8 * 0.5
        points.append((at[0] + ax * length * t - px * half, at[1] + ay * length * t - py * half))
    draw.polygon(points, fill=color)
    draw.line([at, (at[0] + ax * length, at[1] + ay * length)], fill=rib, width=max(int(width * 0.12), 1))


def _finish(image, size):
    """Уменьшить с сглаживанием и залить прозрачные места цветом листвы (иначе на уменьшенных копиях — тёмная кайма)."""
    image = image.resize((size, size), Image.LANCZOS)
    pixels = np.asarray(image, dtype=np.float32)
    alpha = pixels[..., 3:4] / 255.0
    mean = (pixels[..., :3] * alpha).sum(axis=(0, 1)) / max(alpha.sum(), 1.0)
    pixels[..., :3] = pixels[..., :3] * alpha + mean * (1.0 - alpha)
    return Image.fromarray(pixels.astype(np.uint8), "RGBA")


def twig_olive(rng, size=512, clump=False):
    """Ветка оливы: стебель с боковыми веточками, узкие листья парами — тёмные сверху, серебристые с изнанки."""
    return _twig_leafy(rng, size, clump, 0.24, (0.05, 0.075), (88, 112, 74), (150, 165, 138), 0.32)


def twig_oak(rng, size=512, clump=False):
    """Ветка дуба: листья шире и крупнее, тёмно-зелёные, изредка желтоватые."""
    return _twig_leafy(rng, size, clump, 0.52, (0.06, 0.085), (74, 108, 50), (116, 134, 58), 0.16)


def _twig_leafy(rng, size, clump, leaf_width, leaf_length, green, second, second_share):
    """Ветка лиственного дерева: стебель с боковыми веточками и листьями вдоль них."""
    scale = 4
    big = size * scale
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    twigs = 14 if clump else 1
    for index in range(twigs):
        if clump:
            base = (big * rng.uniform(0.3, 0.7), big * rng.uniform(0.45, 0.8))
            heading = -math.pi / 2 + rng.uniform(-1.5, 1.5)
            reach = big * rng.uniform(0.3, 0.45)
        else:
            base = (big * 0.5, big * 0.97)
            heading = -math.pi / 2
            reach = big * 0.9
        stem = [base]
        angle = heading
        for step in range(10):
            angle += rng.uniform(-0.12, 0.12)
            stem.append((stem[-1][0] + math.cos(angle) * reach / 10.0, stem[-1][1] + math.sin(angle) * reach / 10.0))
        draw.line(stem, fill=(86, 74, 58, 255), width=max(int(big * 0.008), 2))
        shoots = [(stem, angle)]
        for at in range(2, 10, 1 if clump else 1):
            side = 1.0 if at % 2 == 0 else -1.0
            start = stem[at]
            direction = heading + side * rng.uniform(0.55, 0.95)
            length = reach * rng.uniform(0.22, 0.4) * (1.0 - 0.05 * at)
            shoot = [start]
            for step in range(6):
                direction += rng.uniform(-0.1, 0.1) - side * 0.04
                shoot.append((shoot[-1][0] + math.cos(direction) * length / 6.0, shoot[-1][1] + math.sin(direction) * length / 6.0))
            draw.line(shoot, fill=(92, 80, 62, 255), width=max(int(big * 0.005), 1))
            shoots.append((shoot, direction))
        for shoot, direction in shoots:
            for i in range(1, len(shoot)):
                for side in (-1.0, 1.0):
                    for extra in range(2):
                        t = rng.uniform(0.0, 1.0)
                        at = (shoot[i - 1][0] * (1 - t) + shoot[i][0] * t, shoot[i - 1][1] * (1 - t) + shoot[i][1] * t)
                        lean = math.atan2(shoot[i][1] - shoot[i - 1][1], shoot[i][0] - shoot[i - 1][0]) + side * rng.uniform(0.5, 1.0)
                        length = big * rng.uniform(leaf_length[0], leaf_length[1])
                        other = rng.random() < second_share
                        tone = rng.uniform(0.82, 1.12)
                        base_color = second if other else green
                        color = (int(base_color[0] * tone), int(base_color[1] * tone), int(base_color[2] * tone), 255)
                        rib = (int(color[0] * 0.8), int(color[1] * 0.85), int(color[2] * 0.8), 255)
                        _leaf(draw, at, lean, length, length * leaf_width, color, rib)
    return _finish(image, size)


def frond_cypress(rng, size=512, clump=False):
    """Побег кипариса: плотная «чешуйчатая» хвоя вдоль веточек, тянущихся вверх, — пламя с рваным краем."""
    scale = 3
    big = size * scale
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    sprays = 26 if clump else 15
    for index in range(sprays):
        x = big * (0.5 + rng.uniform(-0.2, 0.2) * (1.4 if clump else 1.0))
        y = big * rng.uniform(0.75, 0.99)
        angle = -math.pi / 2 + rng.uniform(-0.3, 0.3)
        reach = big * rng.uniform(0.55, 0.92) * (1.0 - abs(x / big - 0.5) * 1.2)
        steps = 46
        for step in range(steps):
            t = step / float(steps)
            angle += rng.uniform(-0.05, 0.05)
            x += math.cos(angle) * reach / steps
            y += math.sin(angle) * reach / steps
            radius = big * 0.03 * (1.0 - t) ** 0.6 + big * 0.006
            tone = rng.uniform(0.7, 1.2) * (0.75 + 0.35 * t)
            color = (int(46 * tone), int(84 * tone), int(44 * tone), 255)
            # Чешуйки-веточки в стороны: короткие штрихи.
            for side in (-1.0, 1.0):
                lean = angle + side * rng.uniform(0.5, 1.1)
                draw.line([(x, y), (x + math.cos(lean) * radius * 2.4, y + math.sin(lean) * radius * 2.4)], fill=color, width=max(int(radius * 0.9), 2))
            draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color)
    return _finish(image, size)


def tuft_pine(rng, size=512, clump=False):
    """Хвоя пинии: пучки длинных игл на концах веточек."""
    scale = 3
    big = size * scale
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    tufts = 22 if clump else 12
    for index in range(tufts):
        if clump or index > 0:
            cx = big * rng.uniform(0.22, 0.78)
            cy = big * rng.uniform(0.22, 0.78)
        else:
            cx, cy = big * 0.5, big * 0.5
        draw.line([(big * 0.5, big * 0.62), (cx, cy)], fill=(98, 70, 50, 255), width=max(int(big * 0.012), 2))
        needles = 170
        length = big * rng.uniform(0.15, 0.21)
        heading = rng.uniform(0.0, math.tau)
        for n in range(needles):
            angle = heading + rng.uniform(-math.pi, math.pi) * 0.95
            reach = length * rng.uniform(0.6, 1.0)
            tone = rng.uniform(0.7, 1.25)
            color = (int(34 * tone), int(64 * tone), int(36 * tone), 255) if rng.random() < 0.8 else (int(70 * tone), int(92 * tone), int(40 * tone), 255)
            bend = rng.uniform(-0.25, 0.25)
            middle = (cx + math.cos(angle) * reach * 0.5, cy + math.sin(angle) * reach * 0.5)
            tip = (cx + math.cos(angle + bend) * reach, cy + math.sin(angle + bend) * reach)
            draw.line([(cx, cy), middle, tip], fill=color, width=max(int(big * 0.0035), 2))
    return _finish(image, size)


def atlas(makers, rng):
    """Четыре рисунка в одной текстуре 2×2: две ветки, охапка для среднего уровня, большая охапка для дальнего."""
    # Клетка — 256 точек: карточка в метр-два видна в игре не ближе чем с шестидесяти метров, больше не нужно.
    sheet = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    cells = [makers(rng, 256, False), makers(rng, 256, False), makers(rng, 256, True), makers(rng, 256, True)]
    for i, cell in enumerate(cells):
        sheet.paste(cell, ((i % 2) * 256, (i // 2) * 256))
    return sheet


CELLS = [(0.0, 0.0, 0.5, 0.5), (0.5, 0.0, 1.0, 0.5), (0.0, 0.5, 0.5, 1.0), (0.5, 0.5, 1.0, 1.0)]  # u0, v0, u1, v1


# ───────────────────────── сетки ─────────────────────────

class Part:
    """Одна поверхность модели: вершины с нормалями, координатами текстуры, цветом и треугольники."""

    def __init__(self):
        self.positions, self.normals, self.uvs, self.colors, self.indices = [], [], [], [], []

    def count(self):
        return len(self.indices) // 3

    def tube(self, points, radii, sides, flex, tile=1.6):
        """Трубка по ломаной: кольца вершин, рисунок коры вдоль ветви."""
        points = np.asarray(points, dtype=np.float64)
        first = len(self.positions)
        tangent = points[1] - points[0]
        tangent /= np.linalg.norm(tangent)
        side = np.cross(tangent, UP if abs(tangent[1]) < 0.95 else np.array([1.0, 0.0, 0.0]))
        side /= np.linalg.norm(side)
        along = 0.0
        for i in range(len(points)):
            if i > 0:
                along += np.linalg.norm(points[i] - points[i - 1])
            new_tangent = points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]
            new_tangent /= np.linalg.norm(new_tangent)
            side = side - new_tangent * np.dot(side, new_tangent)
            side /= np.linalg.norm(side)
            other = np.cross(new_tangent, side)
            for k in range(sides + 1):
                angle = math.tau * k / sides
                normal = side * math.cos(angle) + other * math.sin(angle)
                self.positions.append(points[i] + normal * radii[i])
                self.normals.append(normal)
                self.uvs.append((k / sides * max(round(radii[0] * 6.0), 1), along / tile))
                self.colors.append((flex[i], 1.0, 0.0, 1.0))
        for i in range(len(points) - 1):
            for k in range(sides):
                a = first + i * (sides + 1) + k
                b = a + sides + 1
                self.indices += [a, b, a + 1, a + 1, b, b + 1]

    def card(self, base, along, side, cell, normal, shade):
        """Карточка листвы: от основания ветки к её концу; нормаль — «от кроны наружу», мягкий свет по всей кроне."""
        first = len(self.positions)
        u0, v0, u1, v1 = CELLS[cell]
        corners = [(base - side, (u0, v1)), (base + side, (u1, v1)), (base + along + side, (u1, v0)), (base + along - side, (u0, v0))]
        centre = base + along * 0.5
        for corner, uv in corners:
            bent = normal + (corner - centre) / max(np.linalg.norm(along), 1.0e-6) * 0.35
            self.positions.append(corner)
            self.normals.append(bent / np.linalg.norm(bent))
            self.uvs.append(uv)
            self.colors.append((1.0, shade, 0.0, 1.0))
        self.indices += [first, first + 1, first + 2, first, first + 2, first + 3]


class Tree:
    """Скелет дерева: ветви (ломаная, радиусы, порядок) и «якоря» листвы (место, направление, размер)."""

    def __init__(self):
        self.branches = []  # (points, radii, order)
        self.anchors = []  # (place, direction, size)
        self.centre = np.zeros(3)
        self.radii = np.ones(3)

    def fit(self, height):
        """Привести дерево к опорному росту (верх листвы — на высоте height) и запомнить середину и размах кроны."""
        top = max(a[0][1] + a[2] * 0.4 for a in self.anchors)
        factor = height / top
        self.branches = [([p * factor for p in points], [r * factor for r in radii], order) for points, radii, order in self.branches]
        self.anchors = [(place * factor, direction, size * factor ** 0.5) for place, direction, size in self.anchors]
        places = np.array([a[0] for a in self.anchors])
        self.centre = (places.max(axis=0) + places.min(axis=0)) * 0.5
        self.radii = np.maximum((places.max(axis=0) - places.min(axis=0)) * 0.5, 0.5)

    def limb(self, rng, start, direction, length, radius, tip_radius, order, steps, wobble, lift=0.0):
        """Ветвь: ломаная от start, с изгибами и тягой вверх (lift > 0) или к горизонтали (lift < 0)."""
        points = [np.asarray(start, dtype=np.float64)]
        direction = np.asarray(direction, dtype=np.float64)
        direction /= np.linalg.norm(direction)
        radii = [radius]
        for i in range(steps):
            direction = direction + rng.normal(0.0, wobble, 3) + UP * lift
            direction /= np.linalg.norm(direction)
            points.append(points[-1] + direction * length / steps)
            radii.append(radius + (tip_radius - radius) * (i + 1) / steps)
        self.branches.append((points, radii, order))
        return points, direction


def _outward(place, tree):
    normal = (place - tree.centre) / tree.radii
    normal = normal + UP * 0.9
    return normal / max(np.linalg.norm(normal), 1.0e-6)


def _shade(place, tree):
    """Затенение в глубине кроны: у края светло, в середине темнее."""
    depth = np.linalg.norm((place - tree.centre) / tree.radii)
    # Низ кроны в тени верха: к нижнему краю темнее.
    low = np.clip((place[1] - (tree.centre[1] - tree.radii[1])) / (2.0 * tree.radii[1]), 0.0, 1.0)
    return float(np.clip((0.5 + 0.55 * depth) * (0.68 + 0.32 * low), 0.4, 1.0))


def build(tree, rng, level, sides, card_size, style):
    """Сетки уровня подробности из скелета: кора и листва."""
    bark, leaves = Part(), Part()
    keep_order = [9, 1, 0][level]
    for points, radii, order in tree.branches:
        if order > keep_order:
            continue
        ring = max(sides[level] - order * 2, 3) if order < 2 else 3  # тонкие ветки под листвой — трёхгранные
        step = 1 if level == 0 else 2
        chosen = list(range(0, len(points), step))
        if chosen[-1] != len(points) - 1:
            chosen.append(len(points) - 1)
        flex = [min(0.1 * order + 0.25 * (i / (len(points) - 1)) * (order + 1), 1.0) if order > 0 else 0.12 * (i / (len(points) - 1)) for i in chosen]
        bark.tube([points[i] for i in chosen], [radii[i] for i in chosen], ring, flex)
    anchors = tree.anchors
    if level == 0:
        for place, direction, size in anchors:
            _twig_cards(leaves, rng, place, direction, size * card_size, tree, style, cell=int(rng.integers(0, 2)))
    else:
        # Охапки: якоря собираются по клеткам пространства — одна большая карточка-охапка на клетку.
        cell_size = [0.0, 3.0, 5.2][level] * card_size
        groups = {}
        for place, direction, size in anchors:
            key = tuple(np.floor(place / cell_size).astype(int))
            groups.setdefault(key, []).append((place, direction, size))
        for members in groups.values():
            place = np.mean([m[0] for m in members], axis=0)
            direction = np.mean([m[1] for m in members], axis=0)
            spread = max(np.max([np.linalg.norm(m[0] - place) for m in members]), 0.3)
            size = (spread + np.mean([m[2] for m in members]) * card_size) * (1.25 if level == 1 else 1.4)
            _clump_cards(leaves, rng, place, direction, size, tree, style, cell=2 if level == 1 else 3, crossed=2)
    return bark, leaves


def _twig_cards(part, rng, place, direction, size, tree, style, cell):
    direction = direction / max(np.linalg.norm(direction), 1.0e-6)
    normal = _outward(place, tree)
    shade = _shade(place, tree)
    count = 2 if style != "cypress" else 1
    for i in range(count):
        twist = rng.normal(0.0, 0.35, 3)
        along = direction + twist * (0.6 if i else 0.2)
        if style == "pine":
            along = along * np.array([1.0, 0.35, 1.0])  # хвоя пинии лежит ярусом, почти горизонтально
        along = along / np.linalg.norm(along) * size
        reference = normal if i == 0 else rng.normal(0.0, 1.0, 3)
        side = np.cross(along, reference)
        if np.linalg.norm(side) < 1.0e-6:
            side = np.cross(along, UP)
        side = side / np.linalg.norm(side) * size * (0.5 if style != "cypress" else 0.26)
        base = place - along * (0.5 if style == "pine" else 0.12)
        part.card(base, along, side, cell, normal, shade)


def _clump_cards(part, rng, place, direction, size, tree, style, cell, crossed):
    normal = _outward(place, tree)
    shade = _shade(place, tree)
    for i in range(crossed):
        if style == "cypress":
            along = UP * size * 1.5 + rng.normal(0.0, 0.08, 3) * size
            heading = rng.uniform(0.0, math.tau)
            side = np.array([math.cos(heading), 0.0, math.sin(heading)]) * size * 0.5
            base = place - along * 0.5
        elif i == 0 and style == "pine":
            # Ярус хвои: карточка почти плашмя — её видно сверху, с высоты стратегической камеры.
            heading = rng.uniform(0.0, math.tau)
            along = np.array([math.cos(heading), 0.12, math.sin(heading)]) * size * 1.3
            side = np.array([-math.sin(heading), 0.0, math.cos(heading)]) * size * 0.65
            base = place - along * 0.5
        else:
            heading = rng.uniform(0.0, math.tau)
            tilt = rng.uniform(0.2, 1.0) if i else 0.15
            along = np.array([math.cos(heading) * (1.0 - tilt * 0.6), tilt, math.sin(heading) * (1.0 - tilt * 0.6)])
            along = along / np.linalg.norm(along) * size * 1.2
            side = np.cross(along, rng.normal(0.0, 1.0, 3))
            side = side / np.linalg.norm(side) * size * 0.6
            base = place - along * 0.5
        part.card(base, along, side, cell, normal, shade)


# ───────────────────────── виды ─────────────────────────

def olive(rng):
    """Олива, опорный рост 6 м: короткий толстый узловатый ствол, несколько главных ветвей, раскидистая неровная крона."""
    tree = Tree()
    fork = rng.uniform(1.3, 1.9)
    trunk, heading = tree.limb(rng, (0.0, -0.4, 0.0), (rng.normal(0, 0.12), 1.0, rng.normal(0, 0.12)), fork + 0.4, 0.46, 0.3, 0, 7, 0.1)
    # Раструб у земли и узлы: радиусы ствола неровные.
    radii = tree.branches[0][1]
    for i in range(len(radii)):
        radii[i] *= 1.0 + 0.45 * max(0.0, 1.0 - i / 2.0) + rng.uniform(-0.08, 0.1)
    top = trunk[-1]
    limbs = int(rng.integers(3, 5))
    turn = rng.uniform(0.0, math.tau)
    for i in range(limbs):
        azimuth = turn + math.tau * i / limbs + rng.uniform(-0.35, 0.35)
        rise = rng.uniform(0.8, 1.3)
        direction = (math.cos(azimuth), rise, math.sin(azimuth))
        length = rng.uniform(1.9, 2.6)
        points, end = tree.limb(rng, top - UP * rng.uniform(0.0, 0.35), direction, length, 0.2, 0.08, 1, 7, 0.16, lift=0.05)
        for j in range(1, 8):
            for fork_index in range(2):
                start = points[j]
                azimuth2 = azimuth + rng.uniform(-1.5, 1.5)
                direction2 = (math.cos(azimuth2), rng.uniform(0.3, 1.0), math.sin(azimuth2))
                sub, end2 = tree.limb(rng, start, direction2, rng.uniform(0.9, 1.6), 0.06, 0.02, 2, 5, 0.22, lift=0.04)
                for k in range(1, 6):
                    for extra in range(2):
                        spray = np.array(end2) + rng.normal(0.0, 0.5, 3)
                        tree.anchors.append((sub[k] + rng.normal(0.0, 0.3, 3), spray, rng.uniform(1.0, 1.4)))
        tree.anchors.append((points[-1], end, 1.2))
    # Крона оливы начинается выше развилки: листвы у самой земли нет.
    tree.anchors = [a for a in tree.anchors if a[0][1] > fork + 0.3]
    tree.fit(6.0)
    return tree, "olive"


def oak(rng):
    """Дуб, опорный рост 11 м: невысокий раскидистый — толстый ствол, развилка на высоте двух-трёх метров,
    широкая плотная крона-купол с неровным краем."""
    tree = Tree()
    fork = rng.uniform(2.2, 3.1)
    trunk, heading = tree.limb(rng, (0.0, -0.4, 0.0), (rng.normal(0, 0.05), 1.0, rng.normal(0, 0.05)), fork + 0.4, 0.5, 0.36, 0, 7, 0.05)
    radii = tree.branches[0][1]
    for i in range(len(radii)):
        radii[i] *= 1.0 + 0.5 * max(0.0, 1.0 - i / 2.0)
    top = trunk[-1]
    limbs = int(rng.integers(4, 6))
    turn = rng.uniform(0.0, math.tau)
    tips = []
    for i in range(limbs):
        azimuth = turn + math.tau * i / limbs + rng.uniform(-0.3, 0.3)
        direction = (math.cos(azimuth), rng.uniform(0.6, 1.2), math.sin(azimuth))
        points, end = tree.limb(rng, top - UP * rng.uniform(0.0, 0.6), direction, rng.uniform(2.4, 3.2), 0.24, 0.09, 1, 8, 0.13, lift=0.02)
        for j in range(2, 9):
            for fork_index in range(2):
                azimuth2 = azimuth + rng.uniform(-1.5, 1.5)
                direction2 = (math.cos(azimuth2), rng.uniform(0.2, 1.0), math.sin(azimuth2))
                sub, end2 = tree.limb(rng, points[j], direction2, rng.uniform(1.1, 1.9), 0.07, 0.025, 2, 5, 0.2, lift=0.03)
                tips.append(sub[-1])
                for k in range(2, 6):
                    tree.anchors.append((sub[k] + rng.normal(0.0, 0.4, 3), np.array(end2) + rng.normal(0.0, 0.5, 3), rng.uniform(1.3, 1.8)))
    # Купол кроны: листва сомкнута по всей наружной поверхности.
    tips = np.array(tips)
    middle = np.array([tips[:, 0].mean(), (tips[:, 1].max() + fork) * 0.5 + 0.6, tips[:, 2].mean()])
    reach = max(np.ptp(tips[:, 0]), np.ptp(tips[:, 2])) * 0.5 + 0.5
    tall = tips[:, 1].max() - middle[1] + 0.8
    for i in range(250):
        azimuth = rng.uniform(0.0, math.tau)
        polar = math.acos(rng.uniform(-0.35, 1.0))
        wave = 1.0 + 0.16 * math.sin(azimuth * 3.0 + middle[2]) + 0.1 * math.sin(azimuth * 5.0 + 1.3)
        shell = rng.uniform(0.78, 1.0)
        place = middle + np.array([math.cos(azimuth) * math.sin(polar) * reach * wave, math.cos(polar) * tall, math.sin(azimuth) * math.sin(polar) * reach * wave]) * shell
        direction = np.array([math.cos(azimuth) * math.sin(polar), math.cos(polar) + 0.2, math.sin(azimuth) * math.sin(polar)])
        tree.anchors.append((place, direction, rng.uniform(1.5, 2.0)))
    tree.fit(11.0)
    return tree, "oak"


def cypress(rng):
    """Кипарис, опорный рост 15 м: прямой ствол, узкое плотное «веретено» хвои, вершина острая, край чуть рваный."""
    tree = Tree()
    height = 15.0
    trunk, _ = tree.limb(rng, (0.0, -0.4, 0.0), (0.0, 1.0, 0.0), height * 0.96 + 0.4, 0.3, 0.03, 0, 12, 0.006)
    widest = rng.uniform(1.25, 1.6)
    tree.centre = np.array([0.0, height * 0.5, 0.0])
    tree.radii = np.array([widest, height * 0.55, widest])
    count = 520
    for i in range(count):
        t = rng.uniform(0.05, 0.985)
        # Веретено: быстро расширяется, широкое место — на трети высоты, к вершине сходится.
        profile = min(t / 0.22, 1.0) ** 0.7 * (1.0 - max(t - 0.3, 0.0) / 0.7) ** 0.75
        bulge = 1.0 + 0.12 * math.sin(t * 23.0 + i * 0.37)
        radius = widest * profile * bulge * rng.uniform(0.45, 1.0)
        azimuth = rng.uniform(0.0, math.tau)
        place = np.array([math.cos(azimuth) * radius, t * height, math.sin(azimuth) * radius])
        direction = np.array([math.cos(azimuth) * 0.22, 1.0, math.sin(azimuth) * 0.22])
        tree.anchors.append((place, direction, rng.uniform(1.5, 2.3)))
    tree.fit(15.0)
    return tree, "cypress"


def pine(rng):
    """Сосна-пиния, опорный рост 13 м: высокий голый ствол, ветви веером под вершиной, плоская крона-зонт."""
    tree = Tree()
    height = 13.0
    fork = height * rng.uniform(0.5, 0.6)
    lean = rng.normal(0.0, 0.05, 2)
    trunk, heading = tree.limb(rng, (0.0, -0.4, 0.0), (lean[0], 1.0, lean[1]), fork + 0.4, 0.34, 0.22, 0, 9, 0.03)
    top = trunk[-1]
    limbs = int(rng.integers(4, 7))
    turn = rng.uniform(0.0, math.tau)
    tips = []
    for i in range(limbs):
        azimuth = turn + math.tau * i / limbs + rng.uniform(-0.3, 0.3)
        direction = (math.cos(azimuth) * 0.75, 1.0, math.sin(azimuth) * 0.75)
        length = rng.uniform(4.2, 5.4)
        # Ветвь уходит вверх и к концу ложится к горизонтали — так получается зонт.
        points, end = tree.limb(rng, top - UP * rng.uniform(0.0, 0.8), direction, length, 0.16, 0.06, 1, 8, 0.09, lift=-0.11)
        for j in range(3, 9):
            start = points[j]
            for fork_index in range(2):
                azimuth2 = azimuth + rng.uniform(-1.4, 1.4)
                direction2 = (math.cos(azimuth2), rng.uniform(0.15, 0.6), math.sin(azimuth2))
                sub, end2 = tree.limb(rng, start, direction2, rng.uniform(1.2, 2.2), 0.05, 0.02, 2, 4, 0.14, lift=0.03)
                tips.append(sub[-1])
                for k in range(3, 5):
                    place = sub[k] + rng.normal(0.0, 0.25, 3)
                    tree.anchors.append((place, np.array(end2) + UP * 0.3, rng.uniform(1.0, 1.4)))
    # Крона-зонт: плотный купол хвои над концами ветвей — приплюснутый, с неровным краем.
    tips = np.array(tips)
    middle = np.array([tips[:, 0].mean(), tips[:, 1].max() - 0.9, tips[:, 2].mean()])
    reach = max(np.ptp(tips[:, 0]), np.ptp(tips[:, 2])) * 0.5 + 0.6
    for i in range(270):
        azimuth = rng.uniform(0.0, math.tau)
        polar = math.acos(rng.uniform(-0.12, 1.0))
        wave = 1.0 + 0.14 * math.sin(azimuth * 3.0 + middle[0]) + 0.08 * math.sin(azimuth * 7.0)
        shell = rng.uniform(0.72, 1.0)
        place = middle + np.array([math.cos(azimuth) * math.sin(polar) * reach * wave, math.cos(polar) * 2.1, math.sin(azimuth) * math.sin(polar) * reach * wave]) * shell
        direction = np.array([math.cos(azimuth), 0.25, math.sin(azimuth)])
        tree.anchors.append((place, direction, rng.uniform(1.5, 2.0)))
    tree.fit(13.0)
    return tree, "pine"


SPECIES = {
    # файл: (строитель, вариантов, рисунок листвы, кора ambientCG, тон коры, размер карточки, стороны трубок по уровням)
    "dub": (oak, 3, twig_oak, "Bark014", (0.34, 0.27, 0.21), 1.0, (10, 6, 4)),
    "oliva": (olive, 3, twig_olive, "Bark001", (0.36, 0.33, 0.29), 1.0, (10, 6, 4)),
    "kiparis": (cypress, 2, frond_cypress, "Bark004", (0.34, 0.27, 0.21), 1.0, (8, 5, 4)),
    "sosna": (pine, 2, tuft_pine, "Bark012", (0.44, 0.29, 0.2), 1.0, (10, 6, 4)),
}


# ───────────────────────── glTF ─────────────────────────

class Glb:
    def __init__(self):
        self.blob = bytearray()
        self.json = {"asset": {"version": "2.0", "generator": "zemli-slova v2/tools/models/make.py"}, "scene": 0, "scenes": [{"nodes": []}],
                     "nodes": [], "meshes": [], "materials": [], "textures": [], "images": [], "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
                     "accessors": [], "bufferViews": [], "buffers": []}

    def _view(self, data, target=None):
        while len(self.blob) % 4:
            self.blob.append(0)
        view = {"buffer": 0, "byteOffset": len(self.blob), "byteLength": len(data)}
        if target:
            view["target"] = target
        self.blob += data
        self.json["bufferViews"].append(view)
        return len(self.json["bufferViews"]) - 1

    def _accessor(self, array, kind, component, target, bounds=False):
        accessor = {"bufferView": self._view(array.tobytes(), target), "componentType": component, "count": int(array.shape[0]), "type": kind}
        if bounds:
            accessor["min"] = [float(v) for v in array.min(axis=0)]
            accessor["max"] = [float(v) for v in array.max(axis=0)]
        self.json["accessors"].append(accessor)
        return len(self.json["accessors"]) - 1

    def texture(self, image, kind):
        data = io.BytesIO()
        image.save(data, "PNG" if kind == "image/png" else "JPEG", **({} if kind == "image/png" else {"quality": 90}))
        self.json["images"].append({"bufferView": self._view(data.getvalue()), "mimeType": kind})
        self.json["textures"].append({"source": len(self.json["images"]) - 1, "sampler": 0})
        return len(self.json["textures"]) - 1

    def material(self, name, texture, roughness, cut):
        material = {"name": name, "pbrMetallicRoughness": {"baseColorTexture": {"index": texture}, "metallicFactor": 0.0, "roughnessFactor": roughness}}
        if cut:
            material["alphaMode"] = "MASK"
            material["alphaCutoff"] = 0.45
            material["doubleSided"] = True
        self.json["materials"].append(material)
        return len(self.json["materials"]) - 1

    def mesh(self, name, parts):
        primitives = []
        for part, material in parts:
            if not part.indices:
                continue
            positions = np.asarray(part.positions, dtype=np.float32)
            attributes = {
                "POSITION": self._accessor(positions, "VEC3", 5126, 34962, True),
                "NORMAL": self._accessor(np.asarray(part.normals, dtype=np.float32), "VEC3", 5126, 34962),
                "TEXCOORD_0": self._accessor(np.asarray(part.uvs, dtype=np.float32), "VEC2", 5126, 34962),
                "COLOR_0": self._accessor(np.asarray(part.colors, dtype=np.float32), "VEC4", 5126, 34962),
            }
            indices = self._accessor(np.asarray(part.indices, dtype=np.uint32), "SCALAR", 5125, 34963)
            primitives.append({"attributes": attributes, "indices": indices, "material": material})
        self.json["meshes"].append({"name": name, "primitives": primitives})
        self.json["nodes"].append({"name": name, "mesh": len(self.json["meshes"]) - 1})
        self.json["scenes"][0]["nodes"].append(len(self.json["nodes"]) - 1)

    def save(self, path):
        while len(self.blob) % 4:
            self.blob.append(0)
        self.json["buffers"] = [{"byteLength": len(self.blob)}]
        text = json.dumps(self.json, separators=(",", ":")).encode("utf-8")
        while len(text) % 4:
            text += b" "
        with open(path, "wb") as file:
            file.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(text) + 8 + len(self.blob)))
            file.write(struct.pack("<I4s", len(text), b"JSON"))
            file.write(text)
            file.write(struct.pack("<I4s", len(self.blob), b"BIN\0"))
            file.write(self.blob)


def main():
    os.makedirs(OUT, exist_ok=True)
    report = []
    for name, (builder, variants, leaf_maker, bark_asset, bark_tint, card_size, sides) in SPECIES.items():
        rng = np.random.default_rng(abs(hash(name)) % 1000 + 17 if False else {"dub": 5, "oliva": 11, "kiparis": 23, "sosna": 37}[name])
        leaves_image = atlas(leaf_maker, rng)
        bark_image = bark_texture(bark_asset, bark_tint, 256)
        # Все варианты вида — в одном файле: текстуры у них общие, и в сборку они попадают один раз.
        glb = Glb()
        bark_material = glb.material("kora", glb.texture(bark_image, "image/jpeg"), 0.9, False)
        leaf_material = glb.material("listva", glb.texture(leaves_image, "image/png"), 0.65, True)
        for variant in range(1, variants + 1):
            tree, style = builder(np.random.default_rng(1000 * variant + len(name)))
            line = []
            for level in range(3):
                bark, leaves = build(tree, np.random.default_rng(variant * 31 + level), level, sides, card_size, style)
                glb.mesh("%s_%02d_LOD%d" % (name, variant, level), [(bark, bark_material), (leaves, leaf_material)])
                line.append(bark.count() + leaves.count())
            places = np.array([a[0] for a in tree.anchors])
            report.append("%s_%02d: треугольников %d / %d / %d; рост %.1f м, крона %.1f м" % (
                name, variant, line[0], line[1], line[2], places[:, 1].max(), max(np.ptp(places[:, 0]), np.ptp(places[:, 2]))))
        path = os.path.join(OUT, "%s.glb" % name)
        glb.save(path)
        report.append("%s.glb: %.0f КБ" % (name, os.path.getsize(path) / 1024.0))
    print("\n".join(report))


if __name__ == "__main__":
    main()
