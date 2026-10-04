import { loadBook } from "./bible.js";

/**
 * Число слов в книге по тексту игры (Синодальный перевод): считается по главам, слово — последовательность букв,
 * дефис внутри слова не разрывает его («кто-нибудь» — одно слово). Нужно послам при обмене городами
 * (решение владельца 04.10): у города показывается, сколько слов в его книге. Считается один раз, дальше из кэша.
 */
const cache = new Map<string, number>();
const WORD = /[A-Za-zА-Яа-яЁё]+(?:-[A-Za-zА-Яа-яЁё]+)*/g;

export async function bookWords(code: string): Promise<number> {
  if (!code) return 0;
  const hit = cache.get(code);
  if (hit !== undefined) return hit;
  const book = await loadBook(code);
  let n = 0;
  for (const chapter of book?.chapters ?? []) for (const verse of chapter) n += verse.match(WORD)?.length ?? 0;
  cache.set(code, n);
  return n;
}
