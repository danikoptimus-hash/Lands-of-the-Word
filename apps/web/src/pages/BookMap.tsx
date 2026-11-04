import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { api, ApiError, type BookMapDto } from "../lib/api";
import { t } from "../lib/i18n";
import { plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Help } from "../components/Help";
import { Sheet } from "../components/Sheet";

/**
 * Карта книги (решение владельца 02.11): сетка книги по главам, клетка — стих. Закрыт у всей команды (сдан раньше:
 * испытания и стена), у части, отмечен в этом испытании, свободен всем; выбранный отрывок обведён. Легенда — под «?».
 * Нажатие на стих или движение пальцем по ряду (отрезок) открывает окно: кто уже сдал, кто отметил сейчас, кто ещё не
 * учил — просто по факту, без отметок (решение владельца 04.11: «должно просто отображаться, кто учил этот стих, а кто
 * ещё нет, без всяких галочек»; план заучивания с галочками убран). Сверху — итог: отмечено (воин вдвое) против ставки.
 * Показывается хранителям в ответе, претендентам в вызове и в стене своего города.
 */
export type BookLook = "bricks" | "stones";
const verses = (n: number) => plural(n, ["стих", "стиха", "стихов"]);
const weightOf = (role: string | null) => (role === "WARRIOR" ? 2 : 1);

