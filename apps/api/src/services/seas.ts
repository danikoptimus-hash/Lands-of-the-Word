import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { BOOKS, INLAND_SEAS, hexCorners, hexToPixel, parseVertexKey, vertexKey, vertexToPixel } from "@lotw/domain";
import { prisma } from "../db.js";
import { loadBook, type BibleBook } from "./bible.js";
import { checkAnswer, normalizeAnswer, opaqueId, publicTask, seededShuffle, type CityTask } from "./cities.js";

/**
 * Моря Библии (решение владельца 06.10): у каждого моря десять «вахт» — заданий-головоломок по Синодальному тексту.
 * Вахты задуманы так, чтобы ответ нельзя было спросить у ИИ: данные для ответа появляются только на экране участника и
 * у каждой команды свои (маяк мигает свой номер стиха, флаги раскрашены по-своему, слова стиха разложены по своей сетке),
 * а ответ требует открыть Библию и найти нужное место. Контент платформы: content/seas/<код моря>.json, ответы на
 * клиент не уходят. Когда все вахты решены и не меньше доли состава решили свою долю (правила ключа города, 50/50),
 * море открыто: команда один раз переходит его с берега на противоположный берег.
 */

const ref = z.object({ book: z.string().min(2), chapter: z.number().int().min(1), verse: z.number().int().min(1) });
/** Отрывок, который показывается внутри вахты (для промера глубины и «цепи» он обязателен). */
const passage = z.object({ book: z.string().min(2), chapter: z.number().int().min(1), from: z.number().int().min(1), to: z.number().int().min(1) });
const base = { title: z.string().min(1), prompt: z.string().min(1), show: z.array(passage).max(4).optional() };
const taskSchema = z.discriminatedUnion("type", [
  // Маяк: долгие вспышки — десятки, короткие — единицы: номер стиха главы; ответ — слово этого стиха (первое/последнее/по номеру).
  z.object({ ...base, type: z.literal("beacon"), book: z.string().min(2), chapter: z.number().int().min(1), verses: z.array(z.number().int().min(1)).min(2), word: z.union([z.literal("first"), z.literal("last"), z.number().int().min(1)]) }),
  // Курс по словам: слова стиха разложены по сетке среди чужих слов; нажимать их по порядку стиха.
  z.object({ ...base, type: z.literal("wordpath"), ...ref.shape, words: z.number().int().min(5).max(14).optional() }),
  // Сигнальные флаги: у команды своя азбука флагов; флаги дают главу и стих; ответ — слово этого стиха.
  z.object({ ...base, type: z.literal("flags"), book: z.string().min(2), chapter: z.number().int().min(1), verses: z.array(z.number().int().min(1)).min(3), word: z.union([z.literal("first"), z.literal("last"), z.number().int().min(1)]) }),
  // Шторм: стих разбит на обломки-слова, их надо собрать по порядку.
  z.object({ ...base, type: z.literal("storm"), ...ref.shape, words: z.number().int().min(5).max(20).optional() }),
  // Лот: сколько раз слово с таким корнем встречается в показанном отрывке.
  z.object({ ...base, type: z.literal("count"), ...passage.shape, stem: z.string().min(2) }),
  // Обычные формы городов.
  z.object({ ...base, type: z.literal("number"), answer: z.number() }),
  z.object({ ...base, type: z.literal("text"), answers: z.array(z.string().min(1)).min(1) }),
  z.object({ ...base, type: z.literal("choice"), options: z.array(z.string().min(1)).min(2), correct: z.number().int().min(0) }),
  z.object({ ...base, type: z.literal("order"), items: z.array(z.string().min(1)).min(3) }),
]);
const contentSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(1),
  nameEn: z.string().min(1),
  /** Другие имена моря в Писании — для подписи и вахт. */
  names: z.array(z.string()).default([]),
  intro: z.string().default(""),
  introEn: z.string().default(""),
  tasks: z.array(taskSchema).length(10),
});
export type SeaContent = z.infer<typeof contentSchema>;
export type SeaTask = SeaContent["tasks"][number];

