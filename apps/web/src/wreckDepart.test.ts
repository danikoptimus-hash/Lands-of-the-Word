import { describe, expect, it } from "vitest";
import { traceDeparture } from "./pages/Fauna";
import { hexCenter } from "./lib/hexmap";
import type { MapHexDto } from "./lib/api";
import type { Islet } from "@lotw/domain";

/**
 * Уход починенного корабля (замечание владельца 05.11: «восстановленный корабль пошёл по каменоломне»): корабль ведёт мир
 * живности по тем же правилам, что и другие корабли, — огибает берег и островки, а не идёт по прямой.
 */
function island(): MapHexDto[] {
  const hexes: MapHexDto[] = [];
  for (let q = -8; q <= 8; q++) for (let r = -8; r <= 8; r++) { const c = hexCenter({ q, r }, 1); if (Math.hypot(c.x, c.y) <= 6.5) hexes.push({ q, r, terrain: "desert", island: "OT" }); }
  return hexes;
}
const onLand = (land: Set<string>, size: number) => (x: number, y: number) => {
  const qf = (Math.sqrt(3) / 3 * x - y / 3) / size, rf = (2 / 3 * y) / size;
  let q = Math.round(qf), r = Math.round(rf); const sf = -qf - rf, sr = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(sr - sf);
  if (dq > dr && dq > ds) q = -r - sr; else if (dr > ds) r = -q - sr;
  return land.has(`${q},${r}`);
};

describe("уход починенного корабля", () => {
  it("огибает островок на пути и не заходит на сушу; путь детерминирован", () => {
    const size = 26, hexes = island(), land = new Set(hexes.map((h) => `${h.q},${h.r}`));
    // Корабль у восточного берега (3 гекса от суши), прямо на пути в море — островок радиусом в два гекса.
    const wreck = { id: "w1", x: size * 9.5 * Math.sqrt(3) / 2 * 2, y: 0, kind: 1 as const, seed: 0 };
    const islet: Islet = { x: wreck.x + size * 6, y: size * 0.5, r: size * 2, shape: [], img: 1, cover: size * 2.6 };
    const trace = traceDeparture(hexes, size, [islet], wreck, 60, 0.05);
    expect(trace.length).toBeGreaterThan(500);
    const hit = onLand(land, size);
    const bad = trace.filter(([x, y]) => hit(x, y) || Math.hypot(x - islet.x, y - islet.y) < islet.r - 1);
    expect(bad.slice(0, 5)).toEqual([]);
    // Корабль ушёл далеко в море, а не стоит на месте.
    const last = trace[trace.length - 1]!;
    expect(Math.hypot(last[0] - wreck.x, last[1] - wreck.y)).toBeGreaterThan(size * 12);
    // Тот же корабль — тот же путь (у всех игроков одинаково).
    expect(traceDeparture(hexes, size, [islet], wreck, 20, 0.05)).toEqual(trace.slice(0, 400));
  });
});
