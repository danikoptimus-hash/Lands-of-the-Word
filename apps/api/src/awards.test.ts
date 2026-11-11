import { describe, expect, it } from "vitest";
import { computeAwards, gameDayKey, streakOf } from "./services/awards.js";

const TZ = "Asia/Tashkent";
const d = (s: string) => new Date(s);

describe("серия дней", () => {
  it("игровые сутки идут с 07:00 по поясу игры: 06:59 — ещё вчера", () => {
    expect(gameDayKey(d("2026-10-29T01:59:00Z"), TZ)).toBe("2026-10-28"); // 06:59 Ташкент
    expect(gameDayKey(d("2026-10-29T02:00:00Z"), TZ)).toBe("2026-10-29"); // 07:00
  });
  it("строгая: пропуск рвёт; без сегодняшнего дела серия со вчера жива; рубежи по 5", () => {
    const s = streakOf(new Set(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"]), "2026-10-29");
    expect(s.current).toBe(4); expect(s.today).toBe(false); expect(s.next).toBe(5); expect(s.toNext).toBe(1);
    const gap = streakOf(new Set(["2026-10-20", "2026-10-21", "2026-10-23", "2026-10-29"]), "2026-10-29");
    expect(gap.current).toBe(1); expect(gap.best).toBe(2);
    expect(streakOf(new Set(["2026-10-27"]), "2026-10-29").current).toBe(0);
  });
});

describe("награды по истории", () => {
  const base = { tz: TZ, now: d("2026-10-29T12:00:00Z"), nodes: [{ key: "N:1,1", kind: "CITY", island: "OT" }], hexes: [], nodeStates: [], cityStates: [], battles: [], entries: [], wall: [], passages: [], peeks: [], works: [], journal: [] };
  const task = (i: number, u: string, day: string, extra: Partial<Parameters<typeof computeAwards>[0]["tasks"][number]> = {}) => ({ id: `t${i}`, teamId: "T", status: "APPROVED", takenById: u, participants: [], takenAt: d(`${day}T03:00:00Z`), submittedAt: d(`${day}T04:00:00Z`), decidedAt: d(`${day}T05:00:00Z`), sea: false, paved: false, toKey: "N:0,0", ...extra });
  it("первое дело команды и участника, рубеж серии 5 дней, ключник за дорогу в город", () => {
    const days = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"];
    const tasks = days.map((day, i) => task(i, "u1", day, i === 4 ? { toKey: "N:1,1" } : {}));
    const g = computeAwards({ ...base, teams: [{ id: "T", members: ["u1", "u2"] }], tasks });
    const codes = g.map((x) => `${x.userId || "team"}:${x.code}`);
    expect(codes).toContain("team:t_first_deed");
    expect(codes).toContain("u1:p_first_deed");
    expect(codes).toContain("u1:p_streak_5");
    expect(codes).toContain("u1:p_keyholder");
    expect(codes).not.toContain("team:t_full_crew"); // u2 ничего не сдал
    expect(g.find((x) => x.code === "p_streak_5")!.at.toISOString()).toBe("2026-10-24T04:00:00.000Z");
  });
  it("ранняя птица: одно дело, взятое утром и сданное тем же утром до 9; взятое вчера не считается", () => {
    const late = task(9, "u1", "2026-10-26", { takenAt: d("2026-10-25T15:00:00Z"), submittedAt: d("2026-10-26T03:00:00Z") }); // взял вчера, сдал в 08:00
    expect(computeAwards({ ...base, teams: [{ id: "T", members: ["u1"] }], tasks: [late] }).some((x) => x.code === "p_early_bird")).toBe(false);
    const night = task(8, "u1", "2026-10-26", { takenAt: d("2026-10-25T20:00:00Z"), submittedAt: d("2026-10-25T22:30:00Z") }); // те же игровые сутки, но ночью
    expect(computeAwards({ ...base, teams: [{ id: "T", members: ["u1"] }], tasks: [night] }).some((x) => x.code === "p_early_bird")).toBe(false);
    const morning = task(7, "u1", "2026-10-26", { takenAt: d("2026-10-26T02:10:00Z"), submittedAt: d("2026-10-26T03:30:00Z") }); // 07:10 → 08:30
    expect(computeAwards({ ...base, teams: [{ id: "T", members: ["u1"] }], tasks: [morning] }).some((x) => x.code === "p_early_bird")).toBe(true);
  });
  it("ранняя птица засчитывается за каждое такое дело (решение владельца 03.11)", () => {
    const days = ["2026-10-24", "2026-10-25", "2026-10-26"];
    const tasks = days.map((day, i) => task(20 + i, "u1", day, { takenAt: d(`${day}T02:10:00Z`), submittedAt: d(`${day}T03:30:00Z`) }));
    const birds = computeAwards({ ...base, teams: [{ id: "T", members: ["u1"] }], tasks }).filter((x) => x.code === "p_early_bird");
    expect(birds.length).toBe(3);
    expect(new Set(birds.map((x) => x.key)).size).toBe(3); // ключ — id дела, записи не схлопываются
  });
  it("заученные стихи: испытания и стена, каждый стих один раз; рубежи 10, 50, 100, 200, прежние 30 и 60 не выдаются", () => {
    const rec = (book: string, from: number, to: number, day: string, extra: { carried?: boolean } = {}) => ({ userId: "u1", teamId: "T", bookCode: book, startIdx: from, endIdx: to, carried: false, decidedAt: d(`${day}T10:00:00Z`), createdAt: d(`${day}T09:00:00Z`), ...extra });
    const entries = [
      rec("PSA", 0, 29, "2026-10-20"), // 30 стихов в испытании
      rec("PSA", 0, 29, "2026-10-21"), // те же стихи в другом испытании — не новые
      rec("PSA", 30, 89, "2026-10-22", { carried: true }), // перенесено из прошлого вызова — не новые
      rec("JHN", 0, 99, "2026-10-24"), // ещё 100 → 140
    ];
    const wall = [
      rec("PSA", 20, 39, "2026-10-21"), // 10 новых (30–39) → 40
      rec("ROM", 0, 59, "2026-10-25"), // 60 новых → 200
      rec("ROM", 50, 59, "2026-10-26"), // починка блока — те же стихи
    ];
    const g = computeAwards({ ...base, teams: [{ id: "T", members: ["u1"] }], tasks: [], entries, wall }).filter((x) => x.code.startsWith("p_verses_"));
    const at = Object.fromEntries(g.map((x) => [x.code, x.at.toISOString().slice(0, 10)]));
    expect(at).toEqual({ p_verses_10: "2026-10-20", p_verses_50: "2026-10-24", p_verses_100: "2026-10-24", p_verses_200: "2026-10-25" });
  });
  it("собранные группы книг (решение владельца 11.11): каждый город группы взят хоть раз; потерянный город не отнимает", () => {
    const books = ["gen", "exo", "lev", "num", "deu", "luk", "act", "1pe", "2pe"];
    const nodes = books.map((b, i) => ({ key: `N:${i},0`, kind: "CITY", island: "OT", bookCode: b }));
    const city = (b: string, day: string, held = true) => {
      const key = nodes.find((n) => n.bookCode === b)!.key;
      return { teamId: "T", nodeKey: key, capturedAt: held ? d(`${day}T10:00:00Z`) : null, firstCapturedAt: d(`${day}T10:00:00Z`) };
    };
    const cityStates = [
      city("gen", "2026-10-20"), city("exo", "2026-10-21"), city("lev", "2026-10-22", false), // Левит потерян по испытанию
      city("num", "2026-10-23"), city("deu", "2026-10-25"),
      city("luk", "2026-10-24"), // Деяний нет — книги Луки не собраны
      city("1pe", "2026-10-22"), city("2pe", "2026-10-26"),
      { teamId: "X", nodeKey: nodes.find((n) => n.bookCode === "act")!.key, capturedAt: d("2026-10-20T10:00:00Z"), firstCapturedAt: d("2026-10-20T10:00:00Z") },
    ];
    const g = computeAwards({ ...base, nodes, cityStates, teams: [{ id: "T", members: [] }, { id: "X", members: [] }], tasks: [] }).filter((x) => x.code.startsWith("t_books_"));
    const got = Object.fromEntries(g.map((x) => [`${x.teamId}:${x.code}`, x.at.toISOString().slice(0, 10)]));
    expect(got).toEqual({ "T:t_books_torah": "2026-10-25", "T:t_books_peter": "2026-10-26" });
  });
});
