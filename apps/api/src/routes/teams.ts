import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { err, msg } from "../services/i18n.js";
import { notifyAdmins, notifyTeam, notifyUser } from "../services/notify.js";
import { ensureFrontier, penalizeTeam } from "../services/teamMap.js";
import { days, rulesOf } from "../services/rules.js";
import { journal, nick, ROLE_RU } from "../services/journal.js";

export const TEAM_COLORS = ["#A9553A", "#4F7C99", "#7D8B4E", "#8E5A9E", "#C48A3F", "#3B6E6E", "#B5473F", "#5C6E91", "#8A7A2E", "#6E4B8E", "#2F7F6F", "#9C5A2E"];

const createTeamBody = z.object({
  name: z.string().trim().min(2).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
const inviteBody = z.object({ role: z.enum(["CAPTAIN", "MEMBER"]).default("MEMBER"), uses: z.number().int().min(1).max(100).default(20), days: z.number().int().min(1).max(60).default(14) });
const GAME_ROLES = ["NONE", "SCOUT", "PROPHET", "AMBASSADOR", "CHRONICLER", "HELMSMAN"] as const;
const memberPatch = z.object({ role: z.enum(["CAPTAIN", "DEPUTY", "MEMBER"]).optional(), gameRole: z.enum(GAME_ROLES).optional() });

async function requireGameAdmin(request: FastifyRequest, reply: FastifyReply, gameId: string) {
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { admins: { select: { userId: true } } } });
  if (!game) { await reply.code(404).send({ error: "not_found", message: err(request, "Игра не найдена") }); return null; }
  if (!game.admins.some((a) => a.userId === request.user!.id)) { await reply.code(403).send({ error: "forbidden", message: err(request, "Вы не администратор этой игры") }); return null; }
  return game;
}

