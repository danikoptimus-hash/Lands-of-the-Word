import { parseVertexKey, vertexHexes } from "@lotw/domain";
import type { MyMapDto } from "../lib/api";
import type { Move } from "./Timeline";

/**
 * Ползунок истории на карте команды (решение владельца 05.10: такой же, как у администратора). Команда листает
 * только свои ходы: открытые перекрёстки, пройденные стороны, взятые города — по отметкам времени из карты.
 * Чужие стороны, метки, точки края тумана и свободные дела в прошлом не показываются: их тогда могло не быть.
 */
export function teamMoves(map: MyMapDto): Move[] {
  const start = map.startedAt ? Date.parse(map.startedAt) : 0;
  const team = map.team.name;
  const moves: Move[] = [];
  for (const n of map.revealed) if (n.revealedAt && n.key !== map.team.startNodeKey && Date.parse(n.revealedAt) > start) moves.push({ at: Date.parse(n.revealedAt), team, kind: "reveal" });
  for (const tk of map.tasks) if (tk.status === "APPROVED" && tk.decidedAt) moves.push({ at: Date.parse(tk.decidedAt), team, kind: "traverse" });
  for (const c of map.cities) if (c.capturedAt) moves.push({ at: Date.parse(c.capturedAt), team, kind: c.isCapital ? "capital" : "capture" });
  moves.sort((a, b) => a.at - b.at);
  // Принятие дела открывает перекрёсток в ту же секунду: это один ход (как у администратора).
  return moves.filter((m, i) => i === 0 || m.at - moves[i - 1]!.at > 1500 || m.kind !== "reveal");
}

/** Карта команды на момент `at`: открыто и пройдено только то, что было к этому моменту. */
export function mapAt(map: MyMapDto, at: Date): MyMapDto {
  const ms = at.getTime();
  const revealed = map.revealed.filter((n) => !n.revealedAt || Date.parse(n.revealedAt) <= ms);
  const keys = new Set(revealed.map((n) => n.key));
  const lit = new Set<string>();
  for (const n of revealed) for (const h of vertexHexes(parseVertexKey(n.key))) lit.add(`${h.q},${h.r}`);
  const hexes = map.hexes.map((h) => (h.lit !== false && lit.has(`${h.q},${h.r}`) ? h : { q: h.q, r: h.r, island: h.island, lit: false as const }));
  const tasks = map.tasks.filter((tk) => tk.status === "APPROVED" && tk.decidedAt && Date.parse(tk.decidedAt) <= ms).map((tk) => ({ ...tk, landing: false, candidates: undefined }));
  const cities = map.cities.filter((c) => keys.has(c.nodeKey)).map((c) => (c.capturedAt && Date.parse(c.capturedAt) > ms ? { ...c, captured: false, isCapital: false, battle: null } : { ...c, battle: null }));
  return { ...map, hexes, revealed, edges: map.edges.filter((e) => keys.has(e.aKey) || keys.has(e.bKey)), tasks, cities, peeked: [], frontier: [], marks: [], foreign: [], dailyBird: null };
}
