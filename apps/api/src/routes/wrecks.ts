import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { assertAwake } from "../services/daytime.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { notifyAdmins, notifyTeam } from "../services/notify.js";
import { err, msg } from "../services/i18n.js";
import { journal, nick } from "../services/journal.js";
import { gameRules } from "../services/battles.js";
import { scheduleAwards } from "../services/awards.js";
import { isLeader, requireActiveMember, requireAdmin } from "./teamMap.js";
import { rollCargo, sinkWreck } from "../services/wrecks.js";

/**
 * Разбитые бурей корабли (решение владельца 04.11): сдача срочного задания командой, очередь и решение администратора.
 * Шага «взять» нет — любая команда может сдать; у команды не больше одной незакрытой сдачи на корабль. Права и ночь —
 * как у Каменоломни: сдаёт капитан, заместитель или летописец, не ночью и не в шторм. Груз считает сервер: 50/50 при
 * одобрении, числа из правил игры на момент решения.
 */
const canWork = (m: { role: string; gameRole: string }) => isLeader(m) || m.gameRole === "CHRONICLER";
const workBody = z.object({ links: z.array(z.string().trim().url().max(500)).max(10).default([]), note: z.string().trim().max(2000).default(""), participants: z.array(z.string().min(1)).max(60).default([]) });
const decideBody = z.object({ approve: z.boolean(), comment: z.string().trim().max(1000).default("") });
/** Жребий груза; тесты подменяют через `setWreckRandom`. */
let random: () => number = Math.random;
export function setWreckRandom(fn: (() => number) | null): void { random = fn ?? Math.random; }

async function nameOf(ids: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, nickname: true, displayName: true } });
  return new Map(users.map((u) => [u.id, u.displayName ?? u.nickname]));
}

