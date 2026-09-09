import { hexToPixel, vertexToPixel, parseVertexKey } from "@lotw/domain";

export const HEX_SIZE = 26;
export const TERRAIN_COLOR: Record<string, string> = {
  desert: "#D9B97A", hills: "#B99A5B", meadow: "#8FA05A", mountains: "#8E8272", water: "#4F7C99", oasis: "#7D8B4E",
};
export const FOG_COLOR = "#3F3A34";
export const TEAM_COLORS = ["#A9553A", "#4F7C99", "#7D8B4E", "#8E5A9E", "#C48A3F", "#3B6E6E"];

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
