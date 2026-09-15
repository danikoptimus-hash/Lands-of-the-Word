import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type MapEdgeDto, type MapHexDto, type MapNodeDto } from "../lib/api";
import { AdminMap, type BattleProgress, type CityProgress, type TeamProgress } from "./AdminMap";
import { Timeline, collectMoves, progressAt } from "./Timeline";
import { useGameEvents } from "../lib/useGameEvents";
import { TeamsBlock } from "./TeamsBlock";
import { DeedsBlock } from "./DeedsBlock";
import { StartBlock, type MapStats } from "./StartBlock";
import { SettingsBlock } from "./SettingsBlock";
import { SubmissionsBlock } from "./SubmissionsBlock";
import { BattlesBlock } from "./BattlesBlock";
import { AdminsBlock } from "./AdminsBlock";
import { FinishBlock } from "./FinishBlock";
import { PassagesBlock } from "./Diplomacy";
import { RecipientsBlock } from "./RecipientsBlock";
import { Icon } from "../components/Icon";
import { Back } from "../components/Back";
import { Chip } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { PushToggle } from "../components/PushToggle";
import { ActionMenu } from "../components/ActionMenu";
import { useAuth } from "../lib/auth";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";

interface GameDto { id: string; name: string; createdById?: string; status: string; teamCount: number; mapSeed: number | null; settings: { nodeCount?: number; equidistantStarts?: boolean; maxStartDistanceDiff?: number; includeGenealogies?: boolean; donationMin?: number | null; donationCurrency?: string } }
type Tab = "overview" | "map" | "teams" | "deeds" | "review" | "settings";
const TABS: Tab[] = ["overview", "map", "teams", "deeds", "review", "settings"];
type Progress = { teams: TeamProgress[]; startedAt: string | null; cities: CityProgress[]; battles: BattleProgress[] };

/**
 * Страница игры для администратора: карта во весь экран, разделы (обзор, команды, дела, проверка, настройки) —
 * кнопки сбоку (на телефоне — снизу), содержимое раздела открывается попапом над картой (решение владельца 15.09).
 * Раздел хранится в hash (#teams), чтобы переживать перезагрузку и ссылки.
 */
