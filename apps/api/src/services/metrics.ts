import { prisma } from "../db.js";
import { mailStats, mailEnabled } from "./mail.js";
import { responseTimes, stats } from "./stats.js";

/**
 * Аналитика платформы для суперадмина (4.1): только обобщённые числа, без содержимого игр и без людей.
 * Считается по существующим таблицам за период `days` (по умолчанию 30) и «за всё время».
 */
const DAY = 86_400_000;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const hours = (ms: number | null) => (ms === null ? null : Math.round(ms / 36_000) / 100);
const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

const median = (xs: number[]) => percentile(xs, 0.5);
function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]!);
}

/** Замеры интерфейса за период: медианы и p75 скорости открытия, плавность карты, разбивка по устройствам. */
export async function uiMetrics(days = 30) {
  const since = new Date(Date.now() - days * DAY);
  const rows = await prisma.uiMetric.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 5000 });
  const nums = (f: (r: (typeof rows)[number]) => number | null) => rows.map(f).filter((v): v is number => v !== null && Number.isFinite(v));
  const group = (key: "device" | "browser" | "os" | "page") => {
    const out: Record<string, { n: number; fps: number | null; jank: number | null; lcp: number | null; load: number | null }> = {};
    for (const r of rows) {
      const k = r[key];
      const g = rows.filter((x) => x[key] === k);
      if (out[k]) continue;
      const fpsList = g.map((x) => x.fps).filter((v): v is number => v !== null), jankList = g.map((x) => x.jank).filter((v): v is number => v !== null);
      out[k] = { n: g.length, fps: fpsList.length ? Math.round((fpsList.reduce((a, b) => a + b, 0) / fpsList.length) * 10) / 10 : null, jank: jankList.length ? Math.round((jankList.reduce((a, b) => a + b, 0) / jankList.length) * 1000) / 10 : null, lcp: median(g.map((x) => x.lcp).filter((v): v is number => v !== null)), load: median(g.map((x) => x.load).filter((v): v is number => v !== null)) };
    }
    return out;
  };
  const fpsAll = nums((r) => r.fps), jankAll = nums((r) => r.jank);
  return {
    samples: rows.length, since: since.toISOString(),
    ttfb: { p50: median(nums((r) => r.ttfb)), p75: percentile(nums((r) => r.ttfb), 0.75) },
    fcp: { p50: median(nums((r) => r.fcp)), p75: percentile(nums((r) => r.fcp), 0.75) },
    lcp: { p50: median(nums((r) => r.lcp)), p75: percentile(nums((r) => r.lcp), 0.75) },
    load: { p50: median(nums((r) => r.load)), p75: percentile(nums((r) => r.load), 0.75) },
    fps: { avg: fpsAll.length ? Math.round((fpsAll.reduce((a, b) => a + b, 0) / fpsAll.length) * 10) / 10 : null, p25: percentile(fpsAll, 0.25), samples: fpsAll.length },
    jank: { avg: jankAll.length ? Math.round((jankAll.reduce((a, b) => a + b, 0) / jankAll.length) * 1000) / 10 : null, bad: jankAll.length ? Math.round((jankAll.filter((j) => j > 0.1).length / jankAll.length) * 1000) / 10 : null },
    longTasks: { avg: (() => { const l = nums((r) => r.longTasks); return l.length ? Math.round((l.reduce((a, b) => a + b, 0) / l.length) * 10) / 10 : null; })() },
    byDevice: group("device"), byBrowser: group("browser"), byOs: group("os"), byPage: group("page"),
  };
}

/**
 * Тестовые учётки не считаются (решение владельца 30.09): боты симуляции и фикстуры инструкции — почта на example.com или
 * ник с префиксом tg_, guide_, test_. Игры, созданные такими учётками, тоже не считаются вместе со всем содержимым.
 */
