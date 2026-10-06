import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { requireActiveMember, requireAdmin, requireMember, requireSuperadmin } from "./teamMap.js";
import { pauseAfter, rulesOf } from "../services/rules.js";
import { assertAwake, assertTasksOpen, gameDaytime } from "../services/daytime.js";
import { assignScreens, checkSeaAnswer, gameSeas, isTeamTask, loadSeaContent, oppositeShore, publicSeaTask, seaKeyOf, stripSeaAnswers, type SeaGeo, type TaskCtx } from "../services/seas.js";
import { revealNode } from "../services/teamMap.js";
import { err } from "../services/i18n.js";
import { journal, nick } from "../services/journal.js";
import { taskEvent } from "../services/behavior.js";

const answerBody = z.object({ answer: z.unknown() });
const holdBody = z.object({ taskIndex: z.number().int().min(0).max(20) });
/** Сколько держится отметка «держу экран»: зачёт получают те, кто отмечался не раньше, чем за столько мс до верного ответа. */
const HOLD_MS = 10 * 60 * 1000;
type Progress = Record<string, string[]>;
type Holds = Record<string, Record<string, number>>;

/**
 * Моря Библии (решение владельца 06.10): лист моря у команды (вахты, открытие, переправа) и просмотр у администратора.
 * Паузы после неверного ответа, личный зачёт и доля состава — те же, что у городов (nodeKey = «sea:<код>»).
 * Командные вахты: экраны раздаются по ролям, ответ вводит держатель экрана ввода, зачёт — всем, кто держал экран.
 */
