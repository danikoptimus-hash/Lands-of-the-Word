import { useMemo } from "react";
import { BOOKS } from "@lotw/domain";
import { hexPoints, layoutOf, HEX_SIZE, TERRAIN_COLOR } from "../lib/hexmap";
import type { MyMapDto } from "../lib/api";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

/** Карта глазами команды: открытые узлы, туман по краю, дела на рёбрах, пройденные рёбра цветом команды. */
export function TeamMap({ map, selectedTask, onSelectTask }: { map: MyMapDto; selectedTask: string | null; onSelectTask: (taskId: string | null) => void }) {
  const size = HEX_SIZE;
  const layout = useMemo(() => layoutOf([...map.revealed, ...map.fog.map((f) => ({ ...f }))], size), [map]);
  const poly = useMemo(() => hexPoints(size), []);
  const taskByEdge = useMemo(() => new Map(map.tasks.map((t) => [`${t.fromKey}>${t.toKey}`, t])), [map.tasks]);
  const revealedKeys = useMemo(() => new Set(map.revealed.map((n) => n.key)), [map.revealed]);

  if (map.revealed.length === 0) return null;
  const scale = Math.max(1, Math.min(2.2, 700 / layout.width));

  return (
    <div className="mapwrap">
      <svg viewBox={layout.viewBox} width={Math.max(320, layout.width * scale)} height={layout.height * scale} style={{ display: "block", margin: "0 auto" }}>
        {map.edges.map((e) => {
          const a = layout.byKey.get(e.aKey), b = layout.byKey.get(e.bKey);
          if (!a || !b) return null;
          const t = taskByEdge.get(`${e.aKey}>${e.bKey}`) ?? taskByEdge.get(`${e.bKey}>${e.aKey}`);
          const traversed = t?.status === "APPROVED";
          const active = t && t.status !== "APPROVED";
          const sel = t && t.id === selectedTask;
          return (
            <g key={e.aKey + e.bKey} onClick={() => active && onSelectTask(sel ? null : t.id)} style={{ cursor: active ? "pointer" : "default" }}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={traversed ? map.team.color : sel ? "#1F1B16" : "rgba(31,27,22,.18)"} strokeWidth={traversed ? 5 : sel ? 3 : 2} strokeLinecap="round" strokeDasharray={active && !sel ? "4 4" : undefined} />
              {active && <circle cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r={size * 0.3} fill={t.status === "SUBMITTED" ? "#C7742A" : t.status === "TAKEN" ? "#3E7A4E" : t.status === "REJECTED" ? "#B3402F" : "#fff"} stroke="#1F1B16" strokeWidth={1.2} />}
            </g>
          );
        })}
        {map.fog.map((f) => {
          const p = layout.byKey.get(f.key)!;
          return <g key={f.key} transform={`translate(${p.x},${p.y})`}><polygon points={poly} fill="#4A443D" stroke="#2E2A26" /><text textAnchor="middle" dy="0.35em" fontSize={size * 0.7} fill="#B9B1A5">?</text></g>;
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
            </g>
          );
        })}
        {map.revealed.filter((n) => n.kind === "CITY").map((n) => {
          const p = layout.byKey.get(n.key)!;
          const book = BOOK_BY_CODE.get(n.bookCode ?? "");
          return <text key={n.key + "l"} x={p.x} y={p.y + size * 1.15} textAnchor="middle" fontSize={size * 0.38} fontWeight={600} fill="#1F1B16" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }}>{book?.nameRu}</text>;
        })}
        {!revealedKeys.size && null}
      </svg>
    </div>
  );
}
