import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `badm_${stamp}`, p1Nick = `bp1_${stamp}`, p2Nick = `bp2_${stamp}`;
let adminCookie = "", p1Cookie = "", p2Cookie = "", gameId = "", rutKey = "", team1 = "", team2 = "";
const content = JSON.parse(await readFile(new URL("../../../content/cities/rut.json", import.meta.url), "utf8")) as { tasks: unknown[] };
const allTasks = content.tasks.map((_, i) => i);

async function register(nickname: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname, password: "secret123" } });
  return res.headers["set-cookie"] as string;
}
async function joinTeam(name: string, cookie: string) {
  const t = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name } });
  const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${t.json().team.id}/invites`, headers: { cookie: adminCookie }, payload: { role: "CAPTAIN" } });
  await app.inject({ method: "POST", url: `/api/invites/${inv.json().invite.token}/accept`, headers: { cookie } });
  return t.json().team.id as string;
}
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });
/** Ссылка вида «1:5» → сквозной индекс по Руфи (22, 23, 18, 22). */
const OFF = [0, 22, 45, 63];
const idx = (ref: string) => { const [c, v] = ref.split(":").map(Number); return OFF[c! - 1]! + v! - 1; };
const ref = (i: number) => { let c = 0; while (c + 1 < OFF.length && OFF[c + 1]! <= i) c++; return `${c + 1}:${i - OFF[c]! + 1}`; };

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick);
  p1Cookie = await register(p1Nick);
  p2Cookie = await register(p2Nick);
  const g = await post("/api/games", adminCookie, { name: "Битвы", teamCount: 2 });
  gameId = g.json().game.id;
  await post(`/api/games/${gameId}/generate`, adminCookie);
  team1 = await joinTeam("Львы", p1Cookie);
  team2 = await joinTeam("Орлы", p2Cookie);
  await post(`/api/games/${gameId}/deeds/import-default`, adminCookie);
  await post(`/api/games/${gameId}/start`, adminCookie);
  const rut = await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "rut" } });
  rutKey = rut.key;
  await prisma.teamNodeState.createMany({ data: [{ teamId: team1, nodeKey: rutKey }, { teamId: team2, nodeKey: rutKey }] });
  // Львы взяли город (столица), Орлы изучили его.
  await prisma.teamCityState.createMany({ data: [
    { gameId, teamId: team1, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks, capturedAt: new Date(), isCapital: true },
    { gameId, teamId: team2, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks },
  ] });
});

afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, p1Nick, p2Nick] } } });
  await app.close();
  await prisma.$disconnect();
});

let battleId = "";

describe("битва за город", () => {
  it("владелец и не изучившие город войну объявить не могут; минимальная ставка 10", async () => {
    const own = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p1Cookie);
    expect(own.json().canDeclare).toBe(false);
    const w = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie);
    expect(w.json()).toMatchObject({ canDeclare: true, minBid: 10, defenseLevel: 0, bookVerses: 85 });
    const low = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie, { bid: 9 });
    expect(low.statusCode).toBe(400);
  });

  it("объявление войны выдаёт случайный отрывок из N стихов и запускает таймер атаки", async () => {
    const res = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie, { bid: 10 });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("ATTACK");
    battleId = res.json().id;
    const w = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie);
    const b = w.json().battles[0];
    expect(b.status).toBe("ATTACK");
    expect(b.passage.end - b.passage.start + 1).toBe(10);
    expect(b.attackDeadline).toBeTruthy();
    const again = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie, { bid: 10 });
    expect(again.statusCode).toBe(409);
    // Защитники видят объявленную атаку
    const d = await get(`/api/games/${gameId}/my-battles`, p1Cookie);
    expect(d.json().battles[0].id).toBe(battleId);
  });

  it("записи атакующих: только внутри отрывка, без повторов; полное покрытие фиксирует время атаки", async () => {
    const w = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie);
    const { start, end } = w.json().battles[0].passage as { start: number; end: number };
    const outside = await post(`/api/games/${gameId}/battles/${battleId}/entries`, p2Cookie, { from: ref(start === 0 ? end + 1 : start - 1), to: ref(start === 0 ? end + 1 : start - 1), links: ["https://example.com/v1"] });
    expect(outside.statusCode).toBe(400);
    const first = await post(`/api/games/${gameId}/battles/${battleId}/entries`, p2Cookie, { from: ref(start), to: ref(start + 5), links: ["https://example.com/v1"] });
    expect(first.statusCode).toBe(201);
    expect(first.json().covered).toBe(6);
    const dup = await post(`/api/games/${gameId}/battles/${battleId}/entries`, p2Cookie, { from: ref(start + 5), to: ref(start + 6), links: ["https://example.com/v2"] });
    expect(dup.statusCode).toBe(409);
    const defenderTooEarly = await post(`/api/games/${gameId}/battles/${battleId}/entries`, p1Cookie, { from: "1:1", to: "1:10", links: ["https://example.com/d"] });
    expect(defenderTooEarly.statusCode).toBe(409);
    const rest = await post(`/api/games/${gameId}/battles/${battleId}/entries`, p2Cookie, { from: ref(start + 6), to: ref(end), links: ["https://example.com/v3", "https://example.com/v4"] });
    expect(rest.json().covered).toBe(10);
    const b = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
    expect(b.attackDoneAt).toBeTruthy();
  });

  it("одобрение всей атаки админом запускает оборону ровно на T", async () => {
    await prisma.battle.update({ where: { id: battleId }, data: { startedAt: new Date(Date.now() - 3_600_000), attackDoneAt: new Date(Date.now() - 600_000) } });
    const list = await get(`/api/games/${gameId}/battles`, adminCookie);
    const entries = list.json().battles.find((b: { id: string }) => b.id === battleId).entries as Array<{ id: string; side: string }>;
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      const r = await post(`/api/games/${gameId}/battles/${battleId}/entries/${e.id}/decide`, adminCookie, { approve: true });
      expect(r.statusCode).toBe(200);
    }
    const b = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
    expect(b.status).toBe("DEFENSE");
    const T = b.defenseDeadline!.getTime() - b.attackApprovedAt!.getTime();
    expect(Math.abs(T - 3_000_000)).toBeLessThan(5_000);
  });

  it("защитники отвечают M ≥ N любым отрывком; одобрение в срок отражает атаку и поднимает уровень защиты", async () => {
    const short = await post(`/api/games/${gameId}/battles/${battleId}/entries`, p1Cookie, { from: "2:1", to: "2:9", links: ["https://example.com/d1"] });
    expect(short.json().covered).toBe(9);
    let b = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
    expect(b.defenseDoneAt).toBeNull();
    const more = await post(`/api/games/${gameId}/battles/${battleId}/entries`, p1Cookie, { from: "3:1", to: "3:3", links: ["https://example.com/d2"] });
    expect(more.json().covered).toBe(12);
    b = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
    expect(b.defenseDoneAt).toBeTruthy();
    const list = await get(`/api/games/${gameId}/battles`, adminCookie);
    const entries = list.json().battles.find((x: { id: string }) => x.id === battleId).entries as Array<{ id: string; side: string }>;
    for (const e of entries.filter((x) => x.side === "DEFENSE")) await post(`/api/games/${gameId}/battles/${battleId}/entries/${e.id}/decide`, adminCookie, { approve: true });
    b = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
    expect(b.status).toBe("REPELLED");
    expect(b.defenseBid).toBe(12);
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    expect(node.defenseLevel).toBe(12);
    const w = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie);
    expect(w.json().minBid).toBe(13);
    expect(w.json().canDeclare).toBe(true);
  });

  it("сгоревшая атака (14 дней без ссылок) даёт штраф +5 к минимальной ставке", async () => {
    const res = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie, { bid: 13 });
    expect(res.statusCode).toBe(201);
    await prisma.battle.update({ where: { id: res.json().id }, data: { attackDeadline: new Date(Date.now() - 1000) } });
    const w = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie);
    expect(w.json().battles[0].status).toBe("EXPIRED");
    expect(w.json().penalty).toBe(5);
    expect(w.json().minBid).toBe(15);
  });

  it("просроченная оборона: город взят, столица потеряна — команда выбывает", async () => {
    const res = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie, { bid: 15 });
    const id = res.json().id as string;
    const w = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie);
    const { start, end } = w.json().battles[0].passage as { start: number; end: number };
    await post(`/api/games/${gameId}/battles/${id}/entries`, p2Cookie, { from: ref(start), to: ref(end), links: ["https://example.com/all"] });
    const list = await get(`/api/games/${gameId}/battles`, adminCookie);
    const entry = list.json().battles.find((x: { id: string }) => x.id === id).entries[0] as { id: string };
    await post(`/api/games/${gameId}/battles/${id}/entries/${entry.id}/decide`, adminCookie, { approve: true });
    await prisma.battle.update({ where: { id }, data: { defenseDeadline: new Date(Date.now() - 1000) } });
    const after = await get(`/api/games/${gameId}/my-battles`, p1Cookie);
    expect(after.json().battles[0].status).toBe("WON");
    const mine = await prisma.teamCityState.findUniqueOrThrow({ where: { teamId_nodeKey: { teamId: team2, nodeKey: rutKey } } });
    expect(mine.capturedAt).toBeTruthy();
    expect(mine.isCapital).toBe(true);
    const lost = await prisma.teamCityState.findUniqueOrThrow({ where: { teamId_nodeKey: { teamId: team1, nodeKey: rutKey } } });
    expect(lost.capturedAt).toBeNull();
    const defeated = await prisma.team.findUniqueOrThrow({ where: { id: team1 } });
    expect(defeated.status).toBe("defeated");
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    expect(node.defenseLevel).toBe(15);
    expect(idx("2:1")).toBe(22);
  });
});
