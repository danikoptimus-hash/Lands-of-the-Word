# Песочница формы земли: функция высоты из шейдера src/terrain/height.gdshaderinc, повторённая на numpy один в один.
# Форму подбираем здесь (движок для этого запускать не нужно), затем переносим правку в шейдер; конвейер сверяет
# высоты игры с песочницей (compare.py). Любая правка функции высот делается в обоих местах.
# Переменные окружения для проверок: SEED=число — другое зерно карты; EXTRA="q,r,местность;…" — подменить гексы.
import json, math, os
import numpy as np
from base import S, A, R3, pcg, gnoise, fbm, ridged, smoothstep, smin, hex_center, hex_at, sd_hex

TERR = {"desert": 1, "hills": 2, "meadow": 3, "mountains": 4, "water": 5, "oasis": 6}
BIG = np.float32(1e6)
FAR = 250.0
# Шесть углов гекса по часовой от северного: смещение и ключ вершины (как в packages/domain/src/hexgraph.ts).
CORNERS = [((0.0, -S), (0, 0, 0)), ((A, -S / 2), (1, -1, 1)), ((A, S / 2), (0, 1, 0)), ((0.0, S), (0, 0, 1)), ((-A, S / 2), (-1, 1, 0)), ((-A, -S / 2), (0, -1, 1))]
# Соседи через стороны (сторона i — между углами i и i+1).
SIDES = [(1, -1), (1, 0), (0, 1), (-1, 1), (-1, 0), (0, -1)]
RING1 = [(0, 0)] + SIDES
RING2 = [(dq, dr) for dr in range(-2, 3) for dq in range(-2, 3) if abs(dq + dr) <= 2]
RING3 = [(dq, dr) for dr in range(-3, 4) for dq in range(-3, 4) if abs(dq + dr) <= 3]

def n01(px, py):
    return np.clip(0.5 + 0.625 * gnoise(px, py), 0.0, 1.0)

def smax(a, b, k):
    return -smin(-a, -b, k)

def ridge_join(a, b):
    """Соединение двух гребней: мягкий максимум, который не добавляет высоты там, где одного из гребней нет."""
    k = np.minimum(10.0, np.minimum(a, b))
    hh = np.maximum(k - np.abs(a - b), 0.0) / np.maximum(k, 1e-6)
    return np.maximum(a, b) + hh * hh * k * 0.25

def seg_dist(px, py, ax, ay, bx, by):
    """Расстояние до отрезка и доля пути вдоль него."""
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / np.maximum(vx * vx + vy * vy, 1e-6), 0.0, 1.0)
    return np.hypot(px - (ax + vx * t), py - (ay + vy * t)), t

