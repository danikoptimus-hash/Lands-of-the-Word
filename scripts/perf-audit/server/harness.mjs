// Замер «в процессе»: то же собранное приложение (apps/api/dist), запросы GET через app.inject,
// счётчик обращений Prisma на каждый маршрут. Таймеры выключены (NODE_ENV=test). Только GET.
import fs from "node:fs";
import { performance } from "node:perf_hooks";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, ""); const API = `${ROOT}/apps/api`;
const env = process.env; // DATABASE_URL и SESSION_SECRET — из окружения, как у локального сервера (apps/api/.env)
process.env.DATABASE_URL = env.DATABASE_URL;
process.env.SESSION_SECRET = env.SESSION_SECRET;
process.env.NODE_ENV = "test";
process.chdir(API);

const { prisma } = await import(`${API}/dist/db.js`);
let ops = 0; const byModel = new Map();
const orig = prisma._request.bind(prisma);
prisma._request = (p) => { ops++; const k = `${p.model ?? "raw"}.${p.action}`; byModel.set(k, (byModel.get(k) ?? 0) + 1); return orig(p); };

const { buildApp } = await import(`${API}/dist/app.js`);
const app = await buildApp();
await app.ready();

const jar = (name) => { const line = fs.readFileSync(new URL(`./${name}.jar`, import.meta.url), "utf8").split("\n").find((l) => l.includes("lotw_session\t")); return "lotw_session=" + line.split("\t").pop(); };
const cookies = { p4: jar("p4"), p1: jar("p1"), admin1: jar("admin1") };
const G = "cmucujbgq0008s301ran0fnt4", T = "cmuculht800n1s301sd0a6z1q", T2 = "cmuculm0t00n3s3012zuggytf";
const NK = encodeURIComponent("S:5,-6");

