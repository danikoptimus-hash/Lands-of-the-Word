# Проверка формы земли на карте числами — без картинок. Ищет то, что глаз назвал бы браком:
#   • разрывы высоты (ступенька на ровном месте — шов между гексами или областями);
#   • море посреди суши (земля ниже уровня моря вдали от берега);
#   • города, порты и точки старта не на суше или не на ровной площадке;
#   • перекрёсток под водой озера или моря;
#   • малый остров, которого не видно над водой;
#   • мелкая вода на границе запечённой области с открытым морем (там вода областей должна быть уже непрозрачной,
#     иначе граница видна): нужно не меньше 4 м глубины — см. water_clay.gdshader и world_terrain.gd.
# Запуск: WORLD=путь/к/миру.json python check.py [сколько точек, по умолчанию 200000]
import os, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent))
import height as H
from base import hex_center

world = H.World(os.environ.get('WORLD') or str(Path(__file__).parents[2] / 'data' / 'world_osen.json'))
count = int(sys.argv[1]) if len(sys.argv) > 1 else 200000
rng = np.random.default_rng(7)
cx = np.array([hex_center(h[0], h[1])[0] for h in world.w['hexes']]); cz = np.array([hex_center(h[0], h[1])[1] for h in world.w['hexes']])

# 1. Разрывы. Берём случайные точки у суши и три высоты на отрезке в 10 см: у гладкой земли средняя точка лежит
#    на прямой между крайними с точностью до миллиметров, у разрыва — нет.
pick = rng.integers(0, len(cx), count)
px = (cx[pick] + rng.uniform(-260.0, 260.0, count)).astype(np.float64); pz = (cz[pick] + rng.uniform(-260.0, 260.0, count)).astype(np.float64)
# Треть точек — у малых островов и над дном вокруг них.
if world.islets:
    third = count // 3
    which = rng.integers(0, len(world.islets), third)
    ix = np.array([i[0] for i in world.islets]); iz = np.array([i[1] for i in world.islets]); ir = np.array([i[2] for i in world.islets])
    px[:third] = ix[which] + rng.uniform(-1.0, 1.0, third) * (1.3 * ir[which] + 500.0); pz[:third] = iz[which] + rng.uniform(-1.0, 1.0, third) * (1.3 * ir[which] + 500.0)
ang = rng.uniform(0.0, 2.0 * np.pi, count); dx = np.cos(ang) * 0.05; dz = np.sin(ang) * 0.05
row = lambda a: np.asarray(a, dtype=np.float32)[None, :]
h0 = world.height(row(px - dx), row(pz - dz))[0]; h1 = world.height(row(px), row(pz))[0]; h2 = world.height(row(px + dx), row(pz + dz))[0]
bend = np.abs(h0 - 2.0 * h1 + h2); step = np.maximum(np.abs(h1 - h0), np.abs(h2 - h1))
summit = (h1 > h0) & (h1 > h2)   # острая вершина горы — излом, но не шов
bad = np.nonzero(((bend > 0.12) & ~summit) | (step > 0.6))[0]
print('точек', count, '; наибольший излом на 10 см: %.3f м (острых вершин среди изломов: %d); наибольший перепад на 5 см: %.3f м' % (bend.max(), int(((bend > 0.12) & summit).sum()), step.max()))
print('разрывов:', len(bad))
for i in bad[:12]: print('   x=%.1f z=%.1f высоты %.2f %.2f %.2f' % (px[i], pz[i], h0[i], h1[i], h2[i]))

# 2. Море посреди суши: точки, где и свой гекс, и все соседние — суша, а земля ниже 0,3 м и озера нет.
from base import hex_at
q, r = hex_at(row(px), row(pz)); inner = world.terrain_at(q, r) != 0
for dq, dr in H.SIDES: inner &= world.terrain_at(q + dq, r + dr) != 0
hh, ll = world.height(row(px), row(pz), True)
puddle = inner & (hh < 0.3) & (ll < -900)
print('вдали от берега точек', int(inner.sum()), '; самая низкая земля там: %.2f м; ниже моря без озера:' % hh[inner].min(), int(puddle.sum()))

# 3. Перекрёстки.
xs = []; zs = []; kinds = []; keys = []
for key, kind, city, book, isl, coastal in world.w['nodes']:
    q, r = map(int, key[2:].split(','))
    x, z = hex_center(q, r); z += -H.S if key[0] == 'N' else H.S
    xs.append(x); zs.append(z); keys.append(key); kinds.append('развилка' if kind == 'EMPTY' else 'старт' if kind == 'START' else 'порт' if city == 'port' else 'город')
