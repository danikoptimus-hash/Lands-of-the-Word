import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { sweep } from "./services/battles.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";

/**
 * Стихи, выученные в другой команде (решение владельца 17.11): после проигрыша участники переходят в другие команды, и
 * стихи, которые они учили в прежней, второй раз не сдаются — ни блоком стены, ни в вызове, ни в ответе. Закрыто всё,
 * что участник там отметил и что администратор не вернул, даже непроверенное. В своей команде правило прежнее (03.10):
 * закрыто только принятое. Новой команде такие стихи и не засчитываются сами.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `ot_adm_${stamp}`, cap1: `ot_c1_${stamp}`, out: `ot_out_${stamp}`, cap2: `ot_c2_${stamp}`, cap3: `ot_c3_${stamp}`, m3: `ot_m3_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap1: "", out: "", cap2: "", cap3: "", m3: "" };
let gameId = "", team1 = "", team2 = "", team3 = "", outId = "", m3Id = "", rutKey = "", lostBattle = "";
const content = JSON.parse(await readFile(new URL("../../../content/cities/rut.json", import.meta.url), "utf8")) as { tasks: unknown[] };
const allTasks = content.tasks.map((_, i) => i);
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const register = async (nickname: string) => (await registerVerified(app, { nickname, password: "secret123" })).headers["set-cookie"] as string;
async function invite(teamId: string, by: string, role: "CAPTAIN" | "MEMBER" = "MEMBER") {
  return (await post(`/api/games/${gameId}/teams/${teamId}/invites`, by, { role })).json().invite.token as string;
}
const wallUrl = () => `/api/games/${gameId}/my-city/${rutKey}/wall`;
type Brick = { k: number; state: string; elsewhere?: boolean; takers: string[] };

/** Вызов городу Руфь от команды: ставка, все стихи отрывка отмечает капитан, администратор принимает, «Испытать». */
async function challenge(cookie: string, bid: number): Promise<string> {
  const declared = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, cookie, { bid });
  expect(declared.statusCode).toBe(201);
  const id = declared.json().id as string;
  const war = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, cookie);
  const { start, end } = war.json().battles.find((x: { id: string }) => x.id === id).passage as { start: number; end: number };
  const marked = await post(`/api/games/${gameId}/battles/${id}/entries`, cookie, { verses: Array.from({ length: end - start + 1 }, (_, i) => start + i), links: ["https://example.com/call"] });
  expect(marked.statusCode).toBe(201);
  expect((await post(`/api/games/${gameId}/battles/${id}/submit`, cookie)).statusCode).toBe(200);
  for (const e of await prisma.battleEntry.findMany({ where: { battleId: id, side: "ATTACK" } })) await post(`/api/games/${gameId}/battles/${id}/entries/${e.id}/decide`, ck.admin, { approve: true });
  const launched = await post(`/api/games/${gameId}/battles/${id}/attack`, cookie);
  expect(launched.statusCode).toBe(200);
  expect(launched.json().status).toBe("DEFENSE");
  return id;
}

beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) ck[k] = await register(nicks[k]);
  gameId = (await post("/api/games", ck.admin, { name: "Другая команда", teamCount: 3 })).json().game.id;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  team1 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Ковчег" })).json().team.id;
  team2 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Странники" })).json().team.id;
  team3 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Пустыня" })).json().team.id;
  await post(`/api/invites/${await invite(team1, ck.admin, "CAPTAIN")}/accept`, ck.cap1);
  await post(`/api/invites/${await invite(team1, ck.cap1)}/accept`, ck.out);
  await post(`/api/invites/${await invite(team2, ck.admin, "CAPTAIN")}/accept`, ck.cap2);
  await post(`/api/invites/${await invite(team3, ck.admin, "CAPTAIN")}/accept`, ck.cap3);
  await post(`/api/invites/${await invite(team3, ck.cap3)}/accept`, ck.m3);
  outId = (await prisma.user.findUniqueOrThrow({ where: { nickname: nicks.out } })).id;
  m3Id = (await prisma.user.findUniqueOrThrow({ where: { nickname: nicks.m3 } })).id;
  await post(`/api/games/${gameId}/deeds/import-default`, ck.admin);
  await readyForStart(app, gameId, ck.admin);
  await setGamePhase(app, gameId, ck.admin, "morning");
  const rules = await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: ck.admin }, payload: { settings: { rules: { minAnswerSeconds: 3600 } } } });
  if (rules.statusCode !== 200) throw new Error(`rules not set: ${rules.body}`);
  expect((await post(`/api/games/${gameId}/start`, ck.admin)).statusCode).toBe(200);
  // Руфь — столица «Ковчега»; «Странники» и «Пустыня» дошли до неё и решили её задания.
  rutKey = (await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "rut" } })).key;
  await prisma.teamNodeState.createMany({ data: [team1, team2, team3].map((teamId) => ({ teamId, nodeKey: rutKey })) });
  await prisma.teamCityState.createMany({ data: [
    { gameId, teamId: team1, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks, capturedAt: new Date(), isCapital: true },
    { gameId, teamId: team2, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks },
    { gameId, teamId: team3, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks },
  ] });
});

