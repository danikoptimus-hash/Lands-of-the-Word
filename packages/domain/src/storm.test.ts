import { describe, expect, it } from "vitest";
import { stormAt, stormState, localWeekMinutes } from "./storm.js";

const slots = [{ weekday: 0, from: "10:00", to: "12:30" }, { weekday: 3, from: "19:00", to: "21:00" }, { weekday: 6, from: "23:00", to: "01:00" }];

describe("шторм по расписанию", () => {
  it("идёт внутри интервала и говорит, сколько осталось", () => {
    expect(stormAt(slots, 0 * 1440 + 11 * 60)).toEqual({ active: true, untilMin: 90 });
    expect(stormAt(slots, 3 * 1440 + 19 * 60)).toEqual({ active: true, untilMin: 120 });
  });
  it("вне интервала — до ближайшего начала", () => {
    expect(stormAt(slots, 0 * 1440 + 9 * 60)).toEqual({ active: false, untilMin: 60 });
    expect(stormAt(slots, 3 * 1440 + 22 * 60)).toEqual({ active: false, untilMin: (6 - 3) * 1440 + 60 });
  });
  it("интервал через полночь заворачивает на воскресенье", () => {
    expect(stormAt(slots, 6 * 1440 + 23 * 60 + 30)).toEqual({ active: true, untilMin: 90 });
    expect(stormAt(slots, 0 * 1440 + 30)).toEqual({ active: true, untilMin: 30 });
    expect(stormAt(slots, 0 * 1440 + 61)).toEqual({ active: false, untilMin: 10 * 60 - 61 });
  });
  it("соседние интервалы сливаются в один шторм", () => {
    const two = [{ weekday: 1, from: "10:00", to: "11:00" }, { weekday: 1, from: "11:00", to: "12:00" }];
    expect(stormAt(two, 1 * 1440 + 10 * 60 + 30)).toEqual({ active: true, untilMin: 90 });
  });
  it("пустые или неверные интервалы не ломают расчёт", () => {
    expect(stormAt([{ weekday: 1, from: "10:00", to: "10:00" }, { weekday: 9, from: "x", to: "y" }], 1 * 1440 + 10 * 60)).toEqual({ active: false, untilMin: null });
    expect(stormState([], "Asia/Tashkent")).toEqual({ active: false, nextChangeMs: null });
  });
  it("минуты недели считаются по поясу игры", () => {
    // 2026-10-25 — воскресенье; 05:00 UTC = 10:00 в Ташкенте.
    const now = new Date("2026-10-25T05:00:00Z");
    expect(localWeekMinutes("Asia/Tashkent", now)).toBe(10 * 60);
    expect(stormState(slots, "Asia/Tashkent", now)).toEqual({ active: true, nextChangeMs: 150 * 60_000 });
  });
});
