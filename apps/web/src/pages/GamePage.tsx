import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type MapEdgeDto, type MapHexDto, type MapNodeDto } from "../lib/api";
import { AdminMap, type BattleProgress, type CityProgress, type TeamProgress } from "./AdminMap";
import { Timeline, collectMoves, progressAt } from "./Timeline";
import { useGameEvents } from "../lib/useGameEvents";
import { TeamsBlock } from "./TeamsBlock";
import { DeedsBlock } from "./DeedsBlock";
import { StartBlock } from "./StartBlock";
import { SettingsBlock } from "./SettingsBlock";
import { SubmissionsBlock } from "./SubmissionsBlock";
import { BattlesBlock } from "./BattlesBlock";
import { AdminsBlock } from "./AdminsBlock";
import { FinishBlock } from "./FinishBlock";
import { PassagesBlock } from "./Diplomacy";
import { RecipientsBlock } from "./RecipientsBlock";
import { DisputesBlock } from "./DisputesBlock";
import { Icon } from "../components/Icon";
import { PushToggle } from "../components/PushToggle";
import { t } from "../lib/i18n";

interface GameDto { id: string; name: string; status: string; teamCount: number; mapSeed: number | null; settings: { nodeCount?: number; equidistantStarts?: boolean; maxStartDistanceDiff?: number; includeGenealogies?: boolean; donationMin?: number | null; donationCurrency?: string } }
interface Stats { nodeCount: number; cityCount: number; startDistances: number[]; minCityGap: number }
type Tab = "overview" | "teams" | "deeds" | "review" | "settings";
const TABS: Tab[] = ["overview", "teams", "deeds", "review", "settings"];

/**
 * Страница игры для админа: компактная шапка (название, статус, счётчики) и вкладки.
 * Вкладка хранится в hash (#teams), чтобы переживать перезагрузку и ссылки.
 */
