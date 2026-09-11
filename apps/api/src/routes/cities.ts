import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { requireAdmin, requireMember } from "./teamMap.js";
import { checkAnswer, checkOrder, loadCityContent, makeCityCode, makeCityKey, publicDistricts, publicTask } from "../services/cities.js";
import { ensureFrontier, onCityOwned } from "../services/teamMap.js";
import { notifyAdmins, notifyTeam } from "../services/notify.js";
import { loadBook, parseDistrictRange } from "../services/bible.js";
import type { CityContent } from "../services/cities.js";
import { err, msg } from "../services/i18n.js";

const orderBody = z.object({ ids: z.array(z.string().min(1).max(32)).min(2).max(64) });
const answerBody = z.object({ answer: z.union([z.string().max(500), z.number(), z.array(z.string().min(1).max(32)).max(64)]) });
const captureBody = z.object({ key: z.string().trim().min(1).max(32) });

/** Пауза после неверного ответа, чтобы варианты нельзя было перебирать. */
const WRONG_COOLDOWN_MS = 20_000;
/** Задание с выбором ответа: столько неверных попыток — и задание закрывается на сутки (решение владельца). */
const CHOICE_ATTEMPTS = 2;
const LOCK_MS = 24 * 3600_000;
const disputeBody = z.object({ message: z.string().trim().min(5).max(500) });
const resolveBody = z.object({ unlock: z.boolean(), answer: z.string().trim().max(500).optional() });

/**
 * Минимальное время чтения (решение владельца): ответить можно только после того, как задание было открыто
 * на экране у кого-то из команды суммарно не меньше нормы. Норма — от объёма района: READ_MS_PER_VERSE на стих,
 * но не меньше READ_MIN_MS и не больше READ_MAX_MS; задание по всей книге — READ_BOOK_MS. Время копит сервер
 * по сигналам «читаю» (раз в HEARTBEAT_MS, пока задание открыто и вкладка видна), поэтому «завести» таймер
 * и уйти нельзя. Копится на команду, а не на человека.
 */
const READ_MS_PER_VERSE = 6_000, READ_MIN_MS = 3 * 60_000, READ_MAX_MS = 12 * 60_000, READ_BOOK_MS = 5 * 60_000;
const HEARTBEAT_MS = 10_000, HEARTBEAT_MAX_CREDIT_MS = 20_000;

/** Сколько стихов покрывает задание: район, группа районов или (для book) null. */
async function taskVerses(content: CityContent, index: number): Promise<number | null> {
  const task = content.tasks[index];
  if (!task || task.scope === "book") return null;
  const book = await loadBook(content.book);
  if (!book) return null;
  const idxs = task.scope === "group" ? (task.groupDistricts ?? []).map((n) => n - 1) : [index];
  let n = 0;
  for (const i of idxs) { const r = content.districts[i] ? parseDistrictRange(book, content.districts[i]!.verses) : null; if (r) n += r.end - r.start + 1; }
  return n || null;
}
export async function readingRequiredMs(content: CityContent, index: number): Promise<number> {
  const verses = await taskVerses(content, index);
  if (verses === null) return READ_BOOK_MS;
  return Math.min(READ_MAX_MS, Math.max(READ_MIN_MS, verses * READ_MS_PER_VERSE));
}

