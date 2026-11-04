import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useState, type MouseEvent, type PointerEvent } from "react";
import { hitTest, mapPoint, stylesK, type HitModel } from "../lib/mapHit";
import { WorldGL, type WorldScene } from "./WorldGL";
import { coastLoops, rgb, themeColor, worldMode } from "../lib/worldScene";
import { parseColor } from "../lib/glLines";
import { perfExpose, perfOff } from "../lib/perfHud";
import { RoutesGL } from "./RoutesGL";
/** Морские пути на WebGL (Э3) — по умолчанию; `?routes=canvas` — прежний способ на холсте живности (и запасной путь без WebGL). */
const GL_ROUTES_DEFAULT = typeof location === "undefined" || !/[?&]routes=canvas/.test(location.search);
import { BOOKS, startName, hexCorners as cornersOf, vertexKey as keyOf, seaRoute, routeCurve, routeArrow } from "@lotw/domain";
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
import { FaunaLayer, trimRoute, type FireSite, type WreckSpec } from "./Fauna";
import { css, stormLight, useDaytime, useStormPicture } from "../lib/daytime";
import { StormLayer } from "./StormLayer";
import { FireworksLayer, type FireworkSite } from "./FireworksLayer";
import type { StormSlot } from "../lib/api";
import { LakesLayer } from "./Lakes";
import { kindLabel } from "./RecipientsBlock";
import { IsletsLayer, useIslets } from "./Islets";
import { useSeabed } from "./Seabed";
import { Sheet } from "../components/Sheet";
import { EdgeTasksSheet, ReconsiderButton, TaskReportSheet } from "./TaskReport";
import { TeamAvatar } from "../components/TeamAvatar";
import { EmptyState, ErrorState, LoadingState } from "../components/State";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
export interface CityProgress { teamId: string; nodeKey: string; orderSolved: boolean; done: number; capturedAt: string | null; isCapital: boolean }
export interface BattleProgress { id: string; nodeKey: string; status: string; attackerId: string; defenderId: string; bid: number }
/** Просьба «Посмотреть на карте» (владелец 10.10): сторона дела, на которой карта центрируется и приближается; nonce — чтобы повтор той же стороны снова сработал. */
export interface MapFocus { teamId?: string | null; taskId?: string; fromKey: string; toKey: string; nonce: number }

export interface TeamProgress { id: string; /** Индекс команды в игре (как в owner.index и foreign.teamIndex карты команды). */ index?: number; name: string; color: string; avatarId?: string | null; startNodeKey: string | null; revealed: string[]; revealedAt?: string[]; traversed: Array<{ fromKey: string; toKey: string; at?: string }> }
type TeamLite = { id: string; name: string; color: string; avatarId?: string | null };

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
  // Индекс владельца — настоящий индекс команды (замечание владельца 04.11: без шатров «глазами команды»); место в списке — запасной вариант.
  const index = (id: string) => teams.find((x) => x.id === id)?.index ?? Math.max(0, teams.findIndex((x) => x.id === id));
  const byIndex = (i: number) => teams.find((x) => x.index === i) ?? teams[i];
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
    foreign: (map.foreign ?? []).filter((f) => { const tm = byIndex(f.teamIndex); return tm && tm.id !== team.id && otherTraversed.get(tm.id)?.has(edgeKey(f.aKey, f.bKey)); }),
    dailyBird: null,
  };
}

