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
  const base = { tz: TZ, now: d("2026-10-29T12:00:00Z"), nodes: [{ key: "N:1,1", kind: "CITY", island: "OT" }], hexes: [], nodeStates: [], cityStates: [], battles: [], entries: [], passages: [], peeks: [], works: [], journal: [] };
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
  it("ранняя птица: взял и сдал в те же сутки до 9 утра, пять раз", () => {
    const tasks = Array.from({ length: 5 }, (_, i) => task(i, "u1", `2026-10-2${i}`, { takenAt: d(`2026-10-2${i}T02:10:00Z`), submittedAt: d(`2026-10-2${i}T03:30:00Z`) })); // 07:10 → 08:30
    const late = task(9, "u1", "2026-10-26", { takenAt: d("2026-10-25T15:00:00Z"), submittedAt: d("2026-10-26T03:00:00Z") }); // взял вчера
    const g = computeAwards({ ...base, teams: [{ id: "T", members: ["u1"] }], tasks: [...tasks.slice(0, 4), late] });
    expect(g.some((x) => x.code === "p_early_bird")).toBe(false);
    const g2 = computeAwards({ ...base, teams: [{ id: "T", members: ["u1"] }], tasks });
    expect(g2.some((x) => x.code === "p_early_bird")).toBe(true);
  });
});
