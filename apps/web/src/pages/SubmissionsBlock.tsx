import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, PROOF_LABEL, type EdgeTaskDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { ErrorState, LoadingState } from "../components/State";

type Row = EdgeTaskDto & { team: { id: string; name: string; color: string }; takenBy: { nickname: string; displayName: string | null } | null; /** Имена участников дела группой, без взявшего. */ participantNames?: string[] };

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
  /** Какая сдача сейчас решается (id) или «batch»: гаснут кнопки только у неё, а не у всех сдач (замечание владельца 04.10). */
  const [busyId, setBusyId] = useState<string | null>(null);
  const busy = busyId !== null;
  /** Пакетная проверка (решение владельца 18.09, A-03): фильтры по команде, виду сдачи и возрасту; старые сверху; выбор нескольких однотипных. */
  const [teamFilter, setTeamFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [oldFirst, setOldFirst] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Описание дела администратор знает: показываем по кнопке «Описание», отчёт и ссылки — всегда на виду. */
  const [descOpen, setDescOpen] = useState<Set<string>>(new Set());
  const toggleDesc = (id: string) => setDescOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  /** Возвращённые дела (решение владельца 05.10): возвращённое по ошибке можно найти здесь и принять после пересмотра. */
  const [returned, setReturned] = useState(false);
  const load = useCallback(() => api<{ tasks: Row[] }>(`/api/games/${gameId}/submissions${returned ? "?status=REJECTED" : ""}`).then((r) => { setRows(r.tasks); setLoadError(false); }).catch(() => setLoadError(true)), [gameId, returned]);
  useAutoRefresh(load, version);

  async function decide(id: string, approve: boolean, comment = "") {
    setBusyId(id);
    try { await api(`/api/games/${gameId}/edge-tasks/${id}/decide`, { method: "POST", body: JSON.stringify({ approve, comment }) }); notify(approve ? (returned ? t("Сдача принята после пересмотра") : t("Сдача принята")) : t("Сдача возвращена")); setReturning(null); await load(); onDecided(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusyId(null); }
  }
  const linkKind = (p: EdgeTaskDto["deed"]["proofType"]) => (p === "PHOTO_LINK" ? "photo" : p === "VIDEO_LINK" ? "video" : "link");
  async function decideBatch() {
    if (picked.size === 0) return;
    setBusyId("batch");
    try {
      const r = await api<{ done: number; skipped: number }>(`/api/games/${gameId}/edge-tasks/decide-batch`, { method: "POST", body: JSON.stringify({ ids: [...picked], approve: true }) });
      notify(t("Принято сдач: {n}", { n: r.done }) + (r.skipped ? ` · ${t("уже рассмотрено: {n}", { n: r.skipped })}` : ""));
      setPicked(new Set()); await load(); onDecided();
    } catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusyId(null); }
  }
  const teams = rows ? [...new Map(rows.map((r) => [r.team.id, r.team])).values()] : [];
  const shown = (rows ?? []).filter((r) => (!teamFilter || r.team.id === teamFilter) && (!kindFilter || r.deed.proofType === kindFilter)).sort((a, b) => { const d = Date.parse(a.submittedAt ?? "") - Date.parse(b.submittedAt ?? ""); return oldFirst ? d : -d; });
  const togglePick = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ageOf = (iso: string | null) => { if (!iso) return ""; const h = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000); return h < 1 ? t("только что") : h < 24 ? t("{n} ч назад", { n: h }) : t("{n} дн назад", { n: Math.floor(h / 24) }); };

  return (
    <ReviewCard icon="scroll" title={returned ? t("Возвращённые") : t("Сдачи")} count={rows?.length ?? 0} loading={!rows} error={loadError} onRetry={() => void load()}
      aside={<button type="button" className="ghost sm" aria-pressed={returned} onClick={() => { setRows(null); setPicked(new Set()); setReturned((v) => !v); }}><Icon name={returned ? "clock" : "alert"} />{returned ? t("К сдачам") : t("Возвращённые")}</button>}>
      {rows && rows.length > 1 && !returned && (
        <div className="review-filters">
          <select aria-label={t("Команда")} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}><option value="">{t("Все команды")}</option>{teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}</select>
          <select aria-label={t("Вид сдачи")} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}><option value="">{t("Любой вид")}</option>{(Object.keys(PROOF_LABEL) as Array<keyof typeof PROOF_LABEL>).map((k) => <option key={k} value={k}>{PROOF_LABEL[k]}</option>)}</select>
          <button type="button" className="ghost sm" onClick={() => setOldFirst((v) => !v)} aria-pressed={oldFirst}><Icon name="clock" />{oldFirst ? t("старые сверху") : t("новые сверху")}</button>
          {picked.size > 0 && <button type="button" className="sm" disabled={busy} onClick={() => void decideBatch()}><Icon name="check" />{t("Принять выбранные ({n})", { n: picked.size })}</button>}
        </div>
      )}
      {rows && rows.length > 0 && (
        <ul className="list">
          {shown.map((r) => (
            <li key={r.id} className={"review-item" + (picked.has(r.id) ? " picked" : "")}>
              {rows.length > 1 && !returned && <label className="pick"><input type="checkbox" checked={picked.has(r.id)} onChange={() => togglePick(r.id)} aria-label={t("Выбрать для пакетного принятия")} /></label>}
              <div className="main">
                <span className="row nowrap"><TeamAvatar name={r.team.name} color={r.team.color} size="sm" withName />{r.donation && <Chip tone="accent">{t("пожертвование {n}", { n: `${r.donationAmount ?? ""} ${currency ?? ""}`.trim() })}</Chip>}</span>
                <span className="title">{r.deed.title}</span>
                {r.deed.description && <button type="button" className="ghost sm desc-toggle" aria-expanded={descOpen.has(r.id)} onClick={() => toggleDesc(r.id)}><Icon name="scroll" />{t("Описание")}</button>}
                {r.deed.description && descOpen.has(r.id) && <span className="deed-desc open small muted">{r.deed.description}</span>}
                <span className="meta"><span>{PROOF_LABEL[r.deed.proofType]}</span>{r.takenBy && <span>· {r.takenBy.displayName ?? r.takenBy.nickname}</span>}{r.participantNames && r.participantNames.length > 0 && <span className="participants">· <Icon name="users" />{t("с участниками: {names}", { names: r.participantNames.join(", ") })}</span>}{r.submittedAt && <span>· {fmtDate(r.submittedAt)} · {ageOf(r.submittedAt)}</span>}</span>
                {returned && <span className="meta"><Icon name="alert" />{t("Возвращено {when}", { when: fmtDate(r.decidedAt) })}{r.adminComment ? ` · ${r.adminComment}` : ""}</span>}
                {r.note && <span className="report"><span className="muted">{t("Отчёт команды")}: </span>{r.note}</span>}
                <LinkList links={r.links} kind={linkKind(r.deed.proofType)} />
              </div>
              <div className="side">
                <button type="button" className="sm" onClick={() => void decide(r.id, true)} disabled={busyId === r.id || busyId === "batch"}><Icon name="check" />{returned ? t("Принять после пересмотра") : t("Принять")}</button>
                {!returned && returning !== r.id && <button type="button" className="secondary sm" onClick={() => setReturning(r.id)} disabled={busyId === r.id || busyId === "batch"}><Icon name="x" />{t("Вернуть")}</button>}
              </div>
              {returning === r.id && <ReturnBox placeholder={t("Причина возврата: команда её увидит")} okLabel={t("Вернуть")} busy={busyId === r.id} onOk={(text) => void decide(r.id, false, text)} onCancel={() => setReturning(null)} />}
            </li>
          ))}
        </ul>
      )}
    </ReviewCard>
  );
}


