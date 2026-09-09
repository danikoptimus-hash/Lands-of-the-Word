import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, GAME_ROLE_LABEL, TEAM_ROLE_LABEL, type GameRole, type TeamDto } from "../lib/api";

/** Блок «Команды» на странице игры для админа. */
export function TeamsBlock({ gameId, teamCount, status }: { gameId: string; teamCount: number; status: string }) {
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<{ teamId: string; url: string; role: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api<{ teams: TeamDto[] }>(`/api/games/${gameId}/teams`).then((r) => setTeams(r.teams)).catch(() => setTeams([]));
  useEffect(() => { void load(); }, [gameId, teamCount]);

  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api(`/api/games/${gameId}/teams`, { method: "POST", body: JSON.stringify({ name }) }); setName(""); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
    finally { setBusy(false); }
  }
  async function invite(teamId: string, role: "CAPTAIN" | "MEMBER") {
    setError(null); setCopied(false);
    try {
      const r = await api<{ invite: { path: string } }>(`/api/games/${gameId}/teams/${teamId}/invites`, { method: "POST", body: JSON.stringify({ role }) });
      setInviteUrl({ teamId, url: window.location.origin + r.invite.path, role });
    } catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
  }
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* браузер не дал доступ к буферу */ }
  }
  async function remove(teamId: string) {
    if (!confirm("Удалить команду вместе с участниками?")) return;
    try { await api(`/api/games/${gameId}/teams/${teamId}`, { method: "DELETE" }); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
  }
  async function patch(teamId: string, userId: string, body: { role?: "CAPTAIN" | "MEMBER"; gameRole?: GameRole }) {
    setError(null);
    try { await api(`/api/games/${gameId}/teams/${teamId}/members/${userId}`, { method: "PATCH", body: JSON.stringify(body) }); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
  }
  async function kick(teamId: string, userId: string, nick: string) {
    if (!confirm(`Убрать ${nick} из команды?`)) return;
    try { await api(`/api/games/${gameId}/teams/${teamId}/members/${userId}`, { method: "DELETE" }); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
  }

  return (
    <div className="card">
      <div className="card-head"><h2>Команды <span className="muted">{teams.length} из {teamCount}</span></h2></div>
      {teams.length < teamCount && (
        <form onSubmit={create} className="row" style={{ marginBottom: ".5rem" }}>
          <input style={{ flex: "1 1 200px" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Название команды" required minLength={2} maxLength={40} />
          <button type="submit" disabled={busy}>Добавить</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {teams.map((t) => (
        <div key={t.id} className="team-stripe" style={{ borderLeftColor: t.color }}>
          <div className="row between">
            <strong>{t.name}</strong>
            <div className="row">
              <button className="secondary sm" onClick={() => void invite(t.id, "CAPTAIN")}>Пригласить капитана</button>
              <button className="secondary sm" onClick={() => void invite(t.id, "MEMBER")}>Пригласить участников</button>
              {status === "DRAFT" && <button className="ghost sm" onClick={() => void remove(t.id)}>Удалить</button>}
            </div>
          </div>
          {inviteUrl?.teamId === t.id && (
            <div className="note ok" style={{ marginTop: ".5rem" }}>
              <div>Ссылка {inviteUrl.role === "CAPTAIN" ? "для капитана" : "для участников"} · 14 дней · до 20 вступлений</div>
              <div className="row" style={{ marginTop: ".4rem" }}>
                <input readOnly value={inviteUrl.url} onFocus={(e) => e.currentTarget.select()} style={{ flex: "1 1 240px", minHeight: 38 }} />
                <button className="sm" onClick={() => void copy(inviteUrl.url)}>{copied ? "Скопировано" : "Скопировать"}</button>
              </div>
            </div>
          )}
          {t.members.length === 0 ? <p className="muted">Пока никого. Отправь ссылку-приглашение.</p> : (
            <ul className="list">
              {t.members.map((m) => (
                <li key={m.user.id}>
                  <div className="main person">
                    <span className="avatar">{(m.user.displayName ?? m.user.nickname).slice(0, 1).toUpperCase()}</span>
                    <div>{m.user.displayName ?? m.user.nickname} <span className={"badge" + (m.role === "CAPTAIN" ? " accent" : "")}>{TEAM_ROLE_LABEL[m.role]}</span></div>
                  </div>
                  <div className="side">
                    {m.role === "MEMBER" && (
                      <select value={m.gameRole} onChange={(e) => void patch(t.id, m.user.id, { gameRole: e.target.value as GameRole })} style={{ width: "auto", minHeight: 34 }}>
                        {(Object.keys(GAME_ROLE_LABEL) as GameRole[]).map((r) => <option key={r} value={r}>{r === "NONE" ? "без роли" : GAME_ROLE_LABEL[r]}</option>)}
                      </select>
                    )}
                    <button className="secondary sm" onClick={() => void patch(t.id, m.user.id, { role: m.role === "CAPTAIN" ? "MEMBER" : "CAPTAIN" })}>
                      {m.role === "CAPTAIN" ? "Снять капитана" : "Сделать капитаном"}
                    </button>
                    <button className="ghost sm" onClick={() => void kick(t.id, m.user.id, m.user.nickname)}>Убрать</button>
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
