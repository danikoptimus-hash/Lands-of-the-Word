import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { maybeRepel, sweep } from "./services/battles.js";
import { answerCap } from "./services/learned.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";

/**
 * Стихи, выученные в другой команде (решение владельца 17.11): после проигрыша участники переходят в другие команды, и
 * стихи, которые они учили в прежней, второй раз не сдаются — ни блоком стены, ни в вызове, ни в ответе. Закрыто всё,
 * что участник там отметил и что администратор не вернул как негодное: принятое, непроверенное и возвращённое концом
 * хода («Время вышло»). В своей команде правило прежнее (03.10): закрыто только принятое. Новой команде такие стихи и
 * не засчитываются сами.
 *
 * Стихи книги Руфь у перешедшего участника (отрывок ответа — стихи 0–31):
 *   0–9   блок стены прежней команды, на проверке        — закрыт
 *   10–19 блок, который он строит уже в новой команде
 *   20–22 отмечены в ответе прежней команды, не проверены — закрыты
 *   23–24 свободны
 *   27–28 возвращены администратором задолго до конца     — открыты
 *   29    возвращён вместе с концом хода                  — закрыт
 *   30–31 приняты в прежней команде                       — закрыты и в ответ новой сами не ложатся
 *   40–49 принятый блок стены прежней команды             — закрыт
 *   50–59 блок прежней команды, возвращённый администратором — открыт
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `ot_adm_${stamp}`, cap1: `ot_c1_${stamp}`, out: `ot_out_${stamp}`, cap2: `ot_c2_${stamp}`, cap3: `ot_c3_${stamp}`, m3: `ot_m3_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap1: "", out: "", cap2: "", cap3: "", m3: "" };
let gameId = "", team1 = "", team2 = "", team3 = "", outId = "", m3Id = "", rutKey = "", jonKey = "", lostBattle = "", answerBattle = "";
const tasksOf = async (code: string) => (JSON.parse(await readFile(new URL(`../../../content/cities/${code}.json`, import.meta.url), "utf8")) as { tasks: unknown[] }).tasks.map((_, i) => i);
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const del = (url: string, cookie: string) => app.inject({ method: "DELETE", url, headers: { cookie } });
const register = async (nickname: string) => (await registerVerified(app, { nickname, password: "secret123" })).headers["set-cookie"] as string;
async function invite(teamId: string, by: string, role: "CAPTAIN" | "MEMBER" = "MEMBER") {
  return (await post(`/api/games/${gameId}/teams/${teamId}/invites`, by, { role })).json().invite.token as string;
}
const wallUrl = () => `/api/games/${gameId}/my-city/${rutKey}/wall`;
type Brick = { k: number; state: string; elsewhere?: boolean; takers: string[] };
const learnedOf = async (cookie: string, userId: string, battle?: string) =>
  ((await get(`/api/games/${gameId}/book-map?book=rut${battle ? `&battle=${battle}` : ""}`, cookie)).json().members as Array<{ userId: string; learned: number[] }>).find((x) => x.userId === userId)!.learned;

/** Вызов городу: ставка, отрывок выдан. Возвращает испытание и его отрывок. */
async function declare(cookie: string, nodeKey: string, bid: number) {
  const declared = await post(`/api/games/${gameId}/my-city/${nodeKey}/war`, cookie, { bid });
  expect(declared.statusCode).toBe(201);
  const id = declared.json().id as string;
  const war = await get(`/api/games/${gameId}/my-city/${nodeKey}/war`, cookie);
  const { start, end } = war.json().battles.find((x: { id: string }) => x.id === id).passage as { start: number; end: number };
  return { id, start, end };
}
/** Вызов городу Руфь до ответа хранителей: все стихи отрывка отмечает капитан, администратор принимает, «Испытать». */
async function challenge(cookie: string, bid: number): Promise<string> {
  const { id, start, end } = await declare(cookie, rutKey, bid);
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
  // Руфь — столица «Ковчега», Иона — столица «Странников»; до Руфи дошли все, до Ионы — ещё и «Пустыня».
  rutKey = (await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "rut" } })).key;
  jonKey = (await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "jon" } })).key;
  const rut = await tasksOf("rut"), jon = await tasksOf("jon");
  await prisma.teamNodeState.createMany({ data: [...[team1, team2, team3].map((teamId) => ({ teamId, nodeKey: rutKey })), { teamId: team2, nodeKey: jonKey }, { teamId: team3, nodeKey: jonKey }] });
  await prisma.teamCityState.createMany({ data: [
    { gameId, teamId: team1, nodeKey: rutKey, orderSolved: true, doneTasks: rut, capturedAt: new Date(), isCapital: true },
    { gameId, teamId: team2, nodeKey: rutKey, orderSolved: true, doneTasks: rut },
    { gameId, teamId: team3, nodeKey: rutKey, orderSolved: true, doneTasks: rut },
    { gameId, teamId: team2, nodeKey: jonKey, orderSolved: true, doneTasks: jon, capturedAt: new Date(), isCapital: true },
    { gameId, teamId: team3, nodeKey: jonKey, orderSolved: true, doneTasks: jon },
  ] });
}, 60_000);

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
    const lost = await prisma.battle.findUniqueOrThrow({ where: { id: lostBattle } });
    expect(lost.status).toBe("WON");
    expect((await prisma.team.findUniqueOrThrow({ where: { id: team1 } })).status).toBe("defeated");
    expect((await prisma.teamCityState.findUniqueOrThrow({ where: { teamId_nodeKey: { teamId: team3, nodeKey: rutKey } } })).capturedAt).toBeTruthy();
    expect((await prisma.battleEntry.findMany({ where: { battleId: lostBattle, userId: outId } })).map((e) => e.status)).toEqual(["SUBMITTED"]);
    // Остальное прошлое участника в прежней команде — записями прямо в базу (см. таблицу в начале файла).
    const hourAgo = new Date(Date.now() - 3_600_000), atEnd = new Date(lost.resolvedAt!.getTime() - 1000);
    const entry = { battleId: lostBattle, side: "DEFENSE" as const, teamId: team1, userId: outId, links: ["https://example.com/past"] };
    await prisma.battleEntry.createMany({ data: [
      { ...entry, startIdx: 27, endIdx: 28, status: "REJECTED", adminComment: "не то", decidedAt: hourAgo },
      { ...entry, startIdx: 29, endIdx: 29, status: "REJECTED", adminComment: "Время вышло", decidedAt: atEnd },
      { ...entry, startIdx: 30, endIdx: 31, status: "APPROVED", decidedAt: hourAgo },
    ] });
    const block = { gameId, teamId: team1, nodeKey: rutKey, bookCode: "rut", userId: outId, links: ["https://example.com/past"], decidedAt: hourAgo };
    await prisma.wallBlock.createMany({ data: [{ ...block, startIdx: 40, endIdx: 49, status: "APPROVED" }, { ...block, startIdx: 50, endIdx: 59, status: "REJECTED", adminComment: "не то" }] });
    // Вызов Ионе, который прежняя команда отменила: участник отметил в нём всю книгу, записи не проверены.
    const total = (await get(`/api/games/${gameId}/book-map?book=jon`, ck.cap3)).json().book.total as number;
    const cancelled = await prisma.battle.create({ data: { gameId, nodeKey: jonKey, bookCode: "jon", attackerId: team1, defenderId: team2, bid: 10, status: "CANCELLED", resolvedAt: hourAgo } });
    await prisma.battleEntry.create({ data: { battleId: cancelled.id, side: "ATTACK", teamId: team1, userId: outId, startIdx: 0, endIdx: total - 1, links: ["https://example.com/jon"] } });
  });

  it("участник выбывшей команды не может убрать свои непроверенные записи, чтобы сдать их заново", async () => {
    const own = await prisma.wallBlock.findFirstOrThrow({ where: { gameId, userId: outId, teamId: team1, status: "SUBMITTED" } });
    expect((await del(`${wallUrl()}/${own.id}`, ck.out)).statusCode).toBe(409);
    const marked = await prisma.battleEntry.findFirstOrThrow({ where: { battleId: lostBattle, userId: outId, status: "SUBMITTED" } });
    expect((await del(`/api/games/${gameId}/battles/${lostBattle}/entries/${marked.id}`, ck.out)).statusCode).toBe(409);
    // И капитан выбывшей команды за него их не уберёт.
    expect((await del(`/api/games/${gameId}/battles/${lostBattle}/entries/${marked.id}`, ck.cap1)).statusCode).toBe(409);
    expect(await prisma.wallBlock.count({ where: { id: own.id } })).toBe(1);
    expect(await prisma.battleEntry.count({ where: { id: marked.id } })).toBe(1);
  });

  it("в новой команде закрыты блоки стены со стихами из прежней: и построенные там, и отмеченные в её испытаниях", async () => {
    expect((await post(`/api/invites/${await invite(team3, ck.cap3)}/accept`, ck.out)).statusCode).toBe(201);
    expect((await get(`/api/games/${gameId}/my-map`, ck.out)).json().team.id).toBe(team3);
    const w = await get(wallUrl(), ck.out);
    expect(w.statusCode).toBe(200);
    const bricks = w.json().bricks as Brick[];
    // Блоки 0 и 4 построены в другой команде, блоки 2 и 3 закрыты стихами из её ответа; блоки 1 и 5 свободны
    // (блок 5 там вернул администратор).
    for (const k of [0, 2, 3, 4]) {
      expect(bricks[k], `блок ${k}`).toMatchObject({ state: "learned", elsewhere: true });
      expect(bricks[k]!.takers, `блок ${k}`).not.toContain(outId);
    }
    for (const k of [1, 5]) {
      expect(bricks[k]!.state, `блок ${k}`).toBe("free");
      expect(bricks[k]!.takers, `блок ${k}`).toContain(outId);
    }
    // Принятый блок прежней команды в стену новой не входит.
    expect(w.json()).toMatchObject({ verses: 0, blockCount: 0 });
    // У участника новой команды, который в прежней не был, эти блоки открыты.
    expect(((await get(wallUrl(), ck.cap3)).json().bricks as Brick[])[0]!.takers).toContain(m3Id);
    for (const k of [0, 4]) {
      const again = await post(wallUrl(), ck.out, { block: k, links: ["https://example.com/again"] });
      expect(again.statusCode, `блок ${k}`).toBe(409);
      expect(again.json().message).toContain("в другой команде");
    }
    // И за него такой блок не сдаст капитан.
    const forHim = await post(wallUrl(), ck.cap3, { block: 0, links: ["https://example.com/w0c"], forUserId: outId });
    expect(forHim.statusCode).toBe(409);
    expect(forHim.json().message).toContain("участник уже сдавал в другой команде");
    const byTrial = await post(wallUrl(), ck.cap3, { block: 2, links: ["https://example.com/w2"], forUserId: outId });
    expect(byTrial.statusCode).toBe(409);
    expect(byTrial.json().message).toContain("участник уже сдавал в испытании");
    expect((await post(wallUrl(), ck.out, { block: 2, links: ["https://example.com/w2"] })).statusCode).toBe(409);
    // Свободный и возвращённый там блоки он сдаёт как обычно; блок 0 сдаёт участник, который его не учил.
    expect((await post(wallUrl(), ck.out, { block: 1, links: ["https://example.com/w1"] })).statusCode).toBe(201);
    expect((await post(wallUrl(), ck.out, { block: 5, links: ["https://example.com/w5"] })).statusCode).toBe(201);
    expect((await post(wallUrl(), ck.m3, { block: 0, links: ["https://example.com/w0m"] })).statusCode).toBe(201);
    expect(await prisma.wallBlock.count({ where: { gameId, userId: outId, teamId: team3 } })).toBe(2);
    // Капитан не поручит ему стих, выученный в прежней команде.
    expect((await post(`/api/games/${gameId}/book-plan`, ck.cap3, { book: "rut", idx: 20, userId: outId, on: true })).statusCode).toBe(409);
    expect((await post(`/api/games/${gameId}/book-plan`, ck.cap3, { book: "rut", idx: 23, userId: outId, on: true })).statusCode).toBe(200);
  });

  it("в вызове новой команды стихи, отмеченные в вызове прежней, не отмечаются", async () => {
    // У хранителей Ионы никто из другой команды не приходил: предел ставки — участники × стихи книги, как раньше.
    const jon = (await get(`/api/games/${gameId}/my-city/${jonKey}/war`, ck.cap3)).json() as { maxBid: number; ownerMembers: number; bookVerses: number; maxBidClosed: number };
    expect(jon.maxBid).toBe(jon.bookVerses * jon.ownerMembers);
    expect(jon.maxBidClosed).toBe(0);
    const { id, start } = await declare(ck.cap3, jonKey, 10);
    const twice = await post(`/api/games/${gameId}/battles/${id}/entries`, ck.out, { verses: [start, start + 1], links: ["https://example.com/j1"] });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().message).toContain("уже сдавали раньше");
    expect((await post(`/api/games/${gameId}/battles/${id}/entries`, ck.m3, { verses: [start, start + 1], links: ["https://example.com/j2"] })).statusCode).toBe(201);
  });

  it("в ответе новой команды стихи из прежней не отмечаются и сами не засчитываются; своё правило команды прежнее", async () => {
    // Непроверенная запись своей команды в прошлом испытании стихи не закрывает (правило 03.10).
    await prisma.battleEntry.create({ data: { battleId: lostBattle, side: "ATTACK", teamId: team3, userId: m3Id, startIdx: 25, endIdx: 26, links: ["https://example.com/own"] } });
    // Предел ставки (решение владельца 17.11: «вычитать из предела закрытые для него стихи»): три участника × 85 стихов
    // без 26, которые перешедший выучил в прежней команде, — блоки 0–9 и 40–49, записи 20–22, 29 и 30–31. Возвращённое
    // как негодное (27–28, блок 50–59) не вычитается.
    expect(await answerCap(gameId, team3, "rut", 85)).toEqual({ cap: 3 * 85 - 26, members: 3, closed: 26 });
    const war = (await get(`/api/games/${gameId}/my-city/${rutKey}/war`, ck.cap2)).json() as { maxBid: number; ownerMembers: number; maxBidClosed: number };
    expect(war).toMatchObject({ maxBid: 229, ownerMembers: 3, maxBidClosed: 26 });
    const over = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, ck.cap2, { bid: 230 });
    expect(over.statusCode).toBe(400);
    expect(over.json().message).toContain("без 26 выученных в другой команде");
    answerBattle = await challenge(ck.cap2, 25);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: answerBattle } })).defenseCap).toBe(229);
    // В ответ сами легли только стихи своей команды (вызов капитана «Пустыни»): принятые в прежней команде стихи 30–31
    // и её принятый блок стены участнику в новой команде не засчитаны.
    expect(await prisma.battleEntry.count({ where: { battleId: answerBattle, side: "DEFENSE", userId: outId } })).toBe(0);
    expect((await prisma.battleEntry.findMany({ where: { battleId: answerBattle, side: "DEFENSE" } })).every((e) => e.carried && e.teamId === team3)).toBe(true);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: answerBattle } })).status).toBe("DEFENSE");
    expect((await post(`/api/games/${gameId}/battles/${answerBattle}/defense-passage`, ck.cap3, { from: "1:1", to: "2:10" })).statusCode).toBe(200);
    // Карточка испытания, карта книги и список «за участника» показывают эти стихи как сданные раньше.
    const closed = [0, 9, 10, 19, 20, 21, 22, 29, 30, 31, 40, 49], open = [23, 24, 27, 28];
    const view = (await get(`/api/games/${gameId}/my-battles`, ck.out)).json().battles.find((x: { id: string }) => x.id === answerBattle) as { learnedVerses: number[] };
    expect(view.learnedVerses).toEqual(expect.arrayContaining(closed));
    for (const v of open) expect(view.learnedVerses, `стих ${v}`).not.toContain(v);
    expect(await learnedOf(ck.cap3, outId, answerBattle)).toEqual(expect.arrayContaining(closed));
    expect(await learnedOf(ck.cap3, m3Id, answerBattle)).not.toContain(25);
    const forHim = (await get(`/api/games/${gameId}/battles/${answerBattle}/verses-of/${outId}`, ck.cap3)).json() as { learned: number[] };
    expect(forHim.learned).toEqual(expect.arrayContaining(closed));
    for (const v of [20, 21, 29, 30]) expect((await post(`/api/games/${gameId}/battles/${answerBattle}/entries`, ck.out, { verses: [v], links: ["https://example.com/d2"] })).statusCode, `стих ${v}`).toBe(409);
    // Вперемешку с новыми: засчитаны только новые.
    const mixed = await post(`/api/games/${gameId}/battles/${answerBattle}/entries`, ck.out, { verses: [22, 23, 24], links: ["https://example.com/d3"] });
    expect(mixed.statusCode).toBe(201);
    expect(mixed.json().added).toBe(2);
    // И за него капитан эти стихи не отметит.
    expect((await post(`/api/games/${gameId}/battles/${answerBattle}/entries`, ck.cap3, { verses: [20, 21], links: ["https://example.com/d4"], forUserId: outId })).statusCode).toBe(409);
    // Возвращённое в прежней команде как негодное — открыто; непроверенное в своей команде — открыто, как и раньше.
    expect((await post(`/api/games/${gameId}/battles/${answerBattle}/entries`, ck.out, { verses: [27, 28], links: ["https://example.com/d5"] })).statusCode).toBe(201);
    expect((await post(`/api/games/${gameId}/battles/${answerBattle}/entries`, ck.m3, { verses: [25, 26], links: ["https://example.com/d6"] })).statusCode).toBe(201);
    // Свою непроверенную запись в идущем ответе участник убирает, как и раньше.
    const mine = await prisma.battleEntry.findFirstOrThrow({ where: { battleId: answerBattle, userId: outId, startIdx: 27 } });
    expect((await del(`/api/games/${gameId}/battles/${answerBattle}/entries/${mine.id}`, ck.out)).statusCode).toBe(200);
  });

  it("закрепление города: максимум книги считается без стихов, выученных в другой команде", async () => {
    // Отдельное испытание записями в базу: «Пустыня» ответила всем, что может, — двое выучили книгу целиком (85 + 85),
    // перешедший — всё, кроме 26 стихов прежней команды (59). Это её максимум (229): город закрепляется. По прежнему
    // счёту «участники × стихи книги» (255) максимума не было бы.
    const before = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    const cap3Id = (await prisma.user.findUniqueOrThrow({ where: { nickname: nicks.cap3 } })).id;
    const now = new Date();
    const b = await prisma.battle.create({ data: { gameId, nodeKey: rutKey, bookCode: "rut", attackerId: team2, defenderId: team3, status: "DEFENSE", sumMode: true, bid: 229, defenseCap: 229, startedAt: now, attackDoneAt: now, attackApprovedAt: now, attackLaunchedAt: now, defenseDoneAt: now, defenseDeadline: new Date(now.getTime() + 3_600_000) } });
    const row = (userId: string, startIdx: number, endIdx: number) => ({ battleId: b.id, side: "DEFENSE" as const, teamId: team3, userId, startIdx, endIdx, links: ["https://example.com/max"], status: "APPROVED" as const, decidedAt: now });
    await prisma.battleEntry.createMany({ data: [row(cap3Id, 0, 84), row(m3Id, 0, 84), row(outId, 10, 19), row(outId, 23, 28), row(outId, 32, 39), row(outId, 50, 84)] });
    const done = await maybeRepel(await prisma.battle.findUniqueOrThrow({ where: { id: b.id }, include: { entries: true } }));
    expect(done.status).toBe("REPELLED");
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    expect(node.defenseLevel).toBe(229);
    expect(node.maxReachedAt).toBeTruthy();
    expect(node.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    // Убираем пробное испытание и закрепление: дальше — прежний ход сценария.
    await prisma.battle.delete({ where: { id: b.id } });
    await prisma.mapNode.update({ where: { gameId_key: { gameId, key: rutKey } }, data: { defenseLevel: before.defenseLevel, lockedUntil: null, maxReachedAt: null } });
  });

  it("«Время вышло» и перевод администратором: возвращённое концом хода закрыто и в следующей команде", async () => {
    // Администратор закрывает ответ «Пустыни» как просроченный: её непроверенные записи возвращаются разом, столица
    // потеряна, команда выбывает. Участника администратор переводит в «Странников».
    expect(await learnedOf(ck.cap3, m3Id)).not.toContain(25);
    expect((await post(`/api/games/${gameId}/battles/${answerBattle}/expire`, ck.admin, { comment: "Время вышло" })).statusCode).toBe(200);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: answerBattle } })).status).toBe("WON");
    expect((await prisma.team.findUniqueOrThrow({ where: { id: team3 } })).status).toBe("defeated");
    expect((await prisma.battleEntry.findFirstOrThrow({ where: { battleId: answerBattle, userId: m3Id, startIdx: 25 } })).status).toBe("REJECTED");
    expect((await post(`/api/games/${gameId}/teams/${team3}/members/${m3Id}/move`, ck.admin, { toTeamId: team2 })).statusCode).toBe(200);
    // В новой команде закрыты и стихи ответа (25–26), и блок стены, построенный в «Пустыне» (0–9).
    expect(await learnedOf(ck.cap2, m3Id)).toEqual(expect.arrayContaining([0, 9, 25, 26]));
  });
});