export const TEST_USER_WHERE = { OR: [{ email: { endsWith: "@example.com" } }, { nickname: { startsWith: "tg_" } }, { nickname: { startsWith: "guide_" } }, { nickname: { startsWith: "test_" } }] };
async function testScope() {
  const users = (await prisma.user.findMany({ where: TEST_USER_WHERE, select: { id: true } })).map((u) => u.id);
  const games = users.length ? (await prisma.game.findMany({ where: { createdById: { in: users } }, select: { id: true } })).map((g) => g.id) : [];
  return { users, games };
}

export async function platformMetrics(days = 30) {
  const now = Date.now();
  const since = new Date(now - days * DAY);
  const d1 = new Date(now - DAY), d7 = new Date(now - 7 * DAY), d30 = new Date(now - 30 * DAY);
  const test = await testScope();
  const U = { id: { notIn: test.users } }, G = { gameId: { notIn: test.games } }, TG = { team: { gameId: { notIn: test.games } } };

  const [usersTotal, usersNew, dau, wau, mau, cohort7, retained7, cohort30, retained30] = await Promise.all([
    prisma.user.count({ where: U }),
    prisma.user.count({ where: { ...U, createdAt: { gte: since } } }),
    prisma.user.count({ where: { ...U, lastSeenAt: { gte: d1 } } }),
    prisma.user.count({ where: { ...U, lastSeenAt: { gte: d7 } } }),
    prisma.user.count({ where: { ...U, lastSeenAt: { gte: d30 } } }),
    prisma.user.count({ where: { ...U, createdAt: { lte: d7 } } }),
    prisma.user.findMany({ where: { ...U, createdAt: { lte: d7 }, lastSeenAt: { not: null } }, select: { createdAt: true, lastSeenAt: true } }),
    prisma.user.count({ where: { ...U, createdAt: { lte: d30 } } }),
    prisma.user.findMany({ where: { ...U, createdAt: { lte: d30 }, lastSeenAt: { not: null } }, select: { createdAt: true, lastSeenAt: true } }),
  ]);
  const ret7 = retained7.filter((u) => u.lastSeenAt!.getTime() - u.createdAt.getTime() >= 7 * DAY).length;
  const ret30 = retained30.filter((u) => u.lastSeenAt!.getTime() - u.createdAt.getTime() >= 30 * DAY).length;

  const [games, orgs, teams, memberships] = await Promise.all([
    prisma.game.findMany({ where: { id: { notIn: test.games } }, select: { status: true, createdAt: true, startedAt: true, finishedAt: true, teamCount: true } }),
    prisma.organization.count(),
    prisma.team.count({ where: G }),
    prisma.membership.count({ where: TG }),
  ]);
  const durations = games.filter((g) => g.startedAt && g.finishedAt).map((g) => g.finishedAt!.getTime() - g.startedAt!.getTime());

  const [tasksPeriod, tasksAll, decided, traversed, citiesCaptured, citiesPeriod] = await Promise.all([
    prisma.teamEdgeTask.findMany({ where: { ...G, submittedAt: { gte: since } }, select: { status: true, submittedAt: true, decidedAt: true } }),
    prisma.teamEdgeTask.count({ where: { ...G, submittedAt: { not: null } } }),
    prisma.teamEdgeTask.findMany({ where: { ...G, decidedAt: { not: null }, submittedAt: { not: null } }, select: { submittedAt: true, decidedAt: true } }),
    prisma.teamEdgeTask.count({ where: { ...G, status: "APPROVED" } }),
    prisma.teamCityState.count({ where: { ...G, firstCapturedAt: { not: null } } }),
    prisma.teamCityState.count({ where: { ...G, firstCapturedAt: { gte: since } } }),
  ]);
  const approvedPeriod = tasksPeriod.filter((t) => t.status === "APPROVED").length;
  const decidedPeriod = tasksPeriod.filter((t) => t.status === "APPROVED" || t.status === "REJECTED").length;

  const battles = await prisma.battle.findMany({ where: G, select: { status: true, bid: true, sumMode: true, declaredAt: true, startedAt: true, attackDoneAt: true } });
  const passages = await prisma.passageRequest.findMany({ where: G, select: { status: true, createdAt: true } });
  const battlesPeriod = battles.filter((b) => b.declaredAt >= since);
  const attackTimes = battles.filter((b) => b.startedAt && b.attackDoneAt).map((b) => b.attackDoneAt!.getTime() - b.startedAt!.getTime());

  // Динамика по дням за период и итоги предыдущего периода той же длины (для дельт в плитках).
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const dates = Array.from({ length: days }, (_, i) => dayKey(new Date(now - (days - 1 - i) * DAY)));
  const bucket = (stamps: Date[]) => { const m = new Map(dates.map((d) => [d, 0])); for (const t of stamps) { const k = dayKey(t); if (m.has(k)) m.set(k, m.get(k)! + 1); } return dates.map((d) => m.get(d)!); };
  const prevSince = new Date(now - 2 * days * DAY);
  const [newUsersS, submissionsS, approvalsS, battlesS, citiesS, gamesS, nodesS, prevUsers, prevSubs, prevBattles, prevCities, prevGames, prevNodes, usersBefore] = await Promise.all([
    prisma.user.findMany({ where: { ...U, createdAt: { gte: since } }, select: { createdAt: true } }).then((r) => bucket(r.map((x) => x.createdAt))),
    prisma.teamEdgeTask.findMany({ where: { ...G, submittedAt: { gte: since } }, select: { submittedAt: true } }).then((r) => bucket(r.map((x) => x.submittedAt!))),
    prisma.teamEdgeTask.findMany({ where: { ...G, status: "APPROVED", decidedAt: { gte: since } }, select: { decidedAt: true } }).then((r) => bucket(r.map((x) => x.decidedAt!))),
    prisma.battle.findMany({ where: { ...G, declaredAt: { gte: since } }, select: { declaredAt: true } }).then((r) => bucket(r.map((x) => x.declaredAt))),
    prisma.teamCityState.findMany({ where: { ...G, firstCapturedAt: { gte: since } }, select: { firstCapturedAt: true } }).then((r) => bucket(r.map((x) => x.firstCapturedAt!))),
    prisma.game.findMany({ where: { id: { notIn: test.games }, createdAt: { gte: since } }, select: { createdAt: true } }).then((r) => bucket(r.map((x) => x.createdAt))),
    prisma.teamNodeState.findMany({ where: { ...TG, revealedAt: { gte: since } }, select: { revealedAt: true } }).then((r) => bucket(r.map((x) => x.revealedAt))),
    prisma.user.count({ where: { ...U, createdAt: { gte: prevSince, lt: since } } }),
    prisma.teamEdgeTask.count({ where: { ...G, submittedAt: { gte: prevSince, lt: since } } }),
    prisma.battle.count({ where: { ...G, declaredAt: { gte: prevSince, lt: since } } }),
    prisma.teamCityState.count({ where: { ...G, firstCapturedAt: { gte: prevSince, lt: since } } }),
    prisma.game.count({ where: { id: { notIn: test.games }, createdAt: { gte: prevSince, lt: since } } }),
    prisma.teamNodeState.count({ where: { ...TG, revealedAt: { gte: prevSince, lt: since } } }),
    prisma.user.count({ where: { ...U, createdAt: { lt: since } } }),
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
    diplomacy: { implemented: true, passRequests: passages.length, passApprovedShare: share(passages.filter((p) => p.status === "APPROVED").length, passages.filter((p) => p.status !== "PENDING").length), passRequestsInPeriod: passages.filter((p) => p.createdAt >= since).length, embassies: 0 },
    ui: await uiMetrics(days),
    tech: {
      uptimeHours: hours(now - mailStats.startedAt), mailEnabled: mailEnabled(), mailSent: mailStats.sent, mailFailed: mailStats.failed, node: process.version, memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      requests: stats.requests, errors5xx: stats.errors5xx, errors4xx: stats.errors4xx, lastErrorAt: stats.lastErrorAt, lastErrorRoute: stats.lastErrorRoute, ...responseTimes(),
    },
  };
}
