"""Карта облаков и шум облаков для погоды (шаг 1.6 «Атмосфера и погода»).

Запуск из корня репозитория (numpy, scipy и Pillow есть в scratchpad/gdvenv):
    python v2/tools/weather/make.py

Пишет в v2/assets/weather/:
  cloud_map.png   — карта облаков 1024×1024, плитка 48 км (47 м на точку), бесшовная. Каналы:
                    R — ясная погода: толщина отдельных кучевых облаков (1 — 2200 м);
                    G — шторм: сплошные тучи с крупными грозовыми башнями (1 — 3400 м);
                    B — где в шторм льёт сильнее всего (под башнями).
  cloud_noise.png — объёмный шум 64×64×64 (8×8 срезов), бесшовный: им «обгрызаются» края облаков.

Облака ясной погоды — не шум, а отдельные облака: у каждого свой размер, вытянутость, число «клубов» и высота;
лежат они неравномерно — группами, между которыми большие чистые участки неба. Числа — в начале файла.
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
CLEAR_CLOUDS = 100  # сколько облаков на плитке в ясную погоду (2300 км²)
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
    """Одно облако: несколько клубов вдоль своей оси; середина выше краёв."""
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
    # Башенки: узкие высокие клубы ближе к середине — верх облака неровный.
    for _ in range(int(rng.integers(1, 4))):
        offset = axis * rng.uniform(-0.4, 0.4) * radius * stretch + side * rng.uniform(-0.3, 0.3) * radius / stretch
        stamp(target, warp_x, warp_y, centre + offset, radius * rng.uniform(0.24, 0.4), depth * rng.uniform(0.95, 1.14), power)


def clear_field(rng):
    """Ясная погода: редкие отдельные кучевые облака, группами."""
    groups = to_unit(spectral(rng, (N, N), 180, 520), 1.6)  # где облака собираются в группы (волны 8–24 км)
    warp_x = spectral(rng, (N, N), 5, 44) * 130.0
    warp_y = spectral(rng, (N, N), 5, 44) * 130.0
    field = np.zeros((N, N))
    placed = []
    tries = 0
    while len(placed) < CLEAR_CLOUDS and tries < 200000:
        tries += 1
        centre = rng.uniform(0, TILE, 2)
        here = groups[int(centre[1] / TEXEL) % N, int(centre[0] / TEXEL) % N]
        chance = 0.015 + np.clip((here - 0.54) / 0.3, 0.0, 1.0) ** 1.5
        if rng.uniform() > chance:
            continue
        radius = float(np.clip(rng.lognormal(np.log(430.0 + 380.0 * (chance - 0.015)), 0.45), 230.0, 1500.0))
        offsets = [(np.array(c) - centre + TILE / 2) % TILE - TILE / 2 for c, _ in placed]
        if any(np.hypot(*o) < (radius + r) * 1.15 for o, (_, r) in zip(offsets, placed)):
            continue
        placed.append((centre, radius))
        depth = min(2.0 * radius * rng.uniform(0.42, 0.7), 1700.0)
        cloud(field, warp_x, warp_y, rng, centre, radius, depth, 0.55)
    field *= 0.88 + 0.12 * to_unit(spectral(rng, (N, N), 5, 30))
    return gaussian_filter(field, 0.6, mode="wrap") / CLEAR_DEPTH, len(placed)


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
    clear, count = clear_field(rng)
    storm, rain = storm_field(rng)
    picture = np.stack([clear, storm, rain], -1)
    Image.fromarray((np.clip(picture, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8), "RGB").save(OUT / "cloud_map.png", optimize=True)
    noise = volume_noise(rng)
    size = noise.shape[0]
    atlas = np.zeros((8 * size, 8 * size))
    for index in range(size):
        atlas[(index // 8) * size:(index // 8 + 1) * size, (index % 8) * size:(index % 8 + 1) * size] = noise[index]
    Image.fromarray((atlas * 255.0 + 0.5).astype(np.uint8), "L").save(OUT / "cloud_noise.png", optimize=True)
    cover = float((clear > 60.0 / CLEAR_DEPTH).mean())
    print(f"ясно: облаков {count}, под облаками {cover * 100:.1f} % неба, самое толстое {clear.max() * CLEAR_DEPTH:.0f} м")
    print(f"шторм: толщина туч от {storm.min() * STORM_DEPTH:.0f} до {storm.max() * STORM_DEPTH:.0f} м, "
          f"средняя {storm.mean() * STORM_DEPTH:.0f} м; сильный дождь над {float((rain > 0.5).mean()) * 100:.0f} % площади")
    print(f"шум: среднее {noise.mean():.2f}")


if __name__ == "__main__":
    main()
