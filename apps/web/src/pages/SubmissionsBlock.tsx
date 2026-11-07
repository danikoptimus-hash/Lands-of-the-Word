import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, apiReady, ready, PROOF_LABEL, type EdgeTaskDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { ErrorState, LoadingState } from "../components/State";

type Row = EdgeTaskDto & { team: { id: string; name: string; color: string; avatarId?: string | null }; takenBy: { nickname: string; displayName: string | null } | null; /** Имена участников дела группой, без взявшего. */ participantNames?: string[]; takenAt?: string | null };

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

/**
 * Ссылки сдачи — квадратные кнопки со значком (фото, видео, ссылка) и номером, если ссылок несколько; подпись «Фото 1»
 * только во всплывающей подсказке. Стоят в ряду действий перед «Принять» (решение владельца 06.11: «убираем текст „фото“
 * и ставим квадратную кнопку перед „Принять“»; до этого видео было значком с 31.10, фото — текстом).
 */
export function LinkList({ links, kind }: { links: string[]; kind: "photo" | "video" | "link" }) {
  if (links.length === 0) return null;
  const word = kind === "photo" ? t("Фото") : kind === "video" ? t("Видео") : t("Ссылка");
  const label = (i: number) => (links.length > 1 ? `${word} ${i + 1}` : word);
  const icon = kind === "photo" ? "camera" : kind === "video" ? "video" : "link";
  return <>{links.map((l, i) => <a key={l + i} className="btn secondary sm icon proof-btn" href={l} target="_blank" rel="noopener noreferrer" aria-label={label(i)} title={label(i)}><Icon name={icon} />{links.length > 1 && <i className="n">{i + 1}</i>}</a>)}</>;
}

/** Отрицательное решение: поле причины появляется только когда возвращают, с фокусом. */
export function ReturnBox({ placeholder, okLabel, onOk, onCancel, busy }: { placeholder: string; okLabel: string; onOk: (text: string) => void; onCancel: () => void; busy: boolean }) {
  const [text, setText] = useState("");
  return (
    <div className="return-box">
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={500} aria-label={placeholder} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onOk(text); } }} />
      <div className="row">
        <button type="button" className="secondary sm" onClick={() => onOk(text)} disabled={busy}><Icon name="x" />{okLabel}</button>
        <button type="button" className="ghost sm icon" aria-label={t("Отмена")} title={t("Отмена")} onClick={onCancel}><Icon name="x" /></button>
      </div>
    </div>
  );
}

