import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { BOOKS, startName } from "@lotw/domain";
import { HEX_SIZE, fieldBounds, hexCenter, nodePos, TEAM_COLORS } from "../lib/hexmap";
import { CoastOver, IslandLabel, islandGeometry, HexTiles, IMG, OutlineDefs, SeaLayer, TilesLayer, WorldSvg, useCoast } from "./MapLayers";
import { useViewport } from "../lib/useViewport";
import { perfMark } from "../lib/perfHud";
import { reportPage } from "../lib/perf";
import { api, ApiError, PROOF_LABEL, type AdminCityDto, type EdgeTaskDto, type MapEdgeDto, type MapHexDto, type MapNodeDto, type MyMapDto } from "../lib/api";
import { deedStatus } from "./TeamPage";
import { Chip } from "../components/Chip";
import { fmtDate } from "../lib/format";
import { TeamMap } from "./TeamMap";
import { useUi } from "../lib/ui";
import { useAuth } from "../lib/auth";
import { t, getLocale } from "../lib/i18n";
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
  const hexKey = hexes.map((h) => `${h.q},${h.r}`).join(";");
  const bounds = useMemo(() => (hexes.length ? fieldBounds(hexes, size) : null), [hexKey, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const renderStart = performance.now();
  useLayoutEffect(() => { perfMark("карта админа: React+DOM", performance.now() - renderStart); });
  useEffect(() => { perfMark("карта админа: до кадра", performance.now() - renderStart); });
  const vp = useViewport(bounds);
  const [selected, setSelected] = useState<MapNodeDto | null>(null);
  /** «Глазами команды»: выбранное дело (свиток) этой команды. */
  const [teamTaskId, setTeamTaskId] = useState<string | null>(null);
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const close = useCallback(() => setSelected(null), []);
  const nodeByKey = useMemo(() => new Map(nodes.map((n) => [n.key, n])), [nodes]);
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
  const kk = vp.view.k;
  const showLabels = kk >= 1.4, showDots = kk >= 0.8, showIslands = kk < 1.4;
  /** Экранный элемент в точке карты: сдвиг в единицах карты, размер — через --inv (ставится на каждый кадр жеста). */
  const sc = (x: number, y: number) => ({ transform: `translate(${x}px, ${y}px) scale(var(--inv, 1))` });
  // Мир и экранные элементы — мемо по данным: фиксация масштаба не должна заново строить сотни SVG-элементов.
  const worldBody = useMemo(() => (<>
            {nodes.map((n) => {
              const p = positions.get(n.key)!;
              const CITY = size * 0.77, START = size * 0.9; // решение владельца 16.09: знаки городов и стартов в полтора раза меньше прежних (1,15 и 1,35)
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
  </>), [nodes, edges, positions, ownerOf, traversedBy, progress, edgeSet, battleAt, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const screenBody = useMemo(() => (<>
              {showIslands && islandCenters.has("NT") && [...islandCenters].map(([isl, c]) => {
                return <g key={"isl" + isl} className="m-island" transform={`translate(${c.x},${c.y})`}><IslandLabel id={"isl-adm-" + isl} r={c.r + size * 4} name={isl === "OT" ? t("Ветхий Завет") : t("Новый Завет")} /></g>;
              })}
              {nodes.map((n) => {
                const raw = positions.get(n.key)!;
                const book = n.bookCode ? BOOK_BY_CODE.get(n.bookCode) : undefined;
                const seen = revealedBy.get(n.key) ?? [];
                const sel = selected?.key === n.key;
                const pick = () => { if (!vp.wasDrag()) setSelected(n); };
                const at = sc(raw.x, raw.y);
                if (n.kind === "START") { const tm = progress?.find((x) => x.startNodeKey === n.key); const color = tm?.color ?? TEAM_COLORS[(n.teamIndex ?? 0) % TEAM_COLORS.length]!; return <g key={n.key} className="pick" style={at} onClick={pick}><circle className="hit" r={14} fill="transparent" /><circle r={6} fill={color} stroke="var(--surface)" strokeWidth={2} /></g>; }
                if (n.kind === "CITY") {
                  const label = `${book?.order}. ${book?.nameRu ?? ""}`;
                  const lw = Math.ceil(label.length * 11 * 0.62) + 16;
                  return (
                  <Fragment key={n.key}>
                    <g className="pick" style={at} onClick={pick}>
                      <circle className="hit" r={20} cy={-4} fill="transparent" />
                      {!showLabels && <g className="quiet"><circle r={8} fill={sel ? "var(--accent)" : "var(--surface)"} stroke="var(--text)" strokeWidth={1} /><text textAnchor="middle" dy="0.35em" fontSize={9} fontWeight={700} fill={sel ? "var(--on-accent)" : "var(--text)"}>{book?.order}</text></g>}
                      {seen.map((tm, i) => <circle key={tm.id} className="quiet" cx={14 - i * 9} cy={-14} r={4.5} fill={tm.color} stroke="var(--surface)" strokeWidth={1} />)}
                    </g>
                    {showLabels && (
                      <g className="pick" style={sc(raw.x, raw.y + size * 0.77 * 0.48)} onClick={pick}>
                        <g className="quiet">
                          <rect x={-lw / 2} y={-10} width={lw} height={20} rx={10} fill={sel ? "var(--accent)" : "var(--map-paper)"} stroke="var(--text)" strokeWidth={1} />
                          <text textAnchor="middle" dy="0.35em" fontSize={11} fontWeight={700} fill={sel ? "var(--on-accent)" : "var(--text)"}>{label}</text>
                        </g>
                      </g>
                    )}
                  </Fragment>
                  );
                }
                if (!showDots) return null;
                return <g key={n.key} className="pick" style={at} onClick={pick}><circle className="hit" r={12} fill="transparent" /><circle r={3} fill="rgba(31,27,22,.4)" />{seen.map((tm, i) => <circle key={tm.id} cx={8 - i * 7} cy={-8} r={3.5} fill={tm.color} stroke="var(--surface)" strokeWidth={0.8} />)}</g>;
              })}
  </>), [nodes, positions, revealedBy, selected, showLabels, showDots, showIslands, islandCenters, progress, size]); // eslint-disable-line react-hooks/exhaustive-deps
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
            <button type="button" role="tab" aria-selected={!viewAs} className={"va" + (!viewAs ? " on" : "")} title={t("Администратор")} aria-label={t("Администратор")} onClick={() => setViewAs(null)}><Icon name="crown" /></button>
            {progress.map((tm) => (
              <button key={tm.id} type="button" role="tab" aria-selected={viewAs === tm.id} className={"va" + (viewAs === tm.id ? " on" : "")} title={tm.name} aria-label={t("Глазами команды «{name}»", { name: tm.name })} onClick={() => setViewAs(tm.id)}>
                <TeamAvatar name={tm.name} color={tm.color} size="sm" />
              </button>
            ))}
          </div>
        )}
        {viewAs ? (
          <div className="mapwrap team-view" key={viewAs}>
            {teamView?.error ? <div className="map-state"><ErrorState text={teamView.error} onRetry={() => setViewAs((v) => v)} /></div>
              : !teamView?.map ? <div className="map-state"><LoadingState /></div>
              : <TeamMap map={teamView.map} teamIndex={teamView.map.teamIndex} selectedTaskId={teamTaskId} onSelect={(tid) => { setTeamTaskId(tid); if (tid) setSelected(null); }} onSelectCity={(key) => { const n = nodeByKey.get(key); if (n) { setSelected(n); setTeamTaskId(null); } }} />}
            {teamView?.map && teamTaskId && wrapEl && (() => { const task = teamView.map!.tasks.find((tk) => tk.id === teamTaskId); return task ? <TeamTaskSheet task={task} members={teamView.map!.members ?? []} container={wrapEl} onClose={() => setTeamTaskId(null)} onReview={onReview} /> : null; })()}
          </div>
        ) : (<>
        <div ref={vp.ref} {...vp.handlers} className="mapwrap">
          <SeaLayer vp={vp} bed={bed} />
          <IsletsLayer vp={vp} islets={islets} size={size} coast={coast} />
          <TilesLayer vp={vp} hexes={hexes} size={size} skipWater={liveWater} />
          {liveWater && <LakesLayer vp={vp} hexes={hexes} size={size} onUnsupported={() => setLiveWater(false)} />}
          <WorldSvg vp={vp} bounds={bounds}>
            <OutlineDefs colors={[...new Set((progress ?? []).map((tm) => tm.color))]} />
            <HexTiles hexes={hexes} size={size} clipId="hexclip-admin" liveWater={liveWater} fills={false} />
            <CoastOver d={coast} size={size} />
            {worldBody}
            <g className="screen-items">
              {screenBody}
            </g>
          </WorldSvg>
          <FaunaLayer vp={vp} hexes={hexes} islets={islets} size={size} />
        </div>
        <div className="map-controls">
          <button type="button" className="secondary icon" onClick={vp.fit} aria-label={t("Вся карта")} title={t("Вся карта")}><Icon name="expand" /></button>
        </div>
        </>)}
        {viewedTeam && fullscreen && <div className="view-as-name" aria-live="polite"><TeamAvatar name={viewedTeam.name} color={viewedTeam.color} size="sm" />{t("Глазами команды «{name}»", { name: viewedTeam.name })}</div>}
        {viewedTeam && !fullscreen && <p className="hint view-as-hint">{t("Карта глазами команды «{name}»: туман, стороны и метки как у неё. Нажмите свиток или город, чтобы увидеть дело или ход занятия города.", { name: viewedTeam.name })}</p>}
        {selected && wrapEl && (selected.kind === "CITY"
          ? <CitySheet gameId={gameId} node={selected} version={version} container={wrapEl} revealed={revealedBy.get(selected.key) ?? []} battle={battleAt.get(selected.key) ?? null} teamById={teamById} onClose={close} onReview={onReview} />
          : <NodeSheet gameId={gameId} node={selected} container={wrapEl} teams={progress ?? []} revealed={revealedBy.get(selected.key) ?? []} onClose={close} />)}
      </div>
      {!fullscreen && legend}
    </>
  );
}

/** Панель города: ключ и шифр, состояние команд, задания с ответами (аккордеон), тестовые действия (свёрнуты). */
/** Дело на стороне «глазами команды»: что за дело, статус, кто взял, что сдано. Действий нет — проверка во вкладке «Проверка». */
function TeamTaskSheet({ task, members, container, onClose, onReview }: { task: EdgeTaskDto; members: Array<{ id: string; nickname: string; displayName: string | null }>; container: HTMLElement; onClose: () => void; onReview?: () => void }) {
  const st = deedStatus(task.status);
  const taker = task.takenById ? members.find((m) => m.id === task.takenById) : null;
  const takerName = taker ? taker.displayName ?? taker.nickname : task.takenById ? t("участник") : "";
  return (
    <Sheet size="sm" container={container} onClose={onClose} className="deed-sheet" head={<div className="sheet-title"><h2>{task.deed.title}</h2><Chip tone={st.tone} icon={st.icon}>{st.label}</Chip></div>}>
      <p className="muted small">{task.deed.direction}</p>
      {task.deed.description && <p className="mt-2">{task.deed.description}</p>}
      <p className="meta-line mt-2"><Icon name="scroll" />{t("Сдать")}: {PROOF_LABEL[task.deed.proofType]}{takerName && <> · <Icon name="user" />{t("Взял: {name}", { name: takerName })}</>}{task.submittedAt && <> · <Icon name="clock" />{fmtDate(task.submittedAt)}</>}</p>
      {task.sea && <div className="note info"><Icon name="ship" /><span>{t("Морской путь: корабль из порта. Когда дело одобрят, капитан выберет на карте, куда высадиться на другом острове.")}</span></div>}
      {task.deed.secret && <div className="note info"><Icon name="lock" /><span>{t("Тайное дело: сдачу смотрите во вкладке «Проверка».")}</span></div>}
      {task.donation && <div className="note info"><Icon name="star" /><span>{t("Дело заменено пожертвованием{amount}.", { amount: task.donationAmount ? ` · ${task.donationAmount}` : "" })}</span></div>}
      {task.links.length > 0 && <ul className="links">{task.links.map((l) => <li key={l}><a href={l} target="_blank" rel="noreferrer">{l}</a></li>)}</ul>}
      {task.note && <p className="mt-2">{task.note}</p>}
      {task.status === "REJECTED" && task.adminComment && <div className="note bad"><Icon name="alert" /><span>{t("Возвращено с комментарием: «{comment}»", { comment: task.adminComment })}</span></div>}
      {task.status === "SUBMITTED" && onReview && <div className="actions"><button type="button" className="secondary" onClick={() => { onClose(); onReview(); }}><Icon name="check" />{t("Открыть в Проверке")}</button></div>}
    </Sheet>
  );
}

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
                  const answer = task.type === "number" ? String(task.answer) : task.type === "text" ? (task.answers ?? []).join(" / ") : task.type === "choice" ? task.options?.[task.correct ?? 0] : task.type === "crossword" ? (task.words ?? []).map((w) => `${w.clue} — ${w.answer ?? ""}`).join("; ") : (task.items ?? []).join(", ");
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
  const title = node.kind === "START" ? `${startName(node.teamIndex ?? 0, getLocale())} · ${t("старт команды «{name}»", { name: startTeam?.name ?? String((node.teamIndex ?? 0) + 1) })}` : t("Развилка");
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
