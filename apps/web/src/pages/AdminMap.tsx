import { useCallback, useEffect, useMemo, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { HEX_SIZE, fieldBounds, hexCenter, nodePos, TEAM_COLORS } from "../lib/hexmap";
import { CoastOver, IslandLabel, islandGeometry, HexTiles, IMG, OutlineDefs, SeaLayer, WorldSvg, useCoast } from "./MapLayers";
import { useViewport } from "../lib/useViewport";
import { reportPage } from "../lib/perf";
import { api, ApiError, type AdminCityDto, type MapEdgeDto, type MapHexDto, type MapNodeDto, type MyMapDto } from "../lib/api";
import { TeamMap } from "./TeamMap";
import { useUi } from "../lib/ui";
import { useAuth } from "../lib/auth";
import { t } from "../lib/i18n";
import { plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { FaunaLayer } from "./Fauna";
import { LakesLayer } from "./Lakes";
import { IsletsLayer, useIslets } from "./Islets";
import { useSeabed } from "./Seabed";
import { Sheet } from "../components/Sheet";
import { TeamAvatar } from "../components/TeamAvatar";
import { EmptyState, ErrorState, LoadingState } from "../components/State";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
export interface CityProgress { teamId: string; nodeKey: string; orderSolved: boolean; done: number; capturedAt: string | null; isCapital: boolean }
export interface BattleProgress { id: string; nodeKey: string; status: string; attackerId: string; defenderId: string; bid: number }
export interface TeamProgress { id: string; name: string; color: string; startNodeKey: string | null; revealed: string[]; revealedAt?: string[]; traversed: Array<{ fromKey: string; toKey: string; at?: string }> }
type TeamLite = { id: string; name: string; color: string };

/**
 * Карта администратора: вся карта без тумана, города на перекрёстках, пройденные стороны цветами команд (половинками, если прошли двое).
 * Панель перекрёстка — Sheet поверх карты; тестовые действия свёрнуты внутри неё.
 */
export function AdminMap({ gameId, hexes, nodes, edges, progress, cities, battles, version, onReview, fullscreen = false }: { /** Во весь экран (страница игры): карта заполняет контейнер, переключатель «чьими глазами» и легенда — поверх. */ fullscreen?: boolean; gameId: string; hexes: MapHexDto[]; nodes: MapNodeDto[]; edges: MapEdgeDto[]; progress: TeamProgress[] | null; cities: CityProgress[] | null; battles: BattleProgress[] | null; version: number; onReview?: () => void }) {
  const size = HEX_SIZE;
  const bounds = useMemo(() => (hexes.length ? fieldBounds(hexes, size) : null), [hexes, size]);
  const vp = useViewport(bounds);
  const [selected, setSelected] = useState<MapNodeDto | null>(null);
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const close = useCallback(() => setSelected(null), []);
  const positions = useMemo(() => new Map(nodes.map((n) => [n.key, nodePos(n.key, size)])), [nodes, size]);
  const traversedBy = useMemo(() => {
    const m = new Map<string, TeamProgress[]>();
    for (const tm of progress ?? []) for (const e of tm.traversed) { const k = [e.fromKey, e.toKey].sort().join("|"); m.set(k, [...(m.get(k) ?? []), tm]); }
    return m;
  }, [progress]);
  const teamById = useMemo(() => new Map((progress ?? []).map((tm) => [tm.id, tm])), [progress]);
  const ownerOf = useMemo(() => {
    const m = new Map<string, TeamProgress>();
    for (const c of cities ?? []) if (c.capturedAt) { const tm = teamById.get(c.teamId); if (tm) m.set(c.nodeKey, tm); }
    return m;
  }, [cities, teamById]);
  const battleAt = useMemo(() => new Map((battles ?? []).map((b) => [b.nodeKey, b])), [battles]);
  const revealedBy = useMemo(() => {
    const m = new Map<string, TeamProgress[]>();
    for (const tm of progress ?? []) for (const k of tm.revealed) m.set(k, [...(m.get(k) ?? []), tm]);
    return m;
  }, [progress]);
  useEffect(() => { reportPage("admin-map"); }, []);
  const coast = useCoast(hexes, size);
  const islets = useIslets(hexes, size, bounds);
  const bed = useSeabed(hexes, islets, size, bounds);
  const [liveWater, setLiveWater] = useState(true);
  const edgeSet = useMemo(() => new Set(edges.map((e) => [e.aKey, e.bKey].sort().join("|"))), [edges]);
  const islandCenters = useMemo(() => islandGeometry(hexes, size), [hexes, size]);
  // «Глазами команды»: карта, какой её видит выбранная команда; обновляется вместе с остальным по событиям игры.
  const [viewAs, setViewAs] = useState<string | null>(null);
  const [teamView, setTeamView] = useState<{ teamId: string; map: (MyMapDto & { teamIndex: number }) | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!viewAs) { setTeamView(null); return; }
    let alive = true;
    setTeamView((prev) => (prev?.teamId === viewAs ? prev : { teamId: viewAs, map: null, error: null }));
    api<MyMapDto & { teamIndex: number }>(`/api/games/${gameId}/teams/${viewAs}/map`)
      .then((m) => { if (alive) setTeamView({ teamId: viewAs, map: m, error: null }); })
      .catch((e) => { if (alive) setTeamView({ teamId: viewAs, map: null, error: e instanceof ApiError ? e.message : t("Ошибка сети") }); });
    return () => { alive = false; };
  }, [viewAs, gameId, version]);
  if (!bounds) return null;
  const viewedTeam = viewAs ? teamById.get(viewAs) : null;
  const legend = (
        <details className="legend">
          <summary><Icon name="info" />{t("Обозначения")}<Icon name="chevron-down" /></summary>
          <div className="items">
            {progress?.map((tm) => <span key={tm.id}><i className="sw dot" style={{ ["--c" as string]: tm.color }} />{tm.name}</span>)}
            <span><i className="sw line" />{t("пройденная сторона")}</span>
            <span><i className="sw spot" />{t("открытый перекрёсток")}</span>
            <span><i className="sw ring" />{t("город с владельцем")}</span>
            <span><i className="sw ring bad" />{t("идёт испытание")}</span>
          </div>
        </details>
  );

  return (
    <>
      <div className={"admin-map" + (fullscreen ? " full" : "")} ref={setWrapEl}>
        {progress && progress.length > 0 && (
          <div className="view-as" role="tablist" aria-label={t("Чьими глазами")}>
            <button type="button" role="tab" aria-selected={!viewAs} className={"chip-btn" + (!viewAs ? " on" : "")} onClick={() => setViewAs(null)}><Icon name="crown" />{t("Администратор")}</button>
            {progress.map((tm) => (
              <button key={tm.id} type="button" role="tab" aria-selected={viewAs === tm.id} className={"chip-btn" + (viewAs === tm.id ? " on" : "")} onClick={() => setViewAs(tm.id)}>
                <TeamAvatar name={tm.name} color={tm.color} size="sm" />{tm.name}
              </button>
            ))}
          </div>
        )}
        {viewAs ? (
          <div className="mapwrap team-view" key={viewAs}>
            {teamView?.error ? <div className="map-state"><ErrorState text={teamView.error} onRetry={() => setViewAs((v) => v)} /></div>
              : !teamView?.map ? <div className="map-state"><LoadingState /></div>
              : <TeamMap map={teamView.map} teamIndex={teamView.map.teamIndex} selectedTaskId={null} onSelect={() => undefined} onSelectCity={() => undefined} />}
          </div>
        ) : (<>
        <div ref={vp.ref} {...vp.handlers} className="mapwrap">
          <SeaLayer vp={vp} bed={bed} />
          <IsletsLayer vp={vp} islets={islets} size={size} coast={coast} />
          {liveWater && <LakesLayer vp={vp} hexes={hexes} size={size} onUnsupported={() => setLiveWater(false)} />}
          <WorldSvg vp={vp} bounds={bounds}>
            <OutlineDefs colors={[...new Set((progress ?? []).map((tm) => tm.color))]} />
            <HexTiles hexes={hexes} size={size} clipId="hexclip-admin" liveWater={liveWater} />
            <CoastOver d={coast} size={size} />
            {nodes.map((n) => {
              const p = positions.get(n.key)!;
              const CITY = size * 1.15, START = size * 1.35;
              if (n.kind === "START") return <image key={"s" + n.key} href={IMG.start(n.teamIndex ?? 0)} x={p.x - START / 2} y={p.y - START * 0.58} width={START} height={START} />;
              if (n.kind === "CITY") {
                const owner = ownerOf.get(n.key);
                // Картинка города кликабельна сама (как у команды); владелец — обводка по контуру картинки цветом команды.
                return (
                  <g key={"c" + n.key} className="pick" onClick={() => { if (!vp.wasDrag()) setSelected(n); }}>
                    <image className="city-hit" href={IMG.city(n.cityType)} x={p.x - CITY / 2} y={p.y - CITY * 0.6} width={CITY} height={CITY} filter={owner ? `url(#outline-${owner.color.slice(1)})` : undefined} />
                  </g>
                );
              }
              return null;
            })}
            {edges.map((e) => {
              const a = positions.get(e.aKey), b = positions.get(e.bKey);
              if (!a || !b) return null;
              const teams = traversedBy.get([e.aKey, e.bKey].sort().join("|")) ?? [];
              if (teams.length === 0) return <line key={e.aKey + e.bKey} className="adm-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
              if (teams.length === 1) return <line key={e.aKey + e.bKey} className="adm-path" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={teams[0]!.color} />;
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              return <g key={e.aKey + e.bKey}><line className="adm-path" x1={a.x} y1={a.y} x2={mx} y2={my} stroke={teams[0]!.color} /><line className="adm-path" x1={mx} y1={my} x2={b.x} y2={b.y} stroke={teams[1]!.color} /></g>;
            })}
            {/* Морские переправы: пройденные «стороны» между островами, которых нет среди рёбер, — пунктир цветом команды. */}
            {(progress ?? []).flatMap((tm) => tm.traversed.filter((e) => !edgeSet.has([e.fromKey, e.toKey].sort().join("|")) && positions.has(e.fromKey) && positions.has(e.toKey)).map((e) => {
              const a = positions.get(e.fromKey)!, b = positions.get(e.toKey)!;
              return <line key={"sea" + tm.id + e.fromKey + e.toKey} className="adm-sea" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={tm.color} />;
            }))}
            <g className="screen-items">
              {vp.view.k < 1.4 && islandCenters.has("NT") && [...islandCenters].map(([isl, c]) => {
                const kk = vp.view.k, inv = Math.max(0.7, Math.min(1, kk / 1.6)) / kk;
                return <g key={"isl" + isl} className="m-island" transform={`translate(${c.x},${c.y}) scale(${inv})`}><IslandLabel id={"isl-adm-" + isl} r={(c.r + size * 4) / inv} name={isl === "OT" ? t("Ветхий Завет") : t("Новый Завет")} /></g>;
              })}
              {nodes.map((n) => {
                const raw = positions.get(n.key)!;
                const kk = vp.view.k, ui = Math.min(1, Math.max(0.5, kk / 1.6)), inv = ui / kk;
                const book = n.bookCode ? BOOK_BY_CODE.get(n.bookCode) : undefined;
                const seen = revealedBy.get(n.key) ?? [];
                const sel = selected?.key === n.key;
                const showLabels = kk >= 1.4, showDots = kk >= 0.8;
                const pick = () => { if (!vp.wasDrag()) setSelected(n); };
                const at = `translate(${raw.x},${raw.y}) scale(${inv})`;
                if (n.kind === "START") { const tm = progress?.find((x) => x.startNodeKey === n.key); const color = tm?.color ?? TEAM_COLORS[(n.teamIndex ?? 0) % TEAM_COLORS.length]!; return <g key={n.key} className="pick" transform={at} onClick={pick}><circle className="hit" r={14} fill="transparent" /><circle r={6} fill={color} stroke="var(--surface)" strokeWidth={2} /></g>; }
                if (n.kind === "CITY") {
                  const label = `${book?.order}. ${book?.nameRu ?? ""}`;
                  const lw = Math.ceil(label.length * 11 * 0.62) + 16;
                  return (
                  <g key={n.key} className="pick" transform={at} onClick={pick}>
                    <circle className="hit" r={Math.max(14, size * 0.65 * kk) / ui} cy={-size * 0.1 * kk / ui} fill="transparent" />
                    {battleAt.has(n.key) && <circle className="quiet" r={size * 0.8 * kk} fill="none" stroke="var(--danger)" strokeWidth={3} strokeDasharray="6 4" />}
                    {showLabels ? (
                      <g className="quiet" transform={`translate(0,${size * 1.15 * kk * 0.48 / ui})`}>
                        <rect x={-lw / 2} y={-10} width={lw} height={20} rx={10} fill={sel ? "var(--accent)" : "var(--map-paper)"} stroke="var(--text)" strokeWidth={1} />
                        <text textAnchor="middle" dy="0.35em" fontSize={11} fontWeight={700} fill={sel ? "var(--on-accent)" : "var(--text)"}>{label}</text>
                      </g>
                    ) : <g className="quiet"><circle r={8} fill={sel ? "var(--accent)" : "var(--surface)"} stroke="var(--text)" strokeWidth={1} /><text textAnchor="middle" dy="0.35em" fontSize={9} fontWeight={700} fill={sel ? "var(--on-accent)" : "var(--text)"}>{book?.order}</text></g>}
                    {seen.map((tm, i) => <circle key={tm.id} className="quiet" cx={14 - i * 9} cy={-14} r={4.5} fill={tm.color} stroke="var(--surface)" strokeWidth={1} />)}
                  </g>
                  );
                }
                if (!showDots) return null;
                return <g key={n.key} className="pick" transform={at} onClick={pick}><circle className="hit" r={12} fill="transparent" /><circle r={3} fill="rgba(31,27,22,.4)" />{seen.map((tm, i) => <circle key={tm.id} cx={8 - i * 7} cy={-8} r={3.5} fill={tm.color} stroke="var(--surface)" strokeWidth={0.8} />)}</g>;
              })}
            </g>
          </WorldSvg>
          <FaunaLayer vp={vp} hexes={hexes} islets={islets} size={size} />
        </div>
        <div className="map-controls">
          <button type="button" className="secondary icon" onClick={vp.fit} aria-label={t("Вся карта")} title={t("Вся карта")}><Icon name="expand" /></button>
          <button type="button" className="secondary icon" onClick={() => vp.zoomAt(1.3)} aria-label={t("Приблизить")} title={t("Приблизить")}><Icon name="zoom-in" /></button>
          <button type="button" className="secondary icon" onClick={() => vp.zoomAt(1 / 1.3)} aria-label={t("Отдалить")} title={t("Отдалить")}><Icon name="zoom-out" /></button>
        </div>
        </>)}
        {viewedTeam && !fullscreen && <p className="hint view-as-hint">{t("Карта глазами команды «{name}»: туман, стороны и метки как у неё. Нажатия здесь ничего не делают.", { name: viewedTeam.name })}</p>}
        {!viewAs && selected && wrapEl && (selected.kind === "CITY"
          ? <CitySheet gameId={gameId} node={selected} version={version} container={wrapEl} revealed={revealedBy.get(selected.key) ?? []} battle={battleAt.get(selected.key) ?? null} teamById={teamById} onClose={close} onReview={onReview} />
          : <NodeSheet gameId={gameId} node={selected} container={wrapEl} teams={progress ?? []} revealed={revealedBy.get(selected.key) ?? []} onClose={close} />)}
      </div>
      {!fullscreen && legend}
    </>
  );
}

