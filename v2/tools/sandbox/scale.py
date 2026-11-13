# Аудит масштаба мира числами (задание владельца 13.11): фактические размеры в метрах по той же функции высот,
# что в игре. Ничего не меняет — только меряет: острова (длина, ширина, площадь, берег), гексы, расстояния между
# перекрёстками и городами, горы (высота, ширина основания), ровная земля под города, сколько деревьев настоящего
# размера помещается в гекс. Запуск: WORLD=путь/к/миру.json python scale.py [шаг сетки, м; по умолчанию 4]
import math, os, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent))
import height as H
from base import hex_center, S, A

world = H.World(os.environ.get('WORLD') or str(Path(__file__).parents[2] / 'data' / 'world_osen.json'))
step = float(sys.argv[1]) if len(sys.argv) > 1 else 4.0
w = world.w

print('== Гекс ==')
print('от центра до угла %.0f м; между противоположными углами %.0f м; между противоположными сторонами %.1f м' % (S, 2 * S, 2 * A))
print('между центрами соседних гексов %.1f м; сторона гекса (дорога между соседними перекрёстками) %.0f м' % (2 * A, S))
hex_area = 3 * math.sqrt(3) / 2 * S * S
print('площадь гекса %.0f м² = %.2f га' % (hex_area, hex_area / 1e4))

def node_position(key):
    q, r = map(int, key[2:].split(','))
    cx, cz = hex_center(q, r)
    return (cx, cz - S) if key[0] == 'N' else (cx, cz + S)

islands = sorted({h[3] for h in w['hexes']})
rows = []
for island in islands:
    cells = [h for h in w['hexes'] if h[3] == island]
    cxs = np.array([hex_center(h[0], h[1])[0] for h in cells]); czs = np.array([hex_center(h[0], h[1])[1] for h in cells])
    x0, x1, z0, z1 = cxs.min() - 2 * S, cxs.max() + 2 * S, czs.min() - 2 * S, czs.max() + 2 * S
    xs = np.arange(x0, x1, step, dtype=np.float32); zs = np.arange(z0, z1, step, dtype=np.float32)
    gx, gz = np.meshgrid(xs, zs)
    h = np.asarray(world.height(gx, gz))
    # Суша этого острова: выше уреза и ближе к его гексам, чем к гексам другого острова.
    land = h > 0.0
    others = [c for c in w['hexes'] if c[3] != island]
    if others:
        d_own = np.full(gx.shape, 1e9, dtype=np.float32); d_other = np.full(gx.shape, 1e9, dtype=np.float32)
        for c in cells:
            cx, cz = hex_center(c[0], c[1]); d_own = np.minimum(d_own, (gx - cx) ** 2 + (gz - cz) ** 2)
        for c in others:
            cx, cz = hex_center(c[0], c[1]); d_other = np.minimum(d_other, (gx - cx) ** 2 + (gz - cz) ** 2)
        land &= d_own <= d_other
    area = land.sum() * step * step
    cols = np.nonzero(land.any(axis=0))[0]; lines = np.nonzero(land.any(axis=1))[0]
    width = (cols.max() - cols.min() + 1) * step; length = (lines.max() - lines.min() + 1) * step
    gy, gxx = np.gradient(h, step)
    slope = np.degrees(np.arctan(np.hypot(gxx, gy)))
    flat = (land & (slope < 6.0)).sum() * step * step
    nodes = [n for n in w['nodes'] if n[4] == island]
    cities = [n for n in nodes if n[1] == 'CITY']
    spots = np.array([node_position(n[0]) for n in cities])
    nearest = []
    for i in range(len(spots)):
        d = np.hypot(spots[:, 0] - spots[i, 0], spots[:, 1] - spots[i, 1]); d[i] = 1e9
        nearest.append(d.min())
    nearest = np.array(nearest)
    print('\n== Остров %s ==' % island)
    print('гексов %d; с запада на восток %.0f м, с севера на юг %.0f м; площадь суши %.2f км² (по гексам %.2f км²)' % (
        len(cells), width, length, area / 1e6, len(cells) * hex_area / 1e6))
    print('высоты: наибольшая %.1f м, средняя по суше %.1f м; выше 40 м — %.1f %% суши, выше 80 м — %.1f %%' % (
        h[land].max(), h[land].mean(), 100.0 * (land & (h > 40)).sum() / land.sum(), 100.0 * (land & (h > 80)).sum() / land.sum()))
    print('уклон суши: средний %.1f°; ровной земли (до 6°) %.2f км² — %.0f %% суши' % (slope[land].mean(), flat / 1e6, 100.0 * flat / area))
    print('перекрёстков %d, из них городов %d (типы: %s)' % (len(nodes), len(cities),
        ', '.join('%s %d' % (t, sum(1 for c in cities if c[2] == t)) for t in sorted({c[2] for c in cities}))))
    print('суши на один город %.1f га; на один перекрёсток %.1f га' % (area / 1e4 / max(len(cities), 1), area / 1e4 / len(nodes)))
    print('от города до ближайшего города: от %.0f до %.0f м, чаще всего %.0f м' % (nearest.min(), nearest.max(), np.median(nearest)))
    # Горы: вершины — точки выше всех в круге 60 м и выше 45 м; ширина — поперечник пятна «выше половины высоты вершины».
    from scipy import ndimage
    size = int(120 / step) | 1
    peaks = np.argwhere((h == ndimage.maximum_filter(h, size=size)) & (h > 45.0) & land)
    report = []
    for py, px in peaks:
        top = h[py, px]
        blob, _ = ndimage.label(h > top * 0.5)
        mask = blob == blob[py, px]
        report.append((top, 2.0 * math.sqrt(mask.sum() * step * step / math.pi)))
    report.sort(reverse=True)
    if report:
        print('вершин выше 45 м: %d; высоты от %.0f до %.0f м, средняя %.0f м; поперечник горы на половине высоты: от %.0f до %.0f м, средний %.0f м' % (
            len(report), report[-1][0], report[0][0], np.mean([r[0] for r in report]), min(r[1] for r in report), max(r[1] for r in report),
            np.mean([r[1] for r in report])))
    rows.append((island, area, len(cities), len(nodes)))

print('\n== Что помещается в гекс (%.2f га) ==' % (hex_area / 1e4))
for title, crown, share in (('дуб, крона 9 м', 9.0, 0.7), ('олива, крона 6 м', 6.0, 0.5), ('сосна-пиния, крона 8 м', 8.0, 0.6)):
    print('%s: при сомкнутости %.0f %% — %.0f деревьев' % (title, share * 100, hex_area * share / (math.pi * crown * crown / 4)))
for title, diameter in (('вешка города сейчас (поперечник 44 м)', 44.0), ('деревня в 30 домов (поперечник 120 м)', 120.0),
                        ('малый город со стеной, 3 га (поперечник 200 м)', 200.0), ('город в 6 га (поперечник 280 м)', 280.0)):
    area = math.pi * diameter * diameter / 4
    print('%s: %.2f га — %.0f %% гекса; до соседнего перекрёстка %.0f м между краями' % (title, area / 1e4, 100.0 * area / hex_area, S - diameter))