class World:
    def __init__(self, path):
        w = json.load(open(path, encoding="utf-8"))
        self.w = w
        qs = [h[0] for h in w["hexes"]]; rs = [h[1] for h in w["hexes"]]
        pad = 3
        self.q0, self.r0 = min(qs) - pad, min(rs) - pad
        self.dims = (max(qs) - self.q0 + 1 + pad, max(rs) - self.r0 + 1 + pad)
        self.grid = np.zeros((self.dims[1], self.dims[0]), dtype=np.int32)
        self.vn = np.zeros_like(self.grid); self.vs = np.zeros_like(self.grid)
        for q, r, t, isl in w["hexes"]:
            self.grid[r - self.r0, q - self.q0] = TERR[t]
        for key, kind, city, book, isl, coastal in w["nodes"]:
            q, r = map(int, key[2:].split(","))
            k = 1 if kind == "EMPTY" else 4 if kind == "START" else 3 if city == "port" else 2
            (self.vn if key[0] == "N" else self.vs)[r - self.r0, q - self.q0] = k
        seed = int(os.environ.get("SEED") or w.get("seed", 0))
        for item in filter(None, os.environ.get("EXTRA", "").split(";")):   # проверка: «q,r,местность»
            eq, er, et = item.split(","); self.grid[int(er) - self.r0, int(eq) - self.q0] = TERR[et]
        self.seed = seed & 0x7FFFFFFF
        self.off = ((seed % 9973) * 3.7, ((seed // 9973) % 9973) * 2.9)
        self._levels = None

    def _look(self, grid, q, r):
        tx = q - self.q0; ty = r - self.r0
        ok = (tx >= 0) & (ty >= 0) & (tx < self.dims[0]) & (ty < self.dims[1])
        return np.where(ok, grid[np.clip(ty, 0, self.dims[1] - 1), np.clip(tx, 0, self.dims[0] - 1)], 0)

    def terrain_at(self, q, r): return self._look(self.grid, q, r)
    def site_kind(self, q, r, south): return self._look(self.vs if south else self.vn, q, r)

    def rand(self, q, r, salt):
        """Случайное число клетки 0..1: зависит от клетки, зерна карты и «соли» (что именно разыгрываем)."""
        h = pcg(pcg(q.astype(np.uint32) + np.uint32((salt * 2654435761 + self.seed) & 0xFFFFFFFF)) + r.astype(np.uint32))
        return (h >> np.uint32(8)).astype(np.float32) / np.float32(16777216.0)

    # ── Общая высота материка ────────────────────────────────────────────────
    def macro(self, nx, ny):
        e0 = n01(nx / 640.0 + 13.0, ny / 640.0 + 7.0)
        return 5.0 + 50.0 * smoothstep(0.34, 0.7, e0) + 9.0 * fbm(nx / 260.0 + 3.0, ny / 260.0 + 77.0, 3)

    # ── Площадки у перекрёстков ──────────────────────────────────────────────
    def pinch(self, px, py):
        q, r = hex_at(px, py); cx, cy = hex_center(q, r)
        best = np.full(px.shape, BIG); bx = np.zeros_like(px); by = np.zeros_like(py); kind = np.zeros(px.shape, dtype=np.int32)
        for (ox, oy), (dq, dr, south) in CORNERS:
            vx = cx + ox; vy = cy + oy
            d = np.hypot(px - vx, py - vy)
            k = self.site_kind(q + dq, r + dr, bool(south))
            take = (d < best) & (k > 0)
            best = np.where(take, d, best); bx = np.where(take, vx, bx); by = np.where(take, vy, by); kind = np.where(take, k, kind)
        s = np.where(kind >= 2, smoothstep(14.0, 50.0, best), 1.0)
        return bx + (px - bx) * s, by + (py - by) * s, np.where(kind > 0, best * s, BIG)

    def port_distance(self, px, py):
        """Расстояние до ближайшего порта. Каждая вершина — северный или южный угол ровно одной клетки."""
        q0, r0 = hex_at(px, py)
        best = np.full(px.shape, BIG)
        for dq0, dr0 in RING2:
            q = q0 + dq0; r = r0 + dr0; cx, cy = hex_center(q, r)
            best = np.where(self.site_kind(q, r, False) == 3, np.minimum(best, np.hypot(px - cx, py - cy + S)), best)
            best = np.where(self.site_kind(q, r, True) == 3, np.minimum(best, np.hypot(px - cx, py - cy - S)), best)
        return best

    # ── Высота ───────────────────────────────────────────────────────────────
    def height(self, px0, py0, want_level=False):
        ox, oy = self.off
        harbor = 1.0 - smoothstep(40.0, 140.0, self.port_distance(px0, py0))
        px, py, d_site = self.pinch(px0, py0)
        nx = px + ox; ny = py + oy

        # Берег: клетки суши и моря вокруг (слабое искажение — стороны гексов остаются сушей).
        cx_ = px + 9.0 * gnoise(nx / 85.0, ny / 85.0) + 3.0 * gnoise(nx / 31.0 + 5.0, ny / 31.0)
        cy_ = py + 9.0 * gnoise(nx / 85.0 + 37.0, ny / 85.0) + 3.0 * gnoise(nx / 31.0, ny / 31.0 + 91.0)
        q0, r0 = hex_at(cx_, cy_); t0 = self.terrain_at(q0, r0)
        d_sea = np.full(px.shape, BIG); d_hard = np.full(px.shape, BIG); d_soft = np.full(px.shape, BIG)
        # Три кольца клеток: заполнение входящих углов берега смотрит на сушу до 345 м, и клетка не должна
        # появляться в расчёте скачком (иначе на дне остаётся ступенька).
        for dq, dr in RING3:
            q = q0 + dq; r = r0 + dr; t = self.terrain_at(q, r); hx, hy = hex_center(q, r)
            s = sd_hex(cx_ - hx, cy_ - hy)
            d_sea = np.where(t == 0, np.minimum(d_sea, s), d_sea)
            d_hard = np.where(t != 0, np.minimum(d_hard, s), d_hard)
            d_soft = np.where(t != 0, smin(d_soft, s, 95.0), d_soft)
        d_hard = np.minimum(d_hard, FAR); d_soft = np.minimum(d_soft, FAR)
        fill = np.maximum(d_hard - d_soft, 0.0)
        coast = np.where(t0 != 0, -np.minimum(d_sea, FAR), d_hard - fill * smoothstep(0.0, 60.0, d_hard))

        # Местности: области с сильным искажением границ.
        rx = px + 24.0 * gnoise(nx / 210.0 + 11.0, ny / 210.0) + 10.0 * gnoise(nx / 70.0 + 3.0, ny / 70.0)
        ry = py + 24.0 * gnoise(nx / 210.0, ny / 210.0 + 53.0) + 10.0 * gnoise(nx / 70.0, ny / 70.0 + 17.0)
        q1, r1 = hex_at(rx, ry); t1 = self.terrain_at(q1, r1)
        same = [np.full(px.shape, BIG) for _ in range(7)]; other = [np.full(px.shape, BIG) for _ in range(7)]
        lake_w = np.zeros(px.shape, dtype=np.float32); lake_e = np.zeros(px.shape, dtype=np.float32)
        for dq, dr in RING2:
            q = q1 + dq; r = r1 + dr; t = self.terrain_at(q, r); hx, hy = hex_center(q, r)
            s = sd_hex(rx - hx, ry - hy)
            for k in range(7):
                same[k] = np.where(t == k, np.minimum(same[k], s), same[k])
                other[k] = np.where(t != k, np.minimum(other[k], s), other[k])
            wet = (t == 5) | (t == 6)
            if wet.any():
                # Земля вокруг озера выравнивается по его уровню: озеро лежит в своей котловине.
                infl = np.where(wet, 1.0 - smoothstep(70.0, 220.0, np.hypot(px - hx, py - hy) + 30.0 * gnoise(nx / 120.0 + 15.0, ny / 120.0)), 0.0)
                lake_w = lake_w + infl; lake_e = lake_e + infl * (self.wet_level(q, r) + 2.0)
        inside = [np.where(t1 == k, np.minimum(other[k], FAR), -np.minimum(same[k], FAR)) for k in range(7)]

        E = self.macro(nx, ny)
        E = np.where(lake_w > 0, E + (lake_e / np.maximum(lake_w, 1e-6) - E) * np.minimum(lake_w, 1.0), E)
        E = E + (4.5 - E) * 0.9 * harbor
        w = [None] + [smoothstep(-30.0, 30.0, inside[k]) for k in range(1, 7)]
        wsum = sum(w[1:]) + 1e-5
        relief = np.zeros(px.shape, dtype=np.float32)
        # пустыня: барханы
        wx = nx + 26.0 * gnoise(nx / 190.0, ny / 190.0 + 7.0); wy = ny + 26.0 * gnoise(nx / 190.0 + 3.0, ny / 190.0)
        ridge = 1.0 - np.abs(gnoise((wx * 0.94 + wy * 0.34) / 46.0, (-wx * 0.34 + wy * 0.94) / 150.0))
        patches = smoothstep(-0.25, 0.35, gnoise(nx / 230.0 + 9.0, ny / 230.0 + 4.0))
        dunes = -1.0 + 2.0 * fbm(nx / 260.0 + 11.0, ny / 260.0, 3) + 5.5 * ridge ** 3 * (0.35 + 0.65 * patches)
        relief += w[1] * dunes * smoothstep(-20.0, 30.0, inside[1]) + w[6] * dunes * 0.3
        # холмы
        f = np.clip(0.5 + 0.75 * fbm(nx / 135.0 + 5.0, ny / 135.0 + 9.0, 4), 0.0, 1.0)
        hills = 1.5 + 40.0 * np.power(f, 1.6) + 5.0 * fbm(nx / 62.0 + 13.0, ny / 62.0, 2) + 2.2 * fbm(nx / 38.0, ny / 38.0 + 20.0, 3)
        relief += w[2] * hills * smoothstep(-22.0, 72.0, inside[2])
        # луга и берега озёр
        meadow = 1.5 * fbm(nx / 200.0, ny / 200.0, 3) + 0.8 * fbm(nx / 60.0 + 40.0, ny / 60.0, 2)
        relief += (w[3] + w[5]) * meadow
        h = E + relief / wsum

        h = h + self.mountains(px, py, nx, ny)
        # Суша не опускается ниже двух метров над морем: иначе в низине посреди острова проступило бы море.
        h = smax(h, 2.0, 3.0)

        # Берег: обрыв или пляж.
        bulge = n01(nx / 520.0 + 71.0, ny / 520.0 + 13.0)
        cliff = smoothstep(12.0, 30.0, E) * smoothstep(0.3, 0.55, n01(nx / 260.0 + 31.0, ny / 260.0 + 9.0)) * (1.0 - harbor) * (1.0 - smoothstep(120.0, 200.0, coast))
        off = smax(30.0 + 16.0 * cliff, 34.0 + 110.0 * bulge * bulge + 18.0 * gnoise(nx / 170.0, ny / 170.0 + 50.0) + 6.0 * gnoise(nx / 60.0 + 9.0, ny / 60.0), 12.0)
        shore = off - coast
        # У самой воды мысы и бухточки сходят на нет: суша начинается от уреза без ступеньки.
        rugged = cliff * (10.0 * gnoise(nx / 70.0, ny / 70.0 + 3.0) + 4.0 * gnoise(nx / 27.0 + 7.0, ny / 27.0)) * smoothstep(0.0, 12.0, shore)
        foot = 4.0 - cliff
        # Обрыв крутой, но не стена: чем выше берег, тем шире склон (гора сходит в море склоном градусов в шестьдесят).
        ramp = smoothstep(foot, np.maximum(95.0 - 77.0 * cliff, foot + 0.6 * h), shore + rugged)
        beach = 2.4 * (1.0 - np.exp(-np.maximum(shore, 0.0) / 14.0))
        land = beach + (h - beach) * ramp
        out = np.maximum(-shore, 0.0)
        shelf = (38.0 + 50.0 * n01(nx / 380.0 + 31.7, ny / 380.0 + 8.0)) * (1.0 - 0.6 * cliff)
        shallow = (0.1 + 0.5 * cliff) * np.minimum(out, 12.0) + 3.5 * smoothstep(0.0, 0.6 * shelf, out) + 25.3 * smoothstep(0.5 * shelf, 1.6 * shelf, out)
        sea = -np.maximum(shallow, 30.0 * smoothstep(150.0, 245.0, coast))
        h = np.where(shore > 0.0, land, sea)

        h, level = self.lakes(px, py, nx, ny, d_site, h)
        return (h.astype(np.float32), level) if want_level else h.astype(np.float32)

    # ── Горы: хребты по цепочкам горных клеток ───────────────────────────────
    def mountains(self, px, py, nx, ny):
        ox, oy = self.off
        mx = px + 30.0 * gnoise(nx / 330.0 + 21.0, ny / 330.0) + 8.0 * gnoise(nx / 90.0, ny / 90.0 + 41.0)
        my = py + 30.0 * gnoise(nx / 330.0, ny / 330.0 + 77.0) + 8.0 * gnoise(nx / 90.0 + 41.0, ny / 90.0)
        q0, r0 = hex_at(mx, my)
        out = np.zeros(px.shape, dtype=np.float32)
        near = np.zeros(px.shape, dtype=bool)
        for dq, dr in RING2:
            near |= self.terrain_at(q0 + dq, r0 + dr) == 4
        if not near.any(): return out
        idx = np.nonzero(near)
        X = mx[idx]; Y = my[idx]; Q0 = q0[idx]; R0 = r0[idx]
        M = np.zeros(X.shape, dtype=np.float32)
        def peak(q, r):
            hx, hy = hex_center(q, r)
            return hx + (self.rand(q, r, 11) - 0.5) * 60.0, hy + (self.rand(q, r, 12) - 0.5) * 60.0
        def summit(q, r): return 62.0 + 70.0 * np.power(self.rand(q, r, 13), 1.5)
        def width(q, r): return 82.0 + 30.0 * self.rand(q, r, 14)
        for dq, dr in RING2:
            q = Q0 + dq; r = R0 + dr
            mount = self.terrain_at(q, r) == 4
            if not mount.any(): continue
            hx, hy = hex_center(q, r)
            # Простирание хребтов: общее для карты, плавно гуляет по месту.
            ang = (self.seed % 628) / 100.0 + 2.2 * gnoise((hx + ox) / 900.0, (hy + oy) / 900.0)
            sx, sy = np.cos(ang), np.sin(ang)
            ax, ay = peak(q, r); ha = summit(q, r); wa = width(q, r)
            # Короткий гребень самой вершины вдоль простирания.
            ln = 18.0 + 30.0 * self.rand(q, r, 15)
            d, t = seg_dist(X, Y, ax - sx * ln, ay - sy * ln, ax + sx * ln, ay + sy * ln)
            M = np.where(mount, ridge_join(M, ha * np.power(np.maximum(1.0 - d / wa, 0.0), 1.5)), M)
            # Связь с соседней горной клеткой вперёд по простиранию: хребет с перевалом там, где его пересекает дорога.
            best = np.full(X.shape, 0.25); bq = np.zeros_like(q); br = np.zeros_like(r); has = np.zeros(X.shape, dtype=bool)
            for k, (nq, nr) in enumerate(SIDES):
                ux, uy = hex_center(np.int32(nq), np.int32(nr)); ul = math.hypot(ux, uy)
                al = (ux * sx + uy * sy) / ul
                ok = mount & (self.terrain_at(q + nq, r + nr) == 4) & (al > best)
                best = np.where(ok, al, best); bq = np.where(ok, q + nq, bq); br = np.where(ok, r + nr, br); has |= ok
            if has.any():
                bx, by = peak(bq, br); hb = summit(bq, br); wb = width(bq, br)
                d, t = seg_dist(X, Y, ax, ay, bx, by)
                dip = 0.3 + 0.35 * self.rand(q + bq, r * 3 + br, 16)
                crest = (ha + (hb - ha) * t) * (1.0 - dip * np.exp(-np.square((t - 0.5) / 0.2)))
                wd = wa + (wb - wa) * t
                M = np.where(has, ridge_join(M, crest * np.power(np.maximum(1.0 - d / wd, 0.0), 1.5)), M)
        NX = nx[idx]; NY = ny[idx]
        M = M * (0.72 + 0.56 * ridged(NX / 170.0 + 3.0, NY / 170.0 + 1.0, 5)) + 6.0 * fbm(NX / 40.0, NY / 40.0, 3) * np.clip(M / 40.0, 0.0, 1.0)
        out[idx] = M
        return out

    # ── Озёра и пруды ────────────────────────────────────────────────────────
    def wet(self, q, r):
        t = self.terrain_at(q, r)
        return (t == 5) | (t == 6)

    def wet_level(self, q, r):
        """Уровень воды клетки. Соседние водные клетки — одно озеро: уровень общий (по самой низкой из них).
        Уровни разных озёр по соседству не совпадают: к уровню добавлена «ячейка» от клетки — так вода одного озера
        не рисуется в чаше другого. Уровень зависит только от клетки, поэтому считается один раз на карту."""
        if self._levels is None:
            rr, qq = np.meshgrid(np.arange(self.dims[1]) + self.r0, np.arange(self.dims[0]) + self.q0, indexing="ij")
            self._levels = self._wet_level_of(qq.astype(np.int32), rr.astype(np.int32)).astype(np.float32)
        return self._look(self._levels, q, r)

    def _wet_level_of(self, q, r):
        ox, oy = self.off
        hx, hy = hex_center(q, r)
        low = self.macro(hx + ox, hy + oy); lq = q.copy(); lr = r.copy()
        for nq, nr in SIDES:
            q1 = q + nq; r1 = r + nr; w1 = self.wet(q1, r1)
            if not w1.any(): continue
            x1, y1 = hex_center(q1, r1); m1 = self.macro(x1 + ox, y1 + oy)
            take = w1 & (m1 < low); low = np.where(take, m1, low); lq = np.where(take, q1, lq); lr = np.where(take, r1, lr)
            for mq, mr in SIDES:
                q2 = q1 + mq; r2 = r1 + mr; w2 = w1 & self.wet(q2, r2)
                if not w2.any(): continue
                x2, y2 = hex_center(q2, r2); m2 = self.macro(x2 + ox, y2 + oy)
                take = w2 & (m2 < low); low = np.where(take, m2, low); lq = np.where(take, q2, lq); lr = np.where(take, r2, lr)
        slot = (np.mod(lq, 5) + 5 * np.mod(lr, 5)).astype(np.float32)
        raw = np.maximum(low - 2.0, 2.0)
        return 2.0 + np.floor((raw - 2.0) / 3.125) * 3.125 + slot * 0.125

    def lakes(self, px, py, nx, ny, d_site, h):
        level = np.full(px.shape, -999.0, dtype=np.float32)
        q0, r0 = hex_at(px, py)
        near = np.zeros(px.shape, dtype=bool)
        for dq, dr in RING2:
            near |= self.wet(q0 + dq, r0 + dr)
        if not near.any(): return h, level
        idx = np.nonzero(near)
        X = px[idx]; Y = py[idx]; NX = nx[idx]; NY = ny[idx]; Q0 = q0[idx]; R0 = r0[idx]; H = h[idx]; DS = d_site[idx]
        # Берег гуляет: точка сдвигается шумом, прямые заливы становятся извилистыми.
        LX = X + 22.0 * gnoise(NX / 150.0 + 60.0, NY / 150.0) + 8.0 * gnoise(NX / 52.0, NY / 52.0 + 33.0)
        LY = Y + 22.0 * gnoise(NX / 150.0, NY / 150.0 + 60.0) + 8.0 * gnoise(NX / 52.0 + 33.0, NY / 52.0)
        D = np.full(X.shape, BIG); L = np.zeros(X.shape, dtype=np.float32)
        WS = np.zeros(X.shape, dtype=np.float32); LS = np.zeros(X.shape, dtype=np.float32); BS = np.zeros(X.shape, dtype=np.float32)
        for dq, dr in RING2:
            q = Q0 + dq; r = R0 + dr; t = self.terrain_at(q, r)
            lake = t == 5; pond = t == 6
            if not (lake.any() or pond.any()): continue
            hx, hy = hex_center(q, r)
            lvl = self.wet_level(q, r)
            # главная чаша: вытянутая, смещённая от центра гекса
            mxo = hx + (self.rand(q, r, 21) - 0.5) * np.where(lake, 44.0, 36.0); myo = hy + (self.rand(q, r, 22) - 0.5) * np.where(lake, 44.0, 36.0)
            th = self.rand(q, r, 23) * math.pi; ca, sa = np.cos(th), np.sin(th)
            ra = np.where(lake, 52.0 + 20.0 * self.rand(q, r, 24), 20.0 + 6.0 * self.rand(q, r, 24)); rb = np.where(lake, 36.0 + 14.0 * self.rand(q, r, 25), 15.0 + 5.0 * self.rand(q, r, 25))
            ux = (LX - mxo) * ca + (LY - myo) * sa; uy = -(LX - mxo) * sa + (LY - myo) * ca
            d = (np.hypot(ux / ra, uy / rb) - 1.0) * rb
            # Плёсы: вторая и третья чаша поменьше за стороной гекса, слитые с главной широкой протокой.
            # Не больше двух — озеро остаётся цельным, а не «звездой». К соседнему озеру протока есть всегда.
            k1 = np.floor(self.rand(q, r, 30) * 6.0).astype(np.int32)
            k2 = np.mod(k1 + 2 + np.floor(self.rand(q, r, 31) * 3.0).astype(np.int32), 6)
            second = self.rand(q, r, 32) < 0.55
            for k, (nq, nr) in enumerate(SIDES):
                tn = self.terrain_at(q + nq, r + nr)
                vx, vy = hex_center(np.int32(nq), np.int32(nr)); vl = math.hypot(vx, vy); vx /= vl; vy /= vl
                arm = lake & ((tn == 1) | (tn == 2) | (tn == 3)) & ((k1 == k) | ((k2 == k) & second))
                join = lake & (tn == 5)
                if not (arm.any() or join.any()): continue
                side = np.where(join, 0.0, (self.rand(q, r, 40 + k) - 0.5) * 80.0)
                reach = np.where(join, A, A - 14.0 + 52.0 * self.rand(q, r, 50 + k))
                bx = hx + vx * reach - vy * side; by = hy + vy * reach + vx * side
                dn, tt = seg_dist(LX, LY, mxo, myo, bx, by)
                bulb = np.where(join, 30.0, 26.0 + 20.0 * self.rand(q, r, 70 + k))
                neck = np.where(join, 30.0, bulb * (0.55 + 0.3 * self.rand(q, r, 60 + k)))
                dk = dn - (neck + (bulb - neck) * smoothstep(0.5, 1.0, tt))
                d = np.where(arm | join, smin(d, dk, 34.0), d)
            wet = lake | pond
            take = wet & (d < D)
            D = np.where(take, d, D); L = np.where(take, lvl, L)
            # Между двумя близкими озёрами берег подстраивается под оба уровня плавно.
            wgt = np.where(wet, np.exp(-np.clip(d, 0.0, 200.0) / 14.0), 0.0)
            WS = WS + wgt; LS = LS + wgt * lvl; BS = BS + wgt * np.where(lake, 26.0, 16.0)
        # перекрёстки и города остаются на суше: вода обходит их пологим мысом, а не круглой выемкой
        D = smax(D, 24.0 - DS, 18.0)
        D = D + 7.0 * gnoise(NX / 64.0, NY / 64.0 + 4.0) + 3.5 * gnoise(NX / 27.0 + 8.0, NY / 27.0) + 1.5 * gnoise(NX / 11.0, NY / 11.0 + 5.0)
        soft = LS / np.maximum(WS, 1e-12); band = BS / np.maximum(WS, 1e-12)
        depth = np.minimum(np.minimum(0.22 * np.maximum(-D, 0.0), 6.5), L - 0.5)
        target = np.where(D < 0.0, soft - depth, soft + 0.1 * D)
        # берег не ниже уровня воды только рядом с озером; дальше земля свободна
        bank = 1.0 - smoothstep(band, band + 45.0, D)
        Hc = H + (np.maximum(H, soft + 1.5) - H) * bank
        # высокий берег сходит к воде склоном, а не стеной: чем выше земля над водой, тем шире склон
        band = np.minimum(np.maximum(band, 2.4 * (Hc - soft)), 110.0)
        wl = 1.0 - smoothstep(0.0, band, D)
        H2 = Hc * (1.0 - wl) + target * wl
        hit = D < 1e5
        h = h.copy(); h[idx] = np.where(hit, H2, H)
        lv = level[idx]; lv = np.where(hit & (D < 4.0), L, lv); level[idx] = lv
        return h, level
