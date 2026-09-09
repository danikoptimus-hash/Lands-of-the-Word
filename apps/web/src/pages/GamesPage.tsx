import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, type GameSummary } from "../lib/api";

export function GamesPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [teamCount, setTeamCount] = useState(3);
  const [nodeCount, setNodeCount] = useState(250);
  const [equidistant, setEquidistant] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<{ games: GameSummary[] }>("/api/games").then((r) => setGames(r.games)).catch(() => setGames([])); }, []);

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
      setError(err instanceof ApiError ? err.message : "Ошибка сети");
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="card">
        <h2>Новая игра</h2>
        <form onSubmit={create}>
          <label htmlFor="gname">Название игры</label>
          <input id="gname" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} placeholder="Например: Земли Слова — осень" />
          <label htmlFor="org">Церковь / организация</label>
          <input id="org" value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={80} placeholder="Моя церковь" />
          <div className="row">
            <div style={{ flex: 1 }}>
              <label htmlFor="teams">Команд</label>
              <input id="teams" type="number" min={2} max={12} value={teamCount} onChange={(e) => setTeamCount(Number(e.target.value))} />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="nodes">Узлов на карте</label>
              <input id="nodes" type="number" min={150} max={600} step={10} value={nodeCount} onChange={(e) => setNodeCount(Number(e.target.value))} />
            </div>
          </div>
          <label><input type="checkbox" checked={equidistant} onChange={(e) => setEquidistant(e.target.checked)} style={{ width: "auto", marginRight: 8 }} />Равноудалённые старты</label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy} style={{ marginTop: "1rem" }}>Создать и перейти к карте</button>
        </form>
      </div>

      <div className="card">
        <h2>Мои игры</h2>
        {games === null ? <p className="muted">Загрузка…</p> : games.length === 0 ? <p className="muted">Пока нет игр.</p> : (
          <ul className="list">
            {games.map((g) => (
              <li key={g.id}>
                <span><Link to={`/games/${g.id}`}>{g.name}</Link> <span className="muted">· {g.org.name} · команд: {g.teamCount}</span></span>
                <span className="muted">{g.status === "DRAFT" ? "черновик" : g.status === "ACTIVE" ? "идёт" : "завершена"}{g.mapSeed == null ? " · карта не создана" : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
