import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { err } from "../services/i18n.js";

export const TEAM_COLORS = ["#A9553A", "#4F7C99", "#7D8B4E", "#8E5A9E", "#C48A3F", "#3B6E6E", "#B5473F", "#5C6E91", "#8A7A2E", "#6E4B8E", "#2F7F6F", "#9C5A2E"];

const createTeamBody = z.object({
  name: z.string().trim().min(2).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
const inviteBody = z.object({ role: z.enum(["CAPTAIN", "MEMBER"]).default("MEMBER"), uses: z.number().int().min(1).max(100).default(20), days: z.number().int().min(1).max(60).default(14) });
const memberPatch = z.object({ role: z.enum(["CAPTAIN", "MEMBER"]).optional(), gameRole: z.enum(["NONE", "SCOUT", "PROPHET", "AMBASSADOR", "CHRONICLER"]).optional() });

async function requireGameAdmin(request: FastifyRequest, reply: FastifyReply, gameId: string) {
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { admins: { select: { userId: true } } } });
  if (!game) { await reply.code(404).send({ error: "not_found", message: err(request, "Игра не найдена") }); return null; }
  if (!game.admins.some((a) => a.userId === request.user!.id)) { await reply.code(403).send({ error: "forbidden", message: err(request, "Вы не администратор этой игры") }); return null; }
  return game;
}

const memberSelect = { role: true, gameRole: true, joinedAt: true, user: { select: { id: true, nickname: true, displayName: true } } } as const;

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
    return { isAdmin, teams };
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

  app.patch("/api/games/:id/teams/:teamId/members/:userId", async (request, reply) => {
    const { id, teamId, userId } = request.params as { id: string; teamId: string; userId: string };
    const body = memberPatch.parse(request.body);
    const membership = await prisma.membership.findUnique({ where: { teamId_userId: { teamId, userId } }, include: { team: true } });
    if (!membership || membership.team.gameId !== id) return reply.code(404).send({ error: "not_found", message: err(request, "Участник не найден") });
    const game = await prisma.game.findUnique({ where: { id }, include: { admins: { select: { userId: true } } } });
    const isAdmin = game?.admins.some((a) => a.userId === request.user!.id) ?? false;
    const me = await prisma.membership.findUnique({ where: { teamId_userId: { teamId, userId: request.user!.id } } });
    const isCaptain = me?.role === "CAPTAIN";
    // Капитана назначает админ; игровые роли раздаёт капитан или админ.
    if (body.role !== undefined && !isAdmin) return reply.code(403).send({ error: "forbidden", message: err(request, "Капитана назначает администратор игры") });
    if (body.gameRole !== undefined && !isAdmin && !isCaptain) return reply.code(403).send({ error: "forbidden", message: err(request, "Игровые роли раздаёт капитан") });
    if (body.gameRole && body.gameRole !== "NONE" && membership.role === "CAPTAIN" && body.role !== "MEMBER") {
      return reply.code(409).send({ error: "conflict", message: err(request, "У капитана уже есть роль: игровые роли получают только участники") });
    }
    if (body.role === "CAPTAIN") body.gameRole = "NONE";
    if (body.gameRole && body.gameRole !== "NONE") {
      // Одна игровая роль — один участник.
      await prisma.membership.updateMany({ where: { teamId, gameRole: body.gameRole }, data: { gameRole: "NONE" } });
    }
    const updated = await prisma.membership.update({ where: { teamId_userId: { teamId, userId } }, data: body, select: memberSelect });
    publish(id, { type: "teams", teamId });
    return { member: updated };
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
