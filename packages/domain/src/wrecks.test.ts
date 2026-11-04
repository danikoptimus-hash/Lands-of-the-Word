import { describe, expect, it } from "vitest";
import { hexDistance, hexesInRadius, hexKey, hexToPixel } from "./hex.js";
import { generateIslets, seaField } from "./islets.js";
import { fieldBoundsOf, pickWreckHex, rocketLaunches, ROCKET_JITTER, ROCKET_PERIOD, ROCKET_WINDOW, underIslet, wreckCandidates, WRECK_MAX, WRECK_MIN } from "./wrecks.js";

/** Разбитый корабль (решение владельца 04.11): место — вода в 2–6 гексах от берега, в поясе моря, не на островке; выбор детерминирован. */
describe("разбитый корабль", () => {
  const size = 26;
  const land = hexesInRadius(5);
  const bounds = fieldBoundsOf(land, size);
  const islets = generateIslets(land, size, bounds).map((i) => ({ x: i.x, y: i.y, r: i.r, shape: i.shape }));
  const ships = [hexToPixel({ q: 7, r: 0 }, size)];

  it("кандидаты — вода в 2–6 гексах от суши, в поясе моря, не под островком и не у стоянки", () => {
    const cands = wreckCandidates(land, size, islets, ships);
    expect(cands.length).toBeGreaterThan(20);
    const landSet = new Set(land.map(hexKey)), sea = seaField(bounds);
    for (const h of cands) {
      expect(landSet.has(hexKey(h))).toBe(false);
      const d = Math.min(...land.map((l) => hexDistance(l, h)));
      expect(d).toBeGreaterThanOrEqual(WRECK_MIN); expect(d).toBeLessThanOrEqual(WRECK_MAX);
      const c = hexToPixel(h, size);
      expect(c.x).toBeGreaterThan(sea.minX); expect(c.x).toBeLessThan(sea.minX + sea.width);
      expect(c.y).toBeGreaterThan(sea.minY); expect(c.y).toBeLessThan(sea.minY + sea.height);
      expect(underIslet(h, size, islets)).toBe(false);
      expect(hexDistance(h, { q: 7, r: 0 })).toBeGreaterThanOrEqual(2);
    }
  });

  it("выбор детерминирован семенем и меняется с семенем", () => {
    const a = pickWreckHex(land, size, 42, islets, ships), b = pickWreckHex(land, size, 42, islets, ships);
    expect(a).toEqual(b);
    const seen = new Set(Array.from({ length: 20 }, (_, i) => hexKey(pickWreckHex(land, size, i, islets, ships)!)));
    expect(seen.size).toBeGreaterThan(5);
    expect(pickWreckHex([], size, 1)).toBeNull();
  });

  it("ракеты: раз в 7±2 с, одинаково у всех при одном семени, по-разному при разных", () => {
    const a = rocketLaunches(7, 1000, 1600), b = rocketLaunches(7, 1000, 1600);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(50);
    for (let i = 1; i < a.length; i++) {
      const gap = a[i]! - a[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(ROCKET_PERIOD - ROCKET_JITTER - 1e-9);
      // На стыке окон (раз в 10 минут) пауза может быть длиннее, но не больше двух обычных.
      const sameWindow = Math.floor(a[i]! / ROCKET_WINDOW) === Math.floor(a[i - 1]! / ROCKET_WINDOW);
      expect(gap).toBeLessThanOrEqual((sameWindow ? ROCKET_PERIOD + ROCKET_JITTER : 2 * (ROCKET_PERIOD + ROCKET_JITTER)) + 1e-9);
    }
    for (const t of a) { expect(t).toBeGreaterThanOrEqual(1000); expect(t).toBeLessThan(1600); }
    // Кусками — тот же ряд, что целиком: клиент спрашивает по кадру, окна не сбивают ритм.
    expect([...rocketLaunches(7, 1000, 1300), ...rocketLaunches(7, 1300, 1600)]).toEqual(a);
    expect(rocketLaunches(8, 1000, 1600)).not.toEqual(a);
  });
});
