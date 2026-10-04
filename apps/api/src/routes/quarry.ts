import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { assertAwake } from "../services/daytime.js";
import { publish } from "../services/events.js";
import { revealNode } from "../services/teamMap.js";
import { notifyAdmins, notifyTeam } from "../services/notify.js";
import { err, msg } from "../services/i18n.js";
import { journal, nick } from "../services/journal.js";
import { gameRules } from "../services/battles.js";
import { isLeader, requireActiveMember, requireAdmin } from "./teamMap.js";

/**
 * Каменоломня (решение владельца 04.10): островок в море, одинаковый во всех партиях. Капитан, заместитель или летописец
 * сдаёт там общие дела команды (вся команда на спевке, собрании, стройке, молитвенной группе) — фото всей команды.
 * Администратор принимает в «Проверке», команда получает тёсаные камни (у каждого дела своё число). Один камень мостит
 * одну свободную сторону на карте: сторона открывается как пройденная, но в счёт дел не идёт (`paved`). Ограничений по
 * частоте нет (решение владельца). Ночью, как и дела, Каменоломня ждёт утра.
 */
const canWork = (m: { role: string; gameRole: string }) => isLeader(m) || m.gameRole === "CHRONICLER";
const workBody = z.object({ links: z.array(z.string().trim().url().max(500)).min(1).max(10), note: z.string().trim().max(2000).default("") });
const decideBody = z.object({ approve: z.boolean(), comment: z.string().trim().max(1000).default("") });
const quarryDeedSelect = { id: true, title: true, description: true, direction: true, proofType: true, stones: true } as const;

