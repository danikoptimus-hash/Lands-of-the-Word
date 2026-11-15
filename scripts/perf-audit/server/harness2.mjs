import fs from "node:fs"; import { performance } from "node:perf_hooks"; import "./intl_cache.mjs";
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, ""); const API = `${ROOT}/apps/api`;
const env = process.env; // DATABASE_URL и SESSION_SECRET — из окружения, как у локального сервера (apps/api/.env)
process.env.DATABASE_URL = env.DATABASE_URL; process.env.SESSION_SECRET = env.SESSION_SECRET; process.env.NODE_ENV = "test"; process.chdir(API);
const { prisma } = await import(`${API}/dist/db.js`);
const aw = await import(`${API}/dist/services/awards.js`); const { rulesOf } = await import(`${API}/dist/services/rules.js`); const pace = await import(`${API}/dist/services/pace.js`);
const G = "cmucujbgq0008s301ran0fnt4"; const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const game = await prisma.game.findUnique({ where: { id: G }, select: { settings: true } }); const tz = rulesOf(game.settings).timeZone;
const [teams, tasks, works, journal, nodes, nodeStates, cityStates, battles, entryRows, wall, passages, peeks] = await Promise.all([
  prisma.team.findMany({ where: { gameId: G }, select: { id: true, members: { select: { userId: true } } } }),
  prisma.teamEdgeTask.findMany({ where: { gameId: G, status: { not: "OPEN" } }, select: { id: true, teamId: true, status: true, takenById: true, participants: true, takenAt: true, submittedAt: true, decidedAt: true, sea: true, paved: true, toKey: true } }),
  prisma.quarryWork.findMany({ where: { gameId: G }, select: { teamId: true, byId: true, participants: true, status: true, submittedAt: true, decidedAt: true } }),
  prisma.journal.findMany({ where: { gameId: G, kind: { in: ["task_solved", "order_solved", "city_captured", "ruins_taken", "deed_returned", "sea_landed", "paved"] } }, select: { teamId: true, userId: true, kind: true, vars: true, createdAt: true } }),
  prisma.mapNode.findMany({ where: { gameId: G }, select: { key: true, kind: true, island: true, bookCode: true } }),
  prisma.teamNodeState.findMany({ where: { team: { gameId: G } }, select: { teamId: true, nodeKey: true, revealedAt: true } }),
  prisma.teamCityState.findMany({ where: { gameId: G }, select: { teamId: true, nodeKey: true, capturedAt: true, firstCapturedAt: true } }),
  prisma.battle.findMany({ where: { gameId: G, status: { in: ["WON", "REPELLED"] } }, select: { id: true, attackerId: true, defenderId: true, status: true, resolvedAt: true } }),
  prisma.battleEntry.findMany({ where: { battle: { gameId: G }, status: "APPROVED" }, select: { userId: true, teamId: true, startIdx: true, endIdx: true, carried: true, decidedAt: true, createdAt: true, battle: { select: { bookCode: true } } } }),
  prisma.wallBlock.findMany({ where: { gameId: G, status: "APPROVED", cargo: false }, select: { userId: true, teamId: true, bookCode: true, startIdx: true, endIdx: true, decidedAt: true, createdAt: true } }),
  prisma.passageRequest.findMany({ where: { gameId: G, status: "APPROVED" }, select: { id: true, requesterId: true, ownerId: true, status: true, decidedAt: true } }),
  prisma.teamPeek.findMany({ where: { team: { gameId: G } }, select: { teamId: true, createdAt: true } }),
]);
const entries = entryRows.map(({ battle, ...e }) => ({ ...e, bookCode: battle.bookCode }));
const data = () => ({ tz, now: new Date(), teams: teams.map((x) => ({ id: x.id, members: x.members.map((m) => m.userId) })), tasks: [...tasks], works: [...works], journal: [...journal], nodes, nodeStates, cityStates, battles, entries, wall, passages, peeks });
async function run(label) {
  const a = []; let n = 0; for (let i = 0; i < 5; i++) { const t = performance.now(); n = aw.computeAwards(data()).length; a.push(performance.now() - t); }
  const s = []; for (let i = 0; i < 3; i++) { const t = performance.now(); await aw.allStreaks(G); s.push(performance.now() - t); }
  const p = []; for (let i = 0; i < 3; i++) { const t = performance.now(); await pace.paceForecast(G); p.push(performance.now() - t); }
  console.log(`${label}: computeAwards ${med(a).toFixed(1)} мс (наград ${n}); allStreaks ${med(s).toFixed(1)} мс; paceForecast ${med(p).toFixed(1)} мс`);
}
await run("как сейчас (форматтер на каждый вызов)");
globalThis.__useIntlCache();
await run("с одним форматтером на пояс     ");
await prisma.$disconnect();
