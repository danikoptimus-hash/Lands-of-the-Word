import { describe, expect, it } from "vitest";
import { fmtPause } from "./lib/format";

/** Пауза отмычки словами (решение владельца 05.11): короткая пауза больше не выглядит как «1 мин». */
describe("fmtPause", () => {
  it("секунды до минуты, минуты с секундами дальше, ровные минуты и часы — как fmtLeft", () => {
    expect(fmtPause(10_000)).toBe("10 с");
    expect(fmtPause(20_000)).toBe("20 с");
    expect(fmtPause(59_000)).toBe("59 с");
    expect(fmtPause(59_001)).toBe("1 мин");
    expect(fmtPause(60_000)).toBe("1 мин");
    expect(fmtPause(299_000)).toBe("4 мин 59 с");
    expect(fmtPause(900_000)).toBe("15 мин");
    expect(fmtPause(3_600_000)).toBe("1 ч 0 мин");
    expect(fmtPause(-5)).toBe("0 с");
  });
});
