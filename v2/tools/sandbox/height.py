# Песочница формы земли: функция высоты из шейдера src/terrain/height.gdshaderinc, повторённая на numpy один в один.
# Форму подбираем здесь (движок для этого запускать не нужно), затем переносим правку в шейдер; конвейер сверяет
# высоты игры с песочницей (compare.py). Любая правка функции высот делается в обоих местах.
# Переменные окружения для проверок: SEED=число — другое зерно карты; EXTRA="q,r,местность;…" — подменить гексы.
import json, math, os, struct
from pathlib import Path
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

def mix(a, b, t):
    return a + (b - a) * t

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

def load_shapes(path):
    """Поля расстояний малых островов (v2/tools/islet-shapes.py): номер картинки → массив сторона×сторона,
    расстояние до берега в долях половины стороны картинки, внутри острова — отрицательное."""
    raw = Path(path).read_bytes()
    assert raw[:8] == b"LOTWISL1", "неизвестный файл очертаний островов"
    count, size, extent, limit = struct.unpack_from("<BHff", raw, 8)
    at = 8 + struct.calcsize("<BHff"); shapes = {}
    for _ in range(count):
        number = raw[at]; at += 1
        data = np.frombuffer(raw, dtype="<u2", count=size * size, offset=at).reshape(size, size); at += size * size * 2
        shapes[number] = ((data.astype(np.float32) / 65535.0) * 2.0 - 1.0) * limit
    return shapes, extent

def bump(u, v, u0, v0, radius, height):
    """Скала или бугор на островке: вершина в точке (u0, v0) картинки, радиус в долях половины стороны."""
    return height * np.power(np.maximum(1.0 - np.hypot(u - u0, v - v0) / radius, 0.0), 1.5)

