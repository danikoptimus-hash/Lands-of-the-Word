import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { generateMap, MapGenError } from "@lotw/domain";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { recommendedDeedCount } from "./deeds.js";
import { loadCityContent, makeCityCode, makeCityKey } from "../services/cities.js";
import { finishGame, leader, standings } from "../services/game.js";
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
      endsAt: z.string().datetime().nullable().default(null),
      donationMin: z.number().int().min(0).nullable().default(null),
      donationCurrency: z.string().trim().max(10).default(""),
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
      endsAt: z.string().datetime().nullable().optional(),
      donationMin: z.number().int().min(0).nullable().optional(),
      donationCurrency: z.string().trim().max(10).optional(),
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
    const body = patchBody.parse(request.body);
    if (game.status !== "DRAFT") {
      // После старта меняется только срок окончания игры.
      const other = body.name !== undefined || body.teamCount !== undefined || Object.keys(body.settings ?? {}).some((k) => !["endsAt", "donationMin", "donationCurrency"].includes(k));
      if (other || game.status !== "ACTIVE") return reply.code(409).send({ error: "conflict", message: "Игра уже начата: после старта можно менять только срок окончания и пожертвование" });
    }
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
  /** Итоги: положение команд (города, столицы), победитель. Видят админы и участники. */
  app.get("/api/games/:id/standings", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await prisma.game.findUnique({ where: { id }, select: { status: true, finishedAt: true, winnerTeamId: true, finishReason: true, settings: true, admins: { select: { userId: true } }, teams: { select: { members: { select: { userId: true } } } } } });
    if (!game) return reply.code(404).send({ error: "not_found", message: "Игра не найдена" });
    const uid = request.user!.id;
    const allowed = game.admins.some((a) => a.userId === uid) || game.teams.some((t) => t.members.some((m) => m.userId === uid));
    if (!allowed) return reply.code(403).send({ error: "forbidden", message: "Нет доступа" });
    const rows = await standings(id);
    return { status: game.status, finishedAt: game.finishedAt, winnerTeamId: game.winnerTeamId, finishReason: game.finishReason, endsAt: (game.settings as { endsAt?: string | null }).endsAt ?? null, standings: rows, leaderTeamId: game.status === "ACTIVE" ? (await leader(id))?.teamId ?? null : null };
  });

  /** Админ завершает игру вручную: победитель — команда с наибольшим числом городов, если не указан явно. */
  app.post("/api/games/:id/finish", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await loadGameForAdmin(request, reply, id);
    if (!game) return;
    if (game.status !== "ACTIVE") return reply.code(409).send({ error: "conflict", message: "Игра не идёт" });
    const body = z.object({ winnerTeamId: z.string().nullable().optional() }).parse(request.body ?? {});
    const winner = body.winnerTeamId === undefined ? (await leader(id))?.teamId ?? null : body.winnerTeamId;
    await finishGame(id, "manual", winner);
    return { ok: true, winnerTeamId: winner };
  });

  /** Администраторы игры: список, добавить по никнейму или почте, убрать (создателя убрать нельзя). */
  app.get("/api/games/:id/admins", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await loadGameForAdmin(request, reply, id);
    if (!game) return;
    const admins = await prisma.gameAdmin.findMany({ where: { gameId: id }, select: { user: { select: { id: true, nickname: true, displayName: true, email: true } } } });
    return { admins: admins.map((a) => ({ ...a.user, email: a.user.email ? a.user.email.replace(/^(.).*(@.*)$/, "$1…$2") : null, creator: a.user.id === game.createdById })) };
  });

  app.post("/api/games/:id/admins", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await loadGameForAdmin(request, reply, id);
    if (!game) return;
    const body = z.object({ login: z.string().trim().min(3).max(120) }).parse(request.body);
    const user = await prisma.user.findFirst({ where: { OR: [{ nickname: { equals: body.login, mode: "insensitive" } }, { email: { equals: body.login, mode: "insensitive" } }] } });
    if (!user) return reply.code(404).send({ error: "not_found", message: "Пользователь с таким никнеймом или почтой не найден: он должен сначала зарегистрироваться" });
    const already = await prisma.gameAdmin.findUnique({ where: { gameId_userId: { gameId: id, userId: user.id } } });
    if (already) return reply.code(409).send({ error: "conflict", message: "Уже администратор этой игры" });
    await prisma.gameAdmin.create({ data: { gameId: id, userId: user.id } });
    publish(id, { type: "game" });
    return reply.code(201).send({ ok: true, nickname: user.nickname });
  });

  app.delete("/api/games/:id/admins/:userId", async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const game = await loadGameForAdmin(request, reply, id);
    if (!game) return;
    if (userId === game.createdById) return reply.code(409).send({ error: "conflict", message: "Создателя игры убрать нельзя" });
    await prisma.gameAdmin.deleteMany({ where: { gameId: id, userId } });
    publish(id, { type: "game" });
    return { ok: true };
  });

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
    // Тексты — шаблоны с подстановками: клиент переводит их по ключу (см. i18n), `problems`/`warnings` — готовые русские строки.
    type Item = { key: string; vars?: Record<string, string | number> };
    const problemItems: Item[] = [];
    if (starts === 0) problemItems.push({ key: "Карта не сгенерирована" });
    else if (starts !== game.teamCount) problemItems.push({ key: "На карте {a} стартовых точек, а команд по настройкам {b}: перегенерируйте карту", vars: { a: starts, b: game.teamCount } });
    if (teams.length < game.teamCount) problemItems.push({ key: "Создано команд: {a} из {b}. Добавьте команду или уменьшите число команд в настройках", vars: { a: teams.length, b: game.teamCount } });
    const empty = teams.filter((t) => t._count.members === 0).map((t) => t.name);
    if (empty.length) problemItems.push({ key: "Команды без участников: {names}", vars: { names: empty.join(", ") } });
    const warningItems: Item[] = [];
    if (deeds < recommended) warningItems.push({ key: "Дел в списке {a}, рекомендуется не меньше {b}: дела начнут повторяться", vars: { a: deeds, b: recommended } });
    if (deeds === 0) problemItems.push({ key: "Список дел пуст" });
    const fill = (i: Item) => i.key.replace(/\{(\w+)\}/g, (m, k: string) => (i.vars && k in i.vars ? String(i.vars[k]) : m));
    return { canStart: problemItems.length === 0, problems: problemItems.map(fill), warnings: warningItems.map(fill), problemItems, warningItems };
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
    const cityNodes = await prisma.mapNode.findMany({ where: { gameId: id, kind: "CITY" }, select: { id: true, bookCode: true } });
    const codeLengths = await Promise.all(cityNodes.map(async (n) => (await loadCityContent(n.bookCode ?? ""))?.tasks.length ?? 12));
    await prisma.$transaction([
      ...teams.map((t, i) => prisma.team.update({ where: { id: t.id }, data: { startNodeKey: starts[i]?.key ?? null } })),
      ...cityNodes.map((n, i) => prisma.mapNode.update({ where: { id: n.id }, data: { cityKey: makeCityKey(), cityCode: makeCityCode(codeLengths[i]!) } })),
      prisma.game.update({ where: { id }, data: { status: "ACTIVE", startedAt: new Date() } }),
    ]);
    for (const t of teams) await ensureFrontier(id, t.id);
    publish(id, { type: "game" });
    return { ok: true, startedAt: new Date() };
  });
}
