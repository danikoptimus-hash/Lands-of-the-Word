import { useCallback, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { TeamAvatar } from "../components/TeamAvatar";
import { ReturnBox, ReviewCard, useAutoRefresh } from "./SubmissionsBlock";

interface Dispute { id: string; team: { id: string; name: string; color: string }; nodeKey: string; bookCode: string; taskIndex: number; prompt: string; correct: string | null; message: string | null; disputedAt: string | null; lockedUntil: string | null }
const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

/** Споры команд по закрытым заданиям: открыть задание или оставить закрытым, с ответом команде. */
export function DisputesBlock({ gameId, version = 0, onDecided }: { gameId: string; version?: number; onDecided: () => void }) {
  const { notify } = useUi();
  const [rows, setRows] = useState<Dispute[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [declining, setDeclining] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ disputes: Dispute[] }>(`/api/games/${gameId}/disputes`).then((r) => { setRows(r.disputes); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useAutoRefresh(load, version);

  async function resolve(id: string, unlock: boolean, answer = "") {
    setBusy(true);
    try { await api(`/api/games/${gameId}/disputes/${id}/resolve`, { method: "POST", body: JSON.stringify({ unlock, answer }) }); notify(unlock ? t("Задание открыто") : t("Задание оставлено закрытым")); setDeclining(null); await load(); onDecided(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }

  return (
    <ReviewCard icon="alert" title={t("Споры")} count={rows?.length ?? 0} loading={!rows} error={loadError} onRetry={() => void load()}>
      {rows && rows.length > 0 && (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} className="review-item">
              <div className="main">
                <span className="row nowrap"><TeamAvatar name={r.team.name} color={r.team.color} size="sm" withName />{r.disputedAt && <span className="muted small">{fmtDate(r.disputedAt)}</span>}</span>
                <span className="title">{t("Город {name}", { name: BOOK_BY_CODE.get(r.bookCode)?.nameRu ?? r.bookCode })} <span className="muted">· {t("задание {n}", { n: r.taskIndex + 1 })}</span></span>
                <span className="small muted">{r.prompt}</span>
                {r.message && <span className="report"><span className="muted">{t("Команда")}: </span>«{r.message}»</span>}
                {r.correct && <span className="small"><span className="muted">{t("Верный вариант")}: </span><strong>{r.correct}</strong></span>}
              </div>
              <div className="side">
                <button type="button" className="sm" onClick={() => void resolve(r.id, true)} disabled={busy}><Icon name="check" />{t("Открыть задание")}</button>
                {declining !== r.id && <button type="button" className="secondary sm" onClick={() => setDeclining(r.id)} disabled={busy}><Icon name="x" />{t("Оставить закрытым")}</button>}
              </div>
              {declining === r.id && <ReturnBox placeholder={t("Ответ команде: почему задание остаётся закрытым")} okLabel={t("Оставить закрытым")} busy={busy} onOk={(text) => void resolve(r.id, false, text)} onCancel={() => setDeclining(null)} />}
            </li>
          ))}
        </ul>
      )}
    </ReviewCard>
  );
}
