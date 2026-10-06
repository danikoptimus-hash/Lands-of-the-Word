import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { BOOKS, startName, hexCorners as cornersOf, vertexKey as keyOf, seaRoute, routeCurve, routePathD, routeArrow } from "@lotw/domain";
import { HEX_SIZE, fieldBounds, hexCenter, nodePos, TEAM_COLORS } from "../lib/hexmap";
import { CoastOver, islandGeometry, HexTiles, IMG, OutlineDefs, SeaLayer, TilesLayer, WorldSvg, useCoast, MapSymbols } from "./MapLayers";
import { useViewport } from "../lib/useViewport";
import { perfMark } from "../lib/perfHud";
import { reportPage } from "../lib/perf";
import { api, ApiError, PROOF_LABEL, type AdminCityDto, type EdgeTaskDto, type MapEdgeDto, type MapHexDto, type MapNodeDto, type MyMapDto } from "../lib/api";
import { deedStatus } from "./TeamPage";
import { Chip } from "../components/Chip";
import { fmtDate } from "../lib/format";
import { TeamMap, routeColor } from "./TeamMap";
import { useUi } from "../lib/ui";
import { t, getLocale } from "../lib/i18n";
import { plural } from "../lib/format";
import { AdminQuarrySheet } from "./QuarrySheet";
import { Icon, iconPath } from "../components/Icon";
import { FaunaLayer, trimRoute, type FireSite } from "./Fauna";
import { css, useDaytime } from "../lib/daytime";
import { LakesLayer } from "./Lakes";
import { kindLabel } from "./RecipientsBlock";
import { IsletsLayer, useIslets } from "./Islets";
import { useSeabed } from "./Seabed";
import { Sheet } from "../components/Sheet";
import { EdgeTasksSheet, TaskReportSheet } from "./TaskReport";
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
/**
 * Карта команды на момент ползунка истории (замечание владельца 03.10: «ползунок у админа не работает при виде от лица
 * других команд»). Текущая карта команды урезается по её ходам к этому моменту: открытые перекрёстки, освещённые гексы,
 * пройденные стороны, города и чужие проходы — только те, что были к тому времени; взятые и свободные дела, разведка и
 * птицы на прошлую минуту не показываются (их состояние на тот момент не хранится).
 */
function rewindTeamMap(map: MyMapDto, team: TeamProgress, teams: TeamProgress[], cities: CityProgress[] | null, nodes: MapNodeDto[]): MyMapDto {
  const revealed = new Set(team.revealed);
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const traversed = new Set(team.traversed.map((e) => edgeKey(e.fromKey, e.toKey)));
  const lit = (h: { q: number; r: number }) => cornersOf(h).some((c) => revealed.has(keyOf(c)));
  const nodeKeys = new Set(nodes.map((n) => n.key));
  const frontier = new Set<string>();
  for (const h of map.hexes) if (lit(h)) for (const c of cornersOf(h)) { const k = keyOf(c); if (!revealed.has(k) && nodeKeys.has(k)) frontier.add(k); }
  const ownerAt = new Map<string, TeamProgress>();
  for (const c of cities ?? []) if (c.capturedAt) { const tm = teams.find((x) => x.id === c.teamId); if (tm) ownerAt.set(c.nodeKey, tm); }
  const index = (id: string) => Math.max(0, teams.findIndex((x) => x.id === id));
  const otherTraversed = new Map<string, Set<string>>(teams.map((tm) => [tm.id, new Set(tm.traversed.map((e) => edgeKey(e.fromKey, e.toKey)))]));
  return {
    ...map,
    hexes: map.hexes.map((h) => (lit(h) ? { ...h, lit: true } : { q: h.q, r: h.r, island: h.island, lit: false })),
    revealed: map.revealed.filter((n) => revealed.has(n.key)),
    edges: map.edges.filter((e) => revealed.has(e.aKey) || revealed.has(e.bKey)),
    tasks: map.tasks.filter((tk) => tk.status === "APPROVED" && traversed.has(edgeKey(tk.fromKey, tk.toKey))),
    cities: map.cities.filter((c) => revealed.has(c.nodeKey)).map((c) => {
      const owner = ownerAt.get(c.nodeKey) ?? null;
      const mine = owner?.id === team.id;
      const cp = (cities ?? []).find((x) => x.nodeKey === c.nodeKey && x.teamId === team.id);
      return { ...c, owner: owner ? { index: index(owner.id), name: owner.name, color: owner.color } : null, captured: mine, isCapital: Boolean(mine && cp?.isCapital), battle: null, orderSolved: mine ? c.orderSolved : false, done: mine ? c.done : 0 };
    }),
    peeked: [],
    frontier: [...frontier],
    foreign: (map.foreign ?? []).filter((f) => { const tm = teams[f.teamIndex]; return tm && tm.id !== team.id && otherTraversed.get(tm.id)?.has(edgeKey(f.aKey, f.bKey)); }),
    dailyBird: null,
  };
}