export async function wreckRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  /** Администратору: открытые корабли (и затонувшие за последние минуты) с делом и числом команд. */
  app.get("/api/games/:id/wrecks", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const since = new Date(Date.now() - 120_000);
    const rows = await prisma.wreck.findMany({ where: { gameId: id, OR: [{ closedAt: null }, { closedAt: { gte: since } }] }, orderBy: { createdAt: "asc" }, include: { works: { select: { teamId: true, status: true } } } });
    return { wrecks: rows.map((w) => ({ id: w.id, deedId: w.deedId, title: w.title, model: w.model, q: w.q, r: w.r, seed: w.seed, createdAt: w.createdAt, closedAt: w.closedAt, sunkAt: w.sunk ? w.closedAt : null, cargo: { stones: w.stones, blocks: w.blocks }, doneTeams: new Set(w.works.filter((x) => x.status === "APPROVED").map((x) => x.teamId)).size, pending: w.works.filter((x) => x.status === "SUBMITTED").length })) };
  });

  /** Сдать срочное задание: капитан, заместитель или летописец, не ночью. */
  app.post("/api/games/:id/wrecks/:wreckId/submit", async (request, reply) => {
    const { id, wreckId } = request.params as { id: string; wreckId: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    if (!canWork(m)) return reply.code(403).send({ error: "forbidden", message: err(request, "Срочное задание сдаёт капитан, заместитель или летописец") });
    if (!(await assertAwake(request, reply, id))) return;
    const wreck = await prisma.wreck.findFirst({ where: { id: wreckId, gameId: id, closedAt: null }, include: { deed: { select: { id: true, disabled: true } } } });
    if (!wreck || !wreck.deed || wreck.deed.disabled) return reply.code(404).send({ error: "not_found", message: err(request, "Корабля уже нет: он уплыл или затонул") });
    const body = workBody.parse(request.body);
    const open = await prisma.wreckWork.count({ where: { wreckId, teamId: m.team.id, status: { in: ["SUBMITTED", "APPROVED"] } } });
    if (open > 0) return reply.code(409).send({ error: "conflict", message: err(request, "Это задание уже сдано: дождитесь решения администратора") });
    const members = new Set((await prisma.membership.findMany({ where: { teamId: m.team.id }, select: { userId: true } })).map((x) => x.userId));
    const participants = [...new Set(body.participants.filter((u) => members.has(u)))];
    const work = await prisma.wreckWork.create({ data: { gameId: id, wreckId, deedId: wreck.deed.id, teamId: m.team.id, userId: request.user!.id, participants, links: body.links, note: body.note } });
    journal(id, "wreck_submitted", { teamId: m.team.id, userId: request.user!.id, vars: { user: await nick(request.user!.id), deed: wreck.title } });
    publish(id, { type: "submissions", teamId: m.team.id });
    publish(id, { type: "wrecks", teamId: m.team.id });
    publish(id, { type: "map", teamId: m.team.id });
    if ((await gameRules(id)).adminDigest === "instant") notifyAdmins(id, "срочное задание с разбитого корабля", (locale) => msg(locale, "Команда «{team}» сдала срочное задание «{deed}» с разбитого корабля. Нужно проверить и принять или вернуть — в проверке, блок «Корабли».", { team: m.team.name, deed: wreck.title }));
    return reply.code(201).send({ work: { id: work.id, status: work.status } });
  });

  /** Очередь сдач для администратора: на проверке (по умолчанию) или решённые. */
  app.get("/api/games/:id/wrecks/submissions", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const status = ((request.query as { status?: string }).status ?? "SUBMITTED") as string;
    const works = await prisma.wreckWork.findMany({ where: { gameId: id, ...(status === "DECIDED" ? { status: { in: ["APPROVED", "REJECTED"] } } : { status }) }, orderBy: status === "DECIDED" ? { decidedAt: "desc" } : { submittedAt: "asc" }, take: 100, include: { wreck: { select: { title: true, closedAt: true, sunk: true } }, deed: { select: { description: true, proofType: true } }, team: { select: { id: true, name: true, color: true, avatarId: true, stones: true, cargoBlocks: true } } } });
    const names = await nameOf([...works.map((w) => w.userId), ...works.flatMap((w) => w.participants)]);
    return { works: works.map((w) => ({ id: w.id, wreckId: w.wreckId, team: w.team, title: w.wreck.title, description: w.deed?.description ?? "", proofType: w.deed?.proofType ?? "PHOTO_LINK", by: names.get(w.userId) ?? "", participants: w.participants.map((u) => names.get(u) ?? "").filter(Boolean), links: w.links, note: w.note, status: w.status, submittedAt: w.submittedAt, decidedAt: w.decidedAt, adminComment: w.adminComment, cargo: w.cargo, amount: w.amount, sunk: w.wreck.sunk })) };
  });

  /** Решение администратора: принято — груз по жребию команде, корабль у неё чинится и уплывает; возвращено — с комментарием. */
  app.post("/api/games/:id/wrecks/works/:workId/decide", async (request, reply) => {
    const { id, workId } = request.params as { id: string; workId: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const body = decideBody.parse(request.body);
    const work = await prisma.wreckWork.findFirst({ where: { id: workId, gameId: id }, include: { wreck: { select: { title: true, closedAt: true, stones: true, blocks: true } } } });
    if (!work) return reply.code(404).send({ error: "not_found", message: err(request, "Сдача не найдена") });
    if (work.status !== "SUBMITTED") return reply.code(409).send({ error: "conflict", message: err(request, "Эта сдача уже рассмотрена") });
    const now = new Date();
    if (!body.approve) {
      await prisma.wreckWork.update({ where: { id: workId }, data: { status: "REJECTED", decidedAt: now, decidedById: request.user!.id, adminComment: body.comment } });
      journal(id, "wreck_returned", { teamId: work.teamId, userId: work.userId, vars: { deed: work.wreck.title, comment: body.comment ? `: ${body.comment}` : "" } });
      notifyTeam(id, work.teamId, "Срочное задание вернули", (locale) => msg(locale, "Администратор вернул срочное задание «{deed}» с разбитого корабля.{comment} Можно сдать снова.", { deed: work.wreck.title, comment: body.comment ? ` ${body.comment}` : "" }));
      publish(id, { type: "submissions", teamId: work.teamId }); publish(id, { type: "wrecks", teamId: work.teamId }); publish(id, { type: "map", teamId: work.teamId });
      return { ok: true };
    }
    // Груз: одно из двух, 50/50; числа — из корабля (снимок дела) на момент решения. Сервер считает всё сам.
    const roll = rollCargo(work.wreck, random);
    await prisma.$transaction([
      prisma.wreckWork.update({ where: { id: workId }, data: { status: "APPROVED", decidedAt: now, decidedById: request.user!.id, adminComment: body.comment, cargo: roll.cargo, amount: roll.amount } }),
      prisma.team.update({ where: { id: work.teamId }, data: roll.cargo === "STONES" ? { stones: { increment: roll.amount } } : { cargoBlocks: { increment: roll.amount } } }),
    ]);
    // Груз — шаблоном с числом: клиент и письма переводят его как подстановку.
    journal(id, "wreck_rewarded", { teamId: work.teamId, userId: work.userId, vars: { deed: work.wreck.title, cargo: roll.cargo === "STONES" ? "тёсаных камней: {n}" : "блоков для стен: {n}", n: roll.amount } });
    notifyTeam(id, work.teamId, "Капитан корабля отблагодарил вас", (locale) => msg(locale, roll.cargo === "STONES" ? "Срочное задание «{deed}» принято. Капитан корабля отблагодарил вас: тёсаных камней — {n}. Корабль починен и уплывает." : "Срочное задание «{deed}» принято. Капитан корабля отблагодарил вас: блоков для стен — {n}. Блок кладётся в стену своего города сразу. Корабль починен и уплывает.", { deed: work.wreck.title, n: roll.amount }));
    scheduleAwards(id);
    publish(id, { type: "submissions", teamId: work.teamId }); publish(id, { type: "wrecks", teamId: work.teamId }); publish(id, { type: "teams" }); publish(id, { type: "map", teamId: work.teamId });
    return { ok: true, cargo: roll.cargo, amount: roll.amount };
  });

  /** Отпустить корабль (администратор): он тонет у тех, кто не успел, открытые сдачи закрываются. */
  app.post("/api/games/:id/wrecks/:wreckId/close", async (request, reply) => {
    const { id, wreckId } = request.params as { id: string; wreckId: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const n = await sinkWreck(id, { wreckId });
    if (!n) return reply.code(404).send({ error: "not_found", message: err(request, "Открытого корабля нет") });
    return { ok: true };
  });
}
