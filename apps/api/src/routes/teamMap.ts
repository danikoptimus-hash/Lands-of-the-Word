import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { getTeamMap, revealNode } from "../services/teamMap.js";
import { loadCityContent } from "../services/cities.js";
import { notifyAdmins, notifyUser } from "../services/notify.js";

const submitBody = z.object({
  links: z.array(z.string().trim().url().max(500)).max(10).default([]),
  note: z.string().trim().max(2000).default(""),
});
const decideBody = z.object({ approve: z.boolean(), comment: z.string().trim().max(1000).default("") });

export async function requireMember(request: FastifyRequest, reply: FastifyReply, gameId: string) {
  const m = await prisma.membership.findFirst({ where: { userId: request.user!.id, team: { gameId } }, include: { team: true } });
  if (!m) { await reply.code(403).send({ error: "forbidden", message: "Вы не состоите в команде этой игры" }); return null; }
  return m;
}
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply, gameId: string) {
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { admins: { select: { userId: true } } } });
  if (!game) { await reply.code(404).send({ error: "not_found", message: "Игра не найдена" }); return null; }
  if (!game.admins.some((a) => a.userId === request.user!.id)) { await reply.code(403).send({ error: "forbidden", message: "Вы не администратор этой игры" }); return null; }
  return game;
}

const taskInclude = {
  deed: { select: { id: true, title: true, description: true, direction: true, proofType: true, difficulty: true } },
  team: { select: { id: true, name: true, color: true } },
} as const;

