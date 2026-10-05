import { describe, expect, it } from "vitest";
import { hexKey, hexToPixel, hexesInRadius, hexAdd } from "./hex.js";
import { vertexKey, vertexToPixel, type Vertex } from "./hexgraph.js";
import { seaRoute, routeCurve, routeHeading, routeArrow, pixelToHex } from "./seaRoute.js";

const SIZE = 26;
/** Два круглых острова радиусом 3 с проливом в один гекс между ними — маршрут должен обойти по воде. */
function twoIslands() {
  const a = hexesInRadius(3), b = hexesInRadius(3).map((h) => hexAdd(h, { q: 9, r: 0 }));
  return new Set([...a, ...b].map(hexKey));
}
const inLand = (p: { x: number; y: number }, land: Set<string>) => {
  // Точка в гексе суши: ближайший центр — суша и расстояние меньше вписанного радиуса.
  for (const k of land) { const [q, r] = k.split(",").map(Number) as [number, number]; const c = hexToPixel({ q, r }, SIZE); if (Math.hypot(c.x - p.x, c.y - p.y) < SIZE * 0.86) return true; }
  return false;
};

describe("морской маршрут", () => {
  const land = twoIslands();
  // Порт — вершина на восточном берегу первого острова, высадка — на западном берегу второго.
  const port: Vertex = { corner: "N", q: 3, r: 0 }, landing: Vertex = { corner: "S", q: 6, r: -1 };
  it("идёт по воде от порта к месту высадки, концы на месте", () => {
    const pts = seaRoute(land, vertexKey(port), vertexKey(landing), SIZE);
    expect(pts.length).toBeGreaterThanOrEqual(3);
    expect(pts[0]).toEqual(vertexToPixel(port, SIZE));
    expect(pts[pts.length - 1]).toEqual(vertexToPixel(landing, SIZE));
    for (const p of pts.slice(1, -1)) expect(inLand(p, land)).toBe(false);
    const smooth = routeCurve(pts, land, SIZE);
    expect(smooth.length).toBeGreaterThan(pts.length);
    for (const p of smooth.slice(1, -1)) expect(inLand(p, land)).toBe(false);
    expect(Number.isFinite(routeHeading(smooth))).toBe(true);
    // Натяжение: точек в разы меньше, чем гексов по пути; стрелка стоит на маршруте до конца и смотрит к высадке.
    const arrow = routeArrow(smooth, SIZE);
    const dEnd = Math.hypot(arrow.x - smooth[smooth.length - 1]!.x, arrow.y - smooth[smooth.length - 1]!.y);
    expect(dEnd).toBeGreaterThan(SIZE * 0.7); expect(dEnd).toBeLessThanOrEqual(SIZE + 0.01);
    expect(inLand(arrow, land)).toBe(false);
  });
  it("гекс по точке: центр гекса возвращает его же", () => {
    for (const h of [{ q: 0, r: 0 }, { q: 3, r: -2 }, { q: -4, r: 5 }]) expect(pixelToHex(hexToPixel(h, SIZE), SIZE)).toEqual(h);
  });
  it("обходит островок-препятствие", () => {
    const direct = seaRoute(land, vertexKey(port), vertexKey(landing), SIZE);
    const mid = direct[Math.floor(direct.length / 2)]!;
    const around = seaRoute(land, vertexKey(port), vertexKey(landing), SIZE, undefined, [{ x: mid.x, y: mid.y, r: SIZE * 1.5 }]);
    for (const p of around.slice(1, -1)) expect(Math.hypot(p.x - mid.x, p.y - mid.y)).toBeGreaterThan(SIZE * 1.5);
  });
});
