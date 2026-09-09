import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, GAME_ROLE_LABEL, TEAM_ROLE_LABEL, type GameRole, type TeamDto } from "../lib/api";
import { useAuth } from "../lib/auth";

/** Страница команды для участника. Пока — состав и роли; карта команды с туманом появится здесь же. */
export function TeamPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const [team, setTeam] = useState<TeamDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<{ teams: TeamDto[] }>(`/api/games/${id}/teams`).then((r) => setTeam(r.teams[0] ?? null)).catch((e) => setError(e instanceof ApiError ? e.message : "Ошибка сети"));
  useEffect(() => { void load(); }, [id]);

  const me = team?.members.find((m) => m.user.id === user?.id);
  const isCaptain = me?.role === "CAPTAIN";

  async function setGameRole(userId: string, gameRole: GameRole) {
    try { await api(`/api/games/${id}/teams/${team!.id}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ gameRole }) }); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
  }

  if (error) return <p className="error">{error}</p>;
  if (!team) return <p className="muted">Загрузка…</p>;

  return (
    <>
      <p><Link to="/">← Мои игры</Link></p>
      <div className="card" style={{ borderTop: `6px solid ${team.color}` }}>
        <h1>{team.name}</h1>
        <p className="muted">Вы — {me ? TEAM_ROLE_LABEL[me.role] : "?"}{me && me.gameRole !== "NONE" ? `, ${GAME_ROLE_LABEL[me.gameRole].toLowerCase()}` : ""}</p>
        <h2>Состав</h2>
        <ul className="list">
          {team.members.map((m) => (
            <li key={m.user.id}>
              <span>{m.user.displayName ?? m.user.nickname} <span className="muted">· {TEAM_ROLE_LABEL[m.role]}</span></span>
              {isCaptain ? (
                <select value={m.gameRole} onChange={(e) => void setGameRole(m.user.id, e.target.value as GameRole)} style={{ width: "auto" }}>
                  {(Object.keys(GAME_ROLE_LABEL) as GameRole[]).map((r) => <option key={r} value={r}>{GAME_ROLE_LABEL[r]}</option>)}
                </select>
              ) : <span className="muted">{GAME_ROLE_LABEL[m.gameRole]}</span>}
            </li>
          ))}
        </ul>
      </div>
      <div className="card"><p className="muted">Карта команды появится здесь, когда администратор начнёт игру.</p></div>
    </>
  );
}
