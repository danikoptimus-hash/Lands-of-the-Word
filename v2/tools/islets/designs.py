# Малые острова версии 2 — свой замысел у каждого (не по картинкам сайта; решение владельца 11.11:
# «не нужно косить под сайт… красивые острова с самостоятельным дизайном гор, скал, равнин»).
#
# Остров лепится в три приёма: основа (очертание, массивы гор, плато, долины) → реки за долгое время прорезают
# долины к морю, дождевые капли — мелкие промоины → осыпи под крутыми склонами. Высоты — в метрах при «опорной»
# половине стороны острова R; в игре штамп растягивается под размер острова на карте, высоты растут медленнее
# размера (функция высот, src/terrain/height.gdshaderinc). Координаты: x — на восток, y — на юг, метры от центра.
import math

import numpy as np

from relief import (blob, coast_cliff, ellipse, fbm, gnoise, grid, inland_distance, n01, outline, polyline, ridge_line,
                    ridged, sea_floor, slab, smax, smoothstep, warp)


def spec(name, R, H, land, hard, dx, **kw):
    H = np.where(land, H, sea_floor(land, dx))
    d = dict(name=name, R=R, H=H, hard=np.clip(hard, 0.0, 0.95), dx=dx, drops=150000, scale=190.0)
    d.update(kw)
    return d


# ── Острова ───────────────────────────────────────────────────────────────

def peak():
    """Остров-пик: хребет с главной вершиной, отроги спускаются к морю мысами, между ними долины к бухтам.
    С северо-востока — обрывистый мыс, на юго-западе — низкий берег с пляжами."""
    R = 700.0
    x, y, dx = grid(R)
    land = outline(x, y, [(0, -20, 470, 360, 0.35), (-330, 250, 230, 150, 0.8), (370, -290, 190, 105, -0.6), (230, 260, 170, 110, 0.4),
                          (-120, -330, 190, 110, -0.2)], 50.0, 230.0, 1.3,
                   cuts=[(80, 330, 110, 70, 0.3), (-470, 20, 90, 70, 0.0)]) < 1.0
    inland = inland_distance(land, dx)
    s = inland / inland.max()
    wx, wy = warp(x, y, 40.0, 140.0, 7.0)
    focus = np.exp(-((x + 40) ** 2 + (y + 90) ** 2) / (2 * 280.0 ** 2))
    steep = 205.0 * np.power(s, 0.9) * (0.5 + 0.75 * focus) * (0.72 + 0.45 * ridged(wx / 160.0 + 3.0, wy / 160.0 + 7.0, 4))
    # низкие берега: на юго-западе и у южной бухты — полоса пляжей и лугов, гора начинается дальше от воды
    low = np.maximum(blob(x, y, -320, 230, 330), blob(x, y, 60, 320, 230)) * smoothstep(0.3, 0.6, n01(x / 160.0 + 4.0, y / 160.0))
    low = np.maximum(low, 0.8 * blob(x, y, -330, 250, 260))
    plain = 1.5 + 6.0 * smoothstep(0.0, 140.0, inland)
    gentle = smax(plain, 205.0 * np.power(np.maximum(s - 0.28, 0.0) / 0.72, 1.1) * (0.5 + 0.75 * focus), 12.0)
    H = steep * (1.0 - low) + gentle * low
    cliff = 0.5 * (1.0 - low) * smoothstep(0.45, 0.75, n01(x / 220.0 + 9.0, y / 220.0 + 2.0))
    H = np.maximum(H, coast_cliff(inland, 30.0 * cliff, 6.0))
    hard = 0.15 + 0.3 * n01(x / 200.0 + 9.0, y / 200.0 + 1.0) + 0.6 * smoothstep(0.2, 0.4, cliff) * (1.0 - smoothstep(20.0, 60.0, inland))
    return spec("peak", R, H, land, hard, dx)


