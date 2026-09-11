import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { ActionMenu } from "../components/ActionMenu";
import { ErrorState, LoadingState } from "../components/State";

interface AdminRow { id: string; nickname: string; displayName: string | null; email: string | null; creator: boolean }

/** Администраторы игры: несколько человек проверяют сдачи и получают письма о них. Почта других не показывается. */
export function AdminsBlock({ gameId, version = 0 }: { gameId: string; version?: number }) {
  const { user } = useAuth();
  const { confirm, notify } = useUi();
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [login, setLogin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ admins: AdminRow[] }>(`/api/games/${gameId}/admins`).then((r) => { setRows(r.admins); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useEffect(() => { void load(); }, [load, version]);
  async function add(e: FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try { const r = await api<{ nickname: string }>(`/api/games/${gameId}/admins`, { method: "POST", body: JSON.stringify({ login }) }); setLogin(""); notify(t("{nick} теперь администратор", { nick: r.nickname })); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function remove(a: AdminRow) {
    if (!(await confirm(t("{nick} больше не сможет вести эту игру.", { nick: a.nickname }), { title: t("Убрать администратора?"), okLabel: t("Убрать"), danger: true }))) return;
    try { await api(`/api/games/${gameId}/admins/${a.id}`, { method: "DELETE" }); notify(t("{nick} убран из администраторов", { nick: a.nickname })); await load(); }
    catch (err) { notify(err instanceof ApiError ? err.message : t("Ошибка сети"), "bad"); }
  }
  return (
    <div className="card">
      <div className="card-head"><h2><span className="ico"><Icon name="user" /></span>{t("Администраторы")} {rows && <span className="count">{rows.length}</span>}</h2></div>
      {loadError ? <ErrorState onRetry={() => void load()} /> : !rows ? <LoadingState rows={2} /> : (
        <ul className="list">
          {rows.map((a) => (
            <li key={a.id}>
              <div className="main"><span className="person"><span className="avatar">{(a.displayName ?? a.nickname).slice(0, 1).toUpperCase()}</span><span className="name">{a.displayName ?? a.nickname}</span>{a.displayName && <span className="muted small">{a.nickname}</span>}{a.creator && <Chip tone="accent">{t("создатель")}</Chip>}{!a.email && <Chip tone="warn">{t("без почты")}</Chip>}</span></div>
              {!a.creator && a.id !== user?.id && <div className="side"><ActionMenu label={t("Ещё")} items={[{ label: t("Убрать"), icon: "trash", danger: true, onSelect: () => void remove(a) }]} /></div>}
            </li>
          ))}
        </ul>
      )}
      {rows && (
        <div className="add-row">
          <form onSubmit={add} className="inline-form">
            <input id="adm-login" value={login} onChange={(e) => setLogin(e.target.value)} placeholder={t("Никнейм или почта")} aria-label={t("Добавить администратора")} maxLength={120} />
            <button type="submit" className="sm" disabled={busy || !login.trim()}><Icon name="plus" />{t("Добавить")}</button>
          </form>
          {error && <p className="error">{error}</p>}
          <p className="hint">{t("Администраторы проверяют сдачи и получают письма о них.")}</p>
        </div>
      )}
    </div>
  );
}
