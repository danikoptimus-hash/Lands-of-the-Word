# Инструменты для лепки малых островов: формы, размыв водой (реки и дождевые капли), осыпи, озёра
# и поля, которые читает игра. Шум — тот же, что в песочнице формы земли (tools/sandbox/base.py).
import math
import sys
from pathlib import Path

import numpy as np
from numba import njit
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sandbox"))
from base import fbm, gnoise, ridged, smoothstep  # noqa: E402,F401

N = 512        # сторона поля, точек
EXTENT = 1.15  # поле покрывает квадрат от −EXTENT до EXTENT половин стороны острова


def grid(R):
    """Сетка штампа: центры точек в метрах (x — на восток, y — на юг) при половине стороны R, шаг сетки."""
    a = (np.arange(N) + 0.5) / N * 2.0 * EXTENT - EXTENT
    u, v = np.meshgrid(a, a)
    return u * R, v * R, 2.0 * EXTENT * R / N


def n01(x, y):
    return np.clip(0.5 + 0.625 * gnoise(x, y), 0.0, 1.0)


def warp(x, y, amp, scale, salt):
    """Сдвиг координат шумом: берега и формы перестают быть циркульными."""
    wx = amp * (gnoise(x / scale + salt, y / scale + 3.1 * salt) + 0.45 * gnoise(x / (scale * 0.4) + 7.0 + salt, y / (scale * 0.4) - salt))
    wy = amp * (gnoise(x / scale - 5.0 * salt, y / scale + 11.0) + 0.45 * gnoise(x / (scale * 0.4) - 3.0, y / (scale * 0.4) + 2.0 * salt))
    return x + wx, y + wy


def ellipse(x, y, cx, cy, rx, ry, angle=0.0):
    """Нормированное расстояние до центра эллипса: 1 — на его краю."""
    c, s = math.cos(angle), math.sin(angle)
    dx, dy = x - cx, y - cy
    a = (dx * c + dy * s) / rx
    b = (-dx * s + dy * c) / ry
    return np.sqrt(a * a + b * b)


def segment(x, y, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((x - ax) * vx + (y - ay) * vy) / max(vx * vx + vy * vy, 1e-9), 0.0, 1.0)
    return np.hypot(x - (ax + vx * t), y - (ay + vy * t)), t


def polyline(x, y, pts):
    """Расстояние до ломаной и доля пути вдоль неё (0 — начало, 1 — конец)."""
    best = np.full(x.shape, 1e9)
    along = np.zeros(x.shape)
    lengths = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts[:-1], pts[1:])]
    total = sum(lengths)
    acc = 0.0
    for (a, b), length in zip(zip(pts[:-1], pts[1:]), lengths):
        d, t = segment(x, y, a[0], a[1], b[0], b[1])
        take = d < best
        best = np.where(take, d, best)
        along = np.where(take, (acc + t * length) / total, along)
        acc += length
    return best, along


def smin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


def outline(x, y, lobes, amp, scale, salt, fine=0.35, cuts=()):
    """Очертание острова: пятна-лопасти (эллипсы), бухты вычитаются; всё искажено шумом.
    Возвращает поле: меньше 1 — суша."""
    wx, wy = warp(x, y, amp, scale, salt)
    if fine:
        wx, wy = warp(wx, wy, amp * fine, scale * 0.33, salt + 5.0)
    d = np.full(x.shape, 9.0)
    for cx, cy, rx, ry, a in lobes:
        d = smin(d, ellipse(wx, wy, cx, cy, rx, ry, a), 0.18)
    for cx, cy, rx, ry, a in cuts:
        d = smax(d, 2.0 - ellipse(wx, wy, cx, cy, rx, ry, a), 0.15)
    return d


def inland_distance(mask, dx):
    """Расстояние до края маски внутри неё, м (снаружи 0)."""
    return ndimage.distance_transform_edt(mask) * dx


def ridge_line(x, y, pts, heights, widths, power=1.5):
    """Гребень вдоль ломаной: высота и ширина меняются вдоль пути, склоны вогнутые."""
    d, along = polyline(x, y, pts)
    lengths = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts[:-1], pts[1:])]
    marks = np.concatenate([[0.0], np.cumsum(lengths) / sum(lengths)])
    top = np.interp(along, marks, heights)
    width = np.interp(along, marks, widths)
    return top * np.power(np.clip(1.0 - d / width, 0.0, 1.0), power)