def mesa():
    """Столовая гора: высокое плато с отвесными обрывами к морю; в край плато врезаны каньоны с пляжами в устьях,
    под стенами — осыпи; на востоке плато спускается уступом на нижнюю террасу."""
    R = 600.0
    x, y, dx = grid(R)
    d = outline(x, y, [(-60, -10, 430, 330, 0.2), (300, 120, 260, 170, -0.4), (-250, 260, 170, 130, 0.5)], 45.0, 300.0, 2.7, fine=0.5,
                cuts=[(-80, 390, 110, 55, 0.0), (440, -170, 90, 60, 0.5)])
    land = d < 1.0
    inland = inland_distance(land, dx)
    wx, wy = warp(x, y, 55.0, 150.0, 4.0)
    wx, wy = warp(wx, wy, 18.0, 45.0, 9.0)
    upper = ellipse(wx, wy, -90, -20, 410, 310, 0.2)
    canyon = np.full(x.shape, 1e9)
    for pts in ([(-80, 380), (-60, 250), (10, 140), (-20, 40)], [(430, -170), (290, -120), (190, -150)], [(-470, -120), (-330, -60)]):
        canyon = np.minimum(canyon, polyline(wx, wy, pts)[0])
    rim = smoothstep(0.86, 0.94, upper)
    rim = np.maximum(rim, 1.0 - smoothstep(14.0, 40.0, canyon))
    top = 80.0 + 7.0 * fbm(x / 220.0 + 1.0, y / 220.0 + 2.0, 3) - 0.025 * (y + 300.0)
    base = 30.0 + 6.0 * fbm(x / 90.0, y / 90.0 + 3.0, 2)
    # стена: верх отвесный, ниже — вогнутая осыпь до подножия
    wall = np.where(rim < 0.5, top - (top - base) * np.power(smoothstep(0.0, 0.5, rim), 0.6),
                    base * (1.0 - smoothstep(0.5, 1.0, rim)) + 4.0 * smoothstep(0.5, 1.0, rim))
    terrace = 30.0 + 4.0 * fbm(x / 120.0, y / 120.0 + 5.0, 2)
    lower = terrace * smoothstep(1.25, 1.0, ellipse(wx, wy, 240, 110, 330, 230, -0.4))
    H = np.maximum(wall, lower)
    H = np.maximum(H, 2.0 + 4.0 * smoothstep(0.0, 60.0, inland))
    sea_wall = (upper < 0.9) & (canyon > 40.0)
    H = np.where(sea_wall, np.minimum(H, 3.0 + (H - 3.0) * smoothstep(0.0, 7.0, inland)), H)
    hard = np.where(H > 58.0, 0.9, 0.2) + 0.08 * n01(x / 90.0, y / 90.0)
    hard = np.where(canyon < 30.0, 0.15, hard)
    return spec("mesa", R, H, land, hard, dx, rivers=dict(k_dt=0.06), drops=120000, talus=0.75)


def valley():
    """Зелёная долина: подкова холмов с севера, запада и востока, в середине широкая ровная долина с озером,
    открытая к южной бухте с пляжем."""
    R = 670.0
    x, y, dx = grid(R)
    land = outline(x, y, [(0, -40, 500, 400, 0.0), (-330, 230, 220, 190, 0.5), (340, 220, 210, 180, -0.5)], 50.0, 260.0, 5.1,
                   cuts=[(0, 420, 210, 150, 0.0)]) < 1.0
    inland = inland_distance(land, dx)
    wx, wy = warp(x, y, 45.0, 170.0, 8.0)
    arc = [(-360, 260), (-430, 20), (-300, -230), (-60, -330), (200, -300), (390, -110), (400, 160), (330, 300)]
    hills = ridge_line(wx, wy, arc, [55, 95, 120, 135, 125, 110, 80, 50], [190, 230, 260, 270, 260, 240, 210, 170], 1.35)
    hills *= 0.7 + 0.5 * ridged(wx / 140.0 + 1.0, wy / 140.0 + 4.0, 3)
    floor = 4.5 + 3.0 * smoothstep(0.0, 200.0, inland) + 1.5 * fbm(x / 90.0 + 3.0, y / 90.0, 2)
    H = smax(floor, hills, 14.0)
    H = np.maximum(H, coast_cliff(inland, 18.0 * smoothstep(-150.0, -350.0, y), 6.0))
    hard = 0.2 + 0.3 * n01(x / 170.0 + 2.0, y / 170.0 + 6.0)
    lake = dict(cx=-20.0, cy=40.0, rx=150.0, ry=95.0, angle=0.25, level=6.2, depth=5.0)
    return spec("valley", R, H, land, hard, dx, lake=lake)