export async function quarryRoutes(app: FastifyInstance): Promise<void> {
  /** Каменоломня глазами команды: камни, общие дела, свои сдачи. */
  app.get("/api/games/:id/quarry", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    const [deeds, works, team] = await Promise.all([
      prisma.deed.findMany({ where: { gameId: id, quarry: true }, select: quarryDeedSelect, orderBy: { createdAt: "asc" } }),
      prisma.quarryWork.findMany({ where: { teamId: m.team.id }, orderBy: { submittedAt: "desc" }, take: 30, include: { deed: { select: { title: true } } } }),
      prisma.team.findUniqueOrThrow({ where: { id: m.team.id }, select: { stones: true } }),
    ]);
    const userIds = [...new Set(works.map((w) => w.byId))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, nickname: true, displayName: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.displayName ?? u.nickname]));
    return {
      stones: team.stones,
      canWork: canWork(m),
      deeds,
      works: works.map((w) => ({ id: w.id, deedId: w.deedId, title: w.deed.title, status: w.status, stones: w.stones, by: nameOf.get(w.byId) ?? "", links: w.links, note: w.note, submittedAt: w.submittedAt, decidedAt: w.decidedAt, adminComment: w.adminComment })),
    };
  });

  /** Сдать общее дело: капитан, заместитель или летописец, с фото всей команды. */
  app.post("/api/games/:id/quarry/:deedId/submit", async (request, reply) => {
    const { id, deedId } = request.params as { id: string; deedId: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    if (!canWork(m)) return reply.code(403).send({ error: "forbidden", message: err(request, "Общее дело сдаёт капитан, заместитель или летописец") });
    if (!(await assertAwake(request, reply, id))) return;
    const deed = await prisma.deed.findFirst({ where: { id: deedId, gameId: id, quarry: true }, select: quarryDeedSelect });
    if (!deed) return reply.code(404).send({ error: "not_found", message: err(request, "Общее дело не найдено") });
    const body = workBody.parse(request.body);
    const pending = await prisma.quarryWork.count({ where: { teamId: m.team.id, deedId, status: "SUBMITTED" } });
    if (pending > 0) return reply.code(409).send({ error: "conflict", message: err(request, "Это общее дело уже на проверке: дождитесь решения администратора") });
    const work = await prisma.quarryWork.create({ data: { gameId: id, teamId: m.team.id, deedId, byId: request.user!.id, links: body.links, note: body.note, stones: deed.stones } });
    journal(id, "quarry_submitted", { teamId: m.team.id, userId: request.user!.id, vars: { user: await nick(request.user!.id), deed: deed.title } });
    publish(id, { type: "submissions", teamId: m.team.id });
    publish(id, { type: "quarry", teamId: m.team.id });
    if ((await gameRules(id)).adminDigest === "instant") notifyAdmins(id, "общее дело в Каменоломне", (locale) => msg(locale, "Команда «{team}» сдала общее дело «{deed}» в Каменоломне. Нужно проверить и принять или вернуть.", { team: m.team.name, deed: deed.title }));
    return reply.code(201).send({ work: { id: work.id, status: work.status, stones: work.stones } });
  });

  /** Очередь общих дел для администратора. */
  app.get("/api/games/:id/quarry/submissions", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const status = ((request.query as { status?: string }).status ?? "SUBMITTED") as string;
    const works = await prisma.quarryWork.findMany({ where: { gameId: id, status }, orderBy: { submittedAt: "asc" }, take: 200, include: { deed: { select: { title: true, description: true, stones: true } }, team: { select: { id: true, name: true, color: true, stones: true } } } });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(works.map((w) => w.byId))] } }, select: { id: true, nickname: true, displayName: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.displayName ?? u.nickname]));
    return { works: works.map((w) => ({ id: w.id, team: w.team, deed: w.deed, stones: w.stones, by: nameOf.get(w.byId) ?? "", links: w.links, note: w.note, status: w.status, submittedAt: w.submittedAt, decidedAt: w.decidedAt, adminComment: w.adminComment })) };
  });

  /** Решение администратора: принято — команде камни; возвращено — с комментарием. */
  app.post("/api/games/:id/quarry/works/:workId/decide", async (request, reply) => {
    const { id, workId } = request.params as { id: string; workId: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const body = decideBody.parse(request.body);
    const work = await prisma.quarryWork.findFirst({ where: { id: workId, gameId: id }, include: { deed: { select: { title: true } } } });
    if (!work) return reply.code(404).send({ error: "not_found", message: err(request, "Сдача не найдена") });
    if (work.status !== "SUBMITTED") return reply.code(409).send({ error: "conflict", message: err(request, "Эта сдача уже рассмотрена") });
    const stones = body.approve ? work.stones : 0;
    await prisma.$transaction([
      prisma.quarryWork.update({ where: { id: workId }, data: { status: body.approve ? "APPROVED" : "REJECTED", decidedAt: new Date(), decidedById: request.user!.id, adminComment: body.comment } }),
      ...(stones > 0 ? [prisma.team.update({ where: { id: work.teamId }, data: { stones: { increment: stones } } })] : []),
    ]);
    if (body.approve) {
      journal(id, "quarry_approved", { teamId: work.teamId, userId: work.byId, vars: { deed: work.deed.title, n: stones } });
      notifyTeam(id, work.teamId, "Каменоломня: камни получены", (locale) => msg(locale, "Общее дело «{deed}» принято: команда получила камней — {n}. Камень мостит любую свободную дорогу на карте.", { deed: work.deed.title, n: stones }));
    } else {
      journal(id, "quarry_returned", { teamId: work.teamId, userId: work.byId, vars: { deed: work.deed.title } });
      notifyTeam(id, work.teamId, "Каменоломня: дело вернули", (locale) => msg(locale, "Администратор вернул общее дело «{deed}».{comment}", { deed: work.deed.title, comment: body.comment ? ` ${body.comment}` : "" }));
    }
    publish(id, { type: "submissions", teamId: work.teamId });
    publish(id, { type: "quarry", teamId: work.teamId });
    publish(id, { type: "teams" });
    return { ok: true, stones };
  });

  /** Вымостить дорогу: камень списывается, свободная сторона открывается как пройденная (без дела). */
  app.post("/api/games/:id/edge-tasks/:taskId/pave", async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    if (!canWork(m)) return reply.code(403).send({ error: "forbidden", message: err(request, "Дорогу мостит капитан, заместитель или летописец") });
    if (!(await assertAwake(request, reply, id))) return;
    const task = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, teamId: m.team.id }, include: { deed: { select: { title: true } } } });
    if (!task) return reply.code(404).send({ error: "not_found", message: err(request, "Дело не найдено") });
    if (task.status !== "OPEN" || task.sea) return reply.code(409).send({ error: "conflict", message: err(request, "Камнем мостят только свободную сухопутную сторону") });
    const team = await prisma.team.findUniqueOrThrow({ where: { id: m.team.id }, select: { stones: true } });
    if (team.stones < 1) return reply.code(409).send({ error: "conflict", message: err(request, "У команды нет камней: сдайте общее дело в Каменоломне") });
    const now = new Date();
    await prisma.$transaction([
      prisma.team.update({ where: { id: m.team.id }, data: { stones: { decrement: 1 } } }),
      prisma.teamEdgeTask.update({ where: { id: taskId }, data: { status: "APPROVED", paved: true, takenById: request.user!.id, takenAt: now, submittedAt: now, decidedAt: now, note: "Вымощено камнем из Каменоломни", adminComment: "" } }),
    ]);
    await revealNode(id, m.team.id, task.toKey);
    journal(id, "paved", { teamId: m.team.id, userId: request.user!.id, vars: { user: await nick(request.user!.id), deed: task.deed.title, taskId: task.id } });
    publish(id, { type: "tasks", teamId: m.team.id });
    publish(id, { type: "quarry", teamId: m.team.id });
    publish(id, { type: "teams" });
    return { ok: true, stones: team.stones - 1 };
  });
}
