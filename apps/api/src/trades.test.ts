import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";
import { bookWords } from "./services/bookWords.js";
import { wallOf } from "./services/wall.js";

/**
 * Обмен городами между послами (решение владельца 04.10): посол выставляет город, посол другой команды предлагает
 * взамен свой, первый меняется или отклоняет; любая сторона может отменить. Только посол; столицу не обменять.
 * Стена при обмене (решение владельца 09.11): с галкой переходит новой команде и видна второй стороне, без галки сгорает.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `tr_adm_${stamp}`, cap1: `tr_c1_${stamp}`, amb1: `tr_a1_${stamp}`, cap2: `tr_c2_${stamp}`, amb2: `tr_a2_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap1: "", amb1: "", cap2: "", amb2: "" };
let gameId = "", team1 = "", team2 = "", cap1Key = "", cap2Key = "", x = "", y = "", z = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const register = async (nickname: string) => (await registerVerified(app, { nickname, password: "secret123" })).headers["set-cookie"] as string;
async function join(teamId: string, role: "CAPTAIN" | "MEMBER", cookie: string, by: string) {
  const inv = await post(`/api/games/${gameId}/teams/${teamId}/invites`, by, { role });
  await post(`/api/invites/${inv.json().invite.token}/accept`, cookie);
}
beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) ck[k] = await register(nicks[k]);
  const g = await post("/api/games", ck.admin, { name: "Обмен городами", teamCount: 2 });
  gameId = g.json().game.id;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  team1 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Купцы" })).json().team.id;
  team2 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Горцы" })).json().team.id;
  await join(team1, "CAPTAIN", ck.cap1, ck.admin); await join(team1, "MEMBER", ck.amb1, ck.cap1);
  await join(team2, "CAPTAIN", ck.cap2, ck.admin); await join(team2, "MEMBER", ck.amb2, ck.cap2);
  for (const n of [nicks.amb1, nicks.amb2]) await prisma.membership.updateMany({ where: { user: { nickname: n } }, data: { gameRole: "AMBASSADOR" } });
  await post(`/api/games/${gameId}/deeds/import-default`, ck.admin);
  await readyForStart(app, gameId, ck.admin);
  await setGamePhase(app, gameId, ck.admin, "day");
  expect((await post(`/api/games/${gameId}/start`, ck.admin)).statusCode).toBe(200);
  // Пять городов с книгами: по столице и по городу на обмен у каждой команды, у «Горцев» ещё один про запас.
  const cities = await prisma.mapNode.findMany({ where: { gameId, kind: "CITY", bookCode: { not: null } }, select: { key: true }, orderBy: { key: "asc" }, take: 5 });
  [cap1Key, x, cap2Key, y, z] = cities.map((c) => c.key) as [string, string, string, string, string];
  await prisma.teamCityState.createMany({ data: [
    { gameId, teamId: team1, nodeKey: cap1Key, orderSolved: true, capturedAt: new Date(), isCapital: true },
    { gameId, teamId: team1, nodeKey: x, orderSolved: true, capturedAt: new Date() },
    { gameId, teamId: team2, nodeKey: cap2Key, orderSolved: true, capturedAt: new Date(), isCapital: true },
    { gameId, teamId: team2, nodeKey: y, orderSolved: true, capturedAt: new Date() },
    { gameId, teamId: team2, nodeKey: z, orderSolved: true, capturedAt: new Date() },
  ] });
});
afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } });
  await cleanupFixtures(gameId);
  await app.close(); await prisma.$disconnect();
});

const owner = async (teamId: string, key: string) => (await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId, nodeKey: key } } }))?.capturedAt != null;

describe("обмен городами", () => {
  it("список: посол видит свои города со словами книги, столица помечена; число слов считается по тексту", async () => {
    const d = (await get(`/api/games/${gameId}/my-trades`, ck.amb1)).json();
    expect(d.canTrade).toBe(true);
    expect(d.teams.map((t: { id: string }) => t.id)).toEqual([team2]);
    const mine = d.myCities as Array<{ nodeKey: string; bookCode: string; words: number; capital: boolean; reason: string | null }>;
    const cx = mine.find((c) => c.nodeKey === x)!, cc = mine.find((c) => c.nodeKey === cap1Key)!;
    expect(cx.reason).toBeNull(); expect(cx.words).toBeGreaterThan(100); expect(cx.words).toBe(await bookWords(cx.bookCode));
    expect(cc.capital).toBe(true); expect(cc.reason).toMatch(/Столицу/);
    expect((await get(`/api/games/${gameId}/my-trades`, ck.cap1)).json().canTrade).toBe(false);
    expect(await bookWords("oba")).toBeLessThan(await bookWords("gen"));
  });

  it("предложение → встречный город → отклонение → другой город → обмен: города меняют владельцев", async () => {
    expect((await post(`/api/games/${gameId}/trades`, ck.cap1, { toTeamId: team2, offerKey: x })).statusCode).toBe(403);
    expect((await post(`/api/games/${gameId}/trades`, ck.amb1, { toTeamId: team2, offerKey: cap1Key })).statusCode).toBe(409);
    const created = await post(`/api/games/${gameId}/trades`, ck.amb1, { toTeamId: team2, offerKey: x, message: "Меняю на что-нибудь поближе" });
    expect(created.statusCode).toBe(201);
    const tradeId = created.json().trade.id as string;
    expect((await post(`/api/games/${gameId}/trades`, ck.amb1, { toTeamId: team2, offerKey: x })).statusCode).toBe(409);
    const seen = (await get(`/api/games/${gameId}/my-trades`, ck.amb2)).json();
    const incoming = seen.trades.find((t: { id: string }) => t.id === tradeId);
    expect(incoming.mine).toBe(false); expect(incoming.status).toBe("OPEN"); expect(incoming.offer.nodeKey).toBe(x); expect(incoming.offer.words).toBeGreaterThan(0);
    // Меняться подтверждает только первая сторона, и только когда есть встречный город.
    expect((await post(`/api/games/${gameId}/trades/${tradeId}/accept`, ck.amb1)).statusCode).toBe(409);
    expect((await post(`/api/games/${gameId}/trades/${tradeId}/counter`, ck.amb2, { nodeKey: cap2Key })).statusCode).toBe(409);
    expect((await post(`/api/games/${gameId}/trades/${tradeId}/counter`, ck.amb1, { nodeKey: x })).statusCode).toBe(403);
    expect((await post(`/api/games/${gameId}/trades/${tradeId}/counter`, ck.amb2, { nodeKey: y })).statusCode).toBe(200);
    expect((await post(`/api/games/${gameId}/trades/${tradeId}/accept`, ck.amb2)).statusCode).toBe(403);
    expect((await post(`/api/games/${gameId}/trades/${tradeId}/decline`, ck.amb1)).statusCode).toBe(200);
    const again = (await get(`/api/games/${gameId}/my-trades`, ck.amb1)).json().trades.find((t: { id: string }) => t.id === tradeId);
    expect(again.status).toBe("OPEN"); expect(again.counter).toBeNull(); expect(again.declined.map((c: { nodeKey: string }) => c.nodeKey)).toEqual([y]);
    expect((await post(`/api/games/${gameId}/trades/${tradeId}/counter`, ck.amb2, { nodeKey: y })).statusCode).toBe(409);
    expect((await post(`/api/games/${gameId}/trades/${tradeId}/counter`, ck.amb2, { nodeKey: z })).statusCode).toBe(200);
    expect((await post(`/api/games/${gameId}/trades/${tradeId}/accept`, ck.amb1)).statusCode).toBe(200);
    expect(await owner(team2, x)).toBe(true); expect(await owner(team1, x)).toBe(false);
    expect(await owner(team1, z)).toBe(true); expect(await owner(team2, z)).toBe(false);
    expect(await owner(team1, cap1Key)).toBe(true); expect(await owner(team2, cap2Key)).toBe(true);
    const done = (await get(`/api/games/${gameId}/my-trades`, ck.amb2)).json().trades.find((t: { id: string }) => t.id === tradeId);
    expect(done.status).toBe("DONE");
    // Запись в журнал пишется без ожидания (journal — fire-and-forget), поэтому ждём её до 3 с, а не читаем сразу (13.10: тест мигал на стенде).
    let news = null;
    for (let i = 0; i < 30 && !news; i++) { news = await prisma.journal.findFirst({ where: { gameId, kind: "trade_done" } }); if (!news) await new Promise((r) => setTimeout(r, 100)); }
    expect(news?.everyone).toBe(true);
  });

  it("стена: с галкой переходит с городом и видна второй стороне, без галки сгорает навсегда; стихи остаются за построившими", async () => {
    // После первого обмена: у «Горцев» x и y, у «Купцов» z. Стены: у «Горцев» в x — два блока (посол и капитан), у «Купцов» в z — один.
    const uid = async (n: string) => (await prisma.user.findUniqueOrThrow({ where: { nickname: n } })).id;
    const book = async (key: string) => (await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key } } })).bookCode!;
    const now = new Date();
    const mk = (teamId: string, nodeKey: string, bookCode: string, userId: string, k: number) => ({ gameId, teamId, nodeKey, bookCode, userId, startIdx: k * 10, endIdx: k * 10 + 9, status: "APPROVED" as const, decidedAt: now, note: "Блок городской стены" });
    await prisma.wallBlock.createMany({ data: [
      mk(team2, x, await book(x), await uid(nicks.amb2), 0), mk(team2, x, await book(x), await uid(nicks.cap2), 1),
      mk(team1, z, await book(z), await uid(nicks.amb1), 0),
    ] });
    expect(await wallOf(team2, x)).toMatchObject({ blocks: 2, verses: 20 });
    expect(await wallOf(team1, z)).toMatchObject({ blocks: 1, verses: 10 });
    // Посол видит стену своего города и решает, переходит ли она.
    const mine = (await get(`/api/games/${gameId}/my-trades`, ck.amb2)).json().myCities.find((c: { nodeKey: string }) => c.nodeKey === x);
    expect(mine.wall).toMatchObject({ blocks: 2, verses: 20 });
    const created = await post(`/api/games/${gameId}/trades`, ck.amb2, { toTeamId: team1, offerKey: x, withWall: true });
    expect(created.statusCode).toBe(201);
    const id = created.json().trade.id as string;
    // Переходящую стену видит вторая сторона.
    const seen = (await get(`/api/games/${gameId}/my-trades`, ck.amb1)).json().trades.find((t: { id: string }) => t.id === id);
    expect(seen.offerWall).toEqual({ pass: true, blocks: 2, verses: 20 });
    // Встречный город без галки: его стену второй стороне не показываем, хозяину — «сгорит».
    expect((await post(`/api/games/${gameId}/trades/${id}/counter`, ck.amb1, { nodeKey: z, withWall: false })).statusCode).toBe(200);
    const forOwner = (await get(`/api/games/${gameId}/my-trades`, ck.amb2)).json().trades.find((t: { id: string }) => t.id === id);
    expect(forOwner.counterWall).toBeNull();
    const forMe = (await get(`/api/games/${gameId}/my-trades`, ck.amb1)).json().trades.find((t: { id: string }) => t.id === id);
    expect(forMe.counterWall).toEqual({ pass: false, blocks: 1, verses: 10 });
    expect((await post(`/api/games/${gameId}/trades/${id}/accept`, ck.amb2)).statusCode).toBe(200);
    expect(await owner(team1, x)).toBe(true); expect(await owner(team2, z)).toBe(true);
    // Стена x перешла «Купцам» и считается у них; у «Горцев» её больше нет.
    expect(await wallOf(team1, x)).toMatchObject({ blocks: 2, verses: 20 });
    expect(await wallOf(team2, x)).toMatchObject({ blocks: 0 });
    const moved = await prisma.wallBlock.findMany({ where: { nodeKey: x, gameId } });
    expect(moved.every((b) => b.holderId === team1 && b.teamId === team2 && b.usedAt === null)).toBe(true);
    // Стена z сгорела: не считается ни у новых хранителей, ни у прежних; блок принят (стихи в статистике), но сгорел.
    expect(await wallOf(team2, z)).toMatchObject({ blocks: 0 });
    expect(await wallOf(team1, z)).toMatchObject({ blocks: 0 });
    const burnt = await prisma.wallBlock.findFirstOrThrow({ where: { nodeKey: z, gameId } });
    expect(burnt.status).toBe("APPROVED"); expect(burnt.usedAt).not.toBeNull(); expect(burnt.missing).toBe(10); expect(burnt.teamId).toBe(team1); expect(burnt.holderId).toBeNull();
    // В списке стены новых хранителей перешедшие блоки без имён.
    const wall = await get(`/api/games/${gameId}/my-city/${x}/wall`, ck.cap1);
    if (wall.statusCode === 200) {
      const blocks = wall.json().blocks as Array<{ gifted: boolean; nickname: string }>;
      expect(blocks).toHaveLength(2); expect(blocks.every((b) => b.gifted && b.nickname === "")).toBe(true);
    }
    // Город z вернулся бы «Купцам» — стена не вернётся: меняем обратно без галок.
    const back = await post(`/api/games/${gameId}/trades`, ck.amb1, { toTeamId: team2, offerKey: x });
    expect(back.statusCode).toBe(201);
    expect((await post(`/api/games/${gameId}/trades/${back.json().trade.id}/counter`, ck.amb2, { nodeKey: z })).statusCode).toBe(200);
    expect((await post(`/api/games/${gameId}/trades/${back.json().trade.id}/accept`, ck.amb1)).statusCode).toBe(200);
    expect(await owner(team1, z)).toBe(true); expect(await owner(team2, x)).toBe(true);
    expect(await wallOf(team1, z)).toMatchObject({ blocks: 0 });
    expect(await wallOf(team2, x)).toMatchObject({ blocks: 0 }); // стена x без галки сгорела у «Купцов»
    expect(await wallOf(team1, x)).toMatchObject({ blocks: 0 });
  });

  it("тупик: любая сторона отменяет сделку", async () => {
    const created = await post(`/api/games/${gameId}/trades`, ck.amb2, { toTeamId: team1, offerKey: x });
    expect(created.statusCode).toBe(201);
    const id = created.json().trade.id as string;
    expect((await post(`/api/games/${gameId}/trades/${id}/cancel`, ck.cap1)).statusCode).toBe(403);
    expect((await post(`/api/games/${gameId}/trades/${id}/cancel`, ck.amb1)).statusCode).toBe(200);
    expect((await post(`/api/games/${gameId}/trades/${id}/counter`, ck.amb1, { nodeKey: z })).statusCode).toBe(409);
    expect((await get(`/api/games/${gameId}/my-trades`, ck.amb2)).json().trades.find((t: { id: string }) => t.id === id).status).toBe("CANCELLED");
  });
});
