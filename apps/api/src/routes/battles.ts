import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { err } from "../services/i18n.js";
import { requireAdmin, requireMember } from "./teamMap.js";
import { formatRange, loadBook, refToIndex, parseRef, verseText, type BibleBook } from "../services/bible.js";
import { afterReject, maybeRepel, maybeStartDefense, minBidFor, resolveWon, startAttack, submitAttack, submitDefense, sumVerses, sweep, toRanges, userVerses, warOptions, type BattleWithEntries } from "../services/battles.js";
import { notifyAdmins, notifyTeam } from "../services/notify.js";
import { BOOKS } from "@lotw/domain";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
const declareBody = z.object({ bid: z.number().int().min(1).max(100000) });
const entryBody = z.object({
  verses: z.array(z.number().int().min(0)).min(1).max(3000),
  links: z.array(z.string().trim().url().max(500)).min(1).max(20),
  note: z.string().trim().max(500).default(""),
});
const passageBody = z.object({ from: z.string().trim().min(3).max(12), to: z.string().trim().min(3).max(12) });
const decideBody = z.object({ approve: z.boolean(), comment: z.string().trim().max(1000).default("") });

const teamSelect = { select: { id: true, index: true, name: true, color: true } } as const;
const include = { entries: { orderBy: { createdAt: "asc" as const } }, attacker: teamSelect, defender: teamSelect } as const;
type Full = BattleWithEntries & { attacker: { id: string; name: string; color: string; index: number }; defender: { id: string; name: string; color: string; index: number } };

function versesOf(book: BibleBook, start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, i) => ({ idx: start + i, ref: formatRange(book, start + i, start + i), text: verseText(book, start + i) }));
}

/** Битва в ответе: отрывки с текстом, суммы, записи своей стороны, мои отмеченные стихи. Админ видит всё. */
async function view(b: Full, users: Map<string, string>, forTeamId: string | null, userId: string | null) {
  const book = await loadBook(b.bookCode);
  const range = (s: number, e: number) => (book ? formatRange(book, s, e) : `${s}–${e}`);
  const mySide = forTeamId === null ? null : b.attackerId === forTeamId ? "ATTACK" : b.defenderId === forTeamId ? "DEFENSE" : null;
  const showAttackText = forTeamId === null || mySide === "ATTACK";
  const showDefenseText = forTeamId === null || mySide === "DEFENSE";
  const passage = b.passageStart != null && b.passageEnd != null && book ? { ref: range(b.passageStart, b.passageEnd), start: b.passageStart, end: b.passageEnd, verses: showAttackText ? versesOf(book, b.passageStart, b.passageEnd) : null } : null;
  const defensePassage = b.defenseStart != null && b.defenseEnd != null && book ? { ref: range(b.defenseStart, b.defenseEnd), start: b.defenseStart, end: b.defenseEnd, verses: showDefenseText ? versesOf(book, b.defenseStart, b.defenseEnd) : null } : null;
  const entries = b.entries
    .filter((e) => forTeamId === null || e.teamId === forTeamId)
    .map((e) => ({ id: e.id, side: e.side, userId: e.userId, nickname: users.get(e.userId) ?? "?", ref: range(e.startIdx, e.endIdx), start: e.startIdx, end: e.endIdx, verses: e.endIdx - e.startIdx + 1, links: e.links, note: e.note, status: e.status, adminComment: e.adminComment, createdAt: e.createdAt }));
  const my = mySide && userId ? [...userVerses(b.entries, mySide, userId)] : [];
  return {
    id: b.id, nodeKey: b.nodeKey, bookCode: b.bookCode, bookName: BOOK_BY_CODE.get(b.bookCode)?.nameRu ?? b.bookCode, status: b.status, sumMode: b.sumMode, bid: b.bid, defenseBid: b.defenseBid,
    attacker: b.attacker, defender: b.defender, mySide, passage, defensePassage,
    declaredAt: b.declaredAt, startedAt: b.startedAt, attackDeadline: b.attackDeadline, attackDoneAt: b.attackDoneAt, attackApprovedAt: b.attackApprovedAt,
    defenseDeadline: b.defenseDeadline, defenseDoneAt: b.defenseDoneAt, resolvedAt: b.resolvedAt,
    attackSum: sumVerses(b.entries, "ATTACK", false), attackApproved: sumVerses(b.entries, "ATTACK", true),
    defenseSum: sumVerses(b.entries, "DEFENSE", false), defenseApproved: sumVerses(b.entries, "DEFENSE", true),
    entries, myVerses: my, bookTotal: book?.total ?? null,
  };
}

