import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { bookOfNodeKey, pickDeed } from "../services/teamMap.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { err } from "../services/i18n.js";
import { DIRECTIONS, deedBody, reassignOpenSides, syncGameDeeds } from "../services/defaultDeeds.js";
import { adminOrObserver } from "../services/access.js";
import { peopleOf, rebalancePeople } from "../services/people.js";

export { DIRECTIONS } from "../services/defaultDeeds.js";

async function requireGameAdmin(request: FastifyRequest, reply: FastifyReply, gameId: string) {
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { admins: { select: { userId: true } } } });
  if (!game) { await reply.code(404).send({ error: "not_found", message: err(request, "Игра не найдена") }); return null; }
  if (!adminOrObserver(request, game.admins)) { await reply.code(403).send({ error: "forbidden", message: err(request, "Вы не администратор этой игры") }); return null; }
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
    const rows = await prisma.deed.findMany({ where: { gameId: id }, orderBy: { createdAt: "asc" }, include: { _count: { select: { people: true } } } });
    // Сколько таких дел сейчас на картах всех команд: свободных (OPEN) и в работе (взято, на проверке, возвращено) — решение владельца 04.10.
    // Цифры «на карте» — по всем командам сразу; чтобы сверять с картой «глазами команды», отдаётся и разбивка по командам,
    // и сколько из свободных — морские рейсы (на карте это корабль у порта, а не свиток) (замечание владельца 05.10).
    const grouped = await prisma.teamEdgeTask.groupBy({ by: ["deedId", "status", "teamId", "sea"], where: { gameId: id, status: { in: ["OPEN", "TAKEN", "SUBMITTED", "REJECTED"] } }, _count: { _all: true } });
    const teams = await prisma.team.findMany({ where: { gameId: id }, orderBy: { index: "asc" }, select: { id: true, index: true, name: true, color: true, avatarId: true } });
    type OnMap = { free: number; taken: number; sea: number; teams: Array<{ index: number; name: string; color: string; free: number; taken: number }> };
    const onMap = new Map<string, OnMap>();
    for (const g of grouped) {
      const c = onMap.get(g.deedId) ?? { free: 0, taken: 0, sea: 0, teams: [] };
      const tm = teams.find((x) => x.id === g.teamId);
      let row = c.teams.find((x) => tm && x.index === tm.index);
      if (!row && tm) { row = { index: tm.index, name: tm.name, color: tm.color, free: 0, taken: 0 }; c.teams.push(row); }
      if (g.status === "OPEN") { c.free += g._count._all; if (row) row.free += g._count._all; if (g.sea) c.sea += g._count._all; }
      else { c.taken += g._count._all; if (row) row.taken += g._count._all; }
      c.teams.sort((a, b) => a.index - b.index);
      onMap.set(g.deedId, c);
    }
    // «Тяжесть» убрана (решение владельца 3.15): колонка difficulty живёт только ради хешей старых игр и наружу не отдаётся.
    // Порядок списка — по убыванию «свободных + в работе» (решение владельца 04.10), при равенстве — по дате создания.
    const deeds = rows.map(({ difficulty: _difficulty, _count, ...d }) => ({ ...d, peopleCount: _count.people, onMap: onMap.get(d.id) ?? { free: 0, taken: 0, sea: 0, teams: [] } }))
      .sort((a, b) => (b.onMap.free + b.onMap.taken) - (a.onMap.free + a.onMap.taken) || a.createdAt.getTime() - b.createdAt.getTime());
    const settings = (game.settings ?? {}) as { nodeCount?: number; cityGap?: number };
    return { deeds, directions: DIRECTIONS, recommendedMin: recommendedDeedCount(effectiveNodeCount(settings)) };
  });

  app.post("/api/games/:id/deeds", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const body = deedBody.parse(request.body);
    const deed = await prisma.deed.create({ data: { ...body, gameId: id } });
    publish(id, { type: "deeds" });
    // Решение владельца 05.10: дело, которое уже появилось на стороне, не подменяется. Новое дело попадает
    // только на новые стороны (до 05.10 добавление дела перераздавало свободные стороны всех команд).
    return reply.code(201).send({ deed });
  });

  app.put("/api/games/:id/deeds/:deedId", async (request, reply) => {
    const { id, deedId } = request.params as { id: string; deedId: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const body = deedBody.partial().parse(request.body);
    // Выключить/включить дело (решение владельца 06.10): отдельное поле, в содержимое и хеш набора не входит.
    const { disabled } = z.object({ disabled: z.boolean().optional() }).parse(request.body);
    const exists = await prisma.deed.findFirst({ where: { id: deedId, gameId: id } });
    if (!exists) return reply.code(404).send({ error: "not_found", message: err(request, "Дело не найдено") });
    const deed = await prisma.deed.update({ where: { id: deedId }, data: { ...body, ...(disabled === undefined ? {} : { disabled }) } });
    // Дело перевели в Каменоломню (решение владельца 20.10): свободные стороны с ним получают другие дела.
    if (body.quarry && !exists.quarry) await reassignOpenSides(id, deedId);
    publish(id, { type: "deeds" });
    // Новые вероятность и книги действуют только на новые стороны: дела, которые уже видны на карте, остаются (решение владельца 05.10).
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
      await prisma.teamEdgeTask.update({ where: { id: t.id }, data: { deedId: replacement, personId: null } });
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
  /**
   * Список людей у дела (решение владельца 21.10): кому звонить. Администратор добавляет и убирает имена; стороны карты
   * с этим делом получают имя равномерно, у каждого видно, сколько сторон на карте, в работе и принято.
   */
  app.get("/api/games/:id/deeds/:deedId/people", async (request, reply) => {
    const { id, deedId } = request.params as { id: string; deedId: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    return { people: await peopleOf(id, deedId) };
  });
  app.post("/api/games/:id/deeds/:deedId/people", async (request, reply) => {
    const { id, deedId } = request.params as { id: string; deedId: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const body = z.object({ name: z.string().trim().min(2).max(80) }).parse(request.body);
    const deed = await prisma.deed.findFirst({ where: { id: deedId, gameId: id }, select: { id: true } });
    if (!deed) return reply.code(404).send({ error: "not_found", message: err(request, "Дело не найдено") });
    await prisma.deedPerson.create({ data: { gameId: id, deedId, name: body.name } });
    await rebalancePeople(id, deedId);
    publish(id, { type: "deeds" }); publish(id, { type: "map" });
    return { people: await peopleOf(id, deedId) };
  });
  app.delete("/api/games/:id/deeds/:deedId/people/:pid", async (request, reply) => {
    const { id, deedId, pid } = request.params as { id: string; deedId: string; pid: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const person = await prisma.deedPerson.findFirst({ where: { id: pid, gameId: id, deedId } });
    if (!person) return reply.code(404).send({ error: "not_found", message: err(request, "Человек не найден") });
    // Стороны этого человека: свободные и взятые получат другого из списка, сданные остаются без имени.
    await prisma.deedPerson.delete({ where: { id: pid } });
    await rebalancePeople(id, deedId);
    publish(id, { type: "deeds" }); publish(id, { type: "map" });
    return { people: await peopleOf(id, deedId) };
  });

  app.post("/api/games/:id/deeds/import-default", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const mode = z.object({ mode: z.enum(["add", "replace"]).default("add") }).parse(request.body ?? {}).mode;
    return syncGameDeeds(id, mode);
  });

}
