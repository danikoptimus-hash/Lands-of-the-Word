import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type BookMapDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Help } from "../components/Help";
import { Sheet } from "../components/Sheet";

/**
 * Карта книги (решение владельца 02.11): сетка книги по главам, клетка — стих. Закрыт у всей команды (сдан раньше:
 * испытания и стена), у части, отмечен в этом испытании, свободен всем; выбранный отрывок обведён; точка — стих кому-то
 * поручен. Легенда — под «?». Нажатие на стих или движение пальцем по ряду (отрезок) открывает окно: кто уже сдал, кто
 * отметил сейчас, и список тех, кому стихи ещё можно поручить; капитан отмечает, кто будет учить (план заучивания).
 * Сверху — итог: отмечено плюс поручено (воин вдвое) против ставки: сколько не хватает или сколько лишних.
 * Показывается хранителям в ответе, претендентам в вызове и в стене своего города.
 */
export type BookLook = "bricks" | "stones";
const verses = (n: number) => plural(n, ["стих", "стиха", "стихов"]);
const weightOf = (role: string | null) => (role === "WARRIOR" ? 2 : 1);

export function BookMap({ gameId, bookCode, battleId, version = 0, look = "bricks" }: { gameId: string; bookCode: string; battleId?: string; version?: number; look?: BookLook }) {
  const { notify } = useUi();
  const [d, setD] = useState<BookMapDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const dragRef = useRef<{ start: number; end: number; moved: boolean } | null>(null);
  const load = () => api<BookMapDto>(`/api/games/${gameId}/book-map?book=${encodeURIComponent(bookCode)}${battleId ? `&battle=${encodeURIComponent(battleId)}` : ""}`).then((x) => { setD(x); setError(null); }).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети")));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, bookCode, battleId, version]);
  const sets = useMemo(() => (d?.members ?? []).map((m) => ({ ...m, learnedSet: new Set(m.learned), markedSet: new Set(m.marked) })), [d]);
  const planBy = useMemo(() => { const m = new Map<number, Set<string>>(); for (const p of d?.plan ?? []) { if (!m.has(p.idx)) m.set(p.idx, new Set()); m.get(p.idx)!.add(p.userId); } return m; }, [d]);
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
  // Итог для капитана: уже есть в испытании + поручено по плану тем, кто этот стих ещё не отметил (воин вдвое).
  const plannedExtra = (d.plan ?? []).reduce((acc, p) => { const m = sets.find((x) => x.userId === p.userId); return m && !m.markedSet.has(p.idx) ? acc + weightOf(m.role) : acc; }, 0);
  const total = (d.have ?? 0) + plannedExtra;
  const diff = d.need != null ? total - d.need : 0;
  // Движение пальцем по ряду выделяет отрезок (решение владельца 02.11); вертикальный жест остаётся прокруткой (touch-action: pan-y).
  const cellAt = (x: number, y: number) => { const el = document.elementFromPoint(x, y) as HTMLElement | null; const v = el?.closest?.(".bm-cell")?.getAttribute("data-idx"); return v == null ? null : Number(v); };
  const onDown = (i: number) => (e: React.PointerEvent) => { dragRef.current = { start: i, end: i, moved: false }; setDrag([i, i]); (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { const dr = dragRef.current; if (!dr) return; const i = cellAt(e.clientX, e.clientY); if (i == null || i === dr.end) return; dr.end = i; dr.moved = true; setDrag([Math.min(dr.start, dr.end), Math.max(dr.start, dr.end)]); };
  const onUp = () => { const dr = dragRef.current; dragRef.current = null; setDrag(null); if (!dr) return; setRange([Math.min(dr.start, dr.end), Math.max(dr.start, dr.end)]); };
  const inDrag = (i: number) => Boolean(drag && i >= drag[0] && i <= drag[1]);
  const toggle = async (a: number, b: number, userId: string, on: boolean) => {
    const idxs = Array.from({ length: b - a + 1 }, (_, k) => a + k);
    setD((x) => x ? { ...x, plan: on ? [...x.plan, ...idxs.filter((i) => !x.plan.some((p) => p.idx === i && p.userId === userId)).map((idx) => ({ idx, userId }))] : x.plan.filter((p) => !(p.userId === userId && p.idx >= a && p.idx <= b)) } : x);
    try { await api(`/api/games/${gameId}/book-plan`, { method: "POST", body: JSON.stringify(a === b ? { book: bookCode, idx: a, userId, on } : { book: bookCode, from: a, to: b, userId, on }) }); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); void load(); }
  };
  const picked = range ? (() => {
    const [a, b] = range; const idxs = Array.from({ length: b - a + 1 }, (_, k) => a + k);
    const closed = (m: (typeof sets)[number]) => idxs.some((i) => m.learnedSet.has(i) || m.markedSet.has(i));
    return { a, b, ref: rangeRef(a, b), n: idxs.length, marked: sets.filter((m) => idxs.some((i) => m.markedSet.has(i))), learned: sets.filter((m) => idxs.some((i) => m.learnedSet.has(i))), free: sets.filter((m) => !closed(m)), planned: new Set(sets.filter((m) => idxs.every((i) => planBy.get(i)?.has(m.userId))).map((m) => m.userId)) };
  })() : null;
  return (
    <div className={"book-map look-" + look}>
      <div className="row between nowrap">
        {d.need != null
          ? <p className="bm-total"><b>{total}</b> {t("из")} {d.need}{diff < 0 ? <span className="bad"> · {t("не хватает {n}", { n: -diff })}</span> : diff > 0 ? <span className="ok"> · {t("запас {n}", { n: diff })}</span> : <span className="ok"> · {t("ровно")}</span>}</p>
          : <span className="muted small">{d.book.name}</span>}
        <Help>
          <p className="bm-legend"><i className="sw learned" />{t("закрыто у всех")} <i className="sw others" />{t("закрыто у части")} {battleId && <><i className="sw marked" />{t("в этом испытании")} </>}<i className="sw free" />{t("свободно")} {d.passage && <><i className="sw sel" />{t("отрывок")} </>}<i className="sw dot" />{t("кто-то учит")}</p>
          <p>{t("Стих сдаётся один раз: что человек сдал в испытаниях или стеной, второй раз ему не засчитывается. Нажмите на стих или проведите пальцем по ряду — увидите, кому эти стихи ещё можно поручить.")}</p>
          {d.need != null && <p>{t("Итог сверху: отмечено в этом испытании плюс поручено по плану; стихи воина считаются вдвое.")}</p>}
        </Help>
      </div>
      <div className="bm-grid" aria-label={d.book.name} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {d.book.verseCounts.map((n, c) => (
          <div className="bm-row" key={c}>
            <span className="bm-ch">{c + 1}</span>
            <div className="bm-cells">
              {Array.from({ length: n }, (_, v) => { const i = offsets[c]! + v; return <button key={v} type="button" data-idx={i} className={"bm-cell " + classOf(i) + (i % 2 ? " odd" : "") + (inPassage(i) ? " sel" : "") + (planBy.has(i) ? " plan" : "") + (inDrag(i) ? " rng" : "")} aria-label={refOf(i)} title={refOf(i)} onPointerDown={onDown(i)} />; })}
            </div>
          </div>
        ))}
      </div>
      {picked && (
        <Sheet size="sm" title={picked.n > 1 ? `${picked.ref} · ${verses(picked.n)}` : picked.ref} onClose={() => setRange(null)} className="bm-sheet">
          {(picked.marked.length > 0 || picked.learned.length > 0) && (
            <p className="muted small bm-taken">
              {picked.marked.length > 0 && <span><Icon name="send" />{picked.marked.map((m) => m.name).join(", ")}</span>}
              {picked.learned.length > 0 && <span><Icon name="check" />{picked.learned.map((m) => m.name).join(", ")}</span>}
            </p>
          )}
          {picked.free.length === 0
            ? <p className="hint">{picked.n > 1 ? t("Эти стихи уже некому поручить целиком: у каждого в команде часть из них сдана.") : t("Этот стих уже некому поручить: все в команде его сдавали.")}</p>
            : (
              <div className="bm-people" role="group" aria-label={t("Кто будет учить")}>
                {picked.free.map((m) => {
                  const on = picked.planned.has(m.userId);
                  return <button key={m.userId} type="button" className={"bm-person" + (on ? " on" : "")} aria-pressed={on} disabled={!d.canPlan} onClick={() => void toggle(picked.a, picked.b, m.userId, !on)}>{on && <Icon name="check" />}{m.name}{weightOf(m.role) > 1 && <span className="x2">×2</span>}</button>;
                })}
              </div>
            )}
        </Sheet>
      )}
    </div>
  );
}
