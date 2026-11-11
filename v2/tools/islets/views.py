# Просмотр штампа острова: вид сверху и виды под углом (грубая трассировка лучей по высотам) — для подбора формы.
import math
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

CLAY = np.array([0.70, 0.65, 0.59])
SKY = np.array([0.78, 0.84, 0.88])


def shade(H, dx, sun=(-0.62, -0.5, 0.6)):
    gy, gx = np.gradient(H, dx)
    nrm = np.stack([-gx, -gy, np.ones_like(H)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    L = np.array(sun) / np.linalg.norm(sun)
    lam = np.clip((nrm * L).sum(-1), 0, 1)
    # тени от солнца
    n = H.shape[0]
    sh = np.zeros(H.shape, dtype=bool)
    hor = math.hypot(L[0], L[1]); rise = L[2] / hor
    ii, jj = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    for k in range(1, 120):
        d = k * 1.5
        i2 = np.clip(np.round(ii + L[1] / hor * d).astype(int), 0, n - 1)
        j2 = np.clip(np.round(jj + L[0] / hor * d).astype(int), 0, n - 1)
        sh |= H[i2, j2] > H + rise * d * dx + 0.3
    return lam * np.where(sh, 0.3, 1.0)


def colour(H, lam, level):
    img = (0.32 + 0.74 * lam)[..., None] * CLAY
    depth = np.clip(level - H, 0, None)
    k = 1 - np.exp(-depth * 0.07)
    water = np.array([0.42, 0.64, 0.66]) * (1 - k[..., None]) + np.array([0.07, 0.21, 0.31]) * k[..., None]
    a = (np.clip(depth / 0.5, 0, 1) * (0.55 + 0.45 * (1 - np.exp(-depth * 0.3))))[..., None]
    return img * (1 - a) + water * a


def top(H, dx, lake=None, contour=10.0):
    level = np.zeros_like(H) if lake is None else np.where(lake > -900, lake, 0.0)
    lam = shade(H, dx)
    img = colour(H, lam, level)
    if contour:
        c = np.floor(np.maximum(H, 0) / contour)
        edge = (np.abs(np.diff(c, axis=0, prepend=c[:1])) + np.abs(np.diff(c, axis=1, prepend=c[:, :1]))) > 0
        img = np.where((edge & (H > level))[..., None], img * 0.86, img)
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))


def oblique(H, dx, lake=None, yaw=0.6, pitch=0.5, dist=1.55, width=760, height=430, fov=0.85, lam=None):
    n = H.shape[0]
    size = n * dx
    level = np.zeros_like(H) if lake is None else np.where(lake > -900, lake, 0.0)
    surf = np.maximum(H, level)
    if lam is None:
        lam = shade(H, dx)
    target = np.array([0.0, 0.0, 0.06 * size])
    cam = target + dist * size * np.array([math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)])
    fwd = target - cam; fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 0, 1.0]); right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    sx = (np.arange(width) + 0.5) / width * 2 - 1
    sy = (np.arange(height) + 0.5) / height * 2 - 1
    SX, SY = np.meshgrid(sx * math.tan(fov / 2), -sy * math.tan(fov / 2) * height / width)
    rays = fwd + SX[..., None] * right + SY[..., None] * up
    rays /= np.linalg.norm(rays, axis=-1, keepdims=True)
    t = np.full(SX.shape, 0.3 * dist * size)
    hit = np.zeros(SX.shape, dtype=bool)
    gxh = np.zeros(SX.shape); gyh = np.zeros(SX.shape)
    active = np.ones(SX.shape, dtype=bool)
    tmax = 3.0 * dist * size
    for _ in range(600):
        if not active.any():
            break
        p = cam + rays * t[..., None]
        gx = (p[..., 0] / size + 0.5) * n - 0.5; gy = (p[..., 1] / size + 0.5) * n - 0.5
        inside = (gx >= 0) & (gy >= 0) & (gx < n - 1) & (gy < n - 1)
        hz = np.where(inside, ndimage.map_coordinates(surf, [np.clip(gy, 0, n - 1), np.clip(gx, 0, n - 1)], order=1), 0.0)
        newhit = active & (p[..., 2] <= hz)
        hit |= newhit
        gxh = np.where(newhit, gx, gxh); gyh = np.where(newhit, gy, gyh)
        active &= ~newhit & (t < tmax)
        t = t + np.where(active, np.maximum(0.6 * dx, (p[..., 2] - hz) * 0.6), 0.0)
    cy = np.clip(gyh, 0, n - 1); cx = np.clip(gxh, 0, n - 1)
    L = ndimage.map_coordinates(lam, [cy, cx], order=1)
    hh = ndimage.map_coordinates(H, [cy, cx], order=1)
    lv = ndimage.map_coordinates(level, [cy, cx], order=0)
    img = colour(hh, L, lv)
    # дымка вдали
    fog = 1 - np.exp(-np.maximum(t - dist * size * 0.6, 0) / (dist * size * 3))
    img = img * (1 - fog[..., None] * 0.5) + SKY * fog[..., None] * 0.5
    img = np.where(hit[..., None], img, SKY)
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))


def sheet(H, dx, path, lake=None, title=""):
    lam = shade(H, dx)
    a = top(H, dx, lake).resize((430, 430))
    b = oblique(H, dx, lake, yaw=0.7, lam=lam)
    c = oblique(H, dx, lake, yaw=0.7 + 2.4, pitch=0.32, dist=1.2, lam=lam)
    im = Image.new("RGB", (430 + 760, 860), "white")
    im.paste(a, (0, 0)); im.paste(b, (430, 0)); im.paste(c, (430, 430))
    if title:
        ImageDraw.Draw(im).text((8, 440), title, fill=(30, 30, 30))
    im.save(path, quality=88)
