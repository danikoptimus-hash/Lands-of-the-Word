#!/usr/bin/env python3
"""Материалы земли версии 2 (шаг 1.3 «Поверхности»): из свободных фотоматериалов — два атласа для игры.

Источники — Poly Haven и ambientCG, лицензия CC0 (реестр — v2/assets/ASSETS.md). Инструмент скачивает материалы
в кэш, приводит цвет каждого к палитре игры (решение владельца 11.11: «красочность, насыщенность, сочность и
контрастность… природа, максимально приближенная к реальности» — фактура фотографии сохраняется, средний цвет,
насыщенность и контраст задаются таблицей ниже) и собирает два атласа слоёв (сетка 4×4, слой 1024×1024):

  v2/assets/terrain/ground_albedo.webp — цвет (RGB) и высота фактуры (A): по высоте слои смешиваются «по-природному»
                                         (песок ложится в щели между камнями, трава — поверх земли);
  v2/assets/terrain/ground_normal.jpg  — нормаль (RG, «зелёный вверх») и шероховатость (B);
  v2/assets/terrain/noise.png          — четыре независимых шума (плитка без шва): пятна цвета и чередование плиток.

Таблица слоёв для шейдера (номер, размер плитки в метрах, средний цвет) — v2/src/terrain/surface_layers.gdshaderinc.

Запуск из корня репозитория:  python3 v2/tools/surfaces/make.py [--sheet файл.jpg]
Нужны numpy и Pillow. Кэш — ~/.cache/zemli-slova/surfaces (или папка из переменной SURFACES_CACHE).
"""
import io
import json
import os
import sys
import urllib.request
import zipfile

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CACHE = os.environ.get("SURFACES_CACHE", os.path.expanduser("~/.cache/zemli-slova/surfaces"))
SIZE = 1024
GRID = 4

# Слои. source: ph — Poly Haven, acg — ambientCG. tile — сколько метров мира занимает плитка (съёмки с воздуха —
# примерно вдвое мельче настоящего размера: так точка фактуры равна точке экрана при самом близком приближении).
# mean — средний цвет слоя в игре (sRGB), sat и contrast — множители насыщенности и контраста к исходному снимку.
LAYERS = [
    dict(key="sand_dune", source="acg", name="Ground097", tile=9.0, mean=(226, 174, 104), sat=1.0, contrast=1.15,
         title="Песок барханов с ветровой рябью"),
    dict(key="desert_stone", source="ph", name="dry_ground_rocks", tile=11.0, mean=(192, 142, 90), sat=1.05, contrast=1.1,
         title="Каменистая пустыня: щебень на плотном грунте"),
    dict(key="dry_grass", source="ph", name="aerial_rocks_01", tile=44.0, mean=(146, 140, 78), sat=1.1, contrast=1.15,
         title="Сухая трава холмов с валунами (съёмка с воздуха)"),
    dict(key="hill_stone", source="ph", name="rocky_terrain", tile=48.0, mean=(140, 124, 82), sat=1.1, contrast=1.1,
         title="Травянистый склон с выходами плитняка (съёмка с воздуха)"),
    dict(key="meadow", source="ph", name="rocky_terrain_02", tile=46.0, mean=(90, 128, 50), sat=0.95, contrast=1.15,
         title="Луг сверху: густая трава (съёмка с воздуха)"),
    dict(key="grass_lush", source="acg", name="Grass004", tile=5.0, mean=(80, 124, 44), sat=0.92, contrast=1.1,
         title="Сочная густая трава вблизи"),
    dict(key="rock_cliff", source="ph", name="marble_cliff_03", tile=18.0, mean=(200, 164, 118), sat=1.2, contrast=1.2,
         title="Скала: тёплый трещиноватый известняк"),
    dict(key="rock_strata", source="ph", name="cliff_side", tile=12.0, mean=(186, 124, 78), sat=1.0, contrast=1.15,
         title="Скала слоями: красно-охристый песчаник"),
    dict(key="mountain_slope", source="ph", name="aerial_rocks_04", tile=44.0, mean=(120, 118, 74), sat=1.1, contrast=1.15,
         title="Горный склон: трава и камень (съёмка с воздуха)"),
    dict(key="scree", source="ph", name="gravel_ground_01", tile=10.0, mean=(178, 160, 132), sat=1.1, contrast=1.1,
         title="Осыпь: мелкий щебень"),
    dict(key="beach_sand", source="acg", name="Ground092A", tile=8.0, mean=(240, 216, 168), sat=1.2, contrast=1.1,
         title="Светлый песок пляжа с рябью"),
    dict(key="soil_red", source="ph", name="red_dirt_mud_01", tile=6.0, mean=(132, 82, 54), sat=0.85, contrast=1.1,
         title="Красная почва (терра-росса)"),
    dict(key="oasis_green", source="acg", name="Ground037", tile=7.0, mean=(84, 126, 48), sat=0.95, contrast=1.1,
         title="Влажная зелень оазиса и берегов"),
    dict(key="pebbles", source="ph", name="ganges_river_pebbles", tile=5.0, mean=(172, 160, 148), sat=1.25, contrast=1.1,
         title="Галька берегов"),
    dict(key="mud_cracked", source="ph", name="mud_cracked_dry_03", tile=8.0, mean=(214, 168, 124), sat=1.1, contrast=1.1,
         title="Растрескавшаяся глина сухих низин"),
    dict(key="lichen_rock", source="ph", name="mossy_rock", tile=12.0, mean=(126, 128, 104), sat=1.2, contrast=1.15,
         title="Серый камень с лишайником"),
]


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 2000:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "zemli-slova-tools"})
    with urllib.request.urlopen(request, timeout=180) as response:
        data = response.read()
    with open(path + ".part", "wb") as file:
        file.write(data)
    os.replace(path + ".part", path)