export async function seaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);
  const secret = app.config.SESSION_SECRET;

  async function mySolved(gameId: string, teamId: string, userId: string, nodeKey: string): Promise<number[]> {
    const rows = await prisma.taskEvent.findMany({ where: { gameId, teamId, userId, nodeKey, kind: "ok", taskIndex: { not: null } }, select: { taskIndex: true }, distinct: ["taskIndex"] });
    return rows.map((r) => r.taskIndex!).sort((a, b) => a - b);
  }
  /** Доля состава (решение владельца 05.10, те же правила, что для ключа города): участник решил не меньше keyTasksPct вахт; таких не меньше keySolversPct состава. */
  async function solversOf(gameId: string, teamId: string, nodeKey: string, total: number, rules: { keySolversPct: number; keyTasksPct: number }) {
    const [rows, members] = await Promise.all([
      prisma.taskEvent.findMany({ where: { gameId, teamId, nodeKey, kind: "ok", taskIndex: { not: null } }, select: { userId: true, taskIndex: true }, distinct: ["userId", "taskIndex"] }),
      prisma.membership.count({ where: { teamId } }),
    ]);
    const needTasks = Math.max(1, Math.ceil(total * rules.keyTasksPct / 100));
    const perUser = new Map<string, number>();
    for (const r of rows) perUser.set(r.userId, (perUser.get(r.userId) ?? 0) + 1);
    const solvers = [...perUser.values()].filter((n) => n >= needTasks).length;
    return { solvers, members, needSolvers: Math.ceil(members * rules.keySolversPct / 100), needTasks };
  }
  async function seaOf(gameId: string, code: string): Promise<SeaGeo | null> {
    return (await gameSeas(gameId)).find((s) => s.code === code) ?? null;
  }
  async function membersOf(teamId: string): Promise<TaskCtx["members"]> {
    const rows = await prisma.membership.findMany({ where: { teamId }, orderBy: { joinedAt: "asc" }, select: { userId: true, role: true, gameRole: true, user: { select: { nickname: true, displayName: true } } } });
    return rows.map((m) => ({ userId: m.userId, nickname: m.user.displayName || m.user.nickname, role: m.role, gameRole: m.gameRole }));
  }
  /** Кто ведёт переправу: кормчий; без кормчего — капитан или заместитель (как при высадке с корабля). */
  async function canCross(teamId: string, m: { gameRole: string; role: string }): Promise<boolean> {
    const helmsmen = await prisma.membership.count({ where: { teamId, gameRole: "HELMSMAN" } });
    return m.gameRole === "HELMSMAN" || (helmsmen === 0 && (m.role === "CAPTAIN" || m.role === "DEPUTY"));
  }
  const progressOf = (state: { taskDrafts: unknown } | null, index: number): string[] => ((state?.taskDrafts as Progress | null) ?? {})[String(index)] ?? [];
  /** Кто держал экран вахты за последние HOLD_MS (для зачёта и для списка «на вахте»). */
  const holdersOf = (state: { holds: unknown } | null, index: number, now: number): string[] => Object.entries(((state?.holds as Holds | null) ?? {})[String(index)] ?? {}).filter(([, ts]) => now - ts <= HOLD_MS).map(([u]) => u);

  /** Море глазами команды: вахты, зачёт, переправа. Доступно, когда команда дошла до берега этого моря. */
  app.get("/api/games/:id/my-sea/:code", async (request, reply) => {
    const { id, code } = request.params as { id: string; code: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const sea = await seaOf(id, code);
    if (!sea) return reply.code(404).send({ error: "not_found", message: err(request, "Море не найдено") });
    const content = await loadSeaContent(code);
    const revealed = new Set((await prisma.teamNodeState.findMany({ where: { teamId: m.team.id, nodeKey: { in: sea.shore } }, select: { nodeKey: true } })).map((r) => r.nodeKey));
    const mine = sea.shore.filter((k) => revealed.has(k));
    const nodeKey = seaKeyOf(code);
    const [state, locks, game, members] = await Promise.all([
      prisma.teamSeaState.findUnique({ where: { teamId_seaCode: { teamId: m.team.id, seaCode: code } } }),
      prisma.teamTaskLock.findMany({ where: { teamId: m.team.id, nodeKey } }),
      prisma.game.findUniqueOrThrow({ where: { id }, select: { settings: true } }),
      membersOf(m.team.id),
    ]);
    const rules = rulesOf(game.settings);
    const total = content?.tasks.length ?? 0;
    const [solvers, my] = await Promise.all([solversOf(id, m.team.id, nodeKey, total, rules), mySolved(id, m.team.id, request.user!.id, nodeKey)]);
    const daytime = await gameDaytime(id);
    const scopeKey = `${m.team.id}|${nodeKey}`;
    const reached = mine.length > 0;
    const done = state?.doneTasks ?? [];
    const opened = Boolean(state?.openedAt);
    const now = Date.now();
    // Кандидаты переправы — по каждому своему берегу: противоположный берег, ещё не открытый команде.
    const allRevealed = opened && !state?.crossedAt ? new Set((await prisma.teamNodeState.findMany({ where: { teamId: m.team.id }, select: { nodeKey: true } })).map((r) => r.nodeKey)) : new Set<string>();
    const candidates: Record<string, string[]> = {};
    for (const from of mine) candidates[from] = oppositeShore(sea, from).filter((k) => !allRevealed.has(k));
    const tasks = content && reached && daytime.tasksOpen
      ? await Promise.all(content.tasks.map(async (t, i) => {
        const pub = await publicSeaTask(t, i, secret, scopeKey, content.chart, { userId: request.user!.id, members, progress: progressOf(state, i) });
        const holders = isTeamTask(t) ? holdersOf(state, i, now).map((u) => members.find((x) => x.userId === u)?.nickname ?? "").filter(Boolean) : [];
        return { ...pub, holders };
      }))
      : null;
    return {
      daytime,
      sea: { code: sea.code, name: content?.name ?? sea.name, nameEn: content?.nameEn ?? sea.nameEn, names: content?.names ?? [], intro: content?.intro ?? "", introEn: content?.introEn ?? "", chart: content?.chart ?? null },
      reached,
      content: tasks ? { tasks } : null,
      hasContent: content !== null,
      state: {
        doneTasks: done,
        total,
        openedAt: state?.openedAt ?? null,
        crossedAt: state?.crossedAt ?? null,
        crossTo: state?.crossTo ?? null,
        mySolved: my,
        ...solvers,
        pauseSteps: rules.pauseSteps,
        locks: locks.map((l) => ({ index: l.taskIndex, wrong: l.wrong, lockedUntil: l.lockedUntil && l.lockedUntil.getTime() > now ? l.lockedUntil.getTime() : null })),
      },
      crossing: { canCross: await canCross(m.team.id, m), from: mine, candidates },
    };
  });

  async function memberSea(request: Parameters<typeof requireMember>[0], reply: Parameters<typeof requireMember>[1], id: string, code: string, tasks: boolean) {
    const m = await requireActiveMember(request, reply, id);
    if (!m) return null;
    const game = await prisma.game.findUnique({ where: { id }, select: { status: true, settings: true } });
    if (game?.status !== "ACTIVE") { await reply.code(409).send({ error: "conflict", message: err(request, "Игра не идёт") }); return null; }
    const sea = await seaOf(id, code);
    if (!sea) { await reply.code(404).send({ error: "not_found", message: err(request, "Море не найдено") }); return null; }
    const content = await loadSeaContent(code);
    if (!content) { await reply.code(409).send({ error: "no_content", message: err(request, "Вахты этого моря ещё готовятся") }); return null; }
    const reached = await prisma.teamNodeState.count({ where: { teamId: m.team.id, nodeKey: { in: sea.shore } } });
    if (!reached) { await reply.code(403).send({ error: "forbidden", message: err(request, "Ваша команда ещё не дошла до берега этого моря") }); return null; }
    if (!(await (tasks ? assertTasksOpen : assertAwake)(request, reply, id))) return null;
    const state = await prisma.teamSeaState.upsert({ where: { teamId_seaCode: { teamId: m.team.id, seaCode: code } }, create: { gameId: id, teamId: m.team.id, seaCode: code }, update: {} });
    return { m, sea, content, state, rules: rulesOf(game.settings), nodeKey: seaKeyOf(code), scopeKey: `${m.team.id}|${seaKeyOf(code)}` };
  }

  /** «Держу экран»: участник на командной вахте отмечается раз в полминуты; отметка живёт HOLD_MS. */
  app.put("/api/games/:id/my-sea/:code/hold", async (request, reply) => {
    const { id, code } = request.params as { id: string; code: string };
    const c = await memberSea(request, reply, id, code, true);
    if (!c) return;
    const body = holdBody.parse(request.body);
    const task = c.content.tasks[body.taskIndex];
    if (!task || !isTeamTask(task)) return { ok: true };
    const holds = (c.state.holds as Holds | null) ?? {};
    const now = Date.now();
    const mine = Object.fromEntries(Object.entries(holds[String(body.taskIndex)] ?? {}).filter(([, ts]) => now - ts <= HOLD_MS));
    mine[request.user!.id] = now;
    await prisma.teamSeaState.update({ where: { id: c.state.id }, data: { holds: { ...holds, [String(body.taskIndex)]: mine } } });
    return { ok: true, holders: Object.keys(mine).length };
  });

  /** Ответ на вахту. Одиночные решает каждый сам (как в городе); командные зачитываются всем, кто держал экран. */
  app.post("/api/games/:id/my-sea/:code/tasks/:index/answer", async (request, reply) => {
    const { id, code, index: rawIndex } = request.params as { id: string; code: string; index: string };
    const c = await memberSea(request, reply, id, code, true);
    if (!c) return;
    const index = Number(rawIndex);
    const task = Number.isInteger(index) ? c.content.tasks[index] : undefined;
    if (!task) return reply.code(404).send({ error: "not_found", message: err(request, "Задание не найдено") });
    const teamDone = c.state.doneTasks.includes(index);
    const userId = request.user!.id;
    if ((await mySolved(id, c.m.team.id, userId, c.nodeKey)).includes(index)) return reply.code(409).send({ error: "conflict", message: err(request, "Вы уже решили это задание") });
    const team = isTeamTask(task);
    const members = team ? await membersOf(c.m.team.id) : [];
    if (team) {
      if (teamDone) return reply.code(409).send({ error: "conflict", message: err(request, "Командная вахта уже отстояна: её зачли всем, кто держал экран") });
      const screens = assignScreens(task, members, `${secret.slice(0, 16)}|${c.scopeKey}|team|${index}`);
      if (!(screens.get(userId) ?? []).includes("input")) return reply.code(403).send({ error: "forbidden", message: err(request, "Ответ вводит держатель экрана ввода (капитан)") });
    }
    const body = answerBody.parse(request.body);
    const now = Date.now();
    const lockWhere = { teamId_nodeKey_taskIndex: { teamId: c.m.team.id, nodeKey: c.nodeKey, taskIndex: index } };
    const lock = await prisma.teamTaskLock.findUnique({ where: lockWhere });
    if (lock?.lockedUntil && lock.lockedUntil.getTime() > now) {
      return reply.code(429).send({ error: "cooldown", message: err(request, "Отмычка остывает: подождите перед следующей попыткой"), retryAt: lock.lockedUntil.getTime() });
    }
    const progress = progressOf(c.state, index);
    const r = await checkSeaAnswer(task, index, secret, c.scopeKey, c.content.chart, body.answer, progress);
    // Кому зачёт: одиночная — отвечавшему; командная — всем, кто держал экран, и отвечавшему.
    const credited = team ? [...new Set([userId, ...holdersOf(c.state, index, now)])] : [userId];
    if (r.done) for (const u of credited) await taskEvent(id, c.m.team.id, u, c.nodeKey, index, "ok");
    else if (!r.ok) await taskEvent(id, c.m.team.id, userId, c.nodeKey, index, "wrong");
    let retryAt: number | null = null;
    if (r.ok) {
      if (lock) await prisma.teamTaskLock.update({ where: { id: lock.id }, data: { wrong: 0, lockedUntil: null } });
      const data: { doneTasks?: { push: number }; taskDrafts?: Progress } = {};
      if (r.done && !teamDone) data.doneTasks = { push: index };
      if (r.progress) data.taskDrafts = { ...((c.state.taskDrafts as Progress | null) ?? {}), [String(index)]: r.progress };
      if (Object.keys(data).length) await prisma.teamSeaState.update({ where: { id: c.state.id }, data });
    } else {
      const wrong = (lock?.wrong ?? 0) + 1;
      retryAt = now + pauseAfter(c.rules, wrong);
      const data = { wrong, lockedUntil: new Date(retryAt) };
      await prisma.teamTaskLock.upsert({ where: lockWhere, create: { gameId: id, teamId: c.m.team.id, nodeKey: c.nodeKey, taskIndex: index, ...data }, update: data });
    }
    let opened = false;
    if (r.done && !c.state.openedAt) {
      // Море открывается, когда все вахты решены командой и не меньше доли состава решили свою долю.
      const done = new Set([...c.state.doneTasks, index]);
      if (c.content.tasks.every((_, i) => done.has(i))) {
        const s = await solversOf(id, c.m.team.id, c.nodeKey, c.content.tasks.length, c.rules);
        if (s.solvers >= s.needSolvers) {
          await prisma.teamSeaState.update({ where: { id: c.state.id }, data: { openedAt: new Date() } });
          opened = true;
          journal(id, "sea_opened", { everyone: true, teamId: c.m.team.id, userId, vars: { team: c.m.team.name, sea: c.content.name } });
          publish(id, { type: "map", teamId: c.m.team.id });
        }
      }
    }
    publish(id, { type: "cities", teamId: c.m.team.id });
    if (r.done && !teamDone) journal(id, "watch_solved", { teamId: c.m.team.id, userId, vars: { user: team ? members.filter((x) => credited.includes(x.userId)).map((x) => x.nickname).join(", ") : await nick(userId), n: index + 1, sea: c.content.name } });
    if (r.done) return { correct: true, personal: teamDone, opened, credited: credited.length };
    if (r.ok) return { correct: false, accepted: true, ...r.info };
    return { correct: false, retryAt, wrong: (lock?.wrong ?? 0) + 1 };
  });

  /** Переправа через открытое море: со своего берега на противоположный, один раз. Ведёт кормчий (или капитан без кормчего). */
  app.post("/api/games/:id/my-sea/:code/cross", async (request, reply) => {
    const { id, code } = request.params as { id: string; code: string };
    const c = await memberSea(request, reply, id, code, false);
    if (!c) return;
    if (!(await canCross(c.m.team.id, c.m))) return reply.code(403).send({ error: "forbidden", message: err(request, "Переправу ведёт кормчий: капитан и команда ему советуют") });
    if (!c.state.openedAt) return reply.code(409).send({ error: "conflict", message: err(request, "Море ещё не открыто: решите все вахты") });
    if (c.state.crossedAt) return reply.code(409).send({ error: "conflict", message: err(request, "Это море команда уже переходила") });
    const body = z.object({ from: z.string().min(3).max(40), to: z.string().min(3).max(40) }).parse(request.body);
    const revealed = new Set((await prisma.teamNodeState.findMany({ where: { teamId: c.m.team.id }, select: { nodeKey: true } })).map((r) => r.nodeKey));
    if (!c.sea.shore.includes(body.from) || !revealed.has(body.from)) return reply.code(409).send({ error: "conflict", message: err(request, "Отплыть можно только со своего берега этого моря") });
    const candidates = oppositeShore(c.sea, body.from).filter((k) => !revealed.has(k));
    if (!candidates.includes(body.to)) return reply.code(409).send({ error: "conflict", message: err(request, "Высадиться можно только на противоположный берег, ещё не открытый команде") });
    await prisma.teamSeaState.update({ where: { id: c.state.id }, data: { crossedAt: new Date(), crossFrom: body.from, crossTo: body.to } });
    await revealNode(id, c.m.team.id, body.to);
    journal(id, "sea_crossed", { teamId: c.m.team.id, userId: request.user!.id, vars: { user: await nick(request.user!.id), sea: c.content.name } });
    publish(id, { type: "map", teamId: c.m.team.id });
    publish(id, { type: "tasks", teamId: c.m.team.id });
    return { ok: true };
  });

  /** Админ: моря игры с ходом каждой команды. */
  app.get("/api/games/:id/seas", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const [seas, states, teams] = await Promise.all([gameSeas(id), prisma.teamSeaState.findMany({ where: { gameId: id } }), prisma.team.findMany({ where: { gameId: id }, orderBy: { index: "asc" }, select: { id: true, name: true, color: true, index: true } })]);
    return { seas: await Promise.all(seas.map(async (s) => ({ code: s.code, name: s.name, nameEn: s.nameEn, hexes: s.hexes, shore: s.shore, total: (await loadSeaContent(s.code))?.tasks.length ?? 0, teams: teams.map((t) => { const st = states.find((x) => x.teamId === t.id && x.seaCode === s.code); return { ...t, done: st?.doneTasks.length ?? 0, openedAt: st?.openedAt ?? null, crossedAt: st?.crossedAt ?? null, crossTo: st?.crossTo ?? null }; }) }))) };
  });

  /** Админ: море целиком — вахты (ответы только администратору платформы) и ход команд. */
  app.get("/api/games/:id/seas/:code", async (request, reply) => {
    const { id, code } = request.params as { id: string; code: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const sea = await seaOf(id, code);
    if (!sea) return reply.code(404).send({ error: "not_found", message: err(request, "Море не найдено") });
    const [content, states, teams] = await Promise.all([loadSeaContent(code), prisma.teamSeaState.findMany({ where: { gameId: id, seaCode: code } }), prisma.team.findMany({ where: { gameId: id }, orderBy: { index: "asc" }, select: { id: true, name: true, color: true, index: true } })]);
    const superadmin = request.user!.platformRole === "SUPERADMIN";
    return {
      sea: { code: sea.code, name: content?.name ?? sea.name, nameEn: content?.nameEn ?? sea.nameEn, names: content?.names ?? [], intro: content?.intro ?? "", shore: sea.shore.length },
      content: content ? (superadmin ? content : stripSeaAnswers(content)) : null,
      answersHidden: !superadmin,
      teams: teams.map((t) => { const st = states.find((x) => x.teamId === t.id); return { ...t, doneTasks: st?.doneTasks ?? [], openedAt: st?.openedAt ?? null, crossedAt: st?.crossedAt ?? null, crossFrom: st?.crossFrom ?? null, crossTo: st?.crossTo ?? null }; }),
    };
  });

  /** Админ (для тестов): зачесть команде все вахты моря — море открыто. */
  app.post("/api/games/:id/seas/:code/study", async (request, reply) => {
    const { id, code } = request.params as { id: string; code: string };
    if (!(await requireAdmin(request, reply, id))) return;
    if (!requireSuperadmin(request, reply)) return;
    const body = z.object({ teamId: z.string().min(1) }).parse(request.body);
    const [content, team, sea] = await Promise.all([loadSeaContent(code), prisma.team.findFirst({ where: { id: body.teamId, gameId: id } }), seaOf(id, code)]);
    if (!content || !team || !sea) return reply.code(404).send({ error: "not_found", message: err(request, "Море или команда не найдены") });
    const all = content.tasks.map((_, i) => i);
    await prisma.teamSeaState.upsert({ where: { teamId_seaCode: { teamId: team.id, seaCode: code } }, create: { gameId: id, teamId: team.id, seaCode: code, doneTasks: all, openedAt: new Date() }, update: { doneTasks: all, openedAt: new Date() } });
    publish(id, { type: "map", teamId: team.id });
    return { ok: true };
  });
}
