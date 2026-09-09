import { prisma } from "../db.js";
import { hexCorners, vertexKey } from "@lotw/domain";
import { loadCityContent } from "./cities.js";

/**
 * Карта глазами команды.
 * Открытые узлы (TeamNodeState) — команда «стоит» на всех открытых узлах.
 * Фронтир — рёбра из открытых узлов в ещё не открытые; на каждом висит дело (TeamEdgeTask).
 * Одобрение дела открывает узел за ребром.
 */

async function pickDeed(gameId: string, teamId: string): Promise<string | null> {
  const [deeds, used] = await Promise.all([
    prisma.deed.findMany({ where: { gameId }, select: { id: true, canRepeat: true } }),
    prisma.teamEdgeTask.findMany({ where: { teamId }, select: { deedId: true } }),
  ]);
  if (deeds.length === 0) return null;
  const usedIds = new Set(used.map((u) => u.deedId));
  // 1) ещё не встречавшиеся команде; 2) допускающие повтор; 3) любое (крайний случай).
  const fresh = deeds.filter((d) => !usedIds.has(d.id));
  const pool = fresh.length ? fresh : deeds.filter((d) => d.canRepeat).length ? deeds.filter((d) => d.canRepeat) : deeds;
  return pool[Math.floor(Math.random() * pool.length)]!.id;
}

/** Создаёт недостающие задачи на рёбрах фронтира. Идемпотентно. */
export async function ensureFrontier(gameId: string, teamId: string): Promise<void> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  if (!team.startNodeKey) return;
  const revealedCount = await prisma.teamNodeState.count({ where: { teamId } });
  if (revealedCount === 0) await prisma.teamNodeState.create({ data: { teamId, nodeKey: team.startNodeKey } });

  const revealed = new Set((await prisma.teamNodeState.findMany({ where: { teamId }, select: { nodeKey: true } })).map((n) => n.nodeKey));
  const edges = await prisma.mapEdge.findMany({ where: { gameId }, select: { aKey: true, bKey: true } });
  const existing = new Set((await prisma.teamEdgeTask.findMany({ where: { teamId }, select: { fromKey: true, toKey: true } })).map((t) => `${t.fromKey}>${t.toKey}`));

  const wanted: Array<{ fromKey: string; toKey: string }> = [];
  for (const e of edges) {
    for (const [from, to] of [[e.aKey, e.bKey], [e.bKey, e.aKey]] as const) {
      if (revealed.has(from) && !revealed.has(to) && !existing.has(`${from}>${to}`)) wanted.push({ fromKey: from, toKey: to });
    }
  }
  for (const w of wanted) {
    const deedId = await pickDeed(gameId, teamId);
    if (!deedId) return;
    await prisma.teamEdgeTask.create({ data: { teamId, gameId, fromKey: w.fromKey, toKey: w.toKey, deedId } });
  }
}

export async function revealNode(gameId: string, teamId: string, nodeKey: string): Promise<void> {
  await prisma.teamNodeState.upsert({ where: { teamId_nodeKey: { teamId, nodeKey } }, create: { teamId, nodeKey }, update: {} });
  await ensureFrontier(gameId, teamId);
}

export async function getTeamMap(gameId: string, teamId: string) {
  await ensureFrontier(gameId, teamId);
  const [revealedRows, tasks, hexes, nodes, edges] = await Promise.all([
    prisma.teamNodeState.findMany({ where: { teamId }, select: { nodeKey: true, revealedAt: true } }),
    prisma.teamEdgeTask.findMany({
      where: { teamId },
      include: { deed: { select: { id: true, title: true, description: true, direction: true, proofType: true, difficulty: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mapHex.findMany({ where: { gameId }, select: { q: true, r: true, terrain: true, rotation: true } }),
    prisma.mapNode.findMany({ where: { gameId }, select: { key: true, corner: true, q: true, r: true, kind: true, bookCode: true, cityType: true, teamIndex: true } }),
    prisma.mapEdge.findMany({ where: { gameId }, select: { aKey: true, bKey: true } }),
  ]);
  const revealed = new Set(revealedRows.map((r) => r.nodeKey));
  // Города, до которых команда дошла: чей город, и мой прогресс в нём.
  const cityNodes = nodes.filter((n) => n.kind === "CITY" && revealed.has(n.key));
  const [cityStates, owners] = await Promise.all([
    prisma.teamCityState.findMany({ where: { teamId, nodeKey: { in: cityNodes.map((n) => n.key) } } }),
    prisma.teamCityState.findMany({ where: { gameId, nodeKey: { in: cityNodes.map((n) => n.key) }, capturedAt: { not: null } }, select: { nodeKey: true, team: { select: { index: true, name: true, color: true } } } }),
  ]);
  const stateByKey = new Map(cityStates.map((s) => [s.nodeKey, s]));
  const ownerByKey = new Map(owners.map((o) => [o.nodeKey, o.team]));
  const cities = await Promise.all(cityNodes.map(async (n) => {
    const content = await loadCityContent(n.bookCode ?? "");
    const s = stateByKey.get(n.key);
    return {
      nodeKey: n.key,
      hasContent: content !== null,
      total: content?.tasks.length ?? 0,
      owner: ownerByKey.get(n.key) ?? null,
      orderSolved: s?.orderSolved ?? false,
      done: s?.doneTasks.length ?? 0,
      captured: s?.capturedAt != null,
      isCapital: s?.isCapital ?? false,
    };
  }));
  // Гекс освещён, если хотя бы один его угол открыт командой. Остальные видны только силуэтом в тумане.
  const lit = (h: { q: number; r: number }) => hexCorners(h).some((c) => revealed.has(vertexKey(c)));
  return {
    hexes: hexes.map((h) => (lit(h) ? { ...h, lit: true } : { q: h.q, r: h.r, lit: false })),
    revealed: nodes.filter((n) => revealed.has(n.key)),
    // Рёбра, касающиеся открытых узлов: пройденные и фронтир (в туман).
    edges: edges.filter((e) => revealed.has(e.aKey) || revealed.has(e.bKey)),
    tasks: tasks.filter((t) => t.status === "APPROVED" || !revealed.has(t.toKey)),
    cities,
  };
}
