import { prisma } from "../db.js";
import { mailStats, mailEnabled } from "./mail.js";

/**
 * Аналитика платформы для суперадмина (4.1): только обобщённые числа, без содержимого игр и без людей.
 * Считается по существующим таблицам за период `days` (по умолчанию 30) и «за всё время».
 */
const DAY = 86_400_000;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const hours = (ms: number | null) => (ms === null ? null : Math.round(ms / 36_000) / 100);
const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

export async function platformMetrics(days = 30) {
  const now = Date.now();
  const since = new Date(now - days * DAY);
  const d1 = new Date(now - DAY), d7 = new Date(now - 7 * DAY), d30 = new Date(now - 30 * DAY);

  const [usersTotal, usersNew, dau, wau, mau, cohort7, retained7, cohort30, retained30] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: d1 } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: d7 } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: d30 } } }),
    prisma.user.count({ where: { createdAt: { lte: d7 } } }),
    prisma.user.findMany({ where: { createdAt: { lte: d7 }, lastSeenAt: { not: null } }, select: { createdAt: true, lastSeenAt: true } }),
    prisma.user.count({ where: { createdAt: { lte: d30 } } }),
    prisma.user.findMany({ where: { createdAt: { lte: d30 }, lastSeenAt: { not: null } }, select: { createdAt: true, lastSeenAt: true } }),
  ]);
  const ret7 = retained7.filter((u) => u.lastSeenAt!.getTime() - u.createdAt.getTime() >= 7 * DAY).length;
  const ret30 = retained30.filter((u) => u.lastSeenAt!.getTime() - u.createdAt.getTime() >= 30 * DAY).length;

  const [games, orgs, teams, memberships] = await Promise.all([
    prisma.game.findMany({ select: { status: true, createdAt: true, startedAt: true, finishedAt: true, teamCount: true } }),
    prisma.organization.count(),
    prisma.team.count(),
    prisma.membership.count(),
  ]);
  const durations = games.filter((g) => g.startedAt && g.finishedAt).map((g) => g.finishedAt!.getTime() - g.startedAt!.getTime());

  const [tasksPeriod, tasksAll, decided, traversed, citiesCaptured, citiesPeriod] = await Promise.all([
    prisma.teamEdgeTask.findMany({ where: { submittedAt: { gte: since } }, select: { status: true, submittedAt: true, decidedAt: true } }),
    prisma.teamEdgeTask.count({ where: { submittedAt: { not: null } } }),
    prisma.teamEdgeTask.findMany({ where: { decidedAt: { not: null }, submittedAt: { not: null } }, select: { submittedAt: true, decidedAt: true } }),
    prisma.teamEdgeTask.count({ where: { status: "APPROVED" } }),
    prisma.teamCityState.count({ where: { firstCapturedAt: { not: null } } }),
    prisma.teamCityState.count({ where: { firstCapturedAt: { gte: since } } }),
  ]);
  const approvedPeriod = tasksPeriod.filter((t) => t.status === "APPROVED").length;
  const decidedPeriod = tasksPeriod.filter((t) => t.status === "APPROVED" || t.status === "REJECTED").length;

  const battles = await prisma.battle.findMany({ select: { status: true, bid: true, sumMode: true, declaredAt: true, startedAt: true, attackDoneAt: true } });
  const battlesPeriod = battles.filter((b) => b.declaredAt >= since);
  const attackTimes = battles.filter((b) => b.startedAt && b.attackDoneAt).map((b) => b.attackDoneAt!.getTime() - b.startedAt!.getTime());

  // Динамика по дням за период и итоги предыдущего периода той же длины (для дельт в плитках).
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const dates = Array.from({ length: days }, (_, i) => dayKey(new Date(now - (days - 1 - i) * DAY)));
  const bucket = (stamps: Date[]) => { const m = new Map(dates.map((d) => [d, 0])); for (const t of stamps) { const k = dayKey(t); if (m.has(k)) m.set(k, m.get(k)! + 1); } return dates.map((d) => m.get(d)!); };
  const prevSince = new Date(now - 2 * days * DAY);
  const [newUsersS, submissionsS, approvalsS, battlesS, citiesS, gamesS, nodesS, prevUsers, prevSubs, prevBattles, prevCities, prevGames, prevNodes, usersBefore] = await Promise.all([
    prisma.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }).then((r) => bucket(r.map((x) => x.createdAt))),
    prisma.teamEdgeTask.findMany({ where: { submittedAt: { gte: since } }, select: { submittedAt: true } }).then((r) => bucket(r.map((x) => x.submittedAt!))),
    prisma.teamEdgeTask.findMany({ where: { status: "APPROVED", decidedAt: { gte: since } }, select: { decidedAt: true } }).then((r) => bucket(r.map((x) => x.decidedAt!))),
    prisma.battle.findMany({ where: { declaredAt: { gte: since } }, select: { declaredAt: true } }).then((r) => bucket(r.map((x) => x.declaredAt))),
    prisma.teamCityState.findMany({ where: { firstCapturedAt: { gte: since } }, select: { firstCapturedAt: true } }).then((r) => bucket(r.map((x) => x.firstCapturedAt!))),
    prisma.game.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }).then((r) => bucket(r.map((x) => x.createdAt))),
    prisma.teamNodeState.findMany({ where: { revealedAt: { gte: since } }, select: { revealedAt: true } }).then((r) => bucket(r.map((x) => x.revealedAt))),
    prisma.user.count({ where: { createdAt: { gte: prevSince, lt: since } } }),
    prisma.teamEdgeTask.count({ where: { submittedAt: { gte: prevSince, lt: since } } }),
    prisma.battle.count({ where: { declaredAt: { gte: prevSince, lt: since } } }),
    prisma.teamCityState.count({ where: { firstCapturedAt: { gte: prevSince, lt: since } } }),
    prisma.game.count({ where: { createdAt: { gte: prevSince, lt: since } } }),
    prisma.teamNodeState.count({ where: { revealedAt: { gte: prevSince, lt: since } } }),
    prisma.user.count({ where: { createdAt: { lt: since } } }),
  ]);
  let running = usersBefore;
  const usersTotalS = newUsersS.map((n) => (running += n));
  const nodesInPeriod = nodesS.reduce((a, b) => a + b, 0);

  return {
    period: { days, since: since.toISOString(), dates },
    series: { newUsers: newUsersS, usersTotal: usersTotalS, submissions: submissionsS, approvals: approvalsS, battles: battlesS, cities: citiesS, games: gamesS, nodes: nodesS },
    previous: { newUsers: prevUsers, submissions: prevSubs, battles: prevBattles, cities: prevCities, games: prevGames, nodes: prevNodes },
    nodesInPeriod,
    users: { total: usersTotal, newInPeriod: usersNew, dau, wau, mau, retention7: share(ret7, cohort7), retention30: share(ret30, cohort30) },
    games: {
      total: games.length, draft: games.filter((g) => g.status === "DRAFT").length, active: games.filter((g) => g.status === "ACTIVE").length, finished: games.filter((g) => g.status === "FINISHED").length,
      createdInPeriod: games.filter((g) => g.createdAt >= since).length, avgDurationDays: durations.length ? Math.round((avg(durations)! / DAY) * 10) / 10 : null,
      teams, avgTeamSize: teams ? Math.round((memberships / teams) * 10) / 10 : null, organizations: orgs,
    },
    activity: {
      submissionsInPeriod: tasksPeriod.length, submissionsTotal: tasksAll, approvedShare: share(approvedPeriod, decidedPeriod),
      avgDecisionHours: hours(avg(decided.map((t) => t.decidedAt!.getTime() - t.submittedAt!.getTime()))),
      edgesTraversed: traversed, citiesCaptured, citiesCapturedInPeriod: citiesPeriod,
    },
    battles: {
      declared: battles.length, declaredInPeriod: battlesPeriod.length,
      expired: battles.filter((b) => b.status === "EXPIRED").length, won: battles.filter((b) => b.status === "WON").length, repelled: battles.filter((b) => b.status === "REPELLED").length,
      active: battles.filter((b) => b.status === "ATTACK" || b.status === "DEFENSE" || b.status === "QUEUED").length,
      avgBid: avg(battles.map((b) => b.bid)), avgAttackHours: hours(avg(attackTimes)), sumMode: battles.filter((b) => b.sumMode).length,
    },
    diplomacy: { implemented: false, passRequests: 0, passApprovedShare: null, embassies: 0 },
    tech: { uptimeHours: hours(now - mailStats.startedAt), mailEnabled: mailEnabled(), mailSent: mailStats.sent, mailFailed: mailStats.failed, node: process.version, memoryMb: Math.round(process.memoryUsage().rss / 1048576) },
  };
}
