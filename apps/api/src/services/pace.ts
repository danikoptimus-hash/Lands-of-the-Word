import { prisma } from "../db.js";
import { rulesOf } from "./rules.js";
import { dayKey } from "./activity.js";

/**
 * Темп партии (решение владельца 23.10: «тот чарт — в аналитику игры»; уточнение: «оставить логистическую кривую,
 * факт и прогноз», плюс «график с количеством дел в день»): города накопительно, факт и прогноз, когда вся карта будет
 * занята. Перенос отчёта pace-report: темп после разгона и логистическая кривая с потолком K (прогноз Монте-Карло убран
 * по решению владельца 23.10: «оставим только логистическую кривую»). Дела в день — принятые дела на сторонах и общие
 * дела Каменоломни по командам. Стихов в день — такой же график по выученным стихам (решение владельца 04.11).
 * Время — сутки от старта.
 */
const DAY = 86_400_000;
interface Pt { day: number; value: number }

/** Принятые стихи одного участника: запись испытания или блок стены. */
export interface Recited { userId: string; teamId: string; bookCode: string; startIdx: number; endIdx: number; at: Date }

/**
 * Выученные стихи по дням и командам (решение владельца 04.11: «график заученных стихов… точно такой же, как по делам…
 * если 2 человека выучили один и тот же стих — в подсчёте это 2 стиха, а не 1»). Счёт по людям: у каждого участника стих
 * засчитывается один раз, в день первого принятия, поэтому тот же стих у двоих — два стиха, а повтор своего стиха (в другом
 * испытании, в починке стены) новым не считается. Дни вне партии пропускаются.
 */
export function versesByDay(recited: Recited[], days: string[], tz: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>(days.map((d) => [d, new Map()]));
  const seen = new Set<string>();
  for (const e of [...recited].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    let fresh = 0;
    for (let i = e.startIdx; i <= e.endIdx; i++) { const k = `${e.userId}:${e.bookCode}:${i}`; if (!seen.has(k)) { seen.add(k); fresh++; } }
    const m = out.get(dayKey(e.at, tz));
    if (fresh && m) m.set(e.teamId, (m.get(e.teamId) ?? 0) + fresh);
  }
  return out;
}

