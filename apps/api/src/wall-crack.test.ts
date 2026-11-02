import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { sweep } from "./services/battles.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";

/**
 * Надломленный блок стены (решение владельца 02.11): «стихов нужно было 24, хранители сами сдали 20, не хватает 4 —
 * игра пусть возьмёт из блока только недостающие стихи; после этого блок надломлен, его можно починить, досдав стихи».
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `wcadm_${stamp}`, keeperNick = `wck_${stamp}`, keeper2Nick = `wck2_${stamp}`, attackerNick = `wca_${stamp}`;
let adminCookie = "", keeperCookie = "", keeper2Cookie = "", attackerCookie = "", gameId = "", rutKey = "", keepers = "", attackers = "";
const content = JSON.parse(await readFile(new URL("../../../content/cities/rut.json", import.meta.url), "utf8")) as { tasks: unknown[] };
const allTasks = content.tasks.map((_, i) => i);

async function register(nickname: string) {
  const res = await registerVerified(app, { nickname, password: "secret123" });
  return res.headers["set-cookie"] as string;
}
async function joinTeam(name: string, cookie: string, role: "CAPTAIN" | "MEMBER" = "CAPTAIN", teamId?: string) {
  let tid = teamId;
  if (!tid) {
    const t = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name } });
    tid = t.json().team.id as string;
  }
  const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${tid}/invites`, headers: { cookie: adminCookie }, payload: { role } });
  await app.inject({ method: "POST", url: `/api/invites/${inv.json().invite.token}/accept`, headers: { cookie } });
  return tid;
}
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });
const wallUrl = () => `/api/games/${gameId}/my-city/${rutKey}/wall`;

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick);
  keeperCookie = await register(keeperNick);
  keeper2Cookie = await register(keeper2Nick);
  attackerCookie = await register(attackerNick);
  const g = await post("/api/games", adminCookie, { name: "Надлом", teamCount: 2 });
  gameId = g.json().game.id;
  await post(`/api/games/${gameId}/generate`, adminCookie);
  keepers = await joinTeam("Стражи", keeperCookie);
  await joinTeam("Стражи", keeper2Cookie, "MEMBER", keepers);
  attackers = await joinTeam("Гости", attackerCookie);
  await post(`/api/games/${gameId}/deeds/import-default`, adminCookie);
  await readyForStart(app, gameId, adminCookie);
  await setGamePhase(app, gameId, adminCookie, "morning");
  const rules = await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: adminCookie }, payload: { settings: { rules: { minAnswerSeconds: 3600 } } } });
  if (rules.statusCode !== 200) throw new Error(`rules not set: ${rules.body}`);
  await post(`/api/games/${gameId}/start`, adminCookie);
  const rut = await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "rut" } });
  rutKey = rut.key;
  await prisma.teamNodeState.createMany({ data: [{ teamId: keepers, nodeKey: rutKey }, { teamId: attackers, nodeKey: rutKey }] });
  await prisma.teamCityState.createMany({ data: [
    { gameId, teamId: keepers, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks, capturedAt: new Date(), isCapital: true },
    { gameId, teamId: attackers, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks },
  ] });
});

afterAll(async () => {
  await prisma.teamEdgeTask.deleteMany({ where: { gameId } });
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, keeperNick, keeper2Nick, attackerNick] } } });
  await cleanupFixtures(gameId);
  await app.close();
});

describe("надломленный блок стены", () => {
  let blockId = "";
  it("из блока берутся только недостающие стихи: блок надломлен, в стене остаются остальные", async () => {
    // Капитан хранителей сдал блок 1 (стихи 11–20), администратор принял.
    const built = await post(wallUrl(), keeperCookie, { block: 1, links: ["https://example.com/w1"] });
    expect(built.statusCode).toBe(201);
    blockId = built.json().id as string;
    await post(`/api/games/${gameId}/walls/${blockId}/decide`, adminCookie, { approve: true });
    expect((await get(wallUrl(), keeperCookie)).json()).toMatchObject({ verses: 10, blockCount: 1 });
    // Вызов на 14 стихов: претендент учит 14, администратор принимает, «Испытать».
    const declared = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, attackerCookie, { bid: 14 });
    expect(declared.statusCode).toBe(201);
    const battleId = declared.json().id as string;
    const war = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, attackerCookie);
    const b = war.json().battles.find((x: { id: string }) => x.id === battleId);
    const marked = await post(`/api/games/${gameId}/battles/${battleId}/entries`, attackerCookie, { verses: Array.from({ length: 14 }, (_, i) => b.passage.start + i), links: ["https://example.com/a"] });
    expect(marked.statusCode).toBe(201);
    expect((await post(`/api/games/${gameId}/battles/${battleId}/submit`, attackerCookie)).statusCode).toBe(200);
    for (const e of await prisma.battleEntry.findMany({ where: { battleId, side: "ATTACK" } })) await post(`/api/games/${gameId}/battles/${battleId}/entries/${e.id}/decide`, adminCookie, { approve: true });
    const launched = await post(`/api/games/${gameId}/battles/${battleId}/attack`, attackerCookie);
    expect(launched.json().status).toBe("DEFENSE");
    // Хранители сами отвечают 10 стихами (участник без блоков учит 1–10): не хватает 4.
    await post(`/api/games/${gameId}/battles/${battleId}/defense-passage`, keeperCookie, { from: "1:1", to: "2:10" });
    const own = await post(`/api/games/${gameId}/battles/${battleId}/entries`, keeper2Cookie, { verses: Array.from({ length: 10 }, (_, i) => i), links: ["https://example.com/d"] });
    expect(own.statusCode).toBe(201);
    for (const e of await prisma.battleEntry.findMany({ where: { battleId, side: "DEFENSE" } })) await post(`/api/games/${gameId}/battles/${battleId}/entries/${e.id}/decide`, adminCookie, { approve: true });
    // Последняя минута: из блока 11–20 берутся только 4 недостающих стиха, с конца (17–20); город устоял.
    await prisma.battle.update({ where: { id: battleId }, data: { defenseDeadline: new Date(Date.now() + 50_000) } });
    await sweep(gameId);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: battleId } })).status).toBe("REPELLED");
    const laid = await prisma.battleEntry.findMany({ where: { battleId, side: "DEFENSE", note: "Блок городской стены" } });
    expect(laid).toHaveLength(1);
    expect(laid[0]).toMatchObject({ startIdx: 16, endIdx: 19, carried: true, status: "APPROVED" });
    const block = await prisma.wallBlock.findUniqueOrThrow({ where: { id: blockId } });
    expect(block).toMatchObject({ missing: 4, usedAt: null, usedBattleId: battleId });
    // В стене остались 6 стихов блока; кирпич хозяина — надломлен, с указанием недостающих стихов.
    const wall = (await get(wallUrl(), keeperCookie)).json();
    expect(wall).toMatchObject({ verses: 6, blockCount: 1 });
    expect(wall.blocks.find((x: { id: string }) => x.id === blockId)).toMatchObject({ missing: 4, repairPending: false, used: false });
    expect(wall.bricks[1]).toMatchObject({ state: "cracked", missing: 4 });
    expect(wall.bricks[1].repairRef).toBeTruthy();
    expect(wall.canBuild).toBe(true);
  });

  it("починка: хозяин досдаёт недостающие стихи, администратор принимает — блок снова цел", async () => {
    // Чинит только хозяин: у второго участника этот блок свободен и сдаётся как новый.
    const repair = await post(wallUrl(), keeperCookie, { block: 1, links: ["https://example.com/fix"] });
    expect(repair.statusCode).toBe(201);
    expect(repair.json().repair).toBe(true);
    const again = await post(wallUrl(), keeperCookie, { block: 1, links: ["https://example.com/fix2"] });
    expect(again.statusCode).toBe(409);
    let wall = (await get(wallUrl(), keeperCookie)).json();
    expect(wall.bricks[1].state).toBe("submitted");
    expect(wall.blocks.find((x: { id: string }) => x.id === blockId)).toMatchObject({ missing: 4, repairPending: true });
    expect(wall.pending).toBe(1);
    const row = await prisma.wallBlock.findFirstOrThrow({ where: { repairOfId: blockId } });
    expect(row).toMatchObject({ startIdx: 16, endIdx: 19, status: "SUBMITTED" });
    // Администратор видит починку в списке стен и принимает её.
    const list = await get(`/api/games/${gameId}/walls`, adminCookie);
    expect(list.json().blocks.find((x: { id: string }) => x.id === row.id)).toMatchObject({ repair: true, verses: 4 });
    expect((await post(`/api/games/${gameId}/walls/${row.id}/decide`, adminCookie, { approve: true })).statusCode).toBe(200);
    expect(await prisma.wallBlock.findUniqueOrThrow({ where: { id: blockId } })).toMatchObject({ missing: 0, usedAt: null });
    wall = (await get(wallUrl(), keeperCookie)).json();
    expect(wall).toMatchObject({ verses: 10, blockCount: 1, pending: 0 });
    expect(wall.bricks[1].state).toBe("approved");
    expect(wall.blocks).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 300));
    const kinds = (await prisma.journal.findMany({ where: { gameId, kind: { in: ["wall_applied", "wall_repair_submitted", "wall_block_repaired"] } } })).map((r) => r.kind).sort();
    expect(kinds).toEqual(["wall_applied", "wall_block_repaired", "wall_repair_submitted"]);
  });
});
