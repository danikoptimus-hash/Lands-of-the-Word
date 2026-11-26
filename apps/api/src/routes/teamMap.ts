import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { gameMembership } from "../services/membership.js";
import { scheduleAwards } from "../services/awards.js";
import { z } from "zod";
import { prisma } from "../db.js";
import { assertAwake, assertTasksOpen, gameDaytime } from "../services/daytime.js";
import { publish } from "../services/events.js";
import { publishRoad } from "../services/eventScope.js";
import { requireUser } from "../auth.js";
import { getTeamMap, isSeaKey, landingCandidates, revealNode, withDeedBook, bookOfNodeKey, deedLimitsFor, birdFor, assignActive, assignView, type DeedLimit } from "../services/teamMap.js";
import { loadCityContent } from "../services/cities.js";
import { notifyAdmins, notifyTeam, notifyUser } from "../services/notify.js";
import { bookName, err, msg, fmtDay, toLocale } from "../services/i18n.js";
import { journal, nick } from "../services/journal.js";
import { gameRules } from "../services/battles.js";
import { adminOrObserver } from "../services/access.js";
import { paceForecast } from "../services/pace.js";
import { brickRef } from "../services/wall.js";
import { loadBook } from "../services/bible.js";
import { WIRE, wireTasks } from "../services/mapWire.js";
import { staticMap } from "../services/gameMap.js";
import { byTask, locked, withLock } from "../services/lock.js";
import { victoryOf } from "../services/game.js";

const submitBody = z.object({
  links: z.array(z.string().trim().url().max(500)).max(10).default([]),
  note: z.string().trim().max(2000).default(""),
  /** Кто участвовал в деле группой (id участников команды): каждому засчитывается в личное служение, сторона одна. */
  participants: z.array(z.string().min(1)).max(50).default([]),
  /** На кого записать дело (решение владельца 22.10): капитан, заместитель или летописец сдают групповое дело и выбирают основного; дело идёт в его лимит. */
  mainId: z.string().min(1).optional(),
});
const decideBody = z.object({ approve: z.boolean(), comment: z.string().trim().max(1000).default("") });


/** Лимит дел в сутки для участника: сколько взято с последних 7:00 по поясу игры и когда счёт обнулится. null — лимита нет. */
async function deedLimitFor(gameId: string, userId: string, excludeTaskId?: string): Promise<DeedLimit | null> {
  const max = (await gameRules(gameId)).maxDeedsPerDay;
  if (!max) return null;
  return (await deedLimitsFor(gameId, max, [userId], excludeTaskId)).get(userId) ?? null;
}
/** «через 3 ч 20 мин» / «через 15 мин» для сообщения о лимите. */
function untilText(request: Parameters<typeof err>[0], at: number): string {
  const mins = Math.max(1, Math.ceil((at - Date.now()) / 60_000)), h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? err(request, "{h} ч {m} мин", { h, m }) : err(request, "{m} мин", { m });
}

/** «Своя» команда участника в игре: из двух (выбывшая и новая, решение владельца 10.11) — та, что в строю (services/membership.ts). */
export async function requireMember(request: FastifyRequest, reply: FastifyReply, gameId: string) {
  const m = await gameMembership(request.user!.id, gameId);
  if (!m) { await reply.code(403).send({ error: "forbidden", message: err(request, "Вы не состоите в команде этой игры") }); return null; }
  return m;
}
/** Капитан или заместитель: ведут команду (вызов, ставка, отправка, столица, высадка). */
export const isLeader = (m: { role: string }) => m.role === "CAPTAIN" || m.role === "DEPUTY";

/** Участник команды, которая ещё в игре: выбывшая команда заморожена до перевода участников (решение владельца 18.09). */
export async function requireActiveMember(request: FastifyRequest, reply: FastifyReply, gameId: string) {
  const m = await requireMember(request, reply, gameId);
  if (!m) return null;
  if (m.team.status === "defeated") { await reply.code(409).send({ error: "conflict", message: err(request, "Команда выбыла из игры: вступите в другую команду по её приглашению") }); return null; }
  return m;
}
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply, gameId: string) {
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { admins: { select: { userId: true } } } });
  if (!game) { await reply.code(404).send({ error: "not_found", message: err(request, "Игра не найдена") }); return null; }
  if (!adminOrObserver(request, game.admins)) { await reply.code(403).send({ error: "forbidden", message: err(request, "Вы не администратор этой игры") }); return null; }
  return game;
}

/** Тестовые действия и ответы на задания — только администратору платформы (решение владельца). */
export function requireSuperadmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.user!.platformRole === "SUPERADMIN") return true;
  void reply.code(403).send({ error: "forbidden", message: err(request, "Только для администратора платформы") });
  return false;
}

const taskInclude = {
  deed: { select: { id: true, title: true, description: true, direction: true, proofType: true, secret: true, remote: true, chance: true } },
  team: { select: { id: true, name: true, color: true, avatarId: true } },
  person: { select: { id: true, name: true } },
} as const;
type TaskWithDeed = { id: string; fromKey: string; deed: { title: string; description: string } };
type SecretTask = { takenById: string | null; links: string[]; note: string; deed: { secret: boolean } };
/** Тайное дело: ссылки и описание сдачи видит только тот, кто его взял (и администратор в проверке). */
function hideSecret<T extends SecretTask>(task: T, viewerId: string): T {
  return task.deed.secret && task.takenById !== viewerId ? { ...task, links: [], note: "" } : task;
}
/** В тексте дела [Книга] → книга города, из которого выходит сторона. */
async function bookIn<T extends TaskWithDeed>(gameId: string, task: T): Promise<T> {
  return { ...task, deed: withDeedBook(task.deed, await bookOfNodeKey(gameId, task.fromKey), task.id) };
}
async function bookInAll<T extends TaskWithDeed>(gameId: string, tasks: T[]): Promise<T[]> {
  const nodes = await prisma.mapNode.findMany({ where: { gameId, key: { in: [...new Set(tasks.map((t) => t.fromKey))] } }, select: { key: true, bookCode: true } });
  const book = new Map(nodes.map((n) => [n.key, n.bookCode ?? null]));
  return tasks.map((t) => ({ ...t, deed: withDeedBook(t.deed, book.get(t.fromKey) ?? null, t.id) }));
}

