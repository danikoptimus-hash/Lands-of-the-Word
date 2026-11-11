# Картинка рельефа из песочницы: вид сверху со светом, тенями и водой.
# Запуск: python preview.py [метров на точку] [файл.png] [x0 x1 z0 z1] [--nogrid]
# Другая карта: WORLD=путь/к/миру.json (по умолчанию — «Осень»). Без границ берутся главные острова с запасом моря;
# --world — весь мир с малыми островами; --isl=N — малый остров номер N (с нуля, по порядку в снимке мира).
import os, sys, time, math
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent))
import height as H
from base import hex_at, hex_center, sd_hex

world = H.World(os.environ.get('WORLD') or str(Path(__file__).parents[2] / 'data' / 'world_osen.json'))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
texel = float(args[0]) if len(args) > 0 else 4.0
out = args[1] if len(args) > 1 else 'preview.png'
if len(args) > 5:
    x0, x1, z0, z1 = map(float, args[2:6])
else:
    cx = [hex_center(h[0], h[1])[0] for h in world.w['hexes']]; cz = [hex_center(h[0], h[1])[1] for h in world.w['hexes']]
    x0, x1, z0, z1 = min(cx) - 420.0, max(cx) + 420.0, min(cz) - 420.0, max(cz) + 420.0
    if '--world' in sys.argv:
        for ix, iz, ir, *_ in world.islets:
            x0 = min(x0, ix - 1.1 * ir - 500.0); x1 = max(x1, ix + 1.1 * ir + 500.0); z0 = min(z0, iz - 1.1 * ir - 500.0); z1 = max(z1, iz + 1.1 * ir + 500.0)
    for a in sys.argv:
        if a.startswith('--isl='):
            ix, iz, ir, *_ = world.islets[int(a[6:])]
            x0, x1, z0, z1 = ix - 1.15 * ir, ix + 1.15 * ir, iz - 1.15 * ir, iz + 1.15 * ir
xs = np.arange(x0 + texel / 2, x1, texel, dtype=np.float32); zs = np.arange(z0 + texel / 2, z1, texel, dtype=np.float32)
px, py = np.meshgrid(xs, zs)
t = time.time(); h, level = world.height(px, py, True); print('высоты', h.shape, round(time.time() - t, 1), 'с', 'мин', float(h.min()), 'макс', float(h.max()))
surf = np.maximum(h, np.where(level > -900, level, 0.0))   # поверхность с водой
gz, gx = np.gradient(h, texel)
n = np.stack([-gx, np.ones_like(h), -gz], axis=-1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
L = np.array([0.78, 0.58, -0.22]) * np.array([-1, 1, -1]); L = L / np.linalg.norm(L)   # к солнцу: с запада, чуть с юга
lam = np.clip((n * L).sum(-1), 0, 1)
# тени: идём от точки к солнцу и смотрим, не выше ли рельеф луча
shadow = np.zeros(h.shape, dtype=bool)
step = max(texel, 3.0); sx = L[0] / math.hypot(L[0], L[2]); sz = L[2] / math.hypot(L[0], L[2]); rise = L[1] / math.hypot(L[0], L[2])
ii, jj = np.meshgrid(np.arange(h.shape[0]), np.arange(h.shape[1]), indexing='ij')
for k in range(1, 70):
    d = k * step
    i2 = np.clip(np.round(ii + sz * d / texel).astype(int), 0, h.shape[0] - 1); j2 = np.clip(np.round(jj + sx * d / texel).astype(int), 0, h.shape[1] - 1)
    shadow |= h[i2, j2] > h + rise * d + 0.5
shade = 0.34 + 0.76 * lam * np.where(shadow, 0.25, 1.0)
clay = np.array([0.70, 0.65, 0.59])
# высота подкрашивает: низины чуть холоднее, плато теплее — только для чтения уровней в песочнице
tint = np.clip(h / 70.0, 0, 1)[..., None]
img = shade[..., None] * (clay[None, None, :] * (0.9 + 0.2 * tint))
water_level = np.where(level > -900, level, 0.0)
depth = np.clip(water_level - h, 0, None)
k = 1 - np.exp(-depth * 0.045)
water = np.array([0.40, 0.62, 0.64])[None, None, :] * (1 - k[..., None]) + np.array([0.08, 0.2, 0.3])[None, None, :] * k[..., None]
wet = (h < 0) | ((level > -900) & (h < level))
alpha = np.where(wet, (0.55 + 0.45 * (1 - np.exp(-depth * 0.25))) * np.clip(depth / 0.35, 0, 1), 0.0)[..., None]
img = img * (1 - alpha) + water * alpha
q, r = hex_at(px, py); cx, cy = hex_center(q, r)
edge = -sd_hex(px - cx, py - cy)
land = world.terrain_at(q, r) != 0
if '--nogrid' not in sys.argv:
    img = np.where(((edge < max(1.0, texel * 0.5)) & land)[..., None], img * 0.78, img)
# вешки перекрёстков: города и порты
for key, kind, city, book, isl, coastal in world.w['nodes']:
    if kind == 'EMPTY': continue
    qq, rr = map(int, key[2:].split(','))
    vx, vy = hex_center(qq, rr); vy += -H.S if key[0] == 'N' else H.S
    i = int((vy - z0) / texel); j = int((vx - x0) / texel); rad = max(2, int(7 / texel))
    if 0 <= i < h.shape[0] and 0 <= j < h.shape[1]:
        img[max(i - rad, 0):i + rad + 1, max(j - rad, 0):j + rad + 1] = (0.75, 0.3, 0.2) if city == 'port' else (0.55, 0.4, 0.3)
Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(out)
np.save(out.replace('.png', '.npy'), h)
print('сохранено', out)
