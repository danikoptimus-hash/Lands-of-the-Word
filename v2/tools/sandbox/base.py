# Основа песочницы формы земли: шум и геометрия гексов — те же формулы, что в шейдерах
# src/terrain/hex.gdshaderinc и height.gdshaderinc, на numpy.
import math
import numpy as np

S = 100.0; A = 86.60254; R3 = math.sqrt(3.0)

def pcg(v):
    v = v.astype(np.uint32)
    state = v * np.uint32(747796405) + np.uint32(2891336453)
    word = ((state >> ((state >> np.uint32(28)) + np.uint32(4))) ^ state) * np.uint32(277803737)
    return (word >> np.uint32(22)) ^ word

def hash2(ix, iy):
    return pcg(ix.astype(np.uint32) + pcg(iy.astype(np.uint32)))

def grad(ix, iy):
    h = hash2(ix, iy)
    a = (h & np.uint32(65535)).astype(np.float32) * np.float32(6.28318530718 / 65536.0)
    return np.cos(a), np.sin(a)

def gnoise(px, py):
    ix = np.floor(px); iy = np.floor(py)
    fx = px - ix; fy = py - iy
    ix = ix.astype(np.int32); iy = iy.astype(np.int32)
    ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10); uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    g = grad(ix, iy); a = g[0] * fx + g[1] * fy
    g = grad(ix + 1, iy); b = g[0] * (fx - 1) + g[1] * fy
    g = grad(ix, iy + 1); c = g[0] * fx + g[1] * (fy - 1)
    g = grad(ix + 1, iy + 1); d = g[0] * (fx - 1) + g[1] * (fy - 1)
    return ((a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy) * 1.41421356

def fbm(px, py, octaves):
    s = 0.0; a = 0.5; n = 0.0
    for i in range(octaves):
        s = s + a * gnoise(px, py); n += a
        px, py = px * 2.03 + 17.3, py * 2.03 - 9.1
        a *= 0.5
    return s / n

def ridged(px, py, octaves):
    s = 0.0; a = 0.5; n = 0.0; prev = 1.0
    for i in range(octaves):
        r = 1.0 - np.abs(gnoise(px, py)); r = r * r
        s = s + a * r * prev; n += a
        prev = np.clip(r * 1.6, 0.0, 1.0)
        px, py = px * 2.07 + 5.2, py * 2.07 + 13.7
        a *= 0.5
    return s / n

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)

def smin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25

def hex_center(q, r):
    return S * R3 * (q + 0.5 * r), S * 1.5 * r

def hex_at(px, py):
    x = (R3 / 3 * px - py / 3) / S; z = (2 / 3 * py) / S; y = -x - z
    rx, ry, rz = np.round(x), np.round(y), np.round(z)
    dx, dy, dz = np.abs(rx - x), np.abs(ry - y), np.abs(rz - z)
    c1 = (dx > dy) & (dx > dz); c2 = (~c1) & (dy <= dz)
    rx = np.where(c1, -ry - rz, rx); rz = np.where(c2, -rx - ry, rz)
    return rx.astype(np.int32), rz.astype(np.int32)

def sd_hex(dx, dy):
    kx, ky, kz = -0.866025404, 0.5, 0.577350269
    px, py = np.abs(dy), np.abs(dx)
    m = np.minimum(kx * px + ky * py, 0.0); px = px - 2 * m * kx; py = py - 2 * m * ky
    px = px - np.clip(px, -kz * A, kz * A); py = py - A
    return np.hypot(px, py) * np.sign(py)
