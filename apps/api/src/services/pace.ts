import { prisma } from "../db.js";
import { rulesOf } from "./rules.js";
import { dayKey } from "./activity.js";

/**
 * Темп партии (решение владельца 23.10: «тот чарт — в аналитику игры»): города накопительно, факт и прогноз, когда
 * вся карта будет занята. Перенос отчёта pace-report: линейный темп после разгона, логистическая кривая с потолком K
 * и три сценария методом Монте-Карло («как сейчас», «карта сопротивляется», «запал гаснет»). Время — сутки от старта.
 */
const DAY = 86_400_000;
interface Pt { day: number; value: number }
/** Простой детерминированный генератор: прогноз не меняется от перезагрузки страницы. */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const pct = (xs: number[], q: number) => { const a = [...xs].sort((x, y) => x - y); if (!a.length) return Infinity; const i = Math.min(a.length - 1, Math.max(0, Math.round((q / 100) * (a.length - 1)))); return a[i]!; };

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
    prisma.journal.findMany({ where: { gameId, kind: { in: ["city_captured", "task_solved"] } }, select: { kind: true, teamId: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.teamCityState.findMany({ where: { gameId, capturedAt: { not: null } }, select: { doneTasks: true, isCapital: true } }),
  ]);
  const caps = rows.filter((r) => r.kind === "city_captured").map((r) => ({ day: dayOf(r.createdAt), at: r.createdAt, teamId: r.teamId }));
  const n = caps.length;
  // Дни партии по поясу игры: задания по дням и командам, взятия по дням.
  const days: string[] = []; for (let t = start.getTime(); t <= end.getTime(); t += DAY) days.push(dayKey(new Date(t), tz));
  if (days[days.length - 1] !== dayKey(end, tz)) days.push(dayKey(end, tz));
  const tasksByDay = new Map<string, Map<string, number>>(days.map((d) => [d, new Map()]));
  const capsByDay = new Map<string, number>(days.map((d) => [d, 0]));
  for (const r of rows) { const d = dayKey(r.createdAt, tz); if (r.kind === "task_solved" && r.teamId) { const m = tasksByDay.get(d); if (m) m.set(r.teamId, (m.get(r.teamId) ?? 0) + 1); } else if (r.kind === "city_captured") capsByDay.set(d, (capsByDay.get(d) ?? 0) + 1); }
  // Разгон: с первого дня, когда взяли не меньше двух городов; иначе с начала.
  let rampDay = 0; for (const d of days) if ((capsByDay.get(d) ?? 0) >= 2) { rampDay = Math.max(0, days.indexOf(d)); break; }
  const steady = days.slice(1, -1).filter((_, i) => i + 1 >= rampDay);
  const capsSteady = caps.filter((c) => c.day >= rampDay).length;
  const rate = capsSteady / Math.max(T - rampDay, 0.5);
  const milestones = [Math.floor(K / 2), Math.floor(K * 0.95), K];
  const linear: Record<number, number | null> = {}; for (const m of milestones) linear[m] = m <= n ? null : rate > 0 ? T + (m - n) / rate : null;
  // Логистика с потолком K по дневной сетке.
  const grid = Array.from({ length: Math.floor(T) + 1 }, (_, i) => i);
  const cum = grid.map((g) => caps.filter((c) => c.day <= g).length);
  let best = { sse: Infinity, r: 0.3, t0: 10 };
  for (let r = 0.05; r <= 1.5; r += 0.01) for (let t0 = 0; t0 <= 60; t0 += 0.5) { let sse = 0; for (let i = 0; i < grid.length; i++) { const p = K / (1 + Math.exp(-r * (grid[i]! - t0))); sse += (p - cum[i]!) ** 2; } if (sse < best.sse) best = { sse, r, t0 }; }
  const logisticAt = (m: number) => { const f = Math.min(m / K, 0.999); return best.t0 - Math.log(1 / f - 1) / best.r; };
  // Сценарии: каждый день каждая команда решает столько заданий, сколько в случайный полный день после разгона;
  // город стоит случайное число заданий из взятых (не столиц); «сопротивление» — доля свободных городов; «угасание» — минус 15 % в неделю.
  const teamTasks = teams.map((t) => steady.map((d) => tasksByDay.get(d)?.get(t.id) ?? 0));
  const costPool = states.filter((s) => !s.isCapital).map((s) => s.doneTasks.length).filter((x) => x > 0);
  if (!costPool.length) costPool.push(17);
  const dailyTasksAvg = teamTasks.reduce((a, v) => a + (v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0), 0);
  const horizon = 120;
  const scenarios = [{ name: "Как сейчас", gamma: 0, decay: 1 }, { name: "Карта сопротивляется", gamma: 1, decay: 1 }, { name: "Запал гаснет", gamma: 1, decay: 0.85 }].map((sc, si) => {
    const rand = rng(7 + si);
    const pick = (v: number[]) => v[Math.floor(rand() * v.length)]!;
    const finish: Record<number, number[]> = Object.fromEntries(milestones.map((m) => [m, []]));
    const paths: number[][] = [];
    for (let run = 0; run < 400; run++) {
      let c = n, t = T, pool = 0, next = pick(costPool); const path: number[] = [];
      for (let step = 0; step < 365 && c < K; step++) {
        const mult = Math.pow(sc.decay, (t - T) / 7);
        let dayTasks = 0; for (const v of teamTasks) if (v.length) dayTasks += pick(v);
        const eff = sc.gamma > 0 ? Math.pow((K - c) / K, sc.gamma) : 1;
        pool += dayTasks * mult * eff; t += 1;
        while (pool >= next && c < K) { pool -= next; c += 1; next = pick(costPool); for (const m of milestones) if (c === m) finish[m]!.push(t); }
        if (step < horizon) path.push(c);
      }
      for (const m of milestones) if (finish[m]!.length < run + 1) finish[m]!.push(Infinity);
      while (path.length < horizon) path.push(c);
      paths.push(path);
    }
    const curve: Pt[] = [{ day: T, value: n }];
    for (let i = 0; i < horizon; i++) { const vals = paths.map((p) => p[i]!); curve.push({ day: T + i + 1, value: pct(vals, 50) }); }
    const fin = Object.fromEntries(milestones.map((m) => [m, [10, 50, 90].map((q) => { const v = pct(finish[m]!, q); return Number.isFinite(v) ? v : null; })]));
    return { name: sc.name, curve, finish: fin };
  });
  const logistic: Pt[] = []; for (let d = 0; d <= T + horizon; d += 1) logistic.push({ day: d, value: K / (1 + Math.exp(-best.r * (d - best.t0))) });
  return {
    tz, startedAt: start, now: end, T, K, n, rate, rampDay, dailyTasksAvg, milestones,
    teams,
    fact: caps.map((c, i) => ({ day: c.day, value: i + 1, teamId: c.teamId })),
    linear, logistic: { r: best.r, t0: best.t0, curve: logistic, finish: Object.fromEntries(milestones.map((m) => [m, m <= n ? null : logisticAt(m)])) },
    scenarios,
  };
}
