import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { requireActiveMember, requireAdmin, requireMember, requireSuperadmin } from "./teamMap.js";
import { pauseAfter, rulesOf, days } from "../services/rules.js";
import { checkAnswer, checkOrder, loadCityContent, makeCityCode, makeCityKey, publicDistricts, publicTask, stripAnswers } from "../services/cities.js";
import { ensureFrontier, onCityOwned } from "../services/teamMap.js";
import { notifyAdmins, notifyTeam } from "../services/notify.js";
import type { CityContent } from "../services/cities.js";
import { err, msg } from "../services/i18n.js";
import { journal, nick } from "../services/journal.js";
import { ruinsTreasure } from "../services/treasure.js";

const orderBody = z.object({ ids: z.array(z.string().min(1).max(32)).min(2).max(64) });
const answerBody = z.object({ answer: z.union([z.string().max(500), z.number(), z.array(z.string().min(1).max(32)).max(64)]) });
const captureBody = z.object({ key: z.string().trim().min(1).max(32) });

/**
 * Растущая пауза после неверного ответа (решение владельца 18.09, для всех типов заданий и для ключа конверта):
 * ступени из правил игры (20 с, 1 мин, 5 мин, 15 мин, 1 ч, дальше по часу), считается на задание,
 * сбрасывается при верном ответе. Двух попыток и блокировки на сутки больше нет.
 */