/** Очередь сдач дел. */
export function SubmissionsBlock({ gameId, version = 0, currency, onDecided, onShowOnMap }: { gameId: string; version?: number; currency?: string; onDecided: () => void; /** «Посмотреть на карте» у сдачи (просьба владельца 10.10): карта центрируется на стороне дела. */ onShowOnMap?: (f: { teamId: string; taskId: string; fromKey: string; toKey: string }) => void }) {
  const { notify } = useUi();
  const [rows, setRows] = useState<Row[] | null>(() => ready<{ tasks: Row[] }>(`/api/games/${gameId}/submissions`)?.tasks ?? null);
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
  const load = useCallback(() => apiReady<{ tasks: Row[] }>(`/api/games/${gameId}/submissions${returned ? "?status=REJECTED" : ""}`).then((r) => { setRows(r.tasks); setLoadError(false); }).catch(() => setLoadError(true)), [gameId, returned]);
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
                <span className="row nowrap"><TeamAvatar name={r.team.name} color={r.team.color} avatarId={r.team.avatarId} size="sm" withName teamId={r.team.id} />{r.donation && <Chip tone="accent">{t("пожертвование {n}", { n: `${r.donationAmount ?? ""} ${currency ?? ""}`.trim() })}</Chip>}</span>
                <span className="title">{r.deed.title}</span>
                {r.person && <span className="meta person-line"><Icon name="user" />{t("Кому: {name}", { name: r.person.name })}</span>}
                {r.deed.description && <button type="button" className="ghost sm desc-toggle" aria-expanded={descOpen.has(r.id)} onClick={() => toggleDesc(r.id)}><Icon name="scroll" />{t("Описание")}</button>}
                {r.deed.description && descOpen.has(r.id) && <span className="deed-desc open small muted">{r.deed.description}</span>}
                <span className="meta"><span>{PROOF_LABEL[r.deed.proofType]}</span>{r.takenBy && <span>· {r.takenBy.displayName ?? r.takenBy.nickname}</span>}{r.takenAt && <span>· {t("взято {date}", { date: fmtDate(r.takenAt) })}</span>}{r.participantNames && r.participantNames.length > 0 && <span className="participants">· <Icon name="users" />{t("с участниками: {names}", { names: r.participantNames.join(", ") })}</span>}{r.submittedAt && <span>· {t("сдано {date}", { date: fmtDate(r.submittedAt) })} · {ageOf(r.submittedAt)}</span>}</span>
                {returned && <span className="meta"><Icon name="alert" />{t("Возвращено {when}", { when: fmtDate(r.decidedAt) })}{r.adminComment ? ` · ${r.adminComment}` : ""}</span>}
                {r.note && <span className="report"><span className="muted">{t("Отчёт команды")}: </span>{r.note}</span>}
              </div>
              <div className="side">
                <LinkList links={r.links} kind={linkKind(r.deed.proofType)} />
                <button type="button" className="sm" onClick={() => void decide(r.id, true)} disabled={busyId === r.id || busyId === "batch"}><Icon name="check" />{returned ? t("Принять после пересмотра") : t("Принять")}</button>
                {!returned && returning !== r.id && <button type="button" className="secondary sm icon" aria-label={t("Вернуть")} title={t("Вернуть")} onClick={() => setReturning(r.id)} disabled={busyId === r.id || busyId === "batch"}><Icon name="x" /></button>}
                {onShowOnMap && <button type="button" className="secondary sm icon" aria-label={t("Посмотреть на карте")} title={t("Посмотреть на карте")} onClick={() => onShowOnMap({ teamId: r.team.id, taskId: r.id, fromKey: r.fromKey, toKey: r.toKey })}><Icon name="map" /></button>}
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
interface QuarryRow { id: string; team: { id: string; name: string; color: string; avatarId?: string | null; stones: number }; deed: { title: string; description: string; stones: number; quorumPct: number | null }; stones: number; by: string; participants: string[]; teamSize: number; links: string[]; note: string; submittedAt: string }
export function QuarryBlock({ gameId, version = 0, onDecided }: { gameId: string; version?: number; onDecided: () => void }) {
  const { notify } = useUi();
  const [rows, setRows] = useState<QuarryRow[] | null>(() => ready<{ works: QuarryRow[] }>(`/api/games/${gameId}/quarry/submissions`)?.works ?? null);
  const [loadError, setLoadError] = useState(false);
  const [returning, setReturning] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = useCallback(() => apiReady<{ works: QuarryRow[] }>(`/api/games/${gameId}/quarry/submissions`).then((r) => { setRows(r.works); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
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
                <span className="row nowrap"><TeamAvatar name={r.team.name} color={r.team.color} avatarId={r.team.avatarId} size="sm" withName teamId={r.team.id} /><Chip tone="accent" icon="stone" title={t("Камней за дело")}>{r.stones}</Chip><span className="muted small">· {t("у команды: {n}", { n: r.team.stones })}</span></span>
                <span className="title">{r.deed.title}</span>
                <span className="meta"><span>{t("фото")}</span><span>· {r.by}</span><span>· {fmtDate(r.submittedAt)}</span></span>
                <span className={"small" + (r.deed.quorumPct != null && r.participants.length < Math.ceil((r.teamSize * r.deed.quorumPct) / 100) ? " warn" : "")}>{t("Были")} ({t("{a} из {b}", { a: r.participants.length, b: r.teamSize })}): {r.participants.join(", ") || "—"}{r.deed.quorumPct != null && <span className="muted"> · {t("нужно не меньше {n}", { n: Math.ceil((r.teamSize * r.deed.quorumPct) / 100) })}</span>}</span>
                {r.note && <span className="report"><span className="muted">{t("Отчёт команды")}: </span>{r.note}</span>}
              </div>
              <div className="side">
                <LinkList links={r.links} kind="photo" />
                <button type="button" className="sm" onClick={() => void decide(r.id, true)} disabled={busyId === r.id}><Icon name="check" />{t("Принять")}</button>
                {returning !== r.id && <button type="button" className="secondary sm icon" aria-label={t("Вернуть")} title={t("Вернуть")} onClick={() => setReturning(r.id)} disabled={busyId === r.id}><Icon name="x" /></button>}
              </div>
              {returning === r.id && <ReturnBox placeholder={t("Причина возврата: команда её увидит")} okLabel={t("Вернуть")} busy={busyId === r.id} onOk={(text) => void decide(r.id, false, text)} onCancel={() => setReturning(null)} />}
            </li>
          ))}
        </ul>
      )}
    </ReviewCard>
  );
}


