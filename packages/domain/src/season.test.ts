import { describe, expect, it } from "vitest";
import { resolveSeason, seasonAt, seasonOfMonth } from "./season.js";

describe("времена года", () => {
  it("месяцы делятся на четыре сезона по календарю", () => {
    expect([12, 1, 2].map(seasonOfMonth)).toEqual(["winter", "winter", "winter"]);
    expect([3, 4, 5].map(seasonOfMonth)).toEqual(["spring", "spring", "spring"]);
    expect([6, 7, 8].map(seasonOfMonth)).toEqual(["summer", "summer", "summer"]);
    expect([9, 10, 11].map(seasonOfMonth)).toEqual(["autumn", "autumn", "autumn"]);
  });
  it("сезон считается по поясу игры: в Ташкенте уже 1 декабря, когда по UTC ещё 30 ноября", () => {
    const now = new Date("2026-11-30T20:30:00Z");
    expect(seasonAt("Asia/Tashkent", now)).toBe("winter");
    expect(seasonAt("UTC", now)).toBe("autumn");
  });
  it("правило администратора закрепляет сезон, auto и мусор — по календарю", () => {
    const july = new Date("2026-07-10T10:00:00Z");
    expect(resolveSeason("winter", "UTC", july)).toBe("winter");
    expect(resolveSeason("auto", "UTC", july)).toBe("summer");
    expect(resolveSeason("nope", "UTC", july)).toBe("summer");
    expect(resolveSeason(undefined, "UTC", july)).toBe("summer");
  });
});
