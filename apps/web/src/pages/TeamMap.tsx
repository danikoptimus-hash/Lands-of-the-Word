import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement, type PointerEvent } from "react";
import { reportAction, reportPage } from "../lib/perf";
import { BOOKS, startName, vertexHexes, parseVertexKey, hexCorners, vertexToPixel, seaRoute, routeCurve, routeArrow, pixelToHex } from "@lotw/domain";
import { HEX_SIZE, fieldBounds, hexCenter, nodePos } from "../lib/hexmap";
import { useViewport } from "../lib/useViewport";
import { perfExpose, perfMark, perfOff } from "../lib/perfHud";
import { hitTest, mapPoint, stylesK, type HitModel } from "../lib/mapHit";
import { WorldGL, type WorldScene } from "./WorldGL";
import { coastLoops, rgb, themeColor, worldMode } from "../lib/worldScene";
import { parseColor } from "../lib/glLines";
import { FOG_COLOR } from "../lib/hexmap";
import { RoutesGL } from "./RoutesGL";
/** Морские пути на WebGL (Э3) — по умолчанию; `?routes=canvas` — прежний способ на холсте живности (и запасной путь без WebGL). */
const GL_ROUTES_DEFAULT = typeof location === "undefined" || !/[?&]routes=canvas/.test(location.search);
import type { DailyBirdDto, EdgeTaskStatus, MapHexDto, MapMarkDto, MyMapDto } from "../lib/api";
import { CoastOver, islandGeometry, FogLayer, HexTiles, IMG, MapSymbols, OutlineDefs, SeaLayer, TilesLayer, WorldSvg, useCoast, type FogClear, type FogHole } from "./MapLayers";
import { Icon, iconPath } from "../components/Icon";
import { fmtDate } from "../lib/format";
import { FaunaLayer, trimRoute, type FireSite, type WreckSpec } from "./Fauna";
import { css, stormLight, useDaytime, type Storm } from "../lib/daytime";
import { StormLayer } from "./StormLayer";
import { FireworksLayer, type FireworkSite } from "./FireworksLayer";
import { LakesLayer } from "./Lakes";
import { IsletsLayer, useIslets } from "./Islets";
import { useSeabed } from "./Seabed";
import { t, getLocale } from "../lib/i18n";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
/** Результат разведки для показа на карте: перекрёсток и что там (решение владельца 29.10). */
export interface ScoutReveal { key: string; kind: string; bookCode?: string | null; cityType?: string | null; /** Местность гексов вокруг перекрёстка: на время показа они рисуются настоящими плитками, а не серой заглушкой тумана. */ hexes?: Array<{ q: number; r: number; terrain?: string; rotation?: number }>; nonce: number }
/** Сколько окно разведки держится открытым (мс), не считая раскрытия и смыкания. */
const SCOUT_HOLD = 5000;
/** Значок метки дела по статусу: свободно — свиток, в работе — человек, на проверке — часы, возвращено — знак внимания. */
const DEED_SYMBOL: Record<EdgeTaskStatus, string> = { OPEN: "scroll", TAKEN: "user", SUBMITTED: "clock", APPROVED: "scroll", REJECTED: "alert" };
/** Оценка ширины подписи (шрифт без измерения DOM): кириллица полужирным ≈ 0.62em на знак. */
const textWidth = (s: string, fs: number) => Math.ceil(s.length * fs * 0.62);

/**
 * Карта команды на весь экран. Гексы и стороны — в масштабируемом слое,
 * значки (старт, город, метки дел, подписи) — в экранном слое постоянного размера.
 */
/** Цвет маршрута команды на карте: цвет команды, разбавленный белым, чтобы линия читалась на зелёном и песке (решение владельца 30.09). */
/**
 * Осветлённый цвет команды для маршрута: 68 % цвета + 32 % белого. Считается в JS, а не через CSS color-mix(): старые
 * браузеры (встроенный браузер MIUI, старый Android WebView) color-mix не понимают и рисовали дорогу белой (02.10).
 */
/** Хвост ломаной: последние len единиц длины до конечной точки (для хвоста чужого маршрута у города). */
function tailRoute(pts: ReadonlyArray<{ x: number; y: number }>, len: number): Array<{ x: number; y: number }> {
  if (pts.length < 2) return [...pts];
  const out: Array<{ x: number; y: number }> = [pts[pts.length - 1]!];
  let rest = len;
  for (let i = pts.length - 1; i > 0 && rest > 0; i--) {
    const a = pts[i]!, b = pts[i - 1]!, d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d <= rest) { out.unshift(b); rest -= d; }
    else { const t = rest / d; out.unshift({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); rest = 0; }
  }
  return out;
}
export const routeColor = (color: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const hex = m[1]!;
  const mix = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.68 + 255 * 0.32).toString(16).padStart(2, "0");
  return `#${mix(0)}${mix(2)}${mix(4)}`;
};
/** Точка метки: гекс и точное место нажатия дробными осевыми координатами. */
export interface MarkPoint { q: number; r: number; qf: number; rf: number }
/**
 * Что укрывает туман и что он не трогает (решение владельца 03.10): гексы тумана; перекрёстки края тумана без гекса тумана
 * рядом (берег) — под облачком; открытые перекрёстки, города со значками и дороги к ним — расчищены, дорога к ещё
 * не открытому перекрёстку расчищается не до конца (на 0,55 гекса не доходя). Чистая функция от ответа карты.
 */
export function teamFogInputs(map: Pick<MyMapDto, "hexes" | "revealed" | "edges" | "frontier">, size: number): { fogHexes: MapHexDto[]; landKeys: Set<string>; fogClear: FogClear; fogPoints: Array<{ x: number; y: number }> } {
  const fogHexes = map.hexes.filter((h) => h.lit === false);
  const landKeys = new Set(map.hexes.map((h) => `${h.q},${h.r}`));
  const revealed = new Set(map.revealed.map((n) => n.key));
  const nodes = map.revealed.map((n) => { const p = nodePos(n.key, size); return n.kind === "CITY" ? { x: p.x, y: p.y - size * 0.12, r: size * 0.72 } : n.kind === "START" ? { x: p.x, y: p.y - size * 0.1, r: size * 0.8 } : { x: p.x, y: p.y, r: size * 0.45 }; });
  const edges = map.edges.map((e) => {
    const a = nodePos(e.aKey, size), b = nodePos(e.bKey, size), ra = revealed.has(e.aKey), rb = revealed.has(e.bKey);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, k = Math.min(0.9, (len - size * 0.55) / len);
    if (ra && !rb) return { x0: a.x, y0: a.y, x1: a.x + (b.x - a.x) * k, y1: a.y + (b.y - a.y) * k };
    if (rb && !ra) return { x0: b.x, y0: b.y, x1: b.x + (a.x - b.x) * k, y1: b.y + (a.y - b.y) * k };
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  });
  const fog = new Set(fogHexes.map((h) => `${h.q},${h.r}`));
  const fogPoints = (map.frontier ?? []).filter((k) => !vertexHexes(parseVertexKey(k)).some((h) => fog.has(`${h.q},${h.r}`))).map((k) => nodePos(k, size));
  return { fogHexes, landKeys, fogClear: { nodes, edges }, fogPoints };
}

