import { useCallback, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, type BattleDto, type BattleStatus } from "../lib/api";
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
                  </div>
                  {(b.status === "DEFENSE" || b.defenseSum > 0 || b.defensePassage) && (
                    <div>
                      <strong>{t("Ответ")}</strong>{b.defensePassage ? ` · ${b.defensePassage.ref}` : ""}<br />
                      {t("выучено {a} · принято {b} · нужно {c}", { a: b.defenseSum, b: b.defenseApproved, c: b.attackApproved })}
                      {b.defenseDoneAt ? ` · ${t("сдано на проверку")}` : b.defenseDeadline && b.status === "DEFENSE" ? ` · ${t("до {d}", { d: fmtDate(b.defenseDeadline) })}` : ""}
                      {b.defenseBid != null && b.status === "REPELLED" ? ` · ${t("устояли на {n}", { n: verses(b.defenseBid) })}` : ""}
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
