import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import { err } from "../services/i18n.js";
import { requireAdmin, requireMember } from "./teamMap.js";
import { adminOrObserver } from "../services/access.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { allStreaks, streakOf, summarize, userStreak } from "../services/awards.js";

/**
 * Зал наград (решение владельца 29.10): награды своей команды и личные, награды других команд, карточка участника
 * по нажатию на аватарку (фото, игровой ник, команда и роль, личные награды). Каталог наград лежит в @lotw/domain
 * и на клиенте тот же, сервер отдаёт только полученное: код, сколько раз, когда.
 */
/** Участник игры или её администратор (владелец 29.10: «почему админы не видят награды?!»): иначе 403. */
async function requireMemberOrAdmin(request: FastifyRequest, reply: FastifyReply, gameId: string): Promise<boolean> {
  const m = await prisma.membership.findFirst({ where: { userId: request.user!.id, team: { gameId } }, select: { teamId: true } });
  if (m) return true;
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { admins: { select: { userId: true } } } });
  if (game && adminOrObserver(request, game.admins)) return true;
  await reply.code(403).send({ error: "forbidden", message: err(request, "Вы не состоите в команде этой игры") });
  return false;
}

export async function awardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  /** Своя команда, свои награды, серия и список команд игры для просмотра чужих наград. */
  app.get("/api/games/:id/awards", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const userId = request.user!.id;
    const [teamRows, myRows, teams, counts, streak] = await Promise.all([
      prisma.awardGrant.findMany({ where: { gameId: id, teamId: m.team.id, userId: "" }, select: { code: true, at: true } }),
      prisma.awardGrant.findMany({ where: { gameId: id, userId }, select: { code: true, at: true } }),
      prisma.team.findMany({ where: { gameId: id }, orderBy: { index: "asc" }, select: { id: true, name: true, color: true, avatarId: true, status: true } }),
      prisma.awardGrant.groupBy({ by: ["teamId"], where: { gameId: id, userId: "" }, _count: { _all: true } }),
      userStreak(id, userId),
    ]);
    const countOf = new Map(counts.map((c) => [c.teamId, c._count._all]));
    return {
      teamId: m.team.id,
      team: summarize(teamRows),
      mine: summarize(myRows),
      streak,
      teams: teams.map((t) => ({ id: t.id, name: t.name, color: t.color, avatarId: t.avatarId, out: t.status !== "active", awards: countOf.get(t.id) ?? 0 })),
    };
  });

  /** Администратор: награды всех команд и всех участников с сериями (решение владельца 29.10: «для админа плитку награды тоже»). */
  app.get("/api/games/:id/awards/admin", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const [teams, members, grants, streaks] = await Promise.all([
      prisma.team.findMany({ where: { gameId: id }, orderBy: { index: "asc" }, select: { id: true, name: true, color: true, avatarId: true } }),
      prisma.membership.findMany({ where: { team: { gameId: id } }, select: { userId: true, teamId: true, role: true, gameRole: true, user: { select: { nickname: true, displayName: true, avatarId: true } } } }),
      prisma.awardGrant.findMany({ where: { gameId: id }, select: { teamId: true, userId: true, code: true, at: true } }),
      allStreaks(id),
    ]);
    const empty = streakOf(new Set(), "");
    const byTeam = new Map(teams.map((t) => [t.id, t]));
    return {
      teams: teams.map((t) => ({ ...t, awards: summarize(grants.filter((g) => g.teamId === t.id && g.userId === "")) })),
      members: members.map((m) => {
        const st = streaks.get(m.userId) ?? empty;
        return { userId: m.userId, name: m.user.displayName || m.user.nickname, avatarId: m.user.avatarId, team: byTeam.get(m.teamId) ?? null, role: m.role, gameRole: m.gameRole, streak: { current: st.current, best: st.best }, awards: summarize(grants.filter((g) => g.userId === m.userId)) };
      }).sort((a, b) => b.awards.reduce((x, g) => x + g.count, 0) - a.awards.reduce((x, g) => x + g.count, 0) || b.streak.current - a.streak.current),
    };
  });

  /** Награды другой команды той же игры. */
  app.get("/api/games/:id/awards/teams/:teamId", async (request, reply) => {
    const { id, teamId } = request.params as { id: string; teamId: string };
    if (!(await requireMemberOrAdmin(request, reply, id))) return;
    const team = await prisma.team.findFirst({ where: { id: teamId, gameId: id }, select: { id: true, name: true, color: true, avatarId: true } });
    if (!team) return reply.code(404).send({ error: "not_found", message: err(request, "Команда не найдена") });
    const rows = await prisma.awardGrant.findMany({ where: { gameId: id, teamId, userId: "" }, select: { code: true, at: true } });
    return { team, awards: summarize(rows) };
  });

  /** Карточка участника: видна любому участнику игры. Ник — игровой (как в списках команды), без почты. */
  app.get("/api/games/:id/members/:userId/card", async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    if (!(await requireMemberOrAdmin(request, reply, id))) return;
    const member = await prisma.membership.findFirst({ where: { userId, team: { gameId: id } }, select: { role: true, gameRole: true, user: { select: { nickname: true, displayName: true, avatarId: true } }, team: { select: { id: true, name: true, color: true } } } });
    if (!member) return reply.code(404).send({ error: "not_found", message: err(request, "Участник не найден") });
    const [rows, streak] = await Promise.all([
      prisma.awardGrant.findMany({ where: { gameId: id, userId }, select: { code: true, at: true } }),
      userStreak(id, userId),
    ]);
    return {
      name: member.user.displayName || member.user.nickname,
      avatarId: member.user.avatarId,
      team: member.team,
      role: member.role,
      gameRole: member.gameRole,
      awards: summarize(rows),
      streak: { current: streak.current, best: streak.best },
    };
  });
}
