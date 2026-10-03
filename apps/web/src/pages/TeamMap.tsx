import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { reportPage } from "../lib/perf";
import { BOOKS, startName, vertexHexes, parseVertexKey } from "@lotw/domain";
import { HEX_SIZE, fieldBounds, hexCenter, nodePos } from "../lib/hexmap";
import { useViewport } from "../lib/useViewport";
import { perfMark } from "../lib/perfHud";
import type { EdgeTaskStatus, MapMarkDto, MyMapDto } from "../lib/api";
import { CoastOver, IslandLabel, islandGeometry, FogLayer, HexTiles, IMG, MapSymbols, OutlineDefs, SeaLayer, TilesLayer, WorldSvg, useCoast, type FogClear } from "./MapLayers";
import { Icon } from "../components/Icon";
import { FaunaLayer, type FireSite } from "./Fauna";
import { css, useDaytime } from "../lib/daytime";
import { LakesLayer } from "./Lakes";
import { IsletsLayer, useIslets } from "./Islets";
import { useSeabed } from "./Seabed";
import { t, getLocale } from "../lib/i18n";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
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
export const routeColor = (color: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const hex = m[1]!;
  const mix = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.68 + 255 * 0.32).toString(16).padStart(2, "0");
  return `#${mix(0)}${mix(2)}${mix(4)}`;
};
/** Точка метки: гекс и точное место нажатия дробными осевыми координатами. */
export interface MarkPoint { q: number; r: number; qf: number; rf: number }
export function TeamMap({ map, teamIndex, selectedTaskId, onSelect, onSelectCity, landing, onLand, onMark, onMarkTap, onFrontierTap }: { /** Нажатие на точку края тумана, к которой нет дороги с делом (решение владельца 02.10: разведчик разведывает любой узел на краю тумана). */ onFrontierTap?: (nodeKey: string) => void; map: MyMapDto; teamIndex: number; selectedTaskId: string | null; onSelect: (taskId: string | null) => void; onSelectCity: (nodeKey: string) => void; /** Метки команды: кнопка-булавка включает режим, нажатие по карте отдаёт гекс и точное место (дробные координаты); нажатие на флажок — убрать. */ onMark?: (at: MarkPoint) => void; onMarkTap?: (mark: MapMarkDto) => void; /** Режим высадки: узлы-кандидаты другого острова подсвечены, нажатие — высадка (только капитан). */ landing?: { taskId: string; candidates: string[] } | null; onLand?: (nodeKey: string) => void }) {
  const size = HEX_SIZE;
  const hexKey = map.hexes.map((h) => `${h.q},${h.r}`).join(";");
  const bounds = useMemo(() => (map.hexes.length ? fieldBounds(map.hexes, size) : null), [hexKey, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = useMemo(() => (map.team.startNodeKey ? nodePos(map.team.startNodeKey, size) : null), [map.team.startNodeKey, size]);
  const renderStart = performance.now();
  useLayoutEffect(() => { perfMark("карта команды: React+DOM", performance.now() - renderStart); });
  useEffect(() => { perfMark("карта команды: до кадра", performance.now() - renderStart); });
  const vp = useViewport(bounds, start ? { x: start.x, y: start.y, k: 2.4 } : null);
  // Время суток (решение владельца 03.10): по поясу игры и часам сервера; картинки городов — фазы, которой больше в переходе.
  const dt = useDaytime(map.daytime?.timeZone, map.now);
  const imgPhase = dt.t >= 0.5 ? dt.to : dt.from;
  const fires = useMemo<FireSite[]>(() => map.revealed.filter((n) => n.kind === "CITY" || n.kind === "START").map((n) => { const p = nodePos(n.key, size); return { x: p.x, y: p.y - size * 0.08, r: size * (n.kind === "START" ? 0.45 : 0.38) }; }), [map.revealed, size]);
  const revealed = useMemo(() => new Set(map.revealed.map((n) => n.key)), [map.revealed]);
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
  const [marking, setMarking] = useState(false);
  useEffect(() => { if (!onMark) setMarking(false); }, [onMark]);
  /**
   * Режим метки: точка экрана → точка карты (w·k + t = px) → ближайший гекс, не дальше радиуса гекса (место должно быть на карте).
   * Метка ставится точно в место нажатия (решение владельца 29.09): точка переводится в дробные осевые координаты. Кнопки внутри карты не считаются.
   */
  const placeMark = (e: MouseEvent<HTMLDivElement>) => {
    if (!marking || vp.wasDrag() || (e.target as HTMLElement).closest("button")) return;
    const rect = e.currentTarget.getBoundingClientRect(), v = vp.viewRef.current;
    const x = (e.clientX - rect.left - v.tx) / v.k, y = (e.clientY - rect.top - v.ty) / v.k;
    let best: { q: number; r: number } | null = null, bd = Infinity;
    for (const h of map.hexes) { const c = hexCenter(h, size); const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = h; } }
    if (!best || bd > (size * 1.1) ** 2) return;
    const rf = y / (1.5 * size), qf = x / (Math.sqrt(3) * size) - rf / 2;
    setMarking(false); onMark?.({ q: best.q, r: best.r, qf, rf });
  };
  // Часы сервера для живности: смещение от местных часов по времени из ответа карты.
  const clockOff = useRef(0);
  useEffect(() => { if (map.now) clockOff.current = map.now - Date.now(); }, [map.now]);
  const serverClock = useCallback(() => Date.now() + clockOff.current, []);
  useEffect(() => { reportPage("map"); }, []);
  const coast = useCoast(map.hexes, size);
  const islets = useIslets(map.hexes, size, bounds);
  const bed = useSeabed(map.hexes, islets, size, bounds);
  const [liveWater, setLiveWater] = useState(true);
  const owners = useMemo(() => [...new Set((map.cities ?? []).flatMap((c) => (c.owner ? [c.owner.color] : [])))], [map.cities]);
  const fogHexes = useMemo(() => map.hexes.filter((h) => h.lit === false), [map.hexes]);
  const landKeys = useMemo(() => new Set(map.hexes.map((h) => `${h.q},${h.r}`)), [map.hexes]);
  // Перекрёстки края тумана укрыты облачком и там, где рядом нет гекса тумана (берег): команда их ещё не знает (03.10).
  // Туман не закрывает то, что команда знает (решение владельца 03.10): открытые перекрёстки, города со значками и дороги
  // к ним. Дорога к ещё не открытому перекрёстку расчищается не до конца: сам перекрёсток остаётся под облачком.
  const fogClear = useMemo<FogClear>(() => {
    const nodes = map.revealed.map((n) => { const p = nodePos(n.key, size); return n.kind === "CITY" ? { x: p.x, y: p.y - size * 0.12, r: size * 0.72 } : n.kind === "START" ? { x: p.x, y: p.y - size * 0.1, r: size * 0.8 } : { x: p.x, y: p.y, r: size * 0.45 }; });
    const edges = map.edges.map((e) => {
      const a = nodePos(e.aKey, size), b = nodePos(e.bKey, size), ra = revealed.has(e.aKey), rb = revealed.has(e.bKey);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, k = Math.min(0.9, (len - size * 0.55) / len);
      // От известного конца к неизвестному — на 0,55 гекса не доходя до него.
      if (ra && !rb) return { x0: a.x, y0: a.y, x1: a.x + (b.x - a.x) * k, y1: a.y + (b.y - a.y) * k };
      if (rb && !ra) return { x0: b.x, y0: b.y, x1: b.x + (a.x - b.x) * k, y1: b.y + (a.y - b.y) * k };
      return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    });
    return { nodes, edges };
  }, [map.revealed, map.edges, revealed, size]);
  const fogPoints = useMemo(() => {
    const fog = new Set(map.hexes.filter((h) => h.lit === false).map((h) => `${h.q},${h.r}`));
    // Только перекрёстки, у которых ни один из трёх гексов вокруг не в тумане (остальные туман уже укрывает).
    return (map.frontier ?? []).filter((k) => !vertexHexes(parseVertexKey(k)).some((h) => fog.has(`${h.q},${h.r}`))).map((k) => nodePos(k, size));
  }, [map.frontier, map.hexes, size]);
  // Центры островов: для подписей «Ветхий Завет» / «Новый Завет» и для корабля (он стоит с морской стороны порта).
  const islandCenters = useMemo(() => islandGeometry(map.hexes, size), [map.hexes, size]);
  const nodeByKey = useMemo(() => new Map(map.revealed.map((n) => [n.key, n])), [map.revealed]);
  // Корабли: морские дела, пока команда не высадилась (после высадки дело — обычная пройденная сторона).
  const ships = useMemo(() => map.tasks.filter((tk) => tk.sea && (tk.status !== "APPROVED" || tk.landing)).map((tk) => {
    const p = nodePos(tk.fromKey, size), c = islandCenters.get(nodeByKey.get(tk.fromKey)?.island ?? "OT") ?? { x: 0, y: 0 };
    const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy) || 1;
    return { tk, x: p.x + (dx / d) * size * 1.6, y: p.y + (dy / d) * size * 1.6, port: p };
  }), [map.tasks, islandCenters, nodeByKey, size]);


  // Полёт клина к ближайшему неоткрытому городу команды (раз в час): время и узел от сервера, одни для всей команды.
  const daily = useMemo(() => (map.dailyBird ? { at: map.dailyBird.at, to: nodePos(map.dailyBird.key, size) } : null), [map.dailyBird, size]);
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
            <g key={e.aKey + e.bKey} className={"m-edge " + cls} onClick={() => (active || done) && click(tk.id)}>
              {/* Пройденная сторона тоже нажимается: открывает дело и его отчёт (решение владельца 30.09). */}
              {(active || done) && <line className="hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />}
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
              <g key={"c" + n.key} className="m-city" onClick={() => clickCity(n.key)}>
                <image className="city-hit" href={IMG.city(n.cityType, imgPhase)} x={p.x - CITY / 2} y={p.y - CITY * 0.6} width={CITY} height={CITY} filter={c?.owner ? `url(#outline-${c.owner.color.slice(1)})` : undefined} />
              </g>
            );
          }
          return null;
        })}
  </>), [map.edges, map.revealed, taskByEdge, selectedTaskId, positions, cityByKey, teamIndex, size, map.team.color, foreignByEdge, imgPhase]); // eslint-disable-line react-hooks/exhaustive-deps
  const screenBody = useMemo(() => (<>
          {map.revealed.map((n) => {
            const p = positions.get(n.key)!;
            const book = n.bookCode ? BOOK_BY_CODE.get(n.bookCode) : undefined;
            if (n.kind === "START") {
              // Стартовая точка подписана как «плен», из которого команда выходит (решение владельца 16.09).
              const name = startName(n.teamIndex ?? teamIndex, getLocale()), fs = fullLabels ? 11 : 9, w = Math.ceil(name.length * fs * 0.62) + 16, h = fs + 9;
              // Подпись справа от метки: по горизонтали из перекрёстка стороны не выходят (они идут вверх/вниз и наискось), метки дел не мешают.
              return (
                <Fragment key={n.key}>
                  <g style={sc(p.x, p.y)}><circle className="m-start" r={6} fill={map.team.color} /></g>
                  <g className={"m-label start" + (fullLabels ? "" : " sm")} style={sc(p.x, p.y)}>
                    <rect x={12} y={-h / 2} width={w} height={h} rx={h / 2} />
                    <text x={12 + w / 2} textAnchor="middle" dy="0.35em" fontSize={fs} fontWeight={700}>{name}</text>
                  </g>
                </Fragment>
              );
            }
            if (n.kind === "CITY") {
              const c = cityByKey.get(n.key);
              const progress = c && c.total > 0 && !c.captured ? `${c.done}/${c.total}` : null;
              const status = c?.ruined ? t("руины") : c?.blocked ? (c.passage === "PENDING" ? t("ждём прохода") : t("проход закрыт")) : "";
              const fs = fullLabels ? 11 : 9;
              const text = fullLabels ? [book?.nameRu ?? "", progress, status].filter(Boolean).join(" · ") : book?.nameRu ?? "";
              const iconW = c?.isCapital ? fs + 4 : 0;
              const w = textWidth(text, fs) + iconW + 14, h = fs + 9;
              // Подпись стоит под картинкой города (сдвиг в единицах карты), а масштабируется через --inv на каждый кадр.
              return (
                <g key={n.key} className={"m-label" + (c?.owner ? " owned" : "") + (c?.ruined ? " ruined" : "") + (fullLabels ? "" : " sm")} style={{ ...(c?.owner ? { ["--team" as string]: c.owner.color } : {}), transform: `translate(${p.x}px, ${p.y}px) translate(0, ${(CITY * 0.48).toFixed(2)}px) scale(var(--inv, 1))` }} onClick={() => clickCity(n.key)}>
                  {c?.battle && (
                    <g className={"m-battle " + (c.battle === "ATTACK" ? "att" : "def")} transform="translate(18,-30)">
                      <circle r={10} />
                      <use href="#m-wave" x={-7} y={-7} width={14} height={14} />
                    </g>
                  )}
                  <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} />
                  {c?.isCapital && <use href="#m-crown" x={-w / 2 + 6} y={-(fs + 1) / 2} width={fs + 1} height={fs + 1} />}
                  <text x={iconW / 2} textAnchor="middle" dy="0.35em" fontSize={fs} fontWeight={700}>{text}</text>
                </g>
              );
            }
            if (!showForks) return null;
            return <g key={n.key} style={sc(p.x, p.y)}><circle className="m-fork" r={5} /></g>;
          })}
          {showMarkers && (map.peeked ?? []).map((pk) => {
            const pos = positions.get(pk.key);
            if (!pos) return null;
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
              <g key={"m" + e.aKey + e.bKey} className={"m-deed " + tk.status.toLowerCase() + (sel ? " sel" : "")} onClick={() => click(tk.id)}>
                {/* Серая точка цели только пока перекрёсток не открыт: если команда дошла до него другой дорогой, белый перекрёсток не закрашивается (03.10). */}
                {!revealed.has(farKey) && <g style={sc(far.x, far.y)}><circle className="far" r={5} /></g>}
                <g style={sc(m.x, m.y)}>
                  <circle r={r} />
                  <use href={`#m-${DEED_SYMBOL[tk.status]}`} x={-r * 0.6} y={-r * 0.6} width={r * 1.2} height={r * 1.2} />
                </g>
              </g>
            );
          })}
          {/* Край тумана: все ещё не открытые углы освещённых гексов без дороги с делом (решение владельца 02.10) — серая точка, по нажатию лист края тумана. */}
          {showMarkers && onFrontierTap && (() => {
            const covered = new Set(map.tasks.filter((tk) => tk.status !== "APPROVED").map((tk) => tk.toKey));
            return (map.frontier ?? []).map((farKey) => {
              if (covered.has(farKey) || revealed.has(farKey)) return null;
              const p = positions.get(farKey) ?? nodePos(farKey, size);
              return (
                <g key={"far" + farKey} className="m-far" style={sc(p.x, p.y)} role="button" aria-label={t("Край тумана")} onClick={() => { if (!vp.wasDrag()) onFrontierTap(farKey); }}>
                  <circle className="hit" r={14} />
                  <circle className="far" r={5} />
                </g>
              );
            });
          })()}
          {ships.map(({ tk, x, y, port }) => {
            const sel = tk.id === selectedTaskId, r = (sel ? R + 2 : R) + 2;
            return (
              <g key={"ship" + tk.id} className={"m-deed sea " + (tk.landing ? "landing" : tk.status.toLowerCase()) + (sel ? " sel" : "")} onClick={() => { if (!vp.wasDrag()) onSelect(selectedTaskId === tk.id ? null : tk.id); }}>
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
          {/* Названия островов — по дуге под островом (радиус: остров + 4 гекса); при отдалении уменьшаются не ниже 0.7. */}
          {!fullLabels && islandCenters.has("NT") && [...islandCenters].map(([isl, c]) => (
            <g key={"isl" + isl} className="m-island" transform={`translate(${c.x},${c.y})`}>
              <IslandLabel id={"isl-team-" + isl} r={c.r + size * 4} name={isl === "OT" ? t("Ветхий Завет") : t("Новый Завет")} />
            </g>
          ))}
          {ripple && <g style={sc(ripple.x, ripple.y)}><circle key={ripple.n} className="map-ripple" r={6} /></g>}
          {showMarkers && (map.marks ?? []).map((mk) => {
            // Точное место нажатия: дробные координаты переводятся той же формулой, что и центр гекса.
            const c = hexCenter({ q: mk.qf ?? mk.q, r: mk.rf ?? mk.r }, size);
            const by = mk.by?.name ?? "";
            const w = Math.max(mk.note ? textWidth(mk.note, 11) : 0, by ? textWidth(by, 9) : 0) + 14, two = Boolean(mk.note && by), h = two ? 30 : 18;
            const label = mk.note ? (by ? t("Метка команды: {note} — {name}", { note: mk.note, name: by }) : t("Метка команды: {note}", { note: mk.note })) : by ? t("Метка команды — {name}", { name: by }) : t("Метка команды");
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
    <div ref={vp.ref} {...vp.handlers} className={"map-canvas" + (marking ? " marking" : "")} style={{ background: css(dt.light.bg) }} onClick={marking ? placeMark : undefined}>
      <SeaLayer vp={vp} bed={bed} light={dt.light} />
      <IsletsLayer vp={vp} islets={islets} size={size} coast={coast} daytime={dt} />
      <TilesLayer vp={vp} hexes={map.hexes} size={size} skipWater={liveWater} daytime={dt} />
      {liveWater && <LakesLayer vp={vp} hexes={map.hexes} size={size} onUnsupported={() => setLiveWater(false)} daytime={dt} />}
      <WorldSvg vp={vp} bounds={bounds}>
        <MapSymbols />
        <OutlineDefs colors={owners} />
        <HexTiles hexes={map.hexes} size={size} clipId="hexclip-team" liveWater={liveWater} fills={false} />
        <CoastOver d={coast} size={size} light={dt.light} />
        {worldBody}
      </WorldSvg>
      {(fogHexes.length > 0 || fogPoints.length > 0) && <FogLayer vp={vp} size={size} fogHexes={fogHexes} fogPoints={fogPoints} clear={fogClear} land={landKeys} light={dt.light} />}
      <FaunaLayer vp={vp} hexes={map.hexes} islets={islets} size={size} daily={daily} seed={map.gameId ?? map.team.id} clock={serverClock} light={dt.light} fires={fires} />
      <WorldSvg vp={vp} bounds={bounds} overlay>
        <g className="screen-items">
          {screenBody}
        </g>
      </WorldSvg>
      <div className="map-controls">
        <button type="button" className="secondary icon" onClick={vp.fit} aria-label={t("Вся карта")} title={t("Вся карта")}><Icon name="expand" /></button>
        {start && <button type="button" className="secondary icon" onClick={() => vp.focusOn(start.x, start.y, 2.4)} aria-label={t("К старту")} title={t("К старту")}><Icon name="flag" /></button>}
        {onMark && <button type="button" className={"secondary icon" + (marking ? " on" : "")} aria-pressed={marking} onClick={() => setMarking((m) => !m)} aria-label={t("Метка на карте")} title={t("Метка на карте")}><Icon name="pin" /></button>}
      </div>
      {marking && (
        <div className="finish-banner mark-banner" role="status">
          <Icon name="pin" /><span>{t("Нажмите на карту там, где поставить метку")}</span>
          <button type="button" className="ghost sm" onClick={() => setMarking(false)}>{t("Отмена")}</button>
        </div>
      )}
    </div>
  );
}
