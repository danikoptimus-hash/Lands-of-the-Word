import { readFile } from "node:fs/promises";
import { createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { gridLetters, layoutCrossword } from "./crossword.js";

/**
 * Города на перекрёстках: неизменяемый контент платформы (content/cities/<книга>.json).
 * Команда сначала расставляет районы (сцены книги) по порядку, затем решает по одному заданию
 * в каждом районе; каждое задание даёт букву шифра; все буквы — код для конверта с ключом.
 * Ответы на клиент никогда не уходят: проверка только здесь.
 */

const taskBase = { scope: z.enum(["district", "group", "book"]), groupDistricts: z.array(z.number().int().min(1)).optional(), prompt: z.string().min(1) };
const taskSchema = z.discriminatedUnion("type", [
  z.object({ ...taskBase, type: z.literal("number"), answer: z.number() }),
  z.object({ ...taskBase, type: z.literal("text"), answers: z.array(z.string().min(1)).min(1) }),
  z.object({ ...taskBase, type: z.literal("choice"), options: z.array(z.string().min(1)).min(2), correct: z.number().int().min(0) }),
  z.object({ ...taskBase, type: z.literal("order"), items: z.array(z.string().min(1)).min(2) }),
  // Кроссворд по району (решение владельца 18.09): 4–8 слов из текста района, подсказки — вопросы к ним.
  z.object({ ...taskBase, type: z.literal("crossword"), words: z.array(z.object({ clue: z.string().min(1), answer: z.string().min(2) })).min(3).max(8) }),
]);
const contentSchema = z.object({
  book: z.string().min(1),
  title: z.string().min(1),
  translation: z.string().default(""),
  codeRule: z.string().default("Каждое задание даёт один знак шифра. Знаки по порядку заданий — это шифр города."),
  districts: z.array(z.object({ verses: z.string(), title: z.string().min(1), summary: z.string().min(1) })).min(2),
  tasks: z.array(taskSchema).min(1),
}).refine((c) => c.tasks.length >= c.districts.length && c.tasks.every((t, i) => i < c.districts.length || t.scope !== "district"), { message: "На каждый район — одно задание; дополнительные задания могут быть только по книге или по группе районов" });

export type CityContent = z.infer<typeof contentSchema>;
export type CityTask = CityContent["tasks"][number];

const cache = new Map<string, CityContent | null>();
const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content/cities");

/** Контент книги или null, если задания для книги ещё не готовы. */
export async function loadCityContent(bookCode: string): Promise<CityContent | null> {
  if (!/^[a-z0-9]+$/.test(bookCode)) return null;
  if (cache.has(bookCode)) return cache.get(bookCode)!;
  let content: CityContent | null = null;
  try {
    content = contentSchema.parse(JSON.parse(await readFile(path.join(contentDir, `${bookCode}.json`), "utf8")));
  } catch (e) {
    if (!(e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT")) throw e;
  }
  cache.set(bookCode, content);
  return content;
}

/** Шифр города: случайные русские буквы и цифры без похожих знаков, по одному на район. Свой в каждой игре. */
export function makeCityCode(length: number): string {
  const alphabet = "АБВГДЕЖИКЛМНПРСТУФХЦЧШЭЮЯ23456789";
  const bytes = randomBytes(Math.max(1, length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]!).join("");
}

/** Ключ конверта: 6 знаков без похожих символов (0/O, 1/I). */
export function makeCityKey(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]!).join("");
}

/** Сравнение текстовых ответов: регистр, ё/е, пунктуация и лишние пробелы не важны. */
export function normalizeAnswer(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** Непрозрачные идентификаторы элементов (районов, пунктов «расставь по порядку»), чтобы порядок нельзя было прочитать из id. */
export function opaqueId(secret: string, ...parts: Array<string | number>): string {
  return createHmac("sha256", secret).update(parts.join("|")).digest("base64url").slice(0, 10);
}

/** Детерминированная перетасовка (стабильна между перезагрузками страницы, пока порядок не собран). */
export function seededShuffle<T>(seed: string, items: readonly T[]): T[] {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

/**
 * Порядок вариантов ответа у команды (первый шаг вариативности между играми): показанная позиция i — это
 * исходный вариант perm[i]. Зависит от секрета игры и команды, поэтому «ответ — третий» из другой игры не помогает.
 */
export function choicePermutation(secret: string, scopeKey: string, index: number, n: number): number[] {
  return seededShuffle(`${secret.slice(0, 12)}|${scopeKey}|choice|${index}`, Array.from({ length: n }, (_, i) => i));
}

/** Задание без ответа — то, что видит команда. Пункты «по порядку» и варианты выбора перетасованы. */
export function publicTask(task: CityTask, index: number, secret: string, scopeKey: string) {
  const base = { index, scope: task.scope, groupDistricts: task.groupDistricts ?? null, type: task.type, prompt: task.prompt };
  if (task.type === "choice") return { ...base, options: choicePermutation(secret, scopeKey, index, task.options.length).map((i) => task.options[i]!) };
  if (task.type === "order") {
    const items = task.items.map((text, i) => ({ id: opaqueId(secret, scopeKey, "task", index, i), text }));
    return { ...base, items: seededShuffle(`${scopeKey}|task|${index}`, items) };
  }
  if (task.type === "crossword") {
    // Сетка без букв: номера, позиции, направления, длины и вопросы. Ответ — слова в этом же порядке.
    const l = layoutCrossword(task.words);
    return { ...base, rows: l.rows, cols: l.cols, words: l.words.map(({ src: _src, ...w }) => w) };
  }
  return base;
}

/** Проверка ответа. Для «order» ответ — массив id в выбранном порядке. */
export function checkAnswer(task: CityTask, index: number, secret: string, scopeKey: string, answer: unknown): boolean {
  switch (task.type) {
    case "number": {
      const n = typeof answer === "number" ? answer : Number(String(answer).trim().replace(",", "."));
      return Number.isFinite(n) && n === task.answer;
    }
    case "text": {
      if (typeof answer !== "string") return false;
      const a = normalizeAnswer(answer);
      return a.length > 0 && task.answers.some((x) => normalizeAnswer(x) === a);
    }
    case "choice": {
      const n = typeof answer === "number" ? answer : Number(answer);
      if (!Number.isInteger(n) || n < 0 || n >= task.options.length) return false;
      return choicePermutation(secret, scopeKey, index, task.options.length)[n] === task.correct;
    }
    case "order": {
      if (!Array.isArray(answer) || answer.length !== task.items.length) return false;
      return task.items.every((_, i) => answer[i] === opaqueId(secret, scopeKey, "task", index, i));
    }
    case "crossword": {
      // Все слова разом: сравниваются буквы сетки (регистр, ё/е, пробелы и дефисы не важны).
      const l = layoutCrossword(task.words);
      if (!Array.isArray(answer) || answer.length !== l.words.length) return false;
      return l.words.every((w, i) => typeof answer[i] === "string" && gridLetters(answer[i] as string).join("") === gridLetters(task.words[w.src]!.answer).join(""));
    }
  }
}

/** Районы для команды: пока порядок не собран — перетасованы с непрозрачными id; после — по порядку книги. */
export function publicDistricts(content: CityContent, secret: string, scopeKey: string, solved: boolean) {
  const items = content.districts.map((d, i) => ({ id: opaqueId(secret, scopeKey, "district", i), verses: d.verses, title: d.title, summary: d.summary, index: solved ? i : null }));
  return solved ? items : seededShuffle(`${scopeKey}|districts`, items);
}

/** Сколько районов стоят не на своём месте (0 — порядок собран). */
export function checkOrder(content: CityContent, secret: string, scopeKey: string, ids: string[]): number | null {
  if (ids.length !== content.districts.length || new Set(ids).size !== ids.length) return null;
  let wrong = 0;
  content.districts.forEach((_, i) => { if (ids[i] !== opaqueId(secret, scopeKey, "district", i)) wrong++; });
  return wrong;
}

/** Содержимое города без ответов: для администраторов игры (ответы видит только администратор платформы). */
export function stripAnswers(content: CityContent) {
  return {
    ...content,
    tasks: content.tasks.map((t) => {
      const base = { scope: t.scope, groupDistricts: t.groupDistricts ?? null, type: t.type, prompt: t.prompt };
      return t.type === "choice" ? { ...base, options: t.options } : t.type === "crossword" ? { ...base, words: t.words.map((w) => ({ clue: w.clue, len: gridLetters(w.answer).length })) } : base;
    }),
  };
}
