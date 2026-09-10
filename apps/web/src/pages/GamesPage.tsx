import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, type GameSummary, type MyTeamDto, TEAM_ROLE_LABEL } from "../lib/api";
import { t } from "../lib/i18n";

const STATUS: Record<string, string> = { DRAFT: "черновик", ACTIVE: "идёт", FINISHED: t("завершена") };

export function GamesPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [myTeams, setMyTeams] = useState<MyTeamDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [teamCount, setTeamCount] = useState(3);
  const [nodeCount, setNodeCount] = useState(250);
  const [equidistant, setEquidistant] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ games: GameSummary[] }>("/api/games").then((r) => { setGames(r.games); if (r.games.length === 0) setShowForm(true); }).catch(() => setGames([]));
    api<{ teams: MyTeamDto[] }>("/api/me/teams").then((r) => setMyTeams(r.teams)).catch(() => setMyTeams([]));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ game: { id: string } }>("/api/games", {
        method: "POST",
        body: JSON.stringify({ name, orgName: orgName || undefined, teamCount, settings: { nodeCount, equidistantStarts: equidistant } }),
      });
      navigate(`/games/${r.game.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Ошибка сети"));
    } finally { setBusy(false); }
  }

  return (
    <>
      {myTeams.length > 0 && (
        <div className="card">
          <h2>{t("Мои команды")}</h2>
          <ul className="list">
            {myTeams.map((t) => (
              <li key={t.team.id}>
                <div className="main person">
                  <span className="avatar" style={{ background: t.team.color, color: "#fff" }}>{t.team.name.slice(0, 1)}</span>
                  <div><Link to={`/games/${t.game.id}/team`}><strong>{t.team.name}</strong></Link><div className="muted">{t.game.name} · {t.game.org.name}</div></div>
                </div>
                <span className="badge">{TEAM_ROLE_LABEL[t.role]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>{t("Мои игры")} <span className="muted">{t("(я администратор)")}</span></h2>
          <button className="secondary sm" onClick={() => setShowForm((v) => !v)}>{showForm ? t("Скрыть") : t("+ Новая игра")}</button>
        </div>
        {games === null ? <p className="muted">{t("Загрузка…")}</p> : games.length === 0 ? <p className="muted">{t("Пока нет игр. Создай первую.")}</p> : (
          <ul className="list">
            {games.map((g) => (
              <li key={g.id}>
                <div className="main"><Link to={`/games/${g.id}`}><strong>{g.name}</strong></Link><div className="muted">{g.org.name} · команд: {g.teamCount}{g.mapSeed == null ? t(" · карта не создана") : ""}</div></div>
                <span className={"badge" + (g.status === "ACTIVE" ? " accent" : "")}>{STATUS[g.status] ?? g.status}</span>
              </li>
            ))}
          </ul>
        )}
        {showForm && (
          <form onSubmit={create} style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: ".5rem" }}>
            <label htmlFor="gname">{t("Название игры")}</label>
            <input id="gname" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} placeholder={t("Например: Земли Слова — осень")} />
            <label htmlFor="org">{t("Церковь / организация")}</label>
            <input id="org" value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={80} placeholder={t("Моя церковь")} />
            <div className="grid cols-2">
              <div><label htmlFor="teams">{t("Команд")}</label><input id="teams" type="number" min={2} max={12} value={teamCount} onChange={(e) => setTeamCount(Number(e.target.value))} /></div>
              <div><label htmlFor="nodes">{t("Узлов на карте")}</label><input id="nodes" type="number" min={150} max={600} step={10} value={nodeCount} onChange={(e) => setNodeCount(Number(e.target.value))} /></div>
            </div>
            <label className="check"><input type="checkbox" checked={equidistant} onChange={(e) => setEquidistant(e.target.checked)} />{t("Равноудалённые старты")}</label>
            <p className="hint">{t("Всё это можно поменять позже, до старта игры.")}</p>
            {error && <p className="error">{error}</p>}
            <div className="actions"><button type="submit" disabled={busy}>{t("Создать игру")}</button></div>
          </form>
        )}
      </div>
    </>
  );
}
