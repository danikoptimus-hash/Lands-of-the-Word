import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type BookMapDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { Help } from "../components/Help";
import { Sheet } from "../components/Sheet";

/**
 * Карта книги (решение владельца 02.11): сетка книги по главам, клетка — стих. Зелёная — закрыта у всей команды (сдана
 * раньше: испытания и стена), штриховая — у части, синяя — отмечена в этом испытании, белая — свободна всем; выбранный
 * отрывок обведён; точка — стих кому-то назначен. Легенда — под «?». Нажатие на стих открывает окно: кто его уже сдал,
 * кто отметил сейчас, и список тех, кому его ещё можно поручить; капитан отмечает, кто будет учить (план заучивания).
 * Показывается хранителям в ответе, претендентам в вызове и в стене своего города.
 */
export function BookMap({ gameId, bookCode, battleId, version = 0 }: { gameId: string; bookCode: string; battleId?: string; version?: number }) {
  const { notify } = useUi();
  const [d, setD] = useState<BookMapDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<number | null>(null);
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
  const inPassage = (i: number) => Boolean(d.passage && i >= d.passage.start && i <= d.passage.end);
  const toggle = async (idx: number, userId: string, on: boolean) => {
    // Отметка сразу на карте, сервер — следом; при отказе возвращаем как было.
    setD((x) => x ? { ...x, plan: on ? [...x.plan, { idx, userId }] : x.plan.filter((p) => !(p.idx === idx && p.userId === userId)) } : x);
    try { await api(`/api/games/${gameId}/book-plan`, { method: "POST", body: JSON.stringify({ book: bookCode, idx, userId, on }) }); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); void load(); }
  };
  const picked = pick !== null ? { idx: pick, ref: refOf(pick), learned: sets.filter((m) => m.learnedSet.has(pick)), marked: sets.filter((m) => m.markedSet.has(pick)), free: sets.filter((m) => !m.learnedSet.has(pick) && !m.markedSet.has(pick)), planned: planBy.get(pick) ?? new Set<string>() } : null;
  return (
    <div className="book-map">
      <div className="row between nowrap">
        <span className="muted small">{d.book.name}</span>
        <Help>
          <p className="bm-legend"><i className="sw learned" />{t("закрыто у всех")} <i className="sw others" />{t("закрыто у части")} {battleId && <><i className="sw marked" />{t("в этом испытании")} </>}<i className="sw free" />{t("свободно")} {d.passage && <><i className="sw sel" />{t("отрывок")} </>}<i className="sw dot" />{t("кто-то учит")}</p>
          <p>{t("Стих сдаётся один раз: что человек сдал в испытаниях или стеной, второй раз ему не засчитывается. Нажмите на стих — увидите, кому его ещё можно поручить.")}</p>
        </Help>
      </div>
      <div className="bm-grid" aria-label={d.book.name}>
        {d.book.verseCounts.map((n, c) => (
          <div className="bm-row" key={c}>
            <span className="bm-ch">{c + 1}</span>
            <div className="bm-cells">
              {Array.from({ length: n }, (_, v) => { const i = offsets[c]! + v; return <button key={v} type="button" className={"bm-cell " + classOf(i) + (inPassage(i) ? " sel" : "") + (planBy.has(i) ? " plan" : "")} aria-label={refOf(i)} title={refOf(i)} onClick={() => setPick(i)} />; })}
            </div>
          </div>
        ))}
      </div>
      {picked && (
        <Sheet size="sm" title={picked.ref} onClose={() => setPick(null)} className="bm-sheet">
          {(picked.marked.length > 0 || picked.learned.length > 0) && (
            <p className="muted small bm-taken">
              {picked.marked.length > 0 && <span><Icon name="send" />{picked.marked.map((m) => m.name).join(", ")}</span>}
              {picked.learned.length > 0 && <span><Icon name="check" />{picked.learned.map((m) => m.name).join(", ")}</span>}
            </p>
          )}
          {picked.free.length === 0
            ? <p className="hint">{t("Этот стих уже некому поручить: все в команде его сдавали.")}</p>
            : (
              <div className="bm-people" role="group" aria-label={t("Кто будет учить")}>
                {picked.free.map((m) => {
                  const on = picked.planned.has(m.userId);
                  return <button key={m.userId} type="button" className={"bm-person" + (on ? " on" : "")} aria-pressed={on} disabled={!d.canPlan} onClick={() => void toggle(picked.idx, m.userId, !on)}>{on && <Icon name="check" />}{m.name}</button>;
                })}
              </div>
            )}
        </Sheet>
      )}
    </div>
  );
}