export function AdminMap({ gameId, hexes, nodes, edges, progress, cities, battles, version, onReview, fullscreen = false, timeZone, at = null }: { /** Момент ползунка истории: карта «глазами команды» урезается к нему. */ at?: Date | null; /** Часовой пояс игры: по нему карта администратора красится по времени суток, как у команд. */ timeZone?: string; /** Во весь экран (страница игры): карта заполняет контейнер, переключатель «чьими глазами» и легенда — поверх. */ fullscreen?: boolean; gameId: string; hexes: MapHexDto[]; nodes: MapNodeDto[]; edges: MapEdgeDto[]; progress: TeamProgress[] | null; cities: CityProgress[] | null; battles: BattleProgress[] | null; version: number; onReview?: () => void }) {
  const size = HEX_SIZE;
  const { notify } = useUi();
  const hexKey = hexes.map((h) => `${h.q},${h.r}`).join(";");
  const bounds = useMemo(() => (hexes.length ? fieldBounds(hexes, size) : null), [hexKey, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const renderStart = performance.now();
  useLayoutEffect(() => { perfMark("карта админа: React+DOM", performance.now() - renderStart); });
  useEffect(() => { perfMark("карта админа: до кадра", performance.now() - renderStart); });
  const vp = useViewport(bounds);
  const [selected, setSelected] = useState<MapNodeDto | null>(null);
  const [quarryOpen, setQuarryOpen] = useState(false);
  /** Нажатие на дорогу: дела всех команд на этой стороне; нажатие на дело — отчёт (решение владельца 30.09). */
  const [edgeSel, setEdgeSel] = useState<{ aKey: string; bKey: string } | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
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
  const landKeys = useMemo(() => new Set(hexes.map((h) => `${h.q},${h.r}`)), [hexes]);
  const obstacles = useMemo(() => islets.map((i) => ({ x: i.x, y: i.y, r: i.r, shape: i.shape })), [islets]);
  const bed = useSeabed(hexes, islets, size, bounds);
  const [liveWater, setLiveWater] = useState(true);
  const dt = useDaytime(timeZone);
  const imgPhase = dt.t >= 0.5 ? dt.to : dt.from;
  const fires = useMemo<FireSite[]>(() => nodes.filter((n) => n.kind === "CITY" || n.kind === "START").map((n) => { const p = nodePos(n.key, size); return { x: p.x, y: p.y - size * 0.08, r: size * (n.kind === "START" ? 0.45 : 0.38) }; }), [nodes, size]);
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
  // Морские переправы для слоя живности: под ними плавают киты, над ними идут корабли (решение владельца 06.10).
  const routeSpecs = useMemo(() => {
    const obstacles = islets.map((i) => ({ x: i.x, y: i.y, r: i.r, shape: i.shape }));
    return (progress ?? []).flatMap((tm) => tm.traversed.filter((e) => !edgeSet.has([e.fromKey, e.toKey].sort().join("|")) && positions.has(e.fromKey) && positions.has(e.toKey)).map((e) => {
      const pts = routeCurve(seaRoute(landKeys, e.fromKey, e.toKey, size, undefined, obstacles), landKeys, size, obstacles);
      const arrow = routeArrow(pts, size * 1.1);
      const toCity = nodes.find((n) => n.key === e.toKey)?.kind === "CITY";
      return { pts: trimRoute(pts, size * 0.5, toCity ? size * 0.5 : size * 0.2), color: routeColor(tm.color), arrow: { x: arrow.x, y: arrow.y, heading: arrow.heading } };
    }));
  }, [progress, edgeSet, positions, landKeys, islets, size, nodes]);
  const islandLabels = useMemo(() => (showIslands && islandCenters.has("NT") ? [...islandCenters].map(([isl, c]) => ({ x: c.x, y: c.y, r: c.r + size * 4, name: isl === "OT" ? t("Ветхий Завет") : t("Новый Завет") })) : []), [showIslands, islandCenters, size]);
  /** Экранный элемент в точке карты: сдвиг в единицах карты, размер — через --inv (ставится на каждый кадр жеста). */
  const sc = (x: number, y: number) => ({ transform: `translate(${x}px, ${y}px) scale(var(--inv, 1))` });
  // Мир и экранные элементы — мемо по данным: фиксация масштаба не должна заново строить сотни SVG-элементов.
  const worldBody = useMemo(() => (<>
            {/* Дороги и переправы — под значками городов и стартов, иначе светлая подложка маршрута перекрывает их (замечание владельца 30.09). */}
            {edges.map((e) => {
              const a = positions.get(e.aKey), b = positions.get(e.bKey);
              if (!a || !b) return null;
              const teams = traversedBy.get([e.aKey, e.bKey].sort().join("|")) ?? [];
              // Широкая прозрачная линия поверх — чтобы в дорогу можно было попасть пальцем: открывает дела на этой стороне.
              const hit = <line className="edge-hit" data-a={e.aKey} data-b={e.bKey} x1={a.x} y1={a.y} x2={b.x} y2={b.y} onClick={() => { if (!vp.wasDrag()) setEdgeSel({ aKey: e.aKey, bKey: e.bKey }); }} />;
              if (teams.length === 0) return <g key={e.aKey + e.bKey}><line className="adm-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />{hit}</g>;
              // Маршруты: светлая подложка и осветлённый цвет команды, чтобы не сливались с местностью (решение владельца 30.09).
              const halo = <line className="adm-halo" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
              if (teams.length === 1) return <g key={e.aKey + e.bKey}>{halo}<line className="adm-path" x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: routeColor(teams[0]!.color) }} />{hit}</g>;
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              return <g key={e.aKey + e.bKey}>{halo}<line className="adm-path" x1={a.x} y1={a.y} x2={mx} y2={my} style={{ stroke: routeColor(teams[0]!.color) }} /><line className="adm-path" x1={mx} y1={my} x2={b.x} y2={b.y} style={{ stroke: routeColor(teams[1]!.color) }} />{hit}</g>;
            })}
            {/* Морские переправы (решение владельца 05.10): плавная линия строго по воде, в обход островков, со стрелкой к месту высадки. */}
            {(progress ?? []).flatMap((tm) => tm.traversed.filter((e) => !edgeSet.has([e.fromKey, e.toKey].sort().join("|")) && positions.has(e.fromKey) && positions.has(e.toKey)).map((e) => {
              const pts = routeCurve(seaRoute(landKeys, e.fromKey, e.toKey, size, undefined, obstacles), landKeys, size, obstacles);
              const d = routePathD(pts), arrow = routeArrow(pts, size * 1.1), end = { x: arrow.x, y: arrow.y }, heading = arrow.heading;
              void end; void heading; // линия и стрелка рисуются слоем живности (решение владельца 06.10); здесь только область нажатия
              return <g key={"sea" + tm.id + e.fromKey + e.toKey} className="adm-sea-route"><path className="edge-hit" d={d} onClick={() => { if (!vp.wasDrag()) setEdgeSel({ aKey: e.fromKey, bKey: e.toKey }); }} /></g>;
            }))}
            {nodes.map((n) => {
              const p = positions.get(n.key)!;
              const CITY = size * 0.77, START = size * 0.9; // решение владельца 16.09: знаки городов и стартов в полтора раза меньше прежних (1,15 и 1,35)
              if (n.kind === "START") return <image key={"s" + n.key} href={IMG.start(n.teamIndex ?? 0, imgPhase)} x={p.x - START / 2} y={p.y - START * 0.58} width={START} height={START} />;
              if (n.kind === "CITY") {
                const owner = ownerOf.get(n.key);
                // Картинка города кликабельна сама (как у команды); владелец — обводка по контуру картинки цветом команды.
                return (
                  <g key={"c" + n.key} data-key={n.key} className="m-city" onClick={() => { if (!vp.wasDrag()) setSelected(n); }}>
                    <image className="city-hit" href={IMG.city(n.cityType, imgPhase)} x={p.x - CITY / 2} y={p.y - CITY * 0.6} width={CITY} height={CITY} filter={owner ? `url(#outline-${owner.color.slice(1)})` : undefined} />
                  </g>
                );
              }
              return null;
            })}
  </>), [nodes, edges, positions, ownerOf, traversedBy, progress, edgeSet, battleAt, size, imgPhase]); // eslint-disable-line react-hooks/exhaustive-deps
  // Каменоломня (решение владельца 04.10): подпись на скалистом островке; у администратора открывает камни команд.
  const quarry = islets.find((i) => i.quarry) ?? null;
  const quarryMarker = quarry && (() => {
    const name = t("Каменоломня"), fs = 12, w = Math.ceil(name.length * fs * 0.62) + 34, h = fs + 12;
    return (
      <g className="m-quarry" style={{ transform: `translate(${quarry.x}px, ${quarry.y}px) scale(var(--inv, 1))` }} role="button" aria-label={name} onClick={() => { if (!vp.wasDrag()) setQuarryOpen(true); }}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} />
        <g transform={`translate(${-w / 2 + 8}, ${-(fs + 2) / 2}) scale(${(fs + 2) / 24})`}><path d={iconPath("stone")} /></g>
        <text x={9} textAnchor="middle" dy="0.35em" fontSize={fs} fontWeight={700}>{name}</text>
      </g>
    );
  })();
  const screenBody = useMemo(() => (<>
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
                  // Столица команды — с короной цвета команды, как на карте команды (замечание владельца 03.10: «где значки столиц?»).
                  const capital = cities?.find((c) => c.nodeKey === n.key && c.capturedAt && c.isCapital);
                  const crownColor = capital ? teamById.get(capital.teamId)?.color ?? "var(--text)" : null;
                  const crownW = crownColor ? 14 : 0;
                  const lw = Math.ceil(label.length * 11 * 0.62) + 16 + crownW;
                  return (
                  <Fragment key={n.key}>
                    {/* Нажатие по городу — по самой картинке в слое мира, как на карте команды (решение владельца 01.10: одно решение
                        везде). Экранная зона нажатия остаётся только при виде «вся карта», где значок меньше пальца и показан номером. */}
                    {!showLabels ? (
                      <g className="pick" style={at} onClick={pick}>
                        <circle className="hit" r={20} cy={-4} fill="transparent" />
                        <g className="quiet"><circle r={8} fill={sel ? "var(--accent)" : "var(--surface)"} stroke="var(--text)" strokeWidth={1} /><text textAnchor="middle" dy="0.35em" fontSize={9} fontWeight={700} fill={sel ? "var(--on-accent)" : "var(--text)"}>{book?.order}</text>
                          {crownColor && <use href="#m-crown" x={8} y={-16} width={11} height={11} style={{ color: crownColor }} />}</g>
                        {/* Город под вызовом: значок испытания, как на карте команды (замечание владельца 03.10). */}
                        {battleAt.has(n.key) && <g className="m-battle def" transform="translate(-16,-14)"><circle r={8} /><use href="#m-wave" x={-5.5} y={-5.5} width={11} height={11} /></g>}
                        {seen.map((tm, i) => <circle key={tm.id} className="quiet" cx={(i - (seen.length - 1) / 2) * 10} cy={-14} r={4.5} fill={tm.color} stroke="var(--surface)" strokeWidth={1} />)}
                      </g>
                    ) : (
                      <g className="quiet" style={at}>
                        {/* Точки команд, открывших узел, — ровно на узле (решение владельца 02.10: смещённые точки читались как съехавшие). */}
                        {seen.map((tm, i) => <circle key={tm.id} cx={(i - (seen.length - 1) / 2) * 10} cy={0} r={4.5} fill={tm.color} stroke="var(--surface)" strokeWidth={1} />)}
                      </g>
                    )}
                    {showLabels && (
                      <g className="pick" style={sc(raw.x, raw.y + size * 0.77 * 0.48)} onClick={pick}>
                        <g className="quiet">
                          <rect x={-lw / 2} y={-10} width={lw} height={20} rx={10} fill={sel ? "var(--accent)" : "var(--map-paper)"} stroke="var(--text)" strokeWidth={1} />
                          {crownColor && <use href="#m-crown" x={-lw / 2 + 6} y={-6} width={12} height={12} style={{ color: sel ? "var(--on-accent)" : crownColor }} />}
                          <text x={crownW / 2} textAnchor="middle" dy="0.35em" fontSize={11} fontWeight={700} fill={sel ? "var(--on-accent)" : "var(--text)"}>{label}</text>
                          {battleAt.has(n.key) && <g className="m-battle def" transform={`translate(${lw / 2 + 2},-12)`}><circle r={10} /><use href="#m-wave" x={-7} y={-7} width={14} height={14} /></g>}
                        </g>
                      </g>
                    )}
                  </Fragment>
                  );
                }
                if (!showDots) return null;
                return <g key={n.key} className="pick" style={at} onClick={pick}><circle className="hit" r={12} fill="transparent" />{seen.length === 0 && <circle r={3} fill="rgba(31,27,22,.4)" />}{seen.map((tm, i) => <circle key={tm.id} cx={(i - (seen.length - 1) / 2) * 8} cy={0} r={3.5} fill={tm.color} stroke="var(--surface)" strokeWidth={0.8} />)}</g>;
              })}
  </>), [nodes, positions, revealedBy, selected, showLabels, showDots, showIslands, islandCenters, progress, size, cities, teamById, battleAt, landKeys, obstacles]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!bounds) return null;
  const viewedTeam = viewAs ? teamById.get(viewAs) : null;
  const viewMap = useMemo(() => (teamView?.map && at && viewedTeam && progress ? { ...rewindTeamMap(teamView.map, viewedTeam, progress, cities, nodes), teamIndex: teamView.map.teamIndex } : teamView?.map ?? null), [teamView, at, viewedTeam, progress, cities, nodes]);
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
              : <TeamMap map={viewMap ?? teamView.map} teamIndex={teamView.map.teamIndex} selectedTaskId={teamTaskId} onSelect={(tid) => { setTeamTaskId(tid); if (tid) setSelected(null); }} onSelectCity={(key) => { const n = nodeByKey.get(key); if (n) { setSelected(n); setTeamTaskId(null); } }}
                  onMarkTap={(mk) => notify((mk.note ? t("Метка «{note}»", { note: mk.note }) : t("Метка")) + (mk.by?.name ? ` · ${mk.by.name}` : "") + (mk.createdAt ? ` · ${fmtDate(mk.createdAt)}` : ""), "info")} />}
            {teamView?.map && teamTaskId && wrapEl && (() => { const task = teamView.map!.tasks.find((tk) => tk.id === teamTaskId); return task ? <TeamTaskSheet task={task} members={teamView.map!.members ?? []} container={wrapEl} onClose={() => setTeamTaskId(null)} onReview={onReview} /> : null; })()}
          </div>
        ) : (<>
        <div ref={vp.ref} {...vp.handlers} className="mapwrap" style={{ background: css(dt.light.bg) }}>
          <SeaLayer vp={vp} bed={bed} light={dt.light} />
          <IsletsLayer vp={vp} islets={islets} size={size} coast={coast} daytime={dt} />
          <TilesLayer vp={vp} hexes={hexes} size={size} skipWater={liveWater} daytime={dt} />
          {liveWater && <LakesLayer vp={vp} hexes={hexes} size={size} onUnsupported={() => setLiveWater(false)} daytime={dt} />}
          <WorldSvg vp={vp} bounds={bounds}>
            <MapSymbols />
            <OutlineDefs colors={[...new Set((progress ?? []).map((tm) => tm.color))]} />
            <HexTiles hexes={hexes} size={size} clipId="hexclip-admin" liveWater={liveWater} fills={false} />
            <CoastOver d={coast} size={size} light={dt.light} />
            {worldBody}
          </WorldSvg>
          {/* Подписи островов рисует слой живности: киты под буквами, корабли над (решение владельца 05.10). */}
          <FaunaLayer vp={vp} hexes={hexes} islets={islets} size={size} seed={gameId} light={dt.light} fires={fires} labels={islandLabels} routes={routeSpecs} />
          {/* Подписи городов и метки — отдельным слоем над живностью и маршрутами: название города выше линии корабля (решение владельца 06.10). */}
          <WorldSvg vp={vp} bounds={bounds} overlay>
            <g className="screen-items">
              {quarryMarker}
              {screenBody}
            </g>
          </WorldSvg>
        </div>
        <div className="map-controls">
          <button type="button" className="secondary icon" onClick={vp.fit} aria-label={t("Вся карта")} title={t("Вся карта")}><Icon name="expand" /></button>
        </div>
        </>)}
        {viewedTeam && fullscreen && <div className="view-as-name" aria-live="polite"><TeamAvatar name={viewedTeam.name} color={viewedTeam.color} size="sm" />{t("Глазами команды «{name}»", { name: viewedTeam.name })}</div>}
        {viewedTeam && !fullscreen && <p className="hint view-as-hint">{t("Карта глазами команды «{name}»: туман, стороны и метки как у неё. Нажмите свиток или город, чтобы увидеть дело или ход занятия города.", { name: viewedTeam.name })}</p>}
        {edgeSel && wrapEl && !reportId && <EdgeTasksSheet gameId={gameId} aKey={edgeSel.aKey} bKey={edgeSel.bKey} container={wrapEl} onClose={() => setEdgeSel(null)} onOpenTask={setReportId} />}
        {reportId && wrapEl && <TaskReportSheet gameId={gameId} taskId={reportId} container={wrapEl} onClose={() => { setReportId(null); setEdgeSel(null); }} onReview={onReview} />}
        {quarryOpen && wrapEl && <AdminQuarrySheet gameId={gameId} container={wrapEl} onClose={() => setQuarryOpen(false)} onReview={() => { setQuarryOpen(false); onReview?.(); }} />}
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
      {task.deed.description && <p className="mt-2">{task.deed.description}</p>}
      <p className="meta-line mt-2"><Icon name="scroll" />{t("Сдать")}: {PROOF_LABEL[task.deed.proofType]}{takerName && <> · <Icon name="user" />{t("Взял: {name}", { name: takerName })}</>}{task.submittedAt && <> · <Icon name="clock" />{fmtDate(task.submittedAt)}</>}</p>
      {task.sea && <div className="note info"><Icon name="ship" /><span>{t("Морской путь: корабль из порта. Когда дело одобрят, кормчий выберет на карте, куда высадиться на другом острове.")}</span></div>}
      {task.deed.secret && <div className="note info"><Icon name="lock" /><span>{t("Тайное дело: сдачу смотрите во вкладке «Проверка».")}</span></div>}
      {task.donation && <div className="note info"><Icon name="star" /><span>{t("Дело заменено пожертвованием{amount}.", { amount: task.donationAmount ? ` · ${task.donationAmount}` : "" })}</span></div>}
      {(() => { const names = (task.participants ?? []).filter((pid) => pid !== task.takenById).map((pid) => { const m = members.find((x) => x.id === pid); return m ? m.displayName ?? m.nickname : ""; }).filter(Boolean); return names.length > 0 ? <p className="meta-line"><Icon name="users" />{t("Участвовали: {names}", { names: names.join(", ") })}</p> : null; })()}
      {task.status === "APPROVED" && task.decidedAt && <p className="meta-line small muted"><Icon name="check" />{t("Одобрено")}: {fmtDate(task.decidedAt)}</p>}
      {task.links.length > 0 && <ul className="links">{task.links.map((l) => <li key={l}><a href={l} target="_blank" rel="noreferrer">{l}</a></li>)}</ul>}
      {task.note && <p className="mt-2 report-text">{task.note}</p>}
      {task.status === "REJECTED" && task.adminComment && <div className="note bad"><Icon name="alert" /><span>{t("Возвращено с комментарием: «{comment}»", { comment: task.adminComment })}</span></div>}
      {task.status === "SUBMITTED" && onReview && <div className="actions"><button type="button" className="secondary" onClick={() => { onClose(); onReview(); }}><Icon name="check" />{t("Открыть в Проверке")}</button></div>}
    </Sheet>
  );
}

