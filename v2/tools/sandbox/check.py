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
# Треть точек — у малых островов и над дном вокруг них, на всё расстояние, где остров влияет на дно
# (так ловится скачок глубины на краю этого расстояния — в 0.3.1 был такой круг вокруг песчаных банок).
# Ещё шестая часть — по всему морю вокруг мира.
if world.islets:
    third = count // 3
    which = rng.integers(0, len(world.islets), third)
    ix = np.array([i[0] for i in world.islets]); iz = np.array([i[1] for i in world.islets])
    ir = np.array([world.designs[i[3]]['reach'] * i[2] for i in world.islets])
    reach = ir[which] + 1300.0
    px[:third] = ix[which] + rng.uniform(-1.0, 1.0, third) * reach; pz[:third] = iz[which] + rng.uniform(-1.0, 1.0, third) * reach
    sixth = count // 6
    x0, z0, x1, z1 = world.content
    px[third:third + sixth] = rng.uniform(x0 - 2600.0, x1 + 2600.0, sixth); pz[third:third + sixth] = rng.uniform(z0 - 2600.0, z1 + 2600.0, sixth)
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

# 4. Малые острова: вершина над водой и где её поставил каталог, у края — море; озёра не переливаются.
for number, (ix, iz, ir, design, angle, mirror, quarry) in enumerate(world.islets):
    info = world.designs[design]; k = (ir / info['size']) ** 0.75; reach = info['reach'] * ir
    tu, tv, th = info['top']
    q = np.array([tu * mirror, tv]); c, s_ = np.cos(angle), np.sin(angle)
    tx = ix + (q[0] * c - q[1] * s_) * ir; tz = iz + (q[0] * s_ + q[1] * c) * ir
    top = float(world.height(row(np.array([tx])), row(np.array([tz])))[0, 0])
    sea = float(world.height(row(np.array([ix + 1.05 * reach + 180.0])), row(np.array([iz])))[0, 0])
    gx, gz = np.meshgrid(np.linspace(ix - reach, ix + reach, 81, dtype=np.float32), np.linspace(iz - reach, iz + reach, 81, dtype=np.float32))
    hh, lv = world.height(gx, gz, True)
    lake = lv > -900
    spill = int((lake & (hh < lv - 0.05) & (np.hypot(gx - ix, gz - iz) > 0) & (world.height(gx, gz) < 0.0)).sum())
    ok = top > 1.5 and abs(top - th * k) < 3.0 + th * k * 0.05 and sea < 0.0 and spill == 0
    print('остров %d (%s%s, половина стороны %.0f м): вершина %.1f м (каталог %.1f), море рядом %.1f м%s%s' % (
        number, design, ', Каменоломня' if quarry else '', ir, top, th * k, sea,
        ', озеро %.2f м' % float(lv[lake].max()) if lake.any() else '', '' if ok else '  ← НЕ ТАК'))

# 5. Границы запечённых областей с открытым морем (как в world_terrain.gd: главная область — острова с запасом 520 м,
#    у каждого малого острова — своя, с запасом 260 м; края по сетке плиток 256 м).
import math
CHUNK = 256.0
def snap(x0, z0, x1, z1):
    return (math.floor(x0 / CHUNK) * CHUNK, math.floor(z0 / CHUNK) * CHUNK, math.ceil(x1 / CHUNK) * CHUNK, math.ceil(z1 / CHUNK) * CHUNK)
areas = [snap(cx.min() - 86.60254 - 520.0, cz.min() - 100.0 - 520.0, cx.max() + 86.60254 + 520.0, cz.max() + 100.0 + 520.0)]
for ix, iz, ir, design, *_ in world.islets:
    half = world.designs[design]['reach'] * ir * 1.03 + 12.0
    a = snap(ix - half - 260.0, iz - half - 260.0, ix + half + 260.0, iz + half + 260.0)
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
