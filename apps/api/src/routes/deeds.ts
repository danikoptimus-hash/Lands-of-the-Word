import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { bookOfNodeKey, pickDeed } from "../services/teamMap.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { err } from "../services/i18n.js";
import { DIRECTIONS, deedBody, syncGameDeeds } from "../services/defaultDeeds.js";

export { DIRECTIONS } from "../services/defaultDeeds.js";

async function requireGameAdmin(request: FastifyRequest, reply: FastifyReply, gameId: string) {
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { admins: { select: { userId: true } } } });
  if (!game) { await reply.code(404).send({ error: "not_found", message: err(request, "Игра не найдена") }); return null; }
  if (!game.admins.some((a) => a.userId === request.user!.id)) { await reply.code(403).send({ error: "forbidden", message: err(request, "Вы не администратор этой игры") }); return null; }
  return game;
}

/** Рекомендуемый минимум уникальных дел ≈ длина пути одной команды за игру (2.4 документа). */
/**
 * Рекомендуемый минимум дел: дела не должны повторяться на 30 ближайших векторах хода команды,
 * поэтому не меньше 30, а на больших картах больше (примерно один вектор из восьми по карте).
 */
/**
 * Сколько перекрёстков генерировать: заданное число, умноженное на (расстояние между городами / 2)² —
 * при большем промежутке 66 городов помещаются только на большем поле (решение владельца 19.09).
 */
export function effectiveNodeCount(settings: { nodeCount?: number; cityGap?: number } | null | undefined): number {
  const base = settings?.nodeCount ?? 250, gap = settings?.cityGap ?? 2;
  return Math.round(base * (gap / 2) ** 2);
}

export function recommendedDeedCount(nodeCount: number): number {
  return Math.max(30, Math.round(nodeCount / 8));
}

export async function deedRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  app.get("/api/games/:id/deeds", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return;
    const rows = await prisma.deed.findMany({ where: { gameId: id }, orderBy: { createdAt: "asc" } });
    // «Тяжесть» убрана (решение владельца 3.15): колонка difficulty живёт только ради хешей старых игр и наружу не отдаётся.
    const deeds = rows.map(({ difficulty: _difficulty, ...d }) => d);
    const settings = (game.settings ?? {}) as { nodeCount?: number; cityGap?: number };
    return { deeds, directions: DIRECTIONS, recommendedMin: recommendedDeedCount(effectiveNodeCount(settings)) };
  });

  app.post("/api/games/:id/deeds", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const body = deedBody.parse(request.body);
    const deed = await prisma.deed.create({ data: { ...body, gameId: id } });
    publish(id, { type: "deeds" });
    return reply.code(201).send({ deed });
  });

  app.put("/api/games/:id/deeds/:deedId", async (request, reply) => {
    const { id, deedId } = request.params as { id: string; deedId: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const body = deedBody.partial().parse(request.body);
    const exists = await prisma.deed.findFirst({ where: { id: deedId, gameId: id } });
    if (!exists) return reply.code(404).send({ error: "not_found", message: err(request, "Дело не найдено") });
    const deed = await prisma.deed.update({ where: { id: deedId }, data: body });
    publish(id, { type: "deeds" });
    return { deed };
  });

  /**
   * Удалить дело. В запущенной игре дело могло уже попасть на стороны: свободные (никем не взятые) стороны
   * получают другое дело из набора; если дело уже взято или сдано хотя бы одной командой — удалить нельзя (409).
   */
  app.delete("/api/games/:id/deeds/:deedId", async (request, reply) => {
    const { id, deedId } = request.params as { id: string; deedId: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const deed = await prisma.deed.findFirst({ where: { id: deedId, gameId: id }, include: { edgeTasks: { select: { id: true, teamId: true, fromKey: true, status: true } } } });
    if (!deed) return reply.code(404).send({ error: "not_found", message: err(request, "Дело не найдено") });
    if (deed.edgeTasks.some((t) => t.status !== "OPEN")) return reply.code(409).send({ error: "conflict", message: err(request, "Это дело уже взято или сдано командой: удалить нельзя, но можно отредактировать") });
    const other = await prisma.deed.count({ where: { gameId: id, id: { not: deedId } } });
    if (deed.edgeTasks.length > 0 && other === 0) return reply.code(409).send({ error: "conflict", message: err(request, "Это единственное дело в игре: сначала добавьте другие") });
    for (const t of deed.edgeTasks) {
      const replacement = await pickDeed(id, t.teamId, await bookOfNodeKey(id, t.fromKey), deedId);
      if (!replacement) return reply.code(409).send({ error: "conflict", message: err(request, "Не удалось подобрать замену на стороны с этим делом") });
      await prisma.teamEdgeTask.update({ where: { id: t.id }, data: { deedId: replacement } });
    }
    await prisma.deed.delete({ where: { id: deedId } });
    publish(id, { type: "deeds" });
    if (deed.edgeTasks.length > 0) publish(id, { type: "map" });
    return { ok: true, replaced: deed.edgeTasks.length };
  });

  /**
   * Стандартный набор дел (content/deeds-default.json). mode=add (по умолчанию): добавить те, чьих названий ещё нет.
   * mode=replace: заменить список стандартным — дела, которые ни одна команда ещё не получала, удаляются; дела с делами
   * команд остаются (по совпадению названия — обновляются текстом и настройками из набора); недостающие добавляются.
   */
  app.post("/api/games/:id/deeds/import-default", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const mode = z.object({ mode: z.enum(["add", "replace"]).default("add") }).parse(request.body ?? {}).mode;
    return syncGameDeeds(id, mode);
  });

}
