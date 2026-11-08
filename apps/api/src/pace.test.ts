import { describe, expect, it } from "vitest";
import { citySeries, uniqueVerses, uniqueVersesByTeam, versesByDay, type Recited } from "./services/pace.js";

const TZ = "Asia/Tashkent";
const at = (day: string) => new Date(`${day}T10:00:00Z`);
const rec = (userId: string, teamId: string, bookCode: string, startIdx: number, endIdx: number, day: string): Recited => ({ userId, teamId, bookCode, startIdx, endIdx, at: at(day) });
const flat = (m: Map<string, Map<string, number>>) => Object.fromEntries([...m].map(([d, t]) => [d, Object.fromEntries(t)]));

describe("стихов в день (решение владельца 04.11)", () => {
  const days = ["2026-11-01", "2026-11-02", "2026-11-03"];
  it("один стих у двоих — два стиха; свой стих второй раз не считается; день — первое принятие", () => {
    const rows = [
      rec("u1", "A", "PSA", 3, 7, "2026-11-02"), // стена: 3 и 4 уже выучены 1 ноября, новые только 5–7
      rec("u1", "A", "PSA", 0, 4, "2026-11-01"), // испытание: 5 стихов
      rec("u2", "A", "PSA", 0, 4, "2026-11-01"), // те же стихи у другого участника — ещё 5
      rec("u3", "B", "JHN", 0, 9, "2026-11-03"), // 10 стихов
      rec("u3", "B", "JHN", 5, 9, "2026-11-03"), // починка блока — те же стихи
      rec("u3", "B", "JHN", 0, 0, "2026-11-03"), // тот же номер стиха, но
      rec("u3", "B", "ROM", 0, 0, "2026-11-03"), // в другой книге — новый стих
      rec("u4", "B", "MRK", 0, 2, "2026-10-20"), // до партии: в график не попадает
    ];
    expect(flat(versesByDay(rows, days, TZ))).toEqual({
      "2026-11-01": { A: 10 },
      "2026-11-02": { A: 3 },
      "2026-11-03": { B: 11 },
    });
    // Уникальные стихи (решение владельца 05.11): один стих у разных участников и команд — один; PSA 0–7, JHN 0–9, ROM 0, MRK 0–2.
    expect(uniqueVerses(rows)).toBe(8 + 10 + 1 + 3);
    expect(uniqueVerses([])).toBe(0);
    // По командам (05.11): у A — PSA 0–7, у B — JHN 0–9, ROM 0, MRK 0–2; объединение по выбранным командам считает клиент.
    const by = uniqueVersesByTeam(rows);
    expect(by.total).toBe(22); expect(by.byTeam.A).toHaveLength(8); expect(by.byTeam.B).toHaveLength(14);
    expect(new Set([...by.byTeam.A!, ...by.byTeam.B!]).size).toBe(22);
  });
});

describe("серии городов: руины не растят общий счёт (замечание владельца 08.11)", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 10));
  const dayOf = (d: Date) => (d.getTime() - day(0).getTime()) / 86_400_000;
  // Линия команды — как её строит клиент: плюс за взятие, плюс за переход к ней, минус за переход от неё.
  const line = (teamId: string, r: ReturnType<typeof citySeries>) =>
    r.caps.filter((c) => c.teamId === teamId).length + r.transfers.filter((x) => x.to === teamId).length - r.transfers.filter((x) => x.from === teamId).length;

  it("занятые руины — переход к команде, общий счёт прежний; выбывшая теряет все города в момент поражения", () => {
    const events = [
      { kind: "city_captured" as const, teamId: "A", at: day(1) },
      { kind: "city_captured" as const, teamId: "A", at: day(2) },
      { kind: "city_captured" as const, teamId: "A", at: day(3) },
      { kind: "city_captured" as const, teamId: "B", at: day(4) },
      { kind: "ruins_taken" as const, teamId: "B", at: day(6) },
    ];
    // День 5: B берёт столицу A — A выбывает, два других её города становятся руинами.
    const wins = [{ attackerId: "B", defenderId: "A", resolvedAt: day(5) }];
    const r = citySeries(events, wins, new Set(["A"]), dayOf);
    expect(r.caps.length).toBe(4); // три города A и один B; руины шестого дня — не новый город
    expect(r.transfers).toEqual([
      { day: 5, from: "A", to: "B" },
      { day: 5, from: "A", to: null },
      { day: 5, from: "A", to: null },
      { day: 6, from: null, to: "B" },
    ]);
    expect(line("A", r)).toBe(0);
    expect(line("B", r)).toBe(3);
  });

  it("без поражений — только переходы по испытаниям", () => {
    const events = [{ kind: "city_captured" as const, teamId: "A", at: day(1) }, { kind: "city_captured" as const, teamId: "B", at: day(2) }];
    const r = citySeries(events, [{ attackerId: "B", defenderId: "A", resolvedAt: day(3) }], new Set(), dayOf);
    expect(r.caps.length).toBe(2);
    expect(r.transfers).toEqual([{ day: 3, from: "A", to: "B" }]);
    expect(line("A", r)).toBe(0);
    expect(line("B", r)).toBe(2);
  });
});
