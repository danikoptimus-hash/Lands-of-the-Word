import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { sweep } from "./services/battles.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";

/**
 * Городская стена (решение владельца 01.11): хранители сдают блоки стихов своего города в мирное время, администратор
 * проверяет, при «Испытать» стена ложится в ответ сама.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `wadm_${stamp}`, keeperNick = `wk_${stamp}`, keeper2Nick = `wk2_${stamp}`, attackerNick = `wa_${stamp}`, attacker2Nick = `wa2_${stamp}`;
let adminCookie = "", keeperCookie = "", keeper2Cookie = "", attackerCookie = "", attacker2Cookie = "", gameId = "", rutKey = "", keepers = "", attackers = "";
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

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick);
  keeperCookie = await register(keeperNick);
  keeper2Cookie = await register(keeper2Nick);
  attackerCookie = await register(attackerNick);
  attacker2Cookie = await register(attacker2Nick);
  const g = await post("/api/games", adminCookie, { name: "Стена", teamCount: 2 });
  gameId = g.json().game.id;
  await post(`/api/games/${gameId}/generate`, adminCookie);
  keepers = await joinTeam("Стражи", keeperCookie);
  await joinTeam("Стражи", keeper2Cookie, "MEMBER", keepers);
  attackers = await joinTeam("Гости", attackerCookie);
  await joinTeam("Гости", attacker2Cookie, "MEMBER", attackers);
  await post(`/api/games/${gameId}/deeds/import-default`, adminCookie);
  await readyForStart(app, gameId, adminCookie);
  await setGamePhase(app, gameId, adminCookie, "morning");
  // Минимум на ответ — час: под нагрузкой полного прогона срок ответа в 60 с истекал между запросами, и город переходил.
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
  // Дела сторон ссылаются на дела игры (RESTRICT): удаляются первыми, иначе каскад от игры может упереться в них.
  await prisma.teamEdgeTask.deleteMany({ where: { gameId } });
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, keeperNick, keeper2Nick, attackerNick, attacker2Nick] } } });
  await cleanupFixtures(gameId);
  await app.close();
  await prisma.$disconnect();
});

const wallUrl = () => `/api/games/${gameId}/my-city/${rutKey}/wall`;
let blockId = "";

describe("городская стена", () => {
  it("стену строит только команда-хранитель; блок — выровненный отрезок книги", async () => {
    const foreign = await get(wallUrl(), attackerCookie);
    expect(foreign.statusCode).toBe(409);
    const w = await get(wallUrl(), keeperCookie);
    expect(w.statusCode).toBe(200);
    expect(w.json()).toMatchObject({ mine: true, blockVerses: 10, total: 85, verses: 0, blockCount: 0, canBuild: true });
    expect(w.json().bricks).toHaveLength(9);
    expect(w.json().bricks[0]).toMatchObject({ k: 0, start: 0, end: 9, state: "free" });
    expect(w.json().bricks[8]).toMatchObject({ k: 8, start: 80, end: 84 });
    const bad = await post(wallUrl(), keeperCookie, { block: 9, links: ["https://example.com/v"] });
    expect(bad.statusCode).toBe(400);
    const noLink = await post(wallUrl(), keeperCookie, { block: 0, links: [] });
    expect(noLink.statusCode).toBe(400);
    const notOwner = await post(wallUrl(), attackerCookie, { block: 0, links: ["https://example.com/v"] });
    expect(notOwner.statusCode).toBe(409);
  });

  it("участник сдаёт блок, второй раз тот же блок не сдаётся; администратор принимает — стена растёт", async () => {
    const res = await post(wallUrl(), keeper2Cookie, { block: 0, links: ["https://example.com/v1"] });
    expect(res.statusCode).toBe(201);
    blockId = res.json().id;
    expect(res.json().ref).toBe("1:1–10");
    const dup = await post(wallUrl(), keeper2Cookie, { block: 0, links: ["https://example.com/v1"] });
    expect(dup.statusCode).toBe(409);
    // Другой участник может сдать тот же блок: стихи считаются по участникам.
    const other = await post(wallUrl(), keeperCookie, { block: 0, links: ["https://example.com/v2"] });
    expect(other.statusCode).toBe(201);
    const pending = await get(wallUrl(), keeperCookie);
    expect(pending.json()).toMatchObject({ verses: 0, blockCount: 0, pending: 2 });
    expect(pending.json().bricks[0].state).toBe("submitted");
    const list = await get(`/api/games/${gameId}/walls`, adminCookie);
    expect(list.json().blocks.filter((b: { status: string }) => b.status === "SUBMITTED")).toHaveLength(2);
    const ok = await post(`/api/games/${gameId}/walls/${blockId}/decide`, adminCookie, { approve: true });
    expect(ok.statusCode).toBe(200);
    const again = await post(`/api/games/${gameId}/walls/${blockId}/decide`, adminCookie, { approve: true });
    expect(again.statusCode).toBe(409);
    const w = await get(wallUrl(), keeperCookie);
    expect(w.json()).toMatchObject({ verses: 10, blockCount: 1, pending: 1 });
    // Второй блок возвращён: участник может сдать его снова.
    const second = pending.json().blocks.find((b: { mine: boolean }) => b.mine) as { id: string };
    const back = await post(`/api/games/${gameId}/walls/${second.id}/decide`, adminCookie, { approve: false, comment: "не слышно" });
    expect(back.statusCode).toBe(200);
    const w2 = await get(wallUrl(), keeperCookie);
    expect(w2.json().bricks[0].state).toBe("free");
    expect(w2.json().returned[0]).toMatchObject({ ref: "1:1–10", adminComment: "не слышно" });
    // Блок воина — два блока и вдвое стихов (решение владельца 02.11).
    await prisma.membership.update({ where: { teamId_userId: { teamId: keepers, userId: (await prisma.user.findUniqueOrThrow({ where: { nickname: keeperNick } })).id } }, data: { gameRole: "WARRIOR" } });
    const warrior = await post(wallUrl(), keeperCookie, { block: 2, links: ["https://example.com/v-w"] });
    expect(warrior.statusCode).toBe(201);
    await post(`/api/games/${gameId}/walls/${warrior.json().id}/decide`, adminCookie, { approve: true });
    const own = await get(`/api/games/${gameId}/my-city/${rutKey}`, keeperCookie);
    expect(own.json().wall).toMatchObject({ exists: true, verses: 30, blocks: 3 });
    // Чужим стена не видна, пока её не разведал разведчик (решение владельца 02.11): ни на карте, ни в окне города.
    const map0 = await get(`/api/games/${gameId}/my-map`, attackerCookie);
    expect(map0.json().cities.find((c: { nodeKey: string }) => c.nodeKey === rutKey).wall).toBe(false);
    const city0 = await get(`/api/games/${gameId}/my-city/${rutKey}`, attackerCookie);
    expect(city0.json().wall).toMatchObject({ scouted: false, canScout: false });
    expect(city0.json().wall.exists).toBeUndefined();
    const notScout = await post(`/api/games/${gameId}/my-city/${rutKey}/scout-wall`, attackerCookie);
    expect(notScout.statusCode).toBe(403);
    await prisma.membership.update({ where: { teamId_userId: { teamId: attackers, userId: (await prisma.user.findUniqueOrThrow({ where: { nickname: attackerNick } })).id } }, data: { gameRole: "SCOUT" } });
    const scouted = await post(`/api/games/${gameId}/my-city/${rutKey}/scout-wall`, attackerCookie);
    expect(scouted.statusCode).toBe(200);
    expect(scouted.json().hasWall).toBe(true);
    const again2 = await post(`/api/games/${gameId}/my-city/${rutKey}/scout-wall`, attackerCookie);
    expect(again2.statusCode).toBe(429);
    const map1 = await get(`/api/games/${gameId}/my-map`, attackerCookie);
    expect(map1.json().cities.find((c: { nodeKey: string }) => c.nodeKey === rutKey).wall).toBe(true);
    const city1 = await get(`/api/games/${gameId}/my-city/${rutKey}`, attackerCookie);
    expect(city1.json().wall).toMatchObject({ scouted: true, exists: true, canScout: true });
    expect(city1.json().wall.nextScoutAt).toBeTruthy();
    expect(city1.json().wall.verses).toBeUndefined();
  });

  it("за хранителя блок сдаёт капитан, заместитель или летописец (решение владельца 05.11): блок засчитан хранителю; рядовой — нет; чужой — нет", async () => {
    const keeper2Id = (await prisma.user.findUniqueOrThrow({ where: { nickname: keeper2Nick }, select: { id: true } })).id;
    const keeperId = (await prisma.user.findUniqueOrThrow({ where: { nickname: keeperNick }, select: { id: true } })).id;
    const attackerId = (await prisma.user.findUniqueOrThrow({ where: { nickname: attackerNick }, select: { id: true } })).id;
    // Рядовой участник за капитана сдать не может; капитан за чужого — нет.
    expect((await post(wallUrl(), keeper2Cookie, { block: 5, links: ["https://example.com/for1"], forUserId: keeperId })).statusCode).toBe(403);
    expect((await post(wallUrl(), keeperCookie, { block: 5, links: ["https://example.com/for1"], forUserId: attackerId })).statusCode).toBe(404);
    const w0 = await get(wallUrl(), keeperCookie);
    expect(w0.json()).toMatchObject({ me: keeperId, canSubmitFor: true });
    expect((await get(wallUrl(), keeper2Cookie)).json().canSubmitFor).toBe(false);
    // Капитан сдаёт блок за хранителя: строка на хранителе, пометка, кто сдал; второй раз за него тот же блок — 409.
    const t0 = new Date();
    const res = await post(wallUrl(), keeperCookie, { block: 5, links: ["https://example.com/for1"], forUserId: keeper2Id, note: "выучил вчера" });
    expect(res.statusCode).toBe(201);
    const row = await prisma.wallBlock.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(row.userId).toBe(keeper2Id); expect(row.note.startsWith("Сдал(а) за хранителя: ")).toBe(true); expect(row.note.endsWith("выучил вчера")).toBe(true);
    expect((await post(wallUrl(), keeperCookie, { block: 5, links: ["https://example.com/for2"], forUserId: keeper2Id })).statusCode).toBe(409);
    // У хранителя блок «на проверке», у капитана этот же блок по-прежнему свободен; в списке блок записан на хранителя.
    expect((await get(wallUrl(), keeper2Cookie)).json().bricks[5].state).toBe("submitted");
    const w1 = await get(wallUrl(), keeperCookie);
    expect(w1.json().bricks[5].state).toBe("free");
    expect(w1.json().bricks[5].takers).not.toContain(keeper2Id);
    expect(w1.json().blocks.find((b: { id: string }) => b.id === row.id)).toMatchObject({ userId: keeper2Id, status: "SUBMITTED" });
    // Не трогаем стену и летопись для следующих проверок: убираем строку и запись о сдаче.
    await prisma.wallBlock.delete({ where: { id: row.id } });
    await prisma.journal.deleteMany({ where: { gameId, kind: "wall_block_submitted", createdAt: { gte: t0 } } });
  });

  it("стена ложится в ответ за минуту до конца времени ответа, а не при «Испытать»: ставка покрыта — город устоял без единого нового стиха", async () => {
    const declared = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, attackerCookie, { bid: 10 });
    expect(declared.statusCode).toBe(201);
    const battleId = declared.json().id as string;
    const war = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, attackerCookie);
    const b = war.json().battles[0];
    const verses = Array.from({ length: 10 }, (_, i) => b.passage.start + i);
    const marked = await post(`/api/games/${gameId}/battles/${battleId}/entries`, attackerCookie, { verses, links: ["https://example.com/a"] });
    expect(marked.statusCode).toBe(201);
    // Пока вызов не начат, хранители строят стену дальше (о вызове они не знают).
    const more = await post(wallUrl(), keeper2Cookie, { block: 1, links: ["https://example.com/v3"] });
    expect(more.statusCode).toBe(201);
    const submitted = await post(`/api/games/${gameId}/battles/${battleId}/submit`, attackerCookie);
    expect(submitted.statusCode).toBe(200);
    const entries = await prisma.battleEntry.findMany({ where: { battleId, side: "ATTACK" } });
    for (const e of entries) await post(`/api/games/${gameId}/battles/${battleId}/entries/${e.id}/decide`, adminCookie, { approve: true });
    const launched = await post(`/api/games/${gameId}/battles/${battleId}/attack`, attackerCookie);
    expect(launched.statusCode).toBe(200);
    // При «Испытать» стена ещё не ложится (решение владельца 02.11): хранители отвечают сами, блоки целы.
    expect(launched.json().status).toBe("DEFENSE");
    expect(await prisma.battleEntry.count({ where: { battleId, side: "DEFENSE" } })).toBe(0);
    // Стена в расчёте ответа (решение владельца 06.11): хранителям карточка испытания отдаёт толщину стены, претендентам — нет.
    const wallNow = (await get(wallUrl(), keeperCookie)).json() as { verses: number; blockCount: number };
    type View = { id: string; wall: { verses: number; blocks: number } | null };
    const keepersView = ((await get(`/api/games/${gameId}/my-battles`, keeperCookie)).json().battles as View[]).find((x) => x.id === battleId);
    expect(keepersView?.wall).toEqual({ verses: wallNow.verses, blocks: wallNow.blockCount });
    expect(wallNow.verses).toBeGreaterThanOrEqual(10);
    const attackersView = ((await get(`/api/games/${gameId}/my-battles`, attackerCookie)).json().battles as View[]).find((x) => x.id === battleId);
    expect(attackersView?.wall ?? null).toBeNull();
    await sweep(gameId);
    expect(await prisma.battleEntry.count({ where: { battleId, side: "DEFENSE" } })).toBe(0);
    // За минуту до конца времени ответа обход кладёт стену: в ответ лёг только нужный блок — самый старый (10 стихов)
    // перекрыл ставку 10; он сгорел, блок воина остался в стене.
    await prisma.battle.update({ where: { id: battleId }, data: { defenseDeadline: new Date(Date.now() + 45_000) } });
    await sweep(gameId);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: battleId } })).status).toBe("REPELLED");
    const laid = await prisma.battleEntry.findMany({ where: { battleId, side: "DEFENSE" }, orderBy: { startIdx: "asc" } });
    expect(laid).toHaveLength(1);
    expect(laid[0]).toMatchObject({ carried: true, status: "APPROVED", startIdx: 0, endIdx: 9, weight: 1, note: "Блок городской стены" });
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    expect(node.defenseLevel).toBe(10);
    expect((await prisma.wallBlock.findUniqueOrThrow({ where: { id: blockId } })).usedBattleId).toBe(battleId);
    const after = await get(wallUrl(), keeperCookie);
    expect(after.json()).toMatchObject({ verses: 20, blockCount: 2 });
    expect(after.json().blocks.find((x: { id: string }) => x.id === blockId)).toMatchObject({ used: true });
    expect(after.json().bricks[0].state).toBe("free"); // у капитана блок 1–10 был возвращён — свободен; у сдавшего он сгорел
    await new Promise((r) => setTimeout(r, 300)); // записи летописи пишутся в фоне
    const rows = await prisma.journal.findMany({ where: { gameId, kind: { in: ["wall_applied", "trial_repelled", "wall_block_approved", "wall_block_submitted", "trial_submitted", "trial_approved"] } } });
    expect(rows.map((r) => r.kind).sort()).toEqual(["trial_approved", "trial_submitted", "wall_applied", "wall_block_approved", "wall_block_approved", "wall_block_submitted", "wall_block_submitted", "wall_block_submitted", "wall_block_submitted", "trial_repelled"].sort());
  });

  it("стихи блока стены в испытании второй раз не засчитываются; во время ответа стену не строят", async () => {
    // Стражи вызывают Гостей? Город у Стражей — проверим правило «сдано раньше» через их же ответ: сделаем новый вызов.
    // Сгоревший блок закрывает свои стихи сдавшему: в сетке — «сгорел».
    expect((await get(wallUrl(), keeper2Cookie)).json().bricks[0].state).toBe("used");
    const declared = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, attackerCookie, { bid: 50 });
    expect(declared.statusCode).toBe(201);
    const battleId = declared.json().id as string;
    const war = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, attackerCookie);
    const b = war.json().battles.find((x: { id: string }) => x.id === battleId);
    const verses = Array.from({ length: 50 }, (_, i) => b.passage.start + i);
    // Стихи отмечает второй участник претендентов: у первого часть стихов книги уже сдана в прошлом вызове и второй раз не считается.
    const marked = await post(`/api/games/${gameId}/battles/${battleId}/entries`, attacker2Cookie, { verses, links: ["https://example.com/b"] });
    expect(marked.statusCode).toBe(201);
    await post(`/api/games/${gameId}/battles/${battleId}/submit`, attackerCookie);
    const entries = await prisma.battleEntry.findMany({ where: { battleId, side: "ATTACK" } });
    for (const e of entries) await post(`/api/games/${gameId}/battles/${battleId}/entries/${e.id}/decide`, adminCookie, { approve: true });
    const launched = await post(`/api/games/${gameId}/battles/${battleId}/attack`, attackerCookie);
    expect(launched.json().status).toBe("DEFENSE");
    // Ответ идёт: стену не строят.
    const build = await post(wallUrl(), keeperCookie, { block: 2, links: ["https://example.com/v4"] });
    expect(build.statusCode).toBe(409);
    // Блок 1 (стихи 11–20) ждал проверки: принятый во время ответа, он ждёт минуты стены вместе с блоком воина (решение владельца 02.11).
    const pendingBlock = await prisma.wallBlock.findFirstOrThrow({ where: { gameId, status: "SUBMITTED" } });
    await post(`/api/games/${gameId}/walls/${pendingBlock.id}/decide`, adminCookie, { approve: true });
    expect(await prisma.battleEntry.count({ where: { battleId, side: "DEFENSE", note: "Блок городской стены" } })).toBe(0);
    expect((await get(wallUrl(), keeperCookie)).json()).toMatchObject({ verses: 30, blockCount: 3 });
    // За минуту до конца в ответ легли блок воина и блок 11–20: 20 + 10 < 50, ответ идёт; оба сгорели.
    await prisma.battle.update({ where: { id: battleId }, data: { defenseDeadline: new Date(Date.now() + 50_000) } });
    await sweep(gameId);
    const laid = await prisma.battleEntry.findMany({ where: { battleId, side: "DEFENSE", note: "Блок городской стены" } });
    expect(laid.map((e) => e.startIdx).sort((x, y) => x - y)).toEqual([10, 20]);
    expect((await get(wallUrl(), keeperCookie)).json()).toMatchObject({ verses: 0, blockCount: 0 });
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: battleId } })).status).toBe("DEFENSE");
    // Хранитель, сдавший блок 1–10 стеной, не может отметить те же стихи в ответе.
    await post(`/api/games/${gameId}/battles/${battleId}/defense-passage`, keeperCookie, { from: "1:1", to: "2:10" });
    const dto = await get(`/api/games/${gameId}/my-city/${rutKey}/war`, keeper2Cookie);
    const mine = dto.json().battles.find((x: { id: string }) => x.id === battleId);
    expect(mine.learnedVerses).toEqual(expect.arrayContaining([0, 9, 10, 19]));
    const twice = await post(`/api/games/${gameId}/battles/${battleId}/entries`, keeper2Cookie, { verses: [0, 1, 2], links: ["https://example.com/c"] });
    expect(twice.statusCode).toBe(409);
  });
});
