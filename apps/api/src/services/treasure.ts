import { prisma } from "../db.js";
import { publish } from "./events.js";
import { notifyTeam } from "./notify.js";
import { journal } from "./journal.js";
import { loadCityContent } from "./cities.js";

/**
 * Руины с сокровищем (решение владельца 18.09, M-10): первая команда, изучившая руины (решившая все задания),
 * находит знак шифра соседнего города — один район соседнего города засчитывается ей как решённый.
 * Сосед — город, связанный с руинами стороной, ещё не взятый этой командой; из его нерешённых районов берётся первый.
 */
export async function ruinsTreasure(gameId: string, teamId: string, nodeKey: string, book: string): Promise<void> {
  const claimed = await prisma.mapNode.updateMany({ where: { gameId, key: nodeKey, treasureTeamId: null }, data: { treasureTeamId: teamId } });
  if (claimed.count === 0) return;
  // Города никогда не стоят рядом (между ними перекрёстки): сосед — ближайший город по числу сторон пути.
  const edges = await prisma.mapEdge.findMany({ where: { gameId }, select: { aKey: true, bKey: true } });
  const adj = new Map<string, string[]>();
  for (const e of edges) { adj.set(e.aKey, [...(adj.get(e.aKey) ?? []), e.bKey]); adj.set(e.bKey, [...(adj.get(e.bKey) ?? []), e.aKey]); }
  const allCities = await prisma.mapNode.findMany({ where: { gameId, bookCode: { not: null }, NOT: { key: nodeKey } }, select: { key: true, bookCode: true } });
  const isCity = new Map(allCities.map((c) => [c.key, c.bookCode]));
  const seen = new Set([nodeKey]);
  let frontier = [nodeKey];
  const cities: Array<{ key: string; bookCode: string }> = [];
  for (let depth = 0; depth < 8 && frontier.length && !cities.length; depth++) {
    const next: string[] = [];
    for (const k of frontier) for (const n of adj.get(k) ?? []) { if (seen.has(n)) continue; seen.add(n); next.push(n); if (isCity.has(n)) cities.push({ key: n, bookCode: isCity.get(n)! }); }
    frontier = next;
    cities.sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  for (const c of cities) {
    const state = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId, nodeKey: c.key } } });
    if (state?.capturedAt) continue;
    const content = await loadCityContent(c.bookCode);
    if (!content) continue;
    const idx = content.tasks.findIndex((_, i) => !(state?.doneTasks ?? []).includes(i));
    if (idx < 0) continue;
    await prisma.teamCityState.upsert({ where: { teamId_nodeKey: { teamId, nodeKey: c.key } }, create: { gameId, teamId, nodeKey: c.key, doneTasks: [idx] }, update: { doneTasks: { push: idx } } });
    journal(gameId, "treasure", { teamId, vars: { book, other: c.bookCode, n: idx + 1 } });
    notifyTeam(gameId, teamId, "находка в руинах города {book}", "Ваша команда первой изучила руины: найден знак шифра города {other} — район {n} засчитан.", { book, other: c.bookCode, n: idx + 1 });
    publish(gameId, { type: "cities", teamId });
    return;
  }
}