const memberSelect = { role: true, gameRole: true, pendingRole: true, joinedAt: true, user: { select: { id: true, nickname: true, displayName: true } } } as const;

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  /** Команды игры. Админ видит все с участниками; участник — только свою. */
  app.get("/api/games/:id/teams", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await prisma.game.findUnique({ where: { id }, include: { admins: { select: { userId: true } } } });
    if (!game) return reply.code(404).send({ error: "not_found", message: err(request, "Игра не найдена") });
    const isAdmin = game.admins.some((a) => a.userId === request.user!.id);
    const teams = await prisma.team.findMany({
      where: isAdmin ? { gameId: id } : { gameId: id, members: { some: { userId: request.user!.id } } },
      orderBy: { index: "asc" },
      include: { members: { select: memberSelect, orderBy: { joinedAt: "asc" } } },
    });
    if (!isAdmin && teams.length === 0) return reply.code(403).send({ error: "forbidden", message: err(request, "Вы не состоите в этой игре") });
    const rules = rulesOf(game.settings);
    return { isAdmin, roleChangeDays: rules.roleChangeDays, teams: teams.map((t) => ({ ...t, roleChangeAvailableAt: t.lastRoleChangeAt && rules.roleChangeDays > 0 ? new Date(t.lastRoleChangeAt.getTime() + days(rules.roleChangeDays)) : null })) };
  });

  app.post("/api/games/:id/teams", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return;
    const body = createTeamBody.parse(request.body);
    const count = await prisma.team.count({ where: { gameId: id } });
    if (count >= game.teamCount) return reply.code(409).send({ error: "conflict", message: err(request, "Все команды уже созданы: по настройкам их {n}", { n: game.teamCount }) });
    const dup = await prisma.team.findFirst({ where: { gameId: id, name: { equals: body.name, mode: "insensitive" } } });
    if (dup) return reply.code(409).send({ error: "conflict", message: err(request, "Команда с таким названием уже есть") });
    const team = await prisma.team.create({
      data: { gameId: id, index: count, name: body.name, color: body.color ?? TEAM_COLORS[count % TEAM_COLORS.length]! },
      include: { members: { select: memberSelect } },
    });
    publish(id, { type: "teams" });
    return reply.code(201).send({ team });
  });

  app.delete("/api/games/:id/teams/:teamId", async (request, reply) => {
    const { id, teamId } = request.params as { id: string; teamId: string };
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return;
    if (game.status !== "DRAFT") return reply.code(409).send({ error: "conflict", message: err(request, "Игра уже начата: команды удалять нельзя") });
    const team = await prisma.team.findFirst({ where: { id: teamId, gameId: id } });
    if (!team) return reply.code(404).send({ error: "not_found", message: err(request, "Команда не найдена") });
    await prisma.team.delete({ where: { id: teamId } });
    // Переиндексация, чтобы индексы команд снова шли подряд (индекс = стартовая точка на карте).
    const rest = await prisma.team.findMany({ where: { gameId: id }, orderBy: { index: "asc" } });
    await prisma.$transaction(rest.map((t, i) => prisma.team.update({ where: { id: t.id }, data: { index: i } })));
    publish(id, { type: "teams" });
    return { ok: true };
  });

  /** Ссылка-приглашение в команду. Выдаёт админ игры. */
  app.post("/api/games/:id/teams/:teamId/invites", async (request, reply) => {
    const { id, teamId } = request.params as { id: string; teamId: string };
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return;
    const team = await prisma.team.findFirst({ where: { id: teamId, gameId: id } });
    if (!team) return reply.code(404).send({ error: "not_found", message: err(request, "Команда не найдена") });
    const body = inviteBody.parse(request.body ?? {});
    const invite = await prisma.invite.create({
      data: { id: randomBytes(18).toString("base64url"), gameId: id, teamId, role: body.role, usesLeft: body.uses, expiresAt: new Date(Date.now() + body.days * 86400_000) },
    });
    return reply.code(201).send({ invite: { token: invite.id, role: invite.role, usesLeft: invite.usesLeft, expiresAt: invite.expiresAt, path: `/join/${invite.id}` } });
  });

  /**
   * Роли (решение владельца 18.09): капитана назначает администратор; заместителя — капитан; игровые роли капитан
   * запрашивает, администратор одобряет, смена — не чаще раза в неделю (по правилам игры). Администратор ставит роли сразу.
   */
  app.patch("/api/games/:id/teams/:teamId/members/:userId", async (request, reply) => {
    const { id, teamId, userId } = request.params as { id: string; teamId: string; userId: string };
    const body = memberPatch.parse(request.body);
    const membership = await prisma.membership.findUnique({ where: { teamId_userId: { teamId, userId } }, include: { team: true } });
    if (!membership || membership.team.gameId !== id) return reply.code(404).send({ error: "not_found", message: err(request, "Участник не найден") });
    const game = await prisma.game.findUnique({ where: { id }, include: { admins: { select: { userId: true } } } });
    const isAdmin = game?.admins.some((a) => a.userId === request.user!.id) ?? false;
    const me = await prisma.membership.findUnique({ where: { teamId_userId: { teamId, userId: request.user!.id } } });
    const isCaptain = me?.role === "CAPTAIN";
    const rules = rulesOf(game?.settings);
    if (body.role === "CAPTAIN" && !isAdmin) return reply.code(403).send({ error: "forbidden", message: err(request, "Капитана назначает администратор игры") });
    if (body.role !== undefined && body.role !== "CAPTAIN" && !isAdmin && !isCaptain) return reply.code(403).send({ error: "forbidden", message: err(request, "Заместителя назначает капитан") });
    if (body.role !== undefined && body.role !== "CAPTAIN" && membership.role === "CAPTAIN" && !isAdmin) return reply.code(403).send({ error: "forbidden", message: err(request, "Снять капитана может только администратор") });
    if (body.gameRole !== undefined && !isAdmin && !isCaptain) return reply.code(403).send({ error: "forbidden", message: err(request, "Игровые роли раздаёт капитан") });
    if (body.gameRole && body.gameRole !== "NONE" && membership.role === "CAPTAIN" && body.role !== "MEMBER") {
      return reply.code(409).send({ error: "conflict", message: err(request, "У капитана уже есть роль: игровые роли получают только участники") });
    }
    if (body.role === "CAPTAIN") body.gameRole = "NONE";
    if (body.role === "DEPUTY") await prisma.membership.updateMany({ where: { teamId, role: "DEPUTY" }, data: { role: "MEMBER" } }); // один заместитель
    // Игровая роль от капитана — запрос администратору, не чаще раза в неделю.
    if (body.gameRole !== undefined && !isAdmin) {
      if (membership.team.lastRoleChangeAt && rules.roleChangeDays > 0 && Date.now() - membership.team.lastRoleChangeAt.getTime() < days(rules.roleChangeDays)) {
        return reply.code(429).send({ error: "cooldown", message: err(request, "Роли меняются не чаще раза в {n} дн.; следующая смена — {date}", { n: rules.roleChangeDays, date: new Date(membership.team.lastRoleChangeAt.getTime() + days(rules.roleChangeDays)).toLocaleDateString("ru-RU") }) });
      }
      const pending = await prisma.membership.update({ where: { teamId_userId: { teamId, userId } }, data: { ...(body.role ? { role: body.role } : {}), pendingRole: body.gameRole }, select: memberSelect });
      publish(id, { type: "teams", teamId });
      notifyAdmins(id, "запрос смены роли в команде «{team}»", "Капитан команды «{team}» просит назначить роль участнику. Одобрите или отклоните в блоке «Команды».", { team: membership.team.name });
      return { member: pending, pending: true };
    }
    if (body.gameRole && body.gameRole !== "NONE") {
      // Одна игровая роль — один участник.
      await prisma.membership.updateMany({ where: { teamId, gameRole: body.gameRole }, data: { gameRole: "NONE" } });
    }
    const updated = await prisma.membership.update({ where: { teamId_userId: { teamId, userId } }, data: { ...body, ...(body.gameRole !== undefined ? { pendingRole: null } : {}) }, select: memberSelect });
    if (body.gameRole !== undefined) await prisma.team.update({ where: { id: teamId }, data: { lastRoleChangeAt: new Date() } });
    publish(id, { type: "teams", teamId });
    return { member: updated };
  });

  /** Администратор одобряет или отклоняет запрошенную капитаном роль. */
  app.post("/api/games/:id/teams/:teamId/members/:userId/role-decide", async (request, reply) => {
    const { id, teamId, userId } = request.params as { id: string; teamId: string; userId: string };
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return;
    const body = z.object({ approve: z.boolean() }).parse(request.body);
    const membership = await prisma.membership.findUnique({ where: { teamId_userId: { teamId, userId } }, include: { team: true } });
    if (!membership || membership.team.gameId !== id || !membership.pendingRole) return reply.code(404).send({ error: "not_found", message: err(request, "Запрос роли не найден") });
    if (body.approve) {
      if (membership.pendingRole !== "NONE") await prisma.membership.updateMany({ where: { teamId, gameRole: membership.pendingRole }, data: { gameRole: "NONE" } });
      await prisma.$transaction([
        prisma.membership.update({ where: { teamId_userId: { teamId, userId } }, data: { gameRole: membership.pendingRole, pendingRole: null } }),
        prisma.team.update({ where: { id: teamId }, data: { lastRoleChangeAt: new Date() } }),
      ]);
      journal(id, "role_changed", { teamId, userId, vars: { user: await nick(userId), role: ROLE_RU[membership.pendingRole] ?? membership.pendingRole } });
    } else await prisma.membership.update({ where: { teamId_userId: { teamId, userId } }, data: { pendingRole: null } });
    publish(id, { type: "teams", teamId });
    notifyTeam(id, teamId, body.approve ? "роль назначена" : "смена роли отклонена", body.approve ? "Администратор одобрил смену роли в команде." : "Администратор не одобрил смену роли в команде.");
    return { ok: true };
  });

  /** Администратор переводит участника в другую команду (по спискам молодёжного совета; выбывшие команды — так же). */
  app.post("/api/games/:id/teams/:teamId/members/:userId/move", async (request, reply) => {
    const { id, teamId, userId } = request.params as { id: string; teamId: string; userId: string };
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return;
    const body = z.object({ toTeamId: z.string().min(1) }).parse(request.body);
    const [membership, to] = await Promise.all([
      prisma.membership.findUnique({ where: { teamId_userId: { teamId, userId } }, include: { team: true } }),
      prisma.team.findFirst({ where: { id: body.toTeamId, gameId: id } }),
    ]);
    if (!membership || membership.team.gameId !== id || !to) return reply.code(404).send({ error: "not_found", message: err(request, "Участник или команда не найдены") });
    if (to.id === teamId) return reply.code(409).send({ error: "conflict", message: err(request, "Участник уже в этой команде") });
    if (to.status === "defeated") return reply.code(409).send({ error: "conflict", message: err(request, "Эта команда выбыла из игры") });
    await prisma.$transaction([
      prisma.teamEdgeTask.updateMany({ where: { teamId, takenById: userId, status: "TAKEN" }, data: { status: "OPEN", takenById: null, takenAt: null } }),
      prisma.membership.delete({ where: { teamId_userId: { teamId, userId } } }),
      prisma.membership.create({ data: { teamId: to.id, userId, role: "MEMBER", gameRole: "NONE" } }),
    ]);
    if (game.status === "ACTIVE") await ensureFrontier(id, to.id);
    publish(id, { type: "teams", teamId });
    publish(id, { type: "teams", teamId: to.id });
    notifyUser(id, userId, "вы переведены в команду «{team}»", "Администратор перевёл вас в команду «{team}». Откройте карту команды.", { team: to.name });
    return { ok: true };
  });

  /** Штраф администратора (телефон на собрании): игра сама аннулирует случайный концевой участок пути команды. */
  app.post("/api/games/:id/teams/:teamId/penalty", async (request, reply) => {
    const { id, teamId } = request.params as { id: string; teamId: string };
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return;
    if (game.status !== "ACTIVE") return reply.code(409).send({ error: "conflict", message: err(request, "Игра не идёт") });
    const team = await prisma.team.findFirst({ where: { id: teamId, gameId: id } });
    if (!team) return reply.code(404).send({ error: "not_found", message: err(request, "Команда не найдена") });
    const res = await penalizeTeam(id, teamId, request.user!.id);
    if (res) journal(id, "penalty", { teamId });
    if (!res) return reply.code(409).send({ error: "conflict", message: err(request, "У команды нет концевых участков пути: штраф наложить не на что") });
    return { ok: true, ...res, message: msg("ru", "Аннулирован участок {from} → {to}", { from: res.fromKey, to: res.toKey }) };
  });

  /** Штрафы команды (администратору). */
  app.get("/api/games/:id/penalties", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const rows = await prisma.teamPenalty.findMany({ where: { gameId: id }, orderBy: { createdAt: "desc" }, take: 100, include: { team: { select: { id: true, name: true, color: true } } } });
    return { penalties: rows };
  });

  app.delete("/api/games/:id/teams/:teamId/members/:userId", async (request, reply) => {
    const { id, teamId, userId } = request.params as { id: string; teamId: string; userId: string };
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return;
    await prisma.membership.deleteMany({ where: { teamId, userId, team: { gameId: id } } });
    publish(id, { type: "teams", teamId });
    return { ok: true };
  });

  /** Информация о приглашении (для страницы /join/:token). */
  app.get("/api/invites/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const invite = await prisma.invite.findUnique({ where: { id: token }, include: { team: { select: { id: true, name: true, color: true } }, game: { select: { id: true, name: true, status: true, org: { select: { name: true } } } } } });
    if (!invite || invite.expiresAt < new Date() || invite.usesLeft <= 0) return reply.code(404).send({ error: "not_found", message: err(request, "Приглашение не найдено или истекло") });
    const already = await prisma.membership.findFirst({ where: { userId: request.user!.id, team: { gameId: invite.gameId } }, include: { team: { select: { id: true, name: true } } } });
    return { invite: { role: invite.role, team: invite.team, game: invite.game }, alreadyIn: already ? already.team : null };
  });

  /** Принять приглашение: вступить в команду. Одна игра — одна команда на человека. */
  app.post("/api/invites/:token/accept", async (request, reply) => {
    const { token } = request.params as { token: string };
    const invite = await prisma.invite.findUnique({ where: { id: token } });
    if (!invite || invite.expiresAt < new Date() || invite.usesLeft <= 0) return reply.code(404).send({ error: "not_found", message: err(request, "Приглашение не найдено или истекло") });
    const already = await prisma.membership.findFirst({ where: { userId: request.user!.id, team: { gameId: invite.gameId } } });
    if (already) return reply.code(409).send({ error: "conflict", message: err(request, "Вы уже состоите в команде этой игры") });
    const [membership] = await prisma.$transaction([
      prisma.membership.create({ data: { teamId: invite.teamId, userId: request.user!.id, role: invite.role }, include: { team: { select: { id: true, name: true, color: true, gameId: true } } } }),
      prisma.invite.update({ where: { id: token }, data: { usesLeft: { decrement: 1 } } }),
    ]);
    publish(invite.gameId, { type: "teams", teamId: invite.teamId });
    return reply.code(201).send({ team: membership.team, role: membership.role });
  });

  /** Мои команды по всем играм (для главной страницы участника). */
  app.get("/api/me/teams", async (request) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: request.user!.id },
      include: { team: { select: { id: true, name: true, color: true, game: { select: { id: true, name: true, status: true, org: { select: { name: true } } } } } } },
      orderBy: { joinedAt: "desc" },
    });
    return { teams: memberships.map((m) => ({ role: m.role, gameRole: m.gameRole, team: { id: m.team.id, name: m.team.name, color: m.team.color }, game: m.team.game })) };
  });
}
