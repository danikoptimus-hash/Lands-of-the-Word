import { useMemo , useState} from "react";
import { BOOKS } from "@lotw/domain";
import { HEX_SIZE, fieldBounds, nodePos } from "../lib/hexmap";
import { useViewport } from "../lib/useViewport";
import type { MyMapDto } from "../lib/api";
import { HexTiles, IMG, Sea } from "./MapLayers";
import { t } from "../lib/i18n";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

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
    for (const t of map.tasks) m.set([t.fromKey, t.toKey].sort().join("|"), t);
    return m;
  }, [map.tasks]);
  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of map.revealed) m.set(n.key, nodePos(n.key, size));
    for (const e of map.edges) { if (!m.has(e.aKey)) m.set(e.aKey, nodePos(e.aKey, size)); if (!m.has(e.bKey)) m.set(e.bKey, nodePos(e.bKey, size)); }
    return m;
  }, [map, size]);

  if (!bounds) return null;
  const { k, tx, ty } = vp.view;
  const S = (p: { x: number; y: number }) => ({ x: tx + p.x * k, y: ty + p.y * k });
  const click = (taskId: string) => { if (!vp.wasDrag()) onSelect(selectedTaskId === taskId ? null : taskId); };
  const [ripple, setRipple] = useState<{ x: number; y: number; n: number } | null>(null);
  const clickCity = (key: string) => {
    if (vp.wasDrag()) return;
    const p = positions.get(key); if (p) setRipple((r) => ({ x: p.x, y: p.y, n: (r?.n ?? 0) + 1 }));
    onSelectCity(key);
  };
  const statusColor = (s: string) => s === "SUBMITTED" ? "#C7742A" : s === "TAKEN" ? "#3E7A4E" : s === "REJECTED" ? "#B3402F" : "#FFFFFF";
  const R = k >= 1.6 ? 12 : 9;
  // Уровни детализации: при отдалении метки дел и подписи прячутся, чтобы не заслонять карту.
  const showMarkers = k >= 0.9, showLabels = k >= 1.6, showForks = k >= 0.7;
  // Город масштабируется с картой: сидит на перекрёстке и занимает место до середины трёх сторон.
  const CITY = size * 1.15, START = size * 1.35;

  return (
    <div ref={vp.ref} {...vp.handlers} style={{ position: "absolute", inset: 0, touchAction: "none", cursor: "grab", userSelect: "none", overflow: "hidden", background: "#2B2724" }}>
      <svg width="100%" height="100%" style={{ display: "block" }}>
        <g transform={`translate(${tx},${ty}) scale(${k})`}>
          <Sea size={size} id="sea-team" dim />
          <HexTiles hexes={map.hexes} size={size} clipId="hexclip-team" />
          {map.edges.map((e) => {
            const a = positions.get(e.aKey)!, b = positions.get(e.bKey)!;
            const t = taskByEdge.get([e.aKey, e.bKey].sort().join("|"));
            const done = t?.status === "APPROVED";
            const active = t && !done;
            const sel = t?.id === selectedTaskId;
            return (
              <g key={e.aKey + e.bKey} onClick={() => active && click(t.id)} style={{ cursor: active ? "pointer" : "default" }}>
                {active && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={22} vectorEffect="non-scaling-stroke" />}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={done ? map.team.color : sel ? "#FFFFFF" : active ? "#F3EAD3" : "rgba(255,255,255,.25)"} strokeWidth={done ? 6 : sel ? 5 : 3} strokeLinecap="round" strokeDasharray={active && !sel ? "7 6" : undefined} vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
          {map.revealed.map((n) => {
            const p = positions.get(n.key)!;
            if (n.kind === "START") return <image key={"s" + n.key} href={IMG.start(teamIndex)} x={p.x - START / 2} y={p.y - START * 0.58} width={START} height={START} />;
            if (n.kind === "CITY") {
              const c = cityByKey.get(n.key);
              return (
                <g key={"c" + n.key} onClick={() => clickCity(n.key)} style={{ cursor: "pointer" }}>
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
            if (n.kind === "START") return <circle key={n.key} cx={p.x} cy={p.y} r={6} fill={map.team.color} stroke="#fff" strokeWidth={2} />;
            if (n.kind === "CITY") {
              const c = cityByKey.get(n.key);
              const fill = c?.owner ? c.owner.color : "#F3EAD3", ink = c?.owner ? "#fff" : "#1F1B16";
              const progress = c && c.total > 0 && !c.captured ? `${c.done}/${c.total}` : null;
              const suffix = c?.ruined ? t(" · руины") : c?.blocked ? (c.passage === "PENDING" ? t(" · ждём прохода") : t(" · проход закрыт")) : "";
              const swords = c?.battle ? <text x={CITY * k * 0.45} y={-CITY * k * 0.55} fontSize={Math.max(14, 22 * Math.min(1.4, k))} textAnchor="middle" fill={c.battle === "ATTACK" ? "#2F6FB3" : "#B3402F"} stroke="#fff" strokeWidth={3} paintOrder="stroke" style={{ pointerEvents: "none" }}>🌊</text> : null;
              return showLabels ? (
                <g key={n.key} transform={`translate(${p.x},${p.y + CITY * k * 0.48})`} onClick={() => clickCity(n.key)} style={{ cursor: "pointer" }}>
                  {swords && <g transform={`translate(0,${-CITY * k * 0.48})`}>{swords}</g>}
                  <rect x={suffix ? -70 : -52} y={-10} width={suffix ? 140 : 104} height={20} rx={4} fill={c?.ruined ? "#6B645A" : fill} stroke="#1F1B16" strokeWidth={1} />
                  <text textAnchor="middle" dy="0.35em" fontSize={11} fontWeight={700} fill={ink}>{book?.nameRu}{c?.isCapital ? " ★" : ""}{progress ? ` · ${progress}` : ""}{suffix}</text>
                </g>
              ) : <g key={n.key} transform={`translate(${p.x},${p.y})`} onClick={() => clickCity(n.key)} style={{ cursor: "pointer" }}><circle r={4} fill={c?.owner ? c.owner.color : "#fff"} stroke="#1F1B16" strokeWidth={1} />{swords}</g>;
            }
            if (!showForks) return null;
            return <circle key={n.key} cx={p.x} cy={p.y} r={5} fill="#fff" stroke="#1F1B16" strokeWidth={1.2} />;
          })}
          {showMarkers && (map.peeked ?? []).map((p) => {
            const pos = positions.get(p.key);
            if (!pos) return null;
            const q = S(pos);
            return <text key={"pk" + p.key} x={q.x} y={q.y - 12} textAnchor="middle" fontSize={14} stroke="#fff" strokeWidth={3} paintOrder="stroke" style={{ pointerEvents: "none" }}>{p.kind === "CITY" ? "🏰" : "🔭"}</text>;
          })}
          {showMarkers && map.edges.map((e) => {
            const t = taskByEdge.get([e.aKey, e.bKey].sort().join("|"));
            if (!t || t.status === "APPROVED") return null;
            const a = positions.get(e.aKey)!, b = positions.get(e.bKey)!;
            const m = S({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            const far = revealed.has(e.aKey) ? S(b) : S(a);
            const sel = t.id === selectedTaskId;
            return (
              <g key={"m" + e.aKey + e.bKey} onClick={() => click(t.id)} style={{ cursor: "pointer" }}>
                <circle cx={far.x} cy={far.y} r={5} fill="#B9B1A5" />
                <circle cx={m.x} cy={m.y} r={sel ? R + 2 : R} fill={statusColor(t.status)} stroke="#1F1B16" strokeWidth={sel ? 2.5 : 1.3} />
                <text x={m.x} y={m.y} textAnchor="middle" dy="0.35em" fontSize={R} fontWeight={700} fill="#1F1B16" style={{ pointerEvents: "none" }}>✓</text>
              </g>
            );
          })}
          {ripple && <circle key={ripple.n} className="map-ripple" cx={ripple.x} cy={ripple.y} r={6} />}
        </g>
      </svg>
      <div className="map-controls">
        <button className="secondary sm" onClick={vp.fit} aria-label={t("Вся карта")}>⤢</button>
        {start && <button className="secondary sm" onClick={() => vp.focusOn(start.x, start.y, 2.4)} aria-label={t("К старту")}>★</button>}
      </div>
    </div>
  );
}
