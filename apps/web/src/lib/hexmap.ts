import { coastLoops, hexToPixel, vertexToPixel, parseVertexKey } from "@lotw/domain";

export const HEX_SIZE = 26;
export const TERRAIN_COLOR: Record<string, string> = {
  desert: "#D9B97A", hills: "#B99A5B", meadow: "#8FA05A", mountains: "#8E8272", water: "#4F7C99", oasis: "#7D8B4E",
};
/** Земля под туманом: ровный светлый цвет, облака рисуются поверх слоем эффектов. */
export const FOG_COLOR = "#C9C0B0";
export const TEAM_COLORS = ["#A9553A", "#4F7C99", "#7D8B4E", "#8E5A9E", "#A9762F", "#3B6E6E"];

/** Контур гекса (pointy-top) как строка points для polygon. */
export function hexPoints(size = HEX_SIZE, scale = 1): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(Math.cos(a) * size * scale).toFixed(2)},${(Math.sin(a) * size * scale).toFixed(2)}`);
  }
  return pts.join(" ");
}

export function hexCenter(h: { q: number; r: number }, size = HEX_SIZE) { return hexToPixel(h, size); }
export function nodePos(key: string, size = HEX_SIZE) { return vertexToPixel(parseVertexKey(key), size); }

/** Границы поля по гексам (для viewBox и подгонки масштаба). */
export function fieldBounds(hexes: Array<{ q: number; r: number }>, size = HEX_SIZE) {
  const cs = hexes.map((h) => hexToPixel(h, size));
  const minX = Math.min(...cs.map((c) => c.x)) - size * 1.2, maxX = Math.max(...cs.map((c) => c.x)) + size * 1.2;
  const minY = Math.min(...cs.map((c) => c.y)) - size * 1.2, maxY = Math.max(...cs.map((c) => c.y)) + size * 1.2;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Береговая линия как SVG-путь: контуры границы поля, сглаженные квадратичными кривыми через середины сторон,
 * чтобы берег был волнистым, а не зубчатым. Несколько контуров (дыры) — в одном пути, заливка evenodd.
 */
export function coastPath(hexes: Array<{ q: number; r: number }>, size = HEX_SIZE): string {
  const parts: string[] = [];
  for (const loop of coastLoops(hexes)) {
    const p = loop.map((v) => vertexToPixel(v, size));
    const n = p.length;
    const mid = (i: number) => { const a = p[i % n]!, b = p[(i + 1) % n]!; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    const m0 = mid(0);
    let d = `M${m0.x.toFixed(1)},${m0.y.toFixed(1)}`;
    for (let i = 1; i <= n; i++) { const c = p[i % n]!, m = mid(i); d += `Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${m.x.toFixed(1)},${m.y.toFixed(1)}`; }
    parts.push(d + "Z");
  }
  return parts.join("");
}
