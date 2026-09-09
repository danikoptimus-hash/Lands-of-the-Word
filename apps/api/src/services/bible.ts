import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Текст и разметка книг Библии (content/bible/<книга>.json, Синодальный перевод, русская нумерация).
 * Стихи книги нумеруются сквозным индексом 0..total-1 — так проще выдавать случайные отрывки и считать покрытие.
 */

const refSchema = z.string().regex(/^\d+:\d+$/);
const schema = z.object({
  code: z.string(),
  translation: z.string().default(""),
  verseCounts: z.array(z.number().int().min(1)).min(1),
  chapters: z.array(z.array(z.string())).optional(),
  genealogies: z.array(z.object({ from: refSchema, to: refSchema })).default([]),
});
export type BibleBook = z.infer<typeof schema> & { total: number; offsets: number[] };
export interface Ref { chapter: number; verse: number }

const cache = new Map<string, BibleBook | null>();
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content/bible");

export async function loadBook(code: string): Promise<BibleBook | null> {
  if (!/^[a-z0-9]+$/.test(code)) return null;
  if (cache.has(code)) return cache.get(code)!;
  let book: BibleBook | null = null;
  try {
    const raw = schema.parse(JSON.parse(await readFile(path.join(dir, `${code}.json`), "utf8")));
    if (raw.chapters && (raw.chapters.length !== raw.verseCounts.length || raw.chapters.some((c, i) => c.length !== raw.verseCounts[i]))) {
      throw new Error(`content/bible/${code}.json: chapters не совпадают с verseCounts`);
    }
    const offsets: number[] = [];
    let total = 0;
    for (const n of raw.verseCounts) { offsets.push(total); total += n; }
    book = { ...raw, total, offsets };
  } catch (e) {
    if (!(e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT")) throw e;
  }
  cache.set(code, book);
  return book;
}

export function refToIndex(book: BibleBook, ref: Ref): number | null {
  const count = book.verseCounts[ref.chapter - 1];
  if (!count || ref.verse < 1 || ref.verse > count) return null;
  return book.offsets[ref.chapter - 1]! + ref.verse - 1;
}
export function indexToRef(book: BibleBook, idx: number): Ref {
  let c = 0;
  while (c + 1 < book.offsets.length && book.offsets[c + 1]! <= idx) c++;
  return { chapter: c + 1, verse: idx - book.offsets[c]! + 1 };
}
export function parseRef(s: string): Ref | null {
  const m = /^\s*(\d+)\s*[:.,]\s*(\d+)\s*$/.exec(s);
  return m ? { chapter: Number(m[1]), verse: Number(m[2]) } : null;
}
export function formatRef(book: BibleBook, idx: number): string {
  const r = indexToRef(book, idx);
  return `${r.chapter}:${r.verse}`;
}
export function formatRange(book: BibleBook, start: number, end: number): string {
  const a = indexToRef(book, start), b = indexToRef(book, end);
  if (start === end) return `${a.chapter}:${a.verse}`;
  return a.chapter === b.chapter ? `${a.chapter}:${a.verse}–${b.verse}` : `${a.chapter}:${a.verse}–${b.chapter}:${b.verse}`;
}
export function verseText(book: BibleBook, idx: number): string | null {
  if (!book.chapters) return null;
  const r = indexToRef(book, idx);
  return book.chapters[r.chapter - 1]?.[r.verse - 1] ?? null;
}

/** Индексы стихов, попадающих в родословия. */
function genealogyMask(book: BibleBook): boolean[] {
  const mask = new Array<boolean>(book.total).fill(false);
  for (const g of book.genealogies) {
    const a = refToIndex(book, parseRef(g.from)!), b = refToIndex(book, parseRef(g.to)!);
    if (a === null || b === null) continue;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) mask[i] = true;
  }
  return mask;
}

/**
 * Случайный последовательный отрывок из n стихов. Если родословия исключены, отрывок их не задевает.
 * null — если такого отрывка в книге нет.
 */
export function randomPassage(book: BibleBook, n: number, includeGenealogies: boolean, rnd: () => number = Math.random): { start: number; end: number } | null {
  if (n < 1 || n > book.total) return null;
  const mask = includeGenealogies ? null : genealogyMask(book);
  const starts: number[] = [];
  for (let s = 0; s + n <= book.total; s++) {
    if (mask) { let bad = false; for (let i = s; i < s + n; i++) if (mask[i]) { bad = true; break; } if (bad) continue; }
    starts.push(s);
  }
  if (starts.length === 0) return null;
  const start = starts[Math.floor(rnd() * starts.length)]!;
  return { start, end: start + n - 1 };
}
