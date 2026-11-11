"""Очертания малых островов для версии 2 — по тем же картинкам, что показывает сайт
(apps/web/public/img/islet/islet-N.png, остров — непрозрачная часть картинки).

Для каждой картинки считается поле расстояний до берега: в каждой точке квадрата — сколько до края острова
(внутри острова расстояние отрицательное). По такому полю форма земли строит берег, пляж и отмель той же
функцией, что и у главных островов, а силуэт острова совпадает с нарисованным на сайте.

Единица длины — половина стороны картинки (как `r` островка в packages/domain/src/islets.ts).
Поле покрывает квадрат [-EXTENT, EXTENT]², расстояния обрезаны до ±RANGE.

Запуск из корня репозитория (нужны Pillow и numpy): python v2/tools/islet-shapes.py
Результат — v2/data/islets.bin: «LOTWISL1», число островов (1 байт), сторона поля (2 байта), EXTENT и RANGE
(по 4 байта, float32), затем для каждого острова: номер картинки (1 байт) и сторона² значений uint16
(0 — расстояние −RANGE, 65535 — +RANGE), строками сверху вниз. При замене картинок на сайте — пересчитать.
"""
import struct
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SIZE = 160      # сторона поля расстояний, точек
EXTENT = 1.3    # поле шире картинки: вокруг острова нужна отмель
RANGE = 0.6
MASK = 640      # сторона маски, по которой ищется берег

Image.MAX_IMAGE_PIXELS = None
chunks = []
for number in range(1, 8):
    picture = Image.open(ROOT / "apps/web/public/img/islet" / f"islet-{number}.png").convert("RGBA")
    alpha = picture.getchannel("A").resize((MASK, MASK), Image.LANCZOS)
    land = np.asarray(alpha, dtype=np.float32) > 96.0   # тот же порог, что в scripts/islet-shapes.py
    # Точки берега: суша, у которой есть сосед-море (и край картинки, если остров в него упирается).
    padded = np.pad(land, 1, constant_values=False)
    sea_near = ~padded[:-2, 1:-1] | ~padded[2:, 1:-1] | ~padded[1:-1, :-2] | ~padded[1:-1, 2:]
    edge_rows, edge_cols = np.nonzero(land & sea_near)
    # Центры точек маски в единицах половины стороны картинки: x вправо (восток), y вниз (юг).
    edge_x = (edge_cols + 0.5) / MASK * 2.0 - 1.0
    edge_y = (edge_rows + 0.5) / MASK * 2.0 - 1.0
    axis = (np.arange(SIZE) + 0.5) / SIZE * 2.0 * EXTENT - EXTENT
    field = np.empty((SIZE, SIZE), dtype=np.float32)
    for row in range(SIZE):
        dx = axis[None, :] - edge_x[:, None]
        dy = axis[row] - edge_y[:, None]
        field[row] = np.sqrt((dx * dx + dy * dy).min(axis=0))
    # Знак: внутри острова расстояние отрицательное.
    cols = np.clip(((axis + 1.0) * 0.5 * MASK).astype(int), 0, MASK - 1)
    inside_square = (np.abs(axis)[None, :] < 1.0) & (np.abs(axis)[:, None] < 1.0)
    inside = land[np.ix_(cols, cols)] & inside_square
    field = np.where(inside, -field, field)
    packed = np.round((np.clip(field, -RANGE, RANGE) / RANGE * 0.5 + 0.5) * 65535.0).astype("<u2")
    chunks.append(struct.pack("<B", number) + packed.tobytes())
    print(f"остров {number}: картинка {picture.size[0]}×{picture.size[1]}, суши {land.mean() * 100:.0f} % квадрата, "
          f"точек берега {len(edge_x)}, самая глубина суши {-field.min():.2f}")

out = ROOT / "v2/data/islets.bin"
out.write_bytes(b"LOTWISL1" + struct.pack("<BHff", len(chunks), SIZE, EXTENT, RANGE) + b"".join(chunks))
print("записано", out, out.stat().st_size, "байт")
