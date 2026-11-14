#!/usr/bin/env python3
"""Общая основа сцены для сравнения движков: одно и то же место для Godot, Unity и Unreal.

Место — западный берег Корфу у Палеокастрицы, квадрат 11 × 11 км. Источник высот — открытые плитки
Terrain Tiles (Mapzen/AWS, формат terrarium): https://registry.opendata.aws/terrain-tiles/

Что получается (папка dannye/):
  vysoty.png   — высоты, 16 бит, SIZE × SIZE; метры = H_MIN + значение / 65535 × (H_MAX − H_MIN)
  vysoty.r16   — те же высоты без сжатия (по два байта, младший первым) — для движков
  maski.png    — RGBA по 8 бит: R скала, G густота деревьев, B густота кустов, A пляж (галька, песок)
  porody.png   — RGB по 8 бит: R доля сосен, G доля широколистных, B запас; остальное — оливы
  opisanie.json — размеры, пределы высот, уровень моря, правило расстановки
  vid_sverhu.jpg — контрольная картинка «как это выглядит сверху» (не для движков)

Оси основы: u — на восток, v — на север, оба от 0 до SIDE метров; строка 0 картинок — север.

Расстановка растений задана правилом, а не списком: каждый движок повторяет rasstanovka.py
и получает те же точки. Так не нужен файл на миллионы строк и можно строить лес кусками у камеры.

Запуск: python sravnenie/osnova/make.py   (нужны numpy, Pillow, scipy; в рабочей среде — scratchpad/gdvenv)
"""
import io
import json
import math
import os
import sys
import urllib.request

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "dannye")
CACHE = os.path.join(os.path.expanduser("~"), ".cache", "zemli-slova", "terrarium")

# Центр участка и сторона квадрата.
LAT_C, LON_C = 39.675, 19.705
SIDE = 11000.0
SIZE = 2048
ZOOM = 13
SEA = 0.0          # уровень моря в метрах
H_MIN, H_MAX = -60.0, 640.0
SEED = 20261113


def tile_xy(lat, lon, z):
    n = 2.0 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def fetch_tile(z, x, y):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{z}_{x}_{y}.png")
    if not os.path.exists(path):
        url = f"https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
        with urllib.request.urlopen(url, timeout=60) as r, open(path, "wb") as f:
            f.write(r.read())
    a = np.asarray(Image.open(path).convert("RGB"), np.float32)
    return a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0 - 32768.0


