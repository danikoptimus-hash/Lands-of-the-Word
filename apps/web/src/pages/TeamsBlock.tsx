import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, GAME_ROLE_LABEL, TEAM_ROLE_LABEL, type GameRole, type TeamDto } from "../lib/api";

/** Блок «Команды» на странице игры для админа. */
export function TeamsBlock({ gameId, teamCount, status }: { gameId: string; teamCount: number; status: string }) {
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<{ teamId: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<{ teams: TeamDto[] }>(`/api/games/${gameId}/teams`).then((r) => setTeams(r.teams)).catch(() => setTeams([]));
  useEffect(() => { void load(); }, [gameId]);

  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api(`/api/games/${gameId}/teams`, { method: "POST", body: JSON.stringify({ name }) }); setName(""); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
    finally { setBusy(false); }
  }
  async function invite(teamId: string, role: "CAPTAIN" | "MEMBER") {
    setError(null);
    try {
      const r = await api<{ invite: { path: string } }>(`/api/games/${gameId}/teams/${teamId}/invites`, { method: "POST", body: JSON.stringify({ role }) });
      setInviteUrl({ teamId, url: window.location.origin + r.invite.path });
    } catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
  }
  async function remove(teamId: string) {
    if (!confirm("Удалить команду вместе с участниками?")) return;
    try { await api(`/api/games/${gameId}/teams/${teamId}`, { method: "DELETE" }); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
  }
  async function setRole(teamId: string, userId: string, patch: { role?: "CAPTAIN" | "MEMBER"; gameRole?: GameRole }) {
    try { await api(`/api/games/${gameId}/teams/${teamId}/members/${userId}`, { method: "PATCH", body: JSON.stringify(patch) }); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
  }

  return (
    <div className="card">
      <h2>Команды <span className="muted">({teams.length} из {teamCount})</span></h2>
      {teams.length < teamCount && (
        <form onSubmit={create} className="row" style={{ marginBottom: "1rem" }}>
          <input style={{ flex: 1, minWidth: 200 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Название команды, например Иерусалим" required minLength={2} maxLength={40} />
          <button type="submit" disabled={busy}>Добавить команду</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {teams.map((t) => (
        <div key={t.id} style={{ borderLeft: `6px solid ${t.color}`, paddingLeft: ".75rem", marginBottom: "1rem" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{t.name}</strong>
            <span className="row">
              <button className="secondary" onClick={() => void invite(t.id, "CAPTAIN")}>Ссылка для капитана</button>
              <button className="secondary" onClick={() => void invite(t.id, "MEMBER")}>Ссылка для участников</button>
              {status === "DRAFT" && <button className="secondary" onClick={() => void remove(t.id)}>Удалить</button>}
            </span>
          </div>
          {inviteUrl?.teamId === t.id && (
            <p className="muted" style={{ wordBreak: "break-all" }}>
              Отправь эту ссылку: <code>{inviteUrl.url}</code>{" "}
              <button className="secondary" onClick={() => void navigator.clipboard?.writeText(inviteUrl.url)}>Скопировать</button>
              <br />Действует 14 дней, до 20 вступлений.
            </p>
          )}
          {t.members.length === 0 ? <p className="muted">Пока никого. Раздай ссылку-приглашение.</p> : (
            <ul className="list">
              {t.members.map((m) => (
                <li key={m.user.id}>
                  <span>{m.user.displayName ?? m.user.nickname} <span className="muted">· {TEAM_ROLE_LABEL[m.role]}</span></span>
                  <span className="row">
                    <select value={m.gameRole} onChange={(e) => void setRole(t.id, m.user.id, { gameRole: e.target.value as GameRole })} style={{ width: "auto" }}>
                      {(Object.keys(GAME_ROLE_LABEL) as GameRole[]).map((r) => <option key={r} value={r}>{GAME_ROLE_LABEL[r]}</option>)}
                    </select>
                    <button className="secondary" onClick={() => void setRole(t.id, m.user.id, { role: m.role === "CAPTAIN" ? "MEMBER" : "CAPTAIN" })}>
                      {m.role === "CAPTAIN" ? "Снять капитана" : "Сделать капитаном"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
