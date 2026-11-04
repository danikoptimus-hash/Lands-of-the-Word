import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { assertAwake } from "../services/daytime.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { err, fmtDay, msg, toLocale } from "../services/i18n.js";
import { days } from "../services/rules.js";
import { isLeader, requireActiveMember, requireAdmin, requireMember } from "./teamMap.js";
import { learnedVerses } from "./battles.js";
import { notifyAdmins, notifyUser } from "../services/notify.js";
import { journal, nick } from "../services/journal.js";
import { gameRules } from "../services/battles.js";
import { brickRange, brickRef, cargoRange, CARGO_NOTE, layApprovedBlockIntoDefense, wallBook, wallOf } from "../services/wall.js";
import { BOOKS } from "@lotw/domain";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
const buildBody = z.object({
  block: z.number().int().min(0).max(10_000),
  links: z.array(z.string().trim().url().max(500)).min(1).max(5),
  note: z.string().trim().max(500).default(""),
});
const decideBody = z.object({ approve: z.boolean(), comment: z.string().trim().max(1000).default("") });

/** Город, которым владеет команда (взят и не потерян). */
async function ownedCity(gameId: string, teamId: string, nodeKey: string) {
  const [state, node] = await Promise.all([
    prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId, nodeKey } }, select: { capturedAt: true } }),
    prisma.mapNode.findUnique({ where: { gameId_key: { gameId, key: nodeKey } }, select: { bookCode: true, ruined: true } }),
  ]);
  return node?.bookCode && state?.capturedAt ? { bookCode: node.bookCode } : null;
}

async function nicknames(ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, nickname: true, displayName: true } });
  return new Map(rows.map((u) => [u.id, u.displayName || u.nickname]));
}

/**
 * Городская стена (решение владельца 01.11): участники команды-хранителя сдают блоки стихов книги своего города;
 * администратор проверяет; стена ложится в ответ при испытании (services/wall.ts).
 */
