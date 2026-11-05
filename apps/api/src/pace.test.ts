import { describe, expect, it } from "vitest";
import { uniqueVerses, versesByDay, type Recited } from "./services/pace.js";

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
  });
});
