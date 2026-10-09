import { describe, expect, it } from "vitest";
import { traceWorld } from "./pages/Fauna";
import { hexCenter } from "./lib/hexmap";
import type { MapHexDto } from "./lib/api";

/** Остров-полумесяц: центр масс лежит в воде, а длинные рога выступают далеко — радиальный профиль их не накрывает. */
function crescent(): MapHexDto[] {
  const hexes: MapHexDto[] = [];
  for (let q = -9; q <= 9; q++) for (let r = -9; r <= 9; r++) {
    const c = hexCenter({ q, r }, 1);
    const d = Math.hypot(c.x, c.y), d2 = Math.hypot(c.x - 4, c.y);
    if (d <= 11 && d >= 6.5 && c.x < 5 && !(d2 < 8.5 && c.x > 0)) hexes.push({ q, r, terrain: "desert", island: "OT" });
  }
  return hexes;
}

describe("живность не заходит на сушу", () => {
  it("корабли и звери держатся вне гексов суши даже у острова с длинными мысами", () => {
    const size = 26, hexes = crescent();
    const land = new Set(hexes.map((h) => `${h.q},${h.r}`));
    expect(hexes.length).toBeGreaterThan(40);
    const onLand = (x: number, y: number) => {
      const qf = (Math.sqrt(3) / 3 * x - y / 3) / size, rf = (2 / 3 * y) / size;
      let q = Math.round(qf), r = Math.round(rf); const sf = -qf - rf, sr = Math.round(sf);
      const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(sr - sf);
      if (dq > dr && dq > ds) q = -r - sr; else if (dr > ds) r = -q - sr;
      return land.has(`${q},${r}`);
    };
    const traces = traceWorld(hexes, size, 4000, 0.25);
    const bad: string[] = [];
    for (const tr of traces) {
      if (tr.kind === "flock" || tr.kind === "gull") continue; // птицы летают над сушей
      for (const [x, y] of tr.samples) if (onLand(x, y)) bad.push(`${tr.kind} @ ${x.toFixed(0)},${y.toFixed(0)}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