def horseshoe():
    """Подкова: дуга суши с гребнем обнимает широкую тихую бухту; снаружи обрывы, внутри пологие склоны и пляжи;
    у входа в бухту — скала."""
    R = 535.0
    x, y, dx = grid(R)
    wx, wy = warp(x, y, 40.0, 220.0, 3.3)
    outer = ellipse(wx, wy, 0, 0, 470, 420, 0.3)
    inner = ellipse(wx, wy, 90, 110, 270, 230, 0.4)
    d = smax(outer, 2.0 - inner, 0.12)
    gate = ellipse(wx, wy, 260, 310, 200, 120, 0.7)
    d = smax(d, 2.0 - gate, 0.1)
    rock = ellipse(wx, wy, 300, 300, 45, 35, 0.2)
    land = (d < 1.0) | (rock < 1.0)
    inland = inland_distance(land, dx)
    crest = 0.5 * (outer + (2.0 - inner)) / 1.0
    arc_h = 85.0 * smoothstep(1.05, 0.55, np.abs(outer - 0.62) / 0.4 + 0.0) * (0.75 + 0.4 * ridged(wx / 130.0 + 6.0, wy / 130.0 + 1.0, 3))
    H = smax(2.0 + 4.0 * smoothstep(0.0, 60.0, inland), arc_h * smoothstep(0.0, 120.0, inland + 60.0), 10.0)
    seaward = smoothstep(0.75, 0.95, outer)
    H = np.maximum(H, coast_cliff(inland, 26.0 * seaward * smoothstep(0.35, 0.6, n01(x / 160.0, y / 160.0 + 3.0)), 6.0))
    H = np.where(rock < 1.0, np.maximum(H, 24.0 * smoothstep(0.0, 8.0, inland)), H)
    hard = 0.25 + 0.4 * seaward + 0.5 * (rock < 1.2)
    return spec("horseshoe", R, H, land, hard, dx)


def twin():
    """Двуглавый остров: две вершины, между ними седловина; к седловине с обеих сторон подходят бухты."""
    R = 535.0
    x, y, dx = grid(R)
    land = outline(x, y, [(-190, -10, 280, 240, 0.3), (210, 20, 240, 210, -0.2), (0, 0, 220, 120, 0.0)], 40.0, 200.0, 6.6,
                   cuts=[(10, -250, 120, 90, 0.0), (0, 260, 110, 90, 0.2)]) < 1.0
    inland = inland_distance(land, dx)
    wx, wy = warp(x, y, 35.0, 130.0, 2.2)
    a = 150.0 * np.power(np.clip(1.0 - ellipse(wx, wy, -200, -20, 260, 230, 0.3), 0, 1), 1.25)
    b = 120.0 * np.power(np.clip(1.0 - ellipse(wx, wy, 220, 20, 230, 200, -0.2), 0, 1), 1.25)
    H = smax(a, b, 40.0) * (0.72 + 0.45 * ridged(wx / 120.0 + 2.0, wy / 120.0 + 9.0, 4))
    H = smax(H, 2.0 + 5.0 * smoothstep(0.0, 70.0, inland), 8.0)
    H = np.maximum(H, coast_cliff(inland, 22.0 * smoothstep(0.55, 0.8, n01(x / 150.0 + 2.0, y / 150.0 + 2.0)), 5.0))
    hard = 0.2 + 0.4 * n01(x / 150.0, y / 150.0 + 7.0)
    return spec("twin", R, H, land, hard, dx)