export async function teamMapRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  /** Полёт клина птиц: момент всегда, узел города — только в окне полёта (см. birdView). Клиент спрашивает к назначенной минуте. */
  app.get("/api/games/:id/my-map/bird", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    return { bird: await birdFor(id, m.team.id) };
  });

  /** Карта моей команды: открытые узлы, туман, рёбра, дела. */
  /**
   * Пункт «Внимание» прочитан (решение владельца 07.11): отметка своя у каждого участника. Один пункт — { kind, refId };
   * кнопка «Очистить всё» (решение владельца 16.11) шлёт сразу список — { items: [...] }. Вид passage — запрос прохода:
   * его убирает из своего списка только тот, кто на запрос ответить не вправе (для него это известие, а не дело).
   */
  app.post("/api/games/:id/attention/seen", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const one = z.object({ kind: z.enum(["quarry", "wreck", "arrival", "passage"]), refId: z.string().min(1).max(64) });
    const body = z.union([one, z.object({ items: z.array(one).min(1).max(300) })]).parse(request.body);
    const items = "items" in body ? body.items : [body];
    await prisma.attentionSeen.createMany({ data: items.map((x) => ({ userId: request.user!.id, gameId: id, kind: x.kind, refId: x.refId })), skipDuplicates: true });
    return { ok: true };
  });

  app.get("/api/games/:id/my-map", async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const game = await prisma.game.findUniqueOrThrow({ where: { id }, select: { status: true, name: true, settings: true, startedAt: true, victoryAt: true, victoryTeamId: true } });
    if (game.status === "DRAFT") return { status: game.status, gameName: game.name, team: { id: m.team.id, name: m.team.name, color: m.team.color }, hexes: [], revealed: [], edges: [], tasks: [], cities: [], peeked: [], victory: null };
    // Всё, что маршрут добавляет к карте, запрашивается разом (ревизия скорости, этап 2): раньше тринадцать обращений к базе
    // шли одно за другим, а маршрут вызывается чаще всех — каждой сверкой каждого приложения.
    const userId = request.user!.id, teamId = m.team.id, since = new Date(Date.now() - 14 * 86_400_000), recent = new Date(Date.now() - 3 * 86_400_000);
    const [map, deedLimit, daytime, visitRows, rejected, seen, myCityRows, quarryRows, geo] = await Promise.all([
      getTeamMap(id, teamId),
      deedLimitFor(id, userId),
      // Время суток игры (решение владельца 03.10): карта красится по фазе и поясу, ночью действия закрыты.
      gameDaytime(id),
      // Открытые отчёты о визитах (решение владельца 22.10): команде — метка на городе и пункт «требует внимания».
      prisma.cityVisit.findMany({ where: { teamId, status: { in: ["PENDING", "SUBMITTED"] } }, select: { id: true, nodeKey: true, bookCode: true, status: true, dueAt: true } }),
      // Возвращённые администратором блоки стены (решение владельца 04.11: возврат — в «Внимание»): свои, за две недели,
      // пока тот же блок не сдан заново; записи испытаний клиент берёт из my-battles.
      prisma.wallBlock.findMany({ where: { teamId, userId, status: "REJECTED", decidedAt: { gte: since } }, orderBy: { decidedAt: "desc" }, select: { id: true, nodeKey: true, bookCode: true, startIdx: true, endIdx: true, adminComment: true, decidedAt: true, createdAt: true, repairOfId: true } }),
      // Прочитанные пункты (решение владельца 07.11): нажатый пункт исчезает только у этого участника, не у всей команды.
      prisma.attentionSeen.findMany({ where: { userId, gameId: id }, select: { kind: true, refId: true } }),
      prisma.teamCityState.findMany({ where: { teamId, capturedAt: { not: null } }, select: { nodeKey: true } }),
      // Новые дела Каменоломни (решение владельца 06.11: уведомление в «Внимание»): появились за трое суток, команда их ещё не сдавала.
      prisma.deed.findMany({ where: { gameId: id, quarry: true, disabled: false, createdAt: { gte: recent }, quarryWorks: { none: { teamId, status: { in: ["SUBMITTED", "APPROVED"] } } } }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, createdAt: true } }),
      staticMap(id),
    ]);
    const deedsFrozenUntil = m.deedsFrozenUntil && m.deedsFrozenUntil.getTime() > Date.now() ? m.deedsFrozenUntil : null;
    const visits = visitRows.filter((v) => v.status !== "PENDING" || v.dueAt.getTime() > Date.now());
    const seenQuarry = new Set(seen.filter((x) => x.kind === "quarry").map((x) => x.refId));
    const seenWrecks = seen.filter((x) => x.kind === "wreck").map((x) => x.refId);
    // Запросы прохода, которые участник убрал из «Внимания» кнопкой «Очистить всё»: приложение прячет их, только пока он не вправе отвечать.
    const seenPassages = seen.filter((x) => x.kind === "passage").map((x) => x.refId);
    // К своему городу подошла чужая команда (решение владельца 07.11: вместо шатров на карте — push, уведомление и пункт
    // «Внимание»): чужие одобренные дела, ведущие в наш взятый город, за трое суток; прочитанный пункт исчезает у прочитавшего.
    const seenArrivals = new Set(seen.filter((x) => x.kind === "arrival").map((x) => x.refId));
    const myCities = myCityRows.map((c) => c.nodeKey);
    const arrivalRows = myCities.length === 0 ? [] : (await prisma.teamEdgeTask.findMany({ where: { gameId: id, status: "APPROVED", NOT: { teamId }, toKey: { in: myCities }, decidedAt: { gte: recent } }, orderBy: { decidedAt: "desc" }, select: { id: true, toKey: true, sea: true, decidedAt: true, team: { select: { id: true, name: true, color: true, avatarId: true } } } })).filter((a) => !seenArrivals.has(a.id));
    // Книги городов — из неизменной карты партии в памяти сервера (services/gameMap.ts), без запроса.
    const bookOf = new Map(geo.nodes.map((n) => [n.key, n.bookCode ?? ""]));
    const arrivals = arrivalRows.map((a) => ({ id: a.id, nodeKey: a.toKey, bookCode: bookOf.get(a.toKey) ?? "", book: bookName(bookOf.get(a.toKey) ?? ""), sea: a.sea, at: (a.decidedAt ?? new Date()).toISOString(), team: a.team }));
    const quarryNew = quarryRows.filter((d) => !seenQuarry.has(d.id)).map((d) => ({ id: d.id, title: d.title, createdAt: d.createdAt.toISOString() }));
    const returnedBlocks: Array<{ id: string; nodeKey: string; bookCode: string; ref: string; comment: string; at: string }> = [];
    for (const r of rejected) {
      const redone = await prisma.wallBlock.count({ where: { teamId, userId, nodeKey: r.nodeKey, startIdx: r.startIdx, status: { not: "REJECTED" }, createdAt: { gt: r.createdAt } } });
      if (redone > 0) continue;
      const book = await loadBook(r.bookCode);
      returnedBlocks.push({ id: r.id, nodeKey: r.nodeKey, bookCode: r.bookCode, ref: (book ? brickRef(book, r.startIdx, r.endIdx) : "") + (r.repairOfId ? " (починка)" : ""), comment: r.adminComment, at: (r.decidedAt ?? r.createdAt).toISOString() });
    }
    // То, что маршрут добавляет к общей карте команды: личное и по часам (лимит дел, заморозка, «Внимание», время суток).
    // Камни и груз команды — из уже прочитанного членства (раньше команда читалась из базы второй раз).
    // Празднование победы (решение владельца 26.11): салют видят все — и победители, и выбывшие; null — не празднуют.
    const own = { returnedBlocks, quarryNew, seenWrecks, seenPassages, arrivals, victory: victoryOf(game), status: game.status, startedAt: game.startedAt, gameName: game.name, deedLimit, deedsFrozenUntil, visits, deedsFrozenReason: deedsFrozenUntil ? m.deedsFrozenReason : null, daytime, team: { id: m.team.id, name: m.team.name, color: m.team.color, avatarId: m.team.avatarId, startNodeKey: m.team.startNodeKey, stones: m.team.stones, cargoBlocks: m.team.cargoBlocks } };
    // У приложения уже эта версия карты (ревизия скорости, этап 2): отдаём только добавки — около килобайта вместо всей
    // карты. Так приложение сверяется с сервером без скачивания карты; саму карту оно получает «разницей» по событиям.
    const have = Number((request.query as { have?: string }).have);
    if (Number.isFinite(have) && have === map.rev) return { same: true, rev: map.rev, now: Date.now(), ...own };
    const tasks = map.tasks.map((t) => hideSecret(t, request.user!.id));
    // Приложение новой версии просит карту со справочником текстов дел (services/mapWire.ts): ответ на треть меньше.
    if (request.headers["x-lotw-wire"] === WIRE) return { ...own, ...map, ...wireTasks(tasks) };
    return { ...own, ...map, tasks };
  });

  /** Администратор: карта глазами команды — ровно то, что видит она (туман, стороны, метки дел), без действий. */
  app.get("/api/games/:id/teams/:teamId/map", async (request, reply) => {
    const { id, teamId } = request.params as { id: string; teamId: string };
    const game = await requireAdmin(request, reply, id);
    if (!game) return;
    const team = await prisma.team.findFirst({ where: { id: teamId, gameId: id }, select: { id: true, name: true, color: true, avatarId: true, startNodeKey: true, index: true } });
    if (!team) return reply.code(404).send({ error: "not_found", message: err(request, "Команда не найдена") });
    const teamOut = { id: team.id, name: team.name, color: team.color, startNodeKey: team.startNodeKey };
    if (game.status === "DRAFT") return { status: game.status, teamIndex: team.index, team: teamOut, hexes: [], revealed: [], edges: [], tasks: [], cities: [], peeked: [], victory: null };
    const map = await getTeamMap(id, team.id);
    // Участники — чтобы в карточке дела «глазами команды» показать, кто его взял.
    const members = (await prisma.membership.findMany({ where: { teamId: team.id }, select: { user: { select: { id: true, nickname: true, displayName: true } } } })).map((m) => m.user);
    // Тайные дела: сдачи скрыты и здесь — администратор смотрит их во вкладке проверки.
    return { status: game.status, teamIndex: team.index, team: teamOut, ...map, members, tasks: map.tasks.map((t) => hideSecret(t, "")), victory: victoryOf(game) };
  });

  app.post("/api/games/:id/edge-tasks/:taskId/take", locked((r) => ["take:" + r.user!.id, byTask(r)], async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    // Взять дело можно до полуночи, как и решать задания города (решение владельца 04.10); сдача и разведка ждут утра.
    if (!(await assertTasksOpen(request, reply, id))) return;
    const task = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, teamId: m.team.id } });
    if (!task) return reply.code(404).send({ error: "not_found", message: err(request, "Дело не найдено") });
    if (task.status !== "OPEN" && task.status !== "REJECTED") return reply.code(409).send({ error: "conflict", message: err(request, "Дело уже взято или сдано") });
    // Поручение (решение владельца 14.11): пока держится бронь, дело берёт только тот, кому оно поручено.
    if (assignActive(task) && task.assignedToId !== request.user!.id) {
      return reply.code(409).send({ error: "assigned", message: err(request, "Дело поручено: {name}. Пока держится бронь, другим его не взять", { name: await nick(task.assignedToId!) }) });
    }
    // Заморозка администратором (решение владельца 21.10): взять новое дело нельзя до указанной даты.
    if (m.deedsFrozenUntil && m.deedsFrozenUntil.getTime() > Date.now()) return reply.code(409).send({ error: "frozen", message: err(request, "Администратор закрыл вам взятие дел до {date}", { date: fmtDay(m.deedsFrozenUntil, toLocale(request.user?.locale)) }) });
    // Лимит дел в сутки на участника (решение владельца 02.10): превысил — взять (забронировать) нельзя, пусть берут другие.
    // Своё возвращённое дело в счёт лимита уже входит, и взять его заново для пересдачи можно всегда (решение владельца 29.10).
    const own = task.status === "REJECTED" && task.takenById === request.user!.id;
    const limit = await deedLimitFor(id, request.user!.id, own ? task.id : undefined);
    if (limit && limit.taken >= limit.max) return reply.code(409).send({ error: "conflict", message: err(request, "В сутки можно взять не больше {n} дел. Счёт обнулится в 7:00, через {when}", { n: limit.max, when: untilText(request, limit.nextAt ?? Date.now()) }) });
    const updated = await bookIn(id, await prisma.teamEdgeTask.update({ where: { id: taskId }, data: { status: "TAKEN", takenById: request.user!.id, takenAt: new Date(), assignedToId: null, assignedById: null, assignedAt: null }, include: taskInclude }));
    publish(id, { type: "tasks", teamId: m.team.id });
    return { task: hideSecret(updated, request.user!.id) };
  }));

  app.post("/api/games/:id/edge-tasks/:taskId/release", locked(byTask, async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    // Отказаться от дела можно до полуночи, как и взять (решение владельца 15.11: «до 00 часов, а не до 22»); с 0:00 до 7:00 — 409 `night`.
    if (!(await assertTasksOpen(request, reply, id))) return;
    const task = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, teamId: m.team.id } });
    if (!task || task.status !== "TAKEN") return reply.code(409).send({ error: "conflict", message: err(request, "Дело не взято: отпускать нечего") });
    if (task.takenById !== request.user!.id && !isLeader(m) && m.gameRole !== "CHRONICLER") return reply.code(403).send({ error: "forbidden", message: err(request, "Отпустить дело может тот, кто взял, капитан или летописец") });
    const updated = await bookIn(id, await prisma.teamEdgeTask.update({ where: { id: taskId }, data: { status: "OPEN", takenById: null, takenAt: null }, include: taskInclude }));
    publish(id, { type: "tasks", teamId: m.team.id });
    return { task: hideSecret(updated, request.user!.id) };
  }));

  /**
   * Приоритет капитана (решение владельца 14.11, по просьбе капитана: «чтобы не объяснять каждому, какие дела брать»):
   * капитан или заместитель отмечает дело команды как приоритетное — у всей команды его свиток на карте горит. Отметка
   * ничего не меняет в правилах: взять и сдать дело может тот же, кто и раньше. Принятое дело отметить нельзя; при
   * принятии отметка снимается сама.
   */
  app.post("/api/games/:id/edge-tasks/:taskId/priority", async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    const body = z.object({ on: z.boolean() }).parse(request.body);
    if (!isLeader(m)) return reply.code(403).send({ error: "forbidden", message: err(request, "Отметить дело приоритетным может капитан или заместитель") });
    const task = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, teamId: m.team.id } });
    if (!task) return reply.code(404).send({ error: "not_found", message: err(request, "Дело не найдено") });
    if (body.on && (task.status === "APPROVED" || task.paved)) return reply.code(409).send({ error: "conflict", message: err(request, "Дело уже принято: отмечать нечего") });
    const updated = await bookIn(id, await prisma.teamEdgeTask.update({ where: { id: taskId }, data: body.on ? { priorityAt: new Date(), priorityById: request.user!.id } : { priorityAt: null, priorityById: null }, include: taskInclude }));
    publish(id, { type: "tasks", teamId: m.team.id });
    return { task: hideSecret(updated, request.user!.id) };
  });

  /**
   * Поручение дела (решение владельца 14.11, по просьбе капитана: «чтобы я мог дело выбрать и назначить кому-то, чтобы
   * ему пришло уведомление» — вместо снимка с кружком в чате; владелец: «первый вариант, бронь сутки»). Капитан или
   * заместитель поручает свободное дело участнику своей команды: сутки взять его может только он. Участнику уходит
   * уведомление со ссылкой прямо на это дело и личная запись в летописи. `userId: null` снимает поручение.
   * Правила взятия не меняются: суточный лимит дел и заморозка действуют, как обычно, в момент взятия.
   */
  app.post("/api/games/:id/edge-tasks/:taskId/assign", locked(byTask, async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    const body = z.object({ userId: z.string().min(1).max(40).nullable() }).parse(request.body);
    if (!isLeader(m)) return reply.code(403).send({ error: "forbidden", message: err(request, "Поручить дело может капитан или заместитель") });
    const task = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, teamId: m.team.id }, include: { deed: { select: { title: true } } } });
    if (!task) return reply.code(404).send({ error: "not_found", message: err(request, "Дело не найдено") });
    const me = request.user!.id;
    if (body.userId) {
      if (task.status !== "OPEN") return reply.code(409).send({ error: "conflict", message: err(request, "Поручить можно только свободное дело") });
      if (body.userId === me) return reply.code(400).send({ error: "validation", message: err(request, "Себе дело не поручают: возьмите его сами") });
      const target = await prisma.membership.findUnique({ where: { teamId_userId: { teamId: m.team.id, userId: body.userId } }, select: { userId: true } });
      if (!target) return reply.code(404).send({ error: "not_found", message: err(request, "Такого участника в команде нет") });
    }
    const updated = await bookIn(id, await prisma.teamEdgeTask.update({ where: { id: taskId }, data: body.userId ? { assignedToId: body.userId, assignedById: me, assignedAt: new Date() } : { assignedToId: null, assignedById: null, assignedAt: null }, include: taskInclude }));
    publish(id, { type: "tasks", teamId: m.team.id });
    if (body.userId) {
      const who = await nick(me);
      // Уведомление ведёт прямо на дело: карточка откроется, карта покажет его сторону.
      notifyUser(id, body.userId, "вам поручили дело", "{who} поручил(а) вам дело «{deed}». Возьмите его в течение суток: до тех пор его не возьмёт никто другой.", { who, deed: updated.deed.title }, { footer: "Открыть дело", query: `?task=${task.id}` });
      // teamId — чтобы событие летописи ушло только своей команде: личная запись без него будила всю партию (ревизия, этап 2).
      journal(id, "deed_assigned", { userId: body.userId, teamId: m.team.id, personal: true, vars: { who, deed: updated.deed.title, taskId: task.id } });
    }
    return { task: { ...hideSecret(updated, me), ...assignView(updated) } };
  }));

  /** Отказ от поручения: участник не может взять порученное дело — бронь снимается, поручивший узнаёт об этом. */
  app.post("/api/games/:id/edge-tasks/:taskId/assign/decline", locked(byTask, async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    const task = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, teamId: m.team.id }, include: { deed: { select: { title: true } } } });
    if (!task) return reply.code(404).send({ error: "not_found", message: err(request, "Дело не найдено") });
    const me = request.user!.id;
    if (!assignActive(task) || task.assignedToId !== me) return reply.code(409).send({ error: "conflict", message: err(request, "Это дело вам не поручено") });
    const updated = await bookIn(id, await prisma.teamEdgeTask.update({ where: { id: taskId }, data: { assignedToId: null, assignedById: null, assignedAt: null }, include: taskInclude }));
    publish(id, { type: "tasks", teamId: m.team.id });
    if (task.assignedById) {
      const user = await nick(me);
      notifyUser(id, task.assignedById, "поручение не принято", "{user} не может взять дело «{deed}». Дело снова свободно для всей команды.", { user, deed: updated.deed.title }, { footer: "Открыть дело", query: `?task=${task.id}` });
      journal(id, "deed_assign_declined", { userId: task.assignedById, teamId: m.team.id, personal: true, vars: { user, deed: updated.deed.title, taskId: task.id } });
    }
    return { task: { ...hideSecret(updated, me), ...assignView(updated) } };
  }));

  /** Сдача дела: ссылки на фото/видео и текст. Файлы не принимаем. */
  app.post("/api/games/:id/edge-tasks/:taskId/submit", locked(byTask, async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    if (!(await assertAwake(request, reply, id))) return;
    const body = submitBody.parse(request.body);
    const task = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, teamId: m.team.id }, include: { deed: true } });
    if (!task) return reply.code(404).send({ error: "not_found", message: err(request, "Дело не найдено") });
    if (task.status === "SUBMITTED" || task.status === "APPROVED") return reply.code(409).send({ error: "conflict", message: err(request, "Дело уже сдано") });
    // Сдаёт тот, кто взял дело, капитан или летописец (2.15).
    if (task.takenById && task.takenById !== request.user!.id && !isLeader(m) && m.gameRole !== "CHRONICLER") return reply.code(403).send({ error: "forbidden", message: err(request, "Сдать чужое дело может только капитан или летописец") });
    // Обязательное (решение владельца 14.11): без того, чего требует дело, сдать нельзя — фото, видео и аудиозапись
    // сдаются ссылкой, отчёт — текстом, свидетель — именем того, кто подтвердит.
    const proofType = task.deed.proofType;
    const needsLink = proofType === "PHOTO_LINK" || proofType === "VIDEO_LINK" || proofType === "AUDIO_LINK";
    if (needsLink && body.links.length === 0) return reply.code(400).send({ error: "validation", message: proofType === "AUDIO_LINK" ? err(request, "Для этого дела нужна ссылка на аудиозапись") : err(request, "Для этого дела нужна хотя бы одна ссылка на фото или видео") });
    // Свидетель (решение владельца 04.10): дело подтверждает человек, который это видел; его имя — в тексте сдачи.
    if (task.deed.proofType === "WITNESS" && body.note.trim().length < 2) return reply.code(400).send({ error: "validation", message: err(request, "Укажите, кто может подтвердить") });
    if (!needsLink && proofType !== "WITNESS" && body.note.trim().length < 5) return reply.code(400).send({ error: "validation", message: err(request, "Опишите, что сделано") });
    // Участники дела группой: только свои, всегда включая сдающего/взявшего.
    const members = new Set((await prisma.membership.findMany({ where: { teamId: m.team.id }, select: { userId: true } })).map((x) => x.userId));
    // На кого записать дело (решение владельца 22.10): капитан, заместитель или летописец, сдавая групповое дело, выбирают
    // основного — дело записывается на него и идёт в его лимит; остальные — участники, их лимит не тратится.
    // Дело без взятия записывается на сдающего. Сверх лимита основного сдать нельзя: «запишите на другого».
    const canAssign = isLeader(m) || m.gameRole === "CHRONICLER";
    const mainId = canAssign && body.mainId && members.has(body.mainId) ? body.mainId : task.takenById ?? request.user!.id;
    if (mainId !== task.takenById) {
      const limit = await deedLimitFor(id, mainId);
      if (limit && limit.taken >= limit.max) return reply.code(409).send({ error: "limit", message: mainId === request.user!.id ? err(request, "В сутки можно взять не больше {n} дел. Счёт обнулится в 7:00, через {when}", { n: limit.max, when: untilText(request, limit.nextAt ?? Date.now()) }) : err(request, "У участника {name} за сутки уже {n} дел, лимит {max}: запишите дело на другого", { name: await nick(mainId), n: limit.taken, max: limit.max }) });
    }
    const participants = [...new Set([mainId, ...body.participants.filter((u) => members.has(u))])];
    const updated = await prisma.teamEdgeTask.update({
      where: { id: taskId },
      data: { status: "SUBMITTED", takenById: mainId, takenAt: task.takenAt ?? new Date(), links: body.links, note: body.note, participants, submittedAt: new Date(), adminComment: "" },
      include: taskInclude,
    }).then((u) => bookIn(id, u));
    publish(id, { type: "submissions", teamId: m.team.id });
    journal(id, "deed_submitted", { teamId: m.team.id, userId: request.user!.id, vars: { user: await nick(request.user!.id), deed: updated.deed.title, taskId: task.id } });
    // Письмо администраторам — сразу или дайджестом по расписанию (решение владельца 18.09, A-13).
    if ((await gameRules(id)).adminDigest === "instant") notifyAdmins(id, "новая сдача дела", (locale) => msg(locale, "Команда «{team}» сдала дело «{deed}». Нужно проверить и одобрить или вернуть.", { team: m.team.name, deed: updated.deed.title }));
    return { task: hideSecret(updated, request.user!.id) };
  }));

  /**
   * Отчёты по делам для администратора (решение владельца 30.09): к старому отчёту нужно возвращаться. Полный вид сдачи —
   * кто взял и участвовал, ссылки, текст, решение — отдаётся по id дела (из летописи) или по стороне (нажатие на дорогу).
   */
  async function adminTaskViews(gameId: string, rows: Array<{ id: string; fromKey: string; toKey: string; status: string; sea: boolean; takenById: string | null; takenAt: Date | null; participants: string[]; person: { id: string; name: string } | null; links: string[]; note: string; adminComment: string; submittedAt: Date | null; decidedAt: Date | null; decidedById: string | null; createdAt: Date; team: { id: string; name: string; color: string }; deed: { id: string; title: string; description: string; direction: string; proofType: string; secret: boolean; remote: boolean } }>) {
    const ids = new Set<string>();
    for (const r of rows) { if (r.takenById) ids.add(r.takenById); if (r.decidedById) ids.add(r.decidedById); for (const p of r.participants) ids.add(p); }
    const users = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, nickname: true, displayName: true } });
    const name = new Map(users.map((u) => [u.id, u.displayName || u.nickname]));
    const withBooks = await bookInAll(gameId, rows);
    return withBooks.map((r) => ({
      id: r.id, fromKey: r.fromKey, toKey: r.toKey, status: r.status, sea: r.sea, team: r.team, deed: r.deed, person: r.person,
      takenBy: r.takenById ? { id: r.takenById, name: name.get(r.takenById) ?? "" } : null,
      participants: r.participants.map((pid) => ({ id: pid, name: name.get(pid) ?? "" })),
      links: r.links, note: r.note,
      takenAt: r.takenAt, submittedAt: r.submittedAt, decidedAt: r.decidedAt, decidedBy: r.decidedById ? name.get(r.decidedById) ?? "" : null, adminComment: r.adminComment, createdAt: r.createdAt,
    }));
  }
  /** Одно дело со всей сдачей (из летописи). */
  app.get("/api/games/:id/edge-tasks/:taskId", async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const row = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, gameId: id }, include: taskInclude });
    if (!row) return reply.code(404).send({ error: "not_found", message: err(request, "Дело не найдено") });
    return { task: (await adminTaskViews(id, [row]))[0] };
  });
  /** Все дела на стороне (в обе стороны) у всех команд, кроме ещё не взятых: нажатие на дорогу на карте администратора. */
  app.get("/api/games/:id/edge-tasks", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const q = z.object({ a: z.string().min(1), b: z.string().min(1) }).parse(request.query);
    const rows = await prisma.teamEdgeTask.findMany({ where: { gameId: id, status: { not: "OPEN" }, OR: [{ fromKey: q.a, toKey: q.b }, { fromKey: q.b, toKey: q.a }] }, include: taskInclude, orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }] });
    return { tasks: await adminTaskViews(id, rows) };
  });

  /** Очередь сдач для админа. */
  app.get("/api/games/:id/submissions", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const status = ((request.query as { status?: string }).status ?? "SUBMITTED") as "SUBMITTED" | "APPROVED" | "REJECTED";
    const tasks = await bookInAll(id, await prisma.teamEdgeTask.findMany({ where: { gameId: id, status }, include: taskInclude, orderBy: { submittedAt: "asc" }, take: 200 }));
    // Кто взял и кто участвовал (дела группой): администратору нужны имена, а не id (замечание владельца 30.09).
    const ids = new Set<string>();
    for (const t of tasks) { if (t.takenById) ids.add(t.takenById); for (const pid of t.participants) ids.add(pid); }
    const users = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, nickname: true, displayName: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return { tasks: tasks.map((t) => ({ ...t, takenBy: t.takenById ? byId.get(t.takenById) ?? null : null, participantNames: t.participants.filter((pid) => pid !== t.takenById).map((pid) => { const u = byId.get(pid); return u ? u.displayName || u.nickname : ""; }).filter(Boolean) })) };
  });

  /** Решение по сдаче: одобрить (узел за ребром открывается) или вернуть на доработку. Общее для одиночного и пакетного решения. */
  /**
   * К чужому городу подошли (решение владельца 07.11: «шатры были для того, чтобы показывать, что к городу подошли; теперь
   * сделаем это через раздел „Внимание“»): после открытия узла, если это чужой взятый город, хранители получают push,
   * уведомление и запись летописи; пункт «Внимание» строится в my-map из одобренного дела и уходит после прочтения.
   */
  async function approached(id: string, teamId: string, nodeKey: string): Promise<void> {
    const node = await prisma.mapNode.findUnique({ where: { gameId_key: { gameId: id, key: nodeKey } }, select: { kind: true, bookCode: true } });
    if (!node || node.kind !== "CITY") return;
    const owner = await prisma.teamCityState.findFirst({ where: { gameId: id, nodeKey, capturedAt: { not: null }, NOT: { teamId } }, select: { teamId: true } });
    if (!owner) return;
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { name: true } });
    journal(id, "city_approached", { teamId: owner.teamId, vars: { team: team?.name ?? "?", book: node.bookCode ?? "" } });
    notifyTeam(id, owner.teamId, "к городу {book} подошла команда «{team}»", "Команда «{team}» подошла к вашему городу {book}: теперь она может бросить ему вызов.", { team: team?.name ?? "?", book: node.bookCode ?? "" });
    publish(id, { type: "map", teamId: owner.teamId });
  }
  // Решение по сдаче — в очереди на это дело (services/lock.ts): двойное нажатие «Принять» или два администратора разом
  // не дадут двух записей в летописи и двух уведомлений; участник в ту же секунду не «отзовёт» уже принятое дело.
  type Decided = { ok: true; task: unknown } | { ok: false; code: 404 | 409; message: string };
  const decideTask = (id: string, taskId: string, body: { approve: boolean; comment: string }, adminId: string): Promise<Decided> => withLock("task:" + taskId, () => decideTaskNow(id, taskId, body, adminId));
  async function decideTaskNow(id: string, taskId: string, body: { approve: boolean; comment: string }, adminId: string): Promise<Decided> {
    const task = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, gameId: id } });
    if (!task) return { ok: false, code: 404, message: "Сдача не найдена" };
    // Пересмотр (решение владельца 05.10): возвращённое по ошибке дело можно принять, пока команда его не пересдала.
    const reconsider = body.approve && task.status === "REJECTED";
    if (task.status !== "SUBMITTED" && !reconsider) return { ok: false, code: 409, message: "Эта сдача уже рассмотрена" };
    const request = { user: { id: adminId } };
    const updated = await prisma.teamEdgeTask.update({
      where: { id: taskId },
      // Принятое дело больше не приоритет: отметка капитана снимается.
      data: { status: body.approve ? "APPROVED" : "REJECTED", decidedAt: new Date(), decidedById: request.user!.id, adminComment: body.comment, ...(body.approve ? { priorityAt: null, priorityById: null } : {}) },
      include: taskInclude,
    }).then((u) => bookIn(id, u));
    if (body.approve) journal(id, "deed_approved", { teamId: task.teamId, userId: task.takenById, vars: { deed: updated.deed.title, who: "", taskId: task.id } });
    else journal(id, "deed_returned", { teamId: task.teamId, userId: task.takenById, vars: { deed: updated.deed.title, taskId: task.id, comment: body.comment ? `: ${body.comment}` : "" } });
    scheduleAwards(id);
    // Морское дело: узел не открывается — кормчий сам выбирает место высадки на другом острове.
    if (body.approve && task.sea) { journal(id, "ship_ready", { teamId: task.teamId, vars: { deed: updated.deed.title } }); notifyTeam(id, task.teamId, "корабль готов к отплытию", (locale) => msg(locale, "Дело «{deed}» одобрено. Капитан или кормчий может выбрать на карте, куда высадиться на другом острове.", { deed: updated.deed.title })); }
    else if (body.approve) {
      await revealNode(id, task.teamId, task.toKey);
      await approached(id, task.teamId, task.toKey);
      // Уведомление об одобрении дела (решение владельца 18.09): раньше команда узнавала о зачёте, только открыв карту.
      notifyTeam(id, task.teamId, "дело одобрено: открыт перекрёсток", (locale) => msg(locale, "Дело «{deed}» принято. Перекрёсток за стороной открыт: на карте новые стороны и дела.", { deed: updated.deed.title }));
    }
    else if (task.takenById) notifyUser(id, task.takenById, "дело вернули на доработку", (locale) => msg(locale, "Администратор вернул дело «{deed}».{comment}", { deed: updated.deed.title, comment: body.comment ? msg(locale, " Комментарий: {comment}", { comment: body.comment }) : "" }));
    publish(id, { type: "submissions", teamId: task.teamId });
    publish(id, { type: "tasks", teamId: task.teamId });
    // Принятое дело — новая пройденная сторона: её видят команды, у которых открыт любой её конец (чужая дорога на карте).
    // Раньше им об этом не сообщалось вовсе — карта догоняла при следующем скачивании раз в минуту (ревизия, этап 2).
    if (body.approve && !task.sea) void publishRoad(id, [task.fromKey, task.toKey], task.teamId);
    return { ok: true, task: updated };
  }
  app.post("/api/games/:id/edge-tasks/:taskId/decide", async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const body = decideBody.parse(request.body);
    const r = await decideTask(id, taskId, body, request.user!.id);
    if (!r.ok) return reply.code(r.code).send({ error: r.code === 404 ? "not_found" : "conflict", message: err(request, r.message) });
    return { task: r.task };
  });
  /** Пакетное решение (решение владельца 18.09, A-03): одно решение для нескольких однотипных сдач. */
  app.post("/api/games/:id/edge-tasks/decide-batch", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const body = z.object({ ids: z.array(z.string().min(1)).min(1).max(50), approve: z.boolean(), comment: z.string().trim().max(1000).default("") }).parse(request.body);
    let done = 0, skipped = 0;
    for (const taskId of body.ids) { const r = await decideTask(id, taskId, body, request.user!.id); if (r.ok) done++; else skipped++; }
    return { done, skipped };
  });

  /** Высадка: капитан или кормчий выбирает пустой береговой узел другого острова; узел открывается, как после обычного дела. */
  app.post("/api/games/:id/edge-tasks/:taskId/land", locked(byTask, async (request, reply) => {
    const { id, taskId } = request.params as { id: string; taskId: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    // Место высадки выбирает кормчий, капитан и команда ему советуют (решение владельца 03.10). Если кормчего в команде нет, выбирает капитан или заместитель.
    const helmsmen = await prisma.membership.count({ where: { teamId: m.team.id, gameRole: "HELMSMAN" } });
    if (m.gameRole !== "HELMSMAN" && (helmsmen > 0 || !isLeader(m))) return reply.code(403).send({ error: "forbidden", message: err(request, "Место высадки выбирает кормчий: капитан и команда ему советуют") });
    const body = z.object({ nodeKey: z.string().min(3).max(40) }).parse(request.body);
    const task = await prisma.teamEdgeTask.findFirst({ where: { id: taskId, teamId: m.team.id } });
    if (!task || !task.sea) return reply.code(404).send({ error: "not_found", message: err(request, "Морское дело не найдено") });
    if (task.status !== "APPROVED" || !isSeaKey(task.toKey)) return reply.code(409).send({ error: "conflict", message: err(request, "Корабль ещё не готов или уже высадился") });
    const candidates = await landingCandidates(id, m.team.id, task.fromKey, task.id);
    if (!candidates.includes(body.nodeKey)) return reply.code(409).send({ error: "conflict", message: err(request, "Высадиться можно только на одну из предложенных пристаней другого острова") });
    await prisma.teamEdgeTask.update({ where: { id: taskId }, data: { toKey: body.nodeKey } });
    await revealNode(id, m.team.id, body.nodeKey);
    await approached(id, m.team.id, body.nodeKey);
    journal(id, "sea_landed", { teamId: m.team.id, userId: request.user!.id, vars: { user: await nick(request.user!.id) } });
    scheduleAwards(id);
    publish(id, { type: "map", teamId: m.team.id });
    publish(id, { type: "tasks", teamId: m.team.id });
    // Морская сторона получила место высадки: её видят команды, у которых открыт порт или пристань.
    void publishRoad(id, [task.fromKey, body.nodeKey], m.team.id);
    return { ok: true };
  }));

  /** Прогресс всех команд для карты админа: открытые узлы и пройденные рёбра по командам. */
  /** Админ (для тестов и разбора ситуаций): открыть команде узел; ведущая к нему сторона считается пройденной. */
  app.post("/api/games/:id/teams/:teamId/reveal", async (request, reply) => {
    const { id, teamId } = request.params as { id: string; teamId: string };
    const game = await requireAdmin(request, reply, id);
    if (!game) return;
    if (!requireSuperadmin(request, reply)) return;
    if (game.status !== "ACTIVE") return reply.code(409).send({ error: "conflict", message: err(request, "Игра не идёт") });
    const body = z.object({ nodeKey: z.string().min(3).max(40) }).parse(request.body);
    const [team, node] = await Promise.all([
      prisma.team.findFirst({ where: { id: teamId, gameId: id } }),
      prisma.mapNode.findUnique({ where: { gameId_key: { gameId: id, key: body.nodeKey } } }),
    ]);
    if (!team || !node) return reply.code(404).send({ error: "not_found", message: err(request, "Команда или перекрёсток не найдены") });
    const already = await prisma.teamNodeState.findUnique({ where: { teamId_nodeKey: { teamId, nodeKey: body.nodeKey } } });
    if (already) return reply.code(409).send({ error: "conflict", message: err(request, "Перекрёсток уже открыт этой команде") });
    const task = await prisma.teamEdgeTask.findFirst({ where: { teamId, toKey: body.nodeKey, status: { not: "APPROVED" } }, orderBy: { createdAt: "asc" } });
    if (task) await prisma.teamEdgeTask.update({ where: { id: task.id }, data: { status: "APPROVED", decidedAt: new Date(), decidedById: request.user!.id, adminComment: "Открыто администратором" } });
    await revealNode(id, teamId, body.nodeKey);
    publish(id, { type: "map", teamId });
    publish(id, { type: "tasks", teamId });
    void publishRoad(id, task ? [task.fromKey, body.nodeKey] : [body.nodeKey], teamId);
    return { ok: true, viaTask: Boolean(task) };
  });

  /** Администратор игры: темп партии — города накопительно, факт и прогноз (решение владельца 23.10). */
  app.get("/api/games/:id/analytics/pace", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    return paceForecast(id);
  });

  app.get("/api/games/:id/progress", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const teams = await prisma.team.findMany({
      where: { gameId: id },
      orderBy: { index: "asc" },
      select: { id: true, index: true, name: true, color: true, avatarId: true, startNodeKey: true, triumphAt: true, nodeStates: { select: { nodeKey: true, revealedAt: true } }, edgeTasks: { where: { status: "APPROVED" }, select: { fromKey: true, toKey: true, decidedAt: true, createdAt: true } } },
    });
    const [pending, game] = await Promise.all([
      prisma.teamEdgeTask.count({ where: { gameId: id, status: "SUBMITTED" } }),
      prisma.game.findUnique({ where: { id }, select: { startedAt: true, status: true, settings: true, victoryAt: true, victoryTeamId: true } }),
    ]);
    // Даты нужны для ползунка времени на карте админа: состояние на любой день игры.
    const cityStates = await prisma.teamCityState.findMany({ where: { gameId: id }, select: { teamId: true, nodeKey: true, orderSolved: true, doneTasks: true, capturedAt: true, isCapital: true } });
    const battles = await prisma.battle.findMany({ where: { gameId: id, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } }, select: { id: true, nodeKey: true, status: true, attackerId: true, defenderId: true, bid: true } });
    return {
      pending,
      startedAt: game?.startedAt ?? null,
      // Празднование победы (решение владельца 26.11): салют и у администратора.
      victory: game ? victoryOf(game) : null,
      battles,
      cities: cityStates.map((s) => ({ teamId: s.teamId, nodeKey: s.nodeKey, orderSolved: s.orderSolved, done: s.doneTasks.length, capturedAt: s.capturedAt?.toISOString() ?? null, isCapital: s.isCapital })),
      teams: teams.map((t) => ({
        id: t.id, index: t.index, name: t.name, color: t.color, avatarId: t.avatarId, startNodeKey: t.startNodeKey,
        // Салют над всеми городами команды, взявшей чужую столицу, — и у администратора тоже (замечание владельца 08.11).
        triumphAt: t.triumphAt?.toISOString() ?? null,
        revealed: t.nodeStates.map((n) => n.nodeKey),
        revealedAt: t.nodeStates.map((n) => n.revealedAt.toISOString()),
        // Морское дело до высадки ведёт «в море» — такой отрезок не рисуем.
        traversed: t.edgeTasks.filter((e) => !isSeaKey(e.toKey)).map((e) => ({ fromKey: e.fromKey, toKey: e.toKey, at: (e.decidedAt ?? e.createdAt).toISOString() })),
      })),
    };
  });
}
