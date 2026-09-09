import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, GAME_ROLE_LABEL, TEAM_ROLE_LABEL, type GameRole, type TeamDto } from "../lib/api";
import { useAuth } from "../lib/auth";

/** Страница команды для участника: состав и роли. Здесь же появится карта команды. */
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
    setError(null);
    try { await api(`/api/games/${id}/teams/${team!.id}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ gameRole }) }); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
  }

  if (error && !team) return <p className="error">{error}</p>;
  if (!team) return <p className="muted">Загрузка…</p>;

  return (
    <>
      <p><Link to="/">← Мои игры</Link></p>
      <div className="card" style={{ borderTop: `4px solid ${team.color}` }}>
        <div className="person" style={{ gap: ".8rem" }}>
          <span className="avatar" style={{ background: team.color, color: "#fff", width: 44, height: 44, fontSize: "1.1rem" }}>{team.name.slice(0, 1)}</span>
          <div><h1 style={{ margin: 0 }}>{team.name}</h1><div className="muted">Вы — {me ? TEAM_ROLE_LABEL[me.role] : "?"}{me && me.role === "MEMBER" && me.gameRole !== "NONE" ? `, ${GAME_ROLE_LABEL[me.gameRole].toLowerCase()}` : ""}</div></div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Состав <span className="muted">{team.members.length}</span></h2></div>
        {error && <p className="error">{error}</p>}
        <ul className="list">
          {team.members.map((m) => (
            <li key={m.user.id}>
              <div className="main person">
                <span className="avatar">{(m.user.displayName ?? m.user.nickname).slice(0, 1).toUpperCase()}</span>
                <div>{m.user.displayName ?? m.user.nickname} <span className={"badge" + (m.role === "CAPTAIN" ? " accent" : "")}>{TEAM_ROLE_LABEL[m.role]}</span></div>
              </div>
              {m.role === "MEMBER" && (isCaptain ? (
                <select value={m.gameRole} onChange={(e) => void setGameRole(m.user.id, e.target.value as GameRole)} style={{ width: "auto", minHeight: 34 }}>
                  {(Object.keys(GAME_ROLE_LABEL) as GameRole[]).map((r) => <option key={r} value={r}>{r === "NONE" ? "без роли" : GAME_ROLE_LABEL[r]}</option>)}
                </select>
              ) : m.gameRole !== "NONE" ? <span className="badge">{GAME_ROLE_LABEL[m.gameRole]}</span> : null)}
            </li>
          ))}
        </ul>
        {isCaptain && <p className="hint">Роли раздаёт капитан: разведчик, пророк, посол, летописец. Одна роль — один человек.</p>}
      </div>
      <div className="card"><p className="muted">Карта команды появится здесь, когда администратор начнёт игру.</p></div>
    </>
  );
}