function publicLock(l: { taskIndex: number; wrong: number; lockedUntil: Date | null; unlocked: boolean }, now: number) {
  const locked = l.lockedUntil && l.lockedUntil.getTime() > now;
  return { index: l.taskIndex, wrong: l.wrong, lockedUntil: locked ? l.lockedUntil!.getTime() : null, unlocked: l.unlocked };
}

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
    if (!node.cityKey || !node.cityCode) {
      // Игры, начатые раньше: ключ конверта и шифр выдаются при первом обращении.
      const game = await prisma.game.findUnique({ where: { id: gameId }, select: { status: true } });
      if (game?.status === "ACTIVE") {
        const content = await loadCityContent(node.bookCode);
        return prisma.mapNode.update({ where: { id: node.id }, data: { cityKey: node.cityKey ?? makeCityKey(), cityCode: node.cityCode ?? makeCityCode(content?.tasks.length ?? 12) } });
      }
    }
    return node;
  }

  /** Город глазами команды. Доступен только для открытого (достигнутого) города. */
  app.get("/api/games/:id/my-city/:nodeKey", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const node = await loadCityNode(id, nodeKey);
    if (!node) return reply.code(404).send({ error: "not_found", message: err(request, "Город не найден") });
    const reached = await prisma.teamNodeState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } });
    if (!reached) return reply.code(403).send({ error: "forbidden", message: err(request, "Ваша команда ещё не дошла до этого города") });
    const [content, state, ownerState, locks, support] = await Promise.all([
      loadCityContent(node.bookCode!),
      prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } }),
      prisma.teamCityState.findFirst({ where: { gameId: id, nodeKey, capturedAt: { not: null } }, select: ownerSelect }),
      prisma.teamTaskLock.findMany({ where: { teamId: m.team.id, nodeKey } }),
      // Обращения команды по этому городу: открытые и закрытые за последние две недели (чтобы показать ответ).
      prisma.supportRequest.findMany({ where: { teamId: m.team.id, nodeKey, OR: [{ status: "OPEN" }, { resolvedAt: { gte: new Date(Date.now() - 14 * 86_400_000) } }] }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    const scopeKey = `${m.team.id}|${nodeKey}`;
    const solved = state?.orderSolved ?? false;
    const done = state?.doneTasks ?? [];
    const keyLockedUntil = state?.keyLockedUntil ? state.keyLockedUntil.getTime() : 0;
    const game = await prisma.game.findUniqueOrThrow({ where: { id }, select: { settings: true } });
    const rules = rulesOf(game.settings);
    // Адресат конверта показывается только когда все задания решены: раньше он команде не нужен.
    const allDone = Boolean(content) && solved && done.length >= (content?.tasks.length ?? 0);
    const recipient = allDone && node.recipientId ? await prisma.recipient.findUnique({ where: { id: node.recipientId }, select: { label: true, kind: true } }) : null;
    return {
      node: { key: node.key, bookCode: node.bookCode, cityType: node.cityType, ruined: node.ruined },
      recipient,
      owner: ownerState?.team ?? null,
      team: { capitalMovedAt: m.team.capitalMovedAt, gameRole: m.gameRole, role: m.role },
      content: content
        ? {
            title: content.title,
            translation: content.translation,
            codeRule: content.codeRule,
            districts: publicDistricts(content, secret, scopeKey, solved),
            tasks: solved ? content.tasks.map((t, i) => publicTask(t, i, secret, scopeKey)) : [],
            fragments: content.tasks.map((_, i) => (done.includes(i) ? node.cityCode?.[i] ?? null : null)),
          }
        : null,
      state: {
        orderSolved: solved,
        orderAttempts: state?.orderAttempts ?? 0,
        doneTasks: done,
        capturedAt: state?.capturedAt ?? null,
        isCapital: state?.isCapital ?? false,
        secondCapital: state?.secondCapital ?? false,
        // Подсказки пророка видит только пророк: команда спрашивает у него (решение владельца 18.09).
        hintTasks: m.gameRole === "PROPHET" ? state?.hintTasks ?? [] : [],
        // Свеча пророка (C-15): когда право на подсказку снова доступно; не пророку не отдаётся.
        hintAvailableAt: m.gameRole === "PROPHET" ? (m.team.lastHintAt ? m.team.lastHintAt.getTime() + days(rules.roleCooldownDays) : 0) : null,
        keyLockedUntil: keyLockedUntil > Date.now() ? keyLockedUntil : null,
        keyWrong: state?.keyWrong ?? 0,
        pauseSteps: rules.pauseSteps,
        locks: locks.map((l) => publicLock(l, Date.now())),
        support: support.map((r) => ({ id: r.id, taskIndex: r.taskIndex, createdAt: r.createdAt.getTime(), status: r.status, reply: r.reply, unlocked: r.unlocked })),
      },
    };
  });

  async function memberCity(request: Parameters<typeof requireMember>[0], reply: Parameters<typeof requireMember>[1], id: string, nodeKey: string) {
    const m = await requireActiveMember(request, reply, id);
    if (!m) return null;
    const game = await prisma.game.findUnique({ where: { id }, select: { status: true, settings: true } });
    if (game?.status !== "ACTIVE") { await reply.code(409).send({ error: "conflict", message: err(request, "Игра не идёт") }); return null; }
    const node = await loadCityNode(id, nodeKey);
    if (!node) { await reply.code(404).send({ error: "not_found", message: err(request, "Город не найден") }); return null; }
    const reached = await prisma.teamNodeState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } });
    if (!reached) { await reply.code(403).send({ error: "forbidden", message: err(request, "Ваша команда ещё не дошла до этого города") }); return null; }
    const content = await loadCityContent(node.bookCode!);
    if (!content) { await reply.code(409).send({ error: "no_content", message: err(request, "Задания для этой книги ещё готовятся") }); return null; }
    const state = await prisma.teamCityState.upsert({
      where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } },
      create: { gameId: id, teamId: m.team.id, nodeKey },
      update: {},
    });
    return { m, node, content, state, rules: rulesOf(game.settings), scopeKey: `${m.team.id}|${nodeKey}` };
  }

  /** Расставить районы по порядку книги. Ответ — id районов в выбранном порядке. */
  app.post("/api/games/:id/my-city/:nodeKey/order", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const c = await memberCity(request, reply, id, nodeKey);
    if (!c) return;
    if (c.state.orderSolved) return reply.code(409).send({ error: "conflict", message: err(request, "Порядок районов уже собран") });
    const body = orderBody.parse(request.body);
    const wrong = checkOrder(c.content, secret, c.scopeKey, body.ids);
    if (wrong === null) return reply.code(400).send({ error: "validation", message: err(request, "Расставьте все районы, каждый по одному разу") });
    await prisma.teamCityState.update({ where: { id: c.state.id }, data: { orderAttempts: { increment: 1 }, orderSolved: wrong === 0 } });
    if (wrong === 0) journal(id, "order_solved", { teamId: c.m.team.id, userId: request.user!.id, vars: { user: await nick(request.user!.id), book: c.node.bookCode ?? "" } });
    publish(id, { type: "cities", teamId: c.m.team.id });
    return { correct: wrong === 0, wrong };
  });

  /** Ответ на задание района. Верный ответ открывает букву шифра. */
  app.post("/api/games/:id/my-city/:nodeKey/tasks/:index/answer", async (request, reply) => {
    const { id, nodeKey, index: rawIndex } = request.params as { id: string; nodeKey: string; index: string };
    const c = await memberCity(request, reply, id, nodeKey);
    if (!c) return;
    if (!c.state.orderSolved) return reply.code(409).send({ error: "conflict", message: err(request, "Сначала расставьте районы по порядку") });
    const index = Number(rawIndex);
    const task = Number.isInteger(index) ? c.content.tasks[index] : undefined;
    if (!task) return reply.code(404).send({ error: "not_found", message: err(request, "Задание не найдено") });
    if (c.state.doneTasks.includes(index)) return reply.code(409).send({ error: "conflict", message: err(request, "Задание уже решено") });
    const body = answerBody.parse(request.body);
    const now = Date.now();
    const lockWhere = { teamId_nodeKey_taskIndex: { teamId: c.m.team.id, nodeKey, taskIndex: index } };
    const lock = await prisma.teamTaskLock.findUnique({ where: lockWhere });
    // Растущая пауза на это задание: пока не прошла, ответ не принимается.
    if (lock?.lockedUntil && lock.lockedUntil.getTime() > now) {
      return reply.code(429).send({ error: "cooldown", message: err(request, "Замок заклинило: подождите перед следующей попыткой"), retryAt: lock.lockedUntil.getTime() });
    }
    const correct = checkAnswer(task, index, secret, c.scopeKey, body.answer);
    let retryAt: number | null = null;
    await prisma.teamCityState.update({
      where: { id: c.state.id },
      data: correct ? { doneTasks: { push: index } } : { answerAttempts: { increment: 1 }, lastWrongAt: new Date() },
    });
    if (correct) { if (lock) await prisma.teamTaskLock.update({ where: { id: lock.id }, data: { wrong: 0, lockedUntil: null } }); }
    else {
      const wrong = (lock?.wrong ?? 0) + 1;
      retryAt = now + pauseAfter(c.rules, wrong);
      const data = { wrong, lockedUntil: new Date(retryAt), unlocked: false };
      await prisma.teamTaskLock.upsert({ where: lockWhere, create: { gameId: id, teamId: c.m.team.id, nodeKey, taskIndex: index, ...data }, update: data });
    }
    publish(id, { type: "cities", teamId: c.m.team.id });
    if (correct) {
      journal(id, "task_solved", { teamId: c.m.team.id, userId: request.user!.id, vars: { user: await nick(request.user!.id), n: index + 1, book: c.node.bookCode ?? "" } });
      // Руины с сокровищем (решение владельца 18.09): первая команда, решившая все задания руин, получает знак шифра соседнего города.
      if (c.node.ruined && !c.node.treasureTeamId && c.content.tasks.every((_, i) => i === index || c.state.doneTasks.includes(i))) await ruinsTreasure(id, c.m.team.id, c.node.key, c.node.bookCode ?? "");
      return { correct: true, fragment: c.node.cityCode?.[index] ?? null };
    }
    return { correct: false, retryAt, wrong: (lock?.wrong ?? 0) + 1 };
  });

  /** Ввести ключ из конверта: город взят. Первый взятый город команды — её столица. */
  app.post("/api/games/:id/my-city/:nodeKey/capture", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    const c = await memberCity(request, reply, id, nodeKey);
    if (!c) return;
    if (c.state.capturedAt) return reply.code(409).send({ error: "conflict", message: err(request, "Город уже ваш") });
    const allDone = c.content.tasks.every((_, i) => c.state.doneTasks.includes(i));
    if (!allDone) return reply.code(409).send({ error: "conflict", message: err(request, "Сначала решите задания всех районов") });
    const body = c.node.ruined ? { key: c.node.cityKey ?? "" } : captureBody.parse(request.body);
    // Неверный ключ конверта: растущая пауза на город (решение владельца 18.09).
    if (!c.node.ruined && c.state.keyLockedUntil && c.state.keyLockedUntil.getTime() > Date.now()) {
      return reply.code(429).send({ error: "cooldown", message: err(request, "Печать остывает: подождите перед следующей попыткой"), retryAt: c.state.keyLockedUntil.getTime() });
    }
    // Руины берутся без ключа: достаточно решённых заданий.
    if (!c.node.ruined && (!c.node.cityKey || body.key.toUpperCase().replace(/[\s-]/g, "") !== c.node.cityKey)) {
      const wrong = c.state.keyWrong + 1;
      const retryAt = Date.now() + pauseAfter(c.rules, wrong);
      await prisma.teamCityState.update({ where: { id: c.state.id }, data: { answerAttempts: { increment: 1 }, lastWrongAt: new Date(), keyWrong: wrong, keyLockedUntil: new Date(retryAt) } });
      return reply.code(400).send({ error: "wrong_key", message: err(request, "Ключ не подходит. Проверьте буквы в конверте"), retryAt });
    }
    const owner = await prisma.teamCityState.findFirst({ where: { gameId: id, nodeKey, capturedAt: { not: null } }, select: ownerSelect });
    if (owner) return reply.code(409).send({ error: "conflict", message: err(request, "Город уже принадлежит команде «{team}»", { team: owner.team.name }) });
    const hasCapital = await prisma.teamCityState.count({ where: { teamId: c.m.team.id, isCapital: true } });
    const updated = await prisma.teamCityState.update({ where: { id: c.state.id }, data: { capturedAt: new Date(), firstCapturedAt: c.state.firstCapturedAt ?? new Date(), isCapital: hasCapital === 0, keyWrong: 0, keyLockedUntil: null } });
    if (c.node.ruined) await prisma.mapNode.update({ where: { id: c.node.id }, data: { ruined: false, maxReachedAt: null, lockedUntil: null, sumMode: false } });
    await onCityOwned(id, nodeKey, c.m.team.id);
    journal(id, c.node.ruined ? "ruins_taken" : "city_captured", { everyone: true, teamId: c.m.team.id, userId: request.user!.id, vars: { team: c.m.team.name, book: c.node.bookCode ?? "", capital: updated.isCapital ? " (столица)" : "" } });
    publish(id, { type: "cities", teamId: c.m.team.id });
    publish(id, { type: "map", teamId: c.m.team.id });
    return { ok: true, isCapital: updated.isCapital };
  });

  /** Админ (для тестов): присвоить город команде — все районы решены, город занят ею; прежний владелец теряет город. */
  app.post("/api/games/:id/cities/:nodeKey/assign", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    if (!(await requireAdmin(request, reply, id))) return;
    if (!requireSuperadmin(request, reply)) return;
    const body = z.object({ teamId: z.string().min(1) }).parse(request.body);
    const [node, team] = await Promise.all([loadCityNode(id, nodeKey), prisma.team.findFirst({ where: { id: body.teamId, gameId: id } })]);
    if (!node || !team) return reply.code(404).send({ error: "not_found", message: err(request, "Город или команда не найдены") });
    const content = await loadCityContent(node.bookCode!);
    const all = content ? content.tasks.map((_, i) => i) : [];
    const existing = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: team.id, nodeKey } } });
    // Столица остаётся столицей, если присваиваем тот же город повторно.
    const hasCapital = (await prisma.teamCityState.count({ where: { teamId: team.id, isCapital: true, NOT: { nodeKey } } })) > 0 && !existing?.isCapital;
    await prisma.$transaction([
      prisma.teamNodeState.upsert({ where: { teamId_nodeKey: { teamId: team.id, nodeKey } }, create: { teamId: team.id, nodeKey }, update: {} }),
      prisma.teamCityState.updateMany({ where: { gameId: id, nodeKey, NOT: { teamId: team.id } }, data: { capturedAt: null, isCapital: false, secondCapital: false } }),
      prisma.teamCityState.upsert({
        where: { teamId_nodeKey: { teamId: team.id, nodeKey } },
        create: { gameId: id, teamId: team.id, nodeKey, orderSolved: true, doneTasks: all, capturedAt: new Date(), firstCapturedAt: new Date(), isCapital: !hasCapital },
        update: { orderSolved: true, doneTasks: all, capturedAt: new Date(), firstCapturedAt: existing?.firstCapturedAt ?? new Date(), isCapital: existing?.isCapital || !hasCapital },
      }),
      prisma.battle.updateMany({ where: { gameId: id, nodeKey, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } }, data: { status: "CANCELLED", resolvedAt: new Date() } }),
    ]);
    await onCityOwned(id, nodeKey, team.id);
    await ensureFrontier(id, team.id);
    publish(id, { type: "cities" });
    publish(id, { type: "map" });
    publish(id, { type: "battles" });
    publish(id, { type: "tasks" });
    return { ok: true, isCapital: !hasCapital };
  });

  /** Админ (для тестов): зачесть команде задания города — районы собраны, все задания решены, город не взят. */
  app.post("/api/games/:id/cities/:nodeKey/study", async (request, reply) => {
    const { id, nodeKey } = request.params as { id: string; nodeKey: string };
    if (!(await requireAdmin(request, reply, id))) return;
    if (!requireSuperadmin(request, reply)) return;
    const body = z.object({ teamId: z.string().min(1) }).parse(request.body);
    const [node, team] = await Promise.all([loadCityNode(id, nodeKey), prisma.team.findFirst({ where: { id: body.teamId, gameId: id } })]);
    if (!node || !team) return reply.code(404).send({ error: "not_found", message: err(request, "Город или команда не найдены") });
    const content = await loadCityContent(node.bookCode!);
    if (!content) return reply.code(409).send({ error: "no_content", message: err(request, "Задания для этой книги ещё готовятся") });
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
    if (!node) return reply.code(404).send({ error: "not_found", message: err(request, "Город не найден") });
    const [content, teams, states] = await Promise.all([
      loadCityContent(node.bookCode!),
      prisma.team.findMany({ where: { gameId: id }, orderBy: { index: "asc" }, select: { id: true, index: true, name: true, color: true } }),
      prisma.teamCityState.findMany({ where: { gameId: id, nodeKey } }),
    ]);
    const byTeam = new Map(states.map((s) => [s.teamId, s]));
    // Ответы на задания видит только администратор платформы (решение владельца): администратор игры — задания без ответов.
    const superadmin = request.user!.platformRole === "SUPERADMIN";
    return {
      node: { key: node.key, bookCode: node.bookCode, cityType: node.cityType, cityKey: node.cityKey, cityCode: node.cityCode },
      content: superadmin || !content ? content : stripAnswers(content),
      answersHidden: !superadmin,
      teams: teams.map((t) => {
        const s = byTeam.get(t.id);
        return { ...t, orderSolved: s?.orderSolved ?? false, orderAttempts: s?.orderAttempts ?? 0, doneTasks: s?.doneTasks ?? [], answerAttempts: s?.answerAttempts ?? 0, capturedAt: s?.capturedAt ?? null, isCapital: s?.isCapital ?? false };
      }),
    };
  });
}