def ridge():
    """Хребет: длинный узкий остров, по нему — острый гребень с зубцами; бока изрезаны промоинами;
    один конец обрывается мысом, другой сходит в низкую песчаную косу."""
    R = 580.0
    x, y, dx = grid(R)
    axis = [(-460, 120), (-250, 40), (0, -30), (230, -60), (420, -170)]
    wx, wy = warp(x, y, 30.0, 200.0, 9.9)
    dist, along = polyline(wx, wy, axis)
    width = np.interp(along, [0, 0.15, 0.5, 0.85, 1.0], [60, 150, 175, 140, 90])
    land = dist < width
    inland = inland_distance(land, dx)
    spine = np.interp(along, [0, 0.2, 0.45, 0.6, 0.85, 1.0], [6, 55, 115, 100, 80, 45])
    H = spine * np.power(np.clip(1.0 - dist / width, 0, 1), 0.9) * (0.75 + 0.45 * ridged(wx / 110.0 + 5.0, wy / 110.0, 4))
    H = smax(H, 1.5 + 3.0 * smoothstep(0.0, 40.0, inland), 6.0)
    H = np.maximum(H, coast_cliff(inland, 30.0 * smoothstep(0.75, 0.95, along), 5.0))
    hard = 0.25 + 0.35 * n01(x / 120.0, y / 120.0) + 0.4 * smoothstep(0.75, 0.95, along)
    return spec("ridge", R, H, land, hard, dx)


def hills():
    """Холмы: мягкие округлые холмы с лугами, связанные седловинами, между ними пологие долины к бухтам;
    берег низкий, местами невысокие обрывы."""
    R = 540.0
    x, y, dx = grid(R)
    land = outline(x, y, [(0, 0, 400, 300, 0.25), (-250, 200, 200, 150, 0.7), (280, -160, 190, 140, -0.2)], 45.0, 210.0, 3.9,
                   cuts=[(60, 330, 120, 70, 0.1)]) < 1.0
    inland = inland_distance(land, dx)
    wx, wy = warp(x, y, 70.0, 220.0, 1.7)
    roll = np.clip(fbm(wx / 300.0 + 4.0, wy / 300.0 + 1.0, 4) * 0.9 + 0.55, 0.0, 1.4)
    rise = smoothstep(0.0, 170.0, inland)
    H = 2.0 + 5.0 * smoothstep(0.0, 90.0, inland) + 58.0 * np.power(roll, 1.8) * rise
    H = np.maximum(H, coast_cliff(inland, 9.0 * smoothstep(0.55, 0.8, n01(x / 170.0 + 3.0, y / 170.0)), 4.0))
    hard = 0.1 + 0.2 * n01(x / 150.0, y / 150.0)
    return spec("hills", R, H, land, hard, dx, rivers=dict(k_dt=0.035, diffusion=0.08), drops=60000, talus=0.7)


def dunes():
    """Дюны: длинный низкий песчаный остров, гряды дюн поперёк ветра (пологие с наветренной стороны, крутые
    с подветренной), широкие пляжи, в середине солёное озерко; на западном конце — каменистый бугор."""
    R = 500.0
    x, y, dx = grid(R)
    land = outline(x, y, [(-20, 0, 440, 160, -0.3), (-320, -100, 140, 115, 0.0), (300, 130, 170, 90, -0.5), (-170, -40, 170, 120, -0.2)], 30.0, 230.0, 4.4) < 1.0
    inland = inland_distance(land, dx)
    c, s_ = math.cos(1.05), math.sin(1.05)
    wx, wy = warp(x, y, 28.0, 110.0, 6.0)
    along = wx * c + wy * s_
    phase = (along / 52.0 + 0.9 * gnoise(x / 160.0, y / 160.0 + 2.0)) % 1.0
    profile = smoothstep(0.0, 0.78, phase) * (1.0 - smoothstep(0.78, 0.98, phase))
    amp = 3.0 + 9.0 * n01(x / 150.0 + 3.0, y / 150.0 + 1.0)
    dune = 1.2 + amp * profile * smoothstep(25.0, 70.0, inland)
    knoll = 26.0 * np.power(np.clip(1.0 - ellipse(wx, wy, -330, -120, 115, 95, 0.0), 0, 1), 0.9)
    H = smax(dune, knoll, 5.0)
    hard = 0.1 + 0.8 * (ellipse(x, y, -330, -120, 130, 110, 0.0) < 1.0)
    lake = dict(cx=70.0, cy=20.0, rx=110.0, ry=38.0, angle=-0.3, level=None, depth=1.4)
    return spec("dunes", R, H, land, hard, dx, rivers=dict(iterations=0), drops=0, lake=lake, talus=0.65)



