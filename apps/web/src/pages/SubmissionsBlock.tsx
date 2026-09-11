import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, PROOF_LABEL, type EdgeTaskDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { ErrorState, LoadingState } from "../components/State";

type Row = EdgeTaskDto & { team: { id: string; name: string; color: string }; takenBy: { nickname: string; displayName: string | null } | null };

/** Одинаковое обновление для всех блоков «Проверки»: при событиях (version), по фокусу окна и раз в 15 секунд. */
export function useAutoRefresh(load: () => Promise<unknown>, version: number): void {
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    const onFocus = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { clearInterval(timer); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [load, version]);
}

/** Карточка блока «Проверки»: «Название · N». Пустой блок схлопывается до одной строки заголовка. */
export function ReviewCard({ icon, title, count, loading, error, onRetry, children, aside }: { icon: string; title: string; count: number; loading: boolean; error: boolean; onRetry: () => void; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="card">
      <div className="card-head review-head">
        <h2><span className="ico"><Icon name={icon} /></span>{title}{!loading && !error && <span className={"count-chip" + (count ? " hot" : "")}>{count}</span>}</h2>
        {aside}
      </div>
      {error ? <ErrorState onRetry={onRetry} /> : loading ? <LoadingState rows={2} /> : children}
    </div>
  );
}

/** Ссылки сдачи подписями «Фото 1», «Видео», а не голыми адресами. */
export function LinkList({ links, kind }: { links: string[]; kind: "photo" | "video" | "link" }) {
  if (links.length === 0) return null;
  const word = kind === "photo" ? t("Фото") : kind === "video" ? t("Видео") : t("Ссылка");
  return <span className="links">{links.map((l, i) => <a key={l + i} href={l} target="_blank" rel="noopener noreferrer"><Icon name={kind === "photo" ? "camera" : kind === "video" ? "video" : "link"} />{links.length > 1 ? `${word} ${i + 1}` : word}</a>)}</span>;
}

/** Отрицательное решение: поле причины появляется только когда возвращают, с фокусом. */
export function ReturnBox({ placeholder, okLabel, onOk, onCancel, busy }: { placeholder: string; okLabel: string; onOk: (text: string) => void; onCancel: () => void; busy: boolean }) {
  const [text, setText] = useState("");
  return (
    <div className="return-box">
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={500} aria-label={placeholder} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onOk(text); } }} />
      <div className="row">
        <button type="button" className="secondary sm" onClick={() => onOk(text)} disabled={busy}><Icon name="x" />{okLabel}</button>
        <button type="button" className="ghost sm" onClick={onCancel}>{t("Отмена")}</button>
      </div>
    </div>
  );
}

/** Очередь сдач дел. */
export function SubmissionsBlock({ gameId, version = 0, currency, onDecided }: { gameId: string; version?: number; currency?: string; onDecided: () => void }) {
  const { notify } = useUi();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [returning, setReturning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ tasks: Row[] }>(`/api/games/${gameId}/submissions`).then((r) => { setRows(r.tasks); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useAutoRefresh(load, version);

  async function decide(id: string, approve: boolean, comment = "") {
    setBusy(true);
    try { await api(`/api/games/${gameId}/edge-tasks/${id}/decide`, { method: "POST", body: JSON.stringify({ approve, comment }) }); notify(approve ? t("Сдача принята") : t("Сдача возвращена")); setReturning(null); await load(); onDecided(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  const linkKind = (p: EdgeTaskDto["deed"]["proofType"]) => (p === "PHOTO_LINK" ? "photo" : p === "VIDEO_LINK" ? "video" : "link");

  return (
    <ReviewCard icon="scroll" title={t("Сдачи")} count={rows?.length ?? 0} loading={!rows} error={loadError} onRetry={() => void load()}>
      {rows && rows.length > 0 && (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} className="review-item">
              <div className="main">
                <span className="row nowrap"><TeamAvatar name={r.team.name} color={r.team.color} size="sm" withName />{r.donation && <Chip tone="accent">{t("пожертвование {n}", { n: `${r.donationAmount ?? ""} ${currency ?? ""}`.trim() })}</Chip>}</span>
                <span className="title">{r.deed.title}</span>
                {r.deed.description && <span className="small muted">{r.deed.description}</span>}
                <span className="meta"><span>{PROOF_LABEL[r.deed.proofType]}</span>{r.takenBy && <span>· {r.takenBy.displayName ?? r.takenBy.nickname}</span>}{r.submittedAt && <span>· {fmtDate(r.submittedAt)}</span>}</span>
                {r.note && <span className="report"><span className="muted">{t("Отчёт команды")}: </span>{r.note}</span>}
                <LinkList links={r.links} kind={linkKind(r.deed.proofType)} />
              </div>
              <div className="side">
                <button type="button" className="sm" onClick={() => void decide(r.id, true)} disabled={busy}><Icon name="check" />{t("Принять")}</button>
                {returning !== r.id && <button type="button" className="secondary sm" onClick={() => setReturning(r.id)} disabled={busy}><Icon name="x" />{t("Вернуть")}</button>}
              </div>
              {returning === r.id && <ReturnBox placeholder={t("Причина возврата: команда её увидит")} okLabel={t("Вернуть")} busy={busy} onOk={(text) => void decide(r.id, false, text)} onCancel={() => setReturning(null)} />}
            </li>
          ))}
        </ul>
      )}
    </ReviewCard>
  );
}