export function BookMap({ gameId, bookCode, battleId, version = 0, look = "bricks" }: { gameId: string; bookCode: string; battleId?: string; version?: number; look?: BookLook }) {
  const [d, setD] = useState<BookMapDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const dragRef = useRef<{ start: number; end: number; moved: boolean } | null>(null);
  const load = () => api<BookMapDto>(`/api/games/${gameId}/book-map?book=${encodeURIComponent(bookCode)}${battleId ? `&battle=${encodeURIComponent(battleId)}` : ""}`).then((x) => { setD(x); setError(null); }).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети")));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, bookCode, battleId, version]);
  const sets = useMemo(() => (d?.members ?? []).map((m) => ({ ...m, learnedSet: new Set(m.learned), markedSet: new Set(m.marked) })), [d]);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!d) return <p className="muted small mt-2">{t("Загружаем книгу…")}</p>;
  const offsets = d.book.verseCounts.reduce<number[]>((acc, n, i) => { acc.push(i === 0 ? 0 : acc[i - 1]! + d.book.verseCounts[i - 1]!); return acc; }, []);
  const classOf = (i: number) => {
    const marked = sets.some((m) => m.markedSet.has(i)), learnedBy = sets.filter((m) => m.learnedSet.has(i)).length;
    if (marked) return "marked";
    if (sets.length > 0 && learnedBy >= sets.length) return "learned";
    return learnedBy > 0 ? "others" : "free";
  };
  const refOf = (i: number) => { let c = 0; while (c + 1 < offsets.length && offsets[c + 1]! <= i) c++; return `${c + 1}:${i - offsets[c]! + 1}`; };
  const rangeRef = (a: number, b: number) => (a === b ? refOf(a) : `${refOf(a)}–${refOf(b)}`);
  const inPassage = (i: number) => Boolean(d.passage && i >= d.passage.start && i <= d.passage.end);
  // Итог: что уже есть у стороны в этом испытании (воин вдвое).
  const total = d.have ?? 0;
  const diff = d.need != null ? total - d.need : 0;
  // Движение пальцем по ряду выделяет отрезок (решение владельца 02.11); вертикальный жест остаётся прокруткой (touch-action: pan-y).
  const cellAt = (x: number, y: number) => { const el = document.elementFromPoint(x, y) as HTMLElement | null; const v = el?.closest?.(".bm-cell")?.getAttribute("data-idx"); return v == null ? null : Number(v); };
  const onDown = (i: number) => (e: React.PointerEvent) => { dragRef.current = { start: i, end: i, moved: false }; setDrag([i, i]); (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { const dr = dragRef.current; if (!dr) return; const i = cellAt(e.clientX, e.clientY); if (i == null || i === dr.end) return; dr.end = i; dr.moved = true; setDrag([Math.min(dr.start, dr.end), Math.max(dr.start, dr.end)]); };
  const onUp = () => { const dr = dragRef.current; dragRef.current = null; setDrag(null); if (!dr) return; setRange([Math.min(dr.start, dr.end), Math.max(dr.start, dr.end)]); };
  const inDrag = (i: number) => Boolean(drag && i >= drag[0] && i <= drag[1]);
  const picked = range ? (() => {
    const [a, b] = range; const idxs = Array.from({ length: b - a + 1 }, (_, k) => a + k);
    const closed = (m: (typeof sets)[number]) => idxs.some((i) => m.learnedSet.has(i) || m.markedSet.has(i));
    return { a, b, ref: rangeRef(a, b), n: idxs.length, marked: sets.filter((m) => idxs.some((i) => m.markedSet.has(i))), learned: sets.filter((m) => idxs.some((i) => m.learnedSet.has(i))), free: sets.filter((m) => !closed(m)) };
  })() : null;
  return (
    <div className={"book-map look-" + look}>
      <div className="row between nowrap">
        {d.need != null
          ? <p className="bm-total"><b>{total}</b> {t("из")} {d.need}{diff < 0 ? <span className="bad"> · {t("не хватает {n}", { n: -diff })}</span> : diff > 0 ? <span className="ok"> · {t("запас {n}", { n: diff })}</span> : <span className="ok"> · {t("ровно")}</span>}</p>
          : <span className="muted small">{d.book.name}</span>}
        <Help>
          {/* Класс вида — на самой легенде: окошко «?» рисуется порталом вне .book-map, и текстуры кирпичей до неё не доходили (замечание владельца 04.11). */}
          <p className={"bm-legend look-" + look}><i className="sw learned" />{t("закрыто у всех")} <i className="sw others" />{t("закрыто у части")} {battleId && <><i className="sw marked" />{t("в этом испытании")} </>}<i className="sw free" />{t("свободно")} {d.passage && <><i className="sw sel" />{t("отрывок")} </>}</p>
          <p>{t("Стих сдаётся один раз: что человек сдал в испытаниях или стеной, второй раз ему не засчитывается. Нажмите на стих или проведите пальцем по ряду — увидите, кто эти стихи уже сдал, а кто ещё нет.")}</p>
          {d.need != null && <p>{t("Итог сверху: отмечено в этом испытании; стихи воина считаются вдвое.")}</p>}
        </Help>
      </div>
      <div className="bm-grid" aria-label={d.book.name} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {d.book.verseCounts.map((n, c) => (
          <div className="bm-row" key={c}>
            <span className="bm-ch">{c + 1}</span>
            <div className="bm-cells">
              {Array.from({ length: n }, (_, v) => { const i = offsets[c]! + v; return <button key={v} type="button" data-idx={i} className={"bm-cell " + classOf(i) + (i % 2 ? " odd" : "") + (inPassage(i) ? " sel" : "") + (inDrag(i) ? " rng" : "")} aria-label={refOf(i)} title={refOf(i)} onPointerDown={onDown(i)} />; })}
            </div>
          </div>
        ))}
      </div>
      {picked && (
        <WhoSheet
          title={picked.n > 1 ? `${picked.ref} · ${verses(picked.n)}` : picked.ref}
          learned={picked.learned.map((m) => m.name)}
          marked={picked.marked.map((m) => m.name)}
          free={picked.free.map((m) => ({ name: m.name, x2: weightOf(m.role) > 1 }))}
          onClose={() => setRange(null)}
        />
      )}
    </div>
  );
}

/**
 * Лист «кто учил» — один и тот же в испытании и в блоках стены (решение владельца 03.11: «такую же менюшку»; 04.11: «должно
 * просто отображаться, кто учил этот стих, а кто ещё нет, без всяких галочек»): три строки — сдали раньше, отметили
 * в этом испытании, ещё не учили. Ничего не нажимается.
 */
export function WhoSheet({ title, learned, marked, free, onClose }: {
  title: string;
  /** Кто сдал эти стихи раньше (испытания и стена). */
  learned: string[];
  /** Кто отметил их в этом испытании (ещё на проверке или зачтено). */
  marked: string[];
  /** Кто ещё не учил; ×2 — воин. */
  free: Array<{ name: string; x2?: boolean }>;
  onClose: () => void;
}) {
  const row = (icon: string, label: string, names: React.ReactNode[], empty: string) => (
    <li className={names.length ? "" : "muted"}><span className="who-label"><Icon name={icon} />{label}</span><span className="who-names">{names.length ? names : empty}</span></li>
  );
  return (
    <Sheet size="sm" title={title} onClose={onClose} className="bm-sheet">
      <ul className="who-list">
        {row("check", t("Сдали раньше"), learned.map((n) => <span key={n} className="who-name">{n}</span>), t("никто"))}
        {row("send", t("Отметили сейчас"), marked.map((n) => <span key={n} className="who-name">{n}</span>), t("никто"))}
        {row("book", t("Ещё не учили"), free.map((m) => <span key={m.name} className="who-name">{m.name}{m.x2 && <span className="x2">×2</span>}</span>), t("никто"))}
      </ul>
    </Sheet>
  );
}
