import { useCallback, useState } from "react";
import { api, ApiError, apiReady, ready, type AdminWallBlockDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { Tabs } from "../components/Tabs";
import { LinkList, ReturnBox, ReviewCard, useAutoRefresh } from "./SubmissionsBlock";

const verses = (n: number) => plural(n, ["стих", "стиха", "стихов"]);

/** Проверка блоков городской стены (решение владельца 01.11): кто, какой город, отрывок, видео; «Принять» / «Вернуть». */
export function WallsBlock({ gameId, version = 0, onDecided }: { gameId: string; version?: number; onDecided: () => void }) {
  const { notify } = useUi();
  const [rows, setRows] = useState<AdminWallBlockDto[] | null>(() => ready<{ blocks: AdminWallBlockDto[] }>(`/api/games/${gameId}/walls`)?.blocks ?? null);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<"pending" | "done">("pending");
  const [returning, setReturning] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(() => apiReady<{ blocks: AdminWallBlockDto[] }>(`/api/games/${gameId}/walls`).then((r) => { setRows(r.blocks); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useAutoRefresh(load, version);
  async function decide(id: string, approve: boolean, comment = "") {
    setBusyId(id);
    try { await api(`/api/games/${gameId}/walls/${id}/decide`, { method: "POST", body: JSON.stringify({ approve, comment }) }); notify(approve ? t("Блок принят: стена выросла") : t("Блок возвращён")); setReturning(null); await load(); onDecided(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusyId(null); }
  }
  if (rows && rows.length === 0) return null;
  const all = rows ?? [];
  const pending = all.filter((r) => r.status === "SUBMITTED");
  // Вторая вкладка — только проверенные, без ждущих (решение владельца 03.11).
  const done = all.filter((r) => r.status !== "SUBMITTED");
  const shown = filter === "done" ? done : pending;
  return (
    <ReviewCard icon="wall" title={t("Стены")} count={pending.length} loading={!rows} error={loadError} onRetry={() => void load()}>
      {all.length > pending.length && <Tabs value={filter} onChange={setFilter} ariaLabel={t("Какие блоки показывать")} items={[{ key: "pending", label: t("На проверке"), count: pending.length }, { key: "done", label: t("Проверенные"), count: done.length }]} />}
      {shown.length > 0 && (
        <ul className="list">
          {shown.map((r) => (
            <li key={r.id} className="review-item">
              <div className="main">
                <span className="row nowrap"><TeamAvatar name={r.team.name} color={r.team.color} avatarId={r.team.avatarId} size="sm" withName teamId={r.team.id} /><span className="muted small">· <Icon name="city" /> {r.bookName}</span></span>
                <span className="title">{r.repair && <Chip tone="warn" icon="alert">{t("починка")}</Chip>}{r.ref} <span className="muted small">· {verses(r.verses)}</span>{r.weight > 1 && <Chip tone="accent" icon="sword">{t("воин ×{k}", { k: r.weight })}</Chip>}</span>
                <span className="meta"><span>{r.nickname}</span><span>· {fmtDate(r.createdAt)}</span></span>
                {r.note && <span className="report">{r.note}</span>}
                {r.adminComment && <span className="meta">{t("Комментарий: {c}", { c: r.adminComment })}</span>}
                <LinkList links={r.links} kind="video" />
              </div>
              <div className="side">
                {r.status === "SUBMITTED" ? (
                  <>
                    <button type="button" className="sm" onClick={() => void decide(r.id, true)} disabled={busyId === r.id}><Icon name="check" />{t("Принять")}</button>
                    {returning !== r.id && <button type="button" className="secondary sm" onClick={() => setReturning(r.id)} disabled={busyId === r.id}><Icon name="x" />{t("Вернуть")}</button>}
                  </>
                ) : r.usedAt ? <Chip tone="bad" icon="wave">{t("сгорел")}</Chip> : <Chip tone={r.status === "APPROVED" ? "ok" : "bad"}>{r.status === "APPROVED" ? t("принято") : t("возвращено")}</Chip>}
              </div>
              {returning === r.id && <ReturnBox placeholder={t("Причина возврата: участник её увидит")} okLabel={t("Вернуть")} busy={busyId === r.id} onOk={(text) => void decide(r.id, false, text)} onCancel={() => setReturning(null)} />}
            </li>
          ))}
        </ul>
      )}
    </ReviewCard>
  );
}