/** Панель города: ключ и шифр, состояние команд, задания с ответами (аккордеон), тестовые действия (свёрнуты). */
function CitySheet({ gameId, node, version, container, revealed, battle, teamById, onClose, onReview }: { gameId: string; node: MapNodeDto; version: number; container: HTMLElement; revealed: TeamLite[]; battle: BattleProgress | null; teamById: Map<string, TeamLite>; onClose: () => void; onReview?: () => void }) {
  const superadmin = useAuth().user?.platformRole === "SUPERADMIN";
  const [city, setCity] = useState<AdminCityDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(() => api<AdminCityDto>(`/api/games/${gameId}/cities/${encodeURIComponent(node.key)}`).then((c) => { setCity(c); setLoadError(false); }).catch(() => setLoadError(true)), [gameId, node.key]);
  useEffect(() => { void load(); }, [load, version]);
  const book = BOOK_BY_CODE.get(node.bookCode ?? "");
  const total = city?.content?.tasks.length ?? 0;
  const revealedIds = new Set(revealed.map((tm) => tm.id));
  const pending = <span className="muted">{t("появится после старта игры")}</span>;
  return (
    <Sheet container={container} size="md" title={t("Город {name}", { name: book?.nameRu ?? "" })} onClose={onClose}>
      {loadError ? <ErrorState onRetry={() => void load()} /> : !city ? <LoadingState /> : (
        <div className="stack">
          <dl className="keys">
            <dt>{t("Ключ (в конверте)")}</dt><dd>{city.node.cityKey ? <code className="key">{city.node.cityKey}</code> : pending}</dd>
            <dt>{t("Шифр")}</dt><dd>{city.node.cityCode ? <code className="key">{city.node.cityCode}</code> : pending}</dd>
          </dl>
          {!city.content && <p className="note warn"><Icon name="alert" /><span>{t("Задания для этой книги ещё готовятся: команды пока не могут взять этот город.")}</span></p>}
          {battle && (
            <p className="note info">
              <Icon name="wave" />
              <span>
                {t("Испытание: «{a}» бросает вызов «{d}», ставка {n}", { a: teamById.get(battle.attackerId)?.name ?? "?", d: teamById.get(battle.defenderId)?.name ?? "?", n: plural(battle.bid, ["стих", "стиха", "стихов"]) })} · {battle.status === "QUEUED" ? t("в очереди") : battle.status === "ATTACK" ? t("идёт вызов") : t("идёт ответ")}.
                {" "}{onReview && <a href="#review" onClick={(e) => { e.preventDefault(); onReview(); }}>{t("Открыть в Проверке")}</a>}
              </span>
            </p>
          )}
          {city.teams.length === 0 ? <EmptyState inline icon="users" text={t("Команд пока нет.")} /> : (
            <ul className="list">
              {city.teams.map((tm) => (
                <li key={tm.id}>
                  <div className="main"><TeamAvatar name={tm.name} color={tm.color} size="sm" withName /></div>
                  <span className="side muted small">
                    {tm.capturedAt ? (tm.isCapital ? t("столица здесь") : t("взяла город"))
                      : tm.orderSolved ? t("задания {a} из {b}", { a: tm.doneTasks.length, b: total })
                      : tm.orderAttempts > 0 ? t("собирает порядок районов · попыток {n}", { n: tm.orderAttempts }) : t("не начинала")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {city.content && (
            <details className="fold">
              <summary><Icon name="book" />{city.answersHidden ? t("Задания") : t("Задания и ответы")} <span className="count">· {total}</span><Icon name="chevron-down" className="chev" /></summary>
              {city.answersHidden && <p className="hint">{t("Ответы видит только администратор платформы. Вопросы команд по заданиям приходят в поддержку.")}</p>}
              <ol className="admin-districts">
                {city.content.districts.map((d, i) => {
                  const task = city.content!.tasks[i];
                  if (!task) return null;
                  const answer = task.type === "number" ? String(task.answer) : task.type === "text" ? (task.answers ?? []).join(" / ") : task.type === "choice" ? task.options?.[task.correct ?? 0] : (task.items ?? []).join(", ");
                  const sign = city.node.cityCode?.[i];
                  return (
                    <li key={i}>
                      <div><strong>{d.title}</strong> <span className="muted small">{d.verses}</span></div>
                      <div className="muted small">{d.summary}</div>
                      <div className="mt-1">{task.prompt}</div>
                      {city.answersHidden
                        ? (sign ? <p className="muted small">{t("знак шифра")}: {sign}</p> : null)
                        : <p className="note ok"><Icon name="check" /><span>{t("Ответ")}: {answer ?? ""}{sign ? ` · ${t("знак шифра")}: ${sign}` : ""}</span></p>}
                    </li>
                  );
                })}
              </ol>
            </details>
          )}
          {city.teams.length > 0 && superadmin && (
            <details className="fold test">
              <summary><Icon name="alert" />{t("Тестовые действия")}<Icon name="chevron-down" className="chev" /></summary>
              <TestActions gameId={gameId} nodeKey={node.key} teams={city.teams} revealedIds={revealedIds} hasContent={Boolean(city.content)} onDone={() => void load()} />
            </details>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Панель старта или развилки: кто открыл, тестовое открытие. */
function NodeSheet({ gameId, node, container, teams, revealed, onClose }: { gameId: string; node: MapNodeDto; container: HTMLElement; teams: TeamProgress[]; revealed: TeamLite[]; onClose: () => void }) {
  const superadmin = useAuth().user?.platformRole === "SUPERADMIN";
  const startTeam = node.kind === "START" ? teams.find((tm) => tm.startNodeKey === node.key) : undefined;
  const title = node.kind === "START" ? t("Старт команды «{name}»", { name: startTeam?.name ?? String((node.teamIndex ?? 0) + 1) }) : t("Развилка");
  return (
    <Sheet container={container} size="sm" title={title} onClose={onClose}>
      <div className="stack">
        {revealed.length === 0 ? <EmptyState inline icon="map" text={t("Перекрёсток ещё никто не открыл.")} /> : (
          <div>
            <p className="muted small">{t("Открыли")}</p>
            <div className="row mt-1">{revealed.map((tm) => <TeamAvatar key={tm.id} name={tm.name} color={tm.color} size="sm" withName />)}</div>
          </div>
        )}
        {teams.length > 0 && superadmin && (
          <details className="fold test">
            <summary><Icon name="alert" />{t("Тестовые действия")}<Icon name="chevron-down" className="chev" /></summary>
            <TestActions gameId={gameId} nodeKey={node.key} teams={teams} revealedIds={new Set(revealed.map((tm) => tm.id))} hasContent={false} onDone={onClose} />
          </details>
        )}
      </div>
    </Sheet>
  );
}

/** Тестовые действия администратора: один выбор команды и три кнопки. Для развилки — только «Открыть перекрёсток». */
function TestActions({ gameId, nodeKey, teams, revealedIds, hasContent, onDone }: { gameId: string; nodeKey: string; teams: Array<TeamLite & { capturedAt?: string | null }>; revealedIds: Set<string>; hasContent: boolean; onDone: () => void }) {
  const { confirm, notify } = useUi();
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const tm = teams.find((x) => x.id === teamId);
  const isCity = "capturedAt" in (tm ?? {});
  async function run(question: string, title: string, okLabel: string, call: () => Promise<string>) {
    if (!tm || !(await confirm(question, { title, okLabel }))) return;
    setBusy(true);
    try { notify(await call()); onDone(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  const name = tm?.name ?? "";
  return (
    <div className="test-actions">
      <p className="hint">{t("Действия за команду, минуя игру. Для проверки, не для боевой игры.")}</p>
      <select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label={t("Команда")}>{teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <div className="row">
        <button type="button" className="secondary sm" disabled={busy || !tm || revealedIds.has(teamId)} onClick={() => void run(t("Сторона к этому перекрёстку будет считаться пройденной командой «{name}».", { name }), t("Открыть перекрёсток?"), t("Открыть"), async () => { await api(`/api/games/${gameId}/teams/${teamId}/reveal`, { method: "POST", body: JSON.stringify({ nodeKey }) }); return t("Перекрёсток открыт команде «{name}»", { name }); })}>{t("Открыть перекрёсток")}</button>
        {isCity && <button type="button" className="secondary sm" disabled={busy || !tm || !hasContent || Boolean(tm?.capturedAt)} onClick={() => void run(t("Районы собраны, задания решены, город не взят: команда «{name}» сможет сразу ввести ключ или бросить вызов.", { name }), t("Зачесть задания?"), t("Зачесть"), async () => { await api(`/api/games/${gameId}/cities/${encodeURIComponent(nodeKey)}/study`, { method: "POST", body: JSON.stringify({ teamId }) }); return t("Задания зачтены команде «{name}»", { name }); })}>{t("Зачесть задания")}</button>}
        {isCity && <button type="button" className="secondary sm" disabled={busy || !tm || Boolean(tm?.capturedAt)} onClick={() => void run(t("Все районы будут считаться решёнными, город займёт команда «{name}», прежний владелец его потеряет.", { name }), t("Отдать город?"), t("Отдать"), async () => { const r = await api<{ isCapital: boolean }>(`/api/games/${gameId}/cities/${encodeURIComponent(nodeKey)}/assign`, { method: "POST", body: JSON.stringify({ teamId }) }); return t("Город отдан команде «{name}»", { name }) + (r.isCapital ? t(" — это её столица") : ""); })}>{t("Отдать город")}</button>}
      </div>
    </div>
  );
}
