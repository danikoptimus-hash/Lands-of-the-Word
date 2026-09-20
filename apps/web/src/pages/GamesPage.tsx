import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { reportPage } from "../lib/perf";
import { api, ApiError, type GameSummary, type MyTeamDto } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUi } from "../lib/ui";
import { ActionMenu } from "../components/ActionMenu";
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
 * Главная. Игрок с одной командой и без своих игр при входе сразу попадает на карту. Иначе — «Мои команды» и,
 * только если есть свои игры, «Мои игры»; создание игры — отдельная страница.
 */
export function GamesPage() {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [teams, setTeams] = useState<MyTeamDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { reportPage("other"); }, []);
  const [attempt, setAttempt] = useState(0);
  // Автопереход на карту — только при входе на сайт (первая запись истории). Если человек сам пришёл
  // на главную с карты («Мои игры»), показываем её: иначе игрок с одной командой и без своих игр
  // никогда не добрался бы до «Создать игру».
  const entry = useLocation().key === "default";
  const { user } = useAuth();
  const { confirm, notify } = useUi();

  /** Удаление из списка: те же права и тексты, что на странице игры; после удаления карточка просто исчезает. */
  const canDelete = (g: GameSummary) => g.status !== "ACTIVE" && (g.createdById === user?.id || user?.platformRole === "SUPERADMIN");
  async function removeGame(g: GameSummary) {
    const what = g.status === "DRAFT" ? t("Черновик «{name}» будет удалён вместе с командами и картой.", { name: g.name }) : t("Игра «{name}» будет удалена без возможности восстановления: карта, команды, дела, история ходов.", { name: g.name });
    if (!(await confirm(what, { title: t("Удалить игру?"), okLabel: t("Удалить"), danger: true }))) return;
    try { await api(`/api/games/${g.id}`, { method: "DELETE" }); notify(t("Игра удалена")); setGames((list) => list?.filter((x) => x.id !== g.id) ?? list); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }

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
  if (entry && teams.length === 1 && games.length === 0) return <Navigate to={`/games/${teams[0]!.game.id}/team`} replace />;

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
              <div key={g.id} className={"home-card game-card" + (canDelete(g) ? " has-menu" : "")}>
                <Link to={`/games/${g.id}`} className="card-link">
                  <div className="title"><span className="name">{g.name}</span><StatusChip status={g.status} /></div>
                  <div className="meta">
                    <span><Icon name="home" />{g.org.name}</span>
                    <span><Icon name="users" />{plural(g.teamCount, ["команда", "команды", "команд"])}</span>
                    {g.status === "DRAFT" && g.mapSeed == null && <span><Icon name="map" />{t("карта не создана")}</span>}
                  </div>
                </Link>
                {canDelete(g) && (
                  <div className="card-menu">
                    <ActionMenu label={t("Ещё")} items={[{ label: t("Удалить игру"), icon: "trash", danger: true, onSelect: () => void removeGame(g) }]} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {teams.length === 0 && games.length === 0 && (
        <EmptyState icon="users" text={t("Вас ещё не пригласили в команду. Попросите у капитана ссылку-приглашение.")} />
      )}

      <div className="home-foot"><Link to="/how-to-play" className="btn ghost"><Icon name="help" />{t("Как играть?")}</Link><Link to="/whats-new" className="btn ghost"><Icon name="sparkle" />{t("Что нового")}</Link><Link to="/games/new" className="btn ghost"><Icon name="plus" />{t("Создать игру")}</Link></div>
    </>
  );
}
