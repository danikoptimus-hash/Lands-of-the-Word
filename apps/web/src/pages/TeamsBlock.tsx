import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, GAME_ROLE_LABEL, TEAM_ROLE_LABEL, type GameRole, type TeamDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";

/** Блок «Команды» на странице игры для админа. */
export function TeamsBlock({ gameId, teamCount, status, version = 0, onChange }: { gameId: string; teamCount: number; status: string; version?: number; onChange?: () => void }) {
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<{ teamId: string; url: string; role: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const ui = useUi();

  const load = () => api<{ teams: TeamDto[] }>(`/api/games/${gameId}/teams`).then((r) => setTeams(r.teams)).catch(() => setTeams([]));
  const reload = async () => { await load(); onChange?.(); };
  useEffect(() => { void load(); }, [gameId, teamCount, version]);

  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api(`/api/games/${gameId}/teams`, { method: "POST", body: JSON.stringify({ name }) }); setName(""); await reload(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function invite(teamId: string, role: "CAPTAIN" | "MEMBER") {
    setError(null); setCopied(false);
    try {
      const r = await api<{ invite: { path: string } }>(`/api/games/${gameId}/teams/${teamId}/invites`, { method: "POST", body: JSON.stringify({ role }) });
      setInviteUrl({ teamId, url: window.location.origin + r.invite.path, role });
    } catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
  }
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); ui.notify(t("Ссылка скопирована")); } catch { ui.notify(t("Скопируй ссылку вручную из поля"), "bad"); }
  }
  async function remove(teamId: string) {
    if (!(await ui.confirm(t("Команда будет удалена вместе с участниками."), { title: t("Удалить команду?"), okLabel: t("Удалить"), danger: true }))) return;
    try { await api(`/api/games/${gameId}/teams/${teamId}`, { method: "DELETE" }); await reload(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
  }
  async function patch(teamId: string, userId: string, body: { role?: "CAPTAIN" | "MEMBER"; gameRole?: GameRole }) {
    setError(null);
    try { await api(`/api/games/${gameId}/teams/${teamId}/members/${userId}`, { method: "PATCH", body: JSON.stringify(body) }); await reload(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
  }
  async function kick(teamId: string, userId: string, nick: string) {
    if (!(await ui.confirm(t("{nick} будет убран из команды.", { nick }), { title: t("Убрать участника?"), okLabel: t("Убрать"), danger: true }))) return;
    try { await api(`/api/games/${gameId}/teams/${teamId}/members/${userId}`, { method: "DELETE" }); await reload(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
  }

  return (
    <div className="card" data-tone="blue">
      <div className="card-head"><h2><span className="ico"><Icon name="users" /></span>{t("Команды")} <span className="muted">{t("{a} из {b}", { a: teams.length, b: teamCount })}</span></h2></div>
      {teams.length < teamCount && (
        <form onSubmit={create} className="row" style={{ marginBottom: ".5rem" }}>
          <input style={{ flex: "1 1 200px" }} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Название команды")} required minLength={2} maxLength={40} />
          <button type="submit" disabled={busy}>{t("Добавить")}</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {teams.map((tm) => (
        <div key={tm.id} className="team-stripe" style={{ borderLeftColor: tm.color }}>
          <div className="row between">
            <strong>{tm.name}</strong>
            <div className="row">
              <button className="secondary sm" onClick={() => void invite(tm.id, "CAPTAIN")} title={t("Пригласить капитана")}><Icon name="link" />{t("Капитан")}</button>
              <button className="secondary sm" onClick={() => void invite(tm.id, "MEMBER")} title={t("Пригласить участников")}><Icon name="link" />{t("Участники")}</button>
              {status === "DRAFT" && <button className="ghost sm icon" onClick={() => void remove(tm.id)} aria-label={t("Удалить команду")} title={t("Удалить")}><Icon name="trash" /></button>}
            </div>
          </div>
          {inviteUrl?.teamId === tm.id && (
            <div className="note ok" style={{ marginTop: ".5rem" }}>
              <div>{t("Ссылка {who} · 14 дней · до 20 вступлений", { who: inviteUrl.role === "CAPTAIN" ? t("для капитана") : t("для участников") })}</div>
              <div className="row" style={{ marginTop: ".4rem" }}>
                <input readOnly value={inviteUrl.url} onFocus={(e) => e.currentTarget.select()} style={{ flex: "1 1 240px", minHeight: 38 }} />
                <button className="sm" onClick={() => void copy(inviteUrl.url)}><Icon name={copied ? "check" : "copy"} />{copied ? t("Скопировано") : t("Скопировать")}</button>
              </div>
            </div>
          )}
          {tm.members.length === 0 ? <p className="muted">{t("Команда пока пустая: отправь ссылку капитану.")}</p> : (
            <ul className="list">
              {tm.members.map((m) => (
                <li key={m.user.id}>
                  <div className="main person">
                    <span className="avatar">{(m.user.displayName ?? m.user.nickname).slice(0, 1).toUpperCase()}</span>
                    <div>{m.user.displayName ?? m.user.nickname} <span className={"badge" + (m.role === "CAPTAIN" ? " accent" : "")}>{TEAM_ROLE_LABEL[m.role]}</span></div>
                  </div>
                  <div className="side">
                    {m.role === "MEMBER" && (
                      <select value={m.gameRole} onChange={(e) => void patch(tm.id, m.user.id, { gameRole: e.target.value as GameRole })} style={{ width: "auto", minHeight: 34 }}>
                        {(Object.keys(GAME_ROLE_LABEL) as GameRole[]).map((r) => <option key={r} value={r}>{r === "NONE" ? t("без роли") : GAME_ROLE_LABEL[r]}</option>)}
                      </select>
                    )}
                    <button className="secondary sm" onClick={() => void patch(tm.id, m.user.id, { role: m.role === "CAPTAIN" ? "MEMBER" : "CAPTAIN" })}>
                      {m.role === "CAPTAIN" ? t("Снять капитана") : t("Сделать капитаном")}
                    </button>
                    <button className="ghost sm icon" onClick={() => void kick(tm.id, m.user.id, m.user.nickname)} aria-label={t("Убрать из команды")} title={t("Убрать")}><Icon name="trash" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
