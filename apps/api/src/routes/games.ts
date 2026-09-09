import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { generateMap, MapGenError } from "@lotw/domain";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { recommendedDeedCount } from "./deeds.js";
import { makeCityKey } from "../services/cities.js";
import { ensureFrontier } from "../services/teamMap.js";

const createBody = z.object({
  name: z.string().trim().min(2).max(80),
  orgName: z.string().trim().min(2).max(80).default("Моя церковь"),
  teamCount: z.number().int().min(2).max(12),
  settings: z
    .object({
      nodeCount: z.number().int().min(200).max(600).default(250),
      equidistantStarts: z.boolean().default(false),
      maxStartDistanceDiff: z.number().int().min(0).max(6).default(3),
      includeGenealogies: z.boolean().default(false),
    })
    .default({}),
});

const generateBody = z.object({ seed: z.number().int().min(0).max(2 ** 31 - 1).optional() });

const patchBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  teamCount: z.number().int().min(2).max(12).optional(),
  settings: z
    .object({
      nodeCount: z.number().int().min(200).max(600).optional(),
      equidistantStarts: z.boolean().optional(),
      maxStartDistanceDiff: z.number().int().min(0).max(6).optional(),
      includeGenealogies: z.boolean().optional(),
    })
    .optional(),
});

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

  /** Настройки игры можно менять только до старта. Если меняется число команд — карту надо перегенерировать. */
  app.patch("/api/games/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await loadGameForAdmin(request, reply, id);
    if (!game) return;
    if (game.status !== "DRAFT") return reply.code(409).send({ error: "conflict", message: "Игра уже начата, настройки зафиксированы" });
    const body = patchBody.parse(request.body);
    if (body.teamCount !== undefined) {
      const teams = await prisma.team.count({ where: { gameId: id } });
      if (teams > body.teamCount) return reply.code(409).send({ error: "conflict", message: `Уже создано команд: ${teams}. Сначала удалите лишние` });
    }
    const settings = { ...((game.settings ?? {}) as Record<string, unknown>), ...(body.settings ?? {}) };
    const updated = await prisma.game.update({ where: { id }, data: { name: body.name, teamCount: body.teamCount, settings } });
    publish(id, { type: "game" });
    return { game: updated };
  });

  app.get("/api/games/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await loadGameForAdmin(request, reply, id);
    if (!game) return;
    const [hexes, nodes, edges] = await Promise.all([
      prisma.mapHex.findMany({ where: { gameId: id }, select: { q: true, r: true, terrain: true, rotation: true } }),
      prisma.mapNode.findMany({ where: { gameId: id }, select: { key: true, corner: true, q: true, r: true, kind: true, bookCode: true, cityType: true, teamIndex: true } }),
      prisma.mapEdge.findMany({ where: { gameId: id }, select: { aKey: true, bKey: true } }),
    ]);
    const { admins: _admins, ...rest } = game;
    return { game: rest, hexes, nodes, edges };
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
      prisma.mapHex.deleteMany({ where: { gameId: id } }),
      prisma.mapHex.createMany({ data: map.hexes.map((h) => ({ gameId: id, q: h.q, r: h.r, terrain: h.terrain, rotation: h.rotation })) }),
      prisma.mapNode.createMany({
        data: map.nodes.map((n) => ({
          gameId: id, key: n.id, corner: n.corner, q: n.q, r: n.r,
          kind: n.kind === "city" ? "CITY" : n.kind === "start" ? "START" : "EMPTY",
          bookCode: n.bookCode ?? null, cityType: n.cityType ?? null, teamIndex: n.teamIndex ?? null,
        })),
      }),
      prisma.mapEdge.createMany({ data: map.edges.map((e) => ({ gameId: id, aKey: e.a, bKey: e.b })) }),
      prisma.game.update({ where: { id }, data: { mapSeed: seed } }),
    ]);
    publish(id, { type: "map" });
    return { seed, stats: map.stats };
  });

  /** Готовность к старту: что ещё не сделано. */
  app.get("/api/games/:id/readiness", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await loadGameForAdmin(request, reply, id);
    if (!game) return;
    const [starts, teams, deeds] = await Promise.all([
      prisma.mapNode.count({ where: { gameId: id, kind: "START" } }),
      prisma.team.findMany({ where: { gameId: id }, include: { _count: { select: { members: true } } } }),
      prisma.deed.count({ where: { gameId: id } }),
    ]);
    const settings = (game.settings ?? {}) as { nodeCount?: number };
    const recommended = recommendedDeedCount(settings.nodeCount ?? 250);
    const problems: string[] = [];
    if (starts === 0) problems.push("Карта не сгенерирована");
    else if (starts !== game.teamCount) problems.push(`На карте ${starts} стартовых точек, а команд по настройкам ${game.teamCount}: перегенерируйте карту`);
    if (teams.length < game.teamCount) problems.push(`Создано команд: ${teams.length} из ${game.teamCount}. Добавьте команду или уменьшите число команд в настройках`);
    const empty = teams.filter((t) => t._count.members === 0).map((t) => t.name);
    if (empty.length) problems.push(`Команды без участников: ${empty.join(", ")}`);
    const warnings: string[] = [];
    if (deeds < recommended) warnings.push(`Дел в списке ${deeds}, рекомендуется не меньше ${recommended}: дела начнут повторяться`);
    if (deeds === 0) problems.push("Список дел пуст");
    return { canStart: problems.length === 0, problems, warnings };
  });

  /** Старт игры: карта фиксируется, командам назначаются стартовые точки, статус ACTIVE. */
  app.post("/api/games/:id/start", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await loadGameForAdmin(request, reply, id);
    if (!game) return;
    if (game.status !== "DRAFT") return reply.code(409).send({ error: "conflict", message: "Игра уже начата" });
    const readiness = await app.inject({ method: "GET", url: `/api/games/${id}/readiness`, headers: { cookie: request.headers.cookie ?? "" } });
    const r = readiness.json() as { canStart: boolean; problems: string[] };
    if (!r.canStart) return reply.code(409).send({ error: "not_ready", message: r.problems.join("; ") });
    const [starts, teams] = await Promise.all([
      prisma.mapNode.findMany({ where: { gameId: id, kind: "START" }, orderBy: { teamIndex: "asc" } }),
      prisma.team.findMany({ where: { gameId: id }, orderBy: { index: "asc" } }),
    ]);
    // Ключи конвертов городов: генерируются при старте, видны только админу (для подготовки конвертов).
    const cityNodes = await prisma.mapNode.findMany({ where: { gameId: id, kind: "CITY" }, select: { id: true } });
    await prisma.$transaction([
      ...teams.map((t, i) => prisma.team.update({ where: { id: t.id }, data: { startNodeKey: starts[i]?.key ?? null } })),
      ...cityNodes.map((n) => prisma.mapNode.update({ where: { id: n.id }, data: { cityKey: makeCityKey() } })),
      prisma.game.update({ where: { id }, data: { status: "ACTIVE", startedAt: new Date() } }),
    ]);
    for (const t of teams) await ensureFrontier(id, t.id);
    publish(id, { type: "game" });
    return { ok: true, startedAt: new Date() };
  });
}
