import { hexToPixel } from "@lotw/domain";

export const HEX_SIZE = 22;
export const TERRAIN_COLOR: Record<string, string> = {
  desert: "#D9B97A", hills: "#B99A5B", meadow: "#8FA05A", mountains: "#8E8272", water: "#4F7C99", oasis: "#7D8B4E",
};
export const TEAM_COLORS = ["#A9553A", "#4F7C99", "#7D8B4E", "#8E5A9E", "#C48A3F", "#3B6E6E"];

export function hexPoints(size = HEX_SIZE, scale = 0.95): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(Math.cos(a) * size * scale).toFixed(2)},${(Math.sin(a) * size * scale).toFixed(2)}`);
  }
  return pts.join(" ");
}

export function layoutOf<T extends { key: string; q: number; r: number }>(nodes: T[], size = HEX_SIZE) {
  const pts = nodes.map((n) => ({ n, ...hexToPixel({ q: n.q, r: n.r }, size) }));
  const minX = Math.min(...pts.map((p) => p.x)) - size * 1.3, maxX = Math.max(...pts.map((p) => p.x)) + size * 1.3;
  const minY = Math.min(...pts.map((p) => p.y)) - size * 1.3, maxY = Math.max(...pts.map((p) => p.y)) + size * 1.3;
  return { pts, byKey: new Map(pts.map((p) => [p.n.key, p])), viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`, width: maxX - minX, height: maxY - minY };
}
