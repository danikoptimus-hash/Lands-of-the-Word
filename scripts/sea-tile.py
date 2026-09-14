"""Бесшовная плитка моря без заметной периодичности: из исходника apps/web/public/img/brand/sea.webp собирается
мозаика случайно повёрнутых и отражённых кусков с мягкими краями (у исходника волны лежат ровной ромбической
решёткой, и при замощении её видно), затем плитка делается бесшовной сдвигом на полплитки с перекрёстным
растворением швов. Пишет sea-1024.webp и sea-512.webp. Запуск из корня: python3 scripts/sea-tile.py (Pillow)."""
import random
from PIL import Image, ImageFilter, ImageEnhance

random.seed(7)
SRC = Image.open("apps/web/public/img/brand/sea.webp").convert("RGB")
S = SRC.width
N = 1024

def feather_mask(w, h, edge):
    m = Image.new("L", (w, h), 255)
    # мягкая рамка: линейное затухание к краям
    px = m.load()
    for y in range(h):
        for x in range(w):
            d = min(x, y, w - 1 - x, h - 1 - y)
            if d < edge: px[x, y] = int(255 * d / edge)
    return m

def patch():
    size = random.randint(380, 620)
    x = random.randint(0, S - size); y = random.randint(0, S - size)
    p = SRC.crop((x, y, x + size, y + size))
    if random.random() < 0.5: p = p.transpose(Image.FLIP_LEFT_RIGHT)
    if random.random() < 0.5: p = p.transpose(Image.FLIP_TOP_BOTTOM)
    # поворот на случайный угол: у исходника есть выделенное направление, его надо размыть
    p = p.rotate(random.uniform(0, 360), resample=Image.BICUBIC, expand=False)
    c = int(size * 0.68)  # центральная часть без чёрных углов от поворота
    o = (size - c) // 2
    p = p.crop((o, o, o + c, o + c))
    return p

# Холст в два раза больше плитки, чтобы куски перекрывали края; замощение по тору достигается позже.
W = N * 2
canvas = SRC.resize((W, W), Image.LANCZOS)  # подложка — растянутый исходник (полностью перекроется кусками)
for i in range(260):
    p = patch()
    m = feather_mask(p.width, p.height, int(p.width * 0.35))
    x = random.randint(-p.width // 2, W - p.width // 2); y = random.randint(-p.height // 2, W - p.height // 2)
    canvas.paste(p, (x, y), m)
tile = canvas.crop((N // 2, N // 2, N // 2 + N, N // 2 + N))

# Бесшовность: сдвиг на полплитки и растворение крестообразного шва широкой мягкой полосой.
def make_seamless(t, band):
    n = t.width
    shifted = Image.new("RGB", (n, n))
    shifted.paste(t.crop((n // 2, n // 2, n, n)), (0, 0)); shifted.paste(t.crop((0, n // 2, n // 2, n)), (n // 2, 0))
    shifted.paste(t.crop((n // 2, 0, n, n // 2)), (0, n // 2)); shifted.paste(t.crop((0, 0, n // 2, n // 2)), (n // 2, n // 2))
    # маска шва: 255 вдоль центральных линий, к краям полосы затухает
    m = Image.new("L", (n, n), 0); px = m.load()
    for y in range(n):
        for x in range(n):
            d = min(abs(x - n // 2), abs(y - n // 2))
            if d < band: px[x, y] = int(255 * (1 - d / band) ** 1.5)
    filler = t.rotate(90)  # чем закрываем шов: тот же материал, повёрнутый, чтобы не повторять сдвинутое
    return Image.composite(filler, shifted, m)

tile = make_seamless(tile, 150)
# Чуть мягче контраст бликов: именно светлые гребни складываются в заметную решётку.
tile = ImageEnhance.Contrast(tile).enhance(0.9)
tile.save("apps/web/public/img/brand/sea-1024.webp", "WEBP", quality=82, method=6)
tile.resize((512, 512), Image.LANCZOS).save("apps/web/public/img/brand/sea-512.webp", "WEBP", quality=82, method=6)
print("ok")
