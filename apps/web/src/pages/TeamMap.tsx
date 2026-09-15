import { useEffect, useMemo, useState } from "react";
import { reportPage } from "../lib/perf";
import { BOOKS } from "@lotw/domain";
import { HEX_SIZE, fieldBounds, hexCenter, nodePos } from "../lib/hexmap";
import { useViewport } from "../lib/useViewport";
import type { EdgeTaskStatus, MyMapDto } from "../lib/api";
import { CoastOver, FogLayer, HexTiles, IMG, MapSymbols, OutlineDefs, SeaLayer, WorldSvg, useCoast } from "./MapLayers";
import { Icon } from "../components/Icon";
import { FaunaLayer } from "./Fauna";
import { LakesLayer } from "./Lakes";
import { IsletsLayer, useIslets } from "./Islets";
import { useSeabed } from "./Seabed";
import { t } from "../lib/i18n";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
/** Значок метки дела по статусу: свободно — свиток, в работе — человек, на проверке — часы, возвращено — знак внимания. */
const DEED_SYMBOL: Record<EdgeTaskStatus, string> = { OPEN: "scroll", TAKEN: "user", SUBMITTED: "clock", APPROVED: "scroll", REJECTED: "alert" };
/** Оценка ширины подписи (шрифт без измерения DOM): кириллица полужирным ≈ 0.62em на знак. */
const textWidth = (s: string, fs: number) => Math.ceil(s.length * fs * 0.62);

/**
 * Карта команды на весь экран. Гексы и стороны — в масштабируемом слое,
 * значки (старт, город, метки дел, подписи) — в экранном слое постоянного размера.
 */