afterAll(async () => {
  await prisma.teamEdgeTask.deleteMany({ where: { gameId } });
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } });
  await cleanupFixtures(gameId);
  await app.close();
  await prisma.$disconnect();
});

describe("стихи, выученные в другой команде", () => {
  it("в прежней команде участник строит стену и отвечает на вызов; команда теряет столицу и выбывает", async () => {
    // Блок стены 1:1–1:10 (стихи 0–9) — сдан, администратор его не успел проверить.
    expect((await post(wallUrl(), ck.out, { block: 0, links: ["https://example.com/w0"] })).statusCode).toBe(201);
    lostBattle = await challenge(ck.cap3, 20);
    expect((await post(`/api/games/${gameId}/battles/${lostBattle}/defense-passage`, ck.cap1, { from: "1:1", to: "2:10" })).statusCode).toBe(200);
    // В ответе участник отмечает стихи 20–22; ответ не набран, записи так и остаются непроверенными.
    expect((await post(`/api/games/${gameId}/battles/${lostBattle}/entries`, ck.out, { verses: [20, 21, 22], links: ["https://example.com/d"] })).statusCode).toBe(201);
    await prisma.battle.update({ where: { id: lostBattle }, data: { defenseDeadline: new Date(Date.now() - 1000) } });
    await sweep(gameId);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: lostBattle } })).status).toBe("WON");
    expect((await prisma.team.findUniqueOrThrow({ where: { id: team1 } })).status).toBe("defeated");
    expect((await prisma.teamCityState.findUniqueOrThrow({ where: { teamId_nodeKey: { teamId: team3, nodeKey: rutKey } } })).capturedAt).toBeTruthy();
    expect((await prisma.battleEntry.findMany({ where: { battleId: lostBattle, userId: outId } })).map((e) => e.status)).toEqual(["SUBMITTED"]);
  });

  it("в новой команде блок стены, построенный в прежней, закрыт; стихи из её ответа — тоже", async () => {
    expect((await post(`/api/invites/${await invite(team3, ck.cap3)}/accept`, ck.out)).statusCode).toBe(201);
    expect((await get(`/api/games/${gameId}/my-map`, ck.out)).json().team.id).toBe(team3);
    const w = await get(wallUrl(), ck.out);
    expect(w.statusCode).toBe(200);
    const bricks = w.json().bricks as Brick[];
    // Блок 0 построен в другой команде; блок 2 (стихи 20–29) закрыт стихами из её ответа; блок 1 свободен.
    expect(bricks[0]).toMatchObject({ state: "learned", elsewhere: true });
    expect(bricks[0]!.takers).not.toContain(outId);
    expect(bricks[2]!.state).toBe("learned");
    expect(bricks[2]!.elsewhere).toBeUndefined();
    expect(bricks[2]!.takers).not.toContain(outId);
    expect(bricks[1]!.state).toBe("free");
    expect(bricks[1]!.takers).toContain(outId);
    // У капитана новой команды, который в прежней не был, эти блоки открыты.
    const cap = (await get(wallUrl(), ck.cap3)).json().bricks as Brick[];
    expect(cap[0]!.takers).toContain(m3Id);
    const again = await post(wallUrl(), ck.out, { block: 0, links: ["https://example.com/w0b"] });
    expect(again.statusCode).toBe(409);
    expect(again.json().message).toContain("в другой команде");
    // И за него этот блок не сдаст капитан.
    const forHim = await post(wallUrl(), ck.cap3, { block: 0, links: ["https://example.com/w0c"], forUserId: outId });
    expect(forHim.statusCode).toBe(409);
    expect(forHim.json().message).toContain("в другой команде");
    expect((await post(wallUrl(), ck.out, { block: 2, links: ["https://example.com/w2"] })).statusCode).toBe(409);
    // Свободный блок он сдаёт как обычно; тот же блок 0 сдаёт участник, который его не учил.
    expect((await post(wallUrl(), ck.out, { block: 1, links: ["https://example.com/w1"] })).statusCode).toBe(201);
    expect((await post(wallUrl(), ck.m3, { block: 0, links: ["https://example.com/w0m"] })).statusCode).toBe(201);
    expect(await prisma.wallBlock.count({ where: { gameId, userId: outId, teamId: team3 } })).toBe(1);
  });

  it("в ответе новой команды стихи из прежней не отмечаются и сами не засчитываются; своё правило команды прежнее", async () => {
    // Записи для сверки правил: непроверенная запись своей команды в прошлом испытании стихи не закрывает (правило 03.10),
    // возвращённая администратором запись прежней команды — тоже.
    await prisma.battleEntry.createMany({ data: [
      { battleId: lostBattle, side: "ATTACK", teamId: team3, userId: m3Id, startIdx: 25, endIdx: 26, links: ["https://example.com/own"], status: "SUBMITTED" },
      { battleId: lostBattle, side: "DEFENSE", teamId: team1, userId: outId, startIdx: 27, endIdx: 28, links: ["https://example.com/back"], status: "REJECTED", adminComment: "не то", decidedAt: new Date() },
    ] });
    const battleId = await challenge(ck.cap2, 25);
    // В ответ сами легли только стихи своей команды (вызов капитана «Пустыни»): из прежней команды участника — ничего.
    expect(await prisma.battleEntry.count({ where: { battleId, side: "DEFENSE", userId: outId } })).toBe(0);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: battleId } })).status).toBe("DEFENSE");
    expect((await post(`/api/games/${gameId}/battles/${battleId}/defense-passage`, ck.cap3, { from: "1:1", to: "2:10" })).statusCode).toBe(200);
    // Карточка испытания и карта книги показывают участнику эти стихи как сданные раньше.
    const view = (await get(`/api/games/${gameId}/my-battles`, ck.out)).json().battles.find((x: { id: string }) => x.id === battleId) as { learnedVerses: number[] };
    expect(view.learnedVerses).toEqual(expect.arrayContaining([0, 9, 10, 19, 20, 21, 22]));
    expect(view.learnedVerses).not.toContain(23);
    expect(view.learnedVerses).not.toContain(27);
    const map = (await get(`/api/games/${gameId}/book-map?book=rut&battle=${battleId}`, ck.cap3)).json().members as Array<{ userId: string; learned: number[] }>;
    expect(map.find((x) => x.userId === outId)!.learned).toEqual(expect.arrayContaining([0, 20, 22]));
    expect(map.find((x) => x.userId === m3Id)!.learned).not.toContain(25);
    const twice = await post(`/api/games/${gameId}/battles/${battleId}/entries`, ck.out, { verses: [20, 21], links: ["https://example.com/d2"] });
    expect(twice.statusCode).toBe(409);
    // Вперемешку с новыми: засчитаны только новые.
    const mixed = await post(`/api/games/${gameId}/battles/${battleId}/entries`, ck.out, { verses: [22, 23, 24], links: ["https://example.com/d3"] });
    expect(mixed.statusCode).toBe(201);
    expect(mixed.json().added).toBe(2);
    // И за него капитан эти стихи не отметит.
    expect((await post(`/api/games/${gameId}/battles/${battleId}/entries`, ck.cap3, { verses: [20, 21], links: ["https://example.com/d4"], forUserId: outId })).statusCode).toBe(409);
    // Возвращённое в прежней команде — открыто; непроверенное в своей команде — открыто, как и раньше.
    expect((await post(`/api/games/${gameId}/battles/${battleId}/entries`, ck.out, { verses: [27, 28], links: ["https://example.com/d5"] })).statusCode).toBe(201);
    expect((await post(`/api/games/${gameId}/battles/${battleId}/entries`, ck.m3, { verses: [25, 26], links: ["https://example.com/d6"] })).statusCode).toBe(201);
  });
});