def load_maps(layer):
    """Цвет, высота, нормаль (GL), шероховатость, затенение — массивы 0…1 размера SIZE."""
    name = layer["name"]
    folder = os.path.join(CACHE, name)
    if layer["source"] == "ph":
        base = f"https://dl.polyhaven.org/file/ph-assets/Textures/{{fmt}}/1k/{name}/{name}_{{kind}}_1k.{{ext}}"
        files = {"color": ("jpg", "diff", "jpg"), "height": ("png", "disp", "png"), "normal": ("jpg", "nor_gl", "jpg"),
                 "rough": ("jpg", "rough", "jpg")}
        paths = {}
        for kind, (fmt, tag, ext) in files.items():
            paths[kind] = os.path.join(folder, f"{tag}.{ext}")
            fetch(base.format(fmt=fmt, kind=tag, ext=ext), paths[kind])
    else:
        archive = os.path.join(folder, "1k.zip")
        fetch(f"https://ambientcg.com/get?file={name}_1K-JPG.zip", archive)
        with zipfile.ZipFile(archive) as pack:
            names = pack.namelist()
            def member(tag):
                found = [n for n in names if n.endswith(f"_{tag}.jpg")]
                return found[0] if found else None
            paths = {}
            for kind, tag in (("color", "Color"), ("height", "Displacement"), ("normal", "NormalGL"), ("rough", "Roughness")):
                inner = member(tag)
                if inner is None:
                    paths[kind] = None
                    continue
                paths[kind] = os.path.join(folder, f"{tag}.jpg")
                if not os.path.exists(paths[kind]):
                    with open(paths[kind], "wb") as file:
                        file.write(pack.read(inner))

    def read(kind, mode):
        if paths.get(kind) is None:
            return None
        image = Image.open(paths[kind])
        if mode == "L" and image.mode in ("I;16", "I"):
            data = np.asarray(image, dtype=np.float64)
            data = data / 65535.0
            image = Image.fromarray((data * 255.0).astype(np.float32), mode="F").resize((SIZE, SIZE), Image.LANCZOS)
            return np.clip(np.asarray(image, dtype=np.float64) / 255.0, 0.0, 1.0)
        image = image.convert(mode)
        if image.size != (SIZE, SIZE):
            image = image.resize((SIZE, SIZE), Image.LANCZOS)
        return np.asarray(image, dtype=np.float64) / 255.0

    color = read("color", "RGB")
    height = read("height", "L")
    normal = read("normal", "RGB")
    rough = read("rough", "L")
    if height is None:
        height = color.mean(axis=2)
    low, high = np.percentile(height, [1.0, 99.0])
    height = np.clip((height - low) / max(high - low, 1e-6), 0.0, 1.0)
    if rough is None:
        rough = np.full((SIZE, SIZE), 0.9)
    return color, height, normal, rough


