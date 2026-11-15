// Модель «общее событие в партии из N команд»: все карты команд сброшены и пересчитываются разом (как invalidateTeamMaps),
// затем для каждой считается разница (как pushMapUpdate). Берём три настоящие команды «Осени» и повторяем их K раз.
import fs from "node:fs"; import { performance, monitorEventLoopDelay } from "node:perf_hooks";
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, ""); const API = `${ROOT}/apps/api`;
const env = process.env; // DATABASE_URL и SESSION_SECRET — из окружения, как у локального сервера (apps/api/.env)
process.env.DATABASE_URL = env.DATABASE_URL + (process.argv[3] ? `&connection_limit=${process.argv[3]}` : ""); process.env.SESSION_SECRET = env.SESSION_SECRET; process.env.NODE_ENV = "test"; process.chdir(API);
const { prisma } = await import(`${API}/dist/db.js`);
let ops = 0; const orig = prisma._request.bind(prisma); prisma._request = (p) => { ops++; return orig(p); };
const tm = await import(`${API}/dist/services/teamMap.js`);
const jp = (await import(`${ROOT}/node_modules/fast-json-patch/index.js`)).default;
const G = "cmucujbgq0008s301ran0fnt4"; const teams = ["cmuculht800n1s301sd0a6z1q", "cmuculm0t00n3s3012zuggytf", "cmuculw7v00n5s3019gmgl09c"];
const pub = (m) => { const { rev, ...rest } = m; return JSON.parse(JSON.stringify({ ...rest, tasks: m.tasks.map((x) => (x.deed.secret ? { ...x, links: [], note: "" } : x)) })); };
// прогрев
const prev = []; for (const t of teams) prev.push(await tm.getTeamMap(G, t));
const K = Number(process.argv[2] ?? 10);
const h = monitorEventLoopDelay({ resolution: 5 }); h.enable();
ops = 0; const cpu0 = process.cpuUsage(); const t0 = performance.now();
const jobs = [];
for (let k = 0; k < K; k++) for (let i = 0; i < teams.length; i++) {
  tm.invalidateTeamMaps(G, teams[i]);            // кэш сброшен — следующий вызов считает заново
  jobs.push(tm.getTeamMap(G, teams[i]).then((next) => { jp.compare(pub(prev[i]), pub(next)); }));
}
await Promise.all(jobs);
const wall = performance.now() - t0; const cpu = process.cpuUsage(cpu0); h.disable();
console.log(`${K * teams.length} пересчётов карт разом (пул соединений: ${process.argv[3] ?? "по умолчанию"}): всего ${wall.toFixed(0)} мс по часам; процессор Node ${((cpu.user + cpu.system) / 1000).toFixed(0)} мс (на один пересчёт ${(((cpu.user + cpu.system) / 1000) / (K * teams.length)).toFixed(1)} мс); обращений Prisma ${ops}; наибольшая задержка цикла событий ${(h.max / 1e6).toFixed(0)} мс, средняя ${(h.mean / 1e6).toFixed(1)} мс`);
await prisma.$disconnect();
