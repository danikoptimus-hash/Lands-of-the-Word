import { useMemo, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { HEX_SIZE, fieldBounds, nodePos } from "../lib/hexmap";
import { useViewport } from "../lib/useViewport";
import type { EdgeTaskStatus, MyMapDto } from "../lib/api";
import { HexTiles, IMG, MapSymbols, Sea } from "./MapLayers";
import { Icon } from "../components/Icon";
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
export function TeamMap({ map, teamIndex, selectedTaskId, onSelect, onSelectCity }: { map: MyMapDto; teamIndex: number; selectedTaskId: string | null; onSelect: (taskId: string | null) => void; onSelectCity: (nodeKey: string) => void }) {
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

  if (!bounds) return null;
  const { k, tx, ty } = vp.view;
  const S = (p: { x: number; y: number }) => ({ x: tx + p.x * k, y: ty + p.y * k });
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

  return (
    <div ref={vp.ref} {...vp.handlers} className="map-canvas">
      <svg className="map-svg" width="100%" height="100%">
        <MapSymbols />
        <g transform={`translate(${tx},${ty}) scale(${k})`}>
          <Sea size={size} id="sea-team" dim />
          <HexTiles hexes={map.hexes} size={size} clipId="hexclip-team" />
          {map.edges.map((e) => {
            const a = positions.get(e.aKey)!, b = positions.get(e.bKey)!;
            const tk = taskByEdge.get([e.aKey, e.bKey].sort().join("|"));
            const done = tk?.status === "APPROVED";
            const active = tk && !done;
            const sel = tk?.id === selectedTaskId;
            const cls = done ? "done" : sel ? "sel" : active ? "active" : "idle";
            return (
              <g key={e.aKey + e.bKey} className={"m-edge " + cls} onClick={() => active && click(tk.id)}>
                {active && <line className="hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" />}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={done ? map.team.color : undefined} vectorEffect="non-scaling-stroke" />
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
                  {c?.owner && <circle cx={p.x} cy={p.y - CITY * 0.1} r={CITY * 0.62} fill={c.owner.color} fillOpacity={0.35} stroke={c.owner.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                  <image className="city-hit" href={IMG.city(n.cityType)} x={p.x - CITY / 2} y={p.y - CITY * 0.6} width={CITY} height={CITY} />
                </g>
              );
            }
            return null;
          })}
        </g>
        <g>
          {map.revealed.map((n) => {
            const p = S(positions.get(n.key)!);
            const book = n.bookCode ? BOOK_BY_CODE.get(n.bookCode) : undefined;
            if (n.kind === "START") return <circle key={n.key} className="m-start" cx={p.x} cy={p.y} r={6} fill={map.team.color} />;
            if (n.kind === "CITY") {
              const c = cityByKey.get(n.key);
              const progress = c && c.total > 0 && !c.captured ? `${c.done}/${c.total}` : null;
              const status = c?.ruined ? t("руины") : c?.blocked ? (c.passage === "PENDING" ? t("ждём прохода") : t("проход закрыт")) : "";
              const fs = fullLabels ? 11 : 9;
              const text = fullLabels ? [book?.nameRu ?? "", progress, status].filter(Boolean).join(" · ") : book?.nameRu ?? "";
              const iconW = c?.isCapital ? fs + 4 : 0;
              const w = textWidth(text, fs) + iconW + 14, h = fs + 9;
              const y = fullLabels ? CITY * k * 0.48 : Math.max(10, CITY * k * 0.48);
              return (
                <g key={n.key} className={"m-label" + (c?.owner ? " owned" : "") + (c?.ruined ? " ruined" : "") + (fullLabels ? "" : " sm")} style={c?.owner ? { ["--team" as string]: c.owner.color } : undefined} transform={`translate(${p.x},${p.y + y})`} onClick={() => clickCity(n.key)}>
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
            return <circle key={n.key} className="m-fork" cx={p.x} cy={p.y} r={5} />;
          })}
          {showMarkers && (map.peeked ?? []).map((pk) => {
            const pos = positions.get(pk.key);
            if (!pos) return null;
            const q = S(pos);
            return (
              <g key={"pk" + pk.key} className="m-peek" transform={`translate(${q.x},${q.y - 16})`}>
                <circle r={10} />
                <use href={pk.kind === "CITY" ? "#m-city" : "#m-telescope"} x={-7} y={-7} width={14} height={14} />
              </g>
            );
          })}
          {showMarkers && map.edges.map((e) => {
            const tk = taskByEdge.get([e.aKey, e.bKey].sort().join("|"));
            if (!tk || tk.status === "APPROVED") return null;
            const a = positions.get(e.aKey)!, b = positions.get(e.bKey)!;
            const m = S({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            const far = revealed.has(e.aKey) ? S(b) : S(a);
            const sel = tk.id === selectedTaskId;
            const r = sel ? R + 2 : R;
            return (
              <g key={"m" + e.aKey + e.bKey} className={"m-deed " + tk.status.toLowerCase() + (sel ? " sel" : "")} onClick={() => click(tk.id)}>
                <circle className="far" cx={far.x} cy={far.y} r={5} />
                <circle cx={m.x} cy={m.y} r={r} />
                <use href={`#m-${DEED_SYMBOL[tk.status]}`} x={m.x - r * 0.6} y={m.y - r * 0.6} width={r * 1.2} height={r * 1.2} />
              </g>
            );
          })}
          {ripple && <circle key={ripple.n} className="map-ripple" cx={S(ripple).x} cy={S(ripple).y} r={6} />}
        </g>
      </svg>
      <div className="map-controls">
        <button type="button" className="secondary icon" onClick={vp.fit} aria-label={t("Вся карта")} title={t("Вся карта")}><Icon name="expand" /></button>
        {start && <button type="button" className="secondary icon" onClick={() => vp.focusOn(start.x, start.y, 2.4)} aria-label={t("К старту")} title={t("К старту")}><Icon name="flag" /></button>}
        <button type="button" className="secondary icon" onClick={() => vp.zoomAt(1.3)} aria-label={t("Приблизить")} title={t("Приблизить")}><Icon name="zoom-in" /></button>
        <button type="button" className="secondary icon" onClick={() => vp.zoomAt(1 / 1.3)} aria-label={t("Отдалить")} title={t("Отдалить")}><Icon name="zoom-out" /></button>
      </div>
    </div>
  );
}
