// Прототип «рейтинга игроков» шестью запросами на всю партию вместо семи на каждого игрока (только чтение).
import fs from "node:fs"; import { performance } from "node:perf_hooks";
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, ""); const API = `${ROOT}/apps/api`;
const env = process.env; // DATABASE_URL и SESSION_SECRET — из окружения, как у локального сервера (apps/api/.env)
process.env.DATABASE_URL = env.DATABASE_URL; process.env.NODE_ENV = "test"; process.env.SESSION_SECRET = env.SESSION_SECRET; process.chdir(API);
const { prisma } = await import(`${API}/dist/db.js`);
let ops = 0; const orig = prisma._request.bind(prisma); prisma._request = (p) => { ops++; return orig(p); };
const j = await import(`${API}/dist/services/journal.js`);
const G = "cmucujbgq0008s301ran0fnt4"; const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
async function fast() {
  const [members, tasks, works, entries, journal, wall] = await Promise.all([
    prisma.membership.findMany({ where: { team: { gameId: G } }, select: { userId: true, teamId: true } }),
    prisma.teamEdgeTask.findMany({ where: { gameId: G, status: { in: ["APPROVED", "TAKEN", "SUBMITTED"] } }, select: { teamId: true, status: true, paved: true, takenById: true, participants: true } }),
    prisma.quarryWork.findMany({ where: { gameId: G, status: { in: ["APPROVED", "SUBMITTED"] } }, select: { teamId: true, status: true, participants: true } }),
    prisma.battleEntry.findMany({ where: { status: "APPROVED", carried: false, battle: { gameId: G } }, select: { userId: true, teamId: true, startIdx: true, endIdx: true } }),
    prisma.journal.groupBy({ by: ["userId", "teamId", "kind"], where: { gameId: G, userId: { not: null } }, _count: { _all: true }, _max: { createdAt: true } }),
    prisma.wallBlock.findMany({ where: { gameId: G, status: "APPROVED", cargo: false }, select: { userId: true, teamId: true, startIdx: true, endIdx: true } }),
  ]);
  const st = new Map(); const of = (u) => { let s = st.get(u); if (!s) { s = { deeds: 0, deedsPending: 0, tasks: 0, orders: 0, cities: 0, verses: 0, trips: 0 }; st.set(u, s); } return s; };
  const teamsOf = new Map(); for (const m of members) teamsOf.set(m.userId, [...(teamsOf.get(m.userId) ?? []), m.teamId]);
  const mine = (u, teamId) => teamsOf.get(u)?.includes(teamId);
  for (const t of tasks) for (const u of new Set([...(t.takenById ? [t.takenById] : []), ...t.participants])) if (mine(u, t.teamId)) { if (t.status === "APPROVED") { if (!t.paved) of(u).deeds++; } else of(u).deedsPending++; }
  for (const w of works) for (const u of w.participants) if (mine(u, w.teamId)) { if (w.status === "APPROVED") of(u).deeds++; else of(u).deedsPending++; }
  for (const e of [...entries, ...wall]) if (mine(e.userId, e.teamId)) of(e.userId).verses += e.endIdx - e.startIdx + 1;
  for (const r of journal) { if (!r.userId || !(r.teamId === null || mine(r.userId, r.teamId))) continue; const s = of(r.userId), n = r._count._all; if (r.kind === "task_solved") s.tasks += n; else if (r.kind === "order_solved") s.orders += n; else if (r.kind === "city_captured" || r.kind === "ruins_taken") s.cities += n; else if (r.kind === "sea_landed") s.trips += n; }
  return st;
}
const a = [], b = []; let slowRows, fastRows, o1 = 0, o2 = 0;
for (let i = 0; i < 5; i++) { ops = 0; let t = performance.now(); slowRows = await j.activityBoard(G); a.push(performance.now() - t); o1 = ops; ops = 0; t = performance.now(); fastRows = await fast(); b.push(performance.now() - t); o2 = ops; }
let diff = 0; for (const r of slowRows) { const f = fastRows.get(r.userId) ?? { deeds: 0, deedsPending: 0, tasks: 0, orders: 0, cities: 0, verses: 0, trips: 0 }; for (const k of ["deeds", "deedsPending", "tasks", "orders", "cities", "verses", "trips"]) if (r[k] !== f[k]) diff++; }
console.log(`как сейчас: ${med(a).toFixed(1)} мс, ${o1} обращений; шестью запросами на партию: ${med(b).toFixed(1)} мс, ${o2} обращений; игроков ${slowRows.length}; расхождений в числах: ${diff}`);
await prisma.$disconnect();