const cache = new Map<string, SeaContent | null>();
const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content/seas");

export async function loadSeaContent(code: string): Promise<SeaContent | null> {
  if (!/^[a-z]+$/.test(code)) return null;
  if (cache.has(code)) return cache.get(code)!;
  let content: SeaContent | null = null;
  try {
    content = contentSchema.parse(JSON.parse(await readFile(path.join(contentDir, `${code}.json`), "utf8")));
  } catch (e) {
    if (!(e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT")) throw e;
  }
  cache.set(code, content);
  return content;
}

export const seaKeyOf = (code: string) => `sea:${code}`;

/** Детерминированный генератор по строке (xorshift; тот же приём, что seededShuffle). */
export function rngFrom(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}

/** Слова стиха без знаков препинания; дефисы внутри имён остаются. */
export function verseWords(text: string): string[] {
  return text.split(/\s+/).map((tok) => tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter((w) => /\p{L}/u.test(w));
}
function verseOf(book: BibleBook, chapter: number, verse: number): string | null {
  return book.chapters?.[chapter - 1]?.[verse - 1] ?? null;
}
function pickWord(words: string[], which: "first" | "last" | number): string | null {
  if (which === "first") return words[0] ?? null;
  if (which === "last") return words[words.length - 1] ?? null;
  return words[which - 1] ?? null;
}
const bookNameRu = (code: string) => BOOKS.find((b) => b.code === code)?.nameRu ?? code;

/** Показанные отрывки: текст с номерами стихов (для промера глубины и вахт с текстом на экране). */
export async function shownPassages(task: SeaTask) {
  const out: Array<{ ref: string; verses: Array<{ n: number; text: string }> }> = [];
  for (const p of task.show ?? []) {
    const book = await loadBook(p.book);
    if (!book?.chapters) continue;
    const verses = [];
    for (let v = p.from; v <= p.to; v++) { const t = verseOf(book, p.chapter, v); if (t) verses.push({ n: v, text: t }); }
    out.push({ ref: `${bookNameRu(p.book)} ${p.chapter}:${p.from}${p.to > p.from ? `–${p.to}` : ""}`, verses });
  }
  return out;
}

/** Семя команды для вахты: у каждой команды свои маяк, флаги и сетка, но постоянные между открытиями. */
const seedOf = (secret: string, scopeKey: string, index: number, kind: string) => `${secret.slice(0, 16)}|${scopeKey}|${kind}|${index}`;

/**
 * Вымпелы сигнальщика (десять рисунков в духе морских цифровых вымпелов). Азбука «цифра → вымпел» у каждой команды
 * своя и команде не выдаётся: её надо восстановить по подписанным сигналам — ссылкам на стихи той же книги
 * (решение владельца 06.10: «не детская вещь, а головоломка»). Последний, неподписанный сигнал — глава и стих ответа.
 */
export const FLAG_PATTERNS = ["disc-red", "disc-white", "thirds-rwb", "cross-red", "halves-yb", "halves-bw", "halves-yr", "cross-white", "quarters", "thirds-yry"] as const;
interface Beacon { long: number; short: number }
function beaconFor(task: Extract<SeaTask, { type: "beacon" }>, secret: string, scopeKey: string, index: number): { verse: number; signal: Beacon } {
  const rng = rngFrom(seedOf(secret, scopeKey, index, "beacon"));
  const verse = task.verses[Math.floor(rng() * task.verses.length)]!;
  return { verse, signal: { long: Math.floor(verse / 10), short: verse % 10 } };
}
async function flagsFor(task: Extract<SeaTask, { type: "flags" }>, secret: string, scopeKey: string, index: number) {
  const seed = seedOf(secret, scopeKey, index, "flags");
  const rng = rngFrom(seed);
  const verse = task.verses[Math.floor(rng() * task.verses.length)]!;
  const perm = seededShuffle(seed + "|perm", [...FLAG_PATTERNS]);
  const encode = (ref: string) => ref.split("").map((ch) => (ch === ":" ? null : perm[Number(ch)]!));
  // Подписанные сигналы: другие стихи вахты; если в ответе есть цифра, которой в них нет, добавляем стих с такой цифрой.
  const book = await loadBook(task.book);
  const verseCount = book?.verseCounts[task.chapter - 1] ?? 30;
  const cribs = task.verses.filter((v) => v !== verse).map((v) => `${task.chapter}:${v}`);
  const covered = () => new Set(cribs.join("").replace(/:/g, "").split(""));
  for (const d of `${task.chapter}:${verse}`.replace(":", "")) {
    if (covered().has(d)) continue;
    for (let v = 1; v <= verseCount; v++) if (String(v).includes(d) && v !== verse && !cribs.includes(`${task.chapter}:${v}`)) { cribs.push(`${task.chapter}:${v}`); break; }
  }
  const labelled = seededShuffle(seed + "|cribs", cribs).map((ref) => ({ label: `${bookNameRu(task.book)} ${ref}`, flags: encode(ref) }));
  return { verse, cribs: labelled, message: encode(`${task.chapter}:${verse}`) };
}
interface WordGrid { rows: number; cols: number; cells: Array<{ id: string; text: string }>; path: number[] }
function wordPathFor(words: string[], chapterWords: string[], secret: string, scopeKey: string, index: number): WordGrid {
  const n = words.length;
  const side = Math.max(4, Math.ceil(Math.sqrt(n * 2.2)));
  const seed = seedOf(secret, scopeKey, index, "wordpath");
  // Самоизбегающая случайная прогулка по сетке длиной n; если зашли в тупик — начинаем заново с другим семенем.
  let path: number[] = [];
  for (let attempt = 0; attempt < 400 && path.length < n; attempt++) {
    const rng = rngFrom(`${seed}|${attempt}`);
    const visited = new Set<number>();
    let cur = Math.floor(rng() * side * side);
    path = [cur]; visited.add(cur);
    while (path.length < n) {
      const r = Math.floor(cur / side), c = cur % side;
      const next = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([rr, cc]) => rr! >= 0 && rr! < side && cc! >= 0 && cc! < side).map(([rr, cc]) => rr! * side + cc!).filter((k) => !visited.has(k));
      if (!next.length) break;
      cur = next[Math.floor(rng() * next.length)]!;
      path.push(cur); visited.add(cur);
    }
  }
  // Чужие слова — из той же главы, кроме слов стиха (без учёта регистра), чтобы на сетке не было второго такого же слова.
  const used = new Set(words.map((w) => normalizeAnswer(w)));
  const pool = seededShuffle(seed + "|decoys", [...new Set(chapterWords.filter((w) => !used.has(normalizeAnswer(w)) && w.length >= 2))]);
  const cells: Array<{ id: string; text: string }> = [];
  let d = 0;
  for (let k = 0; k < side * side; k++) {
    const at = path.indexOf(k);
    const text = at >= 0 ? words[at]! : pool[d++ % Math.max(1, pool.length)] ?? "…";
    cells.push({ id: opaqueId(secret, scopeKey, "wp", index, k), text });
  }
  return { rows: side, cols: side, cells, path };
}

/** Вахта глазами команды: без ответов, с данными для своей команды. */
export async function publicSeaTask(task: SeaTask, index: number, secret: string, scopeKey: string) {
  const common = { index, type: task.type, title: task.title, prompt: task.prompt, show: await shownPassages(task) };
  switch (task.type) {
    case "beacon": {
      const b = beaconFor(task, secret, scopeKey, index);
      return { ...common, book: bookNameRu(task.book), chapter: task.chapter, word: task.word, signal: b.signal };
    }
    case "flags": {
      const f = await flagsFor(task, secret, scopeKey, index);
      return { ...common, book: bookNameRu(task.book), word: task.word, cribs: f.cribs, message: f.message };
    }
    case "wordpath": {
      const book = await loadBook(task.book);
      const text = book ? verseOf(book, task.chapter, task.verse) : null;
      const words = verseWords(text ?? "").slice(0, task.words ?? 10);
      const chapterWords = (book?.chapters?.[task.chapter - 1] ?? []).flatMap(verseWords);
      const g = wordPathFor(words, chapterWords, secret, scopeKey, index);
      return { ...common, book: bookNameRu(task.book), chapter: task.chapter, verse: task.verse, count: words.length, rows: g.rows, cols: g.cols, cells: g.cells };
    }
    case "storm": {
      const book = await loadBook(task.book);
      const words = verseWords((book ? verseOf(book, task.chapter, task.verse) : null) ?? "").slice(0, task.words ?? 20);
      const items = words.map((text, i) => ({ id: opaqueId(secret, scopeKey, "storm", index, i), text }));
      return { ...common, book: bookNameRu(task.book), chapter: task.chapter, verse: task.verse, items: seededShuffle(`${scopeKey}|storm|${index}`, items) };
    }
    case "count":
      return { ...common, stem: task.stem };
    default: {
      const city = { scope: "book", ...task } as unknown as CityTask;
      const p = publicTask(city, index, secret, scopeKey) as Record<string, unknown>;
      const { scope: _s, groupDistricts: _g, ...rest } = p;
      return { ...common, ...rest };
    }
  }
}

/** Ответ вахты (ответы никогда не уходят на клиент). */
export async function checkSeaAnswer(task: SeaTask, index: number, secret: string, scopeKey: string, answer: unknown): Promise<boolean> {
  switch (task.type) {
    case "beacon":
    case "flags": {
      if (typeof answer !== "string") return false;
      const verse = task.type === "beacon" ? beaconFor(task, secret, scopeKey, index).verse : (await flagsFor(task, secret, scopeKey, index)).verse;
      const book = await loadBook(task.book);
      const want = pickWord(verseWords((book ? verseOf(book, task.chapter, verse) : null) ?? ""), task.word);
      return want != null && normalizeAnswer(answer) === normalizeAnswer(want);
    }
    case "wordpath": {
      if (!Array.isArray(answer)) return false;
      const book = await loadBook(task.book);
      const words = verseWords((book ? verseOf(book, task.chapter, task.verse) : null) ?? "").slice(0, task.words ?? 10);
      const chapterWords = (book?.chapters?.[task.chapter - 1] ?? []).flatMap(verseWords);
      const g = wordPathFor(words, chapterWords, secret, scopeKey, index);
      return answer.length === g.path.length && g.path.every((k, i) => answer[i] === g.cells[k]!.id);
    }
    case "storm": {
      if (!Array.isArray(answer)) return false;
      const book = await loadBook(task.book);
      const words = verseWords((book ? verseOf(book, task.chapter, task.verse) : null) ?? "").slice(0, task.words ?? 20);
      // Сравниваем слова, а не id: одинаковые слова («и», «и») можно ставить в любом порядке между собой.
      const byId = new Map(words.map((text, i) => [opaqueId(secret, scopeKey, "storm", index, i), text]));
      if (answer.length !== words.length || new Set(answer).size !== answer.length) return false;
      return words.every((w, i) => { const got = byId.get(answer[i] as string); return got != null && normalizeAnswer(got) === normalizeAnswer(w); });
    }
    case "count": {
      const n = typeof answer === "number" ? answer : Number(String(answer).trim());
      return Number.isFinite(n) && n === await countStem(task);
    }
    default:
      return checkAnswer({ scope: "book", ...task } as unknown as CityTask, index, secret, scopeKey, answer);
  }
}

/** Промер глубины: сколько слов с корнем stem в отрывке (регистр и ё не важны). */
export async function countStem(task: Extract<SeaTask, { type: "count" }>): Promise<number> {
  const book = await loadBook(task.book);
  if (!book?.chapters) return -1;
  const stem = normalizeAnswer(task.stem);
  let n = 0;
  for (let v = task.from; v <= task.to; v++) for (const w of verseWords(verseOf(book, task.chapter, v) ?? "")) if (normalizeAnswer(w).startsWith(stem)) n++;
  return n;
}

/** Контент без ответов — администратору игры (ответы видит только администратор платформы). */
export function stripSeaAnswers(content: SeaContent) {
  return { ...content, tasks: content.tasks.map((t) => {
    const b = { type: t.type, title: t.title, prompt: t.prompt };
    switch (t.type) {
      case "beacon": case "flags": return { ...b, book: t.book, chapter: t.chapter, verses: t.verses, word: t.word };
      case "wordpath": case "storm": return { ...b, book: t.book, chapter: t.chapter, verse: t.verse };
      case "count": return { ...b, book: t.book, chapter: t.chapter, from: t.from, to: t.to, stem: t.stem };
      case "choice": return { ...b, options: t.options };
      case "order": return { ...b, items: t.items };
      default: return b;
    }
  }) };
}

// ───────────────────────────── География морей ─────────────────────────────
export interface SeaGeo { code: string; name: string; nameEn: string; hexes: Array<{ q: number; r: number }>; /** Берег: ключи узлов. */ shore: string[]; /** Центр моря в единицах карты (размер гекса 1). */ center: { x: number; y: number } }

/**
 * Карты, созданные до морей (например, «Осень»): их одиночные озёрные гексы получают имена морей по острову — на Ветхом
 * Завете Чермное, Солёное, воды Меромские, на Новом Галилейское и Адриатическое (по порядку обхода гексов); лишние
 * озёра остаются безымянными. Берег (узлы вокруг гекса) помечается тут же. Делается один раз, при первом обращении.
 */
export async function ensureSeaCodes(gameId: string): Promise<void> {
  const free = await prisma.mapHex.findMany({ where: { gameId, terrain: "water", sea: null }, select: { q: true, r: true, island: true }, orderBy: [{ r: "asc" }, { q: "asc" }] });
  if (!free.length) return;
  const taken = new Set((await prisma.mapHex.findMany({ where: { gameId, sea: { not: null } }, select: { sea: true } })).map((h) => h.sea!));
  for (const island of ["OT", "NT"] as const) {
    const names = INLAND_SEAS.filter((s) => s.island === island && !taken.has(s.code)).map((s) => s.code);
    for (const h of free.filter((x) => x.island === island)) {
      const code = names.shift();
      if (!code) break;
      await prisma.mapHex.update({ where: { gameId_q_r: { gameId, q: h.q, r: h.r } }, data: { sea: code } });
      await prisma.mapNode.updateMany({ where: { gameId, key: { in: hexCorners(h).map(vertexKey) }, sea: null }, data: { sea: code } });
    }
  }
}

/** Моря игры по карте: гексы воды с кодом моря, их берег и центр. */
export async function gameSeas(gameId: string): Promise<SeaGeo[]> {
  await ensureSeaCodes(gameId);
  const [hexes, nodes] = await Promise.all([
    prisma.mapHex.findMany({ where: { gameId, sea: { not: null } }, select: { q: true, r: true, sea: true } }),
    prisma.mapNode.findMany({ where: { gameId, sea: { not: null } }, select: { key: true, sea: true } }),
  ]);
  const out: SeaGeo[] = [];
  for (const spec of INLAND_SEAS) {
    const mine = hexes.filter((h) => h.sea === spec.code);
    if (!mine.length) continue;
    const pts = mine.map((h) => hexToPixel(h, 1));
    out.push({ code: spec.code, name: spec.name, nameEn: spec.nameEn, hexes: mine.map((h) => ({ q: h.q, r: h.r })), shore: nodes.filter((n) => n.sea === spec.code).map((n) => n.key), center: { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length } });
  }
  return out;
}

/**
 * Противоположный берег: узлы берега, направление на которые от центра моря отличается от направления на узел
 * отплытия не меньше чем на 90°.
 */
export function oppositeShore(sea: SeaGeo, fromKey: string): string[] {
  const ang = (k: string) => { const p = vertexToPixel(parseVertexKey(k), 1); return Math.atan2(p.y - sea.center.y, p.x - sea.center.x); };
  const a0 = ang(fromKey);
  return sea.shore.filter((k) => { let d = Math.abs(ang(k) - a0); if (d > Math.PI) d = 2 * Math.PI - d; return d >= Math.PI / 2; });
}
