import { prisma } from "../db.js";
import { bookName, msg } from "./i18n.js";
import { hexCorners, vertexKey } from "@lotw/domain";
import { loadCityContent } from "./cities.js";
import { notifyTeam, notifyUser } from "./notify.js";
import { publish } from "./events.js";
import { days, type Rules } from "./rules.js";

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
/** Веса частоты появления дела: редко : обычно : часто = 1 : 3 : 6 (решение владельца 15.09: простой параметр в три ступени). */
const FREQUENCY_WEIGHT: Record<number, number> = { 1: 1, 2: 3, 3: 6 };
function weightedPick<T extends { frequency: number }>(list: T[]): T {
  const total = list.reduce((a, d) => a + (FREQUENCY_WEIGHT[d.frequency] ?? 3), 0);
  let r = Math.random() * total;
  for (const d of list) { r -= FREQUENCY_WEIGHT[d.frequency] ?? 3; if (r < 0) return d; }
  return list[list.length - 1]!;
}
export async function pickDeed(gameId: string, teamId: string, bookCode: string | null, excludeId?: string): Promise<string | null> {
  // «Встреченными» считаются только дела, которые команда брала или сдавала: свободные стороны не в счёт
  // (решение владельца 18.09: иначе набор кончался уже на фронтире и повторы шли сразу).
  const [deeds, used] = await Promise.all([
    prisma.deed.findMany({ where: { gameId, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, canRepeat: true, bookCodes: true, frequency: true } }),
    prisma.teamEdgeTask.findMany({ where: { teamId, status: { not: "OPEN" } }, select: { deedId: true }, orderBy: { createdAt: "desc" } }),
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
    return pool.length ? weightedPick(pool).id : null;
  };
  if (bookCode) {
    // Пустой список книг — дело подходит к любой книге (как в документе; решение владельца 18.09).
    const themed = choose(deeds.filter((d) => d.bookCodes.length === 0 || d.bookCodes.includes(bookCode)));
    if (themed) return themed;
  }
  return choose(deeds) ?? weightedPick(deeds).id;
}

/**
 * Подстановка книги в текст дела: [Книга] (в любом регистре) → название книги города, из которого выходит сторона;
 * если стороны из города нет — «на выбор» («проповедь по книге на выбор»).
 */
export function withDeedBook<T extends { title: string; description: string }>(deed: T, bookCode: string | null): T {
  const name = bookCode ? bookName(bookCode, "ru") : "на выбор";
  const sub = (text: string) => text.replace(/\[книга\]/gi, name);
  return { ...deed, title: sub(deed.title), description: sub(deed.description) };
}

/** Книга города по ключу узла (для подстановки [Книга] в текст дела). */
export async function bookOfNodeKey(gameId: string, key: string): Promise<string | null> {
  const n = await prisma.mapNode.findUnique({ where: { gameId_key: { gameId, key } }, select: { bookCode: true } });
  return n?.bookCode ?? null;
}

/** Создаёт недостающие задачи на рёбрах фронтира. Идемпотентно. */
export async function ensureFrontier(gameId: string, teamId: string): Promise<void> {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  if (!team.startNodeKey) return;
  const revealedCount = await prisma.teamNodeState.count({ where: { teamId } });
  if (revealedCount === 0) await prisma.teamNodeState.create({ data: { teamId, nodeKey: team.startNodeKey } });

  const revealed = new Set((await prisma.teamNodeState.findMany({ where: { teamId }, select: { nodeKey: true } })).map((n) => n.nodeKey));
  const edges = await prisma.mapEdge.findMany({ where: { gameId }, select: { aKey: true, bKey: true } });
  const existingTasks = await prisma.teamEdgeTask.findMany({ where: { teamId }, select: { fromKey: true, toKey: true, sea: true, createdAt: true } });
  const existing = new Set(existingTasks.map((t) => `${t.fromKey}>${t.toKey}`));
  const blocked = await blockedCities(gameId, teamId);
  const owned = await ownedCities(gameId, teamId);
  const ownedBooks = new Map([...owned].map(([k, v]) => [k, v.bookCode]));
  // Из одного порта — один рейс за взятие: после высадки toKey становится узлом высадки, но дело остаётся.
  // Рейс, начатый до нынешнего взятия порта (порт теряли и вернули), не мешает новому (решение владельца 18.09).
  const sailed = new Set(existingTasks.filter((t) => t.sea && (owned.get(t.fromKey)?.capturedAt.getTime() ?? 0) - 5_000 <= t.createdAt.getTime()).map((t) => t.fromKey));

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
  // Морская сторона: из каждого взятого командой порта (береговой город) — одно дело; после его одобрения
  // капитан выбирает пустой береговой узел другого острова и высаживается там (2.3a).
  const ports = await prisma.mapNode.findMany({ where: { gameId, kind: "CITY", coastal: true, key: { in: [...ownedBooks.keys()] } }, select: { key: true, island: true, bookCode: true } });
  for (const port of ports) {
    if (sailed.has(port.key)) continue;
    // Плыть есть куда, только если на другом острове ещё остались свободные береговые развилки.
    const free = await prisma.mapNode.count({ where: { gameId, kind: "EMPTY", coastal: true, island: { not: port.island } } });
    if (free === 0) continue;
    const deedId = await pickDeed(gameId, teamId, port.bookCode);
    if (!deedId) return;
    await prisma.teamEdgeTask.create({ data: { teamId, gameId, fromKey: port.key, toKey: seaKey(port.key), deedId, sea: true } });
  }
}

/** Заглушка toKey морского дела до высадки. */
export const seaKey = (portKey: string) => `sea:${portKey}`;
export const isSeaKey = (key: string) => key.startsWith("sea:");

/** Куда команда может высадиться с этого порта: пустые береговые узлы другого острова, ещё не открытые ей. */
export async function landingCandidates(gameId: string, teamId: string, portKey: string): Promise<string[]> {
  const port = await prisma.mapNode.findUnique({ where: { gameId_key: { gameId, key: portKey } }, select: { island: true } });
  if (!port) return [];
  const [nodes, revealed] = await Promise.all([
    prisma.mapNode.findMany({ where: { gameId, kind: "EMPTY", coastal: true, island: { not: port.island } }, select: { key: true } }),
    prisma.teamNodeState.findMany({ where: { teamId }, select: { nodeKey: true } }),
  ]);
  const seen = new Set(revealed.map((r) => r.nodeKey));
  return nodes.map((n) => n.key).filter((k) => !seen.has(k));
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

/** Города, взятые командой: книга и момент нынешнего взятия (для тематических дел на выходе и морских рейсов). */
async function ownedCities(gameId: string, teamId: string): Promise<Map<string, { bookCode: string; capturedAt: Date }>> {
  const rows = await prisma.teamCityState.findMany({ where: { teamId, capturedAt: { not: null } }, select: { nodeKey: true, capturedAt: true } });
  if (rows.length === 0) return new Map();
  const nodes = await prisma.mapNode.findMany({ where: { gameId, key: { in: rows.map((r) => r.nodeKey) } }, select: { key: true, bookCode: true } });
  const at = new Map(rows.map((r) => [r.nodeKey, r.capturedAt!]));
  return new Map(nodes.filter((n) => n.bookCode).map((n) => [n.key, { bookCode: n.bookCode!, capturedAt: at.get(n.key)! }]));
}

/**
 * Город получил владельца: другим командам без разрешения дальше через него не пройти — их свободные дела из города
 * убираются; свободные стороны владельца из этого города получают дела по книге города (2.7; решение владельца 18.09).
 */
export async function onCityOwned(gameId: string, nodeKey: string, ownerTeamId: string): Promise<void> {
  const grants = await prisma.passageRequest.findMany({ where: { gameId, nodeKey, status: "APPROVED" }, select: { requesterId: true } });
  await prisma.teamEdgeTask.deleteMany({ where: { gameId, fromKey: nodeKey, status: "OPEN", NOT: { teamId: { in: [ownerTeamId, ...grants.map((g) => g.requesterId)] } } } });
  const book = await bookOfNodeKey(gameId, nodeKey);
  if (!book) return;
  const open = await prisma.teamEdgeTask.findMany({ where: { teamId: ownerTeamId, fromKey: nodeKey, status: "OPEN" }, select: { id: true, deedId: true } });
  for (const t of open) {
    const deedId = await pickDeed(gameId, ownerTeamId, book, t.deedId);
    if (deedId && deedId !== t.deedId) await prisma.teamEdgeTask.update({ where: { id: t.id }, data: { deedId } });
  }
  if (open.length) publish(gameId, { type: "tasks", teamId: ownerTeamId });
}

/** Взятое и не сданное за N дней дело возвращается в общий список само (решение владельца 18.09). */
export async function returnStaleTasks(gameId: string, rules: Rules, now = new Date()): Promise<void> {
  const stale = await prisma.teamEdgeTask.findMany({ where: { gameId, status: "TAKEN", takenAt: { lt: new Date(now.getTime() - days(rules.deedReturnDays)) } }, include: { deed: { select: { title: true } } } });
  for (const t of stale) {
    await prisma.teamEdgeTask.update({ where: { id: t.id }, data: { status: "OPEN", takenById: null, takenAt: null } });
    publish(gameId, { type: "tasks", teamId: t.teamId });
    if (t.takenById) notifyUser(gameId, t.takenById, "дело вернулось в список", "Дело «{deed}» не было сдано за {days} дней и снова свободно для всей команды.", { deed: t.deed.title, days: rules.deedReturnDays });
  }
}

/**
 * Штраф администратора (телефон на собрании; решение владельца 18.09): аннулируется случайный концевой участок пути —
 * пройденная сторона, за которой у команды нет других пройденных сторон; города команды и старт не трогаются.
 * Перекрёсток за стороной снова закрыт, дело на стороне нужно сделать заново.
 */
export async function penalizeTeam(gameId: string, teamId: string, byId: string): Promise<{ fromKey: string; toKey: string } | null> {
  const [approved, owned, team] = await Promise.all([
    prisma.teamEdgeTask.findMany({ where: { teamId, status: "APPROVED", sea: false }, select: { id: true, fromKey: true, toKey: true } }),
    prisma.teamCityState.findMany({ where: { teamId, capturedAt: { not: null } }, select: { nodeKey: true } }),
    prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { startNodeKey: true } }),
  ]);
  const ownedKeys = new Set(owned.map((o) => o.nodeKey));
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const t of approved) { outgoing.set(t.fromKey, (outgoing.get(t.fromKey) ?? 0) + 1); incoming.set(t.toKey, (incoming.get(t.toKey) ?? 0) + 1); }
  // Конец пути: за перекрёстком ничего не пройдено, он открыт только этой стороной, это не город команды и не старт.
  const ends = approved.filter((t) => !outgoing.has(t.toKey) && (incoming.get(t.toKey) ?? 0) === 1 && !ownedKeys.has(t.toKey) && t.toKey !== team.startNodeKey);
  if (ends.length === 0) return null;
  const pick = ends[Math.floor(Math.random() * ends.length)]!;
  await prisma.$transaction([
    prisma.teamEdgeTask.deleteMany({ where: { teamId, fromKey: pick.toKey } }),
    prisma.teamEdgeTask.deleteMany({ where: { teamId, toKey: pick.toKey, NOT: { id: pick.id } } }),
    prisma.teamNodeState.deleteMany({ where: { teamId, nodeKey: pick.toKey } }),
    prisma.teamPeek.deleteMany({ where: { teamId, nodeKey: pick.toKey } }),
    prisma.teamEdgeTask.update({ where: { id: pick.id }, data: { status: "OPEN", takenById: null, takenAt: null, links: [], note: "", submittedAt: null, decidedAt: null, decidedById: null, adminComment: "Сторона аннулирована штрафом администратора" } }),
    prisma.teamPenalty.create({ data: { gameId, teamId, fromKey: pick.fromKey, toKey: pick.toKey, byId } }),
  ]);
  await ensureFrontier(gameId, teamId);
  publish(gameId, { type: "map", teamId });
  publish(gameId, { type: "tasks", teamId });
  notifyTeam(gameId, teamId, "штраф: участок пути аннулирован", (locale) => msg(locale, "Администратор назначил команде штраф: одна пройденная сторона на конце пути аннулирована, перекрёсток за ней снова закрыт. Дело на этой стороне нужно сделать заново."));
  return { fromKey: pick.fromKey, toKey: pick.toKey };
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
  const [revealedRows, rawTasks, hexes, nodes, edges] = await Promise.all([
    prisma.teamNodeState.findMany({ where: { teamId }, select: { nodeKey: true, revealedAt: true } }),
    prisma.teamEdgeTask.findMany({
      where: { teamId },
      include: { deed: { select: { id: true, title: true, description: true, direction: true, proofType: true, difficulty: true, secret: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mapHex.findMany({ where: { gameId }, select: { q: true, r: true, terrain: true, rotation: true, island: true } }),
    prisma.mapNode.findMany({ where: { gameId }, select: { key: true, corner: true, q: true, r: true, kind: true, bookCode: true, cityType: true, teamIndex: true, ruined: true, island: true, coastal: true } }),
    prisma.mapEdge.findMany({ where: { gameId }, select: { aKey: true, bKey: true } }),
  ]);
  // Чужие проходы там, где у команды открыт туман: пройденные другими командами стороны, касающиеся открытых
  // перекрёстков (решение владельца 18.09: команда должна понимать, где противник).
  const foreignRows = await prisma.teamEdgeTask.findMany({ where: { gameId, status: "APPROVED", sea: false, NOT: { teamId } }, select: { fromKey: true, toKey: true, team: { select: { index: true, color: true } } } });
  // В тексте дела [Книга] — книга города, из которого выходит сторона (или «на выбор», если это не город).
  const bookOfNode = new Map(nodes.filter((n) => n.bookCode).map((n) => [n.key, n.bookCode!]));
  const tasks = rawTasks.map((t) => ({ ...t, deed: withDeedBook(t.deed, bookOfNode.get(t.fromKey) ?? null) }));
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
  // Взятое или сданное дело остаётся видимым, даже если перекрёсток за ним уже открыт с другой стороны
  // (решение владельца 18.09: дело делают, оно засчитывается); свободное к открытому перекрёстку не показывается.
  const visibleTasks = tasks.filter((t) => t.status !== "OPEN" || !revealed.has(t.toKey));
  const foreign = foreignRows.filter((f) => revealed.has(f.fromKey) || revealed.has(f.toKey)).map((f) => ({ aKey: f.fromKey, bKey: f.toKey, teamIndex: f.team.index, color: f.team.color }));
  const withLanding = await Promise.all(visibleTasks.map(async (t) => {
    if (!t.sea) return t;
    const landing = t.status === "APPROVED" && isSeaKey(t.toKey);
    return { ...t, landing, candidates: landing ? await landingCandidates(gameId, teamId, t.fromKey) : undefined };
  }));
  return {
    // Остров известен и у гексов в тумане: по нему подписываются острова.
    hexes: hexes.map((h) => (lit(h) ? { ...h, lit: true } : { q: h.q, r: h.r, island: h.island, lit: false })),
    revealed: nodes.filter((n) => revealed.has(n.key)).map(({ ruined: _r, ...n }) => n),
    // Рёбра, касающиеся открытых узлов: пройденные и фронтир (в туман).
    edges: edges.filter((e) => revealed.has(e.aKey) || revealed.has(e.bKey)),
    tasks: withLanding,
    cities,
    peeked,
    foreign,
  };
}