export function TeamMap({ map, teamIndex, selectedTaskId, onSelect, onSelectCity, landing, onLand, onMark, onMarkTap, onFrontierTap, onSelectQuarry, onSelectWreck, bird, focusTask, storm, scout }: { /** Нажатие на разбитый бурей корабль (решение владельца 04.11): лист срочного задания. */ onSelectWreck?: (wreckId: string) => void; /** Разведка (решение владельца 29.10): туман вокруг перекрёстка раздвигается на пять секунд и показывает, что там. */ scout?: ScoutReveal | null; /** Шторм (решение владельца 24.10): буря над картой, свитки и метки скрыты, города не нажимаются. */ storm?: Storm; /** «Посмотреть на карте» (просьба владельца 10.10): при смене nonce карта центрируется на стороне этого дела и приближается. */ focusTask?: { id: string; nonce: number } | null; /** Полёт клина, если страница запрашивает его отдельно к назначенной минуте; undefined — брать из map.dailyBird. */ bird?: DailyBirdDto | null; /** Нажатие на островок Каменоломни (решение владельца 04.10). */ onSelectQuarry?: () => void; /** Нажатие на точку края тумана, к которой нет дороги с делом (решение владельца 02.10: разведчик разведывает любой узел на краю тумана). */ onFrontierTap?: (nodeKey: string) => void; map: MyMapDto; teamIndex: number; selectedTaskId: string | null; onSelect: (taskId: string | null) => void; onSelectCity: (nodeKey: string) => void; /** Метки команды: кнопка-булавка включает режим, нажатие по карте отдаёт гекс и точное место (дробные координаты); нажатие на флажок — убрать. */ onMark?: (at: MarkPoint) => void; onMarkTap?: (mark: MapMarkDto) => void; /** Режим высадки: узлы-кандидаты другого острова подсвечены, нажатие — высадка (только капитан). */ landing?: { taskId: string; candidates: string[] } | null; onLand?: (nodeKey: string) => void }) {
  const size = HEX_SIZE;
  const hexKey = map.hexes.map((h) => `${h.q},${h.r}`).join(";");
  const bounds = useMemo(() => (map.hexes.length ? fieldBounds(map.hexes, size) : null), [hexKey, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = useMemo(() => (map.team.startNodeKey ? nodePos(map.team.startNodeKey, size) : null), [map.team.startNodeKey, size]);
  const renderStart = performance.now();
  useLayoutEffect(() => { perfMark("карта команды: React+DOM", performance.now() - renderStart); });
  useEffect(() => { perfMark("карта команды: до кадра", performance.now() - renderStart); });
  // Участникам можно приблизить карту сильнее (решение владельца 30.10: «сделать возможность приближать карту ближе»).
  const vp = useViewport(bounds, start ? { x: start.x, y: start.y, k: 2.4 } : null, { maxZoom: 14 });
  /** Подсветка стороны после «Посмотреть на карте» (решение владельца 30.10: как у администратора): дорога и пульсирующее кольцо посередине несколько секунд. */
  const [flash, setFlash] = useState<{ x: number; y: number; a: { x: number; y: number }; b: { x: number; y: number } | null } | null>(null);
  useEffect(() => {
    if (!focusTask) return;
    const tk = map.tasks.find((x) => x.id === focusTask.id);
    if (!tk) return;
    const a = nodePos(tk.fromKey, size);
    const sea = tk.toKey.startsWith("sea:");
    const b = sea ? a : nodePos(tk.toKey, size);
    const k = 3.5, x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    vp.focusOn(x, y, k);
    setFlash({ x, y, a, b: sea ? null : b });
    const flashTimer = setTimeout(() => setFlash(null), 6000);
    // Карточка дела выезжает снизу и закрывает часть карты: когда она встала, точку переносим в середину свободной части.
    const timer = setTimeout(() => {
      const canvas = document.querySelector(".map-canvas"), sheet = document.querySelector(".deed-sheet");
      if (!canvas || !sheet) return;
      const c = canvas.getBoundingClientRect(), r = sheet.getBoundingClientRect();
      if (r.top > c.top + c.height * 0.25 && r.top < c.bottom) vp.focusOn(x, y + (c.bottom - r.top) / 2 / k, k);
    }, 700);
    return () => { clearTimeout(timer); clearTimeout(flashTimer); };
  }, [focusTask?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  // Время суток (решение владельца 03.10): по поясу игры и часам сервера; картинки городов — фазы, которой больше в переходе.
  const dt = useDaytime(map.daytime?.timeZone, map.now);
  // Шторм поверх времени суток: свинцовая вода и серая мгла по доле шторма (плавный вход и выход).
  const light = storm && storm.t > 0 ? stormLight(dt.light, storm.t) : dt.light;
  const dts = light === dt.light ? dt : { ...dt, light };
  const imgPhase = dt.t >= 0.5 ? dt.to : dt.from;
  // Полоска внизу экрана на Android (замечание владельца 24.10): браузер красит область жестовой панели в цвет фона
  // страницы (бумага). Пока открыта карта, фон страницы и theme-color — цвет воды текущего освещения, полоска сливается с морем.
  useEffect(() => {
    const body = document.body, meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevMeta = meta?.getAttribute("content") ?? null;
    body.classList.add("map-open");
    return () => { body.classList.remove("map-open"); body.style.removeProperty("--map-under"); if (meta && prevMeta !== null) meta.setAttribute("content", prevMeta); };
  }, []);
  useEffect(() => {
    const color = css(light.mid);
    document.body.style.setProperty("--map-under", color);
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", color);
  }, [light]);
  // Салют над городами, взятыми сегодня (решение владельца 24.10): точка запуска — над значком города.
  const fireworkSites = useMemo<FireworkSite[]>(() => (map.cities ?? []).filter((c) => c.takenAt).map((c) => { const p = nodePos(c.nodeKey, size); return { key: c.nodeKey, x: p.x, y: p.y - size * 0.3, at: Date.parse(c.takenAt!) }; }), [map.cities, size]);
  const fires = useMemo<FireSite[]>(() => map.revealed.filter((n) => n.kind === "CITY" || n.kind === "START").map((n) => { const p = nodePos(n.key, size); return { x: p.x, y: p.y - size * 0.08, r: size * (n.kind === "START" ? 0.45 : 0.38) }; }), [map.revealed, size]);
  const revealed = useMemo(() => new Set(map.revealed.map((n) => n.key)), [map.revealed]);
  // Разбитые бурей корабли (решение владельца 04.11): место — гекс от сервера; починка от момента одобрения, гибель — от closedAt.
  const wreckSpecs = useMemo<WreckSpec[]>(() => (map.wrecks ?? []).map((w) => { const c = hexCenter(w, size); return { id: w.id, x: c.x, y: c.y, kind: (w.model % 3) as 0 | 1 | 2, seed: w.seed, repairedAt: w.mine?.status === "APPROVED" && w.mine.decidedAt ? Date.parse(w.mine.decidedAt) : null, sunkAt: w.sunkAt ? Date.parse(w.sunkAt) : null }; }), [map.wrecks, size]);
  // Маркер корабля гаснет, когда он уплыл или ушёл под воду: секунды от часов сервера, тик раз в две секунды, пока есть такие корабли.
  const [wreckTick, setWreckTick] = useState(0);
  useEffect(() => {
    if (!wreckSpecs.some((w) => w.repairedAt != null || w.sunkAt != null)) return;
    const timer = setInterval(() => setWreckTick((v) => v + 1), 2000);
    return () => clearInterval(timer);
  }, [wreckSpecs]);
  const cityByKey = useMemo(() => new Map((map.cities ?? []).map((c) => [c.nodeKey, c])), [map.cities]);
  const taskByEdge = useMemo(() => {
    const m = new Map<string, (typeof map.tasks)[number]>();
    for (const tk of map.tasks) m.set([tk.fromKey, tk.toKey].sort().join("|"), tk);
    return m;
  }, [map.tasks]);
  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of map.revealed) m.set(n.key, nodePos(n.key, size));
    for (const e of map.edges) { if (!m.has(e.aKey)) m.set(e.aKey, nodePos(e.aKey, size)); if (!m.has(e.bKey)) m.set(e.bKey, nodePos(e.bKey, size)); }
    return m;
  }, [map, size]);
  const [ripple, setRipple] = useState<{ x: number; y: number; n: number } | null>(null);
  /**
   * Метка ставится долгим нажатием на карту (решение владельца 29.10: кнопка-булавка убрана, «метка будет ставиться при
   * долгом нажатии»). Палец или курсор держится ~0,6 с без сдвига; второй палец, сдвиг или отпускание отменяют. Точка
   * экрана → точка карты (w·k + t = px) → ближайший гекс, не дальше радиуса гекса; метка прилипает к ближайшему
   * перекрёстку (решение владельца 15.10). Кнопки и листы внутри карты не считаются. После срабатывания клик гасится.
   */
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const swallowClick = useRef(false);
  const LONG_PRESS_MS = 600;
  const markAtPoint = (host: HTMLElement, clientX: number, clientY: number) => {
    const rect = host.getBoundingClientRect(), v = vp.viewRef.current;
    const x = (clientX - rect.left - v.tx) / v.k, y = (clientY - rect.top - v.ty) / v.k;
    let best: { q: number; r: number } | null = null, bd = Infinity;
    for (const h of map.hexes) { const c = hexCenter(h, size); const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = h; } }
    if (!best || bd > (size * 1.1) ** 2) return;
    let px = x, py = y, vd = Infinity;
    for (const c of hexCorners(best)) { const p = vertexToPixel(c, size); const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < vd) { vd = d; px = p.x; py = p.y; } }
    const rf = py / (1.5 * size), qf = px / (Math.sqrt(3) * size) - rf / 2;
    reportAction("map-mark", "map");
    try { navigator.vibrate?.(20); } catch { /* не везде */ }
    onMark?.({ q: best.q, r: best.r, qf, rf });
  };
  const cancelPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  const onPressDown = (e: PointerEvent<HTMLDivElement>) => {
    vp.handlers.onPointerDown(e);
    cancelPress();
    if (!onMark || storm?.active || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, .overlay-backdrop, .map-controls")) return;
    const host = e.currentTarget, x = e.clientX, y = e.clientY;
    press.current = { x, y, timer: window.setTimeout(() => { press.current = null; if (vp.wasDrag()) return; swallowClick.current = true; markAtPoint(host, x, y); }, LONG_PRESS_MS) };
  };
  const onPressMove = (e: PointerEvent<HTMLDivElement>) => { const p = press.current; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) cancelPress(); };
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => { if (swallowClick.current) { swallowClick.current = false; e.stopPropagation(); e.preventDefault(); } };
  // Часы сервера для живности: смещение от местных часов по времени из ответа карты.
  const clockOff = useRef(0);
  useEffect(() => { if (map.now) clockOff.current = map.now - Date.now(); }, [map.now]);
  const serverClock = useCallback(() => Date.now() + clockOff.current, []);
  useEffect(() => { reportPage("map"); }, []);
  const coast = useCoast(map.hexes, size);
  const islets = useIslets(map.hexes, size, bounds);
  const bed = useSeabed(map.hexes, islets, size, bounds);
  const [liveWater, setLiveWater] = useState(true);
  // Мир на WebGL (этап Э2): по `?map=gl`; без WebGL или при потере контекста — обратно к SVG.
  const [glWorld, setGlWorld] = useState(() => worldMode() === "gl");
  const [glRoutes, setGlRoutes] = useState(GL_ROUTES_DEFAULT);
  const owners = useMemo(() => [...new Set((map.cities ?? []).flatMap((c) => (c.owner ? [c.owner.color] : [])))], [map.cities]);
  // Входы тумана считает общая функция (`teamFogInputs`): ею же пользуется заготовка карты на главной.
  const fog = useMemo(() => teamFogInputs(map, size), [map.hexes, map.revealed, map.edges, map.frontier, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const { fogHexes, landKeys, fogClear, fogPoints } = fog;
  // Окно разведки: по смене nonce открывается на 5 с (плюс раскрытие и смыкание), пока открыто — поверх тумана город с названием или пустой перекрёсток.
  const [hole, setHole] = useState<FogHole | null>(null);
  const [scoutShown, setScoutShown] = useState<(ScoutReveal & { on: boolean }) | null>(null);
  useEffect(() => {
    if (!scout) return;
    const p = nodePos(scout.key, size);
    const h: FogHole = { x: p.x, y: p.y - size * 0.15, r: size * 1.15, start: performance.now(), hold: SCOUT_HOLD };
    setHole(h); setScoutShown({ ...scout, on: false });
    const t1 = setTimeout(() => setScoutShown((v) => (v ? { ...v, on: true } : v)), 30);
    const t2 = setTimeout(() => setScoutShown((v) => (v ? { ...v, on: false } : v)), 700 + SCOUT_HOLD);
    const t3 = setTimeout(() => { setHole(null); setScoutShown(null); }, 700 + SCOUT_HOLD + 800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [scout?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  // Пока окно разведки открыто, гексы вокруг перекрёстка получают местность из ответа разведки и рисуются плитками
  // (замечание владельца 29.10: под раздвинутым туманом была серая заглушка). Сам туман считается по map.hexes и не меняется.
  const tileHexes = useMemo(() => {
    const peekHexes = hole ? scoutShown?.hexes : undefined;
    if (!peekHexes?.length) return map.hexes;
    const known = new Map(peekHexes.map((h) => [`${h.q},${h.r}`, h] as const));
    return map.hexes.map((h) => { const k = h.lit === false ? known.get(`${h.q},${h.r}`) : undefined; return k?.terrain ? { ...h, terrain: k.terrain, rotation: k.rotation, lit: true, peek: true } : h; });
  }, [map.hexes, hole, scoutShown?.hexes]);
  // Центры островов: для подписей «Ветхий Завет» / «Новый Завет» и для корабля (он стоит с морской стороны порта).
  const islandCenters = useMemo(() => islandGeometry(map.hexes, size), [map.hexes, size]);
  const nodeByKey = useMemo(() => new Map(map.revealed.map((n) => [n.key, n])), [map.revealed]);
  const fullLabelsNow = vp.view.k >= 1.6;
  const islandLabels = useMemo(() => (!fullLabelsNow && islandCenters.has("NT") ? [...islandCenters].map(([isl, c]) => ({ x: c.x, y: c.y, r: c.r + size * 4, name: isl === "OT" ? t("Ветхий Завет") : t("Новый Завет") })) : []), [fullLabelsNow, islandCenters, size]);
  // Морские маршруты (решение владельца 05.10): после высадки путь корабля виден команде — плавная линия строго по воде,
  // в обход островков, со стрелкой в сторону высадки; нажимается, как пройденная сторона.
  const seaRoutes = useMemo(() => {
    const obstacles = islets.map((i) => ({ x: i.x, y: i.y, r: i.r, shape: i.shape }));
    return map.tasks.filter((tk) => tk.sea && tk.status === "APPROVED" && !tk.toKey.startsWith("sea:")).map((tk) => {
      const pts = routeCurve(seaRoute(landKeys, tk.fromKey, tk.toKey, size, undefined, obstacles), landKeys, size, obstacles);
      const arrow = routeArrow(pts, size * 1.1);
      return { tk, pts, end: { x: arrow.x, y: arrow.y }, heading: arrow.heading };
    });
  }, [map.tasks, landKeys, islets, size]);
  // Видимая линия переправы рисуется слоем живности между зверями и кораблями (решение владельца 06.10); нажатие по ней считает код (hitModel).
  // Концы линии укорочены, чтобы не заходить под знак порта и города (замечание владельца 06.10: города выше маршрута).
  // Чужая высадка (решение владельца 12.10, вместо точек команд в подписи): у города виден только хвост маршрута
  // корабля другой команды — последний отрезок длиной около гекса, в её цвете и со стрелкой к месту высадки.
  const foreignStubs = useMemo(() => {
    const obstacles = islets.map((i) => ({ x: i.x, y: i.y, r: i.r, shape: i.shape }));
    // Порт отправления чужого корабля команде обычно неизвестен — нужен только известный узел высадки.
    return (map.foreign ?? []).filter((f) => f.sea && positions.has(f.bKey)).map((f) => {
      const pts = routeCurve(seaRoute(landKeys, f.aKey, f.bKey, size, undefined, obstacles), landKeys, size, obstacles);
      const arrow = routeArrow(pts, size * 1.1);
      const tail = trimRoute(tailRoute(pts, size * 2.2), 0, nodeByKey.get(f.bKey)?.kind === "CITY" ? size * 0.5 : size * 0.2);
      return { pts: tail, color: routeColor(f.color), arrow: { x: arrow.x, y: arrow.y, heading: arrow.heading } };
    });
  }, [map.foreign, positions, landKeys, islets, size, nodeByKey]);
  const routeSpecs = useMemo(() => [...seaRoutes.map((r) => ({ pts: trimRoute(r.pts, size * 0.5, nodeByKey.get(r.tk.toKey)?.kind === "CITY" ? size * 0.5 : size * 0.2), color: routeColor(map.team.color), selected: r.tk.id === selectedTaskId, arrow: { x: r.end.x, y: r.end.y, heading: r.heading } })), ...foreignStubs], [seaRoutes, foreignStubs, map.team.color, selectedTaskId, nodeByKey, size]);
  // Корабли: морские дела, пока команда не высадилась (после высадки дело — обычная пройденная сторона).
  const ships = useMemo(() => map.tasks.filter((tk) => tk.sea && (tk.status !== "APPROVED" || tk.landing)).map((tk) => {
    const p = nodePos(tk.fromKey, size), c = islandCenters.get(nodeByKey.get(tk.fromKey)?.island ?? "OT") ?? { x: 0, y: 0 };
    const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy) || 1;
    return { tk, x: p.x + (dx / d) * size * 1.6, y: p.y + (dy / d) * size * 1.6, port: p };
  }), [map.tasks, islandCenters, nodeByKey, size]);


  // Полёт клина к ближайшему неоткрытому городу команды (раз в час): время и узел от сервера, одни для всей команды.
  // Цель полёта известна только в окне полёта (решение владельца 05.10): без ключа узла клин не летит.
  const birdSrc = bird !== undefined ? bird : map.dailyBird;
  const daily = useMemo(() => (birdSrc?.key ? { at: birdSrc.at, to: nodePos(birdSrc.key, size) } : null), [birdSrc, size]);
  const { k } = vp.view;
  // Элементы постоянного экранного размера (подписи, метки, развилки) стоят в координатах карты со scale(1/k):
  // при перетаскивании их двигает композитор, при смене масштаба React пересчитывает 1/k.
  // При отдалении метки, подписи и точки уменьшаются вместе с картой (до половины), чтобы не закрывать гексы.
  const ui = Math.min(1, Math.max(0.5, k / 1.6));
  const inv = ui / k;
  const click = (taskId: string) => { if (!vp.wasDrag()) onSelect(selectedTaskId === taskId ? null : taskId); };
  const clickCity = (key: string) => {
    if (vp.wasDrag()) return;
    const p = positions.get(key); if (p) setRipple((r) => ({ x: p.x, y: p.y, n: (r?.n ?? 0) + 1 }));
    onSelectCity(key);
  };
  const R = k >= 1.6 ? 12 : 9;
  // Уровни детализации: при отдалении метки дел прячутся, подписи городов становятся короче и мельче.
  const showMarkers = k >= 0.9, fullLabels = k >= 1.6, showForks = k >= 0.7;
  // Город масштабируется с картой: сидит на перекрёстке и занимает место до середины трёх сторон.
  const CITY = size * 0.77, START = size * 0.9; // решение владельца 16.09: знаки городов и стартов в полтора раза меньше прежних (1,15 и 1,35)
  // Нажатия в коде (этап Э1 плана ускорения карты): области те же, что были у невидимых линий SVG — взятая или пройденная
  // сторона и морской путь полосой 22 экранных пикселя, город — прямоугольником картинки; приоритет — как в SVG:
  // город выше пути, путь выше стороны, последний в списке выше. Подписи, значки и метки — по-прежнему элементы верхнего SVG.
  const hitModel = useMemo<HitModel<{ task: string } | { city: string }>>(() => ({
    rects: map.revealed.filter((n) => n.kind === "CITY").map((n) => { const p = positions.get(n.key)!; return { x: p.x - CITY / 2, y: p.y - CITY * 0.6, w: CITY, h: CITY, id: { city: n.key } }; }),
    routes: seaRoutes.map((r) => ({ pts: r.pts, id: { task: r.tk.id } })),
    edges: map.edges.flatMap((e) => { const tk = taskByEdge.get([e.aKey, e.bKey].sort().join("|")); return tk ? [{ pts: [positions.get(e.aKey)!, positions.get(e.bKey)!], id: { task: tk.id } }] : []; }),
  }), [map.revealed, map.edges, positions, seaRoutes, taskByEdge, CITY]);
  useEffect(() => { perfExpose("scene", { edges: hitModel.edges.length, routes: hitModel.routes.length, model: hitModel }); }, [hitModel]);
  const hitAt = (svg: SVGSVGElement, clientX: number, clientY: number) => {
    const host = svg.parentElement; if (!host) return null;
    const view = vp.viewRef.current;
    return hitTest(mapPoint(host, view, clientX, clientY), hitModel, 22, stylesK(svg, view.k));
  };
  const onWorldClick = (e: MouseEvent<SVGSVGElement>) => {
    if (vp.wasDrag()) return;
    const hit = hitAt(e.currentTarget, e.clientX, e.clientY);
    if (!hit) return;
    if ("city" in hit) clickCity(hit.city); else click(hit.task);
  };
  // Курсор-рука над областью нажатия (мышь): раньше её давали невидимые линии.
  const onWorldPointerMove = (e: PointerEvent<SVGSVGElement>) => { if (e.pointerType === "mouse") e.currentTarget.style.cursor = hitAt(e.currentTarget, e.clientX, e.clientY) ? "pointer" : ""; };
  // Мир на WebGL: мирового SVG нет, нажатие приходит контейнеру; значки и подписи верхнего SVG и кнопки — не наши.
  const hostHit = (host: HTMLElement, clientX: number, clientY: number) => { const view = vp.viewRef.current; return hitTest(mapPoint(host, view, clientX, clientY), hitModel, 22, view.k); };
  const foreignTarget = (t: EventTarget | null) => Boolean((t as Element | null)?.closest?.(".map-svg, button, .map-controls, .overlay-backdrop, .toasts"));
  const onHostClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!glWorld || vp.wasDrag() || foreignTarget(e.target)) return;
    const hit = hostHit(e.currentTarget, e.clientX, e.clientY);
    if (!hit) return;
    if ("city" in hit) clickCity(hit.city); else click(hit.task);
  };
  const onHostPointerMove = (e: PointerEvent<HTMLDivElement>) => { if (glWorld && e.pointerType === "mouse") e.currentTarget.style.cursor = !foreignTarget(e.target) && hostHit(e.currentTarget, e.clientX, e.clientY) ? "pointer" : ""; };
  /** Экранный элемент в точке карты: сдвиг в единицах карты, размер — через --inv (ставится на каждый кадр жеста), extra — после масштаба. */
  const sc = (x: number, y: number, extra = "") => ({ transform: `translate(${x}px, ${y}px) scale(var(--inv, 1))${extra ? " " + extra : ""}` });

  // Мир и экранные элементы — мемо по данным: фиксация масштаба (vp.view) не должна заново строить сотни SVG-элементов;
  // масштаб деталей идёт через CSS-переменные, пороги детализации — через флаги.
  // Чужие проходы (решение владельца 18.09): сторона, пройденная другой командой, красится её цветом; пройденная
  // двумя командами — пополам: своя половина от известного перекрёстка, чужая — дальше.
  const foreignByEdge = useMemo(() => {
    const m = new Map<string, Array<{ color: string }>>();
    for (const f of map.foreign ?? []) { const k = [f.aKey, f.bKey].sort().join("|"); const list = m.get(k) ?? []; if (!list.some((x) => x.color === f.color)) list.push({ color: f.color }); m.set(k, list); }
    return m;
  }, [map.foreign]);
  // Шатёр у ворот (решение владельца 03.11: сначала «кольцо под городом», затем «давай переделаем с дуг на вариант шатёр
  // у ворот»): у своего города на каждой пройденной чужой стороне — шатёр цвета той команды, по одному на команду и дорогу.
  // Косая дорога — шатёр у бока картинки с её стороны, вертикальная — над картинкой или у её основания: так он не прячется
  // под подписью и значками дел ни при каком масштабе.
  const campsAt = useMemo(() => {
    const m = new Map<string, Array<{ color: string; ux: number; uy: number }>>();
    for (const f of map.foreign ?? []) for (const [k, o] of [[f.aKey, f.bKey], [f.bKey, f.aKey]] as const) {
      // Дальний конец (порт за морем, неразведанный угол) может не иметь записи в positions — координаты из ключа.
      const p = positions.get(k) ?? nodePos(k, size), q = positions.get(o) ?? nodePos(o, size);
      const l = Math.hypot(q.x - p.x, q.y - p.y) || 1, ux = (q.x - p.x) / l, uy = (q.y - p.y) / l;
      const list = m.get(k) ?? [];
      if (!list.some((c) => c.color === f.color && Math.abs(c.ux - ux) < 0.2 && Math.abs(c.uy - uy) < 0.2)) list.push({ color: f.color, ux, uy });
      m.set(k, list);
    }
    return m;
  }, [map.foreign, positions, size]);
  // Шатёр не ставится на воду (замечание владельца 03.11): суша — гексы карты без озёр.
  const tentLand = useMemo(() => new Set(map.hexes.filter((h) => h.terrain !== "water").map((h) => `${h.q},${h.r}`)), [map.hexes]);
  const tentOnLand = (x: number, y: number) => { const h = pixelToHex({ x, y }, size); return tentLand.has(`${h.q},${h.r}`); };
  /** Шатры у ворот своего города: опорная точка на дороге (единицы карты) и сдвиг в экранных пикселях — общий расчёт для SVG и WebGL. */
  const campSpots = (key: string, p: { x: number; y: number }) => {
    const out: Array<{ key: string; bx: number; by: number; dx: number; dy: number; color: string }> = [], used = new Map<string, number>();
    for (const g of campsAt.get(key) ?? []) {
      const roadKey = `${Math.round(g.ux * 10)},${Math.round(g.uy * 10)}`;
      const i = used.get(roadKey) ?? 0; used.set(roadKey, i + 1);
      const down = g.uy > 0.9, along = 0.55 * CITY + 0.45 * CITY * Math.floor(i / 2), push = down ? 20 : 8, side = down ? 16 : 14;
      const bx = p.x + g.ux * along, by = p.y + g.uy * along;
      const nx = -g.uy, ny = g.ux;
      let sgn = (ny <= 0 ? 1 : -1) * (i % 2 === 0 ? 1 : -1);
      if (!tentOnLand(bx + nx * sgn * 0.3 * CITY, by + ny * sgn * 0.3 * CITY) && tentOnLand(bx - nx * sgn * 0.3 * CITY, by - ny * sgn * 0.3 * CITY)) sgn = -sgn;
      out.push({ key: g.color + roadKey, bx, by, dx: g.ux * push + nx * sgn * side, dy: g.uy * push + ny * sgn * side, color: g.color });
    }
    return out;
  };
  // Сцена для мира на WebGL — из тех же данных и по тем же правилам, что SVG ниже (туман, контуры, берег, стороны, города, шатры).
  const worldScene = useMemo<WorldScene>(() => {
    const text = themeColor("--text", "#1F1B16"), paper = themeColor("--map-paper", "#FFF6E3"), surface = themeColor("--surface", "#FFFFFF");
    const teamLine = parseColor(routeColor(map.team.color));
    const edges: WorldScene["edges"] = map.edges.map((e) => {
      const a = positions.get(e.aKey)!, b = positions.get(e.bKey)!;
      const key = [e.aKey, e.bKey].sort().join("|");
      const tk = taskByEdge.get(key), done = tk?.status === "APPROVED", active = tk && !done, sel = tk?.id === selectedTaskId;
      const others = foreignByEdge.get(key) ?? [];
      const from = done ? 0.5 : 0, span = (1 - from) / Math.max(1, others.length);
      const pt = (tt: number) => ({ x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt });
      const line: NonNullable<WorldScene["edges"][number]["line"]> = done ? { color: teamLine, px: 6, scale: "max16" } : sel ? { color: surface, px: 5, scale: "max16" } : active ? { color: paper, px: 3, scale: "max16", dash: true } : { color: [1, 1, 1, 0.25], px: 3, scale: "max16" };
      return { a, b, halo: done || others.length > 0 ? { color: [1, 250 / 255, 240 / 255, 0.85], px: 10 } : undefined, line, extra: others.map((o, i) => { const c = parseColor(routeColor(o.color)); return { a: pt(from + span * i), b: pt(from + span * (i + 1)), color: [c[0], c[1], c[2], 0.85] as [number, number, number, number], px: 3 }; }) };
    });
    const images: WorldScene["images"] = [], camps: WorldScene["camps"] = [];
    for (const n of map.revealed) {
      const p = positions.get(n.key)!;
      if (n.kind === "START") images.push({ src: IMG.start(teamIndex, imgPhase), x: p.x - START / 2, y: p.y - START * 0.58, w: START, h: START });
      if (n.kind === "CITY") {
        const c = cityByKey.get(n.key);
        images.push({ src: IMG.city(n.cityType, imgPhase), x: p.x - CITY / 2, y: p.y - CITY * 0.6, w: CITY, h: CITY, ring: c?.owner ? { color: parseColor(c.owner.color), owned: true } : { color: [1, 1, 1, 0.85], owned: false } });
        if (c?.owner && c.captured) for (const g of campSpots(n.key, p)) camps.push({ x: g.bx, y: g.by, dx: g.dx, dy: g.dy, color: parseColor(g.color) });
      }
    }
    return {
      size,
      hexes: tileHexes.map((h) => ({ ...hexCenter(h, size), fog: !h.lit && h.lit !== undefined })),
      fogColor: parseColor(FOG_COLOR), gridColor: [text[0], text[1], text[2], 0.28],
      coast: coastLoops(coast), sand: rgb(light.sand), wet: rgb(light.wet),
      edges, images, camps,
    };
  }, [map.edges, map.revealed, taskByEdge, selectedTaskId, positions, cityByKey, teamIndex, size, map.team.color, foreignByEdge, campsAt, tentLand, imgPhase, tileHexes, coast, light]); // eslint-disable-line react-hooks/exhaustive-deps
  const worldBody = useMemo(() => (<>
        {map.edges.map((e) => {
          const a = positions.get(e.aKey)!, b = positions.get(e.bKey)!;
          const key = [e.aKey, e.bKey].sort().join("|");
          const tk = taskByEdge.get(key);
          const done = tk?.status === "APPROVED";
          const active = tk && !done;
          const sel = tk?.id === selectedTaskId;
          const cls = done ? "done" : sel ? "sel" : active ? "active" : "idle";
          const others = foreignByEdge.get(key) ?? [];
          // Чужие отрезки: если сторона пройдена и нами — вторая половина, иначе вся сторона, поделённая между командами.
          const from = done ? 0.5 : 0, span = (1 - from) / Math.max(1, others.length);
          const pt = (tt: number) => ({ x: a.x + (b.x - a.x) * tt, y: a.y + (b.y - a.y) * tt });
          return (
            <g key={e.aKey + e.bKey} className={"m-edge " + cls}>
              {/* Нажатие по взятой или пройденной стороне (решение владельца 30.09) — считает код (hitModel), невидимой линии нет. */}
              {/* Пройденные стороны: светлая подложка и осветлённый цвет команды, чтобы маршрут не сливался с местностью (решение владельца 30.09). */}
              {(done || others.length > 0) && <line className="halo" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />}
              <line className={active && !sel ? "dashed" : undefined} x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={done ? { stroke: routeColor(map.team.color) } : undefined} />
              {others.map((o, i) => { const p1 = pt(from + span * i), p2 = pt(from + span * (i + 1)); return <line key={o.color} className="foreign" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} style={{ stroke: routeColor(o.color) }} />; })}
            </g>
          );
        })}
        {map.revealed.map((n) => {
          const p = positions.get(n.key)!;
          if (n.kind === "START") return <image key={"s" + n.key} href={IMG.start(teamIndex, imgPhase)} x={p.x - START / 2} y={p.y - START * 0.58} width={START} height={START} />;
          if (n.kind === "CITY") {
            const c = cityByKey.get(n.key);
            return (
              <g key={"c" + n.key} className="m-city">
                <image className="city-hit" href={IMG.city(n.cityType, imgPhase)} x={p.x - CITY / 2} y={p.y - CITY * 0.6} width={CITY} height={CITY} filter={c?.owner ? `url(#outline-${c.owner.color.slice(1)})` : "url(#outline-free)"} />
                {/* Свой город — по признаку captured, а не по индексу владельца: у администратора «глазами команды» индексы
                    могли расходиться, и шатров не было (замечание владельца 04.11). */}
                {c?.owner && c.captured && (() => {
                  // Шатёр стоит у своей дороги (требование владельца 03.11: «ВСЕГДА возле дороги, с которой подошли»): опорная точка
                  // на дороге у края картинки города (единицы карты), от неё — сдвиг в пикселях экрана: вдоль дороги 8px (у
                  // вертикальной вниз 20px — мимо подписи) и вбок 14px — мимо значка дела. Сдвиг экранный, а не в единицах
                  // карты: при сильном приближении шатёр оставался бы у соседнего узла (замечание владельца 03.11: «синий шатёр
                  // у узла, а не города»). Сторона сдвига — где суша (выше дороги в первую очередь); второй шатёр на той же дороге —
                  // с другой стороны, третий — дальше по дороге. Размер 9px, постоянный на экране (scale(--inv)).
                  const out: ReactElement[] = [];
                  for (const g of campSpots(n.key, p)) {
                    out.push(
                      <g key={g.key} className="camp" style={{ transform: `translate(${g.bx.toFixed(2)}px, ${g.by.toFixed(2)}px) scale(var(--inv, 1))` }}>
                        <g transform={`translate(${g.dx.toFixed(1)}, ${g.dy.toFixed(1)})`}>
                          {/* Вдвое меньше прежнего (решение владельца 03.11: «значки шатров сделаем в два раза меньше»). */}
                          <path d="M-4.75,4 L0,-4.75 L4.75,4 Z" style={{ fill: g.color }} />
                          <path className="door" d="M-1.35,4 L0,0.8 L1.35,4 Z" />
                        </g>
                      </g>,
                    );
                  }
                  return out;
                })()}
              </g>
            );
          }
          return null;
        })}
  </>), [map.edges, map.revealed, taskByEdge, selectedTaskId, positions, cityByKey, teamIndex, size, map.team.color, foreignByEdge, campsAt, tentLand, imgPhase, seaRoutes]); // eslint-disable-line react-hooks/exhaustive-deps
  // Каменоломня (решение владельца 04.10): скалистый островок с подписью, нажимается — открывает лист общих дел.
  const flashEl = flash && (
    <g className="adm-flash" pointerEvents="none">
      {flash.b && <><line x1={flash.a.x} y1={flash.a.y} x2={flash.b.x} y2={flash.b.y} /><line x1={flash.a.x} y1={flash.a.y} x2={flash.b.x} y2={flash.b.y} /></>}
      <circle className="pulse" cx={flash.x} cy={flash.y} r={size * 0.5} />
      <circle className="dot" cx={flash.x} cy={flash.y} r={size * 0.12} />
    </g>
  );
  const quarry = islets.find((i) => i.quarry) ?? null;
  const quarryMarker = quarry && (() => {
    const name = t("Каменоломня"), fs = fullLabels ? 12 : 10, w = Math.ceil(name.length * fs * 0.62) + 34, h = fs + 12;
    return (
      <g className="m-quarry" style={sc(quarry.x, quarry.y)} role="button" aria-label={name} onClick={() => { if (!vp.wasDrag()) onSelectQuarry?.(); }}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} />
        <g transform={`translate(${-w / 2 + 8}, ${-(fs + 2) / 2}) scale(${(fs + 2) / 24})`}><path d={iconPath("stone")} /></g>
        <text x={9} textAnchor="middle" dy="0.35em" fontSize={fs} fontWeight={700}>{name}</text>
      </g>
    );
  })();
  const screenBody = useMemo(() => (<>
          {/* Слои: точки узлов (старт, перекрёстки, цели дел, край тумана) — снизу (решение владельца 03.11: «чтобы точка узла не
              перекрывала название города или плена»); над ними значки дел, разведки и кораблей; над ними подписи городов и
              пленов (решение владельца 04.11: «плашки с названиями городов должны быть выше слоя значков свитков дел»); сверху метки команды. */}
          {map.revealed.map((n) => {
            const p = positions.get(n.key)!;
            if (n.kind === "START") return <g key={n.key} style={sc(p.x, p.y)}><circle className="m-start" r={6} fill={map.team.color} /></g>;
            if (n.kind === "CITY" || !showForks) return null;
            return <g key={n.key} style={sc(p.x, p.y)}><circle className="m-fork" r={5} /></g>;
          })}
          {/* Серая точка цели дела — только пока перекрёсток не открыт: если команда дошла до него другой дорогой, белый перекрёсток не закрашивается (03.10). */}
          {showMarkers && map.edges.map((e) => {
            const tk = taskByEdge.get([e.aKey, e.bKey].sort().join("|"));
            if (!tk || tk.status === "APPROVED") return null;
            const farKey = revealed.has(e.aKey) ? e.bKey : e.aKey;
            if (revealed.has(farKey)) return null;
            const far = positions.get(farKey) ?? nodePos(farKey, size);
            return <g key={"tg" + e.aKey + e.bKey} className="m-target" style={sc(far.x, far.y)}><circle className="far" r={5} /></g>;
          })}
          {/* Край тумана: все ещё не открытые углы освещённых гексов без дороги с делом (решение владельца 02.10) — серая точка, по нажатию лист края тумана. */}
          {showMarkers && onFrontierTap && (() => {
            const covered = new Set(map.tasks.filter((tk) => tk.status !== "APPROVED").map((tk) => tk.toKey));
            return (map.frontier ?? []).map((farKey) => {
              if (covered.has(farKey) || revealed.has(farKey)) return null;
              const p = positions.get(farKey) ?? nodePos(farKey, size);
              return (
                <g key={"far" + farKey} data-key={farKey} className="m-far" style={sc(p.x, p.y)} role="button" aria-label={t("Край тумана")} onClick={() => { if (!vp.wasDrag()) onFrontierTap(farKey); }}>
                  <circle className="hit" r={14} />
                  <circle className="far" r={5} />
                </g>
              );
            });
          })()}
          {showMarkers && (map.peeked ?? []).map((pk) => {
            // Координаты из ключа: у разведанного угла без дороги к открытой части карты записи в positions нет (жалоба участника 31.10: метка стояла только через сторону с делом).
            const pos = positions.get(pk.key) ?? nodePos(pk.key, size);
            return (
              <g key={"pk" + pk.key} className="m-peek" style={sc(pos.x, pos.y, "translate(0, -16px)")}>
                <circle r={10} />
                <use href={pk.kind === "CITY" ? "#m-city" : "#m-telescope"} x={-7} y={-7} width={14} height={14} />
              </g>
            );
          })}
          {showMarkers && map.edges.map((e) => {
            const tk = taskByEdge.get([e.aKey, e.bKey].sort().join("|"));
            if (!tk || tk.status === "APPROVED") return null;
            const a = positions.get(e.aKey)!, b = positions.get(e.bKey)!;
            // Метка дела стоит на двух третях стороны от известного перекрёстка, чтобы не наезжать на город.
            const farKey = revealed.has(e.aKey) ? e.bKey : e.aKey;
            const far = farKey === e.bKey ? b : a, near = far === b ? a : b;
            const m = { x: near.x + (far.x - near.x) * 0.66, y: near.y + (far.y - near.y) * 0.66 };
            const sel = tk.id === selectedTaskId;
            const r = sel ? R + 2 : R;
            return (
              <g key={"m" + e.aKey + e.bKey} data-id={tk.id} className={"m-deed " + tk.status.toLowerCase() + (sel ? " sel" : "")} onClick={() => click(tk.id)}>
                <g style={sc(m.x, m.y)}>
                  <circle r={r} />
                  <use href={`#m-${DEED_SYMBOL[tk.status]}`} x={-r * 0.6} y={-r * 0.6} width={r * 1.2} height={r * 1.2} />
                </g>
              </g>
            );
          })}
          {ships.map(({ tk, x, y, port }) => {
            const sel = tk.id === selectedTaskId, r = (sel ? R + 2 : R) + 2;
            return (
              <g key={"ship" + tk.id} data-id={tk.id} className={"m-deed sea " + (tk.landing ? "landing" : tk.status.toLowerCase()) + (sel ? " sel" : "")} onClick={() => { if (!vp.wasDrag()) onSelect(selectedTaskId === tk.id ? null : tk.id); }}>
                <line className="mooring" x1={port.x} y1={port.y} x2={x} y2={y} />
                <g style={sc(x, y)}>
                  <circle r={r} />
                  <use href="#m-ship" x={-r * 0.62} y={-r * 0.62} width={r * 1.24} height={r * 1.24} />
                </g>
              </g>
            );
          })}
          {landing && landing.candidates.map((key) => {
            const p = nodePos(key, size);
            return (
              <g key={"land" + key} className="m-land" style={sc(p.x, p.y)} onClick={() => { if (!vp.wasDrag()) onLand?.(key); }}>
                <circle className="pulse" r={14} />
                <circle className="dot" r={6} />
                <use href="#m-anchor" x={-5} y={-5} width={10} height={10} />
              </g>
            );
          })}
          {/* Подписи городов и пленов — над значками дел (решение владельца 04.11: «плашки с названиями городов должны быть выше слоя значков свитков дел»), но под метками команды. */}
          {map.revealed.map((n) => {
            const p = positions.get(n.key)!;
            const book = n.bookCode ? BOOK_BY_CODE.get(n.bookCode) : undefined;
            if (n.kind === "START") {
              // Стартовая точка подписана как «плен», из которого команда выходит (решение владельца 16.09).
              const name = startName(n.teamIndex ?? teamIndex, getLocale()), fs = fullLabels ? 11 : 9, w = Math.ceil(name.length * fs * 0.62) + 16, h = fs + 9;
              // Подпись справа от метки: по горизонтали из перекрёстка стороны не выходят (они идут вверх/вниз и наискось), метки дел не мешают.
              // Подпись плена ничего не открывает: нажатия проходят сквозь неё к точкам края тумана под ней.
              return (
                <g key={n.key} className={"m-label start" + (fullLabels ? "" : " sm")} style={{ ...sc(p.x, p.y), pointerEvents: "none" }}>
                  <rect x={12} y={-h / 2} width={w} height={h} rx={h / 2} />
                  <text x={12 + w / 2} textAnchor="middle" dy="0.35em" fontSize={fs} fontWeight={700}>{name}</text>
                </g>
              );
            }
            if (n.kind === "CITY") {
              const c = cityByKey.get(n.key);
              const progress = c && c.total > 0 && !c.captured ? `${c.done}/${c.total}` : null;
              const status = c?.ruined ? t("руины") : c?.blocked && c.passage === "PENDING" ? t("ждём прохода") : "";
              // «Проход закрыт» — запрещающий знак справа в подписи вместо слов (решение владельца 04.11).
              const noEntry = Boolean(c?.blocked && c.passage !== "PENDING" && !c?.ruined);
              const fs = fullLabels ? 11 : 9;
              const text = fullLabels ? [book?.nameRu ?? "", progress, status].filter(Boolean).join(" · ") : book?.nameRu ?? "";
              const iconW = c?.isCapital ? fs + 4 : 0;
              // Городская стена (решение владельца 01.11): значок у подписи виден всем, толщину знают только хранители.
              const wallW = (c?.wall ? fs + 4 : 0) + (noEntry ? fs + 5 : 0);
              const w = textWidth(text, fs) + iconW + wallW + 14, h = fs + 9;
              // Подпись стоит под картинкой города (сдвиг в единицах карты), а масштабируется через --inv на каждый кадр.
              return (
                <g key={n.key} data-key={n.key} className={"m-label" + (c?.owner ? " owned" : "") + (c?.ruined ? " ruined" : "") + (fullLabels ? "" : " sm")} style={{ ...(c?.owner ? { ["--team" as string]: c.owner.color } : {}), transform: `translate(${p.x}px, ${p.y}px) translate(0, ${(CITY * 0.48).toFixed(2)}px) scale(var(--inv, 1))` }} onClick={() => clickCity(n.key)}>
                  {c?.battle && (
                    <g className={"m-battle " + (c.battle === "ATTACK" ? "att" : "def")} transform="translate(18,-30)">
                      <circle r={10} />
                      <use href="#m-wave" x={-7} y={-7} width={14} height={14} />
                    </g>
                  )}
                  <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} />
                  {c?.isCapital && <use href="#m-crown" x={-w / 2 + 6} y={-(fs + 1) / 2} width={fs + 1} height={fs + 1} />}
                  {c?.wall && <use href="#m-wall" x={w / 2 - fs - 5 - (noEntry ? fs + 5 : 0)} y={-(fs + 1) / 2} width={fs + 1} height={fs + 1} />}
                  {noEntry && <g className="no-entry" transform={`translate(${w / 2 - (fs + 2) / 2 - 5}, 0)`}><circle r={(fs + 2) / 2 - 0.8} /><rect x={-(fs + 2) / 2 + 2.6} y={-1.2} width={fs + 2 - 5.2} height={2.4} rx={0.6} /></g>}
                  <text x={(iconW - wallW) / 2} textAnchor="middle" dy="0.35em" fontSize={fs} fontWeight={700}>{text}</text>
                </g>
              );
            }
            return null;
          })}
          {ripple && <g style={sc(ripple.x, ripple.y)}><circle key={ripple.n} className="map-ripple" r={6} /></g>}
          {showMarkers && (map.marks ?? []).map((mk) => {
            // Точное место нажатия: дробные координаты переводятся той же формулой, что и центр гекса.
            const c = hexCenter({ q: mk.qf ?? mk.q, r: mk.rf ?? mk.r }, size);
            const by = mk.by?.name ?? "";
            const w = Math.max(mk.note ? textWidth(mk.note, 11) : 0, by ? textWidth(by, 9) : 0) + 14, two = Boolean(mk.note && by), h = two ? 30 : 18;
            const when = mk.createdAt ? ` · ${fmtDate(mk.createdAt)}` : "";
            const label = (mk.note ? (by ? t("Метка команды: {note} — {name}", { note: mk.note, name: by }) : t("Метка команды: {note}", { note: mk.note })) : by ? t("Метка команды — {name}", { name: by }) : t("Метка команды")) + when;
            return (
              <g key={"mk" + mk.id} className="m-mark" style={sc(c.x, c.y, "translate(0, -12px)")} role="button" aria-label={label} onClick={() => { if (!vp.wasDrag()) onMarkTap?.(mk); }}>
                <circle r={11} style={{ fill: map.team.color }} />
                <use href="#m-pin" x={-7} y={-7} width={14} height={14} />
                {(mk.note || by) && (
                  <g transform="translate(0, 21)">
                    <rect x={-w / 2} y={-9} width={w} height={h} rx={9} />
                    {mk.note && <text textAnchor="middle" dy="0.35em" fontSize={11} fontWeight={600}>{mk.note}</text>}
                    {by && <text className="by" textAnchor="middle" y={two ? 12 : 0} dy="0.35em" fontSize={9}>{by}</text>}
                  </g>
                )}
              </g>
            );
          })}
  </>), [map.revealed, map.edges, map.peeked, map.frontier, map.tasks, map.marks, onMarkTap, onFrontierTap, taskByEdge, selectedTaskId, positions, cityByKey, fullLabels, showMarkers, showForks, R, ships, landing, ripple, islandCenters, revealed, map.team.color, size]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!bounds) return null;
  return (
    <div ref={vp.ref} onPointerDown={onPressDown} onPointerMove={(e) => { onPressMove(e); onHostPointerMove(e); }} onClick={onHostClick} onPointerUp={cancelPress} onPointerCancel={cancelPress} onPointerLeave={cancelPress} onClickCapture={onClickCapture} onContextMenu={(e) => { if (onMark) e.preventDefault(); }} className={"map-canvas" + (storm?.active ? " storm" : "")} style={{ background: css(light.bg) }}>
      <SeaLayer vp={vp} bed={bed} light={light} storm={storm?.t ?? 0} />
      <IsletsLayer vp={vp} islets={islets} size={size} coast={coast} daytime={dts} />
      <TilesLayer vp={vp} hexes={tileHexes} size={size} skipWater={liveWater} daytime={dts} />
      {liveWater && <LakesLayer vp={vp} hexes={map.hexes} size={size} onUnsupported={() => setLiveWater(false)} daytime={dts} />}
      {glWorld
        ? <WorldGL vp={vp} scene={worldScene} onUnsupported={() => setGlWorld(false)} />
        : <WorldSvg vp={vp} bounds={bounds} onClick={onWorldClick} onPointerMove={onWorldPointerMove}>
            <OutlineDefs colors={owners} k={vp.view.k} />
            <HexTiles hexes={tileHexes} size={size} clipId="hexclip-team" liveWater={liveWater} fills={false} />
            <CoastOver d={coast} size={size} light={light} />
            {worldBody}
            {flashEl}
          </WorldSvg>}
      {(fogHexes.length > 0 || fogPoints.length > 0) && <FogLayer vp={vp} size={size} fogHexes={fogHexes} fogPoints={fogPoints} clear={fogClear} land={landKeys} light={light} hole={hole} />}
      {/* Названия островов — по дуге под островом (радиус: остров + 4 гекса); рисует слой живности: киты под буквами,
          корабли над ними (решение владельца 05.10). */}
      <FaunaLayer vp={vp} hexes={map.hexes} islets={islets} size={size} daily={daily} seed={map.gameId ?? map.team.id} clock={serverClock} light={light} fires={fires} labels={islandLabels} routes={glRoutes ? [] : routeSpecs} wrecks={wreckSpecs}
        between={glRoutes ? <RoutesGL vp={vp} routes={routeSpecs} onUnsupported={() => setGlRoutes(false)} /> : null} />
      {fireworkSites.length > 0 && !perfOff("fireworks") && <FireworksLayer vp={vp} sites={fireworkSites} clock={serverClock} timeZone={map.daytime?.timeZone ?? "Asia/Tashkent"} />}
      {storm && storm.t > 0 && <StormLayer t={storm.t} />}
      <WorldSvg vp={vp} bounds={bounds} overlay>
        {/* Символы (корабль, якорь…) нужны верхнему слою; подсветка «показать на карте» при мире на WebGL живёт здесь же. */}
        <MapSymbols />
        {glWorld && flashEl}
        {scoutShown && (() => {
          const p = nodePos(scoutShown.key, size);
          const book = scoutShown.bookCode ? BOOK_BY_CODE.get(scoutShown.bookCode) : undefined;
          const name = book?.nameRu ?? "", fs = 11, w = textWidth(name, fs) + 14, h = fs + 9;
          return (
            <g className={"m-scout" + (scoutShown.on ? " on" : "")} pointerEvents="none">
              {scoutShown.kind === "CITY" ? (
                <>
                  <image href={IMG.city(scoutShown.cityType, imgPhase)} x={p.x - CITY / 2} y={p.y - CITY * 0.6} width={CITY} height={CITY} filter="url(#outline-free)" />
                  {name && (
                    <g className="m-label" style={{ transform: `translate(${p.x}px, ${p.y}px) translate(0, ${(CITY * 0.48).toFixed(2)}px) scale(var(--inv, 1))` }}>
                      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} />
                      <text textAnchor="middle" dy="0.35em" fontSize={fs} fontWeight={700}>{name}</text>
                    </g>
                  )}
                </>
              ) : <g style={sc(p.x, p.y)}><circle className="m-fork" r={5} /></g>}
            </g>
          );
        })()}
        <g className="screen-items">
          {/* Каменоломня вне memo: обработчик нажатия должен видеть свежее состояние перетаскивания (ошибка 05.10: после закрытия лист не открывался). */}
          {quarryMarker}
          {/* Разбитые корабли вне memo (как Каменоломня): маркер «срочно» над кораблём виден при любом масштабе, область
              нажатия ~1,2 гекса вокруг корпуса — выше городов (слой над миром); нажатие по маркеру тоже открывает лист. */}
          {wreckSpecs.map((w) => {
            void wreckTick;
            const now = serverClock();
            if ((w.repairedAt != null && now - w.repairedAt > 9000) || (w.sunkAt != null && w.repairedAt == null && now - w.sunkAt > 9500)) return null;
            const r = R + 2, open = () => { if (!vp.wasDrag()) onSelectWreck?.(w.id); };
            const wd = (map.wrecks ?? []).find((x) => x.id === w.id), title = wd?.title ?? "";
            // После сдачи на проверку — знак часов, взято участником — знак человека, как у других дел (решения владельца 05.11);
            // до этого — корабль с «!».
            const submitted = wd?.mine?.status === "SUBMITTED", taken = wd?.mine?.status === "TAKEN";
            return (
              <g key={"wreck" + w.id} data-id={w.id} className={"m-deed sea wreck" + (submitted ? " submitted" : "")} role="button" aria-label={t("Срочное задание: {title}", { title })} onClick={open}>
                <circle className="wreck-hit" cx={w.x} cy={w.y} r={size * 1.15} />
                <g style={sc(w.x, w.y - size * 0.95)}>
                  <circle r={r} />
                  <use href={submitted ? "#m-clock" : taken ? "#m-user" : "#m-ship"} x={-r * 0.62} y={-r * 0.62} width={r * 1.24} height={r * 1.24} />
                  {!submitted && <g className="urgent" transform={`translate(${(r * 0.72).toFixed(1)}, ${(-r * 0.72).toFixed(1)})`}><circle r={6.5} /><text textAnchor="middle" dy="0.36em" fontSize={9.5} fontWeight={800}>!</text></g>}
                </g>
              </g>
            );
          })}
          {screenBody}
        </g>
      </WorldSvg>
      <div className="map-controls">
        {/* Кнопок «Вся карта» и «К старту» нет (решение владельца 24.10 после опроса участников: «не нужны, карта не такая большая»). */}
      </div>
    </div>
  );
}
