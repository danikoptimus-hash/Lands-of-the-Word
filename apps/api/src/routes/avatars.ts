import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { isAvatarCode, isCrestCode } from "@lotw/domain";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import { err } from "../services/i18n.js";
import { publish } from "../services/events.js";

/**
 * Аватарки и гербы (решение владельца 14.11): участник выбирает аватарку из готового набора игры, капитан — герб
 * команды. Своих фото игра не принимает: загрузки, проверки уместности и хранения картинок нет — в базе только код
 * готовой картинки (packages/domain/src/avatars.ts). null — без аватарки: кружок с первой буквой.
 */
const body = z.object({ avatarId: z.string().max(8).nullable() });

export async function avatarRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  /** Своя аватарка. */
  app.put("/api/auth/me/avatar", async (request, reply) => {
    const { avatarId } = body.parse(request.body);
    if (avatarId !== null && !isAvatarCode(avatarId)) return reply.code(400).send({ error: "validation", message: err(request, "Такой аватарки в наборе нет") });
    await prisma.user.update({ where: { id: request.user!.id }, data: { avatarId } });
    await announceUser(request.user!.id);
    return { avatarId };
  });

  /** Герб команды: только капитан. */
  app.put("/api/games/:id/teams/:teamId/avatar", async (request, reply) => {
    const { id, teamId } = request.params as { id: string; teamId: string };
    if (!(await captainOf(request, reply, id, teamId))) return;
    const { avatarId } = body.parse(request.body);
    if (avatarId !== null && !isCrestCode(avatarId)) return reply.code(400).send({ error: "validation", message: err(request, "Такого герба в наборе нет") });
    await prisma.team.update({ where: { id: teamId }, data: { avatarId } });
    publish(id, { type: "teams" });
    return { avatarId };
  });
}

async function captainOf(request: FastifyRequest, reply: FastifyReply, gameId: string, teamId: string): Promise<boolean> {
  const m = await prisma.membership.findFirst({ where: { userId: request.user!.id, teamId, team: { gameId } }, select: { role: true } });
  if (!m) { await reply.code(404).send({ error: "not_found", message: err(request, "Команда не найдена") }); return false; }
  if (m.role !== "CAPTAIN") { await reply.code(403).send({ error: "forbidden", message: err(request, "Герб команды выбирает капитан") }); return false; }
  return true;
}
/** Товарищи по командам видят новую аватарку сразу: событие «состав» в каждой игре участника. */
async function announceUser(userId: string): Promise<void> {
  const ms = await prisma.membership.findMany({ where: { userId }, select: { teamId: true, team: { select: { gameId: true } } } });
  for (const m of ms) publish(m.team.gameId, { type: "teams", teamId: m.teamId });
}