export async function wallRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  /** Стена своего города: толщина, кладка и какие блоки участник ещё может сдать. */
  app.get("/api/games/:id/my-city/:nodeKey/wall", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const city = await ownedCity(id, m.team.id, nodeKey);
    if (!city) return reply.code(409).send({ error: "conflict", message: err(request, "Стену строят только в своём городе") });
    const { book, n } = await wallBook(id, city.bookCode);
    if (!book) return reply.code(409).send({ error: "conflict", message: err(request, "Текст этой книги ещё не загружен") });
    const userId = request.user!.id;
    const [rows, mineEntries, defense, members] = await Promise.all([
      prisma.wallBlock.findMany({ where: { teamId: m.team.id, nodeKey }, orderBy: { createdAt: "asc" } }),
      prisma.battleEntry.findMany({ where: { userId, status: { not: "REJECTED" }, battle: { gameId: id, bookCode: city.bookCode } }, select: { startIdx: true, endIdx: true } }),
      prisma.battle.findFirst({ where: { gameId: id, nodeKey, defenderId: m.team.id, status: "DEFENSE" }, select: { id: true } }),
      prisma.membership.findMany({ where: { teamId: m.team.id }, select: { userId: true, role: true } }),
    ]);
    const inTeam = new Set(members.map((x) => x.userId));
    const learned = new Set<number>();
    for (const e of mineEntries) for (let i = e.startIdx; i <= e.endIdx; i++) learned.add(i);
    const total = book.total, count = Math.ceil(total / n);
    // Починки (repairOfId) — отдельные строки: на проверке держат блок в состоянии «на проверке», принятые — история.
    const repairPending = new Set(rows.filter((r) => r.repairOfId && r.status === "SUBMITTED").map((r) => r.repairOfId!));
    const myBlocks = new Map(rows.filter((r) => r.userId === userId && r.status !== "REJECTED" && !r.repairOfId && !r.cargo).map((r) => [Math.floor(r.startIdx / n), r] as const));
    const bricks = Array.from({ length: count }, (_, k) => {
      const { start, end } = brickRange(k, n, total);
      let state: "free" | "learned" | "submitted" | "approved" | "used" | "cracked" = "free";
      const my = myBlocks.get(k);
      if (my?.usedAt) state = "used";
      else if (my?.status === "APPROVED" && my.missing > 0) state = repairPending.has(my.id) ? "submitted" : "cracked";
      else if (my?.status === "APPROVED") state = "approved";
      else if (my?.status === "SUBMITTED") state = "submitted";
      else { for (let i = start; i <= end; i++) if (learned.has(i)) { state = "learned"; break; } }
      const missing = state === "cracked" ? my!.missing : 0;
      return { k, start, end, ref: brickRef(book, start, end), state, missing, repairRef: missing ? brickRef(book, end - missing + 1, end) : null };
    });
    // Кто из команды может взять каждый блок (решение владельца 02.11: «чтобы капитан понимал, сколько человек может взять,
    // какие полностью свободны»): у участника нет сданных стихов блока (испытания и стена) и нет своей строки на него; план по блокам.
    const teamMembers = members.map((x) => x.userId);
    const closedBy = new Map(await Promise.all(teamMembers.map(async (uid) => [uid, await learnedVerses(id, "", city.bookCode, uid)] as const)));
    const rowsBy = new Map<string, Set<number>>();
    for (const r of rows) if (r.status !== "REJECTED" && !r.repairOfId && !r.cargo) { if (!rowsBy.has(r.userId)) rowsBy.set(r.userId, new Set()); rowsBy.get(r.userId)!.add(Math.floor(r.startIdx / n)); }
    const plans = await prisma.learnPlan.findMany({ where: { teamId: m.team.id, bookCode: city.bookCode }, select: { idx: true, userId: true } });
    for (const b of bricks) {
      const takers = teamMembers.filter((uid) => !rowsBy.get(uid)?.has(b.k) && !Array.from({ length: b.end - b.start + 1 }, (_, i) => b.start + i).some((i) => closedBy.get(uid)!.has(i)));
      const planned = [...new Set(plans.filter((pl) => pl.idx >= b.start && pl.idx <= b.end).map((pl) => pl.userId))];
      Object.assign(b, { takers, planned });
    }
    const names = await nicknames([...new Set([...rows.map((r) => r.userId), ...teamMembers])]);
    // Блок из груза корабля (решение владельца 04.11) — командный: виден и после ухода положившего.
    const live = rows.filter((r) => (r.cargo || inTeam.has(r.userId)) && r.status !== "REJECTED" && !r.repairOfId);
    const wall = await wallOf(m.team.id, nodeKey);
    const teamRow = await prisma.team.findUniqueOrThrow({ where: { id: m.team.id }, select: { cargoBlocks: true } });
    const why = defense ? "Идёт ответ хранителей: стена строится в мирное время" : bricks.every((b) => b.state !== "free" && b.state !== "cracked") ? "Все блоки книги вы уже сдали" : null;
    return {
      mine: true, bookCode: city.bookCode, blockVerses: n, total, verses: wall.verses, blockCount: wall.blocks, pending: wall.pending,
      // Груз разбитого корабля (04.11): сколько блоков у команды и может ли этот участник положить блок (капитан, заместитель, летописец).
      cargoBlocks: teamRow.cargoBlocks, canCargo: teamRow.cargoBlocks > 0 && !defense && (isLeader(m) || m.gameRole === "CHRONICLER"),
      canPlan: isLeader(m), members: members.map((x) => ({ userId: x.userId, name: names.get(x.userId) ?? "?", role: x.role })),
      canBuild: !why, why: why ? err(request, why) : null,
      bricks,
      blocks: live.map((r) => ({ id: r.id, k: r.cargo ? -1 : Math.floor(r.startIdx / n), ref: r.cargo ? "груз корабля" : brickRef(book, r.startIdx, r.endIdx), cargo: r.cargo, verses: r.endIdx - r.startIdx + 1, weight: r.weight, userId: r.userId, nickname: names.get(r.userId) ?? "?", status: r.status, used: r.usedAt !== null, usedAt: r.usedAt, missing: r.missing, repairPending: repairPending.has(r.id), adminComment: r.adminComment, links: r.links, createdAt: r.createdAt, mine: r.userId === userId })),
      returned: rows.filter((r) => r.userId === userId && r.status === "REJECTED").slice(-3).map((r) => ({ id: r.id, ref: brickRef(book, r.startIdx, r.endIdx), repair: Boolean(r.repairOfId), adminComment: r.adminComment, decidedAt: r.decidedAt })),
    };
  });

  /** Сдать блок: выучил n стихов подряд, прикрепил видео. Любой участник команды-хранителя, в мирное время, не ночью и не в шторм. */
  app.post("/api/games/:id/my-city/:nodeKey/wall", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    if (!(await assertAwake(request, reply, id))) return;
    const city = await ownedCity(id, m.team.id, nodeKey);
    if (!city) return reply.code(409).send({ error: "conflict", message: err(request, "Стену строят только в своём городе") });
    const body = buildBody.parse(request.body);
    const { book, n } = await wallBook(id, city.bookCode);
    if (!book) return reply.code(409).send({ error: "conflict", message: err(request, "Текст этой книги ещё не загружен") });
    if (body.block >= Math.ceil(book.total / n)) return reply.code(400).send({ error: "validation", message: err(request, "Такого блока в книге нет") });
    const defense = await prisma.battle.findFirst({ where: { gameId: id, nodeKey, defenderId: m.team.id, status: "DEFENSE" }, select: { id: true } });
    if (defense) return reply.code(409).send({ error: "conflict", message: err(request, "Идёт ответ хранителей: стена строится в мирное время") });
    const { start, end } = brickRange(body.block, n, book.total);
    const userId = request.user!.id;
    const dup = await prisma.wallBlock.findFirst({ where: { teamId: m.team.id, nodeKey, userId, startIdx: start, status: { not: "REJECTED" }, repairOfId: null }, select: { id: true, status: true, missing: true, endIdx: true, weight: true } });
    if (dup && dup.status === "APPROVED" && dup.missing > 0) {
      // Починка надломленного блока (решение владельца 02.11): хозяин досдаёт недостающие стихи с конца блока, администратор проверяет.
      const pending = await prisma.wallBlock.findFirst({ where: { repairOfId: dup.id, status: "SUBMITTED" }, select: { id: true } });
      if (pending) return reply.code(409).send({ error: "conflict", message: err(request, "Починка этого блока уже на проверке") });
      const rs = dup.endIdx - dup.missing + 1, re = dup.endIdx;
      const row = await prisma.wallBlock.create({ data: { gameId: id, teamId: m.team.id, nodeKey, bookCode: city.bookCode, userId, startIdx: rs, endIdx: re, links: body.links, note: body.note, weight: dup.weight, repairOfId: dup.id } });
      const ref = brickRef(book, start, end), part = brickRef(book, rs, re);
      journal(id, "wall_repair_submitted", { teamId: m.team.id, userId, vars: { user: await nick(userId), book: city.bookCode, ref, part } });
      publish(id, { type: "cities", teamId: m.team.id });
      publish(id, { type: "submissions" });
      if ((await gameRules(id)).adminDigest === "instant") notifyAdmins(id, "починка стены города {book}", "Команда «{team}» сдала починку блока городской стены ({part} из {ref}). Проверьте запись в блоке «Стены».", { book: city.bookCode, team: m.team.name, ref, part });
      return reply.code(201).send({ ok: true, id: row.id, ref: part, repair: true });
    }
    if (dup) return reply.code(409).send({ error: "conflict", message: err(request, dup.status === "APPROVED" ? "Этот блок у вас уже принят" : "Этот блок у вас уже на проверке") });
    // Стих сдаётся один раз (решение владельца 03.10): стихи, отмеченные в испытаниях этой книги, в блок не входят.
    const overlap = await prisma.battleEntry.findFirst({ where: { userId, status: { not: "REJECTED" }, startIdx: { lte: end }, endIdx: { gte: start }, battle: { gameId: id, bookCode: city.bookCode } }, select: { id: true } });
    if (overlap) return reply.code(409).send({ error: "conflict", message: err(request, "Стихи этого блока вы уже сдавали в испытании: второй раз они не засчитываются") });
    const weight = m.gameRole === "WARRIOR" ? 2 : 1;
    const row = await prisma.wallBlock.create({ data: { gameId: id, teamId: m.team.id, nodeKey, bookCode: city.bookCode, userId, startIdx: start, endIdx: end, links: body.links, note: body.note, weight } });
    const ref = brickRef(book, start, end);
    journal(id, "wall_block_submitted", { teamId: m.team.id, userId, vars: { user: await nick(userId), book: city.bookCode, ref } });
    publish(id, { type: "cities", teamId: m.team.id });
    publish(id, { type: "submissions" });
    if ((await gameRules(id)).adminDigest === "instant") notifyAdmins(id, "блок стены города {book}", "Команда «{team}» сдала блок городской стены ({ref}). Проверьте запись в блоке «Стены».", { book: city.bookCode, team: m.team.name, ref });
    return reply.code(201).send({ ok: true, id: row.id, ref });
  });

  /**
   * Положить блок из груза разбитого корабля (решение владельца 04.11): капитан, заместитель или летописец, в своём городе,
   * в мирное время; блок ложится сразу принятым, стихов за ним нет (условный диапазон ниже нуля), толщина — как у обычного
   * блока веса 1; карта книги и починка его не учитывают. Списывается один блок у команды.
   */
  app.post("/api/games/:id/my-city/:nodeKey/wall/cargo", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    if (!(isLeader(m) || m.gameRole === "CHRONICLER")) return reply.code(403).send({ error: "forbidden", message: err(request, "Блок из груза кладёт капитан, заместитель или летописец") });
    if (!(await assertAwake(request, reply, id))) return;
    const city = await ownedCity(id, m.team.id, nodeKey);
    if (!city) return reply.code(409).send({ error: "conflict", message: err(request, "Стену строят только в своём городе") });
    const defense = await prisma.battle.findFirst({ where: { gameId: id, nodeKey, defenderId: m.team.id, status: "DEFENSE" }, select: { id: true } });
    if (defense) return reply.code(409).send({ error: "conflict", message: err(request, "Идёт ответ хранителей: стена строится в мирное время") });
    const team = await prisma.team.findUniqueOrThrow({ where: { id: m.team.id }, select: { cargoBlocks: true } });
    if (team.cargoBlocks < 1) return reply.code(409).send({ error: "conflict", message: err(request, "У команды нет блоков из груза") });
    const { n } = await wallBook(id, city.bookCode);
    const k = await prisma.wallBlock.count({ where: { teamId: m.team.id, nodeKey, cargo: true } });
    const { start, end } = cargoRange(k, n);
    const now = new Date(), userId = request.user!.id;
    const [, row] = await prisma.$transaction([
      prisma.team.update({ where: { id: m.team.id }, data: { cargoBlocks: { decrement: 1 } } }),
      prisma.wallBlock.create({ data: { gameId: id, teamId: m.team.id, nodeKey, bookCode: city.bookCode, userId, startIdx: start, endIdx: end, note: CARGO_NOTE, weight: 1, cargo: true, status: "APPROVED", decidedAt: now } }),
    ]);
    const wall = await wallOf(m.team.id, nodeKey);
    journal(id, "wall_cargo_laid", { teamId: m.team.id, userId, vars: { user: await nick(userId), book: city.bookCode, n: wall.verses } });
    publish(id, { type: "cities" });
    publish(id, { type: "teams" });
    return reply.code(201).send({ ok: true, id: row.id, cargoBlocks: team.cargoBlocks - 1 });
  });

  /**
   * Разведка стены (решение владельца 02.11: «значок стены не виден по умолчанию… нужно разведывать через разведчика»):
   * разведчик раз в `roleCooldownDays` (свой лимит, независимый от разведки перекрёстков) узнаёт, есть ли стена у чужого
   * города — без толщины. Снимок на момент разведки: стену, построенную позже, покажет только новая разведка.
   */
  app.post("/api/games/:id/my-city/:nodeKey/scout-wall", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    if (!(await assertAwake(request, reply, id))) return;
    if (m.gameRole !== "SCOUT") return reply.code(403).send({ error: "forbidden", message: err(request, "Разведать стену может только разведчик команды") });
    const reached = await prisma.teamNodeState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } });
    if (!reached) return reply.code(403).send({ error: "forbidden", message: err(request, "Ваша команда ещё не дошла до этого города") });
    const owner = await prisma.teamCityState.findFirst({ where: { gameId: id, nodeKey, capturedAt: { not: null } }, select: { teamId: true } });
    if (!owner || owner.teamId === m.team.id) return reply.code(409).send({ error: "conflict", message: err(request, "Стену разведывают у чужого города") });
    const rules = await gameRules(id);
    if (m.wallScoutedAt && Date.now() - m.wallScoutedAt.getTime() < days(rules.roleCooldownDays)) {
      const next = new Date(m.wallScoutedAt.getTime() + days(rules.roleCooldownDays));
      return reply.code(429).send({ error: "cooldown", message: err(request, "Разведка стен доступна раз в неделю: следующая — {date}", { date: fmtDay(next, toLocale(request.user?.locale)) }) });
    }
    const now = new Date();
    const hasWall = (await wallOf(owner.teamId, nodeKey)).blocks > 0;
    await prisma.$transaction([
      prisma.teamWallScout.upsert({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } }, create: { teamId: m.team.id, nodeKey, hasWall, scoutedAt: now }, update: { hasWall, scoutedAt: now } }),
      prisma.membership.update({ where: { teamId_userId: { teamId: m.team.id, userId: request.user!.id } }, data: { wallScoutedAt: now } }),
    ]);
    const book = (await prisma.mapNode.findUnique({ where: { gameId_key: { gameId: id, key: nodeKey } }, select: { bookCode: true } }))?.bookCode ?? "";
    journal(id, "wall_scouted", { teamId: m.team.id, userId: request.user!.id, vars: { user: await nick(request.user!.id), book, result: hasWall ? "стена есть" : "стены нет" } });
    publish(id, { type: "map", teamId: m.team.id });
    publish(id, { type: "cities", teamId: m.team.id });
    return { hasWall, scoutedAt: now };
  });

  /** Убрать свой блок, пока он на проверке. */
  app.delete("/api/games/:id/my-city/:nodeKey/wall/:blockId", async (request, reply) => {
    const { id, nodeKey, blockId } = request.params as { id: string; nodeKey: string; blockId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const row = await prisma.wallBlock.findFirst({ where: { id: blockId, gameId: id, teamId: m.team.id, nodeKey } });
    if (!row) return reply.code(404).send({ error: "not_found", message: err(request, "Блок не найден") });
    if (row.userId !== request.user!.id) return reply.code(403).send({ error: "forbidden", message: err(request, "Убрать можно только свой блок") });
    if (row.status !== "SUBMITTED") return reply.code(409).send({ error: "conflict", message: err(request, "Проверенный блок убрать нельзя") });
    await prisma.wallBlock.delete({ where: { id: row.id } });
    publish(id, { type: "cities", teamId: m.team.id });
    publish(id, { type: "submissions" });
    return { ok: true };
  });

  /** Администратор: блоки стен всех команд, на проверке первыми. */
  app.get("/api/games/:id/walls", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const rows = await prisma.wallBlock.findMany({ where: { gameId: id }, orderBy: [{ createdAt: "desc" }], take: 200, include: { team: { select: { id: true, name: true, color: true, avatarId: true } } } });
    const books = new Map<string, Awaited<ReturnType<typeof wallBook>>["book"]>();
    for (const code of new Set(rows.map((r) => r.bookCode))) books.set(code, (await wallBook(id, code)).book);
    const names = await nicknames([...new Set(rows.map((r) => r.userId))]);
    const pending = rows.filter((r) => r.status === "SUBMITTED"), rest = rows.filter((r) => r.status !== "SUBMITTED").slice(0, 30);
    return {
      blocks: [...pending, ...rest].map((r) => {
        const book = books.get(r.bookCode);
        return { id: r.id, nodeKey: r.nodeKey, bookCode: r.bookCode, bookName: BOOK_BY_CODE.get(r.bookCode)?.nameRu ?? r.bookCode, team: r.team, nickname: names.get(r.userId) ?? "?", cargo: r.cargo, ref: r.cargo ? "груз корабля" : book ? brickRef(book, r.startIdx, r.endIdx) : `${r.startIdx + 1}–${r.endIdx + 1}`, verses: r.endIdx - r.startIdx + 1, weight: r.weight, repair: Boolean(r.repairOfId), missing: r.missing, links: r.links, note: r.note, status: r.status, usedAt: r.usedAt, adminComment: r.adminComment, createdAt: r.createdAt, decidedAt: r.decidedAt };
      }),
    };
  });

  /** Администратор: принять или вернуть блок или починку. Блок, принятый в последнюю минуту ответа хранителей, ложится в ответ сразу. */
  app.post("/api/games/:id/walls/:blockId/decide", async (request, reply) => {
    const { id, blockId } = request.params as { id: string; blockId: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const row = await prisma.wallBlock.findFirst({ where: { id: blockId, gameId: id } });
    if (!row) return reply.code(404).send({ error: "not_found", message: err(request, "Блок не найден") });
    if (row.status !== "SUBMITTED") return reply.code(409).send({ error: "conflict", message: err(request, "Блок уже проверен") });
    const body = decideBody.parse(request.body);
    const orig = row.repairOfId ? await prisma.wallBlock.findUnique({ where: { id: row.repairOfId } }) : null;
    await prisma.$transaction([
      prisma.wallBlock.update({ where: { id: row.id }, data: { status: body.approve ? "APPROVED" : "REJECTED", adminComment: body.comment, decidedAt: new Date() } }),
      // Принятая починка возвращает исходному блоку недостающие стихи (решение владельца 02.11); записи починки — к блоку.
      ...(body.approve && orig ? [prisma.wallBlock.update({ where: { id: orig.id }, data: { missing: 0, links: { push: row.links.slice(0, 5) } } })] : []),
    ]);
    const { book } = await wallBook(id, row.bookCode);
    const ref = book ? brickRef(book, row.startIdx, row.endIdx) : "";
    if (body.approve) {
      const wall = await wallOf(row.teamId, row.nodeKey);
      if (orig) journal(id, "wall_block_repaired", { teamId: row.teamId, userId: row.userId, vars: { book: row.bookCode, ref: book ? brickRef(book, orig.startIdx, orig.endIdx) : ref, n: wall.verses } });
      else journal(id, "wall_block_approved", { teamId: row.teamId, userId: row.userId, vars: { book: row.bookCode, ref, n: wall.verses } });
      await layApprovedBlockIntoDefense(id, row.teamId, row.nodeKey);
      // Стена видна на карте всем командам, дошедшим до города: событие без команды.
      publish(id, { type: "cities" });
    } else {
      journal(id, "wall_block_returned", { personal: true, userId: row.userId, teamId: row.teamId, vars: { book: row.bookCode, ref: orig ? `${ref} (починка)` : ref, comment: body.comment ? `: ${body.comment}` : "" } });
      notifyUser(id, row.userId, orig ? "починка стены города {book} возвращена" : "блок стены города {book} возвращён", (locale) => msg(locale, orig ? "Администратор вернул починку блока городской стены ({ref}).{comment} Переснимите и сдайте заново." : "Администратор вернул блок городской стены ({ref}).{comment} Переснимите и сдайте заново.", { ref, comment: body.comment ? ` ${body.comment}` : "" }), { book: row.bookCode });
      publish(id, { type: "cities", teamId: row.teamId });
    }
    publish(id, { type: "submissions" });
    return { ok: true };
  });
}
