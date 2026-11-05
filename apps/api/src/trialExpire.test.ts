import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";

/**
 * «Время вышло» (решение владельца 05.11): администратор закрывает ход стороны как просроченный, когда команда тянет
 * время нерабочей ссылкой или подменой сообщения в Телеграме, пока запись лежит на проверке.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `xadm_${stamp}`, p1Nick = `xp1_${stamp}`, p2Nick = `xp2_${stamp}`;
let adminCookie = "", p1Cookie = "", p2Cookie = "", gameId = "", rutKey = "", team1 = "", team2 = "";
const content = JSON.parse(await readFile(new URL("../../../content/cities/rut.json", import.meta.url), "utf8")) as { tasks: unknown[] };
const allTasks = content.tasks.map((_, i) => i);

async function register(nickname: string) {
  const res = await registerVerified(app, { nickname, password: "secret123" });
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

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick);
  p1Cookie = await register(p1Nick);
  p2Cookie = await register(p2Nick);
  const g = await post("/api/games", adminCookie, { name: "Время вышло", teamCount: 2 });
  gameId = g.json().game.id;
  await post(`/api/games/${gameId}/generate`, adminCookie);
  team1 = await joinTeam("Львы", p1Cookie);
  team2 = await joinTeam("Орлы", p2Cookie);
  await post(`/api/games/${gameId}/deeds/import-default`, adminCookie);
  await readyForStart(app, gameId, adminCookie);
  await setGamePhase(app, gameId, adminCookie, "morning");
  await post(`/api/games/${gameId}/start`, adminCookie);
  const rut = await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "rut" } });
  rutKey = rut.key;
  await prisma.teamNodeState.createMany({ data: [{ teamId: team1, nodeKey: rutKey }, { teamId: team2, nodeKey: rutKey }] });
  // Львы взяли город (столица), Орлы изучили его.
  await prisma.teamCityState.createMany({ data: [
    { gameId, teamId: team1, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks, capturedAt: new Date(), isCapital: true },
    { gameId, teamId: team2, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks },
  ] });
}, 60_000);

afterAll(async () => {
  await prisma.teamEdgeTask.deleteMany({ where: { gameId } });
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, p1Nick, p2Nick] } } });
  await cleanupFixtures(gameId);
  await app.close();
  await prisma.$disconnect();
});

/** Вызов Орлов городу Львов с минимальной ставкой: весь отрывок одной записью, отправка на проверку. */
async function declareAndSubmit(): Promise<string> {
  const w0 = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie);
  const res = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie, { bid: w0.json().minBid });
  expect([200, 201]).toContain(res.statusCode);
  const id = res.json().id as string;
  const w = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie);
  const { start, end } = w.json().battles.find((x: { id: string }) => x.id === id).passage as { start: number; end: number };
  // Стих сдаётся один раз (03.10): записи прошлого боя убираем, чтобы весь отрывок был доступен.
  const p2Id = (await prisma.user.findUniqueOrThrow({ where: { nickname: p2Nick } })).id;
  await prisma.battleEntry.deleteMany({ where: { userId: p2Id, side: "ATTACK", battle: { gameId, NOT: { id } } } });
  const r = await post(`/api/games/${gameId}/battles/${id}/entries`, p2Cookie, { verses: Array.from({ length: end - start + 1 }, (_, i) => start + i), links: ["https://t.me/c/1/2"] });
  expect([200, 201]).toContain(r.statusCode);
  expect((await post(`/api/games/${gameId}/battles/${id}/submit`, p2Cookie)).statusCode).toBe(200);
  return id;
}

