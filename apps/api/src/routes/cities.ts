import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { requireAdmin, requireMember } from "./teamMap.js";
import { checkAnswer, checkOrder, loadCityContent, makeCityKey, publicDistricts, publicTask } from "../services/cities.js";
import { ensureFrontier } from "../services/teamMap.js";

const orderBody = z.object({ ids: z.array(z.string().min(1).max(32)).min(2).max(64) });
const answerBody = z.object({ answer: z.union([z.string().max(500), z.number(), z.array(z.string().min(1).max(32)).max(64)]) });
const captureBody = z.object({ key: z.string().trim().min(1).max(32) });

/** Пауза после неверного ответа, чтобы варианты нельзя было перебирать. */
const WRONG_COOLDOWN_MS = 20_000;

const ownerSelect = { team: { select: { id: true, index: true, name: true, color: true } } } as const;

/**
 * Города на перекрёстках: попап города у команды (районы, задания, ключ конверта) и просмотр у админа.
 */
export async function cityRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);
  const secret = app.config.SESSION_SECRET;

  async function loadCityNode(gameId: string, nodeKey: string) {
    const node = await prisma.mapNode.findUnique({ where: { gameId_key: { gameId, key: nodeKey } } });
    if (!node || node.kind !== "CITY" || !node.bookCode) return null;
    if (!node.cityKey) {
      // Игры, начатые до появления городов: ключ конверта выдаётся при первом обращении.
      const game = await prisma.game.findUnique({ where: { id: gameId }, select: { status: true } });
      if (game?.status === "ACTIVE") return prisma.mapNode.update({ where: { id: node.id }, data: { cityKey: makeCityKey() } });
    }
    return node;
  }

  /** Город глазами команды. Доступен только для открытого (достигнутого) города. */
  app.get("/api/games/:id/my-city/:nodeKey", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const node = await loadCityNode(id, nodeKey);
    if (!node) return reply.code(404).send({ error: "not_found", message: "Город не найден" });
    const reached = await prisma.teamNodeState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } });
    if (!reached) return reply.code(403).send({ error: "forbidden", message: "Ваша команда ещё не дошла до этого города" });
    const [content, state, ownerState] = await Promise.all([
      loadCityContent(node.bookCode!),
      prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } }),
      prisma.teamCityState.findFirst({ where: { gameId: id, nodeKey, capturedAt: { not: null } }, select: ownerSelect }),
    ]);
    const scopeKey = `${m.team.id}|${nodeKey}`;
    const solved = state?.orderSolved ?? false;
    const done = state?.doneTasks ?? [];
    const cooldownUntil = state?.lastWrongAt ? state.lastWrongAt.getTime() + WRONG_COOLDOWN_MS : 0;
    return {
      node: { key: node.key, bookCode: node.bookCode, cityType: node.cityType },
      owner: ownerState?.team ?? null,
      content: content
        ? {
            title: content.title,
            translation: content.translation,
            codeRule: content.codeRule,
            districts: publicDistricts(content, secret, scopeKey, solved),
            tasks: solved ? content.tasks.map((t, i) => publicTask(t, i, secret, scopeKey)) : [],
            fragments: content.tasks.map((t, i) => (done.includes(i) ? t.fragment : null)),
          }
        : null,
      state: {
        orderSolved: solved,
        orderAttempts: state?.orderAttempts ?? 0,
        doneTasks: done,
        capturedAt: state?.capturedAt ?? null,
        isCapital: state?.isCapital ?? false,
        cooldownUntil: cooldownUntil > Date.now() ? cooldownUntil : null,
      },
    };
  });

  async function memberCity(request: Parameters<typeof requireMember>[0], reply: Parameters<typeof requireMember>[1], id: string, nodeKey: string) {
    const m = await requireMember(request, reply, id);
    if (!m) return null;
    const game = await prisma.game.findUnique({ where: { id }, select: { status: true } });
    if (game?.status !== "ACTIVE") { await reply.code(409).send({ error: "conflict", message: "Игра не идёт" }); return null; }
    const node = await loadCityNode(id, nodeKey);
    if (!node) { await reply.code(404).send({ error: "not_found", message: "Город не найден" }); return null; }
    const reached = await prisma.teamNodeState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } });
    if (!reached) { await reply.code(403).send({ error: "forbidden", message: "Ваша команда ещё не дошла до этого города" }); return null; }
    const content = await loadCityContent(node.bookCode!);
    if (!content) { await reply.code(409).send({ error: "no_content", message: "Задания для этой книги ещё готовятся" }); return null; }
    const state = await prisma.teamCityState.upsert({
      where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } },
      create: { gameId: id, teamId: m.team.id, nodeKey },
      update: {},
    });
    return { m, node, content, state, scopeKey: `${m.team.id}|${nodeKey}` };
  }

  /** Расставить районы по порядку книги. Ответ — id районов в выбранном порядке. */
  app.post("/api/games/:id/my-city/:nodeKey/order", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const c = await memberCity(request, reply, id, nodeKey);
    if (!c) return;
    if (c.state.orderSolved) return reply.code(409).send({ error: "conflict", message: "Порядок уже собран" });
    const body = orderBody.parse(request.body);
    const wrong = checkOrder(c.content, secret, c.scopeKey, body.ids);
    if (wrong === null) return reply.code(400).send({ error: "validation", message: "Нужно расставить все районы по одному разу" });
    await prisma.teamCityState.update({ where: { id: c.state.id }, data: { orderAttempts: { increment: 1 }, orderSolved: wrong === 0 } });
    publish(id, { type: "cities", teamId: c.m.team.id });
    return { correct: wrong === 0, wrong };
  });

  /** Ответ на задание района. Верный ответ открывает букву шифра. */
  app.post("/api/games/:id/my-city/:nodeKey/tasks/:index/answer", async (request, reply) => {
    const { id, nodeKey, index: rawIndex } = request.params as { id: string; nodeKey: string; index: string };
    const c = await memberCity(request, reply, id, nodeKey);
    if (!c) return;
    if (!c.state.orderSolved) return reply.code(409).send({ error: "conflict", message: "Сначала расставьте районы по порядку" });
    const index = Number(rawIndex);
    const task = Number.isInteger(index) ? c.content.tasks[index] : undefined;
    if (!task) return reply.code(404).send({ error: "not_found", message: "Задание не найдено" });
    if (c.state.doneTasks.includes(index)) return reply.code(409).send({ error: "conflict", message: "Задание уже решено" });
    const cooldownUntil = c.state.lastWrongAt ? c.state.lastWrongAt.getTime() + WRONG_COOLDOWN_MS : 0;
    if (cooldownUntil > Date.now()) return reply.code(429).send({ error: "cooldown", message: "Подождите немного перед следующей попыткой", retryAt: cooldownUntil });
    const body = answerBody.parse(request.body);
    const correct = checkAnswer(task, index, secret, c.scopeKey, body.answer);
    await prisma.teamCityState.update({
      where: { id: c.state.id },
      data: correct ? { doneTasks: { push: index } } : { answerAttempts: { increment: 1 }, lastWrongAt: new Date() },
    });
    publish(id, { type: "cities", teamId: c.m.team.id });
    return correct ? { correct: true, fragment: task.fragment } : { correct: false, retryAt: Date.now() + WRONG_COOLDOWN_MS };
  });

  /** Ввести ключ из конверта: город взят. Первый взятый город команды — её столица. */
  app.post("/api/games/:id/my-city/:nodeKey/capture", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const c = await memberCity(request, reply, id, nodeKey);
    if (!c) return;
    if (c.state.capturedAt) return reply.code(409).send({ error: "conflict", message: "Город уже ваш" });
    const allDone = c.content.tasks.every((_, i) => c.state.doneTasks.includes(i));
    if (!allDone) return reply.code(409).send({ error: "conflict", message: "Сначала решите задания всех районов" });
    const body = captureBody.parse(request.body);
    if (!c.node.cityKey || body.key.toUpperCase().replace(/[\s-]/g, "") !== c.node.cityKey) {
      await prisma.teamCityState.update({ where: { id: c.state.id }, data: { answerAttempts: { increment: 1 }, lastWrongAt: new Date() } });
      return reply.code(400).send({ error: "wrong_key", message: "Ключ не подходит. Проверьте буквы в конверте" });
    }
    const owner = await prisma.teamCityState.findFirst({ where: { gameId: id, nodeKey, capturedAt: { not: null } }, select: ownerSelect });
    if (owner) return reply.code(409).send({ error: "conflict", message: `Город уже принадлежит команде «${owner.team.name}»` });
    const hasCapital = await prisma.teamCityState.count({ where: { teamId: c.m.team.id, isCapital: true } });
    const updated = await prisma.teamCityState.update({ where: { id: c.state.id }, data: { capturedAt: new Date(), isCapital: hasCapital === 0 } });
    publish(id, { type: "cities", teamId: c.m.team.id });
    publish(id, { type: "map", teamId: c.m.team.id });
    return { ok: true, isCapital: updated.isCapital };
  });

  /** Админ (для тестов): присвоить город команде — все районы решены, город занят ею; прежний владелец теряет город. */
  app.post("/api/games/:id/cities/:nodeKey/assign", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const body = z.object({ teamId: z.string().min(1) }).parse(request.body);
    const [node, team] = await Promise.all([loadCityNode(id, nodeKey), prisma.team.findFirst({ where: { id: body.teamId, gameId: id } })]);
    if (!node || !team) return reply.code(404).send({ error: "not_found", message: "Город или команда не найдены" });
    const content = await loadCityContent(node.bookCode!);
    const all = content ? content.tasks.map((_, i) => i) : [];
    const hasCapital = (await prisma.teamCityState.count({ where: { teamId: team.id, isCapital: true } })) > 0;
    await prisma.$transaction([
      prisma.teamNodeState.upsert({ where: { teamId_nodeKey: { teamId: team.id, nodeKey } }, create: { teamId: team.id, nodeKey }, update: {} }),
      prisma.teamCityState.updateMany({ where: { gameId: id, nodeKey, NOT: { teamId: team.id } }, data: { capturedAt: null, isCapital: false, secondCapital: false } }),
      prisma.teamCityState.upsert({
        where: { teamId_nodeKey: { teamId: team.id, nodeKey } },
        create: { gameId: id, teamId: team.id, nodeKey, orderSolved: true, doneTasks: all, capturedAt: new Date(), isCapital: !hasCapital },
        update: { orderSolved: true, doneTasks: all, capturedAt: new Date(), isCapital: !hasCapital },
      }),
      prisma.battle.updateMany({ where: { gameId: id, nodeKey, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } }, data: { status: "CANCELLED", resolvedAt: new Date() } }),
    ]);
    await ensureFrontier(id, team.id);
    publish(id, { type: "cities" });
    publish(id, { type: "map" });
    publish(id, { type: "battles" });
    return { ok: true, isCapital: !hasCapital };
  });

  /** Админ (для тестов): зачесть команде задания города — районы собраны, все задания решены, город не взят. */
  app.post("/api/games/:id/cities/:nodeKey/study", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const body = z.object({ teamId: z.string().min(1) }).parse(request.body);
    const [node, team] = await Promise.all([loadCityNode(id, nodeKey), prisma.team.findFirst({ where: { id: body.teamId, gameId: id } })]);
    if (!node || !team) return reply.code(404).send({ error: "not_found", message: "Город или команда не найдены" });
    const content = await loadCityContent(node.bookCode!);
    if (!content) return reply.code(409).send({ error: "no_content", message: "Задания для этой книги ещё готовятся" });
    const all = content.tasks.map((_, i) => i);
    await prisma.$transaction([
      prisma.teamNodeState.upsert({ where: { teamId_nodeKey: { teamId: team.id, nodeKey } }, create: { teamId: team.id, nodeKey }, update: {} }),
      prisma.teamCityState.upsert({
        where: { teamId_nodeKey: { teamId: team.id, nodeKey } },
        create: { gameId: id, teamId: team.id, nodeKey, orderSolved: true, doneTasks: all },
        update: { orderSolved: true, doneTasks: all },
      }),
    ]);
    await ensureFrontier(id, team.id);
    publish(id, { type: "cities" });
    publish(id, { type: "map" });
    return { ok: true };
  });

  /** Админ: город целиком — районы, задания с ответами, ключ конверта, прогресс всех команд. */
  app.get("/api/games/:id/cities/:nodeKey", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const node = await loadCityNode(id, nodeKey);
    if (!node) return reply.code(404).send({ error: "not_found", message: "Город не найден" });
    const [content, teams, states] = await Promise.all([
      loadCityContent(node.bookCode!),
      prisma.team.findMany({ where: { gameId: id }, orderBy: { index: "asc" }, select: { id: true, index: true, name: true, color: true } }),
      prisma.teamCityState.findMany({ where: { gameId: id, nodeKey } }),
    ]);
    const byTeam = new Map(states.map((s) => [s.teamId, s]));
    return {
      node: { key: node.key, bookCode: node.bookCode, cityType: node.cityType, cityKey: node.cityKey },
      content,
      teams: teams.map((t) => {
        const s = byTeam.get(t.id);
        return { ...t, orderSolved: s?.orderSolved ?? false, orderAttempts: s?.orderAttempts ?? 0, doneTasks: s?.doneTasks ?? [], answerAttempts: s?.answerAttempts ?? 0, capturedAt: s?.capturedAt ?? null, isCapital: s?.isCapital ?? false };
      }),
    };
  });
}
