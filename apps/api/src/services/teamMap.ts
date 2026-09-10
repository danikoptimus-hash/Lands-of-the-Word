import { prisma } from "../db.js";
import { hexCorners, vertexKey } from "@lotw/domain";
import { loadCityContent } from "./cities.js";

/**
 * Карта глазами команды.
 * Открытые узлы (TeamNodeState) — команда «стоит» на всех открытых узлах.
 * Фронтир — рёбра из открытых узлов в ещё не открытые; на каждом висит дело (TeamEdgeTask).
 * Одобрение дела открывает узел за ребром.
 */

/** На скольких ближайших векторах хода команды дела не должны повторяться. */
const NO_REPEAT_WINDOW = 30;

/**
 * Дело для стороны, выходящей из узла fromKey. Если это город, взятый командой, — сначала дела по книге
 * этого города (2.7: «выход из города — дела по книге»), затем общий пул.
 */
async function pickDeed(gameId: string, teamId: string, bookCode: string | null): Promise<string | null> {
  const [deeds, used] = await Promise.all([
    prisma.deed.findMany({ where: { gameId }, select: { id: true, canRepeat: true, bookCode: true } }),
    prisma.teamEdgeTask.findMany({ where: { teamId }, select: { deedId: true }, orderBy: { createdAt: "desc" } }),
  ]);
  if (deeds.length === 0) return null;
  const usedIds = new Set(used.map((u) => u.deedId));
  const recentIds = new Set(used.slice(0, NO_REPEAT_WINDOW).map((u) => u.deedId));
  const choose = (list: typeof deeds) => {
    // 1) ещё не встречавшиеся команде; 2) допускающие повтор и не встречавшиеся на 30 последних векторах;
    // 3) любое допускающее повтор.
    const fresh = list.filter((d) => !usedIds.has(d.id));
    const repeatable = list.filter((d) => d.canRepeat);
    const notRecent = repeatable.filter((d) => !recentIds.has(d.id));
    const pool = fresh.length ? fresh : notRecent.length ? notRecent : repeatable;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)]!.id : null;
  };
  if (bookCode) {
    const themed = choose(deeds.filter((d) => d.bookCode === bookCode));
    if (themed) return themed;
  }
  return choose(deeds) ?? deeds[Math.floor(Math.random() * deeds.length)]!.id;
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
  const blocked = await blockedCities(gameId, teamId);
  const ownedBooks = await ownedCityBooks(gameId, teamId);

  const wanted: Array<{ fromKey: string; toKey: string }> = [];
  for (const e of edges) {
    for (const [from, to] of [[e.aKey, e.bKey], [e.bKey, e.aKey]] as const) {
      // Через чужой город без разрешения на проход дальше не идём (2.14 А).
      if (revealed.has(from) && !revealed.has(to) && !existing.has(`${from}>${to}`) && !blocked.has(from)) wanted.push({ fromKey: from, toKey: to });
    }
  }
  for (const w of wanted) {
    const deedId = await pickDeed(gameId, teamId, ownedBooks.get(w.fromKey) ?? null);
    if (!deedId) return;
    await prisma.teamEdgeTask.create({ data: { teamId, gameId, fromKey: w.fromKey, toKey: w.toKey, deedId } });
  }
}

/** Чужие города, через которые команде нельзя идти дальше: заняты другой командой и нет разрешения на проход. */
export async function blockedCities(gameId: string, teamId: string): Promise<Set<string>> {
  const [foreign, grants] = await Promise.all([
    prisma.teamCityState.findMany({ where: { gameId, capturedAt: { not: null }, NOT: { teamId } }, select: { nodeKey: true } }),
    prisma.passageRequest.findMany({ where: { gameId, requesterId: teamId, status: "APPROVED" }, select: { nodeKey: true } }),
  ]);
  const ok = new Set(grants.map((g) => g.nodeKey));
  return new Set(foreign.map((f) => f.nodeKey).filter((k) => !ok.has(k)));
}

/** Книги городов, взятых командой (для тематических дел на выходе из города). */
async function ownedCityBooks(gameId: string, teamId: string): Promise<Map<string, string>> {
  const rows = await prisma.teamCityState.findMany({ where: { teamId, capturedAt: { not: null } }, select: { nodeKey: true } });
  if (rows.length === 0) return new Map();
  const nodes = await prisma.mapNode.findMany({ where: { gameId, key: { in: rows.map((r) => r.nodeKey) } }, select: { key: true, bookCode: true } });
  return new Map(nodes.filter((n) => n.bookCode).map((n) => [n.key, n.bookCode!]));
}

