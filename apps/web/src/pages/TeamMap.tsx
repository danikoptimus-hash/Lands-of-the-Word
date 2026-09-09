import { useMemo } from "react";
import { BOOKS } from "@lotw/domain";
import { FOG_COLOR, HEX_SIZE, TERRAIN_COLOR, fieldBounds, hexCenter, hexPoints, nodePos } from "../lib/hexmap";
import { useViewport } from "../lib/useViewport";
import type { MyMapDto } from "../lib/api";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

/**
 * Карта команды: гексы — местность под туманом, ходим по сторонам гексов.
 * Клик по стороне-с-делом (пунктир с меткой) выбирает задачу: selectedTaskId.
 */
export function TeamMap({ map, selectedTaskId, onSelect }: { map: MyMapDto; selectedTaskId: string | null; onSelect: (taskId: string | null) => void }) {
  const size = HEX_SIZE;
  const bounds = useMemo(() => (map.hexes.length ? fieldBounds(map.hexes, size) : null), [map.hexes, size]);
  const start = useMemo(() => (map.team.startNodeKey ? nodePos(map.team.startNodeKey, size) : null), [map.team.startNodeKey, size]);
  const vp = useViewport(bounds, start ? { x: start.x, y: start.y, k: 2.4 } : null);
  const poly = useMemo(() => hexPoints(size, 0.985), [size]);
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
  const click = (taskId: string) => { if (!vp.wasDrag()) onSelect(selectedTaskId === taskId ? null : taskId); };
  const statusColor = (s: string) => s === "SUBMITTED" ? "#C7742A" : s === "TAKEN" ? "#3E7A4E" : s === "REJECTED" ? "#B3402F" : "#FFFFFF";
  const litHexes = map.hexes.filter((h) => h.lit), fogHexes = map.hexes.filter((h) => !h.lit);

  return (
    <div style={{ position: "relative" }}>
      <div ref={vp.ref} {...vp.handlers} className="mapwrap" style={{ height: "min(70vh, 600px)", minHeight: 340, touchAction: "none", cursor: "grab", userSelect: "none", overflow: "hidden", background: "#2B2724" }}>
        <svg width="100%" height="100%" style={{ display: "block" }}>
          <defs>
            <radialGradient id="fogGlow" r="0.75"><stop offset="0" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.55" /></radialGradient>
          </defs>
          <g transform={`translate(${vp.view.tx},${vp.view.ty}) scale(${vp.view.k})`}>
            {/* Туман: силуэт всего поля. */}
            {fogHexes.map((h) => { const c = hexCenter(h, size); return <polygon key={`f${h.q},${h.r}`} points={poly} transform={`translate(${c.x},${c.y})`} fill={FOG_COLOR} stroke="#2B2724" strokeWidth={1} />; })}
            {/* Освещённые гексы. */}
            {litHexes.map((h) => { const c = hexCenter(h, size); return <polygon key={`l${h.q},${h.r}`} points={poly} transform={`translate(${c.x},${c.y})`} fill={TERRAIN_COLOR[h.terrain ?? ""] ?? "#ccc"} stroke="rgba(31,27,22,.35)" strokeWidth={1} />; })}
            {/* Стороны: пройденные — цветом команды, с делом — пунктир и метка. */}
            {map.edges.map((e) => {
              const a = positions.get(e.aKey)!, b = positions.get(e.bKey)!;
              const t = taskByEdge.get([e.aKey, e.bKey].sort().join("|"));
              const done = t?.status === "APPROVED";
              const active = t && !done;
              const sel = t?.id === selectedTaskId;
              return (
                <g key={e.aKey + e.bKey} onClick={() => active && click(t.id)} style={{ cursor: active ? "pointer" : "default" }}>
                  {active && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={18} />}
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={done ? map.team.color : sel ? "#FFFFFF" : active ? "#F3EAD3" : "rgba(255,255,255,.25)"} strokeWidth={done ? 6 : sel ? 5 : 3.5} strokeLinecap="round" strokeDasharray={active && !sel ? "6 5" : undefined} />
                  {active && <g transform={`translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})`}><circle r={size * 0.28} fill={statusColor(t.status)} stroke={sel ? "#1F1B16" : "#1F1B16"} strokeWidth={sel ? 2.5 : 1.3} /><text textAnchor="middle" dy="0.35em" fontSize={size * 0.32} fontWeight={700} fill="#1F1B16" style={{ pointerEvents: "none" }}>✓</text></g>}
                  {active && !revealed.has(e.bKey) && <circle cx={b.x} cy={b.y} r={size * 0.16} fill="#B9B1A5" />}
                  {active && !revealed.has(e.aKey) && <circle cx={a.x} cy={a.y} r={size * 0.16} fill="#B9B1A5" />}
                </g>
              );
            })}
            {/* Открытые перекрёстки: старт, город, развилка. */}
            {map.revealed.map((n) => {
              const p = positions.get(n.key)!;
              const book = n.bookCode ? BOOK_BY_CODE.get(n.bookCode) : undefined;
              if (n.kind === "START") return <g key={n.key} transform={`translate(${p.x},${p.y})`}><circle r={size * 0.42} fill={map.team.color} stroke="#fff" strokeWidth={2} /><text textAnchor="middle" dy="0.35em" fontSize={size * 0.5} fill="#fff">★</text></g>;
              if (n.kind === "CITY") return (
                <g key={n.key} transform={`translate(${p.x},${p.y})`}>
                  <circle r={size * 0.46} fill="#fff" stroke="#1F1B16" strokeWidth={1.5} />
                  <text textAnchor="middle" dy="0.35em" fontSize={size * 0.42} fontWeight={700} fill="#1F1B16">{book?.order ?? "?"}</text>
                  <text y={size * 0.95} textAnchor="middle" fontSize={size * 0.36} fontWeight={600} fill="#1F1B16" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }}>{book?.nameRu}</text>
                </g>
              );
              return <circle key={n.key} cx={p.x} cy={p.y} r={size * 0.2} fill="#fff" stroke="#1F1B16" strokeWidth={1.2} />;
            })}
          </g>
        </svg>
      </div>
      <div style={{ position: "absolute", right: 10, top: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        <button className="secondary sm" style={{ width: 40, padding: 0 }} onClick={() => vp.zoomAt(1.3)} aria-label="Приблизить">+</button>
        <button className="secondary sm" style={{ width: 40, padding: 0 }} onClick={() => vp.zoomAt(1 / 1.3)} aria-label="Отдалить">−</button>
        <button className="secondary sm" style={{ width: 40, padding: 0 }} onClick={vp.fit} aria-label="Вся карта">⤢</button>
        {start && <button className="secondary sm" style={{ width: 40, padding: 0 }} onClick={() => vp.focusOn(start.x, start.y, 2.4)} aria-label="К старту">★</button>}
      </div>
    </div>
  );
}