export async function paceForecast(gameId: string) {
  const game = await prisma.game.findUniqueOrThrow({ where: { id: gameId }, select: { startedAt: true, createdAt: true, settings: true, status: true, finishedAt: true } });
  const tz = rulesOf(game.settings).timeZone;
  const start = game.startedAt ?? game.createdAt;
  const end = game.finishedAt ?? new Date();
  const T = Math.max((end.getTime() - start.getTime()) / DAY, 0.5);
  const dayOf = (d: Date) => (d.getTime() - start.getTime()) / DAY;
  const [K, teams, rows, states, wonBattles, wonSieges, entries, blocks] = await Promise.all([
    prisma.mapNode.count({ where: { gameId, kind: "CITY" } }),
    prisma.team.findMany({ where: { gameId }, select: { id: true, name: true, color: true, avatarId: true }, orderBy: { index: "asc" } }),
    prisma.journal.findMany({ where: { gameId, kind: { in: ["city_captured", "ruins_taken", "task_solved", "deed_approved", "quarry_approved"] } }, select: { kind: true, teamId: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.teamCityState.findMany({ where: { gameId, capturedAt: { not: null } }, select: { doneTasks: true, isCapital: true } }),
    prisma.battle.findMany({ where: { gameId, status: "WON", resolvedAt: { not: null } }, select: { attackerId: true, defenderId: true, resolvedAt: true } }),
    prisma.siege.findMany({ where: { gameId, status: "WON", resolvedAt: { not: null } }, select: { attackerId: true, defenderId: true, resolvedAt: true } }),
    // Стихи: принятые записи испытаний без перенесённых из прошлого вызова и принятые блоки стены (сгоревшие и починки тоже).
    prisma.battleEntry.findMany({ where: { battle: { gameId }, status: "APPROVED", carried: false }, select: { userId: true, teamId: true, startIdx: true, endIdx: true, decidedAt: true, createdAt: true, battle: { select: { bookCode: true } } } }),
    prisma.wallBlock.findMany({ where: { gameId, status: "APPROVED", cargo: false }, select: { userId: true, teamId: true, bookCode: true, startIdx: true, endIdx: true, decidedAt: true, createdAt: true } }),
  ]);
  // Взятие города — выполнением заданий (и руин тоже). Переход города по испытанию или осаде (замечание владельца 01.11:
  // «отвоевал 2 города, а на графике это не отобразилось») общий счёт не меняет, а линии команд — да: минус у хранителей, плюс у претендентов.
  const caps = rows.filter((r) => r.kind === "city_captured" || r.kind === "ruins_taken").map((r) => ({ day: dayOf(r.createdAt), at: r.createdAt, teamId: r.teamId }));
  const transfers = [...wonBattles, ...wonSieges].map((x) => ({ day: dayOf(x.resolvedAt!), from: x.defenderId, to: x.attackerId })).sort((a, b) => a.day - b.day);
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
    else if (r.kind === "city_captured" || r.kind === "ruins_taken") capsByDay.set(d, (capsByDay.get(d) ?? 0) + 1);
  }
  // Разгон: с первого дня, когда взяли не меньше двух городов; иначе с начала.
  let rampDay = 0; for (const d of days) if ((capsByDay.get(d) ?? 0) >= 2) { rampDay = Math.max(0, days.indexOf(d)); break; }
  const steady = days.slice(1, -1).filter((_, i) => i + 1 >= rampDay);
  const capsSteady = caps.filter((c) => c.day >= rampDay).length;
  const rate = capsSteady / Math.max(T - rampDay, 0.5);
  const milestones = [Math.floor(K / 2), Math.floor(K * 0.95), K];
  // Логистика по методу наименьших квадратов (замечание владельца 25.10: «наша линия уже замедляется, а кривая как будто
  // неправильно считается»): подбираются все три параметра — потолок Kf (от взятого сейчас до числа городов на карте),
  // крутизна r и середина t0. Раньше потолок был зашит в число городов, и кривая не могла показать замедление.
  // Точки — накопленный факт по дням плюс сегодняшняя; сначала грубая сетка, затем три круга уточнения вокруг лучшего.
  const grid = Array.from({ length: Math.floor(T) + 1 }, (_, i) => i);
  const pts: Array<[number, number]> = [...grid.map((g) => [g, caps.filter((c) => c.day <= g).length] as [number, number]), [T, n]];
  const sseOf = (Kf: number, r: number, t0: number) => { let s = 0; for (const [x, y] of pts) { const p = Kf / (1 + Math.exp(-r * (x - t0))); s += (p - y) ** 2; } return s; };
  const kLo = Math.max(n, 1), kHi = Math.max(K, kLo);
  let best = { sse: Infinity, K: kHi, r: 0.3, t0: Math.max(T / 2, 1) };
  const scan = (ks: number[], rs: number[], ts: number[]) => { for (const Kf of ks) for (const r of rs) for (const t0 of ts) { const s = sseOf(Kf, r, t0); if (s < best.sse) best = { sse: s, K: Kf, r, t0 }; } };
  const range = (a: number, b: number, step: number) => { const out: number[] = []; for (let v = a; v <= b + 1e-9; v += step) out.push(v); return out; };
  scan(range(kLo, kHi, Math.max(1, (kHi - kLo) / 25)), range(0.03, 1.5, 0.03), range(-20, T + 60, 1));
  for (let round = 0, dk = Math.max(1, (kHi - kLo) / 25), dr = 0.03, dt = 1; round < 3; round++, dk /= 5, dr /= 5, dt /= 5) {
    scan(range(Math.max(kLo, best.K - dk), Math.min(kHi, best.K + dk), Math.max(dk / 5, 0.05)), range(Math.max(0.01, best.r - dr), best.r + dr, dr / 5), range(best.t0 - dt, best.t0 + dt, dt / 5));
  }
  const logisticAt = (m: number) => { if (m >= best.K) return null; const f = m / best.K; return best.t0 - Math.log(1 / f - 1) / best.r; };
  const teamTasks = teams.map((t) => steady.map((d) => tasksByDay.get(d)?.get(t.id) ?? 0));
  const dailyTasksAvg = teamTasks.reduce((a, v) => a + (v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0), 0);
  const horizon = 120;
  // Тренд дел в день считает клиент по выбранным в легенде командам; сервер сообщает число полных дней для подбора —
  // текущий неполный день в прямую не входит.
  const fitDays = game.finishedAt ? days.length : days.length - 1;
  // Дел в сутки для плитки (владелец 23.10: «мне нужны здесь только дела»): среднее принятых дел по полным дням, все команды.
  let deedsTotal = 0; for (let i = 0; i < fitDays; i++) for (const v of deedsByDay.get(days[i]!)?.values() ?? []) deedsTotal += v;
  const dailyDeedsAvg = fitDays > 0 ? deedsTotal / fitDays : 0;
  const verses = versesByDay([
    ...entries.map((e) => ({ userId: e.userId, teamId: e.teamId, bookCode: e.battle.bookCode, startIdx: e.startIdx, endIdx: e.endIdx, at: e.decidedAt ?? e.createdAt })),
    ...blocks.map((b) => ({ userId: b.userId, teamId: b.teamId, bookCode: b.bookCode, startIdx: b.startIdx, endIdx: b.endIdx, at: b.decidedAt ?? b.createdAt })),
  ], days, tz);
  const logistic: Pt[] = []; for (let d = 0; d <= T + horizon; d += 1) logistic.push({ day: d, value: best.K / (1 + Math.exp(-best.r * (d - best.t0))) });
  return {
    tz, startedAt: start, now: end, T, K, n, rate, rampDay, dailyTasksAvg, dailyDeedsAvg, milestones,
    teams,
    fact: caps.map((c, i) => ({ day: c.day, value: i + 1, teamId: c.teamId })),
    transfers,
    deeds: { days, teams: teams.map((t) => ({ id: t.id, name: t.name, color: t.color, values: days.map((d) => deedsByDay.get(d)?.get(t.id) ?? 0) })), fitDays },
    verses: { days, teams: teams.map((t) => ({ id: t.id, name: t.name, color: t.color, values: days.map((d) => verses.get(d)?.get(t.id) ?? 0) })), fitDays },
    logistic: { K: best.K, r: best.r, t0: best.t0, curve: logistic, finish: Object.fromEntries(milestones.map((m) => [m, m <= n ? null : logisticAt(m)])) },
  };
}
