import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api, type GameSummary, type MyTeamDto } from "../lib/api";
import { t } from "../lib/i18n";
import { plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip, type ChipTone } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { warmMapImages } from "./MapLayers";

/** Пилюля статуса игры: черновик — warn, идёт — ok, завершена — нейтральная. Считается при рендере, чтобы язык менялся. */
function StatusChip({ status }: { status: string }) {
  const map: Record<string, [ChipTone, string]> = { DRAFT: ["warn", t("черновик")], ACTIVE: ["ok", t("идёт")], FINISHED: ["neutral", t("завершена")] };
  const [tone, label] = map[status] ?? ["neutral", status];
  return <Chip tone={tone}>{label}</Chip>;
}

function HomeSkeleton() {
  return (
    <section className="home-section" aria-busy="true">
      <h2><span className="ico"><Icon name="users" /></span>{t("Мои команды")}</h2>
      <div className="cards">
        {[0, 1].map((i) => (
          <div key={i} className="home-card team-card"><span className="skeleton skeleton-avatar" /><div className="main"><LoadingState rows={2} /></div></div>
        ))}
      </div>
    </section>
  );
}

/**
 * Главная. Игрок с одной командой и без своих игр сразу попадает на карту. Иначе — «Мои команды» и,
 * только если есть свои игры, «Мои игры»; создание игры — отдельная страница.
 */
export function GamesPage() {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [teams, setTeams] = useState<MyTeamDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => { warmMapImages(); }, []);
  useEffect(() => {
    let alive = true;
    setFailed(false); setGames(null); setTeams(null);
    Promise.all([
      api<{ games: GameSummary[] }>("/api/games").then((r) => r.games),
      api<{ teams: MyTeamDto[] }>("/api/me/teams").then((r) => r.teams),
    ]).then(([g, tm]) => { if (alive) { setGames(g); setTeams(tm); } }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [attempt]);

  if (failed) return <ErrorState onRetry={() => setAttempt((n) => n + 1)} />;
  if (!games || !teams) return <HomeSkeleton />;
  if (teams.length === 1 && games.length === 0) return <Navigate to={`/games/${teams[0]!.game.id}/team`} replace />;

  return (
    <>
      {teams.length > 0 && (
        <section className="home-section">
          <h2><span className="ico"><Icon name="users" /></span>{t("Мои команды")}</h2>
          <div className="cards">
            {teams.map((tm) => (
              <Link key={tm.team.id} to={`/games/${tm.game.id}/team`} className="home-card team-card">
                <TeamAvatar name={tm.team.name} color={tm.team.color} size="lg" />
                <div className="main">
                  <div className="title"><span className="name">{tm.team.name}</span>{tm.role === "CAPTAIN" && <Chip icon="star">{t("капитан")}</Chip>}<StatusChip status={tm.game.status} /></div>
                  <div className="meta"><span>{tm.game.name} · {tm.game.org.name}</span></div>
                </div>
                <div className="side"><Icon name="chevron" /></div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {games.length > 0 && (
        <section className="home-section">
          <h2><span className="ico"><Icon name="crown" /></span>{t("Мои игры")}</h2>
          <div className="cards">
            {games.map((g) => (
              <Link key={g.id} to={`/games/${g.id}`} className="home-card game-card">
                <div className="title"><span className="name">{g.name}</span><StatusChip status={g.status} /></div>
                <div className="meta">
                  <span><Icon name="home" />{g.org.name}</span>
                  <span><Icon name="users" />{plural(g.teamCount, ["команда", "команды", "команд"])}</span>
                  {g.status === "DRAFT" && g.mapSeed == null && <span><Icon name="map" />{t("карта не создана")}</span>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {teams.length === 0 && games.length === 0 && (
        <EmptyState icon="users" text={t("Вас ещё не пригласили в команду. Попросите у капитана ссылку-приглашение.")} />
      )}

      <div className="home-foot"><Link to="/games/new" className="btn ghost"><Icon name="plus" />{t("Создать игру")}</Link></div>
    </>
  );
}