def blob(x, y, cx, cy, r, soft=0.5):
    """1 в пятне радиуса r, плавно к 0 на краю (soft — доля радиуса на переход)."""
    return 1.0 - smoothstep(1.0 - soft, 1.0, np.hypot(x - cx, y - cy) / r)


def coast_cliff(inland, height, width=7.0):
    """Обрыв у берега: земля поднимается на height за width метров от кромки воды."""
    return height * smoothstep(0.0, width, inland)


def slab(wx, wy, cx, cy, rx, ry, a, h, tilt, salt):
    """Каменная плита-островок: отвесные стены, верх наклонён и изрезан трещинами."""
    e = ellipse(wx, wy, cx, cy, rx, ry, a)
    ca, sa = math.cos(tilt), math.sin(tilt)
    lean = 1.0 + 0.35 * ((wx - cx) * ca + (wy - cy) * sa) / max(rx, ry)
    top = h * lean * (0.85 + 0.3 * ridged(wx / 23.0 + salt, wy / 23.0 - salt, 3))
    wall = smoothstep(1.0, 0.8, e)
    return top * wall + 1.5 * smoothstep(1.12, 1.0, e) - 2.5


def sea_floor(land, dx):
    """Дно вокруг острова для расчёта размыва (в игре дно считает функция высот)."""
    return -(1.5 + 0.09 * ndimage.distance_transform_edt(~land) * dx)


# ── Реки: долины по закону «мощности потока» (как FastScape) ─────────────────

NB_X = np.array([1, -1, 0, 0, 1, 1, -1, -1], dtype=np.int64)
NB_Y = np.array([0, 0, 1, -1, 1, -1, 1, -1], dtype=np.int64)
NB_D = np.array([1.0, 1.0, 1.0, 1.0, 1.4142136, 1.4142136, 1.4142136, 1.4142136])


@njit(cache=True)
def _push(keys, idx, size, k, i):
    keys[size] = k
    idx[size] = i
    c = size
    while c > 0:
        p = (c - 1) // 2
        if keys[p] <= keys[c]:
            break
        keys[p], keys[c] = keys[c], keys[p]
        idx[p], idx[c] = idx[c], idx[p]
        c = p
    return size + 1


@njit(cache=True)
def _pop(keys, idx, size):
    k = keys[0]
    i = idx[0]
    size -= 1
    keys[0] = keys[size]
    idx[0] = idx[size]
    c = 0
    while True:
        left = 2 * c + 1
        right = left + 1
        m = c
        if left < size and keys[left] < keys[m]:
            m = left
        if right < size and keys[right] < keys[m]:
            m = right
        if m == c:
            break
        keys[m], keys[c] = keys[c], keys[m]
        idx[m], idx[c] = idx[c], idx[m]
        c = m
    return k, i, size


@njit(cache=True)
def _flood(h, n, eps):
    """Заливка ям от моря вверх: порядок обработки (от устьев к вершинам) и куда стекает каждая клетка."""
    total = n * n
    done = np.zeros(total, dtype=np.bool_)
    parent = np.full(total, -1, dtype=np.int64)
    filled = h.copy()
    order = np.empty(total, dtype=np.int64)
    keys = np.empty(total * 2, dtype=np.float64)
    idx = np.empty(total * 2, dtype=np.int64)
    size = 0
    count = 0
    for i in range(total):
        x = i % n
        y = i // n
        if h[i] <= 0.0 or x == 0 or y == 0 or x == n - 1 or y == n - 1:
            done[i] = True
    for i in range(total):
        if done[i]:
            continue
        x = i % n
        y = i // n
        for k in range(8):
            j = (y + NB_Y[k]) * n + x + NB_X[k]
            if done[j] and h[j] <= 0.0:
                parent[i] = j
                size = _push(keys, idx, size, h[i], i)
                done[i] = True
                break
    while size > 0:
        key, c, size = _pop(keys, idx, size)
        order[count] = c
        count += 1
        x = c % n
        y = c // n
        for k in range(8):
            j = (y + NB_Y[k]) * n + x + NB_X[k]
            if done[j]:
                continue
            done[j] = True
            parent[j] = c
            v = filled[c] + eps * NB_D[k]
            if filled[j] < v:
                filled[j] = v
            size = _push(keys, idx, size, filled[j], j)
    return order[:count], parent


