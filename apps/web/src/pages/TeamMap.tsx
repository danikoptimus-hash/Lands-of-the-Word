import { useMemo } from "react";
import { BOOKS } from "@lotw/domain";
import { hexPoints, layoutOf, HEX_SIZE, TERRAIN_COLOR } from "../lib/hexmap";
import { useViewport } from "../lib/useViewport";
import type { MyMapDto } from "../lib/api";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

/**
 * Карта команды: масштаб (колесо, щипок, кнопки), перетаскивание, клик по клетке в тумане или по метке дела.
 * selectedKey — выбранная клетка в тумане; onSelect(key | null).
 */
export function TeamMap({ map, selectedKey, onSelect }: { map: MyMapDto; selectedKey: string | null; onSelect: (key: string | null) => void }) {
  const size = HEX_SIZE;
  const layout = useMemo(() => layoutOf([...map.revealed, ...map.fog], size), [map, size]);
  const bounds = useMemo(() => {
    const [minX, minY, w, h] = layout.viewBox.split(" ").map(Number) as [number, number, number, number];
    return { minX, minY, width: w, height: h };
  }, [layout]);
  const vp = useViewport(map.revealed.length ? bounds : null);
  const poly = useMemo(() => hexPoints(size), [size]);
  const polyBig = useMemo(() => hexPoints(size, 1.02), [size]);
  const revealed = useMemo(() => new Set(map.revealed.map((n) => n.key)), [map.revealed]);
  const taskToFog = useMemo(() => {
    const m = new Map<string, typeof map.tasks>();
    for (const t of map.tasks) if (t.status !== "APPROVED") m.set(t.toKey, [...(m.get(t.toKey) ?? []), t]);
    return m;
  }, [map.tasks]);
  const traversed = useMemo(() => new Set(map.tasks.filter((t) => t.status === "APPROVED").map((t) => [t.fromKey, t.toKey].sort().join("|"))), [map.tasks]);

  if (map.revealed.length === 0) return null;
  const click = (key: string) => { if (!vp.wasDrag()) onSelect(selectedKey === key ? null : key); };
  const statusColor = (s: string) => s === "SUBMITTED" ? "#C7742A" : s === "TAKEN" ? "#3E7A4E" : s === "REJECTED" ? "#B3402F" : "#FFFFFF";

  return (
    <div style={{ position: "relative" }}>
      <div ref={vp.ref} {...vp.handlers} className="mapwrap" style={{ height: "min(70vh, 560px)", minHeight: 320, touchAction: "none", cursor: "grab", userSelect: "none", overflow: "hidden" }}>
        <svg width="100%" height="100%" style={{ display: "block" }}>
          <g transform={`translate(${vp.view.tx},${vp.view.ty}) scale(${vp.view.k})`}>
            {map.edges.map((e) => {
              const a = layout.byKey.get(e.aKey), b = layout.byKey.get(e.bKey);
              if (!a || !b) return null;
              const done = traversed.has([e.aKey, e.bKey].sort().join("|"));
              const fogEnd = revealed.has(e.aKey) ? (revealed.has(e.bKey) ? null : e.bKey) : e.aKey;
              const sel = fogEnd !== null && fogEnd === selectedKey;
              return <line key={e.aKey + e.bKey} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={done ? map.team.color : sel ? "#1F1B16" : "rgba(31,27,22,.22)"} strokeWidth={done ? 5 : sel ? 3.5 : 2} strokeLinecap="round" strokeDasharray={fogEnd && !done && !sel ? "4 4" : undefined} />;
            })}
            {map.fog.map((f) => {
              const p = layout.byKey.get(f.key)!;
              const tasks = taskToFog.get(f.key) ?? [];
              const status = tasks.some((t) => t.status === "SUBMITTED") ? "SUBMITTED" : tasks.some((t) => t.status === "TAKEN") ? "TAKEN" : tasks.some((t) => t.status === "REJECTED") ? "REJECTED" : "OPEN";
              const sel = f.key === selectedKey;
              return (
                <g key={f.key} transform={`translate(${p.x},${p.y})`} onClick={() => click(f.key)} style={{ cursor: "pointer" }}>
                  <polygon points={sel ? polyBig : poly} fill={sel ? "#5E574F" : "#4A443D"} stroke={sel ? "#1F1B16" : "#2E2A26"} strokeWidth={sel ? 2.5 : 1} />
                  <text textAnchor="middle" dy="0.35em" fontSize={size * 0.7} fill="#B9B1A5" style={{ pointerEvents: "none" }}>?</text>
                  {tasks.length > 0 && <circle cx={size * 0.45} cy={-size * 0.45} r={size * 0.22} fill={statusColor(status)} stroke="#1F1B16" strokeWidth={1.2} />}
                </g>
              );
            })}
            {map.revealed.map((n) => {
              const p = layout.byKey.get(n.key)!;
              const book = n.bookCode ? BOOK_BY_CODE.get(n.bookCode) : undefined;
              const isStart = n.kind === "START";
              return (
                <g key={n.key} transform={`translate(${p.x},${p.y})`}>
                  <polygon points={poly} fill={isStart ? map.team.color : TERRAIN_COLOR[n.terrain] ?? "#ccc"} stroke="rgba(31,27,22,.35)" />
                  {n.kind === "CITY" && <circle r={size * 0.45} fill="#fff" stroke="#1F1B16" strokeWidth={1.2} />}
                  {n.kind === "CITY" && <text textAnchor="middle" dy="0.35em" fontSize={size * 0.42} fill="#1F1B16">{book?.order ?? "?"}</text>}
                  {isStart && <text textAnchor="middle" dy="0.35em" fontSize={size * 0.6} fill="#fff">★</text>}
                  {n.kind === "CITY" && <text y={size * 1.15} textAnchor="middle" fontSize={size * 0.38} fontWeight={600} fill="#1F1B16" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }}>{book?.nameRu}</text>}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <div style={{ position: "absolute", right: 10, top: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        <button className="secondary sm" style={{ width: 40, padding: 0 }} onClick={() => vp.zoomAt(1.3)} aria-label="Приблизить">+</button>
        <button className="secondary sm" style={{ width: 40, padding: 0 }} onClick={() => vp.zoomAt(1 / 1.3)} aria-label="Отдалить">−</button>
        <button className="secondary sm" style={{ width: 40, padding: 0 }} onClick={vp.fit} aria-label="Вся карта">⤢</button>
      </div>
    </div>
  );
}

/** Направление от узла к соседу словами (pointy-top гексы). */
export function directionLabel(from: { q: number; r: number }, to: { q: number; r: number }): string {
  const dq = to.q - from.q, dr = to.r - from.r;
  const key = `${dq},${dr}`;
  const names: Record<string, string> = { "1,0": "восток", "1,-1": "северо-восток", "0,-1": "северо-запад", "-1,0": "запад", "-1,1": "юго-запад", "0,1": "юго-восток" };
  return names[key] ?? "";
}
