import { prisma } from "../db.js";
import { rulesOf } from "./rules.js";
import { dayKey } from "./activity.js";

/**
 * Темп партии (решение владельца 23.10: «тот чарт — в аналитику игры»; уточнение: «оставить логистическую кривую,
 * факт и прогноз», плюс «график с количеством дел в день»): города накопительно, факт и прогноз, когда вся карта будет
 * занята. Перенос отчёта pace-report: темп после разгона и логистическая кривая с потолком K (прогноз Монте-Карло убран
 * по решению владельца 23.10: «оставим только логистическую кривую»). Дела в день — принятые дела на сторонах и общие
 * дела Каменоломни по командам.
 * Время — сутки от старта.
 */
const DAY = 86_400_000;
interface Pt { day: number; value: number }

export async function paceForecast(gameId: string) {
  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId }, select: { startedAt: true, createdAt: true, settings: true, status: true, finishedAt: true } });
  const tz = rulesOf(game.settings).timeZone;
  const start = game.startedAt ?? game.createdAt;
  const end = game.finishedAt ?? new Date();
  const T = Math.max((end.getTime() - start.getTime()) / DAY, 0.5);
  const dayOf = (d: Date) => (d.getTime() - start.getTime()) / DAY;
  const [K, teams, rows, states] = await Promise.all([
    prisma.mapNode.count({ where: { gameId, kind: "CITY" } }),
    prisma.team.findMany({ where: { gameId }, select: { id: true, name: true, color: true }, orderBy: { index: "asc" } }),
    prisma.journal.findMany({ where: { gameId, kind: { in: ["city_captured", "task_solved", "deed_approved", "quarry_approved"] } }, select: { kind: true, teamId: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.teamCityState.findMany({ where: { gameId, capturedAt: { not: null } }, select: { doneTasks: true, isCapital: true } }),
  ]);
  const caps = rows.filter((r) => r.kind === "city_captured").map((r) => ({ day: dayOf(r.createdAt), at: r.createdAt, teamId: r.teamId }));
  const n = caps.length;
  // Дни партии по поясу игры: задания по дням и командам, взятия по дням.
  const days: string[] = []; for (let t = start.getTime(); t <= end.getTime(); t += DAY) days.push(dayKey(new Date(t), tz));
  if (days[days.length - 1] !== dayKey(end, tz)) days.push(dayKey(end, tz));
  const tasksByDay = new Map<string, Map<string, number>>(days.map((d) => [d, new Map()]));
  const capsByDay = new Map<string, number>(days.map((d) => [d, 0]));
  const deedsByDay = new Map<string, Map<string, number>>(days.map((d) => [d, new Map()]));
  const bump = (map: Map<string, Map<string, number>>, d: string, teamId: string) => { const m = map.get(d); if (m) m.set(teamId, (m.get(teamId) ?? 0) + 1); };
  for (const r of rows) {
    const d = dayKey(r.createdAt, tz);
    if (r.kind === "task_solved" && r.teamId) bump(tasksByDay, d, r.teamId);
    else if ((r.kind === "deed_approved" || r.kind === "quarry_approved") && r.teamId) bump(deedsByDay, d, r.teamId);
    else if (r.kind === "city_captured") capsByDay.set(d, (capsByDay.get(d) ?? 0) + 1);
  }
  // Разгон: с первого дня, когда взяли не меньше двух городов; иначе с начала.
  let rampDay = 0; for (const d of days) if ((capsByDay.get(d) ?? 0) >= 2) { rampDay = Math.max(0, days.indexOf(d)); break; }
  const steady = days.slice(1, -1).filter((_, i) => i + 1 >= rampDay);
  const capsSteady = caps.filter((c) => c.day >= rampDay).length;
  const rate = capsSteady / Math.max(T - rampDay, 0.5);
  const milestones = [Math.floor(K / 2), Math.floor(K * 0.95), K];
  // Логистика с потолком K по дневной сетке.
  const grid = Array.from({ length: Math.floor(T) + 1 }, (_, i) => i);
  const cum = grid.map((g) => caps.filter((c) => c.day <= g).length);
  let best = { sse: Infinity, r: 0.3, t0: 10 };
  for (let r = 0.05; r <= 1.5; r += 0.01) for (let t0 = 0; t0 <= 60; t0 += 0.5) { let sse = 0; for (let i = 0; i < grid.length; i++) { const p = K / (1 + Math.exp(-r * (grid[i]! - t0))); sse += (p - cum[i]!) ** 2; } if (sse < best.sse) best = { sse, r, t0 }; }
  const logisticAt = (m: number) => { const f = Math.min(m / K, 0.999); return best.t0 - Math.log(1 / f - 1) / best.r; };
  const teamTasks = teams.map((t) => steady.map((d) => tasksByDay.get(d)?.get(t.id) ?? 0));
  const dailyTasksAvg = teamTasks.reduce((a, v) => a + (v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0), 0);
  const horizon = 120;
  // Тренд дел в день считает клиент по выбранным в легенде командам; сервер сообщает число полных дней для подбора —
  // текущий неполный день в прямую не входит.
  const fitDays = game.finishedAt ? days.length : days.length - 1;
  const logistic: Pt[] = []; for (let d = 0; d <= T + horizon; d += 1) logistic.push({ day: d, value: K / (1 + Math.exp(-best.r * (d - best.t0))) });
  return {
    tz, startedAt: start, now: end, T, K, n, rate, rampDay, dailyTasksAvg, milestones,
    teams,
    fact: caps.map((c, i) => ({ day: c.day, value: i + 1, teamId: c.teamId })),
    deeds: { days, teams: teams.map((t) => ({ id: t.id, name: t.name, color: t.color, values: days.map((d) => deedsByDay.get(d)?.get(t.id) ?? 0) })), fitDays },
    logistic: { r: best.r, t0: best.t0, curve: logistic, finish: Object.fromEntries(milestones.map((m) => [m, m <= n ? null : logisticAt(m)])) },
  };
}