export function TeamMap({ map, teamIndex, selectedTaskId, onSelect, onSelectCity, landing, onLand }: { map: MyMapDto; teamIndex: number; selectedTaskId: string | null; onSelect: (taskId: string | null) => void; onSelectCity: (nodeKey: string) => void; /** Режим высадки: узлы-кандидаты другого острова подсвечены, нажатие — высадка (только капитан). */ landing?: { taskId: string; candidates: string[] } | null; onLand?: (nodeKey: string) => void }) {
  const size = HEX_SIZE;
  const bounds = useMemo(() => (map.hexes.length ? fieldBounds(map.hexes, size) : null), [map.hexes, size]);
  const start = useMemo(() => (map.team.startNodeKey ? nodePos(map.team.startNodeKey, size) : null), [map.team.startNodeKey, size]);
  const vp = useViewport(bounds, start ? { x: start.x, y: start.y, k: 2.4 } : null);
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
  useEffect(() => { reportPage("map"); }, []);
  const coast = useCoast(map.hexes, size);
  const islets = useIslets(map.hexes, size, bounds);
  const bed = useSeabed(map.hexes, islets, size, bounds);
  const owners = useMemo(() => [...new Set((map.cities ?? []).flatMap((c) => (c.owner ? [c.owner.color] : [])))], [map.cities]);
  const fogHexes = useMemo(() => map.hexes.filter((h) => h.lit === false), [map.hexes]);
  // Центры островов: для подписей «Ветхий Завет» / «Новый Завет» и для корабля (он стоит с морской стороны порта).
  const islandCenters = useMemo(() => {
    const acc = new Map<string, { x: number; y: number; n: number }>();
    for (const h of map.hexes) { const c = hexCenter(h, size), key = h.island ?? "OT"; const a = acc.get(key) ?? { x: 0, y: 0, n: 0 }; a.x += c.x; a.y += c.y; a.n++; acc.set(key, a); }
    return new Map([...acc].map(([key, a]) => [key, { x: a.x / a.n, y: a.y / a.n }]));
  }, [map.hexes, size]);
  const nodeByKey = useMemo(() => new Map(map.revealed.map((n) => [n.key, n])), [map.revealed]);
  // Корабли: морские дела, пока команда не высадилась (после высадки дело — обычная пройденная сторона).
  const ships = useMemo(() => map.tasks.filter((tk) => tk.sea && (tk.status !== "APPROVED" || tk.landing)).map((tk) => {
    const p = nodePos(tk.fromKey, size), c = islandCenters.get(nodeByKey.get(tk.fromKey)?.island ?? "OT") ?? { x: 0, y: 0 };
    const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy) || 1;
    return { tk, x: p.x + (dx / d) * size * 1.6, y: p.y + (dy / d) * size * 1.6, port: p };
  }), [map.tasks, islandCenters, nodeByKey, size]);

  if (!bounds) return null;
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
  const CITY = size * 1.15, START = size * 1.35;
  const dash = `${7 * inv} ${6 * inv}`;

  return (
    <div ref={vp.ref} {...vp.handlers} className="map-canvas">
      <SeaLayer vp={vp} bed={bed} />
      <IsletsLayer vp={vp} islets={islets} size={size} coast={coast} />
      <WorldSvg vp={vp} bounds={bounds}>
        <MapSymbols />
        <OutlineDefs colors={owners} />
        <HexTiles hexes={map.hexes} size={size} clipId="hexclip-team" />
        <CoastOver d={coast} size={size} />
        {map.edges.map((e) => {
          const a = positions.get(e.aKey)!, b = positions.get(e.bKey)!;
          const tk = taskByEdge.get([e.aKey, e.bKey].sort().join("|"));
          const done = tk?.status === "APPROVED";
          const active = tk && !done;
          const sel = tk?.id === selectedTaskId;
          const cls = done ? "done" : sel ? "sel" : active ? "active" : "idle";
          return (
            <g key={e.aKey + e.bKey} className={"m-edge " + cls} onClick={() => active && click(tk.id)}>
              {active && <line className="hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />}
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={done ? map.team.color : undefined} style={active && !sel ? { strokeDasharray: dash } : undefined} />
            </g>
          );
        })}
        {map.revealed.map((n) => {
          const p = positions.get(n.key)!;
          if (n.kind === "START") return <image key={"s" + n.key} href={IMG.start(teamIndex)} x={p.x - START / 2} y={p.y - START * 0.58} width={START} height={START} />;
          if (n.kind === "CITY") {
            const c = cityByKey.get(n.key);
            return (
              <g key={"c" + n.key} className="m-city" onClick={() => clickCity(n.key)}>
                <image className="city-hit" href={IMG.city(n.cityType)} x={p.x - CITY / 2} y={p.y - CITY * 0.6} width={CITY} height={CITY} filter={c?.owner ? `url(#outline-${c.owner.color.slice(1)})` : undefined} />
              </g>
            );
          }
          return null;
        })}
      </WorldSvg>
      <LakesLayer vp={vp} hexes={map.hexes} size={size} />
      {fogHexes.length > 0 && <FogLayer vp={vp} size={size} fogHexes={fogHexes} />}
      <FaunaLayer vp={vp} hexes={map.hexes} islets={islets} size={size} />
      <WorldSvg vp={vp} bounds={bounds} overlay>
        <g className="screen-items">
          {map.revealed.map((n) => {
            const p = positions.get(n.key)!;
            const book = n.bookCode ? BOOK_BY_CODE.get(n.bookCode) : undefined;
            if (n.kind === "START") return <g key={n.key} transform={`translate(${p.x},${p.y}) scale(${inv})`}><circle className="m-start" r={6} fill={map.team.color} /></g>;
            if (n.kind === "CITY") {
              const c = cityByKey.get(n.key);
              const progress = c && c.total > 0 && !c.captured ? `${c.done}/${c.total}` : null;
              const status = c?.ruined ? t("руины") : c?.blocked ? (c.passage === "PENDING" ? t("ждём прохода") : t("проход закрыт")) : "";
              const fs = fullLabels ? 11 : 9;
              const text = fullLabels ? [book?.nameRu ?? "", progress, status].filter(Boolean).join(" · ") : book?.nameRu ?? "";
              const iconW = c?.isCapital ? fs + 4 : 0;
              const w = textWidth(text, fs) + iconW + 14, h = fs + 9;
              const y = (fullLabels ? CITY * k * 0.48 : Math.max(10, CITY * k * 0.48)) / ui;
              return (
                <g key={n.key} className={"m-label" + (c?.owner ? " owned" : "") + (c?.ruined ? " ruined" : "") + (fullLabels ? "" : " sm")} style={c?.owner ? { ["--team" as string]: c.owner.color } : undefined} transform={`translate(${p.x},${p.y}) scale(${inv}) translate(0,${y})`} onClick={() => clickCity(n.key)}>
                  {c?.battle && (
                    <g className={"m-battle " + (c.battle === "ATTACK" ? "att" : "def")} transform={`translate(${Math.max(14, CITY * k * 0.45)},${-y - Math.max(12, CITY * k * 0.5)})`}>
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
            return <g key={n.key} transform={`translate(${p.x},${p.y}) scale(${inv})`}><circle className="m-fork" r={5} /></g>;
          })}
          {showMarkers && (map.peeked ?? []).map((pk) => {
            const pos = positions.get(pk.key);
            if (!pos) return null;
            return (
              <g key={"pk" + pk.key} className="m-peek" transform={`translate(${pos.x},${pos.y}) scale(${inv}) translate(0,-16)`}>
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
            const far = revealed.has(e.aKey) ? b : a, near = far === b ? a : b;
            const m = { x: near.x + (far.x - near.x) * 0.66, y: near.y + (far.y - near.y) * 0.66 };
            const sel = tk.id === selectedTaskId;
            const r = sel ? R + 2 : R;
            return (
              <g key={"m" + e.aKey + e.bKey} className={"m-deed " + tk.status.toLowerCase() + (sel ? " sel" : "")} onClick={() => click(tk.id)}>
                <g transform={`translate(${far.x},${far.y}) scale(${inv})`}><circle className="far" r={5} /></g>
                <g transform={`translate(${m.x},${m.y}) scale(${inv})`}>
                  <circle r={r} />
                  <use href={`#m-${DEED_SYMBOL[tk.status]}`} x={-r * 0.6} y={-r * 0.6} width={r * 1.2} height={r * 1.2} />
                </g>
              </g>
            );
          })}
          {ships.map(({ tk, x, y, port }) => {
            const sel = tk.id === selectedTaskId, r = (sel ? R + 2 : R) + 2;
            return (
              <g key={"ship" + tk.id} className={"m-deed sea " + (tk.landing ? "landing" : tk.status.toLowerCase()) + (sel ? " sel" : "")} onClick={() => { if (!vp.wasDrag()) onSelect(selectedTaskId === tk.id ? null : tk.id); }}>
                <line className="mooring" x1={port.x} y1={port.y} x2={x} y2={y} />
                <g transform={`translate(${x},${y}) scale(${inv})`}>
                  <circle r={r} />
                  <use href="#m-ship" x={-r * 0.62} y={-r * 0.62} width={r * 1.24} height={r * 1.24} />
                </g>
              </g>
            );
          })}
          {landing && landing.candidates.map((key) => {
            const p = nodePos(key, size);
            return (
              <g key={"land" + key} className="m-land" transform={`translate(${p.x},${p.y}) scale(${inv})`} onClick={() => { if (!vp.wasDrag()) onLand?.(key); }}>
                <circle className="pulse" r={14} />
                <circle className="dot" r={6} />
                <use href="#m-anchor" x={-5} y={-5} width={10} height={10} />
              </g>
            );
          })}
          {/* Названия островов при отдалении почти не уменьшаются (не меньше 0.8): их должно быть видно с любой высоты. */}
          {!fullLabels && islandCenters.has("NT") && [...islandCenters].map(([isl, c]) => (
            <g key={"isl" + isl} className="m-island" transform={`translate(${c.x},${c.y}) scale(${Math.max(ui, 0.8) / k})`}>
              <text textAnchor="middle">{(isl === "OT" ? t("Ветхий Завет") : t("Новый Завет")).split(" ").map((w, i) => <tspan key={i} x={0} dy={i === 0 ? "-0.25em" : "1.1em"}>{w}</tspan>)}</text>
            </g>
          ))}
          {ripple && <g transform={`translate(${ripple.x},${ripple.y}) scale(${inv})`}><circle key={ripple.n} className="map-ripple" r={6} /></g>}
        </g>
      </WorldSvg>
      <div className="map-controls">
        <button type="button" className="secondary icon" onClick={vp.fit} aria-label={t("Вся карта")} title={t("Вся карта")}><Icon name="expand" /></button>
        {start && <button type="button" className="secondary icon" onClick={() => vp.focusOn(start.x, start.y, 2.4)} aria-label={t("К старту")} title={t("К старту")}><Icon name="flag" /></button>}
        <button type="button" className="secondary icon" onClick={() => vp.zoomAt(1.3)} aria-label={t("Приблизить")} title={t("Приблизить")}><Icon name="zoom-in" /></button>
        <button type="button" className="secondary icon" onClick={() => vp.zoomAt(1 / 1.3)} aria-label={t("Отдалить")} title={t("Отдалить")}><Icon name="zoom-out" /></button>
      </div>
    </div>
  );
}
