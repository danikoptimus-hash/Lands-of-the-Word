import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
import { t } from "../lib/i18n";

interface GameDto { id: string; name: string; status: string; teamCount: number; mapSeed: number | null; settings: { nodeCount?: number; equidistantStarts?: boolean; maxStartDistanceDiff?: number; includeGenealogies?: boolean; donationMin?: number | null; donationCurrency?: string } }
interface Stats { nodeCount: number; cityCount: number; startDistances: number[]; minCityGap: number }


export function GamePage() {
  const { id = "" } = useParams();
  const [game, setGame] = useState<GameDto | null>(null);
  const [hexes, setHexes] = useState<MapHexDto[]>([]);
  const [nodes, setNodes] = useState<MapNodeDto[]>([]);
  const [edges, setEdges] = useState<MapEdgeDto[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
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

  useEffect(() => { load().catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); void loadProgress(); }, [load, loadProgress]);

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

  return (
    <>
      <p><Link to="/">{t("← Мои игры")}</Link></p>
      <div className="card">
        <div className="card-head">
          <div><h1>{game.name}</h1><div className="muted">{t("Команд: {n}", { n: game.teamCount })}</div></div>
          <span className={"badge" + (game.status === "ACTIVE" ? " accent" : "")}>{game.status === "DRAFT" ? t("черновик") : game.status === "ACTIVE" ? t("идёт") : t("завершена")}</span>
        </div>
        {game.status === "DRAFT" && (
          <div className="row">
            <button onClick={() => void generate()} disabled={busy}>{nodes.length ? t("Сгенерировать ещё раз") : t("Сгенерировать карту")}</button>
            {stats && <span className="muted">{t("узлов {a} · городов {b} · до первого города {c}", { a: stats.nodeCount, b: stats.cityCount, c: stats.startDistances.join(" / ") })}</span>}
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <SettingsBlock key={game.teamCount + ":" + game.name} game={game} onSaved={() => { void load(); bump(); }} />
      <AdminsBlock gameId={game.id} version={version} />
      <FinishBlock gameId={game.id} status={game.status} version={version} onChanged={() => { void load(); void loadProgress(); }} />
      {game.status === "ACTIVE" && <SubmissionsBlock gameId={game.id} version={version} onDecided={() => void loadProgress()} />}
      {game.status === "ACTIVE" && <BattlesBlock gameId={game.id} version={version} onDecided={() => void loadProgress()} />}
      {game.status === "ACTIVE" && <PassagesBlock gameId={game.id} version={version} />}
      <StartBlock gameId={game.id} status={game.status} version={version} onStarted={() => { void load(); void loadProgress(); }} />
      <TeamsBlock gameId={game.id} teamCount={game.teamCount} status={game.status} version={version} onChange={bump} />
      <DeedsBlock gameId={game.id} version={version} onChange={bump} />

      {hexes.length > 0 ? (
        <div className="card">
          <div className="card-head"><h2>{t("Карта (вид админа)")}</h2><span className="muted">{t("Города и развилки — на перекрёстках, ходят по сторонам гексов. Тяни, колесо или щипок — масштаб.")}</span></div>
          <AdminMap gameId={game.id} hexes={hexes} nodes={nodes} edges={edges} progress={shown} cities={shownCities} battles={at ? [] : progress?.battles ?? null} version={version} />
          {progress?.startedAt && <Timeline moves={moves} startedAt={progress.startedAt} at={at} onChange={setAt} />}
          <p className="hint">{t("Служебный вид. Игровое оформление с иллюстрациями будет отдельно.")}</p>
        </div>
      ) : <div className="card"><p className="muted">{t("Карта ещё не сгенерирована. Нажми «Сгенерировать карту».")}</p></div>}
    </>
  );
}
