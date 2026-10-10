import { describe, expect, it } from "vitest";
import { BIRD_PERIOD_MS, birdView, dailyBird } from "./services/teamMap.js";

/** Полёт клина: координаты города в тумане уходят клиенту только в окне полёта (решение владельца 05.10). */
describe("клин птиц", () => {
  const nodes = [{ key: "N:0,0", kind: "EMPTY" }, { key: "N:1,0", kind: "CITY" }, { key: "N:2,0", kind: "CITY" }];
  const edges = [{ aKey: "N:0,0", bKey: "N:1,0" }, { aKey: "N:1,0", bKey: "N:2,0" }];
  it("цель и момент одинаковы внутри периода полёта и лежат в нём", () => {
    const base = Math.floor(Date.now() / BIRD_PERIOD_MS) * BIRD_PERIOD_MS;
    const a = dailyBird("g", "t", "N:0,0", new Set(["N:0,0"]), nodes, edges, base + 1000)!;
    const b = dailyBird("g", "t", "N:0,0", new Set(["N:0,0"]), nodes, edges, base + BIRD_PERIOD_MS - 1000)!;
    expect(a).toEqual(b);
    expect(a.at).toBeGreaterThanOrEqual(base);
    expect(a.at).toBeLessThan(base + BIRD_PERIOD_MS);
    expect(["N:1,0", "N:2,0"]).toContain(a.key);
  });
  it("узел отдаётся только в окне полёта, момент — всегда", () => {
    const bird = { key: "N:1,0", at: 10_000_000 };
    expect(birdView(bird, bird.at - 3_600_000)).toEqual({ at: bird.at });
    expect(birdView(bird, bird.at - 30_000)).toEqual({ at: bird.at, key: "N:1,0" });
    expect(birdView(bird, bird.at + 120_000)).toEqual({ at: bird.at, key: "N:1,0" });
    expect(birdView(bird, bird.at + 600_000)).toEqual({ at: bird.at });
    expect(birdView(null)).toBeNull();
  });
});