xs = np.array(xs); zs = np.array(zs)
h, lv = world.height(row(xs), row(zs), True); h = h[0]; lv = lv[0]
wet = (h < 0.3) | ((lv > -900) & (h < lv + 0.3))
print('перекрёстков', len(keys), '; самый низкий: %.2f м (%s %s)' % (h.min(), kinds[int(h.argmin())], keys[int(h.argmin())]), '; в воде:', int(wet.sum()))
for i in np.nonzero(wet)[0][:12]: print('   ', kinds[i], keys[i], 'высота %.2f, уровень воды %.1f' % (h[i], lv[i]))
# Площадка: у города, порта и старта в 12 м вокруг высота та же.
pads = [i for i, k in enumerate(kinds) if k != 'развилка']
worst = 0.0; where = ''
for a in np.linspace(0.0, 2.0 * np.pi, 8, endpoint=False):
    hh = world.height(row(xs[pads] + 12.0 * np.cos(a)), row(zs[pads] + 12.0 * np.sin(a)))[0]
    d = np.abs(hh - h[pads]); j = int(d.argmax())
    if d[j] > worst: worst = float(d[j]); where = '%s %s' % (kinds[pads[j]], keys[pads[j]])
print('площадок', len(pads), '; наибольший перепад на площадке: %.2f м' % worst, where)

# 4. Малые острова: у каждого есть суша над водой, а у края его квадрата — море.
for number, (ix, iz, ir, img, cover, quarry) in enumerate(world.islets):
    gx, gz = np.meshgrid(np.linspace(ix - ir, ix + ir, 41, dtype=np.float32), np.linspace(iz - ir, iz + ir, 41, dtype=np.float32))
    top = float(world.height(gx, gz).max())
    sea = float(world.height(row(np.array([ix + 1.05 * ir + 180.0])), row(np.array([iz])))[0, 0])
    note = '' if top > 1.5 and sea < 0.0 else '  ← НЕ ТАК'
    print('остров %d (картинка %d%s): вершина %.1f м, море рядом %.1f м%s' % (number, img, ', Каменоломня' if quarry else '', top, sea, note))

# 5. Границы запечённых областей с открытым морем (как в world_terrain.gd: главная область — острова с запасом 520 м,
#    у каждого малого острова — своя, с запасом 260 м; края по сетке плиток 256 м).
import math
CHUNK = 256.0
def snap(x0, z0, x1, z1):
    return (math.floor(x0 / CHUNK) * CHUNK, math.floor(z0 / CHUNK) * CHUNK, math.ceil(x1 / CHUNK) * CHUNK, math.ceil(z1 / CHUNK) * CHUNK)
areas = [snap(cx.min() - 86.60254 - 520.0, cz.min() - 100.0 - 520.0, cx.max() + 86.60254 + 520.0, cz.max() + 100.0 + 520.0)]
for ix, iz, ir, *_ in world.islets:
    a = snap(ix - 1.05 * ir - 260.0, iz - 1.05 * ir - 260.0, ix + 1.05 * ir + 260.0, iz + 1.05 * ir + 260.0)
    m = areas[0]
    if not (a[0] >= m[0] and a[1] >= m[1] and a[2] <= m[2] and a[3] <= m[3]):
        areas.append(a)
shallowest = 1e9
for index, (x0, z0, x1, z1) in enumerate(areas):
    t = np.linspace(0.0, 1.0, 600)
    bx = np.concatenate([x0 + (x1 - x0) * t, x0 + (x1 - x0) * t, np.full(600, x0), np.full(600, x1)])
    bz = np.concatenate([np.full(600, z0), np.full(600, z1), z0 + (z1 - z0) * t, z0 + (z1 - z0) * t])
    # Точка границы, лежащая внутри другой области, граничит не с открытым морем.
    outside = np.ones(bx.shape, dtype=bool)
    for other, (o0, p0, o1, p1) in enumerate(areas):
        if other != index:
            outside &= ~((bx > o0 + 1.0) & (bx < o1 - 1.0) & (bz > p0 + 1.0) & (bz < p1 - 1.0))
    if outside.any():
        depth = -world.height(row(bx[outside]), row(bz[outside]))[0]
        shallowest = min(shallowest, float(depth.min()))
note = '' if shallowest >= 4.0 else '  ← МЕЛКО: граница области будет видна'
print('областей %d; самая малая глубина на границе с открытым морем: %.1f м%s' % (len(areas), shallowest, note))
