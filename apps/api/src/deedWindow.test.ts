import { describe, expect, it } from "vitest";
import { deedDayWindow } from "./services/teamMap.js";

// Лимит дел по игровым суткам (решение владельца 07.10): окно от последних 7:00 по поясу игры до следующих 7:00.
describe("deedDayWindow", () => {
  it("днём: окно началось сегодня в 7:00 и кончится завтра в 7:00", () => {
    const now = Date.UTC(2026, 9, 7, 10, 30, 25); // 15:30:25 в Ташкенте (UTC+5)
    const w = deedDayWindow("Asia/Tashkent", now);
    expect(w.since.toISOString()).toBe("2026-10-07T02:00:00.000Z"); // 7:00 Ташкента
    expect(new Date(w.nextAt).toISOString()).toBe("2026-10-08T02:00:00.000Z");
  });
  it("ночью до 7:00: окно началось вчера в 7:00 и кончится сегодня в 7:00", () => {
    const now = Date.UTC(2026, 9, 7, 0, 10, 0); // 05:10 в Ташкенте
    const w = deedDayWindow("Asia/Tashkent", now);
    expect(w.since.toISOString()).toBe("2026-10-06T02:00:00.000Z");
    expect(new Date(w.nextAt).toISOString()).toBe("2026-10-07T02:00:00.000Z");
  });
  it("ровно в 7:00 начинается новое окно", () => {
    const now = Date.UTC(2026, 9, 7, 2, 0, 0);
    expect(deedDayWindow("Asia/Tashkent", now).since.getTime()).toBe(now);
  });
});
