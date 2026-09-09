import { useMemo } from "react";
import { BOOKS } from "@lotw/domain";
import { HEX_SIZE, fieldBounds, nodePos } from "../lib/hexmap";
import { useViewport } from "../lib/useViewport";
import type { MyMapDto } from "../lib/api";
import { HexTiles, IMG } from "./MapLayers";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

/**
 * Карта команды на весь экран. Гексы и стороны — в масштабируемом слое,
 * значки (старт, город, метки дел, подписи) — в экранном слое постоянного размера.
 */
export function TeamMap({ map, teamIndex, selectedTaskId, onSelect }: { map: MyMapDto; teamIndex: number; selectedTaskId: string | null; onSelect: (taskId: string | null) => void }) {
  const size = HEX_SIZE;
  const bounds = useMemo(() => (map.hexes.length ? fieldBounds(map.hexes, size) : null), [map.hexes, size]);
  const start = useMemo(() => (map.team.startNodeKey ? nodePos(map.team.startNodeKey, size) : null), [map.team.startNodeKey, size]);
  const vp = useViewport(bounds, start ? { x: start.x, y: start.y, k: 2.4 } : null);
  const revealed = useMemo(() => new Set(map.revealed.map((n) => n.key)), [map.revealed]);
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
  const statusColor = (s: string) => s === "SUBMITTED" ? "#C7742A" : s === "TAKEN" ? "#3E7A4E" : s === "REJECTED" ? "#B3402F" : "#FFFFFF";
  const R = 12;
  const CITY = 60, START = 72;

  return (
    <div ref={vp.ref} {...vp.handlers} style={{ position: "absolute", inset: 0, touchAction: "none", cursor: "grab", userSelect: "none", overflow: "hidden", background: "#2B2724" }}>
      <svg width="100%" height="100%" style={{ display: "block" }}>
        <g transform={`translate(${tx},${ty}) scale(${k})`}>
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
        </g>
        <g>
          {map.revealed.map((n) => {
            const p = S(positions.get(n.key)!);
            const book = n.bookCode ? BOOK_BY_CODE.get(n.bookCode) : undefined;
            if (n.kind === "START") return <g key={n.key} transform={`translate(${p.x},${p.y})`}><image href={IMG.start(teamIndex)} x={-START / 2} y={-START * 0.6} width={START} height={START} /><circle r={7} fill={map.team.color} stroke="#fff" strokeWidth={2} /></g>;
            if (n.kind === "CITY") return (
              <g key={n.key} transform={`translate(${p.x},${p.y})`}>
                <image href={IMG.city(n.cityType)} x={-CITY / 2} y={-CITY * 0.62} width={CITY} height={CITY} />
                <g transform={`translate(0,${CITY * 0.42})`}>
                  <rect x={-46} y={-10} width={92} height={20} rx={4} fill="#F3EAD3" stroke="#1F1B16" strokeWidth={1} />
                  <text textAnchor="middle" dy="0.35em" fontSize={11} fontWeight={700} fill="#1F1B16">{book?.nameRu}</text>
                </g>
              </g>
            );
            return <circle key={n.key} cx={p.x} cy={p.y} r={5} fill="#fff" stroke="#1F1B16" strokeWidth={1.2} />;
          })}
          {map.edges.map((e) => {
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
                <text x={m.x} y={m.y} textAnchor="middle" dy="0.35em" fontSize={12} fontWeight={700} fill="#1F1B16" style={{ pointerEvents: "none" }}>✓</text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="map-controls">
        <button className="secondary sm" onClick={() => vp.zoomAt(1.3)} aria-label="Приблизить">+</button>
        <button className="secondary sm" onClick={() => vp.zoomAt(1 / 1.3)} aria-label="Отдалить">−</button>
        <button className="secondary sm" onClick={vp.fit} aria-label="Вся карта">⤢</button>
        {start && <button className="secondary sm" onClick={() => vp.focusOn(start.x, start.y, 2.4)} aria-label="К старту">★</button>}
      </div>
    </div>
  );
}