async function nicknames(ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, nickname: true, displayName: true } });
  return new Map(rows.map((u) => [u.id, u.displayName || u.nickname]));
}
const usersOf = (battles: Full[]) => nicknames([...new Set(battles.flatMap((b) => b.entries.map((e) => e.userId)))]);

export async function battleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  /** Сводка по войне за город для команды. */
  app.get("/api/games/:id/my-city/:nodeKey/war", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    await sweep(id);
    const node = await prisma.mapNode.findUnique({ where: { gameId_key: { gameId: id, key: nodeKey } } });
    if (!node || node.kind !== "CITY") return reply.code(404).send({ error: "not_found", message: err(request, "Город не найден") });
    const reached = await prisma.teamNodeState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } });
    if (!reached) return reply.code(403).send({ error: "forbidden", message: err(request, "Ваша команда ещё не дошла до этого города") });
    const options = await warOptions(id, m.team.id, nodeKey);
    const battles = await prisma.battle.findMany({ where: { gameId: id, nodeKey, OR: [{ attackerId: m.team.id }, { defenderId: m.team.id }] }, orderBy: { declaredAt: "desc" }, include, take: 10 });
    const users = await usersOf(battles);
    const queue = await prisma.battle.count({ where: { gameId: id, nodeKey, status: "QUEUED" } });
    return { ...options, reason: options.reason ? err(request, options.reason) : null, queue, battles: await Promise.all(battles.map((b) => view(b, users, m.team.id, request.user!.id))) };
  });

  /** Все битвы команды: активные и последние завершённые. */
  app.get("/api/games/:id/my-battles", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    await sweep(id);
    const battles = await prisma.battle.findMany({ where: { gameId: id, OR: [{ attackerId: m.team.id }, { defenderId: m.team.id }] }, orderBy: { declaredAt: "desc" }, include, take: 30 });
    const users = await usersOf(battles);
    return { battles: await Promise.all(battles.map((b) => view(b, users, m.team.id, request.user!.id))) };
  });

  /** Текст всей книги (для выбора отрывка обороны капитаном). */
  app.get("/api/games/:id/battles/:battleId/book", async (request, reply) => {
    const { id, battleId } = request.params as { id: string; battleId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const b = await prisma.battle.findFirst({ where: { id: battleId, gameId: id, OR: [{ attackerId: m.team.id }, { defenderId: m.team.id }] } });
    if (!b) return reply.code(404).send({ error: "not_found", message: err(request, "Испытание не найдено") });
    const book = await loadBook(b.bookCode);
    if (!book) return reply.code(409).send({ error: "conflict", message: err(request, "Текст этой книги ещё не загружен") });
    return { code: book.code, name: BOOK_BY_CODE.get(book.code)?.nameRu ?? book.code, verseCounts: book.verseCounts, chapters: book.chapters ?? null, total: book.total };
  });

  /** Бросить вызов: только количество стихов (сумма по участникам). Если битва уже идёт — очередь. */
  app.post("/api/games/:id/my-city/:nodeKey/war", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const game = await prisma.game.findUnique({ where: { id }, select: { status: true, name: true } });
    if (game?.status !== "ACTIVE") return reply.code(409).send({ error: "conflict", message: err(request, "Игра не идёт") });
    const reached = await prisma.teamNodeState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } });
    if (!reached) return reply.code(403).send({ error: "forbidden", message: err(request, "Ваша команда ещё не дошла до этого города") });
    await sweep(id);
    const o = await warOptions(id, m.team.id, nodeKey);
    if (!o.canDeclare || !o.owner) return reply.code(409).send({ error: "conflict", message: err(request, o.reason ?? "Нельзя бросить вызов") });
    const body = declareBody.parse(request.body);
    if (body.bid < o.minBid) return reply.code(400).send({ error: "validation", message: err(request, "Минимальная ставка на этот город для вашей команды — {min} стихов", { min: o.minBid }) });
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId: id, key: nodeKey } } });
    const sumMode = node.sumMode || body.bid >= (o.bookVerses ?? Infinity);
    if (sumMode && !node.sumMode) await prisma.mapNode.update({ where: { id: node.id }, data: { sumMode: true } });
    const active = await prisma.battle.count({ where: { gameId: id, nodeKey, status: { in: ["ATTACK", "DEFENSE"] } } });
    const created = await prisma.battle.create({ data: { gameId: id, nodeKey, bookCode: node.bookCode!, attackerId: m.team.id, defenderId: o.owner.id, bid: body.bid, sumMode, status: "QUEUED" } });
    if (active === 0) await startAttack(created.id);
    publish(id, { type: "battles", teamId: m.team.id });
    publish(id, { type: "battles", teamId: o.owner.id });
    if (active === 0) notifyTeam(id, o.owner.id, "вызов вашему городу {book}", "Команда «{team}» бросила вызов вашему городу {book} (игра «{game}»), ставка {bid} стихов. Когда админ одобрит их записи, у вас будет ровно столько же времени, сколько ушло у них.", { book: node.bookCode ?? "", team: m.team.name, game: game.name, bid: body.bid });
    return reply.code(201).send({ id: created.id, status: active === 0 ? "ATTACK" : "QUEUED", sumMode });
  });

  /** Поднять ставку, пока атака в очереди. */
  app.post("/api/games/:id/battles/:battleId/bid", async (request, reply) => {
    const { id, battleId } = request.params as { id: string; battleId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const b = await prisma.battle.findFirst({ where: { id: battleId, gameId: id, attackerId: m.team.id } });
    if (!b) return reply.code(404).send({ error: "not_found", message: err(request, "Испытание не найдено") });
    if (b.status !== "QUEUED") return reply.code(409).send({ error: "conflict", message: err(request, "Ставку можно менять, только пока вызов в очереди") });
    const body = declareBody.parse(request.body);
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId: id, key: b.nodeKey } } });
    const st = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey: b.nodeKey } } });
    const min = minBidFor(node.defenseLevel, st?.attackPenalty ?? 0);
    if (body.bid < min) return reply.code(400).send({ error: "validation", message: err(request, "Минимальная ставка — {min} стихов", { min }) });
    await prisma.battle.update({ where: { id: b.id }, data: { bid: body.bid, sumMode: node.sumMode || body.bid >= ((await loadBook(b.bookCode))?.total ?? Infinity) } });
    publish(id, { type: "battles", teamId: m.team.id });
    return { ok: true };
  });

  /** Капитан защитников выбирает последовательный отрывок обороны из всей книги (пока нет записей). */
  app.post("/api/games/:id/battles/:battleId/defense-passage", async (request, reply) => {
    const { id, battleId } = request.params as { id: string; battleId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    if (m.role !== "CAPTAIN") return reply.code(403).send({ error: "forbidden", message: err(request, "Отрывок ответа выбирает капитан") });
    const b = await prisma.battle.findFirst({ where: { id: battleId, gameId: id, defenderId: m.team.id }, include: { entries: true } });
    if (!b) return reply.code(404).send({ error: "not_found", message: err(request, "Испытание не найдено") });
    if (b.status !== "DEFENSE") return reply.code(409).send({ error: "conflict", message: err(request, "Ответ ещё не начался или уже завершён") });
    if (b.entries.some((e) => e.side === "DEFENSE")) return reply.code(409).send({ error: "conflict", message: err(request, "Отрывок нельзя менять: участники уже отметили стихи") });
    const body = passageBody.parse(request.body);
    const book = await loadBook(b.bookCode);
    if (!book) return reply.code(409).send({ error: "conflict", message: err(request, "Текст этой книги ещё не загружен") });
    const a = parseRef(body.from), z2 = parseRef(body.to);
    const s = a ? refToIndex(book, a) : null, e = z2 ? refToIndex(book, z2) : null;
    if (s === null || e === null || e < s) return reply.code(400).send({ error: "validation", message: err(request, "Укажите отрывок в пределах книги: от «глава:стих» до «глава:стих»") });
    await prisma.battle.update({ where: { id: b.id }, data: { defenseStart: s, defenseEnd: e } });
    publish(id, { type: "battles", teamId: m.team.id });
    return { ok: true, ref: formatRange(book, s, e), verses: e - s + 1 };
  });

  /** Участник отмечает выученные стихи (по индексам) и прикрепляет ссылку на видео. */
  app.post("/api/games/:id/battles/:battleId/entries", async (request, reply) => {
    const { id, battleId } = request.params as { id: string; battleId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    await sweep(id);
    const b = await prisma.battle.findFirst({ where: { id: battleId, gameId: id }, include: { entries: true } });
    if (!b) return reply.code(404).send({ error: "not_found", message: err(request, "Испытание не найдено") });
    const side = b.attackerId === m.team.id ? "ATTACK" : b.defenderId === m.team.id ? "DEFENSE" : null;
    if (!side) return reply.code(403).send({ error: "forbidden", message: err(request, "Ваша команда не участвует в этом испытании") });
    if (side === "ATTACK" && b.status !== "ATTACK") return reply.code(409).send({ error: "conflict", message: err(request, b.status === "QUEUED" ? "Вызов ещё в очереди" : "Вызов уже завершён") });
    if (side === "ATTACK" && b.attackDoneAt) return reply.code(409).send({ error: "conflict", message: err(request, "Вызов отправлен на проверку: добавлять стихи нельзя") });
    if (side === "DEFENSE" && b.status !== "DEFENSE") return reply.code(409).send({ error: "conflict", message: err(request, b.status === "ATTACK" ? "Ответ начнётся, когда вызов будет принят" : "Ответ уже завершён") });
    if (side === "DEFENSE" && b.defenseDoneAt) return reply.code(409).send({ error: "conflict", message: err(request, "Ответ отправлен на проверку: добавлять стихи нельзя") });
    if (side === "DEFENSE" && b.defenseDeadline && b.defenseDeadline.getTime() < Date.now()) return reply.code(409).send({ error: "conflict", message: err(request, "Время ответа вышло") });
    if (side === "DEFENSE" && (b.defenseStart == null || b.defenseEnd == null)) return reply.code(409).send({ error: "conflict", message: err(request, "Сначала капитан должен выбрать отрывок ответа") });
    const body = entryBody.parse(request.body);
    const book = await loadBook(b.bookCode);
    if (!book) return reply.code(409).send({ error: "conflict", message: err(request, "Текст этой книги ещё не загружен") });
    const lo = side === "ATTACK" ? b.passageStart! : b.defenseStart!, hi = side === "ATTACK" ? b.passageEnd! : b.defenseEnd!;
    if (body.verses.some((v) => v < lo || v > hi)) return reply.code(400).send({ error: "validation", message: err(request, "Отмечать можно только стихи из отрывка {range}", { range: formatRange(book, lo, hi) }) });
    const mine = userVerses(b.entries, side, request.user!.id);
    const fresh = body.verses.filter((v) => !mine.has(v));
    if (fresh.length === 0) return reply.code(409).send({ error: "conflict", message: err(request, "Эти стихи вы уже отметили") });
    const ranges = toRanges(fresh);
    await prisma.battleEntry.createMany({ data: ranges.map((r) => ({ battleId: b.id, side, teamId: m.team.id, userId: request.user!.id, startIdx: r.start, endIdx: r.end, links: body.links, note: body.note })) });
    const full = (await prisma.battle.findUniqueOrThrow({ where: { id: b.id }, include: { entries: true } })) as BattleWithEntries;
    publish(id, { type: "battles", teamId: m.team.id });
    publish(id, { type: "submissions" });
    notifyAdmins(id, "новые стихи в испытании города {book}", "Команда «{team}» отметила {n} ст. ({side}) и прикрепила ссылки. Проверьте записи в блоке «Испытания».", { book: b.bookCode, team: m.team.name, n: fresh.length, side: side === "ATTACK" ? "вызов" : "ответ" });
    return reply.code(201).send({ ok: true, added: fresh.length, sum: sumVerses(full.entries, side, false) });
  });

  /** Убрать свою запись, пока она не проверена и сторона не отправлена. */
  app.delete("/api/games/:id/battles/:battleId/entries/:entryId", async (request, reply) => {
    const { id, battleId, entryId } = request.params as { id: string; battleId: string; entryId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const e = await prisma.battleEntry.findFirst({ where: { id: entryId, battleId, teamId: m.team.id }, include: { battle: true } });
    if (!e || e.battle.gameId !== id) return reply.code(404).send({ error: "not_found", message: err(request, "Запись не найдена") });
    if (e.status === "APPROVED") return reply.code(409).send({ error: "conflict", message: err(request, "Принятую запись убрать нельзя") });
    if ((e.side === "ATTACK" && e.battle.attackDoneAt) || (e.side === "DEFENSE" && e.battle.defenseDoneAt)) return reply.code(409).send({ error: "conflict", message: err(request, e.side === "ATTACK" ? "Вызов уже отправлен на проверку" : "Ответ уже отправлен на проверку") });
    if (e.userId !== request.user!.id && m.role !== "CAPTAIN") return reply.code(403).send({ error: "forbidden", message: err(request, "Чужую запись может убрать только капитан") });
    await prisma.battleEntry.delete({ where: { id: e.id } });
    publish(id, { type: "battles", teamId: m.team.id });
    return { ok: true };
  });

  /** Капитан отправляет свою сторону на проверку админу. */
  app.post("/api/games/:id/battles/:battleId/submit", async (request, reply) => {
    const { id, battleId } = request.params as { id: string; battleId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    if (m.role !== "CAPTAIN") return reply.code(403).send({ error: "forbidden", message: err(request, "Отправить на проверку может только капитан") });
    await sweep(id);
    const b = await prisma.battle.findFirst({ where: { id: battleId, gameId: id }, include: { entries: true } });
    if (!b) return reply.code(404).send({ error: "not_found", message: err(request, "Испытание не найдено") });
    const side = b.attackerId === m.team.id ? "ATTACK" : b.defenderId === m.team.id ? "DEFENSE" : null;
    if (!side) return reply.code(403).send({ error: "forbidden", message: err(request, "Ваша команда не участвует в этом испытании") });
    const r = side === "ATTACK" ? await submitAttack(b) : await submitDefense(b);
    if (!r.ok) return reply.code(409).send({ error: "conflict", message: err(request, r.message, r.vars) });
    publish(id, { type: "battles", teamId: m.team.id });
    publish(id, { type: "submissions" });
    notifyAdmins(id, "{side} отправлен на проверку", "Команда «{team}» отправила {side} за город {book} на проверку. Проверьте записи в блоке «Испытания».", { side: side === "ATTACK" ? "вызов" : "ответ", team: m.team.name, book: b.bookCode });
    return { ok: true, status: r.battle.status };
  });

  /** Капитан защитников сдаёт город. */
  app.post("/api/games/:id/battles/:battleId/surrender", async (request, reply) => {
    const { id, battleId } = request.params as { id: string; battleId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    if (m.role !== "CAPTAIN") return reply.code(403).send({ error: "forbidden", message: err(request, "Уступить город может только капитан") });
    const b = await prisma.battle.findFirst({ where: { id: battleId, gameId: id, defenderId: m.team.id, status: { in: ["ATTACK", "DEFENSE"] } } });
    if (!b) return reply.code(404).send({ error: "not_found", message: err(request, "Идущее испытание не найдено") });
    await resolveWon(b);
    return { ok: true };
  });

  /** Админ: все битвы игры с записями обеих сторон. */
  app.get("/api/games/:id/battles", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    await sweep(id);
    const battles = await prisma.battle.findMany({ where: { gameId: id }, orderBy: { declaredAt: "desc" }, include, take: 100 });
    const users = await usersOf(battles);
    return { battles: await Promise.all(battles.map((b) => view(b, users, null, null))) };
  });

  /** Админ: одобрить или вернуть запись. */
  app.post("/api/games/:id/battles/:battleId/entries/:entryId/decide", async (request, reply) => {
    const { id, battleId, entryId } = request.params as { id: string; battleId: string; entryId: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const e = await prisma.battleEntry.findFirst({ where: { id: entryId, battleId }, include: { battle: true } });
    if (!e || e.battle.gameId !== id) return reply.code(404).send({ error: "not_found", message: err(request, "Запись не найдена") });
    const body = decideBody.parse(request.body);
    await prisma.battleEntry.update({ where: { id: e.id }, data: { status: body.approve ? "APPROVED" : "REJECTED", adminComment: body.comment, decidedAt: new Date() } });
    let full = (await prisma.battle.findUniqueOrThrow({ where: { id: battleId }, include: { entries: true } })) as BattleWithEntries;
    if (!body.approve) full = await afterReject(full, e.side);
    else full = e.side === "ATTACK" ? await maybeStartDefense(full) : await maybeRepel(full);
    publish(id, { type: "battles", teamId: e.teamId });
    publish(id, { type: "submissions" });
    if (!body.approve) notifyTeam(id, e.teamId, "запись в испытании возвращена", "Админ вернул запись ({side}){comment} Переснимите и прикрепите заново.", { side: e.side === "ATTACK" ? "вызов" : "ответ", comment: body.comment ? `: ${body.comment}` : "." });
    return { ok: true, status: full.status };
  });
}