describe("«Время вышло» в проверке испытания", () => {
  it("претенденты: ход закрыт как просроченный — вызов сгорел, штраф к ставке, записи возвращены с комментарием", async () => {
    const id = await declareAndSubmit();
    expect((await post(`/api/games/${gameId}/battles/${id}/expire`, p2Cookie, { comment: "x" })).statusCode).toBe(403);
    const before = (await prisma.teamCityState.findUniqueOrThrow({ where: { teamId_nodeKey: { teamId: team2, nodeKey: rutKey } } })).attackPenalty;
    const r = await post(`/api/games/${gameId}/battles/${id}/expire`, adminCookie, { comment: "Ссылка ведёт в чат, где нас нет" });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("EXPIRED");
    const b = await prisma.battle.findUniqueOrThrow({ where: { id }, include: { entries: true } });
    expect(b.status).toBe("EXPIRED");
    expect(b.entries.map((e) => [e.status, e.adminComment])).toEqual([["REJECTED", "Ссылка ведёт в чат, где нас нет"]]);
    const after = await prisma.teamCityState.findUniqueOrThrow({ where: { teamId_nodeKey: { teamId: team2, nodeKey: rutKey } } });
    expect(after.attackPenalty).toBeGreaterThan(before);
    // Повторно нельзя: ход уже не идёт.
    expect((await post(`/api/games/${gameId}/battles/${id}/expire`, adminCookie, {})).statusCode).toBe(409);
  });

  it("хранители: ход закрыт как просроченный — город потерян, записи возвращены", async () => {
    const id = await declareAndSubmit();
    const list = await get(`/api/games/${gameId}/battles`, adminCookie);
    const entries = list.json().battles.find((x: { id: string }) => x.id === id).entries as Array<{ id: string; side: string; status: string }>;
    for (const e of entries.filter((x) => x.side === "ATTACK" && x.status === "SUBMITTED")) expect((await post(`/api/games/${gameId}/battles/${id}/entries/${e.id}/decide`, adminCookie, { approve: true })).statusCode).toBe(200);
    const launched = await post(`/api/games/${gameId}/battles/${id}/attack`, p2Cookie);
    expect(launched.statusCode, launched.body).toBe(200);
    const st = await prisma.battle.findUniqueOrThrow({ where: { id }, include: { entries: true } });
    expect(st.status, JSON.stringify(st)).toBe("DEFENSE");
    // Хранители выбирают отрывок, сдают запись с нерабочей ссылкой и отправляют на проверку: стоп-часы встали.
    // Отрывок ответа — две главы (45 стихов): после сгоревшего вызова минимальная ставка выросла, ответ должен её покрыть.
    const dp = await post(`/api/games/${gameId}/battles/${id}/defense-passage`, p1Cookie, { from: "1:1", to: "2:23" });
    expect(dp.statusCode, dp.body).toBe(200);
    expect([200, 201]).toContain((await post(`/api/games/${gameId}/battles/${id}/entries`, p1Cookie, { verses: Array.from({ length: 45 }, (_, i) => i), links: ["https://t.me/c/1/3"] })).statusCode);
    const sent = await post(`/api/games/${gameId}/battles/${id}/submit`, p1Cookie);
    expect(sent.statusCode, sent.body).toBe(200);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id } })).defenseDoneAt).toBeTruthy();
    const r = await post(`/api/games/${gameId}/battles/${id}/expire`, adminCookie, { comment: "Сообщение подменено" });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("WON");
    const b = await prisma.battle.findUniqueOrThrow({ where: { id }, include: { entries: true } });
    expect(b.entries.filter((e) => e.side === "DEFENSE").map((e) => [e.status, e.adminComment])).toEqual([["REJECTED", "Сообщение подменено"]]);
    const mine = await prisma.teamCityState.findUniqueOrThrow({ where: { teamId_nodeKey: { teamId: team2, nodeKey: rutKey } } });
    expect(mine.capturedAt).toBeTruthy();
    const lost = await prisma.teamCityState.findUniqueOrThrow({ where: { teamId_nodeKey: { teamId: team1, nodeKey: rutKey } } });
    expect(lost.capturedAt).toBeNull();
  });
});