/** Общие дела Каменоломни (решение владельца 04.10): фото всей команды; принято — команде камни по делу. */
interface QuarryRow { id: string; team: { id: string; name: string; color: string; stones: number }; deed: { title: string; description: string; stones: number; quorumPct: number | null }; stones: number; by: string; participants: string[]; teamSize: number; links: string[]; note: string; submittedAt: string }
export function QuarryBlock({ gameId, version = 0, onDecided }: { gameId: string; version?: number; onDecided: () => void }) {
  const { notify } = useUi();
  const [rows, setRows] = useState<QuarryRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [returning, setReturning] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(() => api<{ works: QuarryRow[] }>(`/api/games/${gameId}/quarry/submissions`).then((r) => { setRows(r.works); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useAutoRefresh(load, version);
  async function decide(id: string, approve: boolean, comment = "") {
    setBusyId(id);
    try { await api(`/api/games/${gameId}/quarry/works/${id}/decide`, { method: "POST", body: JSON.stringify({ approve, comment }) }); notify(approve ? t("Принято: команде начислены камни") : t("Сдача возвращена")); setReturning(null); await load(); onDecided(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusyId(null); }
  }
  if (rows && rows.length === 0) return null;
  return (
    <ReviewCard icon="stone" title={t("Каменоломня")} count={rows?.length ?? 0} loading={!rows} error={loadError} onRetry={() => void load()}>
      {rows && rows.length > 0 && (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} className="review-item">
              <div className="main">
                <span className="row nowrap"><TeamAvatar name={r.team.name} color={r.team.color} size="sm" withName /><Chip tone="accent" icon="stone" title={t("Камней за дело")}>{r.stones}</Chip><span className="muted small">· {t("у команды: {n}", { n: r.team.stones })}</span></span>
                <span className="title">{r.deed.title}</span>
                <span className="meta"><span>{t("фото")}</span><span>· {r.by}</span><span>· {fmtDate(r.submittedAt)}</span></span>
                <span className={"small" + (r.deed.quorumPct != null && r.participants.length < Math.ceil((r.teamSize * r.deed.quorumPct) / 100) ? " warn" : "")}>{t("Были")} ({t("{a} из {b}", { a: r.participants.length, b: r.teamSize })}): {r.participants.join(", ") || "—"}{r.deed.quorumPct != null && <span className="muted"> · {t("нужно не меньше {n}", { n: Math.ceil((r.teamSize * r.deed.quorumPct) / 100) })}</span>}</span>
                {r.note && <span className="report"><span className="muted">{t("Отчёт команды")}: </span>{r.note}</span>}
                <LinkList links={r.links} kind="photo" />
              </div>
              <div className="side">
                <button type="button" className="sm" onClick={() => void decide(r.id, true)} disabled={busyId === r.id}><Icon name="check" />{t("Принять")}</button>
                {returning !== r.id && <button type="button" className="secondary sm" onClick={() => setReturning(r.id)} disabled={busyId === r.id}><Icon name="x" />{t("Вернуть")}</button>}
              </div>
              {returning === r.id && <ReturnBox placeholder={t("Причина возврата: команда её увидит")} okLabel={t("Вернуть")} busy={busyId === r.id} onOk={(text) => void decide(r.id, false, text)} onCancel={() => setReturning(null)} />}
            </li>
          ))}
        </ul>
      )}
    </ReviewCard>
  );
}
