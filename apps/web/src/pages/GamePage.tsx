import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BOOKS, hexToPixel } from "@lotw/domain";
import { api, ApiError, type MapEdgeDto, type MapNodeDto } from "../lib/api";
import { TeamsBlock } from "./TeamsBlock";
import { DeedsBlock } from "./DeedsBlock";
import { StartBlock } from "./StartBlock";
import { SettingsBlock } from "./SettingsBlock";

interface GameDto { id: string; name: string; status: string; teamCount: number; mapSeed: number | null; settings: { nodeCount?: number; equidistantStarts?: boolean; maxStartDistanceDiff?: number } }
interface Stats { nodeCount: number; cityCount: number; startDistances: number[]; minCityGap: number }

const TERRAIN_COLOR: Record<string, string> = {
  desert: "#D9B97A", hills: "#B99A5B", meadow: "#8FA05A", mountains: "#8E8272", water: "#4F7C99", oasis: "#7D8B4E",
};
const TEAM_COLORS = ["#A9553A", "#4F7C99", "#7D8B4E", "#8E5A9E", "#C48A3F", "#3B6E6E"];
const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

export function GamePage() {
  const { id = "" } = useParams();
  const [game, setGame] = useState<GameDto | null>(null);
  const [nodes, setNodes] = useState<MapNodeDto[]>([]);
  const [edges, setEdges] = useState<MapEdgeDto[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<MapNodeDto | null>(null);
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const load = useCallback(async () => {
    const r = await api<{ game: GameDto; nodes: MapNodeDto[]; edges: MapEdgeDto[] }>(`/api/games/${id}`);
    setGame(r.game); setNodes(r.nodes); setEdges(r.edges);
  }, [id]);

  useEffect(() => { load().catch((e) => setError(e instanceof ApiError ? e.message : "Ошибка сети")); }, [load]);

  async function generate() {
    setBusy(true); setError(null); setSelected(null);
    try {
      const r = await api<{ seed: number; stats: Stats }>(`/api/games/${id}/generate`, { method: "POST", body: JSON.stringify({}) });
      setStats(r.stats);
      await load();
      bump();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ошибка сети");
    } finally { setBusy(false); }
  }

  const size = 22;
  const layout = useMemo(() => {
    if (nodes.length === 0) return null;
    const pts = nodes.map((n) => ({ n, ...hexToPixel({ q: n.q, r: n.r }, size) }));
    const minX = Math.min(...pts.map((p) => p.x)) - size * 1.2, maxX = Math.max(...pts.map((p) => p.x)) + size * 1.2;
    const minY = Math.min(...pts.map((p) => p.y)) - size * 1.2, maxY = Math.max(...pts.map((p) => p.y)) + size * 1.2;
    const byKey = new Map(pts.map((p) => [p.n.key, p]));
    return { pts, byKey, viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}` };
  }, [nodes]);

  const hexPath = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      pts.push(`${(Math.cos(a) * size * 0.95).toFixed(2)},${(Math.sin(a) * size * 0.95).toFixed(2)}`);
    }
    return pts.join(" ");
  }, []);

  if (error && !game) return <p className="error">{error}</p>;
  if (!game) return <p className="muted">Загрузка…</p>;

  return (
    <>
      <p><Link to="/">← Мои игры</Link></p>
      <div className="card">
        <div className="card-head">
          <div><h1>{game.name}</h1><div className="muted">Команд: {game.teamCount}{game.mapSeed != null ? ` · seed карты ${game.mapSeed}` : ""}</div></div>
          <span className={"badge" + (game.status === "ACTIVE" ? " accent" : "")}>{game.status === "DRAFT" ? "черновик" : game.status === "ACTIVE" ? "идёт" : "завершена"}</span>
        </div>
        <div className="row">
          <button onClick={() => void generate()} disabled={busy || game.status !== "DRAFT"}>{nodes.length ? "Сгенерировать ещё раз" : "Сгенерировать карту"}</button>
          {stats && <span className="muted">узлов {stats.nodeCount} · городов {stats.cityCount} · до первого города {stats.startDistances.join(" / ")}</span>}
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <SettingsBlock key={game.teamCount + ":" + game.name} game={game} onSaved={() => { void load(); bump(); }} />
      <StartBlock gameId={game.id} status={game.status} version={version} onStarted={() => void load()} />
      <TeamsBlock gameId={game.id} teamCount={game.teamCount} status={game.status} onChange={bump} />
      <DeedsBlock gameId={game.id} onChange={bump} />

      {layout && (
        <div className="card">
          <h2>Карта (вид админа)</h2>
          <div className="mapwrap">
            <svg viewBox={layout.viewBox} width="100%" style={{ minWidth: 640, display: "block" }}>
              {edges.map((e) => {
                const a = layout.byKey.get(e.aKey), b = layout.byKey.get(e.bKey);
                if (!a || !b) return null;
                return <line key={e.aKey + e.bKey} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(59,47,47,.12)" strokeWidth={1} />;
              })}
              {layout.pts.map(({ n, x, y }) => {
                const book = n.bookCode ? BOOK_BY_CODE.get(n.bookCode) : undefined;
                const fill = n.kind === "START" ? TEAM_COLORS[(n.teamIndex ?? 0) % TEAM_COLORS.length] : TERRAIN_COLOR[n.terrain] ?? "#ccc";
                return (
                  <g key={n.key} transform={`translate(${x},${y})`} onClick={() => setSelected(n)} style={{ cursor: "pointer" }}>
                    <polygon points={hexPath} fill={fill} stroke={selected?.key === n.key ? "#3B2F2F" : "rgba(59,47,47,.25)"} strokeWidth={selected?.key === n.key ? 2 : 1} />
                    {n.kind === "CITY" && <circle r={size * 0.42} fill="#f3ead3" stroke="#3B2F2F" strokeWidth={1.2} />}
                    {n.kind === "CITY" && <text textAnchor="middle" dy="0.35em" fontSize={size * 0.5} fill="#3B2F2F">{book?.order ?? "?"}</text>}
                    {n.kind === "START" && <text textAnchor="middle" dy="0.35em" fontSize={size * 0.6} fill="#fff">★</text>}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="legend">
            <span style={{ ["--c" as string]: TERRAIN_COLOR.desert }}>пустыня</span>
            <span style={{ ["--c" as string]: TERRAIN_COLOR.hills }}>холмы</span>
            <span style={{ ["--c" as string]: TERRAIN_COLOR.meadow }}>луг</span>
            <span style={{ ["--c" as string]: TERRAIN_COLOR.mountains }}>горы</span>
            <span style={{ ["--c" as string]: TERRAIN_COLOR.water }}>вода</span>
            <span style={{ ["--c" as string]: TERRAIN_COLOR.oasis }}>оазис</span>
            <span style={{ ["--c" as string]: "#f3ead3" }}>город (номер книги)</span>
            <span style={{ ["--c" as string]: TEAM_COLORS[0] }}>★ старт команды</span>
          </div>
          {selected && (
            <p className="note ok" style={{ marginTop: ".75rem" }}>
              Узел {selected.key}: {selected.kind === "CITY" ? `город — ${BOOK_BY_CODE.get(selected.bookCode ?? "")?.nameRu ?? "?"} (${selected.cityType})` : selected.kind === "START" ? `старт команды ${(selected.teamIndex ?? 0) + 1}` : "пустая развилка"}, местность: {selected.terrain}
            </p>
          )}
          <p className="hint">Служебное превью для генерации. Игровая карта с иллюстрациями, туманом и масштабированием будет отдельно.</p>
        </div>
      )}
      {!layout && <div className="card"><p className="muted">Карта ещё не сгенерирована. Нажми «Сгенерировать карту».</p></div>}
    </>
  );
}
