import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { useUi } from "../lib/ui";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { EmptyState, ErrorState, LoadingState } from "../components/State";

/**
 * Суперадмин: последние аватарки участников и команд (решение владельца 24.10). Проверку на уместность делает
 * OpenAI при загрузке; здесь — разбор вручную: убрать, убрать и запретить загрузившему, снять запрет.
 */
interface Row {
  id: string; createdAt: string; moderation: Record<string, number> | null;
  uploadedBy: { id: string; nickname: string; displayName: string | null; avatarBlocked: boolean } | null;
  user: { id: string; nickname: string; displayName: string | null } | null;
  team: { id: string; name: string; color: string; game: { id: string; name: string } } | null;
}
export function AvatarsAdmin() {
  const ui = useUi();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setError(null); return api<{ avatars: Row[] }>("/api/admin/avatars").then((r) => setRows(r.avatars)).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); }, []);
  useEffect(() => { void load(); }, [load]);
  async function remove(a: Row, block: boolean) {
    const who = a.team ? a.team.name : a.user ? a.user.displayName || a.user.nickname : "?";
    if (!(await ui.confirm(block ? t("Убрать фото и запретить загрузившему ставить аватарки?") : t("Убрать фото?"), { title: who, okLabel: block ? t("Убрать и запретить") : t("Убрать") }))) return;
    try { await api(`/api/admin/avatars/${a.id}?block=${block ? 1 : 0}`, { method: "DELETE" }); ui.notify(t("Фото убрано")); await load(); }
    catch (e) { ui.notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }
  async function unblock(userId: string) {
    try { await api(`/api/admin/avatars/unblock/${userId}`, { method: "POST", body: "{}" }); ui.notify(t("Запрет снят")); await load(); }
    catch (e) { ui.notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }
  if (error) return <div className="card"><ErrorState text={error} onRetry={() => void load()} /></div>;
  if (!rows) return <div className="card"><LoadingState /></div>;
  return (
    <div className="card">
      <div className="card-head"><h2><Icon name="camera" />{t("Фото")}</h2><span className="muted small">{t("последние {n}", { n: rows.length })}</span></div>
      {rows.length === 0 ? <EmptyState inline icon="camera" text={t("Аватарок пока нет.")} /> : (
        <ul className="avatar-grid">
          {rows.map((a) => {
            const scores = Object.entries(a.moderation ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 3);
            return (
              <li key={a.id}>
                <img src={`/api/avatars/${a.id}`} alt="" loading="lazy" />
                <div className="body">
                  <div className="strong">{a.team ? a.team.name : a.user ? a.user.displayName || a.user.nickname : t("без владельца")}</div>
                  <div className="muted small">{a.team ? `${t("команда")} · ${a.team.game.name}` : t("участник")}{a.user?.displayName ? ` · ${a.user.nickname}` : ""}</div>
                  {a.team && a.uploadedBy && <div className="muted small">{t("поставил(а)")} {a.uploadedBy.displayName || a.uploadedBy.nickname}</div>}
                  <div className="muted small">{fmtDate(Date.parse(a.createdAt))}</div>
                  <div className="row wrap mt-1">
                    {scores.length === 0 ? <Chip tone="ok" icon="check">{t("проверка: чисто")}</Chip> : scores.map(([k, v]) => <Chip key={k} tone={v >= 0.5 ? "warn" : "neutral"}>{k} {Math.round(v * 100)}%</Chip>)}
                    {a.uploadedBy?.avatarBlocked && <Chip tone="warn" icon="alert">{t("запрет")}</Chip>}
                  </div>
                  <div className="row wrap mt-2">
                    <button type="button" className="sm" onClick={() => void remove(a, false)}>{t("Убрать")}</button>
                    {a.uploadedBy && !a.uploadedBy.avatarBlocked && <button type="button" className="sm danger" onClick={() => void remove(a, true)}>{t("Убрать и запретить")}</button>}
                    {a.uploadedBy?.avatarBlocked && <button type="button" className="ghost sm" onClick={() => void unblock(a.uploadedBy!.id)}>{t("Снять запрет")}</button>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