function CitySheet({ gameId, node, version, container, revealed, battle, teamById, onClose, onReview }: { gameId: string; node: MapNodeDto; version: number; container: HTMLElement; revealed: TeamLite[]; battle: BattleProgress | null; teamById: Map<string, TeamLite>; onClose: () => void; onReview?: () => void }) {
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
            <dt>{t("Конверт у")}</dt><dd>{city.recipient ? <>{city.recipient.label} <span className="muted">({kindLabel(city.recipient.kind)})</span></> : <span className="muted">{t("адресат не назначен")}</span>}</dd>
            {/* Защита взятого города (решение владельца 04.10): уровень, закрепление и когда уровень растает усталостью. */}
            {city.defense && <><dt>{t("Защита")}</dt><dd>
              <Chip icon="shield" title={t("Уровень защиты: столько стихов отбили хранители")}>{city.defense.level}</Chip>
              {city.defense.sumMode && <Chip tone="neutral" title={t("Книга исчерпана: ставки считаются суммой стихов по участникам")}>Σ</Chip>}
              {city.defense.lockedUntil && <Chip tone="accent" icon="lock" title={t("Закреплён: вызовы невозможны до этой даты")}>{fmtDate(city.defense.lockedUntil, { time: false })}</Chip>}
              {city.defense.fatigueNextAt && !city.defense.lockedUntil && <Chip tone="neutral" icon="clock" title={t("Усталость: без дел из города уровень тает на {n} с этой даты", { n: city.defense.fatigueStep })}>−{city.defense.fatigueStep} · {fmtDate(city.defense.fatigueNextAt, { time: false })}</Chip>}
            </dd></>}
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
                    {tm.minBid != null && <Chip icon="sword" title={t("Минимальная ставка этой команды для вызова: {n} стихов", { n: tm.minBid })}>{tm.minBid}</Chip>}
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
        </div>
      )}
    </Sheet>
  );
}

/** Панель старта или развилки: кто открыл. */
function NodeSheet({ gameId, node, container, teams, revealed, onClose }: { gameId: string; node: MapNodeDto; container: HTMLElement; teams: TeamProgress[]; revealed: TeamLite[]; onClose: () => void }) {
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
      </div>
    </Sheet>
  );
}

