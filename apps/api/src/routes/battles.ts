import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { requireAdmin, requireMember } from "./teamMap.js";
import { formatRange, loadBook, parseRef, refToIndex, verseText, type BibleBook } from "../services/bible.js";
import { notifyAdmins, notifyTeam } from "../services/notify.js";
import { coverage, maybeRepel, maybeStartDefense, minBidFor, overlaps, recomputeAttackDone, recomputeDefenseDone, resolveWon, startAttack, sweep, warOptions, type BattleWithEntries } from "../services/battles.js";

const declareBody = z.object({ bid: z.number().int().min(1).max(100000) });
const entryBody = z.object({
  from: z.string().trim().min(3).max(12),
  to: z.string().trim().min(3).max(12),
  links: z.array(z.string().trim().url().max(500)).min(1).max(20),
  note: z.string().trim().max(500).default(""),
});
const decideBody = z.object({ approve: z.boolean(), comment: z.string().trim().max(1000).default("") });

const teamSelect = { select: { id: true, index: true, name: true, color: true } } as const;
const include = { entries: { orderBy: { createdAt: "asc" as const } }, attacker: teamSelect, defender: teamSelect } as const;

/** Битва в ответе: индексы стихов переведены в ссылки книги, текст отрывка — если книга загружена с текстом. */
async function view(b: BattleWithEntries & { attacker: { id: string; name: string; color: string; index: number }; defender: { id: string; name: string; color: string; index: number } }, users: Map<string, string>, forTeamId: string | null) {
  const book = await loadBook(b.bookCode);
  const range = (s: number, e: number) => (book ? formatRange(book, s, e) : `${s}–${e}`);
  const passage = b.passageStart != null && b.passageEnd != null && book
    ? { ref: range(b.passageStart, b.passageEnd), start: b.passageStart, end: b.passageEnd, text: book.chapters ? Array.from({ length: b.passageEnd - b.passageStart + 1 }, (_, i) => `${formatRange(book, b.passageStart! + i, b.passageStart! + i)} ${verseText(book, b.passageStart! + i) ?? ""}`) : null }
    : null;
  // Записи чужой стороны команда не видит (только их число), админ видит всё.
  const entries = b.entries
    .filter((e) => forTeamId === null || e.teamId === forTeamId)
    .map((e) => ({ id: e.id, side: e.side, userId: e.userId, nickname: users.get(e.userId) ?? "?", ref: range(e.startIdx, e.endIdx), verses: e.endIdx - e.startIdx + 1, links: e.links, note: e.note, status: e.status, adminComment: e.adminComment, createdAt: e.createdAt }));
  return {
    id: b.id, nodeKey: b.nodeKey, bookCode: b.bookCode, status: b.status, sumMode: b.sumMode, bid: b.bid, defenseBid: b.defenseBid,
    attacker: b.attacker, defender: b.defender, passage,
    declaredAt: b.declaredAt, startedAt: b.startedAt, attackDeadline: b.attackDeadline, attackDoneAt: b.attackDoneAt, attackApprovedAt: b.attackApprovedAt,
    defenseDeadline: b.defenseDeadline, defenseDoneAt: b.defenseDoneAt, resolvedAt: b.resolvedAt,
    attackCovered: coverage(b.entries.filter((e) => e.side === "ATTACK"), b.sumMode, false),
    attackApproved: coverage(b.entries.filter((e) => e.side === "ATTACK"), b.sumMode, true),
    defenseCovered: coverage(b.entries.filter((e) => e.side === "DEFENSE"), b.sumMode, false),
    defenseApproved: coverage(b.entries.filter((e) => e.side === "DEFENSE"), b.sumMode, true),
    entries,
    bookTotal: book?.total ?? null,
  };
}

async function nicknames(ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, nickname: true, displayName: true } });
  return new Map(rows.map((u) => [u.id, u.displayName || u.nickname]));
}

function parseRange(book: BibleBook, from: string, to: string): { start: number; end: number } | null {
  const a = parseRef(from), b = parseRef(to);
  if (!a || !b) return null;
  const s = refToIndex(book, a), e = refToIndex(book, b);
  if (s === null || e === null || e < s) return null;
  return { start: s, end: e };
}

