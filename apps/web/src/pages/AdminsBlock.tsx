import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { ActionMenu } from "../components/ActionMenu";
import { ErrorState, LoadingState } from "../components/State";
import { Help } from "../components/Help";

interface AdminRow { id: string; nickname: string; displayName: string | null; email: string | null; creator: boolean }

/** Администраторы игры: несколько человек проверяют сдачи и получают письма о них. Почта других не показывается. */
export function AdminsBlock({ gameId, version = 0 }: { gameId: string; version?: number }) {
  const { user } = useAuth();
  const { confirm, notify } = useUi();
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const load = useCallback(() => api<{ admins: AdminRow[] }>(`/api/games/${gameId}/admins`).then((r) => { setRows(r.admins); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useEffect(() => { void load(); }, [load, version]);
  /**
   * Приглашение администратора одной кнопкой (решение владельца 23.09): ссылка сразу в буфере, без поля с почтой.
   * В Safari буфер доступен только из жеста — ссылка передаётся обещанием через ClipboardItem; где его нет, ждём ответ и пишем текст.
   */
  async function inviteCopy() {
    setInviting(true); setFallback(null);
    const url = api<{ invite: { path: string } }>(`/api/games/${gameId}/admin-invites`, { method: "POST" }).then((r) => window.location.origin + r.invite.path);
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": url.then((u) => new Blob([u], { type: "text/plain" })) })]);
      } else {
        await navigator.clipboard.writeText(await url);
      }
      notify(t("Ссылка для администратора скопирована: действует 14 дней, до 5 человек")); setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      if (e instanceof ApiError) { notify(e.message, "bad"); return; }
      try { setFallback(await url); notify(t("Не удалось скопировать: выделите ссылку вручную"), "bad"); } catch (e2) { notify(e2 instanceof ApiError ? e2.message : t("Ошибка сети"), "bad"); }
    } finally { setInviting(false); }
  }
  async function remove(a: AdminRow) {
    if (!(await confirm(t("{nick} больше не сможет вести эту игру.", { nick: a.nickname }), { title: t("Убрать администратора?"), okLabel: t("Убрать"), danger: true }))) return;
    try { await api(`/api/games/${gameId}/admins/${a.id}`, { method: "DELETE" }); notify(t("{nick} убран из администраторов", { nick: a.nickname })); await load(); }
    catch (err) { notify(err instanceof ApiError ? err.message : t("Ошибка сети"), "bad"); }
  }
  return (
    <div className="card">
      <div className="card-head">
        <h2><span className="ico"><Icon name="user" /></span>{t("Администраторы")} {rows && <span className="count">{rows.length}</span>}</h2>
        <Help>{t("Администраторы проверяют сдачи и получают письма о них.")}</Help>
        <button type="button" className="sm" onClick={() => void inviteCopy()} disabled={!rows || inviting} title={t("Скопировать ссылку-приглашение для администратора")}><Icon name={copied ? "check" : "link"} />{t("Пригласить")}</button>
      </div>
      {fallback && <p className="hint invite-fallback"><a href={fallback}>{fallback}</a></p>}
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
    </div>
  );
}
