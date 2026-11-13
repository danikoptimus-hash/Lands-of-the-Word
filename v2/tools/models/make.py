#!/usr/bin/env python3
"""Модели растительности и камней версии 2 (задание владельца 13.11: «не шары и многогранники»): дуб, олива,
кипарис, сосна-пиния, финиковая пальма, тамариск, кустарники, камни и скальные выходы.

Дерево строится по правилам вида: ствол и ветви — трубки по ломаным с сужением и изгибами, листва — «карточки»
(плоские четырёхугольники с рисунком ветки и вырезкой по прозрачности) на концах ветвей. У каждого варианта три
уровня подробности из одного и того же скелета — силуэт, размер кроны и тон одинаковы, упрощается только мелкое:
  _LOD0 — все ветви и мелкие карточки-ветки; _LOD1 — ствол с главными ветвями и карточки-охапки;
  _LOD2 — ствол и два десятка больших карточек.
Кора — фотоматериалы ambientCG (CC0), рисунок листвы рисуется здесь же (лист за листом, по форме вида).
На выходе — файлы glTF (.glb) в v2/assets/models/flora/ по правилам v2/assets/models/README.md: метры, опора
в основании ствола, вверх +Y, два материала (kora, listva), цвет вершин: красный — гибкость для ветра,
зелёный — затенение в глубине кроны.

Пальма — ствол и венец перистых листьев-полос (лист изогнут дугой, в сечении — «галочка»). Камень — шар, обрезанный
случайными плоскостями (грани и рёбра излома) с неровностями; скальный выход — несколько таких глыб пластами.
У камня один материал (kamen): фактура и нормали — фотоматериал Poly Haven (CC0), цвет породы даёт игра.

Запуск из корня репозитория:  python3 v2/tools/models/make.py [вид …]   (без видов — все)
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
OUT = os.environ.get("MODELS_OUT", os.path.join(ROOT, "assets", "models", "flora"))
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


def spray_tamarisk(rng, size=512, clump=False):
    """Побег тамариска: тонкие поникающие нити с чешуйчатой хвоей, серо-зелёные; на концах изредка розовые метёлки."""
    scale = 3
    big = size * scale
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    sprays = 9 if clump else 1
    for index in range(sprays):
        if clump:
            base = (big * rng.uniform(0.3, 0.7), big * rng.uniform(0.55, 0.9))
            heading = -math.pi / 2 + rng.uniform(-1.3, 1.3)
            reach = big * rng.uniform(0.35, 0.5)
        else:
            base = (big * 0.5, big * 0.98)
            heading = -math.pi / 2
            reach = big * 0.92
        stem = [base]
        angle = heading
        for step in range(12):
            angle += rng.uniform(-0.1, 0.1)
            stem.append((stem[-1][0] + math.cos(angle) * reach / 12.0, stem[-1][1] + math.sin(angle) * reach / 12.0))
        draw.line(stem, fill=(104, 84, 70, 255), width=max(int(big * 0.006), 2))
        for at in range(1, 13):
            for side in (-1.0, 1.0):
                for extra in range(2):
                    start = stem[at]
                    direction = angle + side * rng.uniform(0.35, 1.0)
                    length = reach * rng.uniform(0.16, 0.3) * (1.0 - 0.03 * at)
                    x, y = start
                    pink = rng.random() < 0.1
                    for step in range(14):
                        # Нить тянется от побега и поникает к концу.
                        direction += rng.uniform(-0.12, 0.12) + 0.035 * side * (1.0 if math.sin(direction) < 0.4 else -1.0)
                        nx, ny = x + math.cos(direction) * length / 14.0, y + math.sin(direction) * length / 14.0 + big * 0.0016 * step
                        tone = rng.uniform(0.8, 1.2)
                        color = (int(108 * tone), int(134 * tone), int(100 * tone), 255)
                        if pink and step > 8:
                            color = (int(196 * tone), int(146 * tone), int(158 * tone), 255)
                        draw.line([(x, y), (nx, ny)], fill=color, width=max(int(big * (0.0075 if pink and step > 8 else 0.0048)), 2))
                        x, y = nx, ny
    return _finish(image, size)


def twig_shrub(rng, size=512, clump=False):
    """Ветка вечнозелёного кустарника (фисташка мастичная, мирт): мелкие плотные кожистые листья, тёмная зелень."""
    return _twig_leafy(rng, size, clump, 0.5, (0.05, 0.07), (60, 94, 44), (94, 120, 56), 0.2)


def twig_dry(rng, size=512, clump=False):
    """Ветка сухого колючего кустарника: частая сетка серо-бурых веточек, редкие мелкие листья цвета сухой травы."""
    scale = 3
    big = size * scale
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def grow(at, angle, length, depth):
        steps = 5
        x, y = at
        for step in range(steps):
            angle += rng.uniform(-0.22, 0.22)
            nx, ny = x + math.cos(angle) * length / steps, y + math.sin(angle) * length / steps
            tone = rng.uniform(0.85, 1.15)
            draw.line([(x, y), (nx, ny)], fill=(int(146 * tone), int(124 * tone), int(96 * tone), 255), width=max(int(big * (0.009 - 0.002 * depth)), 2))
            x, y = nx, ny
            if depth < 3 and rng.random() < 0.75:
                grow((x, y), angle + rng.choice([-1.0, 1.0]) * rng.uniform(0.5, 1.1), length * rng.uniform(0.5, 0.75), depth + 1)
        if depth >= 2 and rng.random() < 0.6:
            tone = rng.uniform(0.85, 1.15)
            color = (int(142 * tone), int(136 * tone), int(74 * tone), 255)
            _leaf(draw, (x, y), angle + rng.uniform(-0.6, 0.6), big * 0.03, big * 0.012, color, color)

    starts = 7 if clump else 3
    for index in range(starts):
        base = (big * (0.5 + rng.uniform(-0.2, 0.2) * (1.0 if clump else 0.3)), big * (0.97 if not clump else rng.uniform(0.7, 0.97)))
        grow(base, -math.pi / 2 + rng.uniform(-0.6, 0.6) * (1.6 if clump else 1.0), big * rng.uniform(0.4, 0.6), 0)
    return _finish(image, size)


def frond_palm(rng, size=512, clump=False, dry=False):
    """Перистый лист финиковой пальмы: стержень от низа картинки к верху, узкие листочки в обе стороны.
    Карточка листа в четыре раза длиннее своей ширины — поэтому на картинке листочки почти поперёк стержня."""
    scale = 3
    big = size * scale
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    x0 = big * 0.5
    count = 34 if clump else 44
    for i in range(count):
        t = i / (count - 1.0)
        y = big * (0.985 - 0.965 * t)
        # У основания — короткие шипы, длиннее всего листочки на первой трети, к вершине сходят на нет.
        length = big * 0.47 * min(t / 0.22, 1.0) ** 0.7 * (1.0 - 0.72 * max(t - 0.3, 0.0) / 0.7)
        for side in (-1.0, 1.0):
            angle = -math.pi / 2 + side * (1.32 - 0.5 * t + rng.uniform(-0.07, 0.07))
            reach = length * rng.uniform(0.85, 1.0)
            tone = rng.uniform(0.8, 1.15)
            if dry:
                color = (int(150 * tone), int(122 * tone), int(78 * tone), 255)
            elif rng.random() < 0.12:
                color = (int(118 * tone), int(132 * tone), int(70 * tone), 255)
            else:
                color = (int(78 * tone), int(108 * tone), int(60 * tone), 255)
            half = big * (0.013 if clump else 0.0085) * rng.uniform(0.8, 1.2)
            ax, ay = math.cos(angle), math.sin(angle)
            tip = (x0 + ax * reach, y + ay * reach + big * 0.02 * rng.uniform(0.0, 1.0))
            middle = (x0 + ax * reach * 0.5, y + ay * reach * 0.5)
            draw.polygon([(x0, y - half), (middle[0], middle[1] - half), tip, (middle[0], middle[1] + half), (x0, y + half)], fill=color)
    stalk = (150, 124, 84, 255) if dry else (132, 140, 78, 255)
    draw.polygon([(x0 - big * 0.014, big * 0.995), (x0 + big * 0.014, big * 0.995), (x0 + big * 0.003, big * 0.02), (x0 - big * 0.003, big * 0.02)], fill=stalk)
    return _finish(image, size)


def frond_palm_set(rng, size=512, clump=False):
    """Рисунки пальмы по клеткам: два зелёных листа, сухой лист, широкий лист для дальних уровней."""
    frond_palm_set.calls = getattr(frond_palm_set, "calls", 0) + 1
    index = (frond_palm_set.calls - 1) % 4
    return frond_palm(rng, size, clump=(index == 3), dry=(index == 2))


def bark_palm(rng, size=256):
    """Ствол финиковой пальмы: ряды оснований старых листьев — ромбы внахлёст, тёмные щели между ними."""
    scale = 3
    big = size * scale
    image = Image.new("RGB", (big, big), (58, 46, 36))
    draw = ImageDraw.Draw(image)
    rows, columns = 9, 5
    for row in range(rows + 1):
        for column in range(columns + 1):
            x = (column + (0.5 if row % 2 else 0.0)) * big / columns
            y = big - row * big / rows
            for shift in (-big, 0, big):
                tone = rng.uniform(0.82, 1.14)
                wide, tall = big / columns * 0.56, big / rows * 0.92
                color = (int(132 * tone), int(112 * tone), int(90 * tone))
                draw.polygon([(x + shift - wide, y), (x + shift + wide, y), (x + shift + wide * 0.62, y - tall), (x + shift - wide * 0.62, y - tall)], fill=color)
                light = (min(int(color[0] * 1.22), 255), min(int(color[1] * 1.2), 255), min(int(color[2] * 1.16), 255))
                draw.polygon([(x + shift - wide * 0.62, y - tall), (x + shift + wide * 0.62, y - tall), (x + shift + wide * 0.5, y - tall * 0.78), (x + shift - wide * 0.5, y - tall * 0.78)], fill=light)
                for fibre in range(5):
                    fx = x + shift + rng.uniform(-0.8, 0.8) * wide * 0.6
                    draw.line([(fx, y - tall * 0.1), (fx + rng.uniform(-4, 4), y - tall * 0.75)], fill=(int(color[0] * 0.8), int(color[1] * 0.8), int(color[2] * 0.8)), width=3)
    image = image.filter(ImageFilter.GaussianBlur(scale * 0.6)).resize((size, size), Image.LANCZOS)
    return image


def rock_textures(name="marble_cliff_03", size=512):
    """Фактура камня: фотоматериал Poly Haven — яркость без цвета (цвет породы даёт игра) и карта нормалей."""
    os.makedirs(CACHE, exist_ok=True)
    images = []
    for tag in ("diff", "nor_gl"):
        path = os.path.join(CACHE, "%s_%s.jpg" % (name, tag))
        if not os.path.exists(path):
            url = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/%s/%s_%s_1k.jpg" % (name, name, tag)
            request = urllib.request.Request(url, headers={"User-Agent": "zemli-slova-tools"})
            with urllib.request.urlopen(request, timeout=180) as response:
                data = response.read()
            with open(path, "wb") as file:
                file.write(data)
        images.append(Image.open(path).convert("RGB").resize((size, size), Image.LANCZOS))
    pixels = np.asarray(images[0], dtype=np.float32) / 255.0
    grey = pixels.mean(axis=2)
    # Крупные пятна яркости снимка выравниваются: иначе повтор плитки виден на большой скале.
    low = np.asarray(Image.fromarray((grey * 255.0).astype(np.uint8)).filter(ImageFilter.GaussianBlur(size / 6.0)), dtype=np.float32) / 255.0
    grey = np.clip(0.5 + (grey - low) * 1.5, 0.0, 1.0)
    return Image.fromarray((grey * 255.0).astype(np.uint8)).convert("RGB"), images[1]


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


    def frond(self, points, sides, ups, widths, cell, shades, flexes, vee):
        """Лист-полоса вдоль ломаной (пальма): в сечении «галочка» из двух половин (vee > 0) или плоская (vee = 0)."""
        first = len(self.positions)
        u0, v0, u1, v1 = CELLS[cell]
        halves = vee > 0.0
        columns = 3 if halves else 2
        for i in range(len(points)):
            t = i / (len(points) - 1.0)
            edge = sides[i] * widths[i] * math.cos(vee) + ups[i] * widths[i] * math.sin(vee)
            other = -sides[i] * widths[i] * math.cos(vee) + ups[i] * widths[i] * math.sin(vee)
            row = [(points[i] + other, u0)] + ([(points[i], (u0 + u1) * 0.5)] if halves else []) + [(points[i] + edge, u1)]
            normal = ups[i] * 0.55 + UP * 0.75
            normal = normal / np.linalg.norm(normal)
            for place, u in row:
                self.positions.append(place)
                self.normals.append(normal)
                self.uvs.append((u, v1 + (v0 - v1) * t))
                self.colors.append((flexes[i], shades[i], 0.0, 1.0))
        for i in range(len(points) - 1):
            for k in range(columns - 1):
                a = first + i * columns + k
                b = a + columns
                self.indices += [a, a + 1, b, a + 1, b + 1, b]

    def faces(self, positions, triangles, shades, crease=0.72):
        """Сетка камня: нормаль угла — среднее соседних граней, если они почти в одной плоскости (ребро излома
        остаётся острым, грань — гладкой). Цвет вершины — затенение (у земли и во впадинах темнее)."""
        positions = np.asarray(positions, dtype=np.float64)
        triangles = np.asarray(triangles, dtype=np.int64)
        edges_a = positions[triangles[:, 1]] - positions[triangles[:, 0]]
        edges_b = positions[triangles[:, 2]] - positions[triangles[:, 0]]
        areas = np.cross(edges_a, edges_b)
        lengths = np.maximum(np.linalg.norm(areas, axis=1, keepdims=True), 1.0e-12)
        flat = areas / lengths
        around = {}
        for face, triangle in enumerate(triangles):
            for vertex in triangle:
                around.setdefault(int(vertex), []).append(face)
        for face, triangle in enumerate(triangles):
            for vertex in triangle:
                near = np.array(around[int(vertex)])
                same = near[(flat[near] @ flat[face]) > crease]
                normal = areas[same].sum(axis=0)
                normal = normal / max(np.linalg.norm(normal), 1.0e-12)
                place = positions[vertex]
                axis = int(np.argmax(np.abs(flat[face])))
                uv = (place[(axis + 1) % 3], place[(axis + 2) % 3])
                self.indices.append(len(self.positions))
                self.positions.append(place)
                self.normals.append(normal)
                self.uvs.append(uv)
                shade = float(shades[vertex])
                self.colors.append((shade, shade, shade, 1.0))


class Tree:
    """Скелет дерева: ветви (ломаная, радиусы, порядок) и «якоря» листвы (место, направление, размер)."""

    def __init__(self):
        self.branches = []  # (points, radii, order)
        self.anchors = []  # (place, direction, size)
        self.centre = np.zeros(3)
        self.radii = np.ones(3)

    def fit(self, height, card=1.0):
        """Привести дерево к опорному росту (верх листвы — на высоте height) и запомнить середину и размах кроны.
        card — размер карточки листвы вида (у кустов они мелкие)."""
        top = max(a[0][1] + a[2] * 0.4 * card for a in self.anchors)
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


class Hull:
    """Оболочка кроны полной модели: по слоям высоты — середина и радиус листвы. В неё вписываются карточки
    упрощённых уровней: крона на любом расстоянии — того же размера и той же формы, что вблизи."""

    def __init__(self, positions, slices=14):
        points = np.asarray(positions, dtype=np.float64)
        self.low, self.high = np.percentile(points[:, 1], 0.5), np.percentile(points[:, 1], 99.5)
        self.step = max((self.high - self.low) / slices, 1.0e-6)
        self.centres, self.radii = [], []
        for i in range(slices):
            inside = points[(points[:, 1] >= self.low + i * self.step) & (points[:, 1] < self.low + (i + 1) * self.step)]
            if len(inside) < 4:
                self.centres.append(self.centres[-1] if self.centres else np.median(points[:, [0, 2]], axis=0))
                self.radii.append(self.radii[-1] if self.radii else 0.3)
                continue
            centre = inside[:, [0, 2]].mean(axis=0)
            self.centres.append(centre)
            self.radii.append(float(np.percentile(np.hypot(inside[:, 0] - centre[0], inside[:, 2] - centre[1]), 96)))

    def outside(self, point, slack=1.06):
        margin = 0.03 * (self.high - self.low)
        if point[1] > self.high + margin or point[1] < self.low - margin:
            return True
        i = int(np.clip((point[1] - self.low) / self.step, 0, len(self.radii) - 1))
        return math.hypot(point[0] - self.centres[i][0], point[2] - self.centres[i][1]) > self.radii[i] * slack


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
        # Оболочка кроны — по листве полной модели (со своим жребием, чтобы не сбить жребий этого уровня).
        full = Part()
        twig_rng = np.random.default_rng(12345)
        for place, direction, size in anchors:
            _twig_cards(full, twig_rng, place, direction, size * card_size, tree, style, cell=0)
        hull = Hull(full.positions)
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
            # Затенение охапки — среднее по её веткам, а не «в глубине кроны», где оказалась её середина:
            # иначе упрощённый уровень темнее полного.
            shade = float(np.mean([_shade(m[0], tree) for m in members]))
            _clump_cards(leaves, rng, place, direction, size, tree, style, cell=2 if level == 1 else 3, crossed=2, hull=hull, shade=shade)
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


def _clump_cards(part, rng, place, direction, size, tree, style, cell, crossed, hull=None, shade=None):
    normal = _outward(place, tree)
    if shade is None:
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
        if hull is not None:
            # Карточка вписывается в оболочку кроны полной модели: сначала сужается, потом укорачивается.
            # Рисунок охапки занимает не всю карточку (по краям прозрачно) — за оболочку может выйти только пустой край.
            fill_side, fill_along = (0.62, 0.9) if style == "cypress" else (0.85, 0.85)
            centre = base + along * 0.5
            for attempt in range(16):
                corners = [centre + along * 0.5 * a * fill_along + side * b * fill_side for a in (-1.0, 1.0) for b in (-1.0, 1.0)]
                if not any(hull.outside(corner) for corner in corners):
                    break
                side = side * 0.9
                if attempt % 2 == 1:
                    along = along * 0.92
            base = centre - along * 0.5
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


def tamarisk(rng):
    """Тамариск, опорный рост 5,5 м: несколько стволов от земли врозь, ветви дугой, концы поникают — лёгкая
    перистая крона шире своей высоты."""
    tree = Tree()
    stems = int(rng.integers(3, 6))
    turn = rng.uniform(0.0, math.tau)
    for i in range(stems):
        azimuth = turn + math.tau * i / stems + rng.uniform(-0.4, 0.4)
        spread = rng.uniform(0.2, 0.5)
        start = (math.cos(azimuth) * 0.12, -0.3, math.sin(azimuth) * 0.12)
        direction = (math.cos(azimuth) * spread, 1.0, math.sin(azimuth) * spread)
        points, end = tree.limb(rng, start, direction, rng.uniform(2.8, 3.8), rng.uniform(0.09, 0.14), 0.04, 0 if i < 2 else 1, 8, 0.1, lift=-0.01)
        for j in range(3, 9):
            for fork_index in range(2):
                azimuth2 = azimuth + rng.uniform(-1.6, 1.6)
                direction2 = (math.cos(azimuth2), rng.uniform(0.1, 0.8), math.sin(azimuth2))
                # Ветка идёт вверх и в сторону, а к концу поникает.
                sub, end2 = tree.limb(rng, points[j], direction2, rng.uniform(0.7, 1.3), 0.035, 0.012, 2, 6, 0.16, lift=-0.08)
                for k in range(2, 7):
                    hang = np.array(end2) + np.array([0.0, -0.5, 0.0]) + rng.normal(0.0, 0.3, 3)
                    tree.anchors.append((sub[k] + rng.normal(0.0, 0.2, 3), hang, rng.uniform(1.1, 1.6)))
    tree.anchors = [a for a in tree.anchors if a[0][1] > 0.7]
    tree.fit(5.5)
    return tree, "olive"


def shrub(rng):
    """Вечнозелёный кустарник, опорный рост 1,4 м: плотная неровная подушка листвы от самой земли, стволики едва видны."""
    tree = Tree()
    stems = int(rng.integers(4, 7))
    turn = rng.uniform(0.0, math.tau)
    lobes = []
    for i in range(stems):
        azimuth = turn + math.tau * i / stems + rng.uniform(-0.4, 0.4)
        spread = rng.uniform(0.5, 1.2)
        direction = (math.cos(azimuth) * spread, 1.0, math.sin(azimuth) * spread)
        points, end = tree.limb(rng, (math.cos(azimuth) * 0.05, -0.1, math.sin(azimuth) * 0.05), direction, rng.uniform(0.7, 1.1), 0.03, 0.012, 1, 4, 0.14)
        lobes.append(points[-1])
        for k in range(1, 5):
            tree.anchors.append((points[k] + rng.normal(0.0, 0.1, 3), np.array(end) + rng.normal(0.0, 0.4, 3), rng.uniform(1.0, 1.4)))
    # Подушка: листва по наружной поверхности нескольких сросшихся клубов — от земли до макушки.
    for lobe in lobes:
        radius = rng.uniform(0.35, 0.55)
        for i in range(7):
            azimuth = rng.uniform(0.0, math.tau)
            polar = math.acos(rng.uniform(-0.5, 1.0))
            out = np.array([math.cos(azimuth) * math.sin(polar), math.cos(polar), math.sin(azimuth) * math.sin(polar)])
            place = lobe * np.array([1.0, 0.75, 1.0]) + out * radius
            if place[1] > 0.08:
                tree.anchors.append((place, out + UP * 0.3, rng.uniform(1.1, 1.5)))
    tree.fit(1.4, 0.27)
    return tree, "olive"


def dry_shrub(rng):
    """Сухой колючий кустарник, опорный рост 0,6 м: низкая полушаровидная подушка из частых веточек."""
    tree = Tree()
    wide = rng.uniform(0.38, 0.5)
    for i in range(22):
        azimuth = rng.uniform(0.0, math.tau)
        polar = math.acos(rng.uniform(0.05, 1.0))
        out = np.array([math.cos(azimuth) * math.sin(polar), math.cos(polar), math.sin(azimuth) * math.sin(polar)])
        shell = rng.uniform(0.35, 0.8)
        place = out * np.array([wide, 0.5, wide]) * shell + UP * 0.02
        tree.anchors.append((place, out, rng.uniform(1.1, 1.5)))
    tree.fit(0.6, 0.2)
    return tree, "olive"


class Palm:
    """Финиковая пальма, опорный рост 12 м: стройный ствол в ромбах старых листьев, чуть изогнутый; венец из
    трёх десятков перистых листьев — молодые торчат вверх, взрослые расходятся дугой, старые сухие висят у ствола."""

    def __init__(self, rng):
        top = rng.uniform(8.6, 9.6)
        lean = rng.uniform(0.3, 1.3)
        azimuth = rng.uniform(0.0, math.tau)
        away = np.array([math.cos(azimuth), 0.0, math.sin(azimuth)])
        self.trunk, self.radii = [], []
        for i in range(13):
            t = i / 12.0
            self.trunk.append(away * lean * t * t + UP * (-0.4 + (top + 0.4) * t))
            # Раструб у земли, ровный ствол, утолщение из оснований листьев под венцом.
            self.radii.append(0.25 + 0.14 * max(0.0, 1.0 - t * 6.0) + 0.1 * max(0.0, (t - 0.86) / 0.14) + rng.uniform(-0.012, 0.012))
        crown = self.trunk[-1]
        heading = self.trunk[-1] - self.trunk[-2]
        heading = heading / np.linalg.norm(heading)
        self.fronds = []
        count = 34
        for i in range(count):
            # По золотому углу и от вершины вниз: первые — молодые, почти вверх; последние — старые, ниже горизонта.
            age = (i + 0.5) / count
            turn = i * 2.39996 + rng.uniform(-0.2, 0.2)
            pitch = math.radians(78.0 - 96.0 * age ** 0.85 + rng.uniform(-6.0, 6.0))
            length = rng.uniform(3.6, 4.5) * (0.72 + 0.28 * min(age * 4.0, 1.0))
            self.fronds.append(self._frond(rng, crown - heading * 0.25 * age, turn, pitch, length, droop=0.11 + 0.1 * age, dry=False, age=age))
        for i in range(7):
            # Сухие листья: висят вдоль ствола под венцом.
            turn = i * 2.39996 * 1.7 + rng.uniform(-0.3, 0.3)
            self.fronds.append(self._frond(rng, crown - heading * 0.55, turn, math.radians(rng.uniform(-62.0, -38.0)), rng.uniform(2.4, 3.2), droop=0.16, dry=True, age=1.0))
        self.top = max(point[1] for frond in self.fronds for point in frond["points"])

    def _frond(self, rng, start, turn, pitch, length, droop, dry, age):
        out = np.array([math.cos(turn), 0.0, math.sin(turn)])
        direction = out * math.cos(pitch) + UP * math.sin(pitch)
        steps = 6
        points = [start + out * 0.2]
        directions = [direction]
        for i in range(steps):
            # Лист гнётся под своим весом: чем дальше от ствола, тем круче вниз.
            direction = direction - UP * droop * (0.55 + 0.9 * (i + 1) / steps)
            direction = direction / np.linalg.norm(direction)
            points.append(points[-1] + direction * length / steps)
            directions.append(direction)
        return {"points": points, "directions": directions, "out": out, "dry": dry, "age": age, "twist": rng.uniform(-0.25, 0.25),
                "width": rng.uniform(0.62, 0.78), "cell": int(rng.integers(0, 2))}

    def scale(self, height):
        factor = height / self.top
        self.trunk = [p * factor for p in self.trunk]
        self.radii = [r * factor for r in self.radii]
        for frond in self.fronds:
            frond["points"] = [p * factor for p in frond["points"]]
            frond["width"] *= factor
        self.top = height

    def meshes(self, level, sides):
        bark, leaves = Part(), Part()
        chosen = list(range(0, 13, [1, 2, 4][level]))
        flex = [0.1 * (i / 12.0) ** 2 for i in chosen]
        bark.tube([self.trunk[i] for i in chosen], [self.radii[i] for i in chosen], sides[level], flex, tile=1.5)
        # Те же листья на всех уровнях, только реже: каждый второй и каждый четвёртый, зато шире — венец того же размера.
        step = [1, 2, 4][level]
        wider = [1.0, 1.35, 1.9][level]
        green = [f for f in self.fronds if not f["dry"]][::step]
        dry = [f for f in self.fronds if f["dry"]][::[1, 2, 7][level]]
        for frond in green + dry:
            take = [list(range(7)), [0, 2, 4, 6], [0, 3, 6]][level]
            points = [frond["points"][i] for i in take]
            sides_, ups, widths, shades, flexes = [], [], [], [], []
            for n, i in enumerate(take):
                direction = frond["directions"][i]
                side = np.cross(direction, UP)
                if np.linalg.norm(side) < 1.0e-3:
                    side = np.cross(direction, frond["out"])
                side = side / np.linalg.norm(side)
                up = np.cross(side, direction)
                # Лёгкий поворот листа вокруг стержня: венец не выглядит набором одинаковых плоскостей.
                side, up = side * math.cos(frond["twist"]) + up * math.sin(frond["twist"]), up * math.cos(frond["twist"]) - side * math.sin(frond["twist"])
                t = i / 6.0
                sides_.append(side)
                ups.append(up)
                widths.append(frond["width"] * wider * (0.45 + 0.55 * min(t * 3.0, 1.0)))
                shades.append((0.62 if frond["dry"] else 0.6 + 0.4 * (1.0 - frond["age"])) * (0.8 + 0.2 * t))
                flexes.append(0.25 + 0.75 * t)
            cell = 2 if frond["dry"] else (3 if level == 2 else frond["cell"])
            leaves.frond(points, sides_, ups, widths, cell, shades, flexes, vee=0.42 if level == 0 else 0.0)
        return bark, leaves


def palm(rng):
    tree = Palm(rng)
    tree.scale(12.0)
    return tree, "palm"


class Waves:
    """Гладкий шум в пространстве — сумма случайных волн. Задан формулой, поэтому одинаков для сеток любой
    подробности: уровни камня совпадают по силуэту."""

    def __init__(self, rng, frequency, count=7):
        directions = rng.normal(0.0, 1.0, (count, 3))
        self.k = directions / np.linalg.norm(directions, axis=1, keepdims=True) * frequency * rng.uniform(0.6, 1.4, (count, 1))
        self.phase = rng.uniform(0.0, math.tau, count)

    def __call__(self, points):
        return np.sin(points @ self.k.T + self.phase).sum(axis=1) / math.sqrt(len(self.phase))


def _icosphere(level):
    t = (1.0 + 5.0 ** 0.5) / 2.0
    points = [np.array(p, dtype=np.float64) / math.sqrt(1.0 + t * t) for p in
              [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]]
    faces = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
             (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(level):
        middle = {}

        def half(a, b):
            key = (min(a, b), max(a, b))
            if key not in middle:
                point = points[a] + points[b]
                points.append(point / np.linalg.norm(point))
                middle[key] = len(points) - 1
            return middle[key]

        split = []
        for a, b, c in faces:
            ab, bc, ca = half(a, b), half(b, c), half(c, a)
            split += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        faces = split
    return np.array(points), np.array(faces)


class Block:
    """Глыба: шар с неровностями, обрезанный случайными плоскостями, — плоские грани излома и острые рёбра."""

    def __init__(self, rng, radii, cuts, rough, centre=(0.0, 0.0, 0.0), tilt=(0.0, 0.0), strata=0.0):
        self.radii = np.array(radii, dtype=np.float64)
        self.centre = np.array(centre, dtype=np.float64)
        self.rough = rough
        self.strata = strata
        self.planes = []
        for i in range(cuts):
            normal = rng.normal(0.0, 1.0, 3)
            normal[1] = abs(normal[1]) * 0.8 if i % 3 else normal[1]  # снизу глыбу режет земля, а не излом
            normal = normal / np.linalg.norm(normal)
            self.planes.append((normal, rng.uniform(0.6, 0.9)))
        self.low, self.middle, self.fine = Waves(rng, 1.7), Waves(rng, 4.5), Waves(rng, 12.0)
        cx, sx, cz, sz = math.cos(tilt[0]), math.sin(tilt[0]), math.cos(tilt[1]), math.sin(tilt[1])
        self.turn = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]]) @ np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])

    def surface(self, units):
        radius = 1.0 + self.rough * (0.2 * self.low(units) + 0.07 * self.middle(units))
        for normal, offset in self.planes:
            along = units @ normal
            radius = np.minimum(radius, np.where(along > 0.05, offset / np.maximum(along, 0.05), 9.0))
        radius = radius * (1.0 + self.rough * 0.02 * self.fine(units * radius[:, None]))
        points = units * radius[:, None] * self.radii
        if self.strata > 0.0:
            # Пласты: слои камня выступают и западают по высоте, границы слоёв чуть волнистые.
            layer = np.sin(points[:, 1] / self.radii[1] * 8.0 + 1.5 * self.low(points * 0.6))
            points[:, [0, 2]] *= (1.0 + self.strata * np.tanh(layer * 2.5))[:, None]
        hollow = np.clip(0.5 + 1.6 * (radius - 0.8), 0.0, 1.0)
        return points @ self.turn.T + self.centre, hollow


class Rock:
    """Камень: одна глыба или несколько (скальный выход). Опорный поперечник — метр; на пятую часть высоты в земле."""

    def __init__(self, blocks, buried=0.2):
        self.blocks = blocks
        places = np.vstack([block.surface(_icosphere(3)[0])[0] for block in blocks])
        low, high = places.min(axis=0), places.max(axis=0)
        self.factor = 1.0 / max(high[0] - low[0], high[2] - low[2])
        self.shift = np.array([-(low[0] + high[0]) * 0.5, -(low[1] + (high[1] - low[1]) * buried), -(low[2] + high[2]) * 0.5])
        self.tall = (high[1] - low[1]) * (1.0 - buried) * self.factor

    def meshes(self, level, sides=None):
        stone = Part()
        for block in self.blocks:
            units, triangles = _icosphere([3, 2, 1][level])
            places, hollow = block.surface(units)
            places = (places + self.shift) * self.factor
            # Затенение: у земли темнее (камень сам себе тень), во впадинах темнее, чем на выступах.
            ground = np.clip(places[:, 1] / max(self.tall * 0.45, 1.0e-6), 0.0, 1.0)
            shades = np.clip((0.55 + 0.45 * ground) * (0.8 + 0.2 * hollow), 0.4, 1.0)
            stone.faces(places, triangles, shades)
        return stone, Part()


def rock(rng, variant):
    """Пять камней: валун, плита, угловатый обломок и два скальных выхода (гряда пластов и останец)."""
    if variant == 1:
        return Rock([Block(rng, (0.5, 0.38, 0.44), 8, 1.0)]), "rock"
    if variant == 2:
        return Rock([Block(rng, (0.52, 0.2, 0.4), 7, 0.7, tilt=(rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15)))], buried=0.28), "rock"
    if variant == 3:
        return Rock([Block(rng, (0.42, 0.44, 0.36), 12, 0.5, tilt=(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3)))]), "rock"
    blocks = []
    dip = (rng.uniform(0.12, 0.3), rng.uniform(-0.2, 0.2))  # общий наклон пластов
    if variant == 4:
        # Гряда: четыре глыбы-пласта вдоль линии, одна над другой внахлёст, с общим наклоном.
        for i in range(4):
            along = -0.36 + 0.24 * i + rng.uniform(-0.05, 0.05)
            centre = (along, rng.uniform(0.0, 0.14) + 0.05 * (i % 2), rng.uniform(-0.1, 0.1))
            blocks.append(Block(rng, (rng.uniform(0.26, 0.36), rng.uniform(0.15, 0.24), rng.uniform(0.24, 0.34)), 8, 0.7, centre, dip, strata=0.05))
        return Rock(blocks, buried=0.25), "rock"
    # Останец: три глыбы столбом, каждая следующая меньше и чуть в сторону.
    height = 0.0
    for i in range(3):
        size = 0.4 - 0.08 * i
        centre = (rng.uniform(-0.07, 0.07), height + size * 0.45, rng.uniform(-0.07, 0.07))
        blocks.append(Block(rng, (size, size * rng.uniform(0.55, 0.75), size * rng.uniform(0.8, 1.0)), 9, 0.6, centre, dip, strata=0.06))
        height += size * 0.8
    return Rock(blocks, buried=0.12), "rock"


SPECIES = {
    # файл: (строитель, вариантов, рисунок листвы, кора ambientCG, тон коры, размер карточки, стороны трубок по уровням)
    "dub": (oak, 3, twig_oak, "Bark014", (0.34, 0.27, 0.21), 1.0, (10, 6, 4)),
    "oliva": (olive, 3, twig_olive, "Bark001", (0.36, 0.33, 0.29), 1.0, (10, 6, 4)),
    "kiparis": (cypress, 2, frond_cypress, "Bark004", (0.34, 0.27, 0.21), 1.0, (8, 5, 4)),
    "sosna": (pine, 2, tuft_pine, "Bark012", (0.44, 0.29, 0.2), 1.0, (10, 6, 4)),
    "palma": (palm, 2, frond_palm_set, None, None, 1.0, (10, 6, 4)),
    "tamarisk": (tamarisk, 2, spray_tamarisk, "Bark001", (0.33, 0.27, 0.24), 1.0, (8, 5, 3)),
    "kust": (shrub, 2, twig_shrub, "Bark001", (0.3, 0.25, 0.2), 0.27, (5, 4, 3)),
    "kust_suhoy": (dry_shrub, 2, twig_dry, None, None, 0.2, (4, 3, 3)),
    "kamen": (rock, 5, None, None, None, 1.0, (0, 0, 0)),
}
SEEDS = {"dub": 5, "oliva": 11, "kiparis": 23, "sosna": 37, "palma": 41, "tamarisk": 43, "kust": 47, "kust_suhoy": 53, "kamen": 59}


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

    def material(self, name, texture, roughness, cut, normal=None):
        material = {"name": name, "pbrMetallicRoughness": {"baseColorTexture": {"index": texture}, "metallicFactor": 0.0, "roughnessFactor": roughness}}
        if normal is not None:
            material["normalTexture"] = {"index": normal}
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
    wanted = [name for name in sys.argv[1:] if not name.startswith("-")]
    report = []
    for name, (builder, variants, leaf_maker, bark_asset, bark_tint, card_size, sides) in SPECIES.items():
        if wanted and name not in wanted:
            continue
        rng = np.random.default_rng(SEEDS[name])
        # Все варианты вида — в одном файле: текстуры у них общие, и в сборку они попадают один раз.
        glb = Glb()
        if name == "kamen":
            detail, relief = rock_textures()
            stone_material = glb.material("kamen", glb.texture(detail, "image/jpeg"), 0.9, False, normal=glb.texture(relief, "image/jpeg"))
            for variant in range(1, variants + 1):
                model, style = builder(np.random.default_rng(1000 * variant + len(name)), variant)
                line = []
                for level in range(3):
                    stone, _ = model.meshes(level)
                    glb.mesh("%s_%02d_LOD%d" % (name, variant, level), [(stone, stone_material)])
                    line.append(stone.count())
                report.append("%s_%02d: треугольников %d / %d / %d; высота над землёй %.2f м при поперечнике 1 м, глыб %d" % (
                    name, variant, line[0], line[1], line[2], model.tall, len(model.blocks)))
        else:
            leaves_image = atlas(leaf_maker, rng)
            if bark_asset is not None:
                bark_image = bark_texture(bark_asset, bark_tint, 256)
            else:
                bark_image = bark_palm(rng, 256)
            bark_material = glb.material("kora", glb.texture(bark_image, "image/jpeg"), 0.9, False)
            leaf_material = glb.material("listva", glb.texture(leaves_image, "image/png"), 0.65, True)
            for variant in range(1, variants + 1):
                tree, style = builder(np.random.default_rng(1000 * variant + len(name)))
                line = []
                for level in range(3):
                    if hasattr(tree, "meshes"):
                        bark, leaves = tree.meshes(level, sides)
                    else:
                        bark, leaves = build(tree, np.random.default_rng(variant * 31 + level), level, sides, card_size, style)
                    glb.mesh("%s_%02d_LOD%d" % (name, variant, level), [(bark, bark_material), (leaves, leaf_material)])
                    line.append(bark.count() + leaves.count())
                if hasattr(tree, "meshes"):
                    places = np.array([p for frond in tree.fronds for p in frond["points"]])
                else:
                    places = np.array([a[0] for a in tree.anchors])
                report.append("%s_%02d: треугольников %d / %d / %d; рост %.1f м, крона %.1f м" % (
                    name, variant, line[0], line[1], line[2], places[:, 1].max(), max(np.ptp(places[:, 0]), np.ptp(places[:, 2]))))
        path = os.path.join(OUT, "%s.glb" % name)
        glb.save(path)
        report.append("%s.glb: %.0f КБ" % (name, os.path.getsize(path) / 1024.0))
    print("\n".join(report))


if __name__ == "__main__":
    main()