def sd_box(u, v, hu, hv):
    qx = np.abs(u) - hu; qy = np.abs(v) - hv
    return np.hypot(np.maximum(qx, 0.0), np.maximum(qy, 0.0)) + np.minimum(np.maximum(qx, qy), 0.0)

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
        # Клетки суши у моря: по ним считается расстояние до главных островов вдали от берега.
        land = {(h[0], h[1]) for h in w["hexes"]}
        self.coastal = [c for c in sorted(land) if any((c[0] + dq, c[1] + dr) not in land for dq, dr in SIDES)]
        # Малые острова: [x, z, r, картинка, охват, каменоломня] и поля расстояний до берега по картинкам сайта.
        self.islets = [tuple(row) for row in w.get("islets", [])]
        self.shapes, self.shape_extent = load_shapes(Path(__file__).resolve().parents[2] / "data" / "islets.bin")

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

    # ── Главные острова ──────────────────────────────────────────────────────
    def field(self, px0, py0):
        """Суша главных островов: высота земли, расстояние до уреза воды (shore > 0 — суша) и крутизна берега."""
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
        return {"shore": shore, "land": land, "cliff": cliff, "p": (px, py), "n": (nx, ny), "d_site": d_site}

    # ── Высота ───────────────────────────────────────────────────────────────
    def far_coast(self, px, py):
        """Расстояние до ближайшей клетки суши главных островов (для точек моря — точное)."""
        best = np.full(px.shape, BIG)
        for q, r in self.coastal:
            hx, hy = hex_center(q, r)
            best = np.minimum(best, sd_hex(px - hx, py - hy))
        return best

    def height(self, px0, py0, want_level=False):
        """Высота мира: главные острова, малые острова и дно. Возвращает высоту и (по просьбе) уровень воды озёр."""
        ox, oy = self.off
        shape = px0.shape
        px0 = np.asarray(px0, dtype=np.float32).ravel(); py0 = np.asarray(py0, dtype=np.float32).ravel()
        nx = px0 + ox; ny = py0 + oy
        d_far = self.far_coast(px0, py0)
        # Главные острова считаем только на их клетках и рядом с ними: дальше 380 м от берега это открытое море.
        # (Расстояние до берега считается по береговым клеткам, поэтому середина острова проверяется отдельно.)
        s_f = np.full(px0.shape, 250.0, dtype=np.float32); land_f = np.zeros(px0.shape, dtype=np.float32); cliff_f = np.zeros(px0.shape, dtype=np.float32)
        q_here, r_here = hex_at(px0, py0)
        near = np.nonzero((d_far < 380.0) | (self.terrain_at(q_here, r_here) != 0))[0]
        fld = None
        if near.size:
            fld = self.field(px0[near], py0[near])
            s_f[near] = -fld["shore"]; land_f[near] = fld["land"]; cliff_f[near] = fld["cliff"]
        isl = self.islet_surface(px0, py0, nx, ny)
        s_i = isl["s"]
        s = np.minimum(s_f, s_i)
        cliff = np.where(s_f <= s_i, cliff_f, isl["cliff"])
        out = np.maximum(s, 0.0)
        # Расстояние «для шельфа»: у главных островов он широкий, у малых — уже.
        d_field = mix(np.maximum(s_f, 0.0), np.maximum(d_far - 60.0, 0.0), smoothstep(200.0, 330.0, d_far))
        d_shelf = smin(d_field, isl["shelf"], 160.0)
        depth = self.near_shore(out, cliff, nx, ny) + self.shelf_slope(d_shelf, nx, ny) * smoothstep(0.0, 60.0, out)
        sea = -np.minimum(depth, isl["cap"])
        h = np.where(s_f < 0.0, land_f, np.where(s_i < 0.0, isl["land"], sea)).astype(np.float32)
        level = isl["level"].astype(np.float32)
        if fld is not None:
            hn, ln = self.lakes(fld["p"][0], fld["p"][1], fld["n"][0], fld["n"][1], fld["d_site"], h[near])
            h[near] = hn; level[near] = np.where(ln > -900.0, ln, level[near])
        h = h.reshape(shape); level = level.reshape(shape)
        return (h, level) if want_level else h

    def near_shore(self, out, cliff, nx, ny):
        """Дно у самого берега: у пляжа — отмель, у обрыва — сразу глубоко. Дальше 200 м от берега одинаково."""
        shelf0 = (38.0 + 50.0 * n01(nx / 380.0 + 31.7, ny / 380.0 + 8.0)) * (1.0 - 0.6 * cliff)
        edge = np.minimum(out, 12.0)
        return 0.1 * edge + 0.5 * cliff * edge * (1.0 - smoothstep(60.0, 200.0, out)) + 3.5 * smoothstep(0.0, 0.6 * shelf0, out)

    def shelf_slope(self, d, nx, ny):
        """Шельф, свал и глубина: d — расстояние от берега. Шельф светлый и широкий, с банками; за ним дно
        уходит на глубину с подводными грядами и впадинами. Далеко от суши дно ровное."""
        width = 560.0 + 220.0 * gnoise(nx / 700.0 + 5.0, ny / 700.0 + 9.0)
        shelf = (9.0 + 3.0 * fbm(nx / 260.0 + 40.0, ny / 260.0 + 2.0, 2)) * smoothstep(30.0, 420.0, d)
        shoal = 4.5 * np.power(np.maximum(gnoise(nx / 170.0 + 8.0, ny / 170.0 + 60.0), 0.0), 1.5) * smoothstep(60.0, 220.0, d) * (1.0 - smoothstep(width - 120.0, width + 60.0, d))
        relief = 26.0 * fbm(nx / 1500.0 + 3.0, ny / 1500.0 + 3.0, 3) - 20.0 * (ridged(nx / 900.0 + 17.0, ny / 900.0 + 5.0, 3) - 0.45)
        deep = 70.0 + relief * (1.0 - smoothstep(1500.0, 2400.0, d))
        return shelf - shoal + np.maximum(deep - 16.0, 10.0) * smoothstep(width, width + 420.0, d)

    # ── Малые острова ────────────────────────────────────────────────────────
    def shape_sd(self, img, u, v):
        """Расстояние до берега островка по его картинке, в долях половины стороны (внутри — отрицательное)."""
        field = self.shapes[img]; size = field.shape[0]; ext = self.shape_extent
        qu = np.clip(u, -ext, ext); qv = np.clip(v, -ext, ext)
        fx = np.clip((qu / ext * 0.5 + 0.5) * size - 0.5, 0.0, size - 1.0); fy = np.clip((qv / ext * 0.5 + 0.5) * size - 0.5, 0.0, size - 1.0)
        x0 = np.minimum(np.floor(fx).astype(np.int32), size - 2); y0 = np.minimum(np.floor(fy).astype(np.int32), size - 2)
        tx = fx - x0; ty = fy - y0
        top = field[y0, x0] * (1 - tx) + field[y0, x0 + 1] * tx; bottom = field[y0 + 1, x0] * (1 - tx) + field[y0 + 1, x0 + 1] * tx
        return top * (1 - ty) + bottom * ty + np.hypot(u - qu, v - qv)

    def islet_surface(self, px, py, nx, ny):
        """Малые острова: расстояние до суши ближайшего (s < 0 — суша), её высота, крутизна берега, расстояние
        «для шельфа», предел глубины (лагуна) и уровень воды пруда."""
        n = px.shape
        res = {"s": np.full(n, BIG, dtype=np.float32), "land": np.zeros(n, dtype=np.float32), "cliff": np.zeros(n, dtype=np.float32),
               "shelf": np.full(n, BIG, dtype=np.float32), "cap": np.full(n, BIG, dtype=np.float32), "level": np.full(n, -999.0, dtype=np.float32)}
        for index, (x, z, r, img, cover, quarry) in enumerate(self.islets):
            idx = np.nonzero(np.hypot(px - x, py - z) < 1.45 * r + 1100.0)[0]
            if not idx.size: continue
            X = px[idx]; Y = py[idx]; NX = nx[idx]; NY = ny[idx]
            # Берег гуляет: мелкие мысы и бухточки поверх очертания с картинки.
            wx = X + 6.0 * gnoise(NX / 55.0 + 3.0 * index, NY / 55.0) + 2.5 * gnoise(NX / 21.0, NY / 21.0 + 3.0 * index)
            wy = Y + 6.0 * gnoise(NX / 55.0, NY / 55.0 + 3.0 * index + 50.0) + 2.5 * gnoise(NX / 21.0 + 3.0 * index + 50.0, NY / 21.0)
            u = (wx - x) / r; v = (wy - z) / r
            sd = np.maximum(self.shape_sd(img, u, v) * r, np.hypot(X - x, Y - z) - 1.05 * r)
            part = self.islet_kind(img, u, v, sd, r, NX, NY)
            s_land = part["s"]; H = np.maximum(part["h"], 1.0); c = part["cliff"]
            shore = -s_land
            rugged = c * (8.0 * gnoise(NX / 60.0, NY / 60.0 + 3.0) + 3.0 * gnoise(NX / 24.0 + 7.0, NY / 24.0)) * smoothstep(0.0, 12.0, shore)
            foot = 4.0 - c
            wide = part["wide"]
            ramp = smoothstep(foot, np.maximum(wide - (wide - 18.0) * c, foot + 0.6 * H), shore + rugged)
            beach = 2.4 * (1.0 - np.exp(-np.maximum(shore, 0.0) / 14.0))
            land = beach + (H - beach) * ramp
            take = s_land < res["s"][idx]
            res["s"][idx] = np.where(take, s_land, res["s"][idx]); res["land"][idx] = np.where(take, land, res["land"][idx]); res["cliff"][idx] = np.where(take, c, res["cliff"][idx])
            res["shelf"][idx] = np.minimum(res["shelf"][idx], np.maximum(s_land, 0.0) * part["narrow"])
            res["cap"][idx] = np.minimum(res["cap"][idx], part["cap"])
            res["level"][idx] = np.where(part["level"] > -900.0, part["level"], res["level"][idx])
        return res

    def islet_kind(self, img, u, v, sd, r, nx, ny):
        """Характер островка по его картинке на сайте. u, v — место на картинке (от −1 до 1, v вниз — на юг),
        sd — расстояние до очертания в метрах. Возвращает: s — расстояние до суши, h — высота земли без берега,
        cliff — крутизна берега, wide — ширина пляжного склона, narrow — во сколько раз уже шельф,
        cap — предел глубины (лагуна), level — уровень воды пруда."""
        inland = -sd
        rocky = 0.75 + 0.5 * ridged(nx / 80.0 + 2.0, ny / 80.0 + 6.0, 4)
        roll = fbm(nx / 75.0 + 9.0, ny / 75.0 + 1.0, 3)
        none = np.full(sd.shape, BIG, dtype=np.float32); dry = np.full(sd.shape, -999.0, dtype=np.float32)
        out = {"s": sd, "cliff": np.zeros(sd.shape, dtype=np.float32), "wide": 45.0, "narrow": 2.2, "cap": none, "level": dry}
        if img == 1:
            # Зелёный остров-звезда: луга и рощи, несколько скальных выходов.
            h = 3.5 + 6.5 * smoothstep(0.0, 110.0, inland) + 2.2 * roll * smoothstep(10.0, 60.0, inland)
            rocks = bump(u, v, 0.375, -0.52, 0.27, 34.0) + bump(u, v, -0.84, -0.46, 0.13, 13.0) + bump(u, v, -0.36, 0.30, 0.20, 19.0) + bump(u, v, -0.25, -0.12, 0.10, 8.0) + bump(u, v, 0.14, 0.05, 0.10, 8.0)
            out["h"] = h + rocks * rocky
        elif img == 6:
            # Зелёный остров с ручьём и прудом: ручей бежит с горки в пруд и из пруда к морю.
            h = 3.5 + 7.0 * smoothstep(0.0, 110.0, inland) + 2.2 * roll * smoothstep(10.0, 60.0, inland)
            rocks = bump(u, v, -0.46, -0.66, 0.22, 30.0) + bump(u, v, 0.50, 0.14, 0.13, 15.0) + bump(u, v, 0.36, -0.22, 0.09, 8.0) + bump(u, v, -0.30, 0.30, 0.08, 6.0)
            h = h + rocks * rocky
            stream = np.full(sd.shape, BIG, dtype=np.float32)
            for (ax, ay), (bx, by) in zip([(-0.36, -0.50), (-0.12, -0.20), (0.07, 0.11), (0.29, 0.39)], [(-0.12, -0.20), (0.07, 0.11), (0.29, 0.39), (0.42, 0.58)]):
                stream = np.minimum(stream, seg_dist(u, v, ax, ay, bx, by)[0])
            h = np.maximum(h - 1.6 * (1.0 - smoothstep(0.0, 9.0, stream * r)), 1.2)
            water = 8.0
            dp = (np.hypot(u - 0.07, v - 0.11) - 0.14) * r + 5.0 * gnoise(nx / 30.0 + 4.0, ny / 30.0)
            held = h + (np.maximum(h, water + 1.2) - h) * (1.0 - smoothstep(16.0, 50.0, dp))
            basin = np.where(dp < 0.0, water - np.minimum(0.22 * np.maximum(-dp, 0.0), 3.0), water + 0.1 * dp)
            out["h"] = mix(held, basin, 1.0 - smoothstep(0.0, 16.0, dp))
            out["level"] = np.where(dp < 4.0, water, -999.0).astype(np.float32)
        elif img == 2:
            # Вытянутый сухой остров со скалистым хребтом вдоль него.
            h = 3.0 + 5.0 * smoothstep(0.0, 70.0, inland) + 1.5 * roll
            ridge = np.zeros(sd.shape, dtype=np.float32)
            points = [(0.60, -0.65, 46.0), (0.25, -0.10, 56.0), (-0.15, 0.45, 40.0), (-0.50, 0.50, 20.0)]
            for (ax, ay, ha), (bx, by, hb) in zip(points[:-1], points[1:]):
                d, t = seg_dist(u, v, ax, ay, bx, by)
                ridge = np.maximum(ridge, (ha + (hb - ha) * t) * np.power(np.maximum(1.0 - d / 0.30, 0.0), 1.5))
            out["h"] = h + ridge * rocky
            out["cliff"] = (0.4 * smoothstep(0.35, 0.6, n01(nx / 150.0 + 2.0, ny / 150.0))).astype(np.float32)
            out["wide"] = 35.0
        elif img == 5:
            # Скалистый остров-столовая гора: уступы один над другим, наверху вершина; берег — обрывы.
            t = inland / (0.40 * r) + 0.12 * fbm(nx / 60.0 + 5.0, ny / 60.0 + 7.0, 2)
            raw = 5.0 + 40.0 * smoothstep(0.0, 1.0, t)
            g = raw / 11.0; whole = np.floor(g)
            stepped = (whole + smoothstep(0.35, 0.65, g - whole)) * 11.0
            out["h"] = mix(raw, stepped, 0.72) + bump(u, v, 0.43, -0.32, 0.22, 16.0) * rocky
            out["cliff"] = (0.15 + 0.85 * smoothstep(0.3, 0.6, n01(nx / 140.0 + 12.0, ny / 140.0 + 3.0))).astype(np.float32)
            out["wide"] = 30.0
        elif img == 3:
            # Полумесяц с лагуной: суша — узкая дуга, внутри мелкая лагуна, от моря её отделяет подводная гряда.
            lagoon = (0.68 - np.hypot(u - 0.03, v + 0.03)) * r + 5.0 * gnoise(nx / 35.0 + 6.0, ny / 35.0)
            s_land = np.maximum(sd, lagoon)
            out["s"] = s_land
            out["h"] = 2.2 + 4.5 * smoothstep(0.0, 28.0, -s_land) + 1.0 * fbm(nx / 40.0 + 2.0, ny / 40.0, 2)
            floor = 0.6 + 1.9 * smoothstep(0.0, 30.0, np.minimum(s_land, -sd)) - 1.2 * smoothstep(0.5, 0.8, gnoise(nx / 16.0 + 1.0, ny / 16.0 + 8.0))
            floor = np.where((sd < 0.0) & (lagoon > 0.0), np.maximum(floor, 0.25), BIG)
            bar = np.where(lagoon > 0.0, 0.7 + 0.12 * np.abs(sd) + 40.0 * (1.0 - smoothstep(0.0, 25.0, lagoon)), BIG)
            out["cap"] = np.minimum(floor, bar).astype(np.float32)
            out["wide"] = 18.0
        elif img == 4:
            # Песчаная банка: низкая, пологая, с рощицей; вокруг широкая отмель.
            out["h"] = 1.0 + 2.0 * smoothstep(0.0, 30.0, inland) + 0.5 * fbm(nx / 30.0 + 3.0, ny / 30.0 + 3.0, 2) + bump(u, v, -0.07, 0.0, 0.12, 1.4) + bump(u, v, 0.60, -0.25, 0.05, 3.5)
            out["wide"] = 20.0
            out["narrow"] = 1.3
        else:
            # Каменоломня: каменистое плато, к северу оно поднимается холмом со скалами; в склон холма врезан
            # карьер уступами, открытый к югу на плато; на юго-востоке у воды ровная площадка под причал.
            h = 4.0 + 8.0 * smoothstep(0.0, 60.0, inland) + 1.2 * roll + bump(u, v, -0.14, -0.34, 0.62, 21.0)
            rocks = (bump(u, v, 0.25, -0.82, 0.30, 26.0) + bump(u, v, -0.25, -0.72, 0.26, 20.0) + bump(u, v, 0.02, -0.62, 0.22, 18.0) + bump(u, v, -0.66, -0.36, 0.20, 15.0)
                     + bump(u, v, 0.62, -0.30, 0.20, 13.0) + bump(u, v, -0.56, 0.36, 0.16, 11.0) + bump(u, v, 0.47, 0.25, 0.14, 9.0) + bump(u, v, -0.20, 0.76, 0.14, 9.0))
            h = h + rocks * rocky
            cu, cv = -0.14, -0.16
            pit = np.minimum(sd_box(u - cu, v - cv, 0.15, 0.12), sd_box(u - cu, v - (cv + 0.20), 0.11, 0.20)) * r
            x_ = np.maximum(pit, 0.0) / (0.042 * r); whole = np.floor(x_)
            stairs = whole + smoothstep(0.7, 1.0, x_ - whole)
            h = np.minimum(h, 11.5 + 5.0 * stairs)
            pier = np.hypot(u - 0.50, v - 0.71) * r
            out["h"] = mix(1.8, h, smoothstep(14.0, 40.0, pier))
            out["cliff"] = (0.75 * (1.0 - smoothstep(-0.45, -0.05, v)) * smoothstep(0.3, 0.55, n01(nx / 130.0 + 4.0, ny / 130.0 + 4.0))).astype(np.float32)
            out["wide"] = 40.0
        return out

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
