import { describe, expect, it } from "vitest";
import { fireworksUntil, FIREWORKS_MS } from "./fireworks.js";

const TZ = "Asia/Tashkent"; // UTC+5, без летнего времени
const at = (iso: string) => Date.parse(iso);

describe("салют над взятым городом", () => {
  it("пять минут с момента взятия", () => {
    const took = at("2026-10-24T09:00:00Z"); // 14:00 местного
    expect(fireworksUntil(took, took + 60_000, TZ)).toBe(took + FIREWORKS_MS);
    expect(fireworksUntil(took, took + FIREWORKS_MS + 1, TZ)).toBeNull();
  });
  it("снова пять минут с наступления ночи того же дня (22:00)", () => {
    const took = at("2026-10-24T09:00:00Z");
    const night = at("2026-10-24T17:00:00Z"); // 22:00 местного
    expect(fireworksUntil(took, night + 30_000, TZ)).toBe(night + FIREWORKS_MS);
    expect(fireworksUntil(took, night - 30_000, TZ)).toBeNull();
    expect(fireworksUntil(took, night + FIREWORKS_MS + 1000, TZ)).toBeNull();
  });
  it("город, взятый вчера, ночью сегодня не празднуется", () => {
    const took = at("2026-10-23T09:00:00Z");
    const night = at("2026-10-24T17:00:00Z");
    expect(fireworksUntil(took, night + 30_000, TZ)).toBeNull();
  });
  it("город, взятый уже ночью, празднуется только сразу", () => {
    const took = at("2026-10-24T18:00:00Z"); // 23:00 местного
    expect(fireworksUntil(took, took + 60_000, TZ)).toBe(took + FIREWORKS_MS);
    expect(fireworksUntil(took, took + 10 * 60_000, TZ)).toBeNull();
  });
  it("до взятия и при неверной дате — ничего", () => {
    expect(fireworksUntil(NaN, Date.now(), TZ)).toBeNull();
    expect(fireworksUntil(at("2026-10-24T09:00:00Z"), at("2026-10-24T08:00:00Z"), TZ)).toBeNull();
  });
});
