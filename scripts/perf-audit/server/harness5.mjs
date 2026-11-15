import fs from "node:fs"; import { performance } from "node:perf_hooks";
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, ""); const API = `${ROOT}/apps/api`;
const env = process.env; // DATABASE_URL и SESSION_SECRET — из окружения, как у локального сервера (apps/api/.env)
process.env.DATABASE_URL = env.DATABASE_URL; process.env.NODE_ENV = "test"; process.env.SESSION_SECRET = env.SESSION_SECRET; process.chdir(API);
const { prisma } = await import(`${API}/dist/db.js`);
const G = "cmucujbgq0008s301ran0fnt4", T = "cmuculht800n1s301sd0a6z1q";
async function bench(label, fn, n = 30) { await fn(); const c0 = process.cpuUsage(), t0 = performance.now(); for (let i = 0; i < n; i++) await fn(); const c = process.cpuUsage(c0); console.log(`${label}: ${((performance.now() - t0) / n).toFixed(2)} мс по часам, ${((c.user + c.system) / 1000 / n).toFixed(2)} мс процессора`); }
await bench("неизменная карта партии: гексы + узлы + рёбра (3 запроса, 818 строк)", () => Promise.all([
  prisma.mapHex.findMany({ where: { gameId: G }, select: { q: true, r: true, terrain: true, rotation: true, island: true } }),
  prisma.mapNode.findMany({ where: { gameId: G }, select: { key: true, corner: true, q: true, r: true, kind: true, bookCode: true, cityType: true, teamIndex: true, ruined: true, island: true, coastal: true } }),
  prisma.mapEdge.findMany({ where: { gameId: G }, select: { aKey: true, bKey: true } }),
]));
await bench("ещё раз рёбра + города (их грузит ensureFrontier)", () => Promise.all([
  prisma.mapEdge.findMany({ where: { gameId: G }, select: { aKey: true, bKey: true } }),
  prisma.mapNode.findMany({ where: { gameId: G, kind: "CITY", bookCode: { not: null } }, select: { key: true, bookCode: true } }),
]));
await bench("дела команды с вложенным делом и человеком (282 строки)", () => prisma.teamEdgeTask.findMany({ where: { teamId: T }, include: { deed: { select: { id: true, title: true, description: true, direction: true, proofType: true, secret: true, remote: true } }, person: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }));
await bench("чужие пройденные стороны всей партии (271 строка сейчас; растёт с числом команд)", () => prisma.teamEdgeTask.findMany({ where: { gameId: G, status: "APPROVED", NOT: { teamId: T } }, select: { fromKey: true, toKey: true, sea: true, team: { select: { index: true, name: true, color: true, avatarId: true } } } }));
await bench("сессия + пользователь (на каждый запрос)", () => prisma.session.findFirst({ include: { user: true } }), 100);
await bench("простейший запрос (game.settings)", () => prisma.game.findUnique({ where: { id: G }, select: { settings: true } }), 100);
await prisma.$disconnect();
