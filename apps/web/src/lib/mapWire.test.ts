import { describe, expect, it } from "vitest";
import jsonPatch from "fast-json-patch";
import { hydrateMap, slimMap } from "./mapWire";
import type { MyMapDto } from "./api";

const deedA = { id: "d1", title: "Помощь по хозяйству", description: "Помочь семье", direction: "Семьи", proofType: "PHOTO_LINK", secret: false, remote: false };
const deedB = { ...deedA, id: "d2", title: "Проповедь по книге Иона" };
const wire = () => ({
  rev: 5, status: "ACTIVE",
  deedTexts: { ka: deedA, kb: deedB },
  tasks: [
    { id: "t1", deedId: "d1", deedKey: "ka", status: "OPEN", links: [], note: "" },
    { id: "t2", deedId: "d1", deedKey: "ka", status: "TAKEN", links: [], note: "" },
    { id: "t3", deedId: "d2", deedKey: "kb", status: "OPEN", links: [], note: "" },
  ],
}) as unknown as MyMapDto;

describe("карта со справочником текстов дел", () => {
  it("тексты расставляются по сторонам общими объектами, без копий", () => {
    const m = hydrateMap(wire());
    expect(m.tasks.map((t) => t.deed.title)).toEqual([deedA.title, deedA.title, deedB.title]);
    expect(m.tasks[0]!.deed).toBe(m.tasks[1]!.deed);
    // повторная расстановка ничего не меняет — тот же объект
    expect(hydrateMap(m)).toBe(m);
  });

  it("облегчённая карта равна тому, что прислал сервер", () => {
    const m = hydrateMap(wire());
    expect(JSON.parse(JSON.stringify(slimMap(m)))).toEqual(JSON.parse(JSON.stringify(wire())));
    // и снова раскладывается
    expect(hydrateMap(JSON.parse(JSON.stringify(slimMap(m))) as MyMapDto).tasks[2]!.deed.title).toBe(deedB.title);
  });

  it("ответ прежнего вида (текст в каждой стороне) остаётся как есть", () => {
    const old = { rev: 1, tasks: [{ id: "t1", deed: deedA }] } as unknown as MyMapDto;
    expect(hydrateMap(old)).toBe(old);
    expect(slimMap(old)).toBe(old);
    expect(hydrateMap(null)).toBeNull();
  });

  it("«разница» сервера ложится на карту с расставленными текстами: новая сторона, смена дела, сдвиг списка", () => {
    const before = wire() as unknown as { tasks: Array<Record<string, unknown>>; deedTexts: Record<string, unknown> };
    const deedC = { ...deedA, id: "d3", title: "Навестить вдову" };
    const after = JSON.parse(JSON.stringify(before)) as typeof before;
    after.tasks.splice(0, 1);                                   // первая сторона исчезла: остальные сдвинулись
    after.tasks[0]!.status = "SUBMITTED";
    after.tasks.push({ id: "t4", deedId: "d3", deedKey: "kc", status: "OPEN", links: [], note: "" });
    after.deedTexts.kc = deedC;
    const patch = jsonPatch.compare(before, after);
    const shown = hydrateMap(wire());
    const next = hydrateMap(jsonPatch.applyPatch(shown, patch, true, false).newDocument as MyMapDto);
    expect(next.tasks.map((t) => [t.id, t.status, t.deed.title])).toEqual([
      ["t2", "SUBMITTED", deedA.title], ["t3", "OPEN", deedB.title], ["t4", "OPEN", deedC.title],
    ]);
    // исходная карта на экране не тронута
    expect(shown.tasks.length).toBe(3);
  });
});
