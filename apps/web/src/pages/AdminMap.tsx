import { useMemo, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { HEX_SIZE, TERRAIN_COLOR, fieldBounds, nodePos, TEAM_COLORS } from "../lib/hexmap";
import { HexTiles, IMG } from "./MapLayers";
import { useViewport } from "../lib/useViewport";
import type { MapEdgeDto, MapHexDto, MapNodeDto } from "../lib/api";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
export interface TeamProgress { id: string; name: string; color: string; startNodeKey: string | null; revealed: string[]; traversed: Array<{ fromKey: string; toKey: string }> }

/** Карта админа: вся карта без тумана, города на перекрёстках, пройденные стороны цветами команд (половинками, если прошли двое). */
export function AdminMap({ hexes, nodes, edges, progress }: { hexes: MapHexDto[]; nodes: MapNodeDto[]; edges: MapEdgeDto[]; progress: TeamProgress[] | null }) {
  const size = HEX_SIZE;
  const bounds = useMemo(() => (hexes.length ? fieldBounds(hexes, size) : null), [hexes, size]);
  const vp = useViewport(bounds);
  const [selected, setSelected] = useState<MapNodeDto | null>(null);
  const positions = useMemo(() => new Map(nodes.map((n) => [n.key, nodePos(n.key, size)])), [nodes, size]);
  const traversedBy = useMemo(() => {
    const m = new Map<string, TeamProgress[]>();
    for (const t of progress ?? []) for (const e of t.traversed) { const k = [e.fromKey, e.toKey].sort().join("|"); m.set(k, [...(m.get(k) ?? []), t]); }
    return m;
  }, [progress]);
  const revealedBy = useMemo(() => {
    const m = new Map<string, TeamProgress[]>();
    for (const t of progress ?? []) for (const k of t.revealed) m.set(k, [...(m.get(k) ?? []), t]);
    return m;
  }, [progress]);
  if (!bounds) return null;

  return (
    <>
      <div style={{ position: "relative" }}>
        <div ref={vp.ref} {...vp.handlers} className="mapwrap" style={{ height: "min(70vh, 640px)", minHeight: 360, touchAction: "none", cursor: "grab", userSelect: "none", overflow: "hidden" }}>
          <svg width="100%" height="100%" style={{ display: "block" }}>
            <g transform={`translate(${vp.view.tx},${vp.view.ty}) scale(${vp.view.k})`}>
              <HexTiles hexes={hexes} size={size} clipId="hexclip-admin" />
              {edges.map((e) => {
                const a = positions.get(e.aKey), b = positions.get(e.bKey);
                if (!a || !b) return null;
                const teams = traversedBy.get([e.aKey, e.bKey].sort().join("|")) ?? [];
                if (teams.length === 0) return <line key={e.aKey + e.bKey} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(31,27,22,.25)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
                if (teams.length === 1) return <line key={e.aKey + e.bKey} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={teams[0]!.color} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                return <g key={e.aKey + e.bKey}><line x1={a.x} y1={a.y} x2={mx} y2={my} stroke={teams[0]!.color} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" /><line x1={mx} y1={my} x2={b.x} y2={b.y} stroke={teams[1]!.color} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" /></g>;
              })}
            </g>
            <g>
              {nodes.map((n) => {
                const raw = positions.get(n.key)!;
                const p = { x: vp.view.tx + raw.x * vp.view.k, y: vp.view.ty + raw.y * vp.view.k };
                const book = n.bookCode ? BOOK_BY_CODE.get(n.bookCode) : undefined;
                const seen = revealedBy.get(n.key) ?? [];
                const sel = selected?.key === n.key;
                if (n.kind === "START") { const t = progress?.find((x) => x.startNodeKey === n.key); const color = t?.color ?? TEAM_COLORS[(n.teamIndex ?? 0) % TEAM_COLORS.length]!; return <g key={n.key} transform={`translate(${p.x},${p.y})`} onClick={() => setSelected(n)} style={{ cursor: "pointer" }}><image href={IMG.start(n.teamIndex ?? 0)} x={-28} y={-34} width={56} height={56} /><circle r={6} fill={color} stroke="#fff" strokeWidth={2} /></g>; }
                if (n.kind === "CITY") return (
                  <g key={n.key} transform={`translate(${p.x},${p.y})`} onClick={() => setSelected(sel ? null : n)} style={{ cursor: "pointer" }}>
                    <image href={IMG.city(n.cityType)} x={-22} y={-27} width={44} height={44} opacity={sel ? 1 : 0.95} />
                    <circle cy={16} r={9} fill="#fff" stroke={sel ? "#C7742A" : "#1F1B16"} strokeWidth={sel ? 2.5 : 1.2} />
                    <text y={16} textAnchor="middle" dy="0.35em" fontSize={10} fontWeight={700} fill="#1F1B16">{book?.order ?? "?"}</text>
                    {seen.map((t, i) => <circle key={t.id} cx={18 - i * 9} cy={-22} r={4.5} fill={t.color} stroke="#fff" strokeWidth={1} />)}
                  </g>
                );
                return <g key={n.key} transform={`translate(${p.x},${p.y})`}><circle r={3} fill="rgba(31,27,22,.4)" />{seen.map((t, i) => <circle key={t.id} cx={8 - i * 7} cy={-8} r={3.5} fill={t.color} stroke="#fff" strokeWidth={0.8} />)}</g>;
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
      <div className="legend">
        {Object.entries(TERRAIN_COLOR).map(([k, c]) => <span key={k} style={{ ["--c" as string]: c }}>{({ desert: "пустыня", hills: "холмы", meadow: "луг", mountains: "горы", water: "вода", oasis: "оазис" } as Record<string, string>)[k]}</span>)}
        <span style={{ ["--c" as string]: "#fff" }}>город на перекрёстке (номер книги)</span>
        {progress?.map((t) => <span key={t.id} style={{ ["--c" as string]: t.color }}>{t.name}</span>)}
      </div>
      {selected && (
        <p className="note ok" style={{ marginTop: ".6rem" }}>
          {selected.kind === "CITY" ? `Город ${BOOK_BY_CODE.get(selected.bookCode ?? "")?.nameRu ?? "?"} (${selected.cityType})` : selected.kind === "START" ? `Старт команды ${(selected.teamIndex ?? 0) + 1}` : "Развилка"} · перекрёсток {selected.key}
          {(revealedBy.get(selected.key) ?? []).length > 0 && ` · открыт: ${(revealedBy.get(selected.key) ?? []).map((t) => t.name).join(", ")}`}
        </p>
      )}
    </>
  );
}