def skerries():
    """Шхеры: гряда каменных островков разной величины с отвесными боками и наклонным верхом, узкие протоки."""
    R = 240.0
    x, y, dx = grid(R)
    rocks = [(-90, -40, 78, 52, 0.4, 30, 0.3), (40, 25, 60, 40, -0.3, 22, 2.0), (125, -70, 42, 28, 0.8, 15, 4.0), (-30, 110, 46, 30, 0.1, 12, 1.0),
             (145, 90, 28, 20, 0.0, 8, 5.5), (-165, 75, 30, 20, 0.5, 9, 3.3), (-150, -140, 18, 14, 0.2, 5, 0.0)]
    wx, wy = warp(x, y, 14.0, 55.0, 3.0)
    wx, wy = warp(wx, wy, 5.0, 16.0, 8.0)
    H = np.full(x.shape, -3.0)
    for i, (cx, cy, rx, ry, a, h, tilt) in enumerate(rocks):
        H = np.maximum(H, slab(wx, wy, cx, cy, rx, ry, a, h, tilt, 3.0 * i))
    land = H > 0.3
    hard = np.full(x.shape, 0.8)
    return spec("skerries", R, H, land, hard, dx, rivers=dict(iterations=12, k_dt=0.02), drops=0, talus=1.2, rocky_sea=0.75)


def stack():
    """Утёс: одинокая скала-башня со стенами, уступом и трещинами; рядом столб поменьше и камни у воды."""
    R = 140.0
    x, y, dx = grid(R)
    wx, wy = warp(x, y, 10.0, 36.0, 5.0)
    wx, wy = warp(wx, wy, 4.0, 11.0, 2.0)
    H = slab(wx, wy, -10, 0, 70, 50, 0.5, 40.0, 0.8, 1.0)
    H = np.maximum(H, slab(wx, wy, 30, 45, 45, 30, 0.2, 16.0, 3.0, 7.0))
    H = np.maximum(H, slab(wx, wy, 88, 42, 17, 14, 0.0, 24.0, 1.5, 4.0))
    for cx, cy, r, h in ((-90, 60, 9, 3.0), (60, -70, 7, 2.5), (110, 0, 6, 2.0)):
        H = np.maximum(H, slab(wx, wy, cx, cy, r, r * 0.8, 0.0, h, 0.0, 2.0))
    land = H > 0.3
    hard = np.full(x.shape, 0.85)
    return spec("stack", R, H, land, hard, dx, rivers=dict(iterations=10, k_dt=0.015), drops=0, talus=1.4, rocky_sea=0.75)


def crater():
    """Кратер: старый вулкан, на вершине — чаша с озером; склоны изрезаны долинами по радиусам;
    на юго-востоке — низкий лавовый язык, ровный, с пляжами."""
    R = 560.0
    x, y, dx = grid(R)
    land = outline(x, y, [(0, 0, 420, 400, 0.0), (300, 250, 200, 120, -0.7)], 35.0, 220.0, 7.3) < 1.0
    inland = inland_distance(land, dx)
    rr = ellipse(x, y, -20, -20, 1.0, 1.0, 0.0)
    cone = 165.0 * np.power(np.clip(1.0 - rr / 420.0, 0, 1), 1.3)
    bowl = 50.0 * (1.0 - smoothstep(60.0, 120.0, rr))
    H = cone - bowl
    H = smax(H, 2.0 + 4.0 * smoothstep(0.0, 70.0, inland), 8.0)
    H *= 0.85 + 0.25 * fbm(x / 120.0 + 2.0, y / 120.0, 3)
    hard = 0.2 + 0.3 * n01(x / 140.0, y / 140.0) + 0.5 * (1.0 - smoothstep(90.0, 140.0, rr))
    lake = dict(cx=-20.0, cy=-20.0, rx=70.0, ry=70.0, angle=0.0, level=None, depth=8.0)
    return spec("crater", R, H, land, hard, dx, lake=lake)


