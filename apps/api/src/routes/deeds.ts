import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";

export const DIRECTIONS = [
  "Молитва", "Молодёжные нужды братства", "Благовестие", "Посещение",
  "Помощь миссионерам и большим семьям", "Труд в лагерях и домах молитвы", "Педагогическое служение", "Финансовое участие",
] as const;

const deedBody = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(""),
  direction: z.enum(DIRECTIONS),
  proofType: z.enum(["REPORT", "PHOTO_LINK", "VIDEO_LINK", "CONFIRMATION"]).default("PHOTO_LINK"),
  canRepeat: z.boolean().default(false),
  bookCode: z.string().trim().min(3).max(3).nullable().optional(),
  difficulty: z.number().int().min(1).max(3).default(1),
});

async function requireGameAdmin(request: FastifyRequest, reply: FastifyReply, gameId: string) {
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { admins: { select: { userId: true } } } });
  if (!game) { await reply.code(404).send({ error: "not_found", message: "Игра не найдена" }); return null; }
  if (!game.admins.some((a) => a.userId === request.user!.id)) { await reply.code(403).send({ error: "forbidden", message: "Вы не администратор этой игры" }); return null; }
  return game;
}

/** Рекомендуемый минимум уникальных дел ≈ длина пути одной команды за игру (2.4 документа). */
export function recommendedDeedCount(nodeCount: number): number {
  return Math.max(40, Math.round(nodeCount * 0.35));
}

export async function deedRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  app.get("/api/games/:id/deeds", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return;
    const deeds = await prisma.deed.findMany({ where: { gameId: id }, orderBy: { createdAt: "asc" } });
    const settings = (game.settings ?? {}) as { nodeCount?: number };
    return { deeds, directions: DIRECTIONS, recommendedMin: recommendedDeedCount(settings.nodeCount ?? 250) };
  });

  app.post("/api/games/:id/deeds", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const body = deedBody.parse(request.body);
    const deed = await prisma.deed.create({ data: { ...body, gameId: id } });
    return reply.code(201).send({ deed });
  });

  app.put("/api/games/:id/deeds/:deedId", async (request, reply) => {
    const { id, deedId } = request.params as { id: string; deedId: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const body = deedBody.partial().parse(request.body);
    const exists = await prisma.deed.findFirst({ where: { id: deedId, gameId: id } });
    if (!exists) return reply.code(404).send({ error: "not_found", message: "Дело не найдено" });
    const deed = await prisma.deed.update({ where: { id: deedId }, data: body });
    return { deed };
  });

  app.delete("/api/games/:id/deeds/:deedId", async (request, reply) => {
    const { id, deedId } = request.params as { id: string; deedId: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    await prisma.deed.deleteMany({ where: { id: deedId, gameId: id } });
    return { ok: true };
  });

  /** Добавить стандартный набор дел как заготовку (из content/deeds-default.json). */
  app.post("/api/games/:id/deeds/import-default", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content/deeds-default.json");
    const items = z.array(deedBody).parse(JSON.parse(await readFile(file, "utf8")));
    const existing = new Set((await prisma.deed.findMany({ where: { gameId: id }, select: { title: true } })).map((d) => d.title.toLowerCase()));
    const fresh = items.filter((d) => !existing.has(d.title.toLowerCase()));
    await prisma.deed.createMany({ data: fresh.map((d) => ({ ...d, gameId: id })) });
    return { added: fresh.length };
  });
}
