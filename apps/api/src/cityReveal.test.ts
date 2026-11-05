import { describe, expect, it } from "vitest";
import { loadCityContent, publicTask } from "./services/cities.js";

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
});
