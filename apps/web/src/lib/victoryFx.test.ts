import { describe, expect, it } from "vitest";
import { victoryFxOn, victoryWindow, type VictoryWindow } from "./victoryFx";

const H = 3_600_000;
// Победа в полдень по UTC; пояс партии — UTC: ночь 22:00–7:00.
const at = Date.UTC(2026, 10, 26, 12, 0, 0);
const w: VictoryWindow = { at, until: at + 72 * H };

describe("салют победы: когда бьёт", () => {
  it("до победы и после конца празднования не бьёт", () => {
    expect(victoryFxOn(w, at - 1000, "UTC")).toBe(false);
    expect(victoryFxOn(w, w.until, "UTC")).toBe(false);
    expect(victoryFxOn(w, w.until + H, "UTC")).toBe(false);
  });
  it("первые сутки — без остановки, днём и ночью", () => {
    expect(victoryFxOn(w, at, "UTC")).toBe(true);
    expect(victoryFxOn(w, at + 5 * H, "UTC")).toBe(true);   // 17:00
    expect(victoryFxOn(w, at + 11 * H, "UTC")).toBe(true);  // 23:00, ночь
    expect(victoryFxOn(w, at + 18 * H, "UTC")).toBe(true);  // 6:00, ночь
    expect(victoryFxOn(w, at + 20 * H, "UTC")).toBe(true);  // 8:00, утро — ещё первые сутки
    expect(victoryFxOn(w, at + 24 * H - 1, "UTC")).toBe(true);
  });
  it("вторые и третьи сутки — только в игровую ночь", () => {
    expect(victoryFxOn(w, at + 24 * H, "UTC")).toBe(false);      // 12:00 день
    expect(victoryFxOn(w, at + 28 * H, "UTC")).toBe(false);      // 16:00
    expect(victoryFxOn(w, at + 31 * H, "UTC")).toBe(false);      // 19:00 вечер
    expect(victoryFxOn(w, at + 34 * H, "UTC")).toBe(true);       // 22:00 ночь
    expect(victoryFxOn(w, at + 40 * H, "UTC")).toBe(true);       // 4:00
    expect(victoryFxOn(w, at + 43 * H, "UTC")).toBe(false);      // 7:00 утро
    expect(victoryFxOn(w, at + 52 * H, "UTC")).toBe(false);      // 16:00 третьего дня
    expect(victoryFxOn(w, at + 58 * H, "UTC")).toBe(true);       // 22:00 третьей ночи
    expect(victoryFxOn(w, at + 72 * H - 1000, "UTC")).toBe(false); // 11:59 последнего дня
  });
  it("часовой пояс партии: ночь считается по нему", () => {
    // 12:00 UTC = 17:00 в Ташкенте (UTC+5): через 28 ч в Ташкенте 21:00 — вечер, через 29 ч — 22:00 ночь.
    expect(victoryFxOn(w, at + 28 * H, "Asia/Tashkent")).toBe(false);
    expect(victoryFxOn(w, at + 29 * H, "Asia/Tashkent")).toBe(true);
  });
  it("показ ночи (для съёмки) бьёт днём вторых суток", () => {
    expect(victoryFxOn({ ...w, forceNight: true }, at + 28 * H, "UTC")).toBe(true);
  });
});

describe("окно празднования из ответа сервера", () => {
  const now = at + 2 * H;
  it("берёт момент победы и конец; без победы или после конца — нет окна", () => {
    const v = { teamId: "t", at: new Date(at).toISOString(), until: new Date(at + 72 * H).toISOString() };
    expect(victoryWindow(v, now)).toEqual({ at, until: at + 72 * H });
    expect(victoryWindow(null, now)).toBeNull();
    expect(victoryWindow(undefined, now)).toBeNull();
    expect(victoryWindow(v, at + 73 * H)).toBeNull();
    expect(victoryWindow({ ...v, at: "не дата" }, now)).toBeNull();
  });
});