/** Состояние задания у команды (в ответе my-city): попытки, блокировка, спор, накопленное чтение. */
function publicLock(l: { taskIndex: number; wrong: number; lockedUntil: Date | null; dispute: string | null; disputedAt: Date | null; resolvedAt: Date | null; resolution: string | null; readMs: number }, now: number) {
  const locked = l.lockedUntil && l.lockedUntil.getTime() > now;
  return { index: l.taskIndex, attemptsLeft: locked ? 0 : Math.max(0, CHOICE_ATTEMPTS - l.wrong), lockedUntil: locked ? l.lockedUntil!.getTime() : null, dispute: l.dispute, disputedAt: l.disputedAt?.getTime() ?? null, resolvedAt: l.resolvedAt?.getTime() ?? null, resolution: l.resolution, readMs: l.readMs };
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
    const [content, state, ownerState, locks] = await Promise.all([
      loadCityContent(node.bookCode!),
      prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey } } }),
      prisma.teamCityState.findFirst({ where: { gameId: id, nodeKey, capturedAt: { not: null } }, select: ownerSelect }),
      prisma.teamTaskLock.findMany({ where: { teamId: m.team.id, nodeKey } }),
    ]);
    const scopeKey = `${m.team.id}|${nodeKey}`;
    const solved = state?.orderSolved ?? false;
    const done = state?.doneTasks ?? [];
    const cooldownUntil = state?.lastWrongAt ? state.lastWrongAt.getTime() + WRONG_COOLDOWN_MS : 0;
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
            tasks: solved ? await Promise.all(content.tasks.map(async (t, i) => ({ ...publicTask(t, i, secret, scopeKey), readingMs: await readingRequiredMs(content, i) }))) : [],
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
        hintTasks: state?.hintTasks ?? [],
        cooldownUntil: cooldownUntil > Date.now() ? cooldownUntil : null,
        choiceAttempts: CHOICE_ATTEMPTS,
        heartbeatMs: HEARTBEAT_MS,
        locks: locks.map((l) => publicLock(l, Date.now())),
      },
    };
  });

  async function memberCity(request: Parameters<typeof requireMember>[0], reply: Parameters<typeof requireMember>[1], id: string, nodeKey: string) {
    const m = await requireMember(request, reply, id);
    if (!m) return null;
    const game = await prisma.game.findUnique({ where: { id }, select: { status: true } });
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
    return { m, node, content, state, scopeKey: `${m.team.id}|${nodeKey}` };
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
    const cooldownUntil = c.state.lastWrongAt ? c.state.lastWrongAt.getTime() + WRONG_COOLDOWN_MS : 0;
    if (cooldownUntil > Date.now()) return reply.code(429).send({ error: "cooldown", message: err(request, "Подождите немного перед следующей попыткой"), retryAt: cooldownUntil });
    const body = answerBody.parse(request.body);
    const now = Date.now();
    const lockWhere = { teamId_nodeKey_taskIndex: { teamId: c.m.team.id, nodeKey, taskIndex: index } };
    const lock = await prisma.teamTaskLock.findUnique({ where: lockWhere });
    // Сначала чтение: пока норма не набрана, ответ не принимается.
    const required = await readingRequiredMs(c.content, index);
    if ((lock?.readMs ?? 0) < required) {
      return reply.code(409).send({ error: "reading", message: err(request, "Сначала прочитайте текст: время чтения ещё не набрано"), remainingMs: required - (lock?.readMs ?? 0) });
    }
    // Выбор ответа: две попытки, потом задание закрыто на сутки. Спор — отдельным запросом.
    if (lock?.lockedUntil && lock.lockedUntil.getTime() > now) {
      return reply.code(423).send({ error: "locked", message: err(request, "Задание закрыто на сутки после двух неверных ответов"), lockedUntil: lock.lockedUntil.getTime() });
    }
    const correct = checkAnswer(task, index, secret, c.scopeKey, body.answer);
    let lockedUntil: number | null = null;
    await prisma.teamCityState.update({
      where: { id: c.state.id },
      data: correct ? { doneTasks: { push: index } } : { answerAttempts: { increment: 1 }, lastWrongAt: new Date() },
    });
    if (task.type === "choice") {
      if (correct) { if (lock) await prisma.teamTaskLock.update({ where: { id: lock.id }, data: { wrong: 0, lockedUntil: null } }); }
      else {
        const wrong = (lock?.wrong ?? 0) + 1;
        const locking = wrong >= CHOICE_ATTEMPTS;
        lockedUntil = locking ? now + LOCK_MS : null;
        const data = locking
          ? { wrong: 0, lockedUntil: new Date(lockedUntil!), dispute: null, disputedAt: null, resolvedAt: null, resolution: null, unlocked: false }
          : { wrong };
        await prisma.teamTaskLock.upsert({ where: lockWhere, create: { gameId: id, teamId: c.m.team.id, nodeKey, taskIndex: index, ...data }, update: data });
      }
    }
    publish(id, { type: "cities", teamId: c.m.team.id });
    if (correct) return { correct: true, fragment: c.node.cityCode?.[index] ?? null };
    return { correct: false, retryAt: now + WRONG_COOLDOWN_MS, lockedUntil, attemptsLeft: task.type === "choice" ? Math.max(0, CHOICE_ATTEMPTS - ((lock?.wrong ?? 0) + 1)) : null };
  });

  /** Сигнал «задание открыто на экране»: копит время чтения команды. Клиент шлёт раз в HEARTBEAT_MS, пока задание видно. */
  app.post("/api/games/:id/my-city/:nodeKey/tasks/:index/reading", async (request, reply) => {
    const { id, nodeKey, index: rawIndex } = request.params as { id: string; nodeKey: string; index: string };
    const c = await memberCity(request, reply, id, nodeKey);
    if (!c) return;
    if (!c.state.orderSolved) return reply.code(409).send({ error: "conflict", message: err(request, "Сначала расставьте районы по порядку") });
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || !c.content.tasks[index]) return reply.code(404).send({ error: "not_found", message: err(request, "Задание не найдено") });
    const required = await readingRequiredMs(c.content, index);
    const now = new Date();
    const where = { teamId_nodeKey_taskIndex: { teamId: c.m.team.id, nodeKey, taskIndex: index } };
    const prev = await prisma.teamTaskLock.findUnique({ where });
    // Засчитываем время с прошлого сигнала, но не больше двух интервалов: если вкладку закрыли, пауза не копится.
    const credit = prev?.readAt ? Math.min(HEARTBEAT_MAX_CREDIT_MS, Math.max(0, now.getTime() - prev.readAt.getTime())) : 0;
    const readMs = Math.min(required + HEARTBEAT_MAX_CREDIT_MS, (prev?.readMs ?? 0) + credit);
    await prisma.teamTaskLock.upsert({ where, create: { gameId: id, teamId: c.m.team.id, nodeKey, taskIndex: index, readMs, readAt: now }, update: { readMs, readAt: now } });
    return { readMs, requiredMs: required, heartbeatMs: HEARTBEAT_MS };
  });

  /** Оспорить блокировку задания: сообщение админам игры. Ответ придёт письмом/уведомлением и в попапе города. */
  app.post("/api/games/:id/my-city/:nodeKey/tasks/:index/dispute", async (request, reply) => {
    const { id, nodeKey, index: rawIndex } = request.params as { id: string; nodeKey: string; index: string };
    const c = await memberCity(request, reply, id, nodeKey);
    if (!c) return;
    const index = Number(rawIndex);
    const task = Number.isInteger(index) ? c.content.tasks[index] : undefined;
    if (!task) return reply.code(404).send({ error: "not_found", message: err(request, "Задание не найдено") });
    const body = disputeBody.parse(request.body);
    const lock = await prisma.teamTaskLock.findUnique({ where: { teamId_nodeKey_taskIndex: { teamId: c.m.team.id, nodeKey, taskIndex: index } } });
    if (!lock?.lockedUntil || lock.lockedUntil.getTime() <= Date.now()) return reply.code(409).send({ error: "conflict", message: err(request, "Задание не закрыто: оспаривать нечего") });
    if (lock.disputedAt && !lock.resolvedAt) return reply.code(409).send({ error: "conflict", message: err(request, "Спор уже отправлен: ждите ответа администратора") });
    await prisma.teamTaskLock.update({ where: { id: lock.id }, data: { dispute: body.message, disputedAt: new Date(), resolvedAt: null, resolution: null } });
    notifyAdmins(id, "спор по заданию города {book}", "Команда «{team}» оспаривает блокировку задания {n} города {book}: «{message}». Снимите блокировку или ответьте на вкладке «Проверка».", { book: c.node.bookCode ?? "", team: c.m.team.name, n: index + 1, message: body.message });
    publish(id, { type: "cities", teamId: c.m.team.id });
    publish(id, { type: "game" });
    return { ok: true };
  });

  /** Админ: открытые споры по заданиям (команда, город, задание, сообщение). */
  app.get("/api/games/:id/disputes", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const rows = await prisma.teamTaskLock.findMany({ where: { gameId: id, disputedAt: { not: null }, resolvedAt: null }, orderBy: { disputedAt: "asc" }, include: { team: { select: { id: true, name: true, color: true } } } });
    const nodes = await prisma.mapNode.findMany({ where: { gameId: id, key: { in: [...new Set(rows.map((r) => r.nodeKey))] } }, select: { key: true, bookCode: true } });
    const bookOf = new Map(nodes.map((n) => [n.key, n.bookCode ?? ""]));
    const disputes = await Promise.all(rows.map(async (r) => {
      const content = await loadCityContent(bookOf.get(r.nodeKey) ?? "");
      const task = content?.tasks[r.taskIndex];
      return { id: r.id, team: r.team, nodeKey: r.nodeKey, bookCode: bookOf.get(r.nodeKey) ?? "", taskIndex: r.taskIndex, prompt: task?.prompt ?? "", correct: task?.type === "choice" ? task.options[task.correct] ?? null : null, message: r.dispute, disputedAt: r.disputedAt, lockedUntil: r.lockedUntil };
    }));
    return { disputes };
  });

  /** Админ: решение по спору — снять блокировку (можно отвечать снова) или оставить, с ответом команде. */
  app.post("/api/games/:id/disputes/:lockId/resolve", async (request, reply) => {
    const { id, lockId } = request.params as { id: string; lockId: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const body = resolveBody.parse(request.body);
    const lock = await prisma.teamTaskLock.findFirst({ where: { id: lockId, gameId: id } });
    if (!lock) return reply.code(404).send({ error: "not_found", message: err(request, "Спор не найден") });
    if (lock.resolvedAt) return reply.code(409).send({ error: "conflict", message: err(request, "Спор уже решён") });
    await prisma.teamTaskLock.update({ where: { id: lock.id }, data: { resolvedAt: new Date(), resolution: body.answer || null, ...(body.unlock ? { lockedUntil: null, wrong: 0, unlocked: true } : {}) } });
    const node = await prisma.mapNode.findUnique({ where: { gameId_key: { gameId: id, key: lock.nodeKey } }, select: { bookCode: true } });
    notifyTeam(id, lock.teamId, "ответ администратора по заданию города {book}", (locale) => msg(locale, "Задание {n}: {verdict}{answer}", { n: lock.taskIndex + 1, verdict: body.unlock ? "блокировка снята, можно отвечать снова" : "блокировка оставлена до истечения суток", answer: body.answer ? msg(locale, " Ответ администратора: {answer}", { answer: body.answer }) : "" }), { book: node?.bookCode ?? "" });
    publish(id, { type: "cities", teamId: lock.teamId });
    publish(id, { type: "game" });
    return { ok: true };
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
    // Руины берутся без ключа: достаточно решённых заданий.
    if (!c.node.ruined && (!c.node.cityKey || body.key.toUpperCase().replace(/[\s-]/g, "") !== c.node.cityKey)) {
      await prisma.teamCityState.update({ where: { id: c.state.id }, data: { answerAttempts: { increment: 1 }, lastWrongAt: new Date() } });
      return reply.code(400).send({ error: "wrong_key", message: err(request, "Ключ не подходит. Проверьте буквы в конверте") });
    }
    const owner = await prisma.teamCityState.findFirst({ where: { gameId: id, nodeKey, capturedAt: { not: null } }, select: ownerSelect });
    if (owner) return reply.code(409).send({ error: "conflict", message: err(request, "Город уже принадлежит команде «{team}»", { team: owner.team.name }) });
    const hasCapital = await prisma.teamCityState.count({ where: { teamId: c.m.team.id, isCapital: true } });
    const updated = await prisma.teamCityState.update({ where: { id: c.state.id }, data: { capturedAt: new Date(), firstCapturedAt: c.state.firstCapturedAt ?? new Date(), isCapital: hasCapital === 0 } });
    if (c.node.ruined) await prisma.mapNode.update({ where: { id: c.node.id }, data: { ruined: false } });
    await onCityOwned(id, nodeKey, c.m.team.id);
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
    return {
      node: { key: node.key, bookCode: node.bookCode, cityType: node.cityType, cityKey: node.cityKey, cityCode: node.cityCode },
      content,
      teams: teams.map((t) => {
        const s = byTeam.get(t.id);
        return { ...t, orderSolved: s?.orderSolved ?? false, orderAttempts: s?.orderAttempts ?? 0, doneTasks: s?.doneTasks ?? [], answerAttempts: s?.answerAttempts ?? 0, capturedAt: s?.capturedAt ?? null, isCapital: s?.isCapital ?? false };
      }),
    };
  });
}
