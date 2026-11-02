import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";

/** Карта книги и план заучивания (решение владельца 02.11): своя сторона в свою фазу, капитан поручает стихи тем, кто их ещё не сдавал. */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `bmadm_${stamp}`, keeperNick = `bmk_${stamp}`, keeper2Nick = `bmk2_${stamp}`, attackerNick = `bma_${stamp}`;
let adminCookie = "", keeperCookie = "", keeper2Cookie = "", attackerCookie = "", gameId = "", rutKey = "", keepers = "", attackers = "", keeper2Id = "";
const content = JSON.parse(await readFile(new URL("../../../content/cities/rut.json", import.meta.url), "utf8")) as { tasks: unknown[] };
const allTasks = content.tasks.map((_, i) => i);

async function register(nickname: string) { const res = await registerVerified(app, { nickname, password: "secret123" }); return res.headers["set-cookie"] as string; }
async function joinTeam(name: string, cookie: string, role: "CAPTAIN" | "MEMBER" = "CAPTAIN", teamId?: string) {
  let tid = teamId;
  if (!tid) { const tm = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name } }); tid = tm.json().team.id as string; }
  const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${tid}/invites`, headers: { cookie: adminCookie }, payload: { role } });
  await app.inject({ method: "POST", url: `/api/invites/${inv.json().invite.token}/accept`, headers: { cookie } });
  return tid;
}
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick); keeperCookie = await register(keeperNick); keeper2Cookie = await register(keeper2Nick); attackerCookie = await register(attackerNick);
  const g = await post("/api/games", adminCookie, { name: "Карта книги", teamCount: 2 });
  gameId = g.json().game.id;
  await post(`/api/games/${gameId}/generate`, adminCookie);
  keepers = await joinTeam("Стражи", keeperCookie);
  await joinTeam("Стражи", keeper2Cookie, "MEMBER", keepers);
  attackers = await joinTeam("Гости", attackerCookie);
  await post(`/api/games/${gameId}/deeds/import-default`, adminCookie);
  await readyForStart(app, gameId, adminCookie);
  await setGamePhase(app, gameId, adminCookie, "morning");
  await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: adminCookie }, payload: { settings: { rules: { minAnswerSeconds: 3600 } } } });
  await post(`/api/games/${gameId}/start`, adminCookie);
  const rut = await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "rut" } });
  rutKey = rut.key;
  await prisma.teamNodeState.createMany({ data: [{ teamId: keepers, nodeKey: rutKey }, { teamId: attackers, nodeKey: rutKey }] });
  await prisma.teamCityState.createMany({ data: [
    { gameId, teamId: keepers, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks, capturedAt: new Date(), isCapital: true },
    { gameId, teamId: attackers, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks },
  ] });
  keeper2Id = (await prisma.user.findUniqueOrThrow({ where: { nickname: keeper2Nick } })).id;
});

afterAll(async () => {
  await prisma.teamEdgeTask.deleteMany({ where: { gameId } });
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, keeperNick, keeper2Nick, attackerNick] } } });
  await cleanupFixtures(gameId);
  await app.close();
});

describe("карта книги", () => {
  it("в стене своего города: стихи, сданные стеной, закрыты только у сдавшего; капитан поручает стих тому, кто его не сдавал", async () => {
    const built = await post(`/api/games/${gameId}/my-city/${rutKey}/wall`, keeper2Cookie, { block: 0, links: ["https://example.com/w"] });
    expect(built.statusCode).toBe(201);
    await post(`/api/games/${gameId}/walls/${built.json().id}/decide`, adminCookie, { approve: true });
    const map = await get(`/api/games/${gameId}/book-map?book=rut`, keeperCookie);
    expect(map.statusCode).toBe(200);
    const m = map.json();
    expect(m.book.total).toBe(85);
    expect(m.canPlan).toBe(true);
    const k2 = m.members.find((x: { userId: string }) => x.userId === keeper2Id);
    expect(k2.learned.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(m.members.find((x: { captain: boolean }) => x.captain).learned).toEqual([]);
    // Поручить стих 1:1 сдавшему нельзя, участнику без блоков — можно; рядовой участник поручать не может.
    expect((await post(`/api/games/${gameId}/book-plan`, keeperCookie, { book: "rut", idx: 0, userId: keeper2Id, on: true })).statusCode).toBe(409);
    const me = (await prisma.user.findUniqueOrThrow({ where: { nickname: keeperNick } })).id;
    expect((await post(`/api/games/${gameId}/book-plan`, keeperCookie, { book: "rut", idx: 0, userId: me, on: true })).statusCode).toBe(200);
    expect((await post(`/api/games/${gameId}/book-plan`, keeper2Cookie, { book: "rut", idx: 1, userId: me, on: true })).statusCode).toBe(403);
    expect((await get(`/api/games/${gameId}/book-map?book=rut`, keeper2Cookie)).json().plan).toEqual([{ idx: 0, userId: me }]);
    expect((await post(`/api/games/${gameId}/book-plan`, keeperCookie, { book: "rut", idx: 0, userId: me, on: false })).statusCode).toBe(200);
    expect((await get(`/api/games/${gameId}/book-map?book=rut`, keeperCookie)).json().plan).toEqual([]);
    // Отрезок (пальцем по ряду или блок стены): поручить целиком; сдавшему часть стихов — нельзя.
    expect((await post(`/api/games/${gameId}/book-plan`, keeperCookie, { book: "rut", from: 10, to: 19, userId: me, on: true })).statusCode).toBe(200);
    expect((await get(`/api/games/${gameId}/book-map?book=rut`, keeperCookie)).json().plan).toHaveLength(10);
    expect((await post(`/api/games/${gameId}/book-plan`, keeperCookie, { book: "rut", from: 5, to: 12, userId: keeper2Id, on: true })).statusCode).toBe(409);
    expect((await post(`/api/games/${gameId}/book-plan`, keeperCookie, { book: "rut", from: 10, to: 19, userId: me, on: false })).statusCode).toBe(200);
    expect((await get(`/api/games/${gameId}/book-map?book=rut`, keeperCookie)).json().plan).toEqual([]);
    // Лист блоков стены: кто может взять каждый блок — блок 1–10 закрыт у сдавшего, свободен у капитана.
    const wall = (await get(`/api/games/${gameId}/my-city/${rutKey}/wall`, keeperCookie)).json();
    expect(wall.canPlan).toBe(true);
    expect(wall.members).toHaveLength(2);
    expect(wall.bricks[0].takers).toEqual([me]);
    expect(wall.bricks[1].takers.sort()).toEqual([me, keeper2Id].sort());
    await post(`/api/games/${gameId}/book-plan`, keeperCookie, { book: "rut", from: 10, to: 19, userId: keeper2Id, on: true });
    expect((await get(`/api/games/${gameId}/my-city/${rutKey}/wall`, keeperCookie)).json().bricks[1].planned).toEqual([keeper2Id]);
    expect((await get(`/api/games/${gameId}/my-city/${rutKey}/wall`, keeper2Cookie)).json().canPlan).toBe(false);
  });

  it("в испытании: претендентам в вызове, хранителям в ответе, чужой стороне нельзя", async () => {
    const declared = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, attackerCookie, { bid: 10 });
    expect(declared.statusCode).toBe(201);
    const battleId = declared.json().id as string;
    const atk = await get(`/api/games/${gameId}/book-map?book=rut&battle=${battleId}`, attackerCookie);
    expect(atk.statusCode).toBe(200);
    expect(atk.json().passage).toBeTruthy();
    expect((await get(`/api/games/${gameId}/book-map?book=rut&battle=${battleId}`, keeperCookie)).statusCode).toBe(409);
    const war = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, attackerCookie);
    const b = war.json().battles.find((x: { id: string }) => x.id === battleId);
    await post(`/api/games/${gameId}/battles/${battleId}/entries`, attackerCookie, { verses: Array.from({ length: 10 }, (_, i) => b.passage.start + i), links: ["https://example.com/a"] });
    const marked = (await get(`/api/games/${gameId}/book-map?book=rut&battle=${battleId}`, attackerCookie)).json().members[0].marked;
    expect(marked).toHaveLength(10);
    await post(`/api/games/${gameId}/battles/${battleId}/submit`, attackerCookie);
    for (const e of await prisma.battleEntry.findMany({ where: { battleId, side: "ATTACK" } })) await post(`/api/games/${gameId}/battles/${battleId}/entries/${e.id}/decide`, adminCookie, { approve: true });
    await post(`/api/games/${gameId}/battles/${battleId}/attack`, attackerCookie);
    expect((await get(`/api/games/${gameId}/book-map?book=rut&battle=${battleId}`, attackerCookie)).statusCode).toBe(409);
    const def = await get(`/api/games/${gameId}/book-map?book=rut&battle=${battleId}`, keeperCookie);
    expect(def.statusCode).toBe(200);
    expect(def.json().need).toBe(10);
    expect(def.json().have).toBe(0);
    expect((await get(`/api/games/${gameId}/book-map?book=deu&battle=${battleId}`, keeperCookie)).statusCode).toBe(400);
  });
});