export function AdminMap({ gameId, hexes, nodes, edges, progress, cities, battles, version, onReview, fullscreen = false, timeZone, storms, at = null, focus = null }: { /** Расписание штормов (решение владельца 24.10): администратору буря показывается картинкой, без запретов. */ storms?: StormSlot[]; /** «Посмотреть на карте»: при смене nonce карта администратора центрируется на стороне и подсвечивает её. */ focus?: MapFocus | null; /** Момент ползунка истории: карта «глазами команды» урезается к нему. */ at?: Date | null; /** Часовой пояс игры: по нему карта администратора красится по времени суток, как у команд. */ timeZone?: string; /** Во весь экран (страница игры): карта заполняет контейнер, переключатель «чьими глазами» и легенда — поверх. */ fullscreen?: boolean; gameId: string; hexes: MapHexDto[]; nodes: MapNodeDto[]; edges: MapEdgeDto[]; progress: TeamProgress[] | null; cities: CityProgress[] | null; battles: BattleProgress[] | null; version: number; onReview?: () => void }) {
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
  // Разбитые бурей корабли (решение владельца 04.11): на карте администратора — те же корабли, без листа сдачи; по нажатию — короткая карточка.
  interface AdminWreck { id: string; title: string; model: number; q: number; r: number; seed: number; sunkAt: string | null; doneTeams: number; pending: number; cargo: { stones: number; blocks: number } }
  const [wrecks, setWrecks] = useState<AdminWreck[]>([]);
  const [wreckCard, setWreckCard] = useState<string | null>(null);
  useEffect(() => { let alive = true; api<{ wrecks: AdminWreck[] }>(`/api/games/${gameId}/wrecks`).then((r) => { if (alive) setWrecks(r.wrecks); }).catch(() => {}); return () => { alive = false; }; }, [gameId, version]);
  const wreckSpecs = useMemo<WreckSpec[]>(() => wrecks.map((w) => { const c = hexCenter(w, size); return { id: w.id, x: c.x, y: c.y, kind: (w.model % 3) as 0 | 1 | 2, seed: w.seed, repairedAt: null, sunkAt: w.sunkAt ? Date.parse(w.sunkAt) : null }; }), [wrecks, size]);
  /** Нажатие на дорогу: дела всех команд на этой стороне; нажатие на дело — отчёт (решение владельца 30.09). */
  const [edgeSel, setEdgeSel] = useState<{ aKey: string; bKey: string } | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  /** «Глазами команды»: выбранное дело (свиток) этой команды. */
  const [teamTaskId, setTeamTaskId] = useState<string | null>(null);
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const close = useCallback(() => setSelected(null), []);
  /** Подсветка стороны после «Посмотреть на карте»: пульсирующее кольцо посередине дороги несколько секунд. */
  const [flash, setFlash] = useState<{ x: number; y: number; aKey: string; bKey: string } | null>(null);
  useEffect(() => {
    if (!focus) return;
    const a = nodePos(focus.fromKey, size);
    const sea = focus.toKey.startsWith("sea:") || !nodes.some((n) => n.key === focus.toKey);
    const b = sea ? a : nodePos(focus.toKey, size);
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    setViewAs(null); setSelected(null); setEdgeSel(null); setReportId(null);
    vp.focusOn(x, y, 3.5);
    setFlash({ x, y, aKey: focus.fromKey, bKey: focus.toKey });
    const timer = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(timer);
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Салют над взятыми сегодня городами и у администратора (просьба владельца 25.10); в режиме истории (ползунок) салюта нет. */
  const fireworkSites = useMemo<FireworkSite[]>(() => (at ? [] : (cities ?? []).filter((c) => c.capturedAt).map((c) => { const p = nodePos(c.nodeKey, size); return { key: c.nodeKey, x: p.x, y: p.y - size * 0.3, at: Date.parse(c.capturedAt!) }; })), [cities, size, at]);
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
  // Мир на WebGL (этап Э2): по `?map=gl`; без WebGL или при потере контекста — обратно к SVG.
  const [glWorld, setGlWorld] = useState(() => worldMode() === "gl");
  const [glRoutes, setGlRoutes] = useState(GL_ROUTES_DEFAULT);
  const dt0 = useDaytime(timeZone);
  // Шторм у администратора — только картинка: та же буря, что у команд, кнопки и действия остаются.
  const stormSt = useStormPicture(storms, timeZone);
  const stormPic = useMemo(() => ({ active: false, t: stormSt.t }), [stormSt.t]);
  const dt = useMemo(() => (stormSt.t > 0 ? { ...dt0, light: stormLight(dt0.light, stormSt.t) } : dt0), [dt0, stormSt.t]);
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
  // Нажатия в коде (этап Э1 плана ускорения карты): области те же, что были у невидимых линий SVG — любая сторона и
  // морская переправа полосой 18 экранных пикселей, город — прямоугольником картинки; приоритет как в SVG: город выше
  // переправы, переправа выше стороны, последний в списке выше.
  const hitModel = useMemo<HitModel<{ node: MapNodeDto } | { edge: { aKey: string; bKey: string } }>>(() => {
    const CITY = size * 0.77;
    const obstacles = islets.map((i) => ({ x: i.x, y: i.y, r: i.r, shape: i.shape }));
    return {
      rects: nodes.filter((n) => n.kind === "CITY" && positions.has(n.key)).map((n) => { const p = positions.get(n.key)!; return { x: p.x - CITY / 2, y: p.y - CITY * 0.6, w: CITY, h: CITY, id: { node: n } }; }),
      routes: (progress ?? []).flatMap((tm) => tm.traversed.filter((e) => !edgeSet.has([e.fromKey, e.toKey].sort().join("|")) && positions.has(e.fromKey) && positions.has(e.toKey)).map((e) => ({ pts: routeCurve(seaRoute(landKeys, e.fromKey, e.toKey, size, undefined, obstacles), landKeys, size, obstacles), id: { edge: { aKey: e.fromKey, bKey: e.toKey } } }))),
      edges: edges.flatMap((e) => { const a = positions.get(e.aKey), b = positions.get(e.bKey); return a && b ? [{ pts: [a, b], id: { edge: { aKey: e.aKey, bKey: e.bKey } } }] : []; }),
    };
  }, [nodes, edges, positions, progress, edgeSet, landKeys, islets, size]);
  useEffect(() => { perfExpose("scene", { edges: hitModel.edges.length, routes: hitModel.routes.length, model: hitModel }); }, [hitModel]);
  const hitAt = (svg: SVGSVGElement, clientX: number, clientY: number) => {
    const host = svg.parentElement; if (!host) return null;
    const view = vp.viewRef.current;
    return hitTest(mapPoint(host, view, clientX, clientY), hitModel, 18, stylesK(svg, view.k));
  };
  const onWorldClick = (e: MouseEvent<SVGSVGElement>) => {
    if (vp.wasDrag()) return;
    const hit = hitAt(e.currentTarget, e.clientX, e.clientY);
    if (!hit) return;
    if ("node" in hit) setSelected(hit.node); else setEdgeSel(hit.edge);
  };
  const onWorldPointerMove = (e: PointerEvent<SVGSVGElement>) => { if (e.pointerType === "mouse") e.currentTarget.style.cursor = hitAt(e.currentTarget, e.clientX, e.clientY) ? "pointer" : ""; };
  // Мир на WebGL: мирового SVG нет, нажатие приходит контейнеру; значки верхнего SVG и кнопки — не наши.
  const hostHit = (host: HTMLElement, clientX: number, clientY: number) => { const view = vp.viewRef.current; return hitTest(mapPoint(host, view, clientX, clientY), hitModel, 18, view.k); };
  const foreignTarget = (t: EventTarget | null) => Boolean((t as Element | null)?.closest?.(".map-svg, button, .map-controls, .overlay-backdrop, .toasts"));
  const onHostClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!glWorld || vp.wasDrag() || foreignTarget(e.target)) return;
    const hit = hostHit(e.currentTarget, e.clientX, e.clientY);
    if (!hit) return;
    if ("node" in hit) setSelected(hit.node); else setEdgeSel(hit.edge);
  };
  const onHostPointerMove = (e: PointerEvent<HTMLDivElement>) => { if (glWorld && e.pointerType === "mouse") e.currentTarget.style.cursor = !foreignTarget(e.target) && hostHit(e.currentTarget, e.clientX, e.clientY) ? "pointer" : ""; };
  // Сцена для мира на WebGL — из тех же данных и по тем же правилам, что SVG ниже.
  const worldScene = useMemo<WorldScene>(() => {
    const text = themeColor("--text", "#1F1B16");
    const halo: [number, number, number, number] = [1, 250 / 255, 240 / 255, 0.85];
    const edgesGl: WorldScene["edges"] = [];
    for (const e of edges) {
      const a = positions.get(e.aKey), b = positions.get(e.bKey);
      if (!a || !b) continue;
      const teams = traversedBy.get([e.aKey, e.bKey].sort().join("|")) ?? [];
      if (teams.length === 0) { edgesGl.push({ a, b, line: { color: [31 / 255, 27 / 255, 22 / 255, 0.25], px: 1.5, scale: "k", cap: "butt" } }); continue; }
      const c0 = parseColor(routeColor(teams[0]!.color));
      if (teams.length === 1) { edgesGl.push({ a, b, halo: { color: halo, px: 9 }, line: { color: c0, px: 5, scale: "max16" } }); continue; }
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Две команды: подложка на всю сторону, линия первой — до середины, второй — от середины.
      edgesGl.push({ a, b, halo: { color: halo, px: 9 }, line: { color: c0, px: 5, scale: "max16" }, halfLine: m, extra: [{ a: m, b, color: parseColor(routeColor(teams[1]!.color)), px: 5 }] });
    }
    const CITY = size * 0.77, START = size * 0.9;
    const images: WorldScene["images"] = [];
    for (const n of nodes) {
      const p = positions.get(n.key); if (!p) continue;
      if (n.kind === "START") images.push({ src: IMG.start(n.teamIndex ?? 0, imgPhase), x: p.x - START / 2, y: p.y - START * 0.58, w: START, h: START });
      if (n.kind === "CITY") { const owner = ownerOf.get(n.key); images.push({ src: IMG.city(n.cityType, imgPhase), x: p.x - CITY / 2, y: p.y - CITY * 0.6, w: CITY, h: CITY, ring: owner ? { color: parseColor(owner.color), owned: true } : { color: [1, 1, 1, 0.85], owned: false } }); }
    }
    return { size, hexes: hexes.map((h) => ({ ...hexCenter(h, size), fog: false })), fogColor: [0, 0, 0, 0], gridColor: [text[0], text[1], text[2], 0.28], coast: coastLoops(coast), sand: rgb(dt.light.sand), wet: rgb(dt.light.wet), edges: edgesGl, images, camps: [] };
  }, [nodes, edges, positions, ownerOf, traversedBy, size, imgPhase, hexes, coast, dt.light]);
  const flashEl = flash && (() => { const a = positions.get(flash.aKey), b = positions.get(flash.bKey); return (
    <g className="adm-flash" pointerEvents="none">
      {a && b && <><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /></>}
      <circle className="pulse" cx={flash.x} cy={flash.y} r={size * 0.5} />
      <circle className="dot" cx={flash.x} cy={flash.y} r={size * 0.12} />
    </g>
  ); })();
  // Мир и экранные элементы — мемо по данным: фиксация масштаба не должна заново строить сотни SVG-элементов.
  const worldBody = useMemo(() => (<>
            {/* Дороги и переправы — под значками городов и стартов, иначе светлая подложка маршрута перекрывает их (замечание владельца 30.09). */}
            {edges.map((e) => {
              const a = positions.get(e.aKey), b = positions.get(e.bKey);
              if (!a || !b) return null;
              const teams = traversedBy.get([e.aKey, e.bKey].sort().join("|")) ?? [];
              // Нажатие по стороне (открывает дела на ней) считает код — hitModel, невидимой широкой линии больше нет.
              if (teams.length === 0) return <g key={e.aKey + e.bKey}><line className="adm-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} /></g>;
              // Маршруты: светлая подложка и осветлённый цвет команды, чтобы не сливались с местностью (решение владельца 30.09).
              const halo = <line className="adm-halo" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
              if (teams.length === 1) return <g key={e.aKey + e.bKey}>{halo}<line className="adm-path" x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: routeColor(teams[0]!.color) }} /></g>;
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              return <g key={e.aKey + e.bKey}>{halo}<line className="adm-path" x1={a.x} y1={a.y} x2={mx} y2={my} style={{ stroke: routeColor(teams[0]!.color) }} /><line className="adm-path" x1={mx} y1={my} x2={b.x} y2={b.y} style={{ stroke: routeColor(teams[1]!.color) }} /></g>;
            })}
            {/* Морские переправы (решение владельца 05.10) рисует слой живности; нажатие по ним считает код (hitModel). */}
            {nodes.map((n) => {
              const p = positions.get(n.key)!;
              const CITY = size * 0.77, START = size * 0.9; // решение владельца 16.09: знаки городов и стартов в полтора раза меньше прежних (1,15 и 1,35)
              if (n.kind === "START") return <image key={"s" + n.key} href={IMG.start(n.teamIndex ?? 0, imgPhase)} x={p.x - START / 2} y={p.y - START * 0.58} width={START} height={START} />;
              if (n.kind === "CITY") {
                const owner = ownerOf.get(n.key);
                // Картинка города кликабельна сама (как у команды); владелец — обводка по контуру картинки цветом команды.
                return (
                  <g key={"c" + n.key} data-key={n.key} className="m-city">
                    <image className="city-hit" href={IMG.city(n.cityType, imgPhase)} x={p.x - CITY / 2} y={p.y - CITY * 0.6} width={CITY} height={CITY} filter={owner ? `url(#outline-${owner.color.slice(1)})` : "url(#outline-free)"} />
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
                <TeamAvatar name={tm.name} color={tm.color} avatarId={tm.avatarId} size="sm" zoom={false} />
              </button>
            ))}
          </div>
        )}
        {viewAs ? (
          <div className="mapwrap team-view" key={viewAs}>
            {teamView?.error ? <div className="map-state"><ErrorState text={teamView.error} onRetry={() => setViewAs((v) => v)} /></div>
              : !teamView?.map ? <div className="map-state"><LoadingState /></div>
              : <TeamMap map={viewMap ?? teamView.map} teamIndex={teamView.map.teamIndex} selectedTaskId={teamTaskId} onSelect={(tid) => { setTeamTaskId(tid); if (tid) setSelected(null); }} onSelectCity={(key) => { const n = nodeByKey.get(key); if (n) { setSelected(n); setTeamTaskId(null); } }} storm={stormPic} onSelectWreck={(wid) => setWreckCard(wid)}
                  onMarkTap={(mk) => notify((mk.note ? t("Метка «{note}»", { note: mk.note }) : t("Метка")) + (mk.by?.name ? ` · ${mk.by.name}` : "") + (mk.createdAt ? ` · ${fmtDate(mk.createdAt)}` : ""), "info")} />}
            {teamView?.map && teamTaskId && wrapEl && (() => { const task = teamView.map!.tasks.find((tk) => tk.id === teamTaskId); return task ? <TeamTaskSheet gameId={gameId} task={task} members={teamView.map!.members ?? []} container={wrapEl} onClose={() => setTeamTaskId(null)} onReview={onReview} /> : null; })()}
          </div>
        ) : (<>
        <div ref={vp.ref} {...vp.handlers} onClick={onHostClick} onPointerMove={onHostPointerMove} className="mapwrap" style={{ background: css(dt.light.bg) }}>
          <SeaLayer vp={vp} bed={bed} light={dt.light} storm={stormSt.t} />
          <IsletsLayer vp={vp} islets={islets} size={size} coast={coast} daytime={dt} />
          <TilesLayer vp={vp} hexes={hexes} size={size} skipWater={liveWater} daytime={dt} />
          {liveWater && <LakesLayer vp={vp} hexes={hexes} size={size} onUnsupported={() => setLiveWater(false)} daytime={dt} />}
          {glWorld
            ? <WorldGL vp={vp} scene={worldScene} onUnsupported={() => setGlWorld(false)} />
            : <WorldSvg vp={vp} bounds={bounds} onClick={onWorldClick} onPointerMove={onWorldPointerMove}>
                <OutlineDefs colors={[...new Set((progress ?? []).map((tm) => tm.color))]} k={vp.view.k} />
                <HexTiles hexes={hexes} size={size} clipId="hexclip-admin" liveWater={liveWater} fills={false} />
                <CoastOver d={coast} size={size} light={dt.light} />
                {worldBody}
                {flashEl}
              </WorldSvg>}
          {/* Подписи островов рисует слой живности: киты под буквами, корабли над (решение владельца 05.10). */}
          <FaunaLayer vp={vp} hexes={hexes} islets={islets} size={size} seed={gameId} light={dt.light} fires={fires} labels={islandLabels} routes={glRoutes ? [] : routeSpecs} wrecks={wreckSpecs}
            between={glRoutes ? <RoutesGL vp={vp} routes={routeSpecs} onUnsupported={() => setGlRoutes(false)} /> : null} />
          {fireworkSites.length > 0 && !perfOff("fireworks") && <FireworksLayer vp={vp} sites={fireworkSites} clock={Date.now} timeZone={timeZone ?? "Asia/Tashkent"} />}
          {stormSt.t > 0 && <StormLayer t={stormSt.t} />}
          {/* Подписи городов и метки — отдельным слоем над живностью и маршрутами: название города выше линии корабля (решение владельца 06.10). */}
          <WorldSvg vp={vp} bounds={bounds} overlay>
            {/* Символы нужны верхнему слою; подсветка «показать на карте» при мире на WebGL живёт здесь же. */}
            <MapSymbols />
            {glWorld && flashEl}
            <g className="screen-items">
              {quarryMarker}
              {wreckSpecs.filter((w) => !(w.sunkAt != null && Date.now() - w.sunkAt > 9500)).map((w) => {
                const wd = wrecks.find((x) => x.id === w.id), r = 13, title = wd?.title ?? "", pending = wd?.pending ?? 0;
                // Есть сдачи на проверке — знак часов и их число (замечание владельца 05.11: таймер нужен и у администратора); иначе корабль с «!».
                return (
                  <g key={"wreck" + w.id} className={"m-deed sea wreck" + (pending ? " submitted" : "")} role="button" aria-label={t("Срочное задание: {title}", { title })} onClick={() => { if (!vp.wasDrag()) setWreckCard(w.id); }}>
                    <circle className="wreck-hit" cx={w.x} cy={w.y} r={size * 1.15} />
                    <g style={sc(w.x, w.y - size * 0.95)}>
                      <circle r={r} />
                      <use href={pending ? "#m-clock" : "#m-ship"} x={-r * 0.62} y={-r * 0.62} width={r * 1.24} height={r * 1.24} />
                      <g className="urgent" transform={`translate(${(r * 0.72).toFixed(1)}, ${(-r * 0.72).toFixed(1)})`}><circle r={6.5} /><text textAnchor="middle" dy="0.36em" fontSize={9.5} fontWeight={800}>{pending || "!"}</text></g>
                    </g>
                  </g>
                );
              })}
              {screenBody}
            </g>
          </WorldSvg>
        </div>
        {/* Кнопки «Вся карта» нет (решение владельца 24.10: «у админа тоже убрать»). */}
        </>)}
        {viewedTeam && fullscreen && <div className="view-as-name" aria-live="polite"><TeamAvatar name={viewedTeam.name} color={viewedTeam.color} avatarId={viewedTeam.avatarId} size="sm" teamId={viewedTeam.id} />{t("Глазами команды «{name}»", { name: viewedTeam.name })}</div>}
        {viewedTeam && !fullscreen && <p className="hint view-as-hint">{t("Карта глазами команды «{name}»: туман, стороны и метки как у неё. Нажмите свиток или город, чтобы увидеть дело или ход занятия города.", { name: viewedTeam.name })}</p>}
        {edgeSel && wrapEl && !reportId && <EdgeTasksSheet gameId={gameId} aKey={edgeSel.aKey} bKey={edgeSel.bKey} container={wrapEl} onClose={() => setEdgeSel(null)} onOpenTask={setReportId} />}
        {reportId && wrapEl && <TaskReportSheet gameId={gameId} taskId={reportId} container={wrapEl} onClose={() => { setReportId(null); setEdgeSel(null); }} onReview={onReview} />}
        {quarryOpen && wrapEl && <AdminQuarrySheet gameId={gameId} container={wrapEl} onClose={() => setQuarryOpen(false)} onReview={() => { setQuarryOpen(false); onReview?.(); }} />}
        {wreckCard && wrapEl && (() => {
          const w = wrecks.find((x) => x.id === wreckCard);
          if (!w) return null;
          return (
            <Sheet size="sm" container={wrapEl} onClose={() => setWreckCard(null)} head={<div className="sheet-title"><h2><Icon name="ship" />{w.title}</h2><Chip tone="bad" icon="alert">{t("Срочное задание")}</Chip></div>}>
              {w.sunkAt ? <p className="note warn"><Icon name="alert" /><span>{t("Корабль затонул")}</span></p> : <p className="muted small">{t("Разбитый бурей корабль: груз — {s} тёсаных камней или {b} блоков для стен (50/50 при приёме).", { s: w.cargo.stones, b: w.cargo.blocks })}</p>}
              <p className="row wrap gap-2"><Chip tone="ok" icon="check">{t("Выручили команд: {n}", { n: w.doneTeams })}</Chip>{w.pending > 0 && <Chip tone="warn" icon="clock">{t("На проверке: {n}", { n: w.pending })}</Chip>}</p>
              {w.pending > 0 && onReview && <div className="actions mt-2"><button type="button" className="secondary sm" onClick={() => { setWreckCard(null); onReview(); }}><Icon name="check" />{t("К проверке")}</button></div>}
            </Sheet>
          );
        })()}
        {selected && wrapEl && (selected.kind === "CITY"
          ? <CitySheet gameId={gameId} node={selected} version={version} container={wrapEl} revealed={revealedBy.get(selected.key) ?? []} battle={battleAt.get(selected.key) ?? null} teamById={teamById} onClose={close} onReview={onReview} />
          : <NodeSheet gameId={gameId} node={selected} container={wrapEl} teams={progress ?? []} revealed={revealedBy.get(selected.key) ?? []} onClose={close} />)}
      </div>
      {!fullscreen && legend}
    </>
  );
}