export async function teamMapRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  /** Карта моей команды: открытые узлы, туман, рёбра, дела. */
  app.get("/api/games/:id/my-map", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const game = await prisma.game.findUniqueOrThrow({ where: { id }, select: { status: true, name: true } });
    if (game.status === "DRAFT") return { status: game.status, gameName: game.name, team: { id: m.team.id, name: m.team.name, color: m.team.color }, hexes: [], revealed: [], edges: [], tasks: [], cities: [] };
    const map = await getTeamMap(id, m.team.id);
    return { status: game.status, gameName: game.name, team: { id: m.team.id, name: m.team.name, color: m.team.color, startNodeKey: m.team.startNodeKey }, ...map };
  });

  app.post("/api/games/:id/edge-tasks/:taskId/take", async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const task = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, teamId: m.team.id } });
    if (!task) return reply.code(404).send({ error: "not_found", message: "Дело не найдено" });
    if (task.status !== "OPEN" && task.status !== "REJECTED") return reply.code(409).send({ error: "conflict", message: "Дело уже взято или сдано" });
    const updated = await prisma.teamEdgeTask.update({ where: { id: taskId }, data: { status: "TAKEN", takenById: request.user!.id }, include: taskInclude });
    publish(id, { type: "tasks", teamId: m.team.id });
    return { task: updated };
  });

  app.post("/api/games/:id/edge-tasks/:taskId/release", async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const task = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, teamId: m.team.id } });
    if (!task || task.status !== "TAKEN") return reply.code(409).send({ error: "conflict", message: "Дело не взято" });
    if (task.takenById !== request.user!.id && m.role !== "CAPTAIN") return reply.code(403).send({ error: "forbidden", message: "Отпустить дело может тот, кто взял, или капитан" });
    const updated = await prisma.teamEdgeTask.update({ where: { id: taskId }, data: { status: "OPEN", takenById: null }, include: taskInclude });
    publish(id, { type: "tasks", teamId: m.team.id });
    return { task: updated };
  });

  /** Сдача дела: ссылки на фото/видео и текст. Файлы не принимаем. */
  app.post("/api/games/:id/edge-tasks/:taskId/submit", async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const body = submitBody.parse(request.body);
    const task = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, teamId: m.team.id }, include: { deed: true } });
    if (!task) return reply.code(404).send({ error: "not_found", message: "Дело не найдено" });
    if (task.status === "SUBMITTED" || task.status === "APPROVED") return reply.code(409).send({ error: "conflict", message: "Дело уже сдано" });
    const needsLink = task.deed.proofType === "PHOTO_LINK" || task.deed.proofType === "VIDEO_LINK";
    if (needsLink && body.links.length === 0) return reply.code(400).send({ error: "validation", message: "Для этого дела нужна хотя бы одна ссылка на фото или видео" });
    if (!needsLink && body.links.length === 0 && body.note.length < 5) return reply.code(400).send({ error: "validation", message: "Опишите, что сделано" });
    const updated = await prisma.teamEdgeTask.update({
      where: { id: taskId },
      data: { status: "SUBMITTED", takenById: task.takenById ?? request.user!.id, links: body.links, note: body.note, submittedAt: new Date(), adminComment: "" },
      include: taskInclude,
    });
    publish(id, { type: "submissions", teamId: m.team.id });
    notifyAdmins(id, "новая сдача дела", `Команда «${m.team.name}» сдала дело «${task.deed.title}». Нужно проверить и одобрить или вернуть.`);
    return { task: updated };
  });

  /** Очередь сдач для админа. */
  app.get("/api/games/:id/submissions", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const status = ((request.query as { status?: string }).status ?? "SUBMITTED") as "SUBMITTED" | "APPROVED" | "REJECTED";
    const tasks = await prisma.teamEdgeTask.findMany({ where: { gameId: id, status }, include: taskInclude, orderBy: { submittedAt: "asc" }, take: 200 });
    const users = await prisma.user.findMany({ where: { id: { in: tasks.map((t) => t.takenById).filter((x): x is string => !!x) } }, select: { id: true, nickname: true, displayName: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return { tasks: tasks.map((t) => ({ ...t, takenBy: t.takenById ? byId.get(t.takenById) ?? null : null })) };
  });

  /** Решение админа: одобрить (узел за ребром открывается) или вернуть на доработку. */
  app.post("/api/games/:id/edge-tasks/:taskId/decide", async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const body = decideBody.parse(request.body);
    const task = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, gameId: id } });
    if (!task) return reply.code(404).send({ error: "not_found", message: "Сдача не найдена" });
    if (task.status !== "SUBMITTED") return reply.code(409).send({ error: "conflict", message: "Эта сдача уже рассмотрена" });
    const updated = await prisma.teamEdgeTask.update({
      where: { id: taskId },
      data: { status: body.approve ? "APPROVED" : "REJECTED", decidedAt: new Date(), decidedById: request.user!.id, adminComment: body.comment },
      include: taskInclude,
    });
    if (body.approve) await revealNode(id, task.teamId, task.toKey);
    else if (task.takenById) notifyUser(id, task.takenById, "дело вернули на доработку", `Администратор вернул дело «${updated.deed.title}».${body.comment ? ` Комментарий: ${body.comment}` : ""}`);
    publish(id, { type: "submissions", teamId: task.teamId });
    publish(id, { type: "tasks", teamId: task.teamId });
    return { task: updated };
  });

  /** Прогресс всех команд для карты админа: открытые узлы и пройденные рёбра по командам. */
  /** Админ (для тестов и разбора ситуаций): открыть команде узел; ведущая к нему сторона считается пройденной. */
  app.post("/api/games/:id/teams/:teamId/reveal", async (request, reply) => {
    const { id, teamId } = request.params as { id: string; teamId: string };
    const game = await requireAdmin(request, reply, id);
    if (!game) return;
    if (game.status !== "ACTIVE") return reply.code(409).send({ error: "conflict", message: "Игра не идёт" });
    const body = z.object({ nodeKey: z.string().min(3).max(40) }).parse(request.body);
    const [team, node] = await Promise.all([
      prisma.team.findFirst({ where: { id: teamId, gameId: id } }),
      prisma.mapNode.findUnique({ where: { gameId_key: { gameId: id, key: body.nodeKey } } }),
    ]);
    if (!team || !node) return reply.code(404).send({ error: "not_found", message: "Команда или узел не найдены" });
    const already = await prisma.teamNodeState.findUnique({ where: { teamId_nodeKey: { teamId, nodeKey: body.nodeKey } } });
    if (already) return reply.code(409).send({ error: "conflict", message: "Узел уже открыт этой команде" });
    const task = await prisma.teamEdgeTask.findFirst({ where: { teamId, toKey: body.nodeKey, status: { not: "APPROVED" } }, orderBy: { createdAt: "asc" } });
    if (task) await prisma.teamEdgeTask.update({ where: { id: task.id }, data: { status: "APPROVED", decidedAt: new Date(), decidedById: request.user!.id, adminComment: "Открыто администратором" } });
    await revealNode(id, teamId, body.nodeKey);
    publish(id, { type: "map", teamId });
    publish(id, { type: "tasks", teamId });
    return { ok: true, viaTask: Boolean(task) };
  });

  app.get("/api/games/:id/progress", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const teams = await prisma.team.findMany({
      where: { gameId: id },
      orderBy: { index: "asc" },
      select: { id: true, name: true, color: true, startNodeKey: true, nodeStates: { select: { nodeKey: true, revealedAt: true } }, edgeTasks: { where: { status: "APPROVED" }, select: { fromKey: true, toKey: true, decidedAt: true, createdAt: true } } },
    });
    const [pending, game] = await Promise.all([
      prisma.teamEdgeTask.count({ where: { gameId: id, status: "SUBMITTED" } }),
      prisma.game.findUnique({ where: { id }, select: { startedAt: true } }),
    ]);
    // Даты нужны для ползунка времени на карте админа: состояние на любой день игры.
    const cityStates = await prisma.teamCityState.findMany({ where: { gameId: id }, select: { teamId: true, nodeKey: true, orderSolved: true, doneTasks: true, capturedAt: true, isCapital: true } });
    const battles = await prisma.battle.findMany({ where: { gameId: id, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } }, select: { id: true, nodeKey: true, status: true, attackerId: true, defenderId: true, bid: true } });
    return {
      pending,
      startedAt: game?.startedAt ?? null,
      battles,
      cities: cityStates.map((s) => ({ teamId: s.teamId, nodeKey: s.nodeKey, orderSolved: s.orderSolved, done: s.doneTasks.length, capturedAt: s.capturedAt?.toISOString() ?? null, isCapital: s.isCapital })),
      teams: teams.map((t) => ({
        id: t.id, name: t.name, color: t.color, startNodeKey: t.startNodeKey,
        revealed: t.nodeStates.map((n) => n.nodeKey),
        revealedAt: t.nodeStates.map((n) => n.revealedAt.toISOString()),
        traversed: t.edgeTasks.map((e) => ({ fromKey: e.fromKey, toKey: e.toKey, at: (e.decidedAt ?? e.createdAt).toISOString() })),
      })),
    };
  });
}