export async function battleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  /** Сводка по войне за город для команды: уровень защиты, минимальная ставка, можно ли объявить, битвы с участием команды. */
  app.get("/api/games/:id/my-city/:nodeKey/war", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    await sweep(id);
    const node = await prisma.mapNode.findUnique({ where: { gameId_key: { gameId: id, key: nodeKey } } });
    if (!node || node.kind !== "CITY") return reply.code(404).send({ error: "not_found", message: "Город не найден" });
    const reached = await prisma.teamNodeState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } });
    if (!reached) return reply.code(403).send({ error: "forbidden", message: "Ваша команда ещё не дошла до этого города" });
    const options = await warOptions(id, m.team.id, nodeKey);
    const battles = await prisma.battle.findMany({ where: { gameId: id, nodeKey, OR: [{ attackerId: m.team.id }, { defenderId: m.team.id }] }, orderBy: { declaredAt: "desc" }, include, take: 10 });
    const users = await nicknames([...new Set(battles.flatMap((b) => b.entries.map((e) => e.userId)))]);
    const queue = await prisma.battle.count({ where: { gameId: id, nodeKey, status: "QUEUED" } });
    return { ...options, queue, battles: await Promise.all(battles.map((b) => view(b, users, m.team.id))) };
  });

  /** Все битвы команды (для бокового меню): активные и последние завершённые. */
  app.get("/api/games/:id/my-battles", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    await sweep(id);
    const battles = await prisma.battle.findMany({ where: { gameId: id, OR: [{ attackerId: m.team.id }, { defenderId: m.team.id }] }, orderBy: { declaredAt: "desc" }, include, take: 30 });
    const users = await nicknames([...new Set(battles.flatMap((b) => b.entries.map((e) => e.userId)))]);
    return { battles: await Promise.all(battles.map((b) => view(b, users, m.team.id))) };
  });

  /** Объявить войну: только количество стихов. Если битва за город уже идёт — очередь. */
  app.post("/api/games/:id/my-city/:nodeKey/war", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const game = await prisma.game.findUnique({ where: { id }, select: { status: true } });
    if (game?.status !== "ACTIVE") return reply.code(409).send({ error: "conflict", message: "Игра не идёт" });
    const reached = await prisma.teamNodeState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } });
    if (!reached) return reply.code(403).send({ error: "forbidden", message: "Ваша команда ещё не дошла до этого города" });
    await sweep(id);
    const o = await warOptions(id, m.team.id, nodeKey);
    if (!o.canDeclare || !o.owner) return reply.code(409).send({ error: "conflict", message: o.reason ?? "Нельзя объявить войну" });
    const body = declareBody.parse(request.body);
    if (body.bid < o.minBid) return reply.code(400).send({ error: "validation", message: `Минимальная ставка для вашей команды на этот город — ${o.minBid} стихов` });
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId: id, key: nodeKey } } });
    // Книга исчерпана: ставка ≥ числа стихов — суммарный режим (сумма стихов по участникам).
    const sumMode = node.sumMode || body.bid >= (o.bookVerses ?? Infinity);
    if (sumMode && !node.sumMode) await prisma.mapNode.update({ where: { id: node.id }, data: { sumMode: true } });
    const active = await prisma.battle.count({ where: { gameId: id, nodeKey, status: { in: ["ATTACK", "DEFENSE"] } } });
    const created = await prisma.battle.create({ data: { gameId: id, nodeKey, bookCode: node.bookCode!, attackerId: m.team.id, defenderId: o.owner.id, bid: body.bid, sumMode, status: "QUEUED" } });
    if (active === 0) await startAttack(created.id);
    publish(id, { type: "battles", teamId: m.team.id });
    publish(id, { type: "battles", teamId: o.owner.id });
    if (active === 0) notifyTeam(id, o.owner.id, "на ваш город объявлена атака", `Команда «${m.team.name}» объявила войну вашему городу (ставка ${body.bid} стихов). Когда администратор одобрит их записи, у вас будет ровно столько же времени, сколько ушло у них.`);
    return reply.code(201).send({ id: created.id, status: active === 0 ? "ATTACK" : "QUEUED", sumMode });
  });

  /** Поднять ставку, пока атака в очереди. */
  app.post("/api/games/:id/battles/:battleId/bid", async (request, reply) => {
    const { id, battleId } = request.params as { id: string; battleId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const b = await prisma.battle.findFirst({ where: { id: battleId, gameId: id, attackerId: m.team.id } });
    if (!b) return reply.code(404).send({ error: "not_found", message: "Битва не найдена" });
    if (b.status !== "QUEUED") return reply.code(409).send({ error: "conflict", message: "Ставку можно менять только в очереди" });
    const body = declareBody.parse(request.body);
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId: id, key: b.nodeKey } } });
    const st = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey: b.nodeKey } } });
    const min = minBidFor(node.defenseLevel, st?.attackPenalty ?? 0);
    if (body.bid < min) return reply.code(400).send({ error: "validation", message: `Минимальная ставка — ${min}` });
    await prisma.battle.update({ where: { id: b.id }, data: { bid: body.bid, sumMode: node.sumMode || body.bid >= ((await loadBook(b.bookCode))?.total ?? Infinity) } });
    publish(id, { type: "battles", teamId: m.team.id });
    return { ok: true };
  });

  /** Прикрепить запись: отрывок (от–до) и ссылки на видео. Атакующие — внутри выданного отрывка; защитники — любой отрывок книги. */
  app.post("/api/games/:id/battles/:battleId/entries", async (request, reply) => {
    const { id, battleId } = request.params as { id: string; battleId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    await sweep(id);
    const b = await prisma.battle.findFirst({ where: { id: battleId, gameId: id }, include: { entries: true } });
    if (!b) return reply.code(404).send({ error: "not_found", message: "Битва не найдена" });
    const side = b.attackerId === m.team.id ? "ATTACK" : b.defenderId === m.team.id ? "DEFENSE" : null;
    if (!side) return reply.code(403).send({ error: "forbidden", message: "Ваша команда не участвует в этой битве" });
    if (side === "ATTACK" && b.status !== "ATTACK") return reply.code(409).send({ error: "conflict", message: b.status === "QUEUED" ? "Атака ещё в очереди" : "Атака уже завершена" });
    if (side === "DEFENSE" && b.status !== "DEFENSE") return reply.code(409).send({ error: "conflict", message: b.status === "ATTACK" ? "Оборона начнётся после одобрения атаки" : "Оборона уже завершена" });
    if (side === "DEFENSE" && b.defenseDeadline && b.defenseDeadline.getTime() < Date.now()) return reply.code(409).send({ error: "conflict", message: "Время обороны вышло" });
    const body = entryBody.parse(request.body);
    const book = await loadBook(b.bookCode);
    if (!book) return reply.code(409).send({ error: "conflict", message: "Текст книги не загружен" });
    const r = parseRange(book, body.from, body.to);
    if (!r) return reply.code(400).send({ error: "validation", message: "Укажите отрывок как «глава:стих» — «глава:стих» в пределах книги" });
    if (side === "ATTACK" && !b.sumMode && (r.start < b.passageStart! || r.end > b.passageEnd!)) return reply.code(400).send({ error: "validation", message: `Атакующие рассказывают только выданный отрывок ${formatRange(book, b.passageStart!, b.passageEnd!)}` });
    if (overlaps(b.entries, side, request.user!.id, r.start, r.end, b.sumMode)) return reply.code(409).send({ error: "conflict", message: "Эти стихи уже записаны: внутри команды стихи в одной битве не повторяются" });
    await prisma.battleEntry.create({ data: { battleId: b.id, side, teamId: m.team.id, userId: request.user!.id, startIdx: r.start, endIdx: r.end, links: body.links, note: body.note } });
    let full = (await prisma.battle.findUniqueOrThrow({ where: { id: b.id }, include: { entries: true } })) as BattleWithEntries;
    full = side === "ATTACK" ? await recomputeAttackDone(full) : await recomputeDefenseDone(full);
    publish(id, { type: "battles", teamId: m.team.id });
    publish(id, { type: "submissions" });
    notifyAdmins(id, "новая запись в битве", `Команда «${m.team.name}» прикрепила запись (${side === "ATTACK" ? "атака" : "оборона"}, ${formatRange(book, r.start, r.end)}). Нужно проверить.`);
    return reply.code(201).send({ ok: true, covered: coverage(full.entries.filter((e) => e.side === side), full.sumMode, false), bid: full.bid });
  });

  /** Убрать свою запись, пока она не проверена. */
  app.delete("/api/games/:id/battles/:battleId/entries/:entryId", async (request, reply) => {
    const { id, battleId, entryId } = request.params as { id: string; battleId: string; entryId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const e = await prisma.battleEntry.findFirst({ where: { id: entryId, battleId, teamId: m.team.id }, include: { battle: true } });
    if (!e || e.battle.gameId !== id) return reply.code(404).send({ error: "not_found", message: "Запись не найдена" });
    if (e.status === "APPROVED") return reply.code(409).send({ error: "conflict", message: "Одобренную запись убрать нельзя" });
    if (e.userId !== request.user!.id && m.role !== "CAPTAIN") return reply.code(403).send({ error: "forbidden", message: "Чужую запись может убрать только капитан" });
    await prisma.battleEntry.delete({ where: { id: e.id } });
    const full = (await prisma.battle.findUniqueOrThrow({ where: { id: battleId }, include: { entries: true } })) as BattleWithEntries;
    if (e.side === "ATTACK") await recomputeAttackDone(full); else await recomputeDefenseDone(full);
    publish(id, { type: "battles", teamId: m.team.id });
    return { ok: true };
  });

  /** Капитан защитников сдаёт город. */
  app.post("/api/games/:id/battles/:battleId/surrender", async (request, reply) => {
    const { id, battleId } = request.params as { id: string; battleId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    if (m.role !== "CAPTAIN") return reply.code(403).send({ error: "forbidden", message: "Сдать город может только капитан" });
    const b = await prisma.battle.findFirst({ where: { id: battleId, gameId: id, defenderId: m.team.id, status: { in: ["ATTACK", "DEFENSE"] } } });
    if (!b) return reply.code(404).send({ error: "not_found", message: "Активная битва не найдена" });
    await resolveWon(b);
    return { ok: true };
  });

  /** Админ: все битвы игры с записями обеих сторон. */
  app.get("/api/games/:id/battles", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    await sweep(id);
    const battles = await prisma.battle.findMany({ where: { gameId: id }, orderBy: { declaredAt: "desc" }, include, take: 100 });
    const users = await nicknames([...new Set(battles.flatMap((b) => b.entries.map((e) => e.userId)))]);
    return { battles: await Promise.all(battles.map((b) => view(b, users, null))) };
  });

  /** Админ: одобрить или вернуть запись. Одобрение всей атаки запускает таймер обороны; всей обороны в срок — отражает атаку. */
  app.post("/api/games/:id/battles/:battleId/entries/:entryId/decide", async (request, reply) => {
    const { id, battleId, entryId } = request.params as { id: string; battleId: string; entryId: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const e = await prisma.battleEntry.findFirst({ where: { id: entryId, battleId }, include: { battle: true } });
    if (!e || e.battle.gameId !== id) return reply.code(404).send({ error: "not_found", message: "Запись не найдена" });
    const body = decideBody.parse(request.body);
    await prisma.battleEntry.update({ where: { id: e.id }, data: { status: body.approve ? "APPROVED" : "REJECTED", adminComment: body.comment, decidedAt: new Date() } });
    let full = (await prisma.battle.findUniqueOrThrow({ where: { id: battleId }, include: { entries: true } })) as BattleWithEntries;
    if (e.side === "ATTACK") { full = await recomputeAttackDone(full); full = await maybeStartDefense(full); }
    else {
      full = await recomputeDefenseDone(full);
      if (!body.approve && full.status === "DEFENSE" && full.defenseDeadline && full.defenseDeadline.getTime() < Date.now() && !full.defenseDoneAt) await resolveWon(full);
      else full = await maybeRepel(full);
    }
    publish(id, { type: "battles", teamId: e.teamId });
    publish(id, { type: "submissions" });
    return { ok: true, status: full.status };
  });
}
