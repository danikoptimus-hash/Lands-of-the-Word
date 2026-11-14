"""Есть ли в кадре моря повтор рисунка (плитка текстуры).

Считает автокорреляцию яркости кадра (после вычитания плавного фона) и печатает самый сильный пик вне середины
и его сдвиг в точках экрана. Плитка текстуры даёт пик на сдвиге, равном её размеру на экране; у воды без повтора
остаётся только ближний след самих волн. На тесте 0.7.2 (плитка ряби 25 м) пик был 0,18–0,24 на сдвиге в 25 м,
после 0.7.3 — 0,08–0,10 без выделенного сдвига.

Кадры — открытое море без суши, например:
    v2/tools/godot-local.sh shots ПАПКА --stops=99 "--view=1000,-2600,900,0,30" "--view=1000,-2600,2000,0,30"
    python v2/tools/water_repeat.py ПАПКА/mesto-01.png ПАПКА/mesto-02.png
Нужны numpy и Pillow.
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

# Середина кадра 1600×900 без надписей по краям.
BOX = (250, 140, 1350, 760)


def analyse(path):
    picture = Image.open(path).convert("L").crop(BOX)
    values = np.asarray(picture, dtype=np.float64)
    background = np.asarray(picture.filter(ImageFilter.GaussianBlur(24)), dtype=np.float64)
    detail = values - background
    detail -= detail.mean()
    detail *= np.outer(np.hanning(detail.shape[0]), np.hanning(detail.shape[1]))
    spectrum = np.fft.rfft2(detail)
    correlation = np.fft.fftshift(np.fft.irfft2(np.abs(spectrum) ** 2, s=detail.shape))
    correlation /= correlation.max()
    centre_y, centre_x = correlation.shape[0] // 2, correlation.shape[1] // 2
    y, x = np.mgrid[0:correlation.shape[0], 0:correlation.shape[1]]
    # Ближе 14 точек — сами волны; дальше трети кадра — слишком мало общего поля.
    wanted = (np.hypot(y - centre_y, x - centre_x) > 14) \
        & (np.abs(y - centre_y) < correlation.shape[0] * 0.35) & (np.abs(x - centre_x) < correlation.shape[1] * 0.35)
    masked = np.where(wanted, correlation, -1.0)
    at = np.unravel_index(np.argmax(masked), correlation.shape)
    return float(masked.max()), (int(at[1] - centre_x), int(at[0] - centre_y))


if __name__ == "__main__":
    for path in sys.argv[1:]:
        peak, shift = analyse(path)
        print("%-32s пик повтора %.2f при сдвиге %s точек" % (path.split("/")[-1], peak, shift))
