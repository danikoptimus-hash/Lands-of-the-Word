/** Гексагональная сетка в осевых координатах (q, r), плоская вершина сверху не важна — геометрия общая. */
export interface Hex { q: number; r: number }

export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function hexKey(h: Hex): string { return `${h.q},${h.r}`; }
export function hexEquals(a: Hex, b: Hex): boolean { return a.q === b.q && a.r === b.r; }
export function hexAdd(a: Hex, b: Hex): Hex { return { q: a.q + b.q, r: a.r + b.r }; }
export function hexNeighbors(h: Hex): Hex[] { return HEX_DIRECTIONS.map((d) => hexAdd(h, d)); }

/** Расстояние в шагах по сетке. */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

/** Все гексы в радиусе R от центра (шестиугольная область). */
export function hexesInRadius(radius: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      out.push({ q, r });
    }
  }
  return out;
}

/** Центр гекса в пикселях (pointy-top) для отрисовки. */
export function hexToPixel(h: Hex, size: number): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * h.q + (Math.sqrt(3) / 2) * h.r);
  const y = size * (1.5 * h.r);
  return { x, y };
}
