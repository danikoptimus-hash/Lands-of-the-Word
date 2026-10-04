import { useCallback, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, type BattleDto, type BattleStatus, type PassageDto, type BattleEntryDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { Tabs } from "../components/Tabs";
import { EmptyState } from "../components/State";
import { LinkList, ReturnBox, ReviewCard, useAutoRefresh } from "./SubmissionsBlock";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
/** Статусы испытания словами среднего рода (в api.ts «отменена» — женский род от «битвы»). */
const STATUS: Record<BattleStatus, { text: string; tone: "neutral" | "info" | "ok" | "bad" | "warn" }> = {
  get QUEUED() { return { text: t("в очереди"), tone: "neutral" as const }; },
  get ATTACK() { return { text: t("идёт вызов"), tone: "info" as const }; },
  get DEFENSE() { return { text: t("идёт ответ"), tone: "info" as const }; },
  get WON() { return { text: t("город перешёл"), tone: "warn" as const }; },
  get REPELLED() { return { text: t("город устоял"), tone: "ok" as const }; },
  get EXPIRED() { return { text: t("вызов не завершён"), tone: "neutral" as const }; },
  get CANCELLED() { return { text: t("отменено"), tone: "neutral" as const }; },
};
const verses = (n: number) => plural(n, ["стих", "стиха", "стихов"]);

/** Испытания за города и проверка записей обеих сторон. Счётчик — записи на проверке. */
export function BattlesBlock({ gameId, version = 0, onDecided }: { gameId: string; version?: number; onDecided: () => void }) {
  const { notify } = useUi();
  const [rows, setRows] = useState<BattleDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [returning, setReturning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ battles: BattleDto[] }>(`/api/games/${gameId}/battles`).then((r) => { setRows(r.battles); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useAutoRefresh(load, version);

  async function decide(battleId: string, entryId: string, approve: boolean, comment = "") {
    setBusy(true);
    try { await api(`/api/games/${gameId}/battles/${battleId}/entries/${entryId}/decide`, { method: "POST", body: JSON.stringify({ approve, comment }) }); notify(approve ? t("Запись принята") : t("Запись возвращена")); setReturning(null); await load(); onDecided(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  const all = rows ?? [];
  const active = all.filter((b) => b.status === "ATTACK" || b.status === "DEFENSE" || b.status === "QUEUED");
  const pending = all.reduce((n, b) => n + b.entries.filter((e) => e.status === "SUBMITTED").length, 0);
  const shown = filter === "all" ? all : active;

  return (
    <ReviewCard icon="wave" title={t("Испытания")} count={pending} loading={!rows} error={loadError} onRetry={() => void load()}>
      {all.length > 0 && (
        <>
          {all.length > active.length && <Tabs value={filter} onChange={setFilter} ariaLabel={t("Какие испытания показывать")} items={[{ key: "active", label: t("Идут"), count: active.length }, { key: "all", label: t("Все"), count: all.length }]} />}
          {shown.length === 0 ? <EmptyState inline icon="wave" text={t("Сейчас испытаний нет.")} /> : shown.map((b) => {
            const st = STATUS[b.status];
            return (
              <div key={b.id} className="trial">
                <div className="row between">
                  <div className="sides">
                    <span className="who"><TeamAvatar name={b.attacker.name} color={b.attacker.color} size="sm" withName /><Chip tone="warn">{t("вызов")}</Chip></span>
                    <span className="who"><TeamAvatar name={b.defender.name} color={b.defender.color} size="sm" withName /><Chip tone="info">{t("ответ")}</Chip></span>
                  </div>
                  <Chip tone={st.tone}>{st.text}</Chip>
                </div>
                <div className="mt-2"><strong>{t("Город {name}", { name: BOOK_BY_CODE.get(b.bookCode)?.nameRu ?? "" })}</strong> <span className="muted small">· {t("ставка")} {verses(b.bid)}</span></div>
                <div className="cols">
                  <div>
                    <strong>{t("Вызов")}</strong>{b.passage ? ` · ${b.passage.ref}` : ""}<br />
                    {t("выучено {a} · принято {b}", { a: b.attackSum, b: b.attackApproved })}
                    {b.attackDoneAt ? ` · ${t("сдано на проверку")}` : b.attackDeadline && b.status === "ATTACK" ? ` · ${t("до {d}", { d: fmtDate(b.attackDeadline) })}` : ""}
                    {/* Администратор видит выданный отрывок целиком и кому какие стихи достались (решение владельца 04.10). */}
                    <PassageDetails passage={b.passage} entries={b.entries.filter((e) => e.side === "ATTACK")} />
                  </div>
                  {(b.status === "DEFENSE" || b.defenseSum > 0 || b.defensePassage) && (
                    <div>
                      <strong>{t("Ответ")}</strong>{b.defensePassage ? ` · ${b.defensePassage.ref}` : ""}<br />
                      {t("выучено {a} · принято {b} · нужно {c}", { a: b.defenseSum, b: b.defenseApproved, c: b.bid })}
                      {b.defenseDoneAt ? ` · ${t("сдано на проверку")}` : b.defenseDeadline && b.status === "DEFENSE" ? ` · ${t("до {d}", { d: fmtDate(b.defenseDeadline) })}` : ""}
                      {b.defenseBid != null && b.status === "REPELLED" ? ` · ${t("устояли на {n}", { n: verses(b.defenseBid) })}` : ""}
                      <PassageDetails passage={b.defensePassage} entries={b.entries.filter((e) => e.side === "DEFENSE")} />
                    </div>
                  )}
                </div>
                {b.entries.length > 0 && (
                  <ul className="list">
                    {b.entries.map((e) => (
                      <li key={e.id} className="review-item">
                        <div className="main">
                          <span className="title"><Chip tone={e.side === "ATTACK" ? "warn" : "info"}>{e.side === "ATTACK" ? t("вызов") : t("ответ")}</Chip> {e.ref}</span>
                          <span className="meta"><span>{verses(e.verses)}</span><span>· {e.nickname}</span><span>· {fmtDate(e.createdAt)}</span></span>
                          {e.note && <span className="report">{e.note}</span>}
                          <LinkList links={e.links} kind="video" />
                        </div>
                        <div className="side">
                          {e.status === "SUBMITTED" ? (
                            <>
                              <button type="button" className="sm" onClick={() => void decide(b.id, e.id, true)} disabled={busy}><Icon name="check" />{t("Принять")}</button>
                              {returning !== e.id && <button type="button" className="secondary sm" onClick={() => setReturning(e.id)} disabled={busy}><Icon name="x" />{t("Вернуть")}</button>}
                            </>
                          ) : <Chip tone={e.status === "APPROVED" ? "ok" : "bad"}>{e.status === "APPROVED" ? t("принято") : t("возвращено")}</Chip>}
                        </div>
                        {returning === e.id && <ReturnBox placeholder={t("Причина возврата: команда её увидит")} okLabel={t("Вернуть")} busy={busy} onOk={(text) => void decide(b.id, e.id, false, text)} onCancel={() => setReturning(null)} />}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </>
      )}
    </ReviewCard>
  );
}

/** Непрерывные отрезки стихов → подписи «8:25–8:30» по ссылкам стихов отрывка. */
function rangesOf(idxs: number[], refOf: (i: number) => string): string[] {
  const sorted = [...new Set(idxs)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    out.push(i === j ? refOf(sorted[i]!) : `${refOf(sorted[i]!)}–${refOf(sorted[j]!)}`);
    i = j;
  }
  return out;
}

/**
 * Подробности отрывка для администратора (решение владельца 04.10): текст выданного отрывка целиком и раскладка —
 * кому какие стихи достались, сколько у каждого принято, какие стихи ещё никто не отметил.
 */
function PassageDetails({ passage, entries }: { passage: PassageDto | null; entries: BattleEntryDto[] }) {
  if (!passage) return null;
  const refOf = (i: number) => passage.verses?.find((v) => v.idx === i)?.ref ?? String(i);
  const byUser = new Map<string, { verses: Set<number>; approved: Set<number>; weight: number }>();
  const covered = new Set<number>();
  for (const e of entries) {
    const u = byUser.get(e.nickname) ?? { verses: new Set<number>(), approved: new Set<number>(), weight: e.weight ?? 1 };
    for (let i = e.start; i <= e.end; i++) { u.verses.add(i); covered.add(i); if (e.status === "APPROVED") u.approved.add(i); }
    byUser.set(e.nickname, u);
  }
  const free: number[] = [];
  for (let i = passage.start; i <= passage.end; i++) if (!covered.has(i)) free.push(i);
  const total = passage.end - passage.start + 1;
  return (
    <details className="fold passage-fold">
      <summary><Icon name="book" />{t("Отрывок и раскладка")} <span className="count">· {total}</span><Icon name="chevron-down" className="chev" /></summary>
      <ul className="list compact">
        {[...byUser.entries()].map(([nick, u]) => (
          <li key={nick}><div className="main"><span className="title">{nick}{u.weight > 1 && <Chip tone="info" icon="sword">×{u.weight}</Chip>}</span><span className="meta"><span>{rangesOf([...u.verses], refOf).join(", ")}</span><span>· {verses(u.verses.size)}</span><span>· {t("принято {n}", { n: u.approved.size })}</span></span></div></li>
        ))}
        {byUser.size === 0 && <li><div className="main"><span className="muted small">{t("Стихи ещё никто не отметил.")}</span></div></li>}
        {free.length > 0 && byUser.size > 0 && <li><div className="main"><span className="title muted">{t("Никем не отмечены")}</span><span className="meta"><span>{rangesOf(free, refOf).join(", ")}</span><span>· {verses(free.length)}</span></span></div></li>}
      </ul>
      {passage.verses ? (
        <ol className="passage-text">
          {passage.verses.map((v) => <li key={v.idx} className={covered.has(v.idx) ? "covered" : undefined}><b>{v.ref}</b> {v.text ?? ""}</li>)}
        </ol>
      ) : <p className="hint">{t("Текст отрывка недоступен.")}</p>}
    </details>
  );
}
