import { describe, expect, it } from "vitest";
import { coastLoops } from "./lib/worldScene";

describe("сцена мира на WebGL (Э2): берег", () => {
  it("путь из кривых разбивается на ломаные по петлям", () => {
    const loops = coastLoops("M0,0Q10,0 10,10Q10,20 0,20M50,50Q60,50 60,60", 2);
    expect(loops.length).toBe(2);
    expect(loops[0]!.length).toBe(1 + 2 * 2);
    expect(loops[0]![2]).toEqual({ x: 10, y: 10 });
    expect(loops[0]![1]!.x).toBeCloseTo(7.5); expect(loops[0]![1]!.y).toBeCloseTo(2.5);
    expect(loops[1]![2]).toEqual({ x: 60, y: 60 });
  });
});
