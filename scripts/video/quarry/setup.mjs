// Подготовка локальной партии для ролика о Каменоломне: две команды по шесть участников (вымышленные имена), «Ковчег» у прибрежного города.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
const BASE = "http://localhost:3000", PASS = process.env.LOCAL_PASS;
if (!PASS) throw new Error("Нужен LOCAL_PASS — пароль локальных учёток");
const p = new PrismaClient();
const { revealNode } = await import("../../../apps/api/dist/services/teamMap.js");
const jar = new Map();
async function api(who, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie: jar.get(who) ?? "" }, body: body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body) });
  const sc = r.headers.get("set-cookie"); if (sc) jar.set(who, sc.split(";")[0]);
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${txt.slice(0, 300)}`);
  return j;
}
const hash = await bcrypt.hash(PASS, 10);
async function user(nickname, displayName) {
  return p.user.upsert({ where: { nickname }, create: { nickname, displayName, email: `${nickname}@example.com`, passwordHash: hash, emailVerified: true }, update: { displayName, passwordHash: hash, emailVerified: true } });
}
const admin = await user("q_admin", "Администратор");
// Прежние пробные партии этого администратора — долой (каскадом).
for (const old of await p.game.findMany({ where: { createdById: admin.id } })) await p.game.delete({ where: { id: old.id } });
await api("admin", "POST", "/api/auth/login", { nickname: "q_admin", password: PASS });
const g = (await api("admin", "POST", "/api/games", { name: "Весенний сезон", teamCount: 2 })).game;
await api("admin", "POST", `/api/games/${g.id}/generate`, process.env.SEED ? { seed: Number(process.env.SEED) } : {});
const TEAMS = [
  { name: "Ковчег", people: [["q_david", "Давид", "CAPTAIN", "NONE"], ["q_anna", "Анна", "DEPUTY", "NONE"], ["q_samuil", "Самуил", "MEMBER", "CHRONICLER"], ["q_lidia", "Лидия", "MEMBER", "SCOUT"], ["q_timofey", "Тимофей", "MEMBER", "AMBASSADOR"], ["q_miriam", "Мириам", "MEMBER", "PROPHET"]] },
  { name: "Странники", people: [["q_iosif", "Иосиф", "CAPTAIN", "NONE"], ["q_revekka", "Ревекка", "DEPUTY", "NONE"], ["q_varnava", "Варнава", "MEMBER", "CHRONICLER"], ["q_marfa", "Марфа", "MEMBER", "SCOUT"], ["q_sila", "Сила", "MEMBER", "AMBASSADOR"], ["q_priskilla", "Прискилла", "MEMBER", "PROPHET"]] },
];
const teams = [];
for (const t of TEAMS) {
  const team = (await api("admin", "POST", `/api/games/${g.id}/teams`, { name: t.name })).team;
  for (const [nick, name, role, gameRole] of t.people) {
    const u = await user(nick, name);
    await p.membership.deleteMany({ where: { userId: u.id, team: { gameId: g.id } } });
    await p.membership.create({ data: { teamId: team.id, userId: u.id, role, gameRole } });
  }
  teams.push(team);
}
// День по поясу игры: сейчас в нём 12 часов.
const now = new Date(); let n = ((12 - now.getUTCHours()) % 24 + 24) % 24; if (n > 14) n -= 24;
const tz = n === 0 ? "Etc/GMT" : n > 0 ? `Etc/GMT-${n}` : `Etc/GMT+${-n}`;
await api("admin", "PATCH", `/api/games/${g.id}`, { settings: { rules: { timeZone: tz } } });
await api("admin", "POST", `/api/games/${g.id}/recipients`, { label: "семья у реки", kind: "FAMILY" });
await api("admin", "POST", `/api/games/${g.id}/deeds/import-default`, { mode: "add" });
await api("admin", "POST", `/api/games/${g.id}/start`, {});
// Стандартные дела — «старые»: в «Внимании» появится только дело, которое администратор добавит в ролике.
await p.deed.updateMany({ where: { gameId: g.id }, data: { createdAt: new Date(Date.now() - 6 * 864e5) } });
// «Ковчег» дошёл до ближайшего прибрежного города по суше (дела по пути приняты).
const [edges, nodes] = await Promise.all([p.mapEdge.findMany({ where: { gameId: g.id } }), p.mapNode.findMany({ where: { gameId: g.id } })]);
const adj = new Map(); for (const e of edges) { (adj.get(e.aKey) ?? adj.set(e.aKey, []).get(e.aKey)).push(e.bKey); (adj.get(e.bKey) ?? adj.set(e.bKey, []).get(e.bKey)).push(e.aKey); }
const coastal = new Set(nodes.filter((x) => x.kind === "CITY" && x.coastal).map((x) => x.key));
const t1 = await p.team.findUniqueOrThrow({ where: { id: teams[0].id } });
const prev = new Map([[t1.startNodeKey, null]]); const q = [t1.startNodeKey]; let goal = null;
while (q.length && !goal) { const k = q.shift(); for (const nb of adj.get(k) ?? []) { if (prev.has(nb)) continue; prev.set(nb, k); if (coastal.has(nb)) { goal = nb; break; } q.push(nb); } }
const path = []; for (let k = goal; k; k = prev.get(k)) path.unshift(k);
const cap = await p.user.findUniqueOrThrow({ where: { nickname: "q_david" } });
for (let i = 1; i < path.length; i++) {
  const [a, b] = [path[i - 1], path[i]];
  const task = await p.teamEdgeTask.findFirst({ where: { teamId: t1.id, OR: [{ fromKey: a, toKey: b }, { fromKey: b, toKey: a }] } });
  if (task) await p.teamEdgeTask.update({ where: { id: task.id }, data: { status: "APPROVED", takenById: cap.id, takenAt: now, submittedAt: now, decidedAt: now, participants: [cap.id] } });
  await revealNode(g.id, t1.id, b);
}
console.log(JSON.stringify({ gameId: g.id, teams: teams.map((t) => ({ id: t.id, name: t.name })), path, goal, tz }));
await p.$disconnect(); process.exit(0);
