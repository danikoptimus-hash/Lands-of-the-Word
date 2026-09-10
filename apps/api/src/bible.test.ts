import { describe, expect, it } from "vitest";
import { loadBook, parseDistrictRange, formatRange } from "./services/bible.js";

describe("parseDistrictRange", () => {
  it("понимает стихи, диапазоны через главы и целые главы", async () => {
    const book = (await loadBook("rut"))!;
    expect(book).toBeTruthy();
    const r1 = parseDistrictRange(book, "1:1–5")!;
    expect(formatRange(book, r1.start, r1.end)).toBe("1:1–5");
    const r2 = parseDistrictRange(book, "1:20-2:3")!;
    expect(formatRange(book, r2.start, r2.end)).toBe("1:20–2:3");
    const r3 = parseDistrictRange(book, "2")!;
    expect(formatRange(book, r3.start, r3.end)).toBe("2:1–23");
    const r4 = parseDistrictRange(book, "3–4")!;
    expect(formatRange(book, r4.start, r4.end)).toBe("3:1–4:22");
    expect(parseDistrictRange(book, "5")).toBeNull();
    expect(parseDistrictRange(book, "1:30")).toBeNull();
    expect(parseDistrictRange(book, "абв")).toBeNull();
  });
});