def to_hsv(rgb):
    high = rgb.max(axis=2)
    low = rgb.min(axis=2)
    span = high - low
    safe = np.maximum(span, 1e-9)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    hue = np.where(high == r, ((g - b) / safe) % 6.0, np.where(high == g, (b - r) / safe + 2.0, (r - g) / safe + 4.0)) / 6.0
    hue = np.where(span < 1e-9, 0.0, hue)
    return hue, span / np.maximum(high, 1e-9), high


def to_rgb(hue, saturation, value):
    h6 = (hue % 1.0) * 6.0
    k = np.stack([(5.0 + h6) % 6.0, (3.0 + h6) % 6.0, (1.0 + h6) % 6.0], axis=2)
    return value[:, :, None] * (1.0 - saturation[:, :, None] * np.clip(np.minimum(k, 4.0 - k), 0.0, 1.0))


def grade(color, layer):
    """Цвет слоя к палитре игры. Фактура снимка сохраняется; меняются оттенок, насыщенность, яркость и контраст.

    Работает по оттенку, а не по каналам: цветные точки снимка (трава, песок, охра) поворачиваются к оттенку слоя
    и набирают его насыщенность; серое (камни среди травы, белёсые сколы скалы) остаётся серым. При покраске
    «по каналам» светлые камни на лугу становились сиреневыми."""
    target = np.array(layer["mean"], dtype=np.float64).reshape(1, 1, 3) / 255.0
    target_hue, target_sat, _ = (float(v[0, 0]) for v in to_hsv(target))
    hue, saturation, value = to_hsv(color)
    vivid = np.clip((saturation - 0.10) / 0.20, 0.0, 1.0)
    weight = vivid * saturation * value
    angle = hue * 2.0 * np.pi
    mean_hue = np.arctan2((np.sin(angle) * weight).sum(), (np.cos(angle) * weight).sum()) / (2.0 * np.pi)
    turn = ((target_hue - mean_hue + 0.5) % 1.0) - 0.5
    mean_sat = float((saturation * vivid).sum() / max(vivid.sum(), 1e-6))
    factor = float(np.clip(target_sat * layer["sat"] / max(mean_sat, 1e-3), 0.6, 2.6))
    out = to_rgb(hue + turn * vivid, np.clip(saturation * (1.0 + (factor - 1.0) * vivid), 0.0, 0.96), value)
    weights = np.array([0.2126, 0.7152, 0.0722])
    mean = out.reshape(-1, 3).mean(axis=0)
    out = (out - mean) * layer["contrast"] + mean
    out = out * float((target.reshape(3) * weights).sum() / max((mean * weights).sum(), 1e-3))
    return np.clip(out, 0.0, 1.0)


def noise_texture(size=512, seed=20261111):
    """Четыре независимых шума в одной текстуре, плитка без шва: спектр 1/f^β со случайными фазами.

    Каналы — от плавного к мелкому (β = 2,3; 1,8; 1,4; 1,1). Значения выровнены: в каждом канале все уровни от 0 до 1
    встречаются одинаково часто, поэтому порог 0,7 в шейдере — это ровно 30 % площади."""
    rng = np.random.default_rng(seed)
    fy = np.fft.fftfreq(size)[:, None]
    fx = np.fft.fftfreq(size)[None, :]
    radius = np.sqrt(fx * fx + fy * fy)
    radius[0, 0] = 1.0
    out = np.zeros((size, size, 4), dtype=np.uint8)
    for channel, beta in enumerate((2.3, 1.8, 1.4, 1.1)):
        spectrum = rng.normal(size=(size, size)) + 1j * rng.normal(size=(size, size))
        spectrum *= radius ** (-beta)
        spectrum[0, 0] = 0.0
        field = np.fft.ifft2(spectrum).real
        order = np.argsort(field, axis=None)
        ranks = np.empty(order.size, dtype=np.float64)
        ranks[order] = np.linspace(0.0, 1.0, order.size)
        out[:, :, channel] = np.round(ranks.reshape(size, size) * 255.0)
    return out


