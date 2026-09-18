/**
 * Кроссворд по району (решение владельца 18.09, C-09): задание района нового типа. Слова — из текста района,
 * сетка строится детерминированно из списка слов, поэтому сервер и клиент видят одну и ту же раскладку, а
 * ответ команды — слова по номерам. Раскладка жадная: самое длинное слово — по горизонтали, остальные
 * цепляются к уже стоящим буквам перпендикулярно; слово без пересечений встаёт отдельной строкой ниже.
 */

export type Dir = "across" | "down";
export interface PlacedWord { n: number; row: number; col: number; dir: Dir; len: number; clue: string; /** Индекс слова в контенте. */ src: number }
export interface CrosswordLayout { rows: number; cols: number; words: PlacedWord[] }

/** Буквы слова для сетки: без пробелов и дефисов, ё → е, верхний регистр. */
export function gridLetters(s: string): string[] {
  return Array.from(s.toUpperCase().replace(/Ё/g, "Е").replace(/[^\p{L}]/gu, ""));
}

export function layoutCrossword(words: Array<{ clue: string; answer: string }>): CrosswordLayout {
  const cells = new Map<string, string>();
  const key = (r: number, c: number) => `${r},${c}`;
  const at = (r: number, c: number) => cells.get(key(r, c));
  const placed: Array<{ row: number; col: number; dir: Dir; letters: string[]; src: number }> = [];
  const order = words.map((w, i) => ({ letters: gridLetters(w.answer), src: i })).sort((a, b) => b.letters.length - a.letters.length || a.src - b.src);

  function fits(letters: string[], row: number, col: number, dir: Dir): number {
    const dr = dir === "down" ? 1 : 0, dc = dir === "across" ? 1 : 0;
    // Клетка перед началом и после конца должна быть пустой, иначе слова склеятся.
    if (at(row - dr, col - dc) || at(row + dr * letters.length, col + dc * letters.length)) return -1;
    let cross = 0;
    for (let i = 0; i < letters.length; i++) {
      const r = row + dr * i, c = col + dc * i;
      const cur = at(r, c);
      if (cur) { if (cur !== letters[i]) return -1; cross++; continue; }
      // Пустая клетка: соседи поперёк должны быть пустыми, иначе рядом образуется случайное слово.
      if (at(r + dc, c + dr) || at(r - dc, c - dr)) return -1;
    }
    return cross;
  }
  function put(letters: string[], row: number, col: number, dir: Dir, src: number) {
    const dr = dir === "down" ? 1 : 0, dc = dir === "across" ? 1 : 0;
    letters.forEach((ch, i) => cells.set(key(row + dr * i, col + dc * i), ch));
    placed.push({ row, col, dir, letters, src });
  }

  for (const w of order) {
    if (!placed.length) { put(w.letters, 0, 0, "across", w.src); continue; }
    let best: { row: number; col: number; dir: Dir; cross: number } | null = null;
    for (const p of placed) {
      const dir: Dir = p.dir === "across" ? "down" : "across";
      p.letters.forEach((ch, pi) => {
        w.letters.forEach((wc, wi) => {
          if (ch !== wc) return;
          const pr = p.row + (p.dir === "down" ? pi : 0), pc = p.col + (p.dir === "across" ? pi : 0);
          const row = pr - (dir === "down" ? wi : 0), col = pc - (dir === "across" ? wi : 0);
          const cross = fits(w.letters, row, col, dir);
          if (cross > 0 && (!best || cross > best.cross)) best = { row, col, dir, cross };
        });
      });
    }
    if (best) { const b = best as { row: number; col: number; dir: Dir }; put(w.letters, b.row, b.col, b.dir, w.src); continue; }
    // Не пересеклось ни с чем: отдельной строкой ниже всего.
    const maxRow = Math.max(...Array.from(cells.keys(), (k) => Number(k.split(",")[0])));
    const minCol = Math.min(...Array.from(cells.keys(), (k) => Number(k.split(",")[1])));
    put(w.letters, maxRow + 2, minCol, "across", w.src);
  }
  const rs = Array.from(cells.keys(), (k) => Number(k.split(",")[0])), cs = Array.from(cells.keys(), (k) => Number(k.split(",")[1]));
  const r0 = Math.min(...rs), c0 = Math.min(...cs);
  const norm = placed.map((p) => ({ row: p.row - r0, col: p.col - c0, dir: p.dir, len: p.letters.length, clue: words[p.src]!.clue, src: p.src }));
  // Нумерация как в кроссворде: по клеткам сверху вниз и слева направо; два слова из одной клетки делят номер.
  norm.sort((a, b) => a.row - b.row || a.col - b.col || (a.dir === "across" ? -1 : 1));
  let n = 0;
  let last = "";
  const out: PlacedWord[] = norm.map((p) => { const k = `${p.row},${p.col}`; if (k !== last) { n++; last = k; } return { n, ...p }; });
  return { rows: Math.max(...rs) - r0 + 1, cols: Math.max(...cs) - c0 + 1, words: out };
}