/** Панель города: ключ и шифр, состояние команд, задания с ответами (аккордеон), тестовые действия (свёрнуты). */
/** Дело на стороне «глазами команды»: что за дело, статус, кто взял, что сдано. Проверка — во вкладке «Проверка»; возвращённое принимается здесь же (13.10). */
function TeamTaskSheet({ gameId, task, members, container, onClose, onReview }: { gameId: string; task: EdgeTaskDto; members: Array<{ id: string; nickname: string; displayName: string | null }>; container: HTMLElement; onClose: () => void; onReview?: () => void }) {
  const st = deedStatus(task.status);
  const taker = task.takenById ? members.find((m) => m.id === task.takenById) : null;
  const takerName = taker ? taker.displayName ?? taker.nickname : task.takenById ? t("участник") : "";
  return (
    <Sheet size="sm" container={container} onClose={onClose} className="deed-sheet" head={<div className="sheet-title"><h2>{task.deed.title}</h2><Chip tone={st.tone} icon={st.icon}>{st.label}</Chip></div>}>
      {task.deed.description && <p className="mt-2">{task.deed.description}</p>}
      {task.person && <p className="meta-line mt-2"><Icon name="user" />{t("Кому: {name}", { name: task.person.name })}</p>}
      <p className="meta-line mt-2"><Icon name="scroll" />{t("Сдать")}: {PROOF_LABEL[task.deed.proofType]}{takerName && <> · <Icon name="user" />{t("Взял: {name}", { name: takerName })}</>}{task.submittedAt && <> · <Icon name="clock" />{fmtDate(task.submittedAt)}</>}</p>
      {task.sea && <div className="note info"><Icon name="ship" /><span>{t("Морской путь: корабль из порта. Когда дело одобрят, кормчий выберет на карте, куда высадиться на другом острове.")}</span></div>}
      {task.deed.secret && <div className="note info"><Icon name="lock" /><span>{t("Тайное дело: сдачу смотрите во вкладке «Проверка».")}</span></div>}
      {task.donation && <div className="note info"><Icon name="star" /><span>{t("Дело заменено пожертвованием{amount}.", { amount: task.donationAmount ? ` · ${task.donationAmount}` : "" })}</span></div>}
      {(() => { const names = (task.participants ?? []).filter((pid) => pid !== task.takenById).map((pid) => { const m = members.find((x) => x.id === pid); return m ? m.displayName ?? m.nickname : ""; }).filter(Boolean); return names.length > 0 ? <p className="meta-line"><Icon name="users" />{t("Участвовали: {names}", { names: names.join(", ") })}</p> : null; })()}
      {task.status === "APPROVED" && task.decidedAt && <p className="meta-line small muted"><Icon name="check" />{t("Одобрено")}: {fmtDate(task.decidedAt)}</p>}
      {task.links.length > 0 && <ul className="links">{task.links.map((l) => <li key={l}><a href={l} target="_blank" rel="noreferrer">{l}</a></li>)}</ul>}
      {task.note && <p className="mt-2 report-text">{task.note}</p>}
      {task.status === "REJECTED" && task.adminComment && <div className="note bad"><Icon name="alert" /><span>{t("Возвращено с комментарием: «{comment}»", { comment: task.adminComment })}</span></div>}
      {task.status === "REJECTED" && <ReconsiderButton gameId={gameId} taskId={task.id} onDone={onClose} />}
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
              {city.defense.wall && <Chip tone="neutral" icon="wall" title={t("Городская стена хранителей: принятые блоки стихов")}>{t("стена {n}", { n: city.defense.wall.verses })}</Chip>}
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
                <li key={tm.id} className="city-team">
                  {/* Раскрывашка команды (просьба владельца 10.10): участники и сколько заданий города каждый решил сам. */}
                  <details className="city-team-fold">
                    <summary>
                      <div className="main"><TeamAvatar name={tm.name} color={tm.color} avatarId={tm.avatarId} size="sm" withName teamId={tm.id} /></div>
                      <span className="side muted small">
                        {tm.minBid != null && <Chip icon="sword" title={t("Минимальная ставка этой команды для вызова: {n} стихов", { n: tm.minBid })}>{tm.minBid}</Chip>}
                        {tm.capturedAt ? (tm.isCapital ? t("столица здесь") : t("взяла город"))
                          : tm.orderSolved ? t("задания {a} из {b}", { a: tm.doneTasks.length, b: total })
                          : tm.orderAttempts > 0 ? t("собирает порядок районов · попыток {n}", { n: tm.orderAttempts }) : t("не начинала")}
                        <Icon name="chevron-down" className="chev" />
                      </span>
                    </summary>
                    {tm.members.length === 0 ? <p className="muted small">{t("В команде пока никого.")}</p> : (
                      <ul className="city-members">
                        {[...tm.members].sort((a, b) => b.solved - a.solved).map((m) => (
                          <li key={m.id}><span>{m.name}</span><Chip tone={m.solved >= total && total > 0 ? "ok" : m.solved > 0 ? "accent" : "neutral"} icon="scroll" title={t("Решил(а) сам(а) заданий города: {a} из {b}", { a: m.solved, b: total })}>{m.solved}/{total}</Chip></li>
                        ))}
                      </ul>
                    )}
                  </details>
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
            <div className="row mt-1">{revealed.map((tm) => <TeamAvatar key={tm.id} name={tm.name} color={tm.color} avatarId={tm.avatarId} size="sm" withName teamId={tm.id} />)}</div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

