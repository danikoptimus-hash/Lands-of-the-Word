import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import { requireSuperadmin } from "./teamMap.js";

/**
 * Учётки платформы для администратора платформы (решение владельца 30.10: «раздел с учётками всех людей, которые
 * зарегались, что-то типа CRM: почта, никнейм, аватарка, в каких играх участвует»). Только чтение и только суперадмину;
 * ничего не выгружается файлом. Сверху те, кто заходил последним.
 */
export async function adminUserRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/admin/users", async (request, reply) => {
    if (!requireSuperadmin(request, reply)) return;
    const [users, deeds] = await Promise.all([
      prisma.user.findMany({
        orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        select: {
          id: true, nickname: true, displayName: true, email: true, emailVerified: true, googleId: true, locale: true, platformRole: true, avatarId: true, createdAt: true, lastSeenAt: true, lockedUntil: true,
          memberships: { select: { role: true, gameRole: true, joinedAt: true, team: { select: { id: true, name: true, color: true, avatarId: true, game: { select: { id: true, name: true, status: true } } } } } },
          gameAdmins: { select: { game: { select: { id: true, name: true, status: true } } } },
        },
      }),
      prisma.teamEdgeTask.groupBy({ by: ["takenById"], where: { status: "APPROVED", paved: false, takenById: { not: null } }, _count: { _all: true } }),
    ]);
    const deedsOf = new Map(deeds.map((d) => [d.takenById, d._count._all]));
    return {
      users: users.map((u) => ({
        id: u.id, nickname: u.nickname, displayName: u.displayName, email: u.email, emailVerified: u.emailVerified, google: Boolean(u.googleId), locale: u.locale, platformRole: u.platformRole, avatarId: u.avatarId,
        createdAt: u.createdAt, lastSeenAt: u.lastSeenAt, locked: Boolean(u.lockedUntil && u.lockedUntil > new Date()),
        deeds: deedsOf.get(u.id) ?? 0,
        memberships: u.memberships.map((m) => ({ role: m.role, gameRole: m.gameRole, joinedAt: m.joinedAt, team: { id: m.team.id, name: m.team.name, color: m.team.color, avatarId: m.team.avatarId }, game: m.team.game })),
        admins: u.gameAdmins.map((a) => a.game),
      })),
    };
  });
}
