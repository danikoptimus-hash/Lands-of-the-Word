"""Малые острова версии 2: лепит все острова каталога (designs.py) и пишет v2/data/islets.bin.

Запуск из корня репозитория (нужны numpy, scipy, numba и Pillow):
    python v2/tools/islets/make.py               — все острова, файл для игры
    python v2/tools/islets/make.py --views ПАПКА — то же и картинки для просмотра (вид сверху и под углом)
    python v2/tools/islets/make.py --only 3,7    — только эти острова (для подбора формы; файл не пишется)

Файл (сжат gzip): «LOTWISL2», число островов (1 байт), сторона поля (2 байта), EXTENT, пределы высоты HMIN и HMAX,
предел расстояния SD (float32). Затем для каждого острова заголовок из 11 чисел float32 после номера (1 байт):
опорная половина стороны R; ширина отмели (м при R); уровень воды озера (м при R, −999 — озера нет); центр озера
u, v и его радиус (в половинах стороны); досягаемость суши (дальше этого расстояния от центра суши нет); вершина
u, v и её высота (м при R) — по ней игра проверяет, что остров встал на место; запас (0).
Следом поля сторона×сторона, строками с севера на юг, байтами для текстур игры:
  4 байта на точку — высота (uint16 от HMIN до HMAX, старший байт первым) и расстояние до берега в половинах
  стороны (uint16 от −SD до SD, на суше меньше нуля, старший байт первым);
  2 байта на точку — «камень» (на суше скалы и крутые склоны, в море — крутизна ближайшего берега, 0–255)
  и озеро (255 — здесь вода озера, с запасом под берегом).
"""
import argparse
import gzip
import struct
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import designs  # noqa: E402
from relief import EXTENT, N, NO_WATER, fields  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
HMIN, HMAX = -30.0, 330.0
SD = 1.6


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--views", default="")
    parser.add_argument("--only", default="")
    args = parser.parse_args()
    only = {int(v) for v in args.only.split(",") if v}
    chunks = []
    for item in designs.DESIGNS:
        if only and item["id"] not in only:
            continue
        started = time.time()
        s = item["make"]()
        H, water, level = designs.build(s)
        height, sd, stone, water = fields(H, s["dx"], s["R"], s["hard"], water, s.get("rocky_sea", 0.0))
        land = sd < 0.0
        print(f"{item['id']:2d} {item['title']:<18} R={s['R']:.0f} м  высота до {H.max():.0f} м  суша {land.mean() * 100:.0f}%"
              f"  озеро {'нет' if level is None else f'{level:.1f} м'}  {time.time() - started:.1f} с")
        if height.min() < HMIN or height.max() > HMAX or np.abs(sd).max() > SD * 1.5:
            print("   значения вне пределов файла — будут обрезаны", file=sys.stderr)
        if args.views:
            import views
            Path(args.views).mkdir(parents=True, exist_ok=True)
            views.sheet(np.where(land, height, np.minimum(height, -0.5)), s["dx"], str(Path(args.views) / f"{item['id']:02d}.jpg"),
                        np.where(water > -900, water, NO_WATER), item["title"])
        q = lambda v, lo, hi: np.round((np.clip(v, lo, hi) - lo) / (hi - lo) * 65535.0).astype(np.uint32)
        axis = (np.arange(N) + 0.5) / N * 2.0 * EXTENT - EXTENT
        u, v = np.meshgrid(axis, axis)
        reach = float(np.hypot(u, v)[land].max())
        shown = height
        if item["id"] == designs.QUARRY:
            # карьер игра врезает сама (функция высот), но вершину проверяет по рельефу уже с карьером
            from relief import quarry_cut
            shown = quarry_cut(u, v, height)
        top = np.unravel_index(np.argmax(np.where(land, shown, -1e9)), height.shape)
        lake_u = lake_v = lake_r = 0.0
        if level is not None:
            wet = water > -900
            lake_u, lake_v = float(u[wet].mean()), float(v[wet].mean())
            lake_r = float(np.hypot(u[wet] - lake_u, v[wet] - lake_v).max())
        chunks.append(struct.pack("<B11f", item["id"], s["R"], item["shelf"], NO_WATER if level is None else level,
                                  lake_u, lake_v, lake_r, reach, float(u[top]), float(v[top]), float(shown[top]), 0.0))
        hq = q(height, HMIN, HMAX)
        sq = q(sd, -SD, SD)
        pairs = np.stack([hq >> 8, hq & 255, sq >> 8, sq & 255], axis=-1).astype(np.uint8)
        chunks.append(pairs.tobytes())
        marks = np.stack([np.round(np.clip(stone, 0, 1) * 255), np.where(water > -900, 255, 0)], axis=-1).astype(np.uint8)
        chunks.append(marks.tobytes())
    if only:
        return
    data = b"LOTWISL2" + struct.pack("<BHffff", len(designs.DESIGNS), N, EXTENT, HMIN, HMAX, SD) + b"".join(chunks)
    path = ROOT / "v2" / "data" / "islets.bin"
    path.write_bytes(gzip.compress(data, 9, mtime=0))
    print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1e6:.1f} МБ (без сжатия {len(data) / 1e6:.1f} МБ)")


if __name__ == "__main__":
    main()