def main():
    sheet_path = None
    if "--sheet" in sys.argv:
        sheet_path = sys.argv[sys.argv.index("--sheet") + 1]
    albedo = np.zeros((SIZE * GRID, SIZE * GRID, 4), dtype=np.uint8)
    normal_atlas = np.zeros((SIZE * GRID, SIZE * GRID, 3), dtype=np.uint8)
    table = []
    thumbs = []
    for index, layer in enumerate(LAYERS):
        color, height, normal, rough = load_maps(layer)
        graded = grade(color, layer)
        y0 = (index // GRID) * SIZE
        x0 = (index % GRID) * SIZE
        albedo[y0:y0 + SIZE, x0:x0 + SIZE, :3] = np.round(graded * 255.0)
        albedo[y0:y0 + SIZE, x0:x0 + SIZE, 3] = np.round(height * 255.0)
        normal_atlas[y0:y0 + SIZE, x0:x0 + SIZE, 0] = np.round(normal[:, :, 0] * 255.0)
        normal_atlas[y0:y0 + SIZE, x0:x0 + SIZE, 1] = np.round(normal[:, :, 1] * 255.0)
        normal_atlas[y0:y0 + SIZE, x0:x0 + SIZE, 2] = np.round(np.clip(rough, 0.0, 1.0) * 255.0)
        mean = graded.reshape(-1, 3).mean(axis=0)
        table.append((layer, mean))
        thumbs.append((layer["key"], color, graded))
        print(f"{index:2d} {layer['key']:15s} {layer['name']:22s} средний цвет {np.round(mean * 255).astype(int)}")

    out_folder = os.path.join(ROOT, "assets", "terrain")
    os.makedirs(out_folder, exist_ok=True)
    # В репозитории атласы лежат сжатыми (WebP и JPEG без прореживания цвета): движок при импорте всё равно
    # пережимает их в формат видеокарты, а PNG весили бы по 45 МБ.
    Image.fromarray(albedo, "RGBA").save(os.path.join(out_folder, "ground_albedo.webp"), quality=92, method=6, alpha_quality=95)
    Image.fromarray(normal_atlas, "RGB").save(os.path.join(out_folder, "ground_normal.jpg"), quality=93, subsampling=0, optimize=True)

    Image.fromarray(noise_texture(), "RGBA").save(os.path.join(out_folder, "noise.png"), optimize=True)

    lines = ["// Слои земли (шаг 1.3 «Поверхности»). Файл пишет v2/tools/surfaces/make.py — руками не править.",
             "// Номер слоя в атласах ground_albedo/ground_normal, размер плитки в метрах и средний цвет (линейный).", ""]
    for index, (layer, mean) in enumerate(table):
        lines.append(f"const int L_{layer['key'].upper()} = {index}; // {layer['title']}")
    lines.append(f"const int LAYER_COUNT = {len(table)};")
    lines.append("const float LAYER_TILE[LAYER_COUNT] = float[LAYER_COUNT](" + ", ".join(f"{layer['tile']:.1f}" for layer, _ in table) + ");")
    def linear(c):
        return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    lines.append("const vec3 LAYER_COLOR[LAYER_COUNT] = vec3[LAYER_COUNT](" + ", ".join(
        "vec3(%.4f, %.4f, %.4f)" % tuple(linear(mean)) for _, mean in table) + ");")
    with open(os.path.join(ROOT, "src", "terrain", "surface_layers.gdshaderinc"), "w", encoding="utf-8") as file:
        file.write("\n".join(lines) + "\n")

    if sheet_path:
        cell = 256
        sheet = Image.new("RGB", (cell * 8, cell * 2 * ((len(thumbs) + 7) // 8)), (16, 16, 16))
        for i, (key, before, after) in enumerate(thumbs):
            x = (i % 8) * cell
            y = (i // 8) * cell * 2
            sheet.paste(Image.fromarray(np.round(before * 255).astype(np.uint8)).resize((cell, cell), Image.LANCZOS), (x, y))
            sheet.paste(Image.fromarray(np.round(after * 255).astype(np.uint8)).resize((cell, cell), Image.LANCZOS), (x, y + cell))
        sheet.save(sheet_path, quality=90)


if __name__ == "__main__":
    main()