def source_heights():
    """Высоты из плиток, пересчитанные на ровную метровую сетку SIZE × SIZE (строка 0 — север)."""
    m_lat = 111132.0
    m_lon = 111320.0 * math.cos(math.radians(LAT_C))
    half = SIDE / 2.0
    lat0, lat1 = LAT_C - half / m_lat, LAT_C + half / m_lat
    lon0, lon1 = LON_C - half / m_lon, LON_C + half / m_lon
    x0, y1 = tile_xy(lat0, lon0, ZOOM)
    x1, y0 = tile_xy(lat1, lon1, ZOOM)
    tx0, tx1, ty0, ty1 = int(x0) - 1, int(x1) + 1, int(y0) - 1, int(y1) + 1
    big = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), np.float32)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            big[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = fetch_tile(ZOOM, tx, ty)
    # Центры точек сетки: u на восток, строка 0 — север.
    u = (np.arange(SIZE) + 0.5) / SIZE
    lon = lon0 + u * (lon1 - lon0)
    lat = lat1 - u * (lat1 - lat0)
    n = 2.0 ** ZOOM
    px = ((lon + 180.0) / 360.0 * n - tx0) * 256.0 - 0.5
    py = ((1.0 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2.0 * n - ty0) * 256.0 - 0.5
    yy, xx = np.meshgrid(py, px, indexing="ij")
    return ndimage.map_coordinates(big, [yy, xx], order=3, mode="nearest").astype(np.float32)


def fractal(rng, size, cell_m, longest_m, shortest_m, beta=2.2):
    """Шум с плавным спектром: волны от shortest_m до longest_m, сумма нормирована к разбросу 1."""
    f = np.fft.fftfreq(size, d=cell_m)
    fx, fy = np.meshgrid(f, f)
    k = np.hypot(fx, fy)
    amp = np.zeros_like(k)
    band = (k > 1.0 / longest_m) & (k < 1.0 / shortest_m)
    amp[band] = k[band] ** (-beta / 2.0)
    spec = amp * np.exp(2j * math.pi * rng.random((size, size)))
    field = np.fft.ifft2(spec).real
    return (field / (field.std() + 1e-9)).astype(np.float32)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def build():
    rng = np.random.default_rng(SEED)
    cell = SIDE / SIZE
    raw = source_heights()

    # Берег: в исходных данных он ступенчатый (шаг 30 м) — сглаживаем сам переход «суша — море».
    soft = ndimage.gaussian_filter(raw, 1.6)
    land = soft > 0.6
    land = ndimage.binary_opening(land, iterations=1)
    dist_sea = ndimage.distance_transform_edt(~land) * cell      # для моря: метров до берега
    dist_land = ndimage.distance_transform_edt(land) * cell      # для суши: метров до воды

    # Суша: высоты как есть плюс мелкий рельеф, которого нет в данных с шагом 30 м.
    gy, gx = np.gradient(soft, cell)
    slope0 = np.degrees(np.arctan(np.hypot(gx, gy)))
    rough = fractal(rng, SIZE, cell, 160.0, 12.0)
    detail = rough * (0.5 + 2.6 * smoothstep(12.0, 40.0, slope0)) * smoothstep(0.0, 40.0, dist_land)
    ground = np.maximum(soft, 0.0) + detail
    # У воды суша плавно выходит из моря: пляж или подножие скалы, без ступеньки.
    shore = 0.35 + 2.2 * smoothstep(0.0, 30.0, dist_land)
    ground = np.maximum(ground, np.minimum(shore, 0.35 + dist_land * 0.12))

    # Дно: в данных его почти нет — строим по расстоянию до берега, у крутых берегов глубже.
    coast_steep = ndimage.gaussian_filter(np.where(land, slope0, 0.0), 6.0) / (ndimage.gaussian_filter(land.astype(np.float32), 6.0) + 1e-3)
    steep_k = 0.6 + 1.2 * smoothstep(10.0, 35.0, coast_steep)
    bed_noise = fractal(rng, SIZE, cell, 2200.0, 260.0)     # дно меняется плавно: мелкой ряби на нём нет
    depth = (1.5 * (1.0 - np.exp(-dist_sea / 25.0)) + 46.0 * smoothstep(0.0, 1800.0, dist_sea) ** 0.75) * steep_k
    depth = depth * (1.0 + 0.12 * bed_noise) + 0.25
    height = np.where(land, ground, SEA - depth).astype(np.float32)
    height = np.clip(height, H_MIN, H_MAX)

    # Уклон готовой поверхности.
    gy, gx = np.gradient(height, cell)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    slope_s = ndimage.gaussian_filter(slope, 1.2)

    # Положение в рельефе: ложбины ниже окрестностей, гребни выше.
    tpi = height - ndimage.gaussian_filter(height, 28.0)

    patch = fractal(rng, SIZE, cell, 1400.0, 120.0)      # крупные пятна
    grain = fractal(rng, SIZE, cell, 220.0, 20.0)        # мелкая пестрота

    # Пляж: низко, полого, у самой воды.
    beach = land * smoothstep(4.5, 2.0, height) * smoothstep(16.0, 8.0, slope_s) * smoothstep(70.0, 25.0, dist_land)
    # Скала: крутые склоны, обрывы у моря, вершины; с пестротой, чтобы граница не была ровной.
    rock = smoothstep(31.0, 46.0, slope_s + 5.0 * grain)
    rock = np.maximum(rock, 0.75 * smoothstep(520.0, 600.0, height + 30.0 * grain))
    rock = np.maximum(rock, 0.6 * smoothstep(22.0, 34.0, slope_s) * smoothstep(60.0, 15.0, dist_land))
    rock = land * np.clip(rock, 0.0, 1.0) * (1.0 - beach)

    # Деревья: всюду, где не скала и не пляж; на пологом густо, на крутом редеют и уступают кустам.
    fit = (1.0 - smoothstep(24.0, 40.0, slope_s)) * (1.0 - smoothstep(430.0, 560.0, height))
    trees = land * fit * (1.0 - rock) * (1.0 - beach) * np.clip(0.86 + 0.16 * patch + 0.10 * grain, 0.35, 1.0)
    trees *= smoothstep(6.0, 22.0, dist_land + 4.0 * grain)   # у самой воды деревьев нет
    # Кусты: подлесок на опушках, крутые склоны, вершины, полоса у берега.
    shrubs = land * (1.0 - beach) * np.clip(1.0 - 0.75 * trees - 0.85 * rock, 0.0, 1.0)
    shrubs *= np.clip(0.75 + 0.3 * grain, 0.2, 1.0)

    # Породы. Сосны — у берега и на сухих гребнях; широколистные — в ложбинах; остальное — оливы.
    pine = smoothstep(700.0, 150.0, dist_land) * (0.35 + 0.65 * smoothstep(-0.2, 0.9, patch)) * 0.75
    pine = np.maximum(pine, 0.5 * smoothstep(3.0, 12.0, tpi) * smoothstep(0.0, 0.8, -patch))
    broad = smoothstep(-2.0, -9.0, tpi) * 0.8 * (1.0 - pine)
    pine, broad = np.clip(pine, 0.0, 1.0), np.clip(broad, 0.0, 1.0)

    os.makedirs(OUT, exist_ok=True)
    h16 = np.round((height - H_MIN) / (H_MAX - H_MIN) * 65535.0).astype(np.uint16)
    Image.fromarray(h16).save(os.path.join(OUT, "vysoty.png"), optimize=True)
    # То же без сжатия: по два байта на точку, младший первым, строка 0 — север. Этот вид читают напрямую
    # и Unreal (Landscape), и Unity (Terrain), и Godot.
    h16.astype("<u2").tofile(os.path.join(OUT, "vysoty.r16"))
    to8 = lambda a: np.round(np.clip(a, 0.0, 1.0) * 255.0).astype(np.uint8)
    Image.fromarray(np.dstack([to8(rock), to8(trees), to8(shrubs), to8(beach)]), "RGBA").save(os.path.join(OUT, "maski.png"), optimize=True)
    Image.fromarray(np.dstack([to8(pine), to8(broad), np.zeros_like(to8(pine))]), "RGB").save(os.path.join(OUT, "porody.png"), optimize=True)

    info = {
        "mesto": "Корфу, западный берег у Палеокастрицы",
        "centr_shirota_dolgota": [LAT_C, LON_C],
        "storona_m": SIDE,
        "razmer": SIZE,
        "shag_m": cell,
        "vysota_min_m": H_MIN,
        "vysota_max_m": H_MAX,
        "more_m": SEA,
        "osi": "u — на восток, v — на север, от 0 до storona_m; строка 0 картинок — север",
        "fakt": {
            "vysshaya_tochka_m": round(float(height.max()), 1),
            "glubzhe_vsego_m": round(float(height.min()), 1),
            "dolya_sushi": round(float(land.mean()), 3),
            "dolya_skaly_na_sushe": round(float(rock[land].mean()), 3),
            "srednyaya_gustota_derevev_na_sushe": round(float(trees[land].mean()), 3),
            "srednyaya_gustota_kustov_na_sushe": round(float(shrubs[land].mean()), 3),
        },
        "rasstanovka": {
            "opisanie": "сетка со сдвигом: в каждой клетке одна возможная точка; правило — rasstanovka.py",
            "zerno": SEED,
            "derevya_kletka_m": 6.5,
            "kusty_kletka_m": 3.2,
            "kamni_kletka_m": 9.0,
        },
        "istochnik_vysot": "Terrain Tiles (Mapzen, AWS Open Data), плитки terrarium, масштаб 13",
    }
    json.dump(info, open(os.path.join(OUT, "opisanie.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)

    # Контрольная картинка сверху: цвета условные, свет с юго-запада.
    n = np.dstack([-gx, -gy, np.ones_like(height)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    sun = np.array([-0.5, 0.45, 0.74]); sun /= np.linalg.norm(sun)
    lit = np.clip((n * sun).sum(2), 0.0, 1.0)[..., None]
    soil = np.array([0.52, 0.47, 0.36]); rock_c = np.array([0.78, 0.75, 0.68]); sand = np.array([0.86, 0.82, 0.70])
    olive = np.array([0.33, 0.39, 0.25]); pine_c = np.array([0.20, 0.31, 0.17]); broad_c = np.array([0.27, 0.40, 0.18])
    shrub_c = np.array([0.40, 0.42, 0.27])
    col = np.broadcast_to(soil, height.shape + (3,)).copy()
    col = col * (1 - shrubs[..., None]) + shrub_c * shrubs[..., None]
    crown = olive * (1 - pine[..., None]) * (1 - broad[..., None]) + pine_c * pine[..., None] + broad_c * broad[..., None] * (1 - pine[..., None])
    col = col * (1 - trees[..., None]) + crown * trees[..., None]
    col = col * (1 - rock[..., None]) + rock_c * rock[..., None]
    col = col * (1 - beach[..., None]) + sand * beach[..., None]
    col = col * (0.45 + 0.75 * lit)
    d = np.clip(-height / 45.0, 0.0, 1.0)[..., None]
    water = np.array([0.30, 0.74, 0.72]) * (1 - d) ** 2.2 + np.array([0.06, 0.22, 0.40]) * (1 - (1 - d) ** 2.2)
    col = np.where(land[..., None], col, water)
    Image.fromarray(to8(col)).resize((1400, 1400), Image.LANCZOS).save(os.path.join(OUT, "vid_sverhu.jpg"), quality=88)

    for k, v in info["fakt"].items():
        print(f"{k}: {v}")
    for name in ("vysoty.png", "maski.png", "porody.png"):
        print(name, round(os.path.getsize(os.path.join(OUT, name)) / 1e6, 2), "МБ")


if __name__ == "__main__":
    build()