/**
 * Разбитые бурей корабли (решение владельца 04.11): сдачи срочных заданий. Принято — груз по жребию сервера (камни или
 * блоки для стен), после решения видно, что выпало; возвращено — с комментарием, команда может сдать снова.
 */
interface WreckRow { id: string; wreckId: string; team: { id: string; name: string; color: string; avatarId?: string | null; stones: number; cargoBlocks: number }; title: string; description: string; proofType: EdgeTaskDto["deed"]["proofType"]; by: string; participants: string[]; links: string[]; note: string; status: "SUBMITTED" | "APPROVED" | "REJECTED"; submittedAt: string; decidedAt: string | null; adminComment: string; cargo: "STONES" | "BLOCKS" | null; amount: number | null; sunk: boolean }
export function WrecksBlock({ gameId, version = 0, onDecided }: { gameId: string; version?: number; onDecided: () => void }) {
  const { notify } = useUi();
  const [rows, setRows] = useState<WreckRow[] | null>(() => ready<{ works: WreckRow[] }>(`/api/games/${gameId}/wrecks/submissions`)?.works ?? null);
  const [done, setDone] = useState<WreckRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [returning, setReturning] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [descOpen, setDescOpen] = useState<Set<string>>(new Set());
  const load = useCallback(() => Promise.all([
    apiReady<{ works: WreckRow[] }>(`/api/games/${gameId}/wrecks/submissions`).then((r) => setRows(r.works)),
    api<{ works: WreckRow[] }>(`/api/games/${gameId}/wrecks/submissions?status=DECIDED`).then((r) => setDone(r.works.slice(0, 6))).catch(() => {}),
  ]).then(() => setLoadError(false)).catch(() => setLoadError(true)), [gameId]);
  useAutoRefresh(load, version);
  async function decide(id: string, approve: boolean, comment = "") {
    setBusyId(id);
    try {
      const r = await api<{ cargo?: "STONES" | "BLOCKS"; amount?: number }>(`/api/games/${gameId}/wrecks/works/${id}/decide`, { method: "POST", body: JSON.stringify({ approve, comment }) });
      notify(approve ? (r.cargo === "STONES" ? t("Принято: выпали тёсаные камни — {n}", { n: r.amount ?? 0 }) : t("Принято: выпали блоки для стен — {n}", { n: r.amount ?? 0 })) : t("Сдача возвращена"));
      setReturning(null); await load(); onDecided();
    } catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusyId(null); }
  }
  const cargoText = (w: WreckRow) => w.cargo === "STONES" ? t("выпало: тёсаных камней {n}", { n: w.amount ?? 0 }) : w.cargo === "BLOCKS" ? t("выпало: блоков для стен {n}", { n: w.amount ?? 0 }) : "";
  const linkKind = (p: WreckRow["proofType"]) => (p === "PHOTO_LINK" ? "photo" : p === "VIDEO_LINK" ? "video" : "link");
  const toggleDesc = (id: string) => setDescOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  if (rows && rows.length === 0 && done.length === 0) return null;
  return (
    <ReviewCard icon="ship" title={t("Корабли")} count={rows?.length ?? 0} loading={!rows} error={loadError} onRetry={() => void load()}>
      {rows && rows.length > 0 && (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} className="review-item">
              <div className="main">
                <span className="row nowrap"><TeamAvatar name={r.team.name} color={r.team.color} avatarId={r.team.avatarId} size="sm" withName teamId={r.team.id} /><Chip tone="bad" icon="ship">{t("срочное")}</Chip><span className="muted small">· {t("у команды: камней {a}, блоков {b}", { a: r.team.stones, b: r.team.cargoBlocks })}</span></span>
                <span className="title">{r.title}</span>
                {r.description && <button type="button" className="ghost sm desc-toggle" aria-expanded={descOpen.has(r.id)} onClick={() => toggleDesc(r.id)}><Icon name="scroll" />{t("Описание")}</button>}
                {r.description && descOpen.has(r.id) && <span className="deed-desc open small muted">{r.description}</span>}
                <span className="meta"><span>{PROOF_LABEL[r.proofType]}</span><span>· {r.by}</span><span>· {fmtDate(r.submittedAt)}</span>{r.participants.length > 0 && <span className="participants">· <Icon name="users" />{t("с участниками: {names}", { names: r.participants.join(", ") })}</span>}</span>
                {r.note && <span className="report"><span className="muted">{t("Отчёт команды")}: </span>{r.note}</span>}
              </div>
              <div className="side">
                <LinkList links={r.links} kind={linkKind(r.proofType)} />
                <button type="button" className="sm" onClick={() => void decide(r.id, true)} disabled={busyId === r.id}><Icon name="check" />{t("Принять")}</button>
                {returning !== r.id && <button type="button" className="secondary sm icon" aria-label={t("Вернуть")} title={t("Вернуть")} onClick={() => setReturning(r.id)} disabled={busyId === r.id}><Icon name="x" /></button>}
              </div>
              {returning === r.id && <ReturnBox placeholder={t("Причина возврата: команда её увидит")} okLabel={t("Вернуть")} busy={busyId === r.id} onOk={(text) => void decide(r.id, false, text)} onCancel={() => setReturning(null)} />}
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details className="disclose sm mt-2">
          <summary><Icon name="clock" />{t("Решённые")}<Icon name="chevron-down" className="chev" /></summary>
          <ul className="list">
            {done.map((w) => (
              <li key={w.id}>
                <div className="main">
                  <span className="row nowrap"><TeamAvatar name={w.team.name} color={w.team.color} avatarId={w.team.avatarId} size="sm" withName teamId={w.team.id} />{w.status === "APPROVED" ? <Chip tone="ok" icon="check">{t("принято")}</Chip> : <Chip tone="bad" icon="alert">{w.sunk && w.adminComment === "Корабль затонул" ? t("корабль затонул") : t("возвращено")}</Chip>}</span>
                  <span className="title">{w.title}</span>
                  <span className="meta">{w.decidedAt && <span>{fmtDate(w.decidedAt)}</span>}{w.status === "APPROVED" && <span>· <Icon name={w.cargo === "STONES" ? "stone" : "wall"} />{cargoText(w)}</span>}{w.status === "REJECTED" && w.adminComment && w.adminComment !== "Корабль затонул" && <span>· {w.adminComment}</span>}</span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </ReviewCard>
  );
}
