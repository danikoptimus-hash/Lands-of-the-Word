import { describe, expect, it } from "vitest";
import { AWARD_BY_CODE, BOOK_GROUPS } from "./awards.js";
import { BOOKS } from "./books.js";

describe("награды за собранные группы книг", () => {
  it("у каждой группы есть командная награда со значком, книги группы есть в каталоге книг", () => {
    const codes = new Set(BOOKS.map((b) => b.code));
    for (const g of BOOK_GROUPS) {
      const def = AWARD_BY_CODE.get(g.code);
      expect(def?.kind, g.code).toBe("TEAM");
      expect(def?.symbol.length, g.code).toBeGreaterThan(5);
      for (const b of g.books) expect(codes.has(b), `${g.code}: ${b}`).toBe(true);
      expect(new Set(g.books).size).toBe(g.books.length);
    }
  });
  it("группы-разделы совпадают с разделами Библии в каталоге книг", () => {
    const section = (name: string) => BOOKS.filter((b) => b.section === name).map((b) => b.code);
    const group = (code: string) => [...BOOK_GROUPS.find((g) => g.code === code)!.books];
    expect(group("t_books_torah")).toEqual(section("Пятикнижие"));
    expect(group("t_books_history")).toEqual(section("Исторические"));
    expect(group("t_books_wisdom")).toEqual(section("Учительные"));
    expect(group("t_books_major_prophets")).toEqual(section("Большие пророки"));
    expect(group("t_books_minor_prophets")).toEqual(section("Малые пророки"));
    expect(group("t_books_gospels")).toEqual(section("Евангелия"));
    expect(group("t_books_catholic")).toEqual(section("Соборные послания"));
    expect(group("t_books_paul")).toEqual(section("Послания Павла"));
  });
});
