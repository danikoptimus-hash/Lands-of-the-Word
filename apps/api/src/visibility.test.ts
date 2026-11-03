import { describe, expect, it } from "vitest";
import { battleVisibleTo } from "./services/visibility.js";

const base = { attackerId: "A", defenderId: "D", violation: false, defenseFactor: 1 };

describe("видимость вызова хранителям", () => {
  it("до «Испытать» вызов для хранителей не существует: ни идущий, ни отменённый, ни сгоревший", () => {
    for (const status of ["QUEUED", "ATTACK", "CANCELLED", "EXPIRED"]) expect(battleVisibleTo({ ...base, status, attackLaunchedAt: null }, "D")).toBe(false);
  });
  it("после «Испытать» хранители видят вызов и его итог", () => {
    for (const status of ["DEFENSE", "WON", "REPELLED"]) expect(battleVisibleTo({ ...base, status, attackLaunchedAt: new Date() }, "D")).toBe(true);
  });
  it("претенденты видят свой вызов всегда; при нарушении мира хранители знают с самого начала", () => {
    expect(battleVisibleTo({ ...base, status: "CANCELLED", attackLaunchedAt: null }, "A")).toBe(true);
    expect(battleVisibleTo({ ...base, status: "CANCELLED", attackLaunchedAt: null, violation: true }, "D")).toBe(true);
    expect(battleVisibleTo({ ...base, status: "ATTACK", attackLaunchedAt: null, defenseFactor: 2 }, "D")).toBe(true);
  });
});
