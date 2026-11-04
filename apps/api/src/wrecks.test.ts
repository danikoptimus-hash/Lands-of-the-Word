import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hexDistance, seaField, fieldBoundsOf, hexToPixel } from "@lotw/domain";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";
import { pickDeed } from "./services/teamMap.js";
import { setWreckRandom } from "./routes/wrecks.js";
import { HEX_SIZE } from "./services/wrecks.js";

/**
 * Разбитые бурей корабли (решение владельца 04.11): срочное дело → корабль на карте у берега; сдача любой команды,
 * решение администратора с жребием груза (камни или блоки, 50/50); блок из груза ложится в стену; удаление дела или снятый
 * флажок — корабль тонет, открытые сдачи закрываются.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const adminNick = `wr_adm_${stamp}`, capNick = `wr_cap_${stamp}`, memNick = `wr_mem_${stamp}`, cap2Nick = `wr_cap2_${stamp}`;
let adminCookie = "", capCookie = "", memCookie = "", cap2Cookie = "", gameId = "", teamId = "", team2Id = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const put = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "PUT", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const del = (url: string, cookie: string) => app.inject({ method: "DELETE", url, headers: { cookie } });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const register = async (nickname: string) => (await registerVerified(app, { nickname, password: "secret123" })).headers["set-cookie"] as string;
const deedBody = (title: string, extra: Record<string, unknown> = {}) => ({ title, description: "Отвезти людям с корабля еду и одеяла", direction: "Посещение", proofType: "PHOTO_LINK", canRepeat: true, bookCodes: [], chance: 60, secret: false, remote: false, siegePoints: null, donationMin: null, quarry: false, stones: 1, quorumPct: null, ...extra });
interface WreckDto { id: string; deedId: string | null; title: string; q: number; r: number; model: number; cargo: { stones: number; blocks: number }; mine: null | { status: string; cargo: string | null; amount: number | null; adminComment: string; decidedAt: string | null }; doneTeams: number; sunkAt: string | null }
const myWrecks = async (cookie: string) => ((await get(`/api/games/${gameId}/my-map`, cookie)).json().wrecks ?? []) as WreckDto[];

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick); capCookie = await register(capNick); memCookie = await register(memNick); cap2Cookie = await register(cap2Nick);
  const g = await post("/api/games", adminCookie, { name: "Корабли", teamCount: 2 });
  gameId = g.json().game.id;
  await post(`/api/games/${gameId}/generate`, adminCookie);
  const t1 = await post(`/api/games/${gameId}/teams`, adminCookie, { name: "Спасатели" });
  teamId = t1.json().team.id;
  const inv = await post(`/api/games/${gameId}/teams/${teamId}/invites`, adminCookie, { role: "CAPTAIN" });
  await post(`/api/invites/${inv.json().invite.token}/accept`, capCookie);
  const inv2 = await post(`/api/games/${gameId}/teams/${teamId}/invites`, capCookie, { role: "MEMBER" });
  await post(`/api/invites/${inv2.json().invite.token}/accept`, memCookie);
  const t2 = await post(`/api/games/${gameId}/teams`, adminCookie, { name: "Вторая" });
  team2Id = t2.json().team.id;
  const inv3 = await post(`/api/games/${gameId}/teams/${team2Id}/invites`, adminCookie, { role: "CAPTAIN" });
  await post(`/api/invites/${inv3.json().invite.token}/accept`, cap2Cookie);
  await post(`/api/games/${gameId}/deeds/import-default`, adminCookie);
  await readyForStart(app, gameId, adminCookie);
  expect((await post(`/api/games/${gameId}/start`, adminCookie)).statusCode).toBe(200);
});
afterAll(async () => {
  setWreckRandom(null);
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, capNick, memNick, cap2Nick] } } });
  await cleanupFixtures(gameId);
  await app.close(); await prisma.$disconnect();
});

describe("Разбитые бурей корабли", () => {
  let deedId = "", wreckId = "";

  it("срочное дело → корабль на воде в 2–6 гексах от суши, в поясе моря; команды видят его с грузом", async () => {
    const r = await post(`/api/games/${gameId}/deeds`, adminCookie, deedBody("Помочь людям с разбитого корабля", { wreck: true }));
    expect(r.statusCode).toBe(201);
    deedId = r.json().deed.id;
    expect(r.json().deed.wreck).toBe(true);
    const wreck = await prisma.wreck.findFirstOrThrow({ where: { gameId, deedId, closedAt: null } });
    wreckId = wreck.id;
    const hexes = await prisma.mapHex.findMany({ where: { gameId }, select: { q: true, r: true } });
    expect(hexes.some((h) => h.q === wreck.q && h.r === wreck.r)).toBe(false);
    const d = Math.min(...hexes.map((h) => hexDistance(h, wreck)));
    expect(d).toBeGreaterThanOrEqual(2); expect(d).toBeLessThanOrEqual(6);
    const sea = seaField(fieldBoundsOf(hexes, HEX_SIZE)), c = hexToPixel(wreck, HEX_SIZE);
    expect(c.x).toBeGreaterThan(sea.minX); expect(c.x).toBeLessThan(sea.minX + sea.width);
    expect(c.y).toBeGreaterThan(sea.minY); expect(c.y).toBeLessThan(sea.minY + sea.height);
    expect(wreck.model).toBeGreaterThanOrEqual(0); expect(wreck.model).toBeLessThan(3);
    // Повторное сохранение с флажком второго корабля не создаёт.
    expect((await put(`/api/games/${gameId}/deeds/${deedId}`, adminCookie, { wreck: true })).statusCode).toBe(200);
    expect(await prisma.wreck.count({ where: { gameId, deedId, closedAt: null } })).toBe(1);
    // В списке дел администратора — открытый корабль у дела.
    const deeds = (await get(`/api/games/${gameId}/deeds`, adminCookie)).json().deeds as Array<{ id: string; wreck: boolean; wreckId: string | null }>;
    expect(deeds.find((x) => x.id === deedId)?.wreckId).toBe(wreckId);
    // Команды видят корабль: дело, возможный груз по правилам (3 камня или 2 блока), своей сдачи нет.
    const w = (await myWrecks(capCookie)).find((x) => x.id === wreckId)!;
    expect(w).toBeTruthy(); expect(w.title).toBe("Помочь людям с разбитого корабля"); expect(w.cargo).toEqual({ stones: 3, blocks: 2 }); expect(w.mine).toBeNull(); expect(w.q).toBe(wreck.q);
    expect((await myWrecks(cap2Cookie)).some((x) => x.id === wreckId)).toBe(true);
    // Новость всем командам.
    expect(await prisma.journal.count({ where: { gameId, kind: "wreck_appeared", everyone: true } })).toBe(1);
  });

  it("срочное дело не попадает на дороги и в Каменоломню", async () => {
    // Все остальные дела выключены: подбор дела на сторону не находит ничего, значит срочное дело исключено.
    await prisma.deed.updateMany({ where: { gameId, id: { not: deedId } }, data: { disabled: true } });
    expect(await pickDeed(gameId, teamId, null)).toBeNull();
    await prisma.deed.updateMany({ where: { gameId, id: { not: deedId } }, data: { disabled: false } });
    const q = (await get(`/api/games/${gameId}/quarry`, capCookie)).json().deeds as Array<{ id: string }>;
    expect(q.some((d) => d.id === deedId)).toBe(false);
  });

  it("сдача: права и ночь как у Каменоломни; одна незакрытая сдача на корабль", async () => {
    expect((await post(`/api/games/${gameId}/wrecks/${wreckId}/submit`, memCookie, { links: ["https://photos.example/1"] })).statusCode).toBe(403);
    await setGamePhase(app, gameId, adminCookie, "night");
    expect((await post(`/api/games/${gameId}/wrecks/${wreckId}/submit`, capCookie, { links: ["https://photos.example/1"] })).statusCode).toBe(409);
    await setGamePhase(app, gameId, adminCookie, "day");
    const sub = await post(`/api/games/${gameId}/wrecks/${wreckId}/submit`, capCookie, { links: ["https://photos.example/1"], note: "Привезли одеяла" });
    expect(sub.statusCode).toBe(201);
    expect((await post(`/api/games/${gameId}/wrecks/${wreckId}/submit`, capCookie, { links: ["https://photos.example/2"] })).statusCode).toBe(409);
    const w = (await myWrecks(capCookie)).find((x) => x.id === wreckId)!;
    expect(w.mine?.status).toBe("SUBMITTED");
    // Другая команда сдаёт тот же корабль одновременно.
    expect((await post(`/api/games/${gameId}/wrecks/${wreckId}/submit`, cap2Cookie, { links: ["https://photos.example/3"] })).statusCode).toBe(201);
    const queue = (await get(`/api/games/${gameId}/wrecks/submissions`, adminCookie)).json().works as Array<{ id: string; team: { id: string } }>;
    expect(queue.length).toBe(2);
    expect((await get(`/api/games/${gameId}/wrecks/submissions`, capCookie)).statusCode).toBe(403);
  });

  it("решение: 50/50 — камни одной команде, блоки другой; корабль у одобренной команды чинится, у остальных остаётся", async () => {
    const queue = (await get(`/api/games/${gameId}/wrecks/submissions`, adminCookie)).json().works as Array<{ id: string; team: { id: string } }>;
    const mine = queue.find((w) => w.team.id === teamId)!, other = queue.find((w) => w.team.id === team2Id)!;
    setWreckRandom(() => 0.1); // < 0.5 — камни
    const d1 = await post(`/api/games/${gameId}/wrecks/works/${mine.id}/decide`, adminCookie, { approve: true });
    expect(d1.statusCode).toBe(200); expect(d1.json()).toMatchObject({ cargo: "STONES", amount: 3 });
    expect((await prisma.team.findUniqueOrThrow({ where: { id: teamId } })).stones).toBe(3);
    expect((await post(`/api/games/${gameId}/wrecks/works/${mine.id}/decide`, adminCookie, { approve: true })).statusCode).toBe(409);
    setWreckRandom(() => 0.9); // ≥ 0.5 — блоки
    const d2 = await post(`/api/games/${gameId}/wrecks/works/${other.id}/decide`, adminCookie, { approve: true });
    expect(d2.json()).toMatchObject({ cargo: "BLOCKS", amount: 2 });
    const t2 = await prisma.team.findUniqueOrThrow({ where: { id: team2Id } });
    expect(t2.cargoBlocks).toBe(2); expect(t2.stones).toBe(0);
    // Команде отдаётся одобренный корабль (на анимацию ухода) с тем, что выпало.
    const w = (await myWrecks(capCookie)).find((x) => x.id === wreckId)!;
    expect(w.mine).toMatchObject({ status: "APPROVED", cargo: "STONES", amount: 3 }); expect(w.doneTeams).toBe(2); expect(w.sunkAt).toBeNull();
    expect((await get(`/api/games/${gameId}/my-map`, cap2Cookie)).json().team.cargoBlocks).toBe(2);
    expect(await prisma.journal.count({ where: { gameId, kind: "wreck_rewarded" } })).toBe(2);
    // Решённые сдачи — в истории администратора с грузом.
    const done = (await get(`/api/games/${gameId}/wrecks/submissions?status=DECIDED`, adminCookie)).json().works as Array<{ cargo: string }>;
    expect(done.map((x) => x.cargo).sort()).toEqual(["BLOCKS", "STONES"]);
  });

  it("возврат с комментарием: можно сдать снова", async () => {
    const r = await post(`/api/games/${gameId}/deeds`, adminCookie, deedBody("Вытащить ящики на берег", { wreck: true }));
    const deed2 = r.json().deed.id;
    const wreck2 = await prisma.wreck.findFirstOrThrow({ where: { gameId, deedId: deed2, closedAt: null } });
    const sub = await post(`/api/games/${gameId}/wrecks/${wreck2.id}/submit`, capCookie, { links: ["https://photos.example/4"] });
    expect(sub.statusCode).toBe(201);
    const rej = await post(`/api/games/${gameId}/wrecks/works/${sub.json().work.id}/decide`, adminCookie, { approve: false, comment: "Не видно ящиков" });
    expect(rej.statusCode).toBe(200);
    const w = (await myWrecks(capCookie)).find((x) => x.id === wreck2.id)!;
    expect(w.mine).toMatchObject({ status: "REJECTED", adminComment: "Не видно ящиков" });
    expect((await post(`/api/games/${gameId}/wrecks/${wreck2.id}/submit`, capCookie, { links: ["https://photos.example/5"] })).statusCode).toBe(201);
    // Удаление дела: корабль тонет, открытая сдача закрыта «Корабль затонул», команда без одобрения две минуты видит, как он тонет.
    expect((await del(`/api/games/${gameId}/deeds/${deed2}`, adminCookie)).statusCode).toBe(200);
    const sunk = await prisma.wreck.findUniqueOrThrow({ where: { id: wreck2.id } });
    expect(sunk.closedAt).not.toBeNull(); expect(sunk.sunk).toBe(true); expect(sunk.deedId).toBeNull(); expect(sunk.title).toBe("Вытащить ящики на берег");
    const work = await prisma.wreckWork.findFirstOrThrow({ where: { wreckId: wreck2.id, teamId }, orderBy: { submittedAt: "desc" } });
    expect(work.status).toBe("REJECTED"); expect(work.adminComment).toBe("Корабль затонул");
    const ws = (await myWrecks(capCookie)).find((x) => x.id === wreck2.id)!;
    expect(ws.sunkAt).not.toBeNull(); expect(ws.title).toBe("Вытащить ящики на берег");
    expect((await post(`/api/games/${gameId}/wrecks/${wreck2.id}/submit`, capCookie, { links: ["https://photos.example/6"] })).statusCode).toBe(404);
    expect(await prisma.journal.count({ where: { gameId, kind: "wreck_sunk" } })).toBe(1);
  });

  it("снятый флажок — корабль тонет; «Отпустить корабль» — то же; одобренной команде он уплывает, а не тонет", async () => {
    expect((await put(`/api/games/${gameId}/deeds/${deedId}`, adminCookie, { wreck: false })).statusCode).toBe(200);
    const w = await prisma.wreck.findUniqueOrThrow({ where: { id: wreckId } });
    expect(w.closedAt).not.toBeNull(); expect(w.sunk).toBe(true);
    // Обе команды спасли корабль: им он чинится и уходит (sunkAt нет).
    expect((await myWrecks(capCookie)).find((x) => x.id === wreckId)?.sunkAt).toBeNull();
    expect((await myWrecks(cap2Cookie)).find((x) => x.id === wreckId)?.sunkAt).toBeNull();
    // Флажок снова — новый корабль; «Отпустить корабль» закрывает его.
    expect((await put(`/api/games/${gameId}/deeds/${deedId}`, adminCookie, { wreck: true })).statusCode).toBe(200);
    const w2 = await prisma.wreck.findFirstOrThrow({ where: { gameId, deedId, closedAt: null } });
    expect(w2.id).not.toBe(wreckId);
    expect((await post(`/api/games/${gameId}/wrecks/${w2.id}/close`, capCookie)).statusCode).toBe(403);
    expect((await post(`/api/games/${gameId}/wrecks/${w2.id}/close`, adminCookie)).statusCode).toBe(200);
    expect((await post(`/api/games/${gameId}/wrecks/${w2.id}/close`, adminCookie)).statusCode).toBe(404);
    expect((await myWrecks(capCookie)).find((x) => x.id === w2.id)?.sunkAt).not.toBeNull();
    expect((await get(`/api/games/${gameId}/wrecks`, adminCookie)).json().wrecks.some((x: { id: string }) => x.id === w2.id)).toBe(true);
  });

  it("блок из груза ложится в стену своего города сразу принятым и считается в толщине", async () => {
    const city = await prisma.mapNode.findFirstOrThrow({ where: { gameId, kind: "CITY", bookCode: "rut" } });
    await prisma.teamNodeState.create({ data: { teamId: team2Id, nodeKey: city.key } });
    await prisma.teamCityState.create({ data: { gameId, teamId: team2Id, nodeKey: city.key, orderSolved: true, capturedAt: new Date() } });
    const url = `/api/games/${gameId}/my-city/${encodeURIComponent(city.key)}/wall`;
    const before = (await get(url, cap2Cookie)).json();
    expect(before.cargoBlocks).toBe(2); expect(before.canCargo).toBe(true); expect(before.blockCount).toBe(0);
    // Чужой город — нельзя; рядовому участнику — нельзя.
    expect((await post(`${url}/cargo`, capCookie)).statusCode).toBe(409);
    const lay = await post(`${url}/cargo`, cap2Cookie);
    expect(lay.statusCode).toBe(201); expect(lay.json().cargoBlocks).toBe(1);
    const after = (await get(url, cap2Cookie)).json();
    expect(after.cargoBlocks).toBe(1); expect(after.blockCount).toBe(1); expect(after.verses).toBe(after.blockVerses);
    expect(after.blocks[0]).toMatchObject({ cargo: true, status: "APPROVED" });
    // Карта книги не считает груз стихами: сетка книги свободна.
    expect(after.bricks.every((b: { state: string }) => b.state === "free")).toBe(true);
    expect((await post(`${url}/cargo`, cap2Cookie)).statusCode).toBe(201);
    expect((await post(`${url}/cargo`, cap2Cookie)).statusCode).toBe(409);
    expect((await get(url, cap2Cookie)).json().blockCount).toBe(2);
    // Стена видна на карте команды.
    const map = (await get(`/api/games/${gameId}/my-map`, cap2Cookie)).json();
    expect(map.team.cargoBlocks).toBe(0);
    expect((map.cities as Array<{ nodeKey: string; wall: boolean }>).find((c) => c.nodeKey === city.key)?.wall).toBe(true);
    expect(await prisma.journal.count({ where: { gameId, kind: "wall_cargo_laid" } })).toBe(2);
  });
});
