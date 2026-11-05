import { describe, expect, it } from "vitest";
import { checkAnswer, chiasmHint, chiasmHintOrder, chiasmOrder, hintLimit, loadCityContent, publicTask } from "./services/cities.js";

/**
 * Стих-подтверждение у задания города (решение владельца 05.11): в Бытии задание о вере Авеля показывает Евр. 11:4
 * после верного ответа; команде до ответа стих не отдаётся. Кроссворд «Каин и Авель» — семь слов, «дьявол» с написанием
 * «диавол» (слово из 1 Ин. 3:12, пометка источника).
 */
describe("Бытие: задание о вере и кроссворд о Каине (решение владельца 05.11)", () => {
  it("контент читается по схеме; стих есть в контенте, но не в публичном задании", async () => {
    const c = await loadCityContent("gen");
    expect(c).not.toBeNull();
    const faith = c!.tasks[1]!;
    expect(faith.type).toBe("choice");
    if (faith.type !== "choice") return;
    expect(faith.options).toEqual(["вера", "кровная жертва", "хорошее воспитание", "самообладание"]);
    expect(faith.correct).toBe(0);
    expect(faith.reveal).toContain("Евр. 11:4");
    expect(faith.groupDistricts).toEqual([3]);
    const pub = publicTask(faith, 1, "secret", "scope") as Record<string, unknown>;
    expect(pub).not.toHaveProperty("reveal");
    expect((pub.options as string[]).slice().sort()).toEqual([...faith.options].sort());
    const cw = c!.tasks[2]!;
    expect(cw.type).toBe("crossword");
    if (cw.type !== "crossword") return;
    expect(cw.words.map((w) => w.answer)).toEqual(["всемеро", "земледелец", "знамение", "изгнанник", "тук", "дьявол", "восток"]);
    expect(cw.words.find((w) => w.answer === "дьявол")?.alt).toEqual(["диавол"]);
  });

  it("хиазм «Вавилонская башня» (05.11): строки перетасованы, центр виден, верный порядок — А…Д, Д′…А′", async () => {
    const c = await loadCityContent("gen");
    const task = c!.tasks[4]!;
    expect(task.type).toBe("chiasm");
    if (task.type !== "chiasm") return;
    expect(task.pairs).toHaveLength(5);
    expect(task.center).toBe("И сошёл Господь посмотреть");
    const order = chiasmOrder(task.pairs);
    expect(order[0]).toBe("Вся земля имела один язык"); expect(order[4]).toBe("Построим себе город и башню");
    expect(order[5]).toBe("Город и башню, которые строили"); expect(order[9]).toBe("Смешал язык всей земли");
    const pub = publicTask(task, 4, "secret", "team|node") as { items: Array<{ id: string; text: string }>; n: number; center: string; intro: string };
    expect(pub.n).toBe(5); expect(pub.items).toHaveLength(10); expect(pub).not.toHaveProperty("pairs"); expect(pub.intro).toContain("Хиазм");
    expect(pub.items.map((x) => x.text)).not.toEqual(order); // перетасовано
    const byText = new Map(pub.items.map((x) => [x.text, x.id]));
    const right = order.map((text) => byText.get(text)!);
    expect(checkAnswer(task, 4, "secret", "team|node", right)).toBe(true);
    expect(checkAnswer(task, 4, "secret", "team|node", [...right].reverse())).toBe(false);
    expect(checkAnswer(task, 4, "secret", "team|node", right.slice(0, 9))).toBe(false);
  });

  it("письма пророка к хиазму — по паре на свечу: сначала Б и Б′, затем А, В, Г, Д; hintPair выбирает первую (решения владельца 05.11)", async () => {
    const c = await loadCityContent("gen");
    const task = c!.tasks[4]!;
    if (task.type !== "chiasm") throw new Error("ожидался хиазм");
    expect(hintLimit(task)).toBe(5);
    expect(hintLimit(c!.tasks[0]!)).toBe(1);
    expect(chiasmHint(task)).toEqual({ mark: "Б", first: "Поселились там", second: "Рассеял их оттуда", place: 2, n: 5, step: 1 });
    expect([1, 2, 3, 4].map((k) => chiasmHint(task, k)?.mark)).toEqual(["А", "В", "Г", "Д"]);
    expect(chiasmHint(task, 4)).toMatchObject({ first: "Построим себе город и башню", second: "Город и башню, которые строили", step: 5 });
    expect(chiasmHint(task, 5)).toBeNull(); // все пары открыты
    expect(chiasmHintOrder({ ...task, hintPair: 1 })).toEqual([1, 2, 3, 4, 5]);
    expect(chiasmHintOrder({ ...task, hintPair: 99 })).toEqual([5, 1, 2, 3, 4]); // за пределами — последняя пара
    expect(chiasmHintOrder({ ...task, pairs: task.pairs.slice(0, 2) })).toEqual([2, 1]);
  });
});
