import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import { err } from "../services/i18n.js";
import { isLeader, requireActiveMember, requireAdmin, requireMember } from "./teamMap.js";
import { activityBoard, feed, seasonBook, sendChronicle, serviceStats } from "../services/journal.js";
import { breakPeace, decidePeace, peaceView, proposePeace } from "../services/peace.js";

/** Лента команды, «Моё служение», доска активности и журнал для администратора, «Книга сезона», летопись, мир. */
export async function journalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  /** Лента «Что случилось»: события своей команды и новости для всех. */
  app.get("/api/games/:id/feed", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    return { items: await feed(id, m.team.id) };
  });

  /** «Моё служение»: сводка участника. */
  app.get("/api/games/:id/my-service", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    return await serviceStats(id, request.user!.id, m.team.id);
  });

  /** Администратор: доска активности участников. */
  /**
   * Общий топ участников для всех игроков (решение владельца 30.09): те же числа, что на доске активности администратора,
   * но без роли и времени последней активности. Отдаются первые 10 и строка самого игрока с его местом.
   */
  app.get("/api/games/:id/top", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const rows = (await activityBoard(id)).map((r, i) => ({ rank: i + 1, userId: r.userId, name: r.displayName || r.nickname, team: r.team, color: r.color, deeds: r.deeds, tasks: r.tasks + r.orders, cities: r.cities, verses: r.verses, trips: r.trips }));
    const me = rows.find((r) => r.userId === request.user!.id) ?? null;
    return { rows: rows.slice(0, 10), me, total: rows.length };
  });

  app.get("/api/games/:id/activity", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    return { rows: await activityBoard(id) };
  });

  /** Администратор: журнал событий игры. */
  app.get("/api/games/:id/journal", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const rows = await prisma.journal.findMany({ where: { gameId: id }, orderBy: { createdAt: "desc" }, take: 200 });
    const teams = await prisma.team.findMany({ where: { gameId: id }, select: { id: true, name: true, color: true } });
    // Отчёт по делу из летописи (решение владельца 30.09): у новых записей id дела лежит в vars.taskId; у старых — ищем
    // последнюю сдачу этой команды с таким названием дела.
    const deedKinds = new Set(["deed_submitted", "deed_approved", "deed_returned"]);
    const need = rows.filter((r) => deedKinds.has(r.kind) && !(r.vars as Record<string, unknown>).taskId && r.teamId);
    const byTeamTitle = new Map<string, string>();
    if (need.length) {
      const tasks = await prisma.teamEdgeTask.findMany({ where: { gameId: id, teamId: { in: [...new Set(need.map((r) => r.teamId!))] }, status: { not: "OPEN" } }, select: { id: true, teamId: true, submittedAt: true, deed: { select: { title: true } } }, orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }] });
      for (const tk of tasks) { const k = `${tk.teamId}|${tk.deed.title}`; if (!byTeamTitle.has(k)) byTeamTitle.set(k, tk.id); }
    }
    const taskIdOf = (r: (typeof rows)[number]) => {
      if (!deedKinds.has(r.kind)) return null;
      const v = r.vars as Record<string, unknown>;
      return typeof v.taskId === "string" ? v.taskId : byTeamTitle.get(`${r.teamId}|${String(v.deed ?? "")}`) ?? null;
    };
    return { items: rows.map((r) => ({ id: r.id, kind: r.kind, vars: r.vars, text: r.text, everyone: r.everyone, teamId: r.teamId, at: r.createdAt.getTime(), taskId: taskIdOf(r) })), teams };
  });

  /** Администратор: разослать летопись за последние 7 дней сейчас. */
  app.post("/api/games/:id/chronicle", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await requireAdmin(request, reply, id);
    if (!game) return;
    if (game.status !== "ACTIVE") return reply.code(409).send({ error: "conflict", message: err(request, "Игра не идёт") });
    return { lines: await sendChronicle(id) };
  });

  /** «Книга сезона»: администратору — всегда, участникам — после завершения игры (итоги видят все, решение владельца 19.09). */
  app.get("/api/games/:id/season-book", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await prisma.game.findUnique({ where: { id }, select: { status: true, admins: { select: { userId: true } }, teams: { select: { members: { select: { userId: true } } } } } });
    if (!game) return reply.code(404).send({ error: "not_found", message: err(request, "Игра не найдена") });
    const uid = request.user!.id;
    const isAdmin = game.admins.some((a) => a.userId === uid);
    const isMember = game.teams.some((t) => t.members.some((m) => m.userId === uid));
    if (!isAdmin && !(isMember && game.status === "FINISHED")) return reply.code(403).send({ error: "forbidden", message: err(request, isMember ? "Книга сезона откроется участникам после завершения игры" : "Нет доступа") });
    return await seasonBook(id);
  });

  /** Мир: отношения с другими командами. */
  app.get("/api/games/:id/peace", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    return { canSpeak: isLeader(m) || m.gameRole === "AMBASSADOR", teams: await peaceView(id, m.team.id) };
  });
  app.post("/api/games/:id/peace", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    if (!isLeader(m) && m.gameRole !== "AMBASSADOR") return reply.code(403).send({ error: "forbidden", message: err(request, "Мир предлагает капитан, заместитель или посол") });
    const body = z.object({ teamId: z.string().min(1) }).parse(request.body);
    const r = await proposePeace(id, m.team.id, body.teamId);
    if (!r.ok) return reply.code(409).send({ error: "conflict", message: err(request, r.message, r.vars) });
    return { ok: true };
  });
  app.post("/api/games/:id/peace/:peaceId/:action", async (request, reply) => {
    const { id, peaceId, action } = request.params as { id: string; peaceId: string; action: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    if (!isLeader(m) && m.gameRole !== "AMBASSADOR") return reply.code(403).send({ error: "forbidden", message: err(request, "Решение о мире принимает капитан, заместитель или посол") });
    const r = action === "accept" ? await decidePeace(id, peaceId, m.team.id, true) : action === "decline" ? await decidePeace(id, peaceId, m.team.id, false) : action === "break" ? await breakPeace(id, peaceId, m.team.id) : null;
    if (!r) return reply.code(404).send({ error: "not_found", message: err(request, "Действие не найдено") });
    if (!r.ok) return reply.code(409).send({ error: "conflict", message: err(request, r.message, r.vars) });
    return { ok: true };
  });
}