def quarry():
    """Каменоломня: каменистое плато, к северу — скалистый холм; в южный склон холма врезается карьер
    (уступы задаёт игра), у юго-восточного берега — ровная площадка под причал."""
    R = 400.0
    x, y, dx = grid(R)
    land = outline(x, y, [(0, -20, 290, 270, 0.1), (170, 180, 140, 100, -0.4)], 30.0, 160.0, 8.8) < 1.0
    inland = inland_distance(land, dx)
    wx, wy = warp(x, y, 25.0, 100.0, 2.0)
    hill = ridge_line(wx, wy, [(-200, -120), (-40, -170), (130, -130)], [40, 62, 45], [170, 200, 160], 1.2)
    hill *= 0.75 + 0.4 * ridged(wx / 80.0, wy / 80.0 + 3.0, 4)
    H = smax(5.0 + 6.0 * smoothstep(0.0, 60.0, inland), hill, 10.0)
    H = np.maximum(H, coast_cliff(inland, 16.0 * smoothstep(-80.0, -200.0, y), 5.0))
    hard = 0.5 + 0.3 * n01(x / 90.0, y / 90.0)
    return spec("quarry", R, H, land, hard, dx, rivers=dict(k_dt=0.04), drops=80000, scale=120.0)


# Каталог: номер (в данных мира и в игре), название, опорная половина стороны R, ширина отмели вокруг (м при R),
# во сколько раз остров можно уменьшить и увеличить на карте.
DESIGNS = [
    dict(id=1, make=peak, title="Остров-пик", shelf=140.0),
    dict(id=2, make=mesa, title="Столовая гора", shelf=80.0),
    dict(id=3, make=valley, title="Зелёная долина", shelf=170.0),
    dict(id=4, make=horseshoe, title="Подкова", shelf=150.0),
    dict(id=5, make=twin, title="Двуглавый остров", shelf=140.0),
    dict(id=6, make=ridge, title="Остров-хребет", shelf=90.0),
    dict(id=7, make=hills, title="Холмистый остров", shelf=170.0),
    dict(id=8, make=dunes, title="Дюны", shelf=260.0),
    dict(id=9, make=skerries, title="Шхеры", shelf=90.0),
    dict(id=10, make=stack, title="Утёс", shelf=60.0),
    dict(id=11, make=crater, title="Кратер", shelf=120.0),
    dict(id=12, make=quarry, title="Каменоломня", shelf=100.0),
]

QUARRY = 12
RIVERS = dict(iterations=60, k_dt=0.08, m=0.5, diffusion=0.03)


def build(s, seed=1):
    """Основа → реки прорезают долины → дождевые промоины → осыпи → озеро."""
    from relief import lake_basin, raindrops, rivers, scree, NO_WATER
    H = s["H"].copy()
    rng = np.random.default_rng(seed)
    H = np.where(H > 0, H + rng.random(H.shape) * 0.6, H)   # мелкая неровность: сток не идёт по линейке сетки
    rk = dict(RIVERS)
    rk.update(s.get("rivers", {}))
    if rk["iterations"]:
        H = rivers(H, s["dx"], s["hard"], **rk)
    if s["drops"]:
        H = raindrops(H, s["scale"], s["hard"], s["drops"], seed=seed)
    H = scree(H, s["dx"], s["hard"], talus=s.get("talus", 0.9))
    water = np.full(H.shape, NO_WATER)
    level = None
    if s.get("lake"):
        x, y, _ = grid(s["R"])
        H, water, level = lake_basin(H, x, y, s["lake"], 3.0)
    return H, water, level
