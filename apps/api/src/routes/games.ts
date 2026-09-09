import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { generateMap, MapGenError } from "@lotw/domain";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";

const createBody = z.object({
  name: z.string().trim().min(2).max(80),
  orgName: z.string().trim().min(2).max(80).default("Моя церковь"),
  teamCount: z.number().int().min(2).max(12),
  settings: z
    .object({
      nodeCount: z.number().int().min(150).max(600).default(250),
      equidistantStarts: z.boolean().default(false),
      maxStartDistanceDiff: z.number().int().min(0).max(6).default(3),
    })
    .default({}),
});

const generateBody = z.object({ seed: z.number().int().min(0).max(2 ** 31 - 1).optional() });

async function loadGameForAdmin(request: FastifyRequest, reply: FastifyReply, gameId: string) {
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { admins: true } });
  if (!game) { await reply.code(404).send({ error: "not_found", message: "Игра не найдена" }); return null; }
  const isAdmin = game.admins.some((a) => a.userId === request.user!.id);
  if (!isAdmin) { await reply.code(403).send({ error: "forbidden", message: "Вы не администратор этой игры" }); return null; }
  return game;
}

export async function gameRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  app.get("/api/games", async (request) => {
    const games = await prisma.game.findMany({
      where: { admins: { some: { userId: request.user!.id } } },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, teamCount: true, mapSeed: true, createdAt: true, org: { select: { name: true } } },
    });
    return { games };
  });

  app.post("/api/games", async (request, reply) => {
    const body = createBody.parse(request.body);
    const game = await prisma.game.create({
      data: {
        name: body.name,
        teamCount: body.teamCount,
        settings: body.settings,
        org: { create: { name: body.orgName } },
        createdBy: { connect: { id: request.user!.id } },
        admins: { create: { userId: request.user!.id } },
      },
    });
    return reply.code(201).send({ game });
  });

  app.get("/api/games/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await loadGameForAdmin(request, reply, id);
    if (!game) return;
    const [nodes, edges] = await Promise.all([
      prisma.mapNode.findMany({ where: { gameId: id }, select: { key: true, q: true, r: true, kind: true, terrain: true, rotation: true, bookCode: true, cityType: true, teamIndex: true } }),
      prisma.mapEdge.findMany({ where: { gameId: id }, select: { aKey: true, bKey: true } }),
    ]);
    const { admins: _admins, ...rest } = game;
    return { game: rest, nodes, edges };
  });

  /** Генерация (или перегенерация) карты. Пока игра в статусе DRAFT — можно сколько угодно раз. */
  app.post("/api/games/:id/generate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await loadGameForAdmin(request, reply, id);
    if (!game) return;
    if (game.status !== "DRAFT") return reply.code(409).send({ error: "conflict", message: "Карта зафиксирована: игра уже начата" });
    const body = generateBody.parse(request.body ?? {});
    const settings = (game.settings ?? {}) as { nodeCount?: number; equidistantStarts?: boolean; maxStartDistanceDiff?: number };
    const seed = body.seed ?? Math.floor(Math.random() * 2 ** 31);

    let map;
    try {
      map = generateMap({ seed, teamCount: game.teamCount, nodeCount: settings.nodeCount, equidistantStarts: settings.equidistantStarts, maxStartDistanceDiff: settings.maxStartDistanceDiff });
    } catch (e) {
      if (e instanceof MapGenError) return reply.code(422).send({ error: "mapgen", message: e.message });
      throw e;
    }

    await prisma.$transaction([
      prisma.mapEdge.deleteMany({ where: { gameId: id } }),
      prisma.mapNode.deleteMany({ where: { gameId: id } }),
      prisma.mapNode.createMany({
        data: map.nodes.map((n) => ({
          gameId: id, key: n.id, q: n.q, r: n.r,
          kind: n.kind === "city" ? "CITY" : n.kind === "start" ? "START" : "EMPTY",
          terrain: n.terrain, rotation: n.rotation, bookCode: n.bookCode ?? null, cityType: n.cityType ?? null, teamIndex: n.teamIndex ?? null,
        })),
      }),
      prisma.mapEdge.createMany({ data: map.edges.map((e) => ({ gameId: id, aKey: e.a, bKey: e.b })) }),
      prisma.game.update({ where: { id }, data: { mapSeed: seed } }),
    ]);
    return { seed, stats: map.stats };
  });
}
