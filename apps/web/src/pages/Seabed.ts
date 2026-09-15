import { useMemo } from "react";
import { seaField, type Bounds, type Islet } from "@lotw/domain";
import { hexCenter } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";
import { CLOUD_TILE, cloudNoise } from "../lib/noise";

/**
 * Дно моря: глубина зависит от расстояния до суши, как у настоящего океана — у берегов светлый шельф, между
 * близкими островами тоже светло, вдали тёмная глубина (решение владельца 15.09, пример — снимок Земли).
 * Считается один раз на карту в поле глубины низкого разрешения над поясом моря (`seaField`): для каждой точки —
 * расстояние до ближайшего гекса поля или островка, шельф на 7 радиусов гекса от берега, дальше глубина.
 * Красный канал — глубина 0 (мель) … 255 (глубина). Шейдер моря читает поле как текстуру (плавная интерполяция),
 * запасной canvas — как готовую раскраску (`seabedColor`). Рельеф дна (гряды и впадины) добавляется шумом уже при
 * рисовании, он мельче и живее, чем это поле.
 */
export interface Seabed { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number; color?: HTMLCanvasElement }

/** Цвета воды по глубине 0..1: мель — светлая бирюза, шельф, глубина — тёмная синева. Те же в шейдере. */
export const SEA_SHALLOW: [number, number, number] = [0.36, 0.72, 0.78];
export const SEA_MID: [number, number, number] = [0.20, 0.52, 0.66];
export const SEA_DEEP: [number, number, number] = [0.08, 0.28, 0.46];
export const SHELF_HEXES = 7;

export function buildSeabed(hexes: ReadonlyArray<MapHexDto>, islets: ReadonlyArray<Islet>, size: number, bounds: Bounds): Seabed {
  const f = seaField(bounds);
  const pad = Math.max(f.width, f.height) * 0.1;
  const x = f.minX - pad, y = f.minY - pad, w = f.width + 2 * pad, h = f.height + 2 * pad;
  const N = 384;
  const cw = w >= h ? N : Math.round((N * w) / h), ch = w >= h ? Math.round((N * h) / w) : N;
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(cw, ch);
  // Суша: центры гексов (радиус — гекс с песком) и островки (радиус — накрывающий круг без части отмели);
  // у островков шельф вдвое уже. Ширина шельфа гуляет по крупному шуму (от 0.6 до 1.4 от средней), чтобы граница
  // была неровной, как у настоящего шельфа, а не ровным ореолом.
  const sites: Array<{ x: number; y: number; r: number; shelf: number }> = [
    ...hexes.map((hx) => { const c = hexCenter(hx, size); return { x: c.x, y: c.y, r: size * 1.3, shelf: 1 }; }),
    ...islets.map((i) => ({ x: i.x, y: i.y, r: Math.max(i.r * 0.8, i.cover - size * 1.2), shelf: 0.5 })),
  ];
  const shelf = size * SHELF_HEXES;
  const noise = cloudNoise(), period = size * 26;
  const nz = (px: number, py: number) => { const ix = Math.floor((((px / period) % 1) + 1) % 1 * CLOUD_TILE), iy = Math.floor((((py / period) % 1) + 1) % 1 * CLOUD_TILE); return noise[iy * CLOUD_TILE + ix]!; };
  for (let j = 0; j < ch; j++) {
    const py = y + ((j + 0.5) / ch) * h;
    for (let i = 0; i < cw; i++) {
      const px = x + ((i + 0.5) / cw) * w;
      let u = Infinity;
      const width = shelf * (0.6 + 0.8 * nz(px, py));
      for (const s of sites) { const uu = (Math.hypot(s.x - px, s.y - py) - s.r) / (width * s.shelf); if (uu < u) u = uu; }
      u = Math.min(1, Math.max(0, u));
      const depth = u * u * (3 - 2 * u);
      const o = (j * cw + i) * 4;
      img.data[o] = Math.round(depth * 255); img.data[o + 1] = 0; img.data[o + 2] = 0; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, x, y, w, h };
}

/** Раскраска дна по глубине для запасного canvas-моря (без рельефа); считается один раз. */
export function seabedColor(bed: Seabed): HTMLCanvasElement {
  if (bed.color) return bed.color;
  const src = bed.canvas.getContext("2d")!.getImageData(0, 0, bed.canvas.width, bed.canvas.height);
  const c = document.createElement("canvas"); c.width = bed.canvas.width; c.height = bed.canvas.height;
  const ctx = c.getContext("2d")!;
  const out = ctx.createImageData(c.width, c.height);
  for (let o = 0; o < src.data.length; o += 4) {
    const z = src.data[o]! / 255;
    const [a, b, t] = z < 0.5 ? [SEA_SHALLOW, SEA_MID, z * 2] : [SEA_MID, SEA_DEEP, (z - 0.5) * 2];
    for (let k = 0; k < 3; k++) out.data[o + k] = Math.round((a[k]! + (b[k]! - a[k]!) * t) * 255);
    out.data[o + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  bed.color = c;
  return c;
}

export function useSeabed(hexes: MapHexDto[], islets: Islet[], size: number, bounds: Bounds | null): Seabed | null {
  const key = hexes.map((h) => `${h.q},${h.r}`).join(";");
  return useMemo(() => (bounds && hexes.length ? buildSeabed(hexes, islets, size, bounds) : null), [key, islets, size, Boolean(bounds)]); // eslint-disable-line react-hooks/exhaustive-deps
}
