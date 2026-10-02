import { prisma } from "../db.js";

/**
 * Раздел «Поведение» (решение владельца 02.10): сигналы, по которым администратор может заметить ответы с помощью ИИ.
 * Сервер только собирает факты: события заданий (TaskEvent) и моменты решений из летописи; выводы делает человек.
 */
export type TaskEventKind = "open" | "away" | "ok" | "wrong";

export async function taskEvent(gameId: string, teamId: string, userId: string, nodeKey: string, taskIndex: number | null, kind: TaskEventKind, awayMs: number | null = null): Promise<void> {
  try { await prisma.taskEvent.create({ data: { gameId, teamId, userId, nodeKey, taskIndex, kind, awayMs } }); } catch { /* сбор событий не должен ломать ответ */ }
}

/** Строка выгрузки по участнику: без имени и id — только номер участника и номер команды (решение владельца 02.10: имена людей никуда не выносятся). */
export interface BehaviorUser {
  participant: number; team: number;
  /** Ник участника — только по запросу `?names=1` (разрешение владельца 02.10 на разбор «Осени» с никами). */
  name?: string;
  /** Моменты верных решений заданий района (мс), из летописи — есть с начала игры. */
  solves: number[];
  /** Моменты собранных порядков районов (мс). */
  orders: number[];
  /** Из событий заданий (есть с момента включения сбора): открытий задания, верных и неверных ответов, выходов из приложения и их длительности (мс). */
  opens: number; ok: number; wrong: number; away: number[];
}

/**
 * Выгрузка для разбора вне игры: администратор открывает адрес в браузере и пересылает JSON. Участники пронумерованы
 * в порядке команд и id (номера стабильны между выгрузками, пока состав не меняется), имён и id в выгрузке нет.
 */
export async function behaviorReport(gameId: string, withNames = false) {
  const [teams, journal, events, states] = await Promise.all([
    prisma.team.findMany({ where: { gameId }, orderBy: { index: "asc" }, select: { id: true, name: true, members: { select: { userId: true, user: { select: { nickname: true, displayName: true } } }, orderBy: { userId: "asc" } } } }),
    prisma.journal.findMany({ where: { gameId, kind: { in: ["task_solved", "order_solved"] }, userId: { not: null } }, select: { userId: true, kind: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.taskEvent.findMany({ where: { gameId }, select: { userId: true, kind: true, awayMs: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.teamCityState.findMany({ where: { gameId }, select: { teamId: true, doneTasks: true, answerAttempts: true, orderAttempts: true, orderSolved: true } }),
  ]);
  const users = new Map<string, BehaviorUser>();
  let n = 0;
  teams.forEach((tm, ti) => { for (const m of tm.members) users.set(m.userId, { participant: ++n, team: ti + 1, ...(withNames ? { name: m.user.displayName || m.user.nickname } : {}), solves: [], orders: [], opens: 0, ok: 0, wrong: 0, away: [] }); });
  for (const r of journal) { const u = users.get(r.userId!); if (!u) continue; (r.kind === "task_solved" ? u.solves : u.orders).push(r.createdAt.getTime()); }
  for (const e of events) {
    const u = users.get(e.userId); if (!u) continue;
    if (e.kind === "open") u.opens++; else if (e.kind === "ok") u.ok++; else if (e.kind === "wrong") u.wrong++; else if (e.kind === "away") u.away.push(e.awayMs ?? 0);
  }
  const teamRows = teams.map((tm, ti) => {
    const st = states.filter((s) => s.teamId === tm.id);
    return { team: ti + 1, name: tm.name, done: st.reduce((a, s) => a + s.doneTasks.length, 0), wrong: st.reduce((a, s) => a + s.answerAttempts, 0), ordersSolved: st.filter((s) => s.orderSolved).length, orderAttempts: st.reduce((a, s) => a + s.orderAttempts, 0) };
  });
  return { users: [...users.values()], teams: teamRows, eventsSince: events[0]?.createdAt.toISOString() ?? null };
}
