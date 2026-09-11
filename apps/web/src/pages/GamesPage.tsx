import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, type GameSummary, type MyTeamDto, TEAM_ROLE_LABEL } from "../lib/api";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";

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
    // Форму создания раскрываем только новичку без игр и без команд: игроку она не нужна.
    Promise.all([
      api<{ games: GameSummary[] }>("/api/games").then((r) => r.games).catch(() => [] as GameSummary[]),
      api<{ teams: MyTeamDto[] }>("/api/me/teams").then((r) => r.teams).catch(() => [] as MyTeamDto[]),
    ]).then(([g, tms]) => { setGames(g); setMyTeams(tms); if (g.length === 0 && tms.length === 0) setShowForm(true); });
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
        <div className="card" data-tone="accent">
          <h2><span className="ico"><Icon name="flag" /></span>{t("Мои команды")}</h2>
          <div className="cards">
            {myTeams.map((tm) => (
              <Link key={tm.team.id} to={`/games/${tm.game.id}/team`} className="team-card">
                <span className="avatar" style={{ background: tm.team.color, color: "#fff" }}>{tm.team.name.slice(0, 1)}</span>
                <div style={{ minWidth: 0 }}><strong>{tm.team.name}</strong> <span className="badge">{TEAM_ROLE_LABEL[tm.role]}</span><div className="muted">{tm.game.name} · {tm.game.org.name}</div></div>
                <span className="go"><span>{t("На карту")}</span><Icon name="chevron" /></span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="card" data-tone="plum">
        <div className="card-head">
          <h2><span className="ico"><Icon name="settings" /></span>{t("Мои игры")} <span className="muted">{t("(я администратор)")}</span></h2>
          <button className={showForm ? "secondary sm" : "sm"} onClick={() => setShowForm((v) => !v)}><Icon name={showForm ? "x" : "plus"} />{showForm ? t("Скрыть") : t("Новая игра")}</button>
        </div>
        {games === null ? <p className="muted">{t("Загрузка…")}</p> : games.length === 0 ? <p className="muted">{t("Игр пока нет. Самое время начать первую.")}</p> : (
          <div className="cards">
            {games.map((g) => (
              <Link key={g.id} to={`/games/${g.id}`} className="game-card" style={{ ["--tone" as string]: g.status === "ACTIVE" ? "var(--success)" : g.status === "DRAFT" ? "var(--warn)" : "var(--border-strong)" }}>
                <div className="name"><span>{g.name}</span><span className={"pill " + (g.status === "DRAFT" ? "draft" : g.status === "ACTIVE" ? "live" : "done")}>{STATUS[g.status] ?? g.status}</span></div>
                <div className="meta">
                  <span className="stat"><Icon name="home" />{g.org.name}</span>
                  <span className="stat"><Icon name="users" /><strong>{g.teamCount}</strong> {t("команд")}</span>
                  {g.mapSeed == null && <span className="stat"><Icon name="map" />{t("карта не создана")}</span>}
                </div>
              </Link>
            ))}
          </div>
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
