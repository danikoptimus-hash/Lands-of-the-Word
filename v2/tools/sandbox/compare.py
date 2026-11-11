# Сверка функции высот в игре (отчёт конвейера otchet.json) с песочницей: высоты под перекрёстками и уровни озёр.
# Запуск: python compare.py путь/к/otchet.json
import json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).parent))
import height as H
from base import hex_center

w = H.World(str(Path(__file__).parents[2] / 'data' / 'world_osen.json'))
rep = json.load(open(sys.argv[1], encoding='utf-8'))
keys = list(rep['site_heights'].keys())
xs = []; zs = []
for k in keys:
    q, r = map(int, k[2:].split(','))
    x, z = hex_center(q, r); z += -H.S if k[0] == 'N' else H.S
    xs.append(x); zs.append(z)
px = np.array([xs], dtype=np.float32); py = np.array([zs], dtype=np.float32)
h, lv = w.height(px, py, True)
game = np.array([rep['site_heights'][k] for k in keys])
diff = game - h[0]
print('перекрёстков', len(keys), '; расхождение: среднее %.3f м, наибольшее %.3f м' % (np.abs(diff).mean(), np.abs(diff).max()))
worst = np.argsort(-np.abs(diff))[:6]
for i in worst: print('  ', keys[i], 'игра %.2f песочница %.2f' % (game[i], h[0, i]))
print('высоты в игре: от %.1f до %.1f; запекание %.0f мс' % (rep['height_range'][0], rep['height_range'][1], rep['bake_ms']))
for l in rep.get('lakes', []):
    level = float(w.wet_level(np.array([l['q']]), np.array([l['r']]))[0])
    print('   озеро' if l['lake'] else '   пруд', (l['q'], l['r']), 'игра %.3f песочница %.3f' % (l['level'], level))
probes = rep.get('probes', {})
if probes:
    names = list(probes.keys())
    qx = np.array([[probes[k][0] for k in names]], dtype=np.float32); qz = np.array([[probes[k][1] for k in names]], dtype=np.float32)
    mine = w.height(qx, qz)[0]; theirs = np.array([probes[k][2] for k in names])
    gap = np.abs(theirs - mine)
    print('точек на малых островах и у них', len(names), '; расхождение: среднее %.3f м, наибольшее %.3f м' % (gap.mean(), gap.max()))
    for i in np.argsort(-gap)[:5]: print('  ', names[i], 'игра %.2f песочница %.2f' % (theirs[i], mine[i]))
for pond in rep.get('ponds', []):
    x, z, r, design, angle, mirror, quarry = w.islets[pond['islet']]
    info = w.designs[design]
    print('   озеро малого острова', pond['islet'], 'уровень в игре %.2f, в песочнице %.2f' % (pond['level'], info['lake_level'] * (r / info['size']) ** 0.75))