/** Город получил владельца: другим командам без разрешения дальше через него не пройти — их свободные дела из города убираются. */
export async function onCityOwned(gameId: string, nodeKey: string, ownerTeamId: string): Promise<void> {
  const grants = await prisma.passageRequest.findMany({ where: { gameId, nodeKey, status: "APPROVED" }, select: { requesterId: true } });
  await prisma.teamEdgeTask.deleteMany({ where: { gameId, fromKey: nodeKey, status: "OPEN", NOT: { teamId: { in: [ownerTeamId, ...grants.map((g) => g.requesterId)] } } } });
}

/** Разрешение на проход отозвано: незанятые дела на сторонах из этого города убираются (взятые и сданные остаются). */
export async function closePassage(gameId: string, teamId: string, nodeKey: string): Promise<void> {
  await prisma.teamEdgeTask.deleteMany({ where: { gameId, teamId, fromKey: nodeKey, status: "OPEN" } });
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
    prisma.mapNode.findMany({ where: { gameId }, select: { key: true, corner: true, q: true, r: true, kind: true, bookCode: true, cityType: true, teamIndex: true, ruined: true } }),
    prisma.mapEdge.findMany({ where: { gameId }, select: { aKey: true, bKey: true } }),
  ]);
  const revealed = new Set(revealedRows.map((r) => r.nodeKey));
  // Города, до которых команда дошла: чей город, и мой прогресс в нём.
  const cityNodes = nodes.filter((n) => n.kind === "CITY" && revealed.has(n.key));
  const [blocked, peeks, passages] = await Promise.all([
    blockedCities(gameId, teamId),
    prisma.teamPeek.findMany({ where: { teamId }, select: { nodeKey: true } }),
    prisma.passageRequest.findMany({ where: { gameId, requesterId: teamId, status: { in: ["PENDING", "APPROVED", "DECLINED", "EXPIRED", "REVOKED"] } }, orderBy: { createdAt: "desc" }, select: { nodeKey: true, status: true } }),
  ]);
  const passageByKey = new Map<string, string>();
  for (const pr of passages) if (!passageByKey.has(pr.nodeKey)) passageByKey.set(pr.nodeKey, pr.status);
  const [cityStates, owners, battles] = await Promise.all([
    prisma.teamCityState.findMany({ where: { teamId, nodeKey: { in: cityNodes.map((n) => n.key) } } }),
    prisma.teamCityState.findMany({ where: { gameId, nodeKey: { in: cityNodes.map((n) => n.key) }, capturedAt: { not: null } }, select: { nodeKey: true, team: { select: { index: true, name: true, color: true } } } }),
    prisma.battle.findMany({ where: { gameId, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] }, OR: [{ attackerId: teamId }, { defenderId: teamId }] }, select: { nodeKey: true, attackerId: true, status: true } }),
  ]);
  const stateByKey = new Map(cityStates.map((s) => [s.nodeKey, s]));
  const ownerByKey = new Map(owners.map((o) => [o.nodeKey, o.team]));
  // Роль команды в активной битве за город: атакует (синие мечи) или защищается (красные).
  const battleByKey = new Map(battles.map((b) => [b.nodeKey, b.attackerId === teamId ? "ATTACK" : "DEFENSE"]));
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
      battle: battleByKey.get(n.key) ?? null,
      ruined: n.ruined,
      // Проход дальше через чужой город: закрыт, пока владелец не разрешит.
      blocked: blocked.has(n.key),
      passage: passageByKey.get(n.key) ?? null,
    };
  }));
  // Разведчик заглянул за ребро: известен только вид узла (город или развилка), без названия.
  const peekKeys = new Set(peeks.map((p) => p.nodeKey));
  const peeked = nodes.filter((n) => peekKeys.has(n.key) && !revealed.has(n.key)).map((n) => ({ key: n.key, kind: n.kind }));
  // Гекс освещён, если хотя бы один его угол открыт командой. Остальные видны только силуэтом в тумане.
  const lit = (h: { q: number; r: number }) => hexCorners(h).some((c) => revealed.has(vertexKey(c)));
  return {
    hexes: hexes.map((h) => (lit(h) ? { ...h, lit: true } : { q: h.q, r: h.r, lit: false })),
    revealed: nodes.filter((n) => revealed.has(n.key)).map(({ ruined: _r, ...n }) => n),
    // Рёбра, касающиеся открытых узлов: пройденные и фронтир (в туман).
    edges: edges.filter((e) => revealed.has(e.aKey) || revealed.has(e.bKey)),
    tasks: tasks.filter((t) => t.status === "APPROVED" || !revealed.has(t.toKey)),
    cities,
    peeked,
  };
}