export function GamePage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const tab: Tab = (TABS as string[]).includes(location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : "overview";
  const setTab = (next: Tab) => navigate({ hash: next === "overview" ? "" : next }, { replace: true });

  const [game, setGame] = useState<GameDto | null>(null);
  const [hexes, setHexes] = useState<MapHexDto[]>([]);
  const [nodes, setNodes] = useState<MapNodeDto[]>([]);
  const [edges, setEdges] = useState<MapEdgeDto[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [counts, setCounts] = useState({ teams: 0, deeds: 0, submissions: 0, battles: 0, passages: 0, disputes: 0 });
  const [progress, setProgress] = useState<{ teams: TeamProgress[]; startedAt: string | null; cities: CityProgress[]; battles: BattleProgress[] } | null>(null);
  const loadProgress = useCallback(() => api<{ teams: TeamProgress[]; startedAt: string | null; cities: CityProgress[]; battles: BattleProgress[] }>(`/api/games/${id}/progress`).then(setProgress).catch(() => setProgress(null)), [id]);
  /** Ползунок времени: null — «сейчас» (живое состояние), иначе момент, на который показываем карту. */
  const [at, setAt] = useState<Date | null>(null);
  const shown = useMemo(() => (progress && at ? progressAt(progress.teams, at) : progress?.teams ?? null), [progress, at]);
  const moves = useMemo(() => (progress?.startedAt ? collectMoves(progress.teams, progress.cities, progress.startedAt) : []), [progress]);
  const shownCities = useMemo(() => (progress && at ? progress.cities.filter((c) => !c.capturedAt || Date.parse(c.capturedAt) <= at.getTime()) : progress?.cities ?? null), [progress, at]);
  const bump = () => setVersion((v) => v + 1);
  useGameEvents(id, (e) => { if (e.type === "game" || e.type === "map") void load(); if (e.type !== "deeds") void loadProgress(); bump(); });

  const load = useCallback(async () => {
    const r = await api<{ game: GameDto; hexes: MapHexDto[]; nodes: MapNodeDto[]; edges: MapEdgeDto[] }>(`/api/games/${id}`);
    setGame(r.game); setHexes(r.hexes); setNodes(r.nodes); setEdges(r.edges);
  }, [id]);

  /** Счётчики для бейджей на вкладках: что ждёт админа. Лёгкие запросы, обновляются с каждым событием игры. */
  const loadCounts = useCallback(async (active: boolean) => {
    const [teams, deeds, subs, battles, passages, disputes] = await Promise.all([
      api<{ teams: unknown[] }>(`/api/games/${id}/teams`).then((r) => r.teams.length).catch(() => 0),
      api<{ deeds: unknown[] }>(`/api/games/${id}/deeds`).then((r) => r.deeds.length).catch(() => 0),
      active ? api<{ tasks: unknown[] }>(`/api/games/${id}/submissions`).then((r) => r.tasks.length).catch(() => 0) : 0,
      active ? api<{ battles: Array<{ entries: Array<{ status: string }> }> }>(`/api/games/${id}/battles`).then((r) => r.battles.reduce((n, b) => n + b.entries.filter((e) => e.status === "SUBMITTED").length, 0)).catch(() => 0) : 0,
      active ? api<{ passages: Array<{ status: string }> }>(`/api/games/${id}/passages`).then((r) => r.passages.filter((p) => p.status === "PENDING").length).catch(() => 0) : 0,
      active ? api<{ disputes: unknown[] }>(`/api/games/${id}/disputes`).then((r) => r.disputes.length).catch(() => 0) : 0,
    ]);
    setCounts({ teams, deeds, submissions: subs, battles, passages, disputes });
  }, [id]);

  useEffect(() => { load().catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); void loadProgress(); }, [load, loadProgress]);
  useEffect(() => { if (game) void loadCounts(game.status === "ACTIVE"); }, [game?.status, version, loadCounts]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ seed: number; stats: Stats }>(`/api/games/${id}/generate`, { method: "POST", body: JSON.stringify({}) });
      setStats(r.stats);
      await load();
      bump();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("Ошибка сети"));
    } finally { setBusy(false); }
  }

  if (error && !game) return <p className="error">{error}</p>;
  if (!game) return <p className="muted">{t("Загрузка…")}</p>;
  const active = game.status === "ACTIVE";
  const review = counts.submissions + counts.battles + counts.passages + counts.disputes;
  const cities = progress?.cities.filter((c) => c.capturedAt).length ?? 0;

  return (
    <>
      <Link to="/" className="crumb"><Icon name="back" />{t("Мои игры")}</Link>
      <div className="page-head">
        <div>
          <h1>
            {game.name}
            <span className={"pill " + (game.status === "DRAFT" ? "draft" : active ? "live" : "done")}>{game.status === "DRAFT" ? t("черновик") : active ? t("идёт") : t("завершена")}</span>
          </h1>
        </div>
        <div className="stats">
          <span className="stat"><Icon name="users" /><strong>{counts.teams}</strong>/{game.teamCount} {t("команд")}</span>
          <span className="stat"><Icon name="scroll" /><strong>{counts.deeds}</strong> {t("дел")}</span>
          {nodes.length > 0 && <span className="stat"><Icon name="map" /><strong>{nodes.length}</strong> {t("узлов")}</span>}
          {active && <span className="stat"><Icon name="city" /><strong>{cities}</strong> {t("городов взято")}</span>}
        </div>
      </div>

      <div className="tabbar" role="tablist">
        <button role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><Icon name="map" />{t("Обзор")}</button>
        <button role="tab" aria-selected={tab === "teams"} className={tab === "teams" ? "active" : ""} onClick={() => setTab("teams")}><Icon name="users" />{t("Команды")}<span className="n">{counts.teams}</span></button>
        <button role="tab" aria-selected={tab === "deeds"} className={tab === "deeds" ? "active" : ""} onClick={() => setTab("deeds")}><Icon name="scroll" />{t("Дела")}<span className="n">{counts.deeds}</span></button>
        <button role="tab" aria-selected={tab === "review"} className={tab === "review" ? "active" : ""} onClick={() => setTab("review")}><Icon name="check" />{t("Проверка")}{review > 0 && <span className="n hot">{review}</span>}</button>
        <button role="tab" aria-selected={tab === "settings"} className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Icon name="settings" />{t("Настройки")}</button>
      </div>

      {tab === "overview" && (
        <div className="tab-pane" key="overview">
          {game.status === "DRAFT" && (
            <div className="card" data-tone="warn">
              <div className="card-head">
                <h2><span className="ico"><Icon name="play" /></span>{t("Подготовка")}</h2>
                <div className="row">
                  <button className={nodes.length ? "secondary sm" : "sm"} onClick={() => void generate()} disabled={busy}><Icon name="refresh" />{nodes.length ? t("Сгенерировать ещё раз") : t("Сгенерировать карту")}</button>
                </div>
              </div>
              {stats && <p className="muted" style={{ marginTop: 0 }}>{t("узлов {a} · городов {b} · до первого города {c}", { a: stats.nodeCount, b: stats.cityCount, c: stats.startDistances.join(" / ") })}</p>}
              {error && <p className="error">{error}</p>}
              <StartBlock gameId={game.id} status={game.status} version={version} onStarted={() => { void load(); void loadProgress(); }} flat />
            </div>
          )}
          {game.status === "FINISHED" && <FinishBlock gameId={game.id} status={game.status} version={version} onChanged={() => { void load(); void loadProgress(); }} />}
          {hexes.length > 0 ? (
            <div className="card map-card">
              <AdminMap gameId={game.id} hexes={hexes} nodes={nodes} edges={edges} progress={shown} cities={shownCities} battles={at ? [] : progress?.battles ?? null} version={version} />
              {progress?.startedAt && <Timeline moves={moves} startedAt={progress.startedAt} at={at} onChange={setAt} />}
            </div>
          ) : (
            <div className="card"><div className="tab-empty"><Icon name="map" />{t("Карта ещё не сгенерирована. Нажми «Сгенерировать карту».")}</div></div>
          )}
        </div>
      )}

      {tab === "teams" && <div className="tab-pane" key="teams"><TeamsBlock gameId={game.id} teamCount={game.teamCount} status={game.status} version={version} onChange={bump} /></div>}
      {tab === "deeds" && <div className="tab-pane" key="deeds"><DeedsBlock gameId={game.id} version={version} onChange={bump} /><RecipientsBlock gameId={game.id} status={game.status} version={version} /></div>}
      {tab === "review" && (active ? (
        <div className="tab-pane" key="review">
          <SubmissionsBlock gameId={game.id} version={version} onDecided={() => { void loadProgress(); bump(); }} />
          <BattlesBlock gameId={game.id} version={version} onDecided={() => { void loadProgress(); bump(); }} />
          <PassagesBlock gameId={game.id} version={version} />
          <DisputesBlock gameId={game.id} version={version} onDecided={bump} />
        </div>
      ) : (
        <div className="card"><div className="tab-empty"><Icon name="check" />{game.status === "DRAFT" ? t("Сдачи дел и записи испытаний появятся здесь после старта игры.") : t("Игра завершена: проверять больше нечего.")}</div></div>
      ))}
      {tab === "settings" && (
        <div className="tab-pane" key="settings">
          <SettingsBlock key={game.teamCount + ":" + game.name} game={game} onSaved={() => { void load(); bump(); }} />
          <AdminsBlock gameId={game.id} version={version} />
          <div className="card"><PushToggle compact /></div>
          {game.status !== "DRAFT" && <FinishBlock gameId={game.id} status={game.status} version={version} onChanged={() => { void load(); void loadProgress(); }} />}
        </div>
      )}
    </>
  );
}