@njit(cache=True)
def _incise(h, hard, n, order, parent, area, dx, k_dt, m):
    count = order.shape[0]
    acc = np.zeros(n * n)
    for t in range(count):
        acc[order[t]] = area
    for t in range(count - 1, -1, -1):
        c = order[t]
        p = parent[c]
        if p >= 0:
            acc[p] += acc[c]
    for t in range(count):
        c = order[t]
        p = parent[c]
        if p < 0:
            continue
        hr = h[p] if h[p] > 0.0 else 0.0
        if h[c] <= hr:
            continue
        dist = math.sqrt(float((c % n - p % n) ** 2 + (c // n - p // n) ** 2)) * dx
        f = k_dt * (1.0 - hard[c]) * acc[c] ** m / dist
        h[c] = (h[c] + f * hr) / (1.0 + f)


def rivers(H, dx, hard, iterations=60, k_dt=0.08, m=0.5, diffusion=0.03, eps=0.001):
    """Реки собирают сток со всего острова и врезают долины к морю; склоны между ними оплывают."""
    n = H.shape[0]
    h = H.astype(np.float64).ravel().copy()
    hd = hard.astype(np.float64).ravel()
    for _ in range(iterations):
        order, parent = _flood(h, n, eps)
        _incise(h, hd, n, order, parent, dx * dx, dx, k_dt, m)
        if diffusion:
            g = h.reshape(n, n)
            lap = np.roll(g, 1, 0) + np.roll(g, -1, 0) + np.roll(g, 1, 1) + np.roll(g, -1, 1) - 4.0 * g
            g += np.where(g > 0.0, diffusion * (1.0 - 0.7 * hard) * lap, 0.0)
            h = g.ravel()
    return h.reshape(n, n)


# ── Дождевые капли: мелкие промоины (алгоритм Себастьяна Лага, по одной капле) ─

@njit(cache=True)
def _height_grad(h, n, px, py):
    ix = int(px)
    iy = int(py)
    fx = px - ix
    fy = py - iy
    i = iy * n + ix
    h00 = h[i]
    h10 = h[i + 1]
    h01 = h[i + n]
    h11 = h[i + n + 1]
    gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy
    gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx
    return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy, gx, gy


@njit(cache=True)
def _drops(h, hard, n, starts_x, starts_y, turns, radius, inertia, capacity, min_capacity, erode_speed,
           deposit_speed, evaporate, gravity, lifetime, shore_keep):
    count = 0
    side = 2 * radius + 1
    ox = np.zeros(side * side, dtype=np.int64)
    oy = np.zeros(side * side, dtype=np.int64)
    ow = np.zeros(side * side)
    total = 0.0
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            d = math.sqrt(dx * dx + dy * dy)
            if d <= radius:
                ox[count] = dx
                oy[count] = dy
                ow[count] = 1.0 - d / (radius + 0.5)
                total += ow[count]
                count += 1
    for k in range(count):
        ow[k] /= total
    margin = radius + 2
    for d in range(starts_x.shape[0]):
        px = starts_x[d]
        py = starts_y[d]
        dirx = 0.0
        diry = 0.0
        speed = 1.0
        water = 1.0
        sediment = 0.0
        for step in range(lifetime):
            ix = int(px)
            iy = int(py)
            fx = px - ix
            fy = py - iy
            i = iy * n + ix
            hh, gx, gy = _height_grad(h, n, px, py)
            dirx = dirx * inertia - gx * (1 - inertia)
            diry = diry * inertia - gy * (1 - inertia)
            length = math.sqrt(dirx * dirx + diry * diry)
            if length < 1e-12:
                a = turns[(d * 31 + step) % turns.shape[0]]
                dirx = math.cos(a)
                diry = math.sin(a)
            else:
                dirx /= length
                diry /= length
            px += dirx
            py += diry
            if px < margin or py < margin or px >= n - margin or py >= n - margin:
                break
            hn, _, _ = _height_grad(h, n, px, py)
            dh = hn - hh
            if hn < 0.0:
                amount = sediment * shore_keep
                h[i] += amount * (1 - fx) * (1 - fy)
                h[i + 1] += amount * fx * (1 - fy)
                h[i + n] += amount * (1 - fx) * fy
                h[i + n + 1] += amount * fx * fy
                break
            cap = max(-dh * speed * water * capacity, min_capacity)
            if sediment > cap or dh > 0:
                amount = min(dh, sediment) if dh > 0 else (sediment - cap) * deposit_speed
                sediment -= amount
                h[i] += amount * (1 - fx) * (1 - fy)
                h[i + 1] += amount * fx * (1 - fy)
                h[i + n] += amount * (1 - fx) * fy
                h[i + n + 1] += amount * fx * fy
            else:
                amount = min((cap - sediment) * erode_speed * (1.0 - hard[i]), -dh)
                for k in range(count):
                    j = (iy + oy[k]) * n + ix + ox[k]
                    w = amount * ow[k]
                    take = h[j] if h[j] < w else w
                    if take < 0.0:
                        take = 0.0
                    h[j] -= take
                    sediment += take
            speed = math.sqrt(max(speed * speed - dh * gravity, 0.0))
            water *= 1.0 - evaporate


def raindrops(H, scale, hard, drops, seed=1, radius=3, inertia=0.05, capacity=3.0, min_capacity=0.01, erode_speed=0.12,
              deposit_speed=0.02, evaporate=0.004, gravity=4.0, lifetime=140, shore_keep=0.5):
    """Дождевые капли по одной стекают по склонам и прорезают мелкие промоины. scale — метров на единицу высоты
    в расчёте (чем больше, тем мягче)."""
    n = H.shape[0]
    h = (H / scale).astype(np.float64).ravel().copy()
    hd = np.clip(hard, 0.0, 1.0).astype(np.float64).ravel()
    rng = np.random.default_rng(seed)
    land = np.nonzero(H.ravel() > 0.3)[0]
    pick = rng.choice(land, drops)
    _drops(h, hd, n, (pick % n) + rng.random(drops), (pick // n) + rng.random(drops), rng.random(4096) * 6.2831853,
           radius, inertia, capacity, min_capacity, erode_speed, deposit_speed, evaporate, gravity, lifetime, shore_keep)
    return h.reshape(H.shape) * scale


def scree(H, dx, hard, talus=0.9, hard_talus=2.6, iterations=25, rate=0.45):
    """Осыпи: где склон круче угла естественного откоса, порода сползает вниз. В твёрдой породе откос круче."""
    h = H.copy()
    t = talus + (hard_talus - talus) * hard
    neighbours = [(0, 1, 1.0), (1, 0, 1.0), (0, -1, 1.0), (-1, 0, 1.0), (1, 1, 1.4142), (1, -1, 1.4142), (-1, 1, 1.4142), (-1, -1, 1.4142)]
    for _ in range(iterations):
        delta = np.zeros_like(h)
        for oy, ox, dist in neighbours:
            hn = np.roll(np.roll(h, -oy, 0), -ox, 1)
            move = np.maximum(h - hn - t * dx * dist, 0.0) * (rate / 8.0)
            delta -= move
            delta += np.roll(np.roll(move, oy, 0), ox, 1)
        h += delta
    return h


# ── Озёра и поля для игры ─────────────────────────────────────────────────

NO_WATER = -999.0


def lake_basin(H, x, y, lake, salt):
    """Чаша озера неровной формы; уровень воды — чуть ниже самой низкой точки берега, поэтому вода не переливается.
    Возвращает рельеф и поле уровня воды (NO_WATER вне озера, с запасом под сушей вокруг)."""
    wx, wy = warp(x, y, lake["rx"] * 0.12, lake["rx"] * 0.6, salt)
    e = ellipse(wx, wy, lake["cx"], lake["cy"], lake["rx"], lake["ry"], lake.get("angle", 0.0))
    ring = (e > 1.08) & (e < 1.4)
    rim = float(np.percentile(H[ring], 4))
    level = rim - 0.45 if lake.get("level") is None else min(lake["level"], rim - 0.45)
    # дно не ниже уровня моря: под озером не должно оказаться моря
    bowl = np.maximum(level - lake["depth"] * np.power(np.clip(1.0 - e * e, 0.0, 1.0), 0.55), 0.15)
    H = np.where(e < 1.0, np.minimum(H, bowl), H)
    # берег держит воду: чуть выше уровня сразу за кромкой (только на суше)
    H = np.where((e >= 1.0) & (e < 1.4) & (H > 0.0), np.maximum(H, level + 0.3 + 3.0 * (e - 1.0)), H)
    water = np.where(e < 1.32, level, NO_WATER)
    return H, water, level


def fields(H, dx, R, hard, lake_level, rocky_sea=0.0):
    """Поля штампа для игры: высота (м при опорном размере), расстояние до берега (в половинах стороны,
    внутри суши — отрицательное), «камень» (на суше: скалы и крутые склоны; в море: крутизна ближайшего берега),
    уровень воды озера."""
    land = H > 0.0
    # Расстояние до берега точнее: маска на вдвое более частой сетке.
    fine = ndimage.zoom(H, 2, order=1) > 0.0
    dist = ndimage.distance_transform_edt(~fine) - ndimage.distance_transform_edt(fine)
    sd = dist.reshape(N, 2, N, 2).mean(axis=(1, 3)) * (dx / 2.0) / R
    sd = ndimage.gaussian_filter(sd, 0.6)
    gy, gx = np.gradient(H, dx)
    slope = np.hypot(gx, gy)
    rock = np.clip(np.maximum(smoothstep(0.55, 1.1, slope), 0.75 * smoothstep(0.55, 0.85, hard) * smoothstep(0.3, 0.6, slope)), 0.0, 1.0)
    rock = np.where(lake_level > -900.0, 0.0, rock)
    # Крутизна берега: какая земля в нескольких метрах от воды; в море — у ближайшей точки берега.
    near = ndimage.maximum_filter(np.where(land, H, 0.0), size=max(3, int(round(10.0 / dx)) * 2 + 1))
    cliff_land = smoothstep(4.0, 16.0, near)
    _, (iy, ix) = ndimage.distance_transform_edt(~land, return_indices=True)
    # у каждой точки моря — крутизна ближайшего берега, сглаженная вдоль берега (иначе на дне видны лучи
    # от границ «чей берег ближе»)
    cliff_sea = ndimage.gaussian_filter(cliff_land[iy, ix], 9.0)
    # у каменных островков (шхеры, утёс) дно вокруг каменистое
    stone = np.where(land, rock, np.maximum(cliff_sea, rocky_sea))
    # За краем штампа игра продолжает поле по кругу: к краю крутизна берега в море сходится к одному числу,
    # иначе от острова по дну расходились бы лучи.
    axis = (np.arange(N) + 0.5) / N * 2.0 * EXTENT - EXTENT
    rad = np.hypot(*np.meshgrid(axis, axis))
    ring = (rad > 0.92 * EXTENT) & (rad < EXTENT) & ~land
    mean = float(stone[ring].mean()) if ring.any() else 0.0
    stone = np.where(land, stone, stone + (mean - stone) * smoothstep(0.8 * EXTENT, EXTENT, rad))
    out = ndimage.distance_transform_edt(~land) * dx
    height = np.where(land, H, np.maximum(-0.4 - 0.12 * out, -20.0))
    return height, sd, stone, lake_level


def quarry_cut(u, v, h):
    """Карьер каменоломни при опорном размере (как quarry_works в функции высот, без площадки причала)."""
    def box(px, py, hx, hy):
        qx = np.abs(px) - hx
        qy = np.abs(py) - hy
        return np.hypot(np.maximum(qx, 0.0), np.maximum(qy, 0.0)) + np.minimum(np.maximum(qx, qy), 0.0)
    floor = np.minimum(box(u + 0.05, v + 0.2, 0.09, 0.05), box(u + 0.05, v + 0.05, 0.06, 0.13))
    x = np.maximum(floor, 0.0) / 0.034
    whole = np.floor(x)
    stairs = whole + smoothstep(0.75, 1.0, x - whole)
    outer = box(u + 0.05, v + 0.13, 0.2, 0.2)
    return np.minimum(h, 11.5 + 6.0 * stairs) * (1.0 - smoothstep(-0.02, 0.0, outer)) + h * smoothstep(-0.02, 0.0, outer)
