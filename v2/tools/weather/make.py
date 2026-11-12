"""Карта облаков и шум облаков для погоды (шаг 1.6 «Атмосфера и погода»).

Запуск из корня репозитория (numpy, scipy и Pillow есть в scratchpad/gdvenv):
    python v2/tools/weather/make.py

Пишет в v2/assets/weather/:
  cloud_map.png   — карта облаков 1024×1024, плитка 48 км (47 м на точку), бесшовная. Каналы:
                    R — ясная погода: «присутствие» кучевых облаков (1 — середина облачной массы, к краю — 0);
                    G — шторм: сплошные тучи с крупными грозовыми башнями (1 — 3400 м);
                    B — где в шторм льёт сильнее всего (под башнями);
                    A — ясная погода: потолок облака над его низом (1 — 2200 м).
  cloud_noise.png — объёмный шум 64×64×64 (8×8 срезов), бесшовный: им «обгрызаются» края облаков.

Облака ясной погоды — не шум, а отдельные облака: малые и крупные кучевые, одиночные и группами, местами поля
слоисто-кучевых; у каждого свои размер, число воздушных масс и высота; между группами — большие чистые участки
неба. На карте — где облако есть и какой у него потолок; сами клубы лепит объёмный шум в шейдере неба.
Числа — в начале файла.
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

OUT = Path(__file__).resolve().parents[2] / "assets" / "weather"
N = 1024  # точек карты по стороне
TILE = 48000.0  # метров в плитке карты
TEXEL = TILE / N
CLEAR_DEPTH = 2200.0  # метров толщины облака ясной погоды при значении 1
STORM_DEPTH = 3400.0  # то же для туч шторма
CLEAR_CLOUDS = 120  # сколько кучевых облаков на плитке в ясную погоду (2300 км²)
CLEAR_LARGE = 9  # из них крупных
CLEAR_SHEETS = 2  # и сколько полей слоисто-кучевых
STORM_TOWERS = 13  # сколько грозовых башен на плитке


def spectral(rng, shape, low, high, slope=1.0):
    """Бесшовный шум: белый шум, в спектре которого оставлены волны длиной от low до high точек."""
    white = rng.standard_normal(shape)
    spectrum = np.fft.fftn(white)
    grids = np.meshgrid(*[np.fft.fftfreq(n) for n in shape], indexing="ij")
    frequency = np.sqrt(sum(g * g for g in grids))
    frequency[(0,) * len(shape)] = 1.0
    keep = (frequency >= 1.0 / high) & (frequency <= 1.0 / low)
    field = np.real(np.fft.ifftn(spectrum * keep / frequency ** slope))
    field -= field.mean()
    field /= field.std() + 1e-9
    return field  # среднее 0, разброс 1


def to_unit(field, spread=2.2):
    return np.clip(0.5 + field / (2.0 * spread), 0.0, 1.0)


def stamp(target, warp_x, warp_y, centre, radius, height, power):
    """Положить на карту один «клуб»: купол высотой height и радиусом radius (метры), с искривлённым краем."""
    reach = int(np.ceil((radius + 420.0) / TEXEL)) + 1
    cx, cy = centre[0] / TEXEL, centre[1] / TEXEL
    xs = np.arange(int(np.floor(cx)) - reach, int(np.floor(cx)) + reach + 1)
    ys = np.arange(int(np.floor(cy)) - reach, int(np.floor(cy)) + reach + 1)
    ix, iy = np.meshgrid(xs % N, ys % N)
    gx, gy = np.meshgrid(xs, ys)
    dx = (gx + 0.5) * TEXEL + warp_x[iy, ix] - centre[0]
    dy = (gy + 0.5) * TEXEL + warp_y[iy, ix] - centre[1]
    inside = np.clip(1.0 - (dx * dx + dy * dy) / (radius * radius), 0.0, 1.0)
    dome = height * inside ** power
    target[iy, ix] = np.maximum(target[iy, ix], dome)


def cloud(target, warp_x, warp_y, rng, centre, radius, depth, power):
    """Туча шторма: несколько клубов вдоль своей оси; середина выше краёв."""
    lobes = int(round(4 + 6 * min(radius / 1500.0, 1.0) + rng.uniform(0, 3)))
    turn = rng.uniform(0, np.pi)
    stretch = rng.uniform(1.0, 2.0)
    axis = np.array([np.cos(turn), np.sin(turn)])
    side = np.array([-axis[1], axis[0]])
    for index in range(lobes):
        along = rng.uniform(-0.8, 0.8) * radius * stretch if index else 0.0
        across = rng.uniform(-0.65, 0.65) * radius / stretch if index else 0.0
        away = min(np.hypot(along / stretch, across * stretch) / radius, 1.0)
        lobe_radius = radius * rng.uniform(0.3, 0.64) * (1.0 - 0.25 * away)
        lobe_height = depth * (1.0 - 0.6 * away ** 1.5) * rng.uniform(0.6, 1.0)
        stamp(target, warp_x, warp_y, centre + axis * along + side * across, lobe_radius, lobe_height, power)


def cumulus(cover, top, warp_x, warp_y, rng, centre, radius, depth):
    """Кучевое облако: несколько воздушных масс цепочкой (не вокруг одной середины — силуэт несимметричный),
    у каждой свои размер и высота; одна из масс — главная, самая высокая. На карту ложится не форма облака,
    а его «присутствие» (cover: 1 — середина массы, к краю сходит на нет) и потолок (top, метры): сами клубы
    лепит объёмный шум в шейдере неба — поэтому у облака нет ни конуса, ни ровного края."""
    masses = int(rng.integers(1, 3)) if radius < 500.0 else int(rng.integers(2, 6))
    at = np.array(centre, dtype=float)
    heading = rng.uniform(0, 2 * np.pi)
    lead = int(rng.integers(0, masses))
    for index in range(masses):
        size = radius * rng.uniform(0.45, 0.8) * (1.0 if index == lead else rng.uniform(0.6, 0.95))
        height = depth * (1.0 if index == lead else rng.uniform(0.4, 0.8))
        stamp(cover, warp_x, warp_y, at, size, 1.0, 0.75)
        stamp(top, warp_x, warp_y, at, size * 1.12, height, 0.3)
        # Пара клубов сбоку от массы: край неровный.
        for _ in range(int(rng.integers(1, 4))):
            turn = rng.uniform(0, 2 * np.pi)
            offset = np.array([np.cos(turn), np.sin(turn)]) * size * rng.uniform(0.55, 0.95)
            small = size * rng.uniform(0.3, 0.55)
            stamp(cover, warp_x, warp_y, at + offset, small, rng.uniform(0.6, 0.95), 0.75)
            stamp(top, warp_x, warp_y, at + offset, small * 1.12, height * rng.uniform(0.45, 0.85), 0.3)
        heading += rng.uniform(-1.1, 1.1)
        at = at + np.array([np.cos(heading), np.sin(heading)]) * size * rng.uniform(0.8, 1.25)


def clear_field(rng):
    """Ясная погода: отдельные кучевые облака — малые и крупные, одиночные и группами, местами поле
    слоисто-кучевых; между ними — большие чистые участки неба. Раскладывает их не равномерная случайность,
    а плавное поле облачности: где оно высоко — группы облаков, где низко — чисто."""
    field = spectral(rng, (N, N), 150, 600, 1.2)  # поле облачности: волны 7–28 км
    groups = to_unit(field + 0.45 * spectral(rng, (N, N), 40, 150), 1.5)
    warp_x = spectral(rng, (N, N), 5, 44) * 150.0
    warp_y = spectral(rng, (N, N), 5, 44) * 150.0
    cover = np.zeros((N, N))
    top = np.zeros((N, N))
    placed = 0
    large = 0
    tries = 0
    while placed < CLEAR_CLOUDS and tries < 400000:
        tries += 1
        centre = rng.uniform(0, TILE, 2)
        here = groups[int(centre[1] / TEXEL) % N, int(centre[0] / TEXEL) % N]
        # Половина неба чистая: облака — только там, где поле облачности выше середины; редкие одиночки — где угодно.
        chance = 0.004 + np.clip((here - 0.56) / 0.26, 0.0, 1.0) ** 1.6
        if rng.uniform() > chance:
            continue
        # Размеры: много малых облаков, реже средние, изредка — крупное кучевое в середине группы.
        kind = rng.uniform()
        if kind < 0.07 and chance > 0.5 and large < CLEAR_LARGE:
            radius = rng.uniform(1300.0, 2600.0)
            depth = rng.uniform(1200.0, 2100.0)
            large += 1
        elif kind < 0.4:
            radius = rng.uniform(550.0, 1100.0)
            depth = radius * rng.uniform(0.7, 1.3)
        else:
            radius = rng.uniform(220.0, 520.0)
            depth = radius * rng.uniform(0.6, 1.2)
        placed += 1
        cumulus(cover, top, warp_x, warp_y, rng, centre, radius, min(depth, CLEAR_DEPTH * 0.98))
    # Слоисто-кучевое поле: широкое пятно низких плоских облаков — то сомкнутых, то с просветами.
    for _ in range(CLEAR_SHEETS):
        centre = rng.uniform(0, TILE, 2)
        span = rng.uniform(4500.0, 8000.0)
        sheet = np.zeros((N, N))
        stamp(sheet, warp_x * 6.0, warp_y * 6.0, centre, span, 1.0, 0.6)
        cells = to_unit(spectral(rng, (N, N), 9, 70, 0.6), 1.3)
        sheet_cover = np.clip((cells - 0.42) / 0.3, 0.0, 1.0) * np.clip(sheet * 1.6, 0.0, 1.0)
        cover = np.maximum(cover, sheet_cover * 0.85)
        top = np.maximum(top, (sheet_cover > 0.02) * rng.uniform(380.0, 520.0) * (0.8 + 0.4 * cells))
    cover = gaussian_filter(cover, 0.7, mode="wrap")
    top = gaussian_filter(top, 1.2, mode="wrap")
    return np.clip(cover, 0.0, 1.0), top / CLEAR_DEPTH, placed, large


def storm_field(rng):
    """Шторм: сплошной слой туч разной толщины и грозовые башни — крупные образования, а не ровная пелена."""
    deck = 0.31 + 0.08 * spectral(rng, (N, N), 130, 520) + 0.075 * spectral(rng, (N, N), 28, 110)
    # Валы: гряды туч в несколько километров шириной, между ними слой тоньше — свет пробивается.
    rolls = spectral(rng, (N, N), 45, 90)
    deck += 0.06 * np.sign(rolls) * np.abs(rolls) ** 0.6
    deck = np.clip(deck, 0.07, 0.66) * STORM_DEPTH
    warp_x = spectral(rng, (N, N), 12, 120) * 380.0
    warp_y = spectral(rng, (N, N), 12, 120) * 380.0
    towers = np.zeros((N, N))
    placed = []
    while len(placed) < STORM_TOWERS:
        centre = rng.uniform(0, TILE, 2)
        radius = rng.uniform(3200.0, 7200.0)
        offsets = [(np.array(c) - centre + TILE / 2) % TILE - TILE / 2 for c, _ in placed]
        if any(np.hypot(*o) < (radius + r) * 0.8 for o, (_, r) in zip(offsets, placed)):
            continue
        placed.append((centre, radius))
        cloud(towers, warp_x, warp_y, rng, centre, radius, STORM_DEPTH * rng.uniform(0.78, 1.0), 0.7)
    field = np.maximum(deck, towers) + 60.0 * spectral(rng, (N, N), 4, 24)
    field = gaussian_filter(np.clip(field, 0.0, STORM_DEPTH), 1.0, mode="wrap") / STORM_DEPTH
    rain = np.clip((field - 0.33) / 0.3, 0.0, 1.0)
    rain = gaussian_filter(rain * rain * (3.0 - 2.0 * rain), 3.0, mode="wrap")
    rain *= 0.75 + 0.25 * to_unit(spectral(rng, (N, N), 8, 60))
    return field, rain


def volume_noise(rng, size=64):
    """Объёмный бесшовный шум «клубами»: ячеистый (по расстоянию до ближайших точек) пополам с плавным."""
    grid = (np.stack(np.meshgrid(*[np.arange(size)] * 3, indexing="ij"), -1).reshape(-1, 3) + 0.5) / size
    billow = np.zeros(size ** 3)
    weight = 0.0
    for cells, share in ((4, 0.55), (8, 0.3), (16, 0.15)):
        points = (np.stack(np.meshgrid(*[np.arange(cells)] * 3, indexing="ij"), -1).reshape(-1, 3)
                  + rng.uniform(0.1, 0.9, (cells ** 3, 3))) / cells
        distance, _ = cKDTree(points, boxsize=1.0).query(grid)
        billow += share * (1.0 - np.clip(distance * cells / 0.9, 0.0, 1.0))
        weight += share
    billow = (billow / weight).reshape(size, size, size)
    smooth = to_unit(spectral(rng, (size, size, size), 3, 32, 1.4))
    noise = 0.6 * billow + 0.4 * smooth
    noise = (noise - noise.min()) / (noise.max() - noise.min())
    return noise


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(1206)
    cover, top, count, large = clear_field(rng)
    storm, rain = storm_field(rng)
    picture = np.stack([cover, storm, rain, top], -1)
    Image.fromarray((np.clip(picture, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8), "RGBA").save(OUT / "cloud_map.png", optimize=True)
    noise = volume_noise(rng)
    size = noise.shape[0]
    atlas = np.zeros((8 * size, 8 * size))
    for index in range(size):
        atlas[(index // 8) * size:(index // 8 + 1) * size, (index % 8) * size:(index % 8 + 1) * size] = noise[index]
    Image.fromarray((atlas * 255.0 + 0.5).astype(np.uint8), "L").save(OUT / "cloud_noise.png", optimize=True)
    print(f"ясно: облаков {count} (крупных {large}), облачность над {float((cover > 0.3).mean()) * 100:.1f} % неба, "
          f"чистого неба {float((cover < 0.02).mean()) * 100:.0f} %, самое высокое {top.max() * CLEAR_DEPTH:.0f} м")
    print(f"шторм: толщина туч от {storm.min() * STORM_DEPTH:.0f} до {storm.max() * STORM_DEPTH:.0f} м, "
          f"средняя {storm.mean() * STORM_DEPTH:.0f} м; сильный дождь над {float((rain > 0.5).mean()) * 100:.0f} % площади")
    print(f"шум: среднее {noise.mean():.2f}")


if __name__ == "__main__":
    main()
