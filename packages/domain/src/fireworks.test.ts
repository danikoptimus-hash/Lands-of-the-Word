import { describe, expect, it } from "vitest";
import { fireworksUntil } from "./fireworks.js";

const TZ = "Asia/Tashkent"; // UTC+5, без летнего времени
const at = (iso: string) => Date.parse(iso);

describe("салют над взятым городом", () => {
  it("с момента взятия до конца местного дня", () => {
    const took = at("2026-10-24T09:00:00Z"); // 14:00 местного
    const midnight = at("2026-10-24T19:00:00Z"); // 00:00 25.10 местного
    expect(fireworksUntil(took, took + 60_000, TZ)).toBe(midnight);
    expect(fireworksUntil(took, at("2026-10-24T17:30:30.500Z"), TZ)).toBe(midnight); // ночью тоже
    expect(fireworksUntil(took, midnight - 1000, TZ)).toBe(midnight);
  });
  it("после полуночи салюта нет", () => {
    const took = at("2026-10-24T09:00:00Z");
    expect(fireworksUntil(took, at("2026-10-24T19:00:00Z"), TZ)).toBeNull();
    expect(fireworksUntil(took, at("2026-10-25T05:00:00Z"), TZ)).toBeNull();
  });
  it("город, взятый ночью, празднуется до полуночи того же дня", () => {
    const took = at("2026-10-24T18:00:00Z"); // 23:00 местного
    expect(fireworksUntil(took, took + 60_000, TZ)).toBe(at("2026-10-24T19:00:00Z"));
  });
  it("до взятия и при неверной дате — ничего", () => {
    expect(fireworksUntil(NaN, Date.now(), TZ)).toBeNull();
    expect(fireworksUntil(at("2026-10-24T09:00:00Z"), at("2026-10-24T08:00:00Z"), TZ)).toBeNull();
  });
});