export function GamePage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { confirm, notify } = useUi();
  // Экран — карта во весь экран (решение владельца 15.09); раздел из hash (#teams) открывается попапом над картой.
  const tab: Tab = (TABS as string[]).includes(location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : "map";
  const setTab = (next: Tab) => navigate({ hash: next === "map" ? "" : next }, { replace: true });
  const [screenEl, setScreenEl] = useState<HTMLDivElement | null>(null);

  const [game, setGame] = useState<GameDto | null>(null);
  const [hexes, setHexes] = useState<MapHexDto[]>([]);
  const [nodes, setNodes] = useState<MapNodeDto[]>([]);
  const [edges, setEdges] = useState<MapEdgeDto[]>([]);
  const [stats, setStats] = useState<MapStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [counts, setCounts] = useState({ teams: 0, deeds: 0, submissions: 0, battles: 0, recipients: 0 });
  const [progress, setProgress] = useState<Progress | null>(null);
  const loadProgress = useCallback(() => api<Progress>(`/api/games/${id}/progress`).then(setProgress).catch(() => setProgress(null)), [id]);
  /** Ползунок времени: null — «сейчас» (живое состояние), иначе момент, на который показываем карту. */
  const [at, setAt] = useState<Date | null>(null);
  const shown = useMemo(() => (progress && at ? progressAt(progress.teams, at) : progress?.teams ?? null), [progress, at]);
  const moves = useMemo(() => (progress?.startedAt ? collectMoves(progress.teams, progress.cities, progress.startedAt) : []), [progress]);
  const shownCities = useMemo(() => (progress && at ? progress.cities.filter((c) => !c.capturedAt || Date.parse(c.capturedAt) <= at.getTime()) : progress?.cities ?? null), [progress, at]);
  const bump = () => setVersion((v) => v + 1);
  useGameEvents(id, (e) => { if (e.type === "game" || e.type === "map") void load(); if (e.type !== "deeds") void loadProgress(); bump(); });
  const recipientsRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await api<{ game: GameDto; hexes: MapHexDto[]; nodes: MapNodeDto[]; edges: MapEdgeDto[] }>(`/api/games/${id}`);
    setGame(r.game); setHexes(r.hexes); setNodes(r.nodes); setEdges(r.edges);
    setError(null);
  }, [id]);

  /** Счётчики для вкладок и чек-листа: что ждёт администратора. Лёгкие запросы, обновляются с каждым событием игры. */
  const loadCounts = useCallback(async (status: string) => {
    const active = status === "ACTIVE";
    const [teams, deeds, submissions, battles, recipients] = await Promise.all([
      api<{ teams: unknown[] }>(`/api/games/${id}/teams`).then((r) => r.teams.length).catch(() => 0),
      api<{ deeds: unknown[] }>(`/api/games/${id}/deeds`).then((r) => r.deeds.length).catch(() => 0),
      active ? api<{ tasks: unknown[] }>(`/api/games/${id}/submissions`).then((r) => r.tasks.length).catch(() => 0) : 0,
      active ? api<{ battles: Array<{ entries: Array<{ status: string }> }> }>(`/api/games/${id}/battles`).then((r) => r.battles.reduce((n, b) => n + b.entries.filter((e) => e.status === "SUBMITTED").length, 0)).catch(() => 0) : 0,
      status !== "FINISHED" ? api<{ recipients: unknown[] }>(`/api/games/${id}/recipients`).then((r) => r.recipients.length).catch(() => 0) : 0,
    ]);
    setCounts({ teams, deeds, submissions, battles, recipients });
  }, [id]);

  const loadAll = useCallback(() => { load().catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); void loadProgress(); }, [load, loadProgress]);
  useEffect(() => { loadAll(); }, [loadAll]);
  // Черновик без карты: сразу показать чек-лист подготовки (обзор), карту всё равно ещё смотреть не на что.
  const autoOpened = useRef(false);
  useEffect(() => { if (game && game.status === "DRAFT" && hexes.length === 0 && !autoOpened.current && !location.hash) { autoOpened.current = true; setTab("overview"); } }, [game, hexes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (game) void loadCounts(game.status); }, [game?.status, version, loadCounts]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    if (nodes.length > 0 && !(await confirm(t("Города и старты будут расставлены заново."), { title: t("Сгенерировать карту заново?"), okLabel: t("Сгенерировать") }))) return;
    setBusy(true); setGenError(null);
    try {
      const r = await api<{ seed: number; stats: MapStats }>(`/api/games/${id}/generate`, { method: "POST", body: JSON.stringify({}) });
      setStats(r.stats);
      await load();
      bump();
      notify(t("Карта готова"));
    } catch (e) {
      setGenError(e instanceof ApiError ? e.message : t("Ошибка сети"));
    } finally { setBusy(false); }
  }

  const { user } = useAuth();
  const canDelete = Boolean(game) && game!.status !== "ACTIVE" && (game!.createdById === user?.id || user?.platformRole === "SUPERADMIN");
  async function removeGame() {
    if (!game) return;
    const what = game.status === "DRAFT" ? t("Черновик «{name}» будет удалён вместе с командами и картой.", { name: game.name }) : t("Игра «{name}» будет удалена без возможности восстановления: карта, команды, дела, история ходов.", { name: game.name });
    if (!(await confirm(what, { title: t("Удалить игру?"), okLabel: t("Удалить"), danger: true }))) return;
    try { await api(`/api/games/${game.id}`, { method: "DELETE" }); notify(t("Игра удалена")); navigate("/", { replace: true }); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }

  if (error && !game) return <><Back to="/" label={t("Мои игры")} /><div className="card"><ErrorState text={error} onRetry={loadAll} /></div></>;
  if (!game) return <><Back to="/" label={t("Мои игры")} /><div className="card"><LoadingState /></div></>;
  const active = game.status === "ACTIVE";
  const draft = game.status === "DRAFT";
  const reviewCount = counts.submissions + counts.battles;
  const trials = progress?.battles.length ?? 0;
  const hasMap = hexes.length > 0;
  const refresh = () => { void load(); void loadProgress(); };

  const sections: Array<{ key: Tab; label: string; icon: string; count?: number; hot?: boolean }> = [
    { key: "overview", label: t("Обзор"), icon: "crown" },
    { key: "teams", label: t("Команды"), icon: "users", count: counts.teams },
    { key: "deeds", label: t("Дела"), icon: "scroll", count: counts.deeds },
    { key: "review", label: t("Проверка"), icon: "check", count: reviewCount, hot: true },
    { key: "settings", label: t("Настройки"), icon: "settings" },
  ];
  const open = tab === "map" ? null : tab;
  const closePopup = () => setTab("map");
  const titleOf = sections.find((s) => s.key === open);

  return (
    <div className="admin-screen" ref={setScreenEl}>
      <div className="admin-map-area">
        {hasMap ? (
          <AdminMap fullscreen gameId={game.id} hexes={hexes} nodes={nodes} edges={edges} progress={shown} cities={shownCities} battles={at ? [] : progress?.battles ?? null} version={version} onReview={() => setTab("review")} />
        ) : (
          <div className="admin-empty">
            <div className="card">
              <EmptyState icon="map" text={draft ? t("Карта ещё не создана.") : t("Карты нет.")} action={draft ? <button type="button" onClick={() => void generate()} disabled={busy}><Icon name="refresh" />{t("Сгенерировать карту")}</button> : undefined} />
              {genError && <p className="error">{genError}</p>}
            </div>
          </div>
        )}
        {hasMap && progress?.startedAt && <div className="admin-timeline"><Timeline moves={moves} startedAt={progress.startedAt} at={at} onChange={setAt} /></div>}
      </div>

      <div className="admin-top">
        <Link to="/" className="btn secondary icon hud-btn" aria-label={t("Мои игры")} title={t("Мои игры")}><Icon name="back" /></Link>
        <div className="admin-title" title={game.name}>
          <span className="name">{game.name}</span>
          <Chip tone={draft ? "warn" : active ? "ok" : "neutral"}>{draft ? t("черновик") : active ? t("идёт") : t("завершена")}</Chip>
        </div>
        {canDelete && <ActionMenu label={t("Ещё")} items={[{ label: t("Удалить игру"), icon: "trash", danger: true, onSelect: () => void removeGame() }]} />}
      </div>

      <nav className="admin-dock" aria-label={t("Разделы игры")}>
        {sections.map((s) => (
          <button key={s.key} type="button" className={"dock-btn" + (open === s.key ? " on" : "")} aria-pressed={open === s.key} onClick={() => setTab(open === s.key ? "map" : s.key)}>
            <Icon name={s.icon} />
            <span className="lbl">{s.label}</span>
            {s.count ? <span className={"badge" + (s.hot ? " hot" : "")}>{s.count}</span> : null}
          </button>
        ))}
      </nav>

      {open && screenEl && (
        <Sheet size="lg" container={screenEl} className="admin-popup" onClose={closePopup} head={<h2 className="row"><span className="ico"><Icon name={titleOf?.icon ?? "map"} /></span>{titleOf?.label}</h2>}>
          {open === "overview" && (
            <div key="overview">
              {draft && (
                <>
                  <StartBlock
                    gameId={game.id} version={version} onStarted={refresh}
                    hasMap={hasMap} nodeCount={nodes.length} cityCount={nodes.filter((n) => n.kind === "CITY").length} stats={stats}
                    onGenerate={() => void generate()} generating={busy} generateError={genError}
                    teams={counts.teams} teamCount={game.teamCount} deeds={counts.deeds} recipients={counts.recipients}
                    goTo={setTab} goToRecipients={() => recipientsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  />
                  <div ref={recipientsRef}><RecipientsBlock gameId={game.id} status={game.status} version={version} /></div>
                </>
              )}
              {active && (
                <>
                  <div className="card">
                    <div className="card-head"><h2><span className="ico"><Icon name="check" /></span>{t("Сейчас")}</h2></div>
                    <div className="summary-tiles">
                      <a href="#review" onClick={(e) => { e.preventDefault(); setTab("review"); }}>
                        <span className={"sum-value" + (reviewCount ? " hot" : "")}>{reviewCount}</span>
                        <span className="sum-label"><Icon name="check" />{t("ждёт проверки")}</span>
                      </a>
                      <a href="#review" onClick={(e) => { e.preventDefault(); setTab("review"); }}>
                        <span className="sum-value">{trials}</span>
                        <span className="sum-label"><Icon name="wave" />{t("идёт испытаний")}</span>
                      </a>
                    </div>
                  </div>
                  <FinishBlock gameId={game.id} status={game.status} version={version} onChanged={refresh} part="rest" between={<RecipientsBlock gameId={game.id} status={game.status} version={version} />} />
                </>
              )}
              {game.status === "FINISHED" && <FinishBlock gameId={game.id} status={game.status} version={version} onChanged={refresh} />}
            </div>
          )}
          {open === "teams" && <div key="teams">{active && <FinishBlock gameId={game.id} status={game.status} version={version} onChanged={refresh} part="standings" />}<TeamsBlock gameId={game.id} teamCount={game.teamCount} status={game.status} version={version} onChange={bump} goToSettings={() => setTab("settings")} /></div>}
          {open === "deeds" && <div key="deeds"><DeedsBlock gameId={game.id} version={version} onChange={bump} /></div>}
          {open === "review" && (active ? (
            <div key="review">
              <SubmissionsBlock gameId={game.id} version={version} currency={game.settings.donationCurrency} onDecided={() => { void loadProgress(); bump(); }} />
              <BattlesBlock gameId={game.id} version={version} onDecided={() => { void loadProgress(); bump(); }} />
              <PassagesBlock gameId={game.id} version={version} />
            </div>
          ) : (
            <div className="card"><EmptyState icon="check" text={draft ? t("Появится после старта игры.") : t("Игра завершена: проверять больше нечего.")} /></div>
          ))}
          {open === "settings" && (
            <div key="settings">
              <SettingsBlock key={game.teamCount + ":" + game.name} game={game} onSaved={() => { void load(); bump(); }} />
              <AdminsBlock gameId={game.id} version={version} />
              <PushToggle compact />
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