async function hit(who, path) {
  // даём фоновым «void»-запросам прошлого маршрута закончиться
  await new Promise((r) => setTimeout(r, 150));
  ops = 0; byModel.clear();
  const t = performance.now();
  const res = await app.inject({ method: "GET", url: `/api/${path}`, headers: { cookie: cookies[who] } });
  const ms = performance.now() - t;
  await new Promise((r) => setTimeout(r, 50));
  return { ms, ops, size: res.rawPayload.length, status: res.statusCode, top: [...byModel].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`).join(", "), body: res.rawPayload };
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
async function measure(who, path, n = 5) {
  const first = await hit(who, path);
  const runs = []; let last = first;
  for (let i = 0; i < n; i++) { last = await hit(who, path); runs.push(last); }
  console.log(`${who.padEnd(6)} ${String(first.status)} первый: ${first.ms.toFixed(1).padStart(7)} мс / ${String(first.ops).padStart(4)} запр. | повтор (медиана из ${n}): ${med(runs.map((r) => r.ms)).toFixed(1).padStart(7)} мс / ${String(med(runs.map((r) => r.ops))).padStart(4)} запр. | ${String(last.size).padStart(7)} Б | ${path.replace(G, ":id")} | ${last.top}`);
  return last;
}

const mode = process.argv[2] ?? "routes";
if (mode === "routes") {
  console.log("== участник (p4) ==");
  for (const p of ["auth/me", "me/teams", `games/${G}/my-map`, `games/${G}/my-map/bird`, `games/${G}/teams`, `games/${G}/feed`, `games/${G}/standings`, `games/${G}/my-battles`, `games/${G}/awards`, `games/${G}/top`, `games/${G}/my-service`, `games/${G}/peace`, `games/${G}/my-passages`, `games/${G}/my-trades`, `games/${G}/quarry`, `games/${G}/my-city/${NK}`, `games/${G}/my-city/${NK}/war`, `games/${G}/my-city/${NK}/wall`, `games/${G}/awards/teams/${T2}`, `games/${G}/book-map?book=sng`]) await measure("p4", p);
  console.log("== капитан (p1) ==");
  for (const p of [`games/${G}/my-map`, `games/${G}/my-trades`, `games/${G}/top`]) await measure("p1", p);
  console.log("== администратор (admin1) ==");
  for (const p of [`games/${G}`, `games/${G}/progress`, `games/${G}/teams`, `games/${G}/submissions`, `games/${G}/submissions?status=APPROVED`, `games/${G}/battles`, `games/${G}/journal`, `games/${G}/activity`, `games/${G}/awards/admin`, `games/${G}/standings`, `games/${G}/deeds`, `games/${G}/visits`, `games/${G}/sieges`, `games/${G}/walls`, `games/${G}/analytics/pace`, `games/${G}/teams/${T}/map`, `games/${G}/cities/${NK}`, `games/${G}/season-book`, `games/${G}/labels`, `games/${G}/quarry/submissions`, `games/${G}/wrecks/submissions`]) await measure("admin1", p);
}
if (mode === "cpu") {
  const tm = await import(`${API}/dist/services/teamMap.js`);
  // холодный расчёт карты команды (кэш в этом процессе пуст)
  for (const [name, teamId] of [["команда 0", T], ["команда 1", T2]]) {
    await new Promise((r) => setTimeout(r, 200)); ops = 0;
    let t = performance.now(); const map = await tm.getTeamMap(G, teamId); const cold = performance.now() - t; const coldOps = ops;
    t = performance.now(); let s = ""; for (let i = 0; i < 20; i++) s = JSON.stringify(map); const str = (performance.now() - t) / 20;
    // то же, что делает pushMapUpdate: две «публичные» копии и сравнение
    const pub = (m) => { const { rev, ...rest } = m; return JSON.parse(JSON.stringify({ ...rest, tasks: m.tasks.map((x) => (x.deed.secret ? { ...x, links: [], note: "" } : x)) })); };
    const jp = (await import(`${API}/node_modules/fast-json-patch/index.js`).catch(() => import(`${ROOT}/node_modules/fast-json-patch/index.js`))).default;
    t = performance.now(); for (let i = 0; i < 10; i++) jp.compare(pub(map), pub(map)); const diff = (performance.now() - t) / 10;
    console.log(`${name}: холодный расчёт карты ${cold.toFixed(1)} мс, ${coldOps} обращений Prisma; JSON.stringify карты ${str.toFixed(2)} мс (${s.length} символов); копии + сравнение для map-patch ${diff.toFixed(2)} мс`);
    // второй холодный расчёт (после сброса кэша) — уже «прогретая» база
    tm.invalidateTeamMaps(G, teamId); ops = 0; t = performance.now(); await tm.getTeamMap(G, teamId); console.log(`   повторный холодный расчёт: ${(performance.now() - t).toFixed(1)} мс, ${ops} обращений`);
  }
  // награды: чистый расчёт по выгруженным данным (как recomputeAwards, но без записи)
  const aw = await import(`${API}/dist/services/awards.js`);
  const { rulesOf } = await import(`${API}/dist/services/rules.js`);
  const game = await prisma.game.findUnique({ where: { id: G }, select: { settings: true } });
  const tz = rulesOf(game.settings).timeZone;
  ops = 0; let t = performance.now();
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
  const load = performance.now() - t;
  const entries = entryRows.map(({ battle, ...e }) => ({ ...e, bookCode: battle.bookCode }));
  const data = { tz, now: new Date(), teams: teams.map((x) => ({ id: x.id, members: x.members.map((m) => m.userId) })), tasks, works, journal, nodes, nodeStates, cityStates, battles, entries, wall, passages, peeks };
  const times = []; let grants = [];
  for (let i = 0; i < 5; i++) { t = performance.now(); grants = aw.computeAwards(data); times.push(performance.now() - t); }
  console.log(`награды: выгрузка истории ${load.toFixed(1)} мс (${ops} обращений; дел ${tasks.length}, записей летописи ${journal.length}), чистый расчёт computeAwards — медиана ${med(times).toFixed(1)} мс (занят весь процесс), наград ${grants.length}`);
  t = performance.now(); await aw.allStreaks(G); console.log(`allStreaks (серии всех участников): ${(performance.now() - t).toFixed(1)} мс`);
  const pace = await import(`${API}/dist/services/pace.js`);
  const ptimes = []; for (let i = 0; i < 3; i++) { t = performance.now(); await pace.paceForecast(G); ptimes.push(performance.now() - t); }
  console.log(`paceForecast (темп партии): медиана ${med(ptimes).toFixed(1)} мс`);
  const { gameDaytime } = await import(`${API}/dist/services/daytime.js`);
  t = performance.now(); for (let i = 0; i < 50; i++) await gameDaytime(G); console.log(`gameDaytime: ${((performance.now() - t) / 50).toFixed(2)} мс за вызов (1 запрос к базе + расчёт времени суток)`);
}
await app.close();
await prisma.$disconnect();
