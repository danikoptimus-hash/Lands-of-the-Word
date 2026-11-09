import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hexDistance, seaField, fieldBoundsOf, hexToPixel } from "@lotw/domain";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";
import { pickDeed } from "./services/teamMap.js";
import { setWreckRandom } from "./routes/wrecks.js";
import { HEX_SIZE } from "./services/wrecks.js";
import { sweep } from "./services/battles.js";

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
interface WreckDto { id: string; deedId: string | null; title: string; q: number; r: number; model: number; sinkAt?: string | null; appearedAt?: string; cargo: { stones: number; blocks: number }; mine: null | { status: string; cargo: string | null; amount: number | null; adminComment: string; decidedAt: string | null }; doneTeams: number; sunkAt: string | null }
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
  await prisma.teamEdgeTask.deleteMany({ where: { gameId } });
  setWreckRandom(null);
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, capNick, memNick, cap2Nick] } } });
  await cleanupFixtures(gameId);
  await app.close(); await prisma.$disconnect();
});


/** Записи летописи пишутся в фоне (journal() не ждёт create): ждём нужное число до секунды, иначе на медленной машине CI тест сбоит гонкой. */
async function journalCount(where: Record<string, unknown>, want: number): Promise<number> {
  let n = 0;
  for (let i = 0; i < 20; i++) { n = await prisma.journal.count({ where }); if (n >= want) break; await new Promise((r) => setTimeout(r, 50)); }
  return n;
}

describe("Разбитые бурей корабли", () => {
  let deedId = "", wreckId = "";

  it("срочное дело → корабль на воде в 2–6 гексах от суши, в поясе моря; команды видят его с грузом", async () => {
    const r = await post(`/api/games/${gameId}/deeds`, adminCookie, deedBody("Помочь людям с разбитого корабля", { wreck: true, wreckStones: 4, wreckBlocks: 1 }));
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
    expect(w).toBeTruthy(); expect(w.title).toBe("Помочь людям с разбитого корабля"); expect(w.cargo).toEqual({ stones: 4, blocks: 1 }); expect(w.mine).toBeNull(); expect(w.q).toBe(wreck.q);
    expect((await myWrecks(cap2Cookie)).some((x) => x.id === wreckId)).toBe(true);
    // Новость всем командам.
    expect(await journalCount({ gameId, kind: "wreck_appeared", everyone: true }, 1)).toBe(1);
    // Груз правится в деле (решение владельца 05.11): открытый корабль подхватывает новые числа, команды видят свежие.
    expect((await put(`/api/games/${gameId}/deeds/${deedId}`, adminCookie, { wreckStones: 3, wreckBlocks: 2 })).statusCode).toBe(200);
    expect((await prisma.wreck.findUniqueOrThrow({ where: { id: wreckId } })).stones).toBe(3);
    expect((await myWrecks(capCookie)).find((x) => x.id === wreckId)?.cargo).toEqual({ stones: 3, blocks: 2 });
    expect((await get(`/api/games/${gameId}/wrecks`, adminCookie)).json().wrecks.find((x: { id: string }) => x.id === wreckId).cargo).toEqual({ stones: 3, blocks: 2 });
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
    // Числа груза — из дела, не из правил игры (05.11): у дела 3 камня и 2 блока.
    expect(await prisma.deed.findUniqueOrThrow({ where: { id: deedId } })).toMatchObject({ wreckStones: 3, wreckBlocks: 2 });
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
    expect(await journalCount({ gameId, kind: "wreck_rewarded" }, 2)).toBe(2);
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
    expect(await journalCount({ gameId, kind: "wreck_sunk" }, 1)).toBe(1);
  });

  it("снятый флажок — корабль тонет; одобренной команде он уплывает, а не тонет; маршрута «Отпустить корабль» нет (06.11)", async () => {
    expect((await put(`/api/games/${gameId}/deeds/${deedId}`, adminCookie, { wreck: false })).statusCode).toBe(200);
    const w = await prisma.wreck.findUniqueOrThrow({ where: { id: wreckId } });
    expect(w.closedAt).not.toBeNull(); expect(w.sunk).toBe(true);
    // Обе команды спасли корабль: им он чинится и уходит (sunkAt нет).
    expect((await myWrecks(capCookie)).find((x) => x.id === wreckId)?.sunkAt).toBeNull();
    expect((await myWrecks(cap2Cookie)).find((x) => x.id === wreckId)?.sunkAt).toBeNull();
    // Флажок снова — новый корабль; «Отпустить корабль» убран: маршрута нет, корабль закрывает только удаление дела или срок.
    expect((await put(`/api/games/${gameId}/deeds/${deedId}`, adminCookie, { wreck: true })).statusCode).toBe(200);
    const w2 = await prisma.wreck.findFirstOrThrow({ where: { gameId, deedId, closedAt: null } });
    expect(w2.id).not.toBe(wreckId);
    expect((await post(`/api/games/${gameId}/wrecks/${w2.id}/close`, adminCookie)).statusCode).toBe(404);
    expect(await prisma.wreck.count({ where: { gameId, deedId, closedAt: null } })).toBe(1);
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
    expect(await journalCount({ gameId, kind: "wall_cargo_laid" }, 2)).toBe(2);
  });
});

/** Срок затопления (решение владельца 05.11): задаётся в деле, команды видят таймер, по сроку корабль тонет сам. */
describe("Срок затопления разбитого корабля", () => {
  it("срок в деле → таймер у команд; прошлое не принимается; по сроку корабль тонет сам, а дело удаляется (06.11)", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect((await post(`/api/games/${gameId}/deeds`, adminCookie, deedBody("Снять людей с тонущего корабля", { wreck: true, wreckSinkAt: past }))).statusCode).toBe(400);
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const r = await post(`/api/games/${gameId}/deeds`, adminCookie, deedBody("Снять людей с тонущего корабля", { wreck: true, wreckSinkAt: soon }));
    expect(r.statusCode).toBe(201);
    const deedId2 = r.json().deed.id as string;
    const w = await prisma.wreck.findFirstOrThrow({ where: { gameId, deedId: deedId2, closedAt: null } });
    expect(w.sinkAt?.toISOString()).toBe(soon);
    const mine = (await myWrecks(capCookie)).find((x) => x.id === w.id);
    expect(mine?.sinkAt).toBe(soon);
    expect(mine?.appearedAt).toBeTruthy();
    // Правка: срок в прошлое — отказ; новый срок подхватывает открытый корабль.
    expect((await put(`/api/games/${gameId}/deeds/${deedId2}`, adminCookie, { wreckSinkAt: past })).statusCode).toBe(400);
    const later = new Date(Date.now() + 7_200_000).toISOString();
    expect((await put(`/api/games/${gameId}/deeds/${deedId2}`, adminCookie, { wreckSinkAt: later })).statusCode).toBe(200);
    expect((await prisma.wreck.findUniqueOrThrow({ where: { id: w.id } })).sinkAt?.toISOString()).toBe(later);
    // Срок вышел (ставим в прошлое мимо проверки маршрута): общий обход топит корабль.
    await prisma.wreck.update({ where: { id: w.id }, data: { sinkAt: new Date(Date.now() - 1000) } });
    await prisma.deed.update({ where: { id: deedId2 }, data: { wreckSinkAt: new Date(Date.now() - 1000) } });
    await sweep(gameId);
    const sunk = await prisma.wreck.findUniqueOrThrow({ where: { id: w.id } });
    expect(sunk.sunk).toBe(true);
    expect(sunk.closedAt).not.toBeNull();
    expect((await myWrecks(capCookie)).find((x) => x.id === w.id)?.sunkAt).not.toBeNull();
    // Дело удалилось само (решение владельца 06.11); корабль в истории остаётся с названием.
    expect(await prisma.deed.findUnique({ where: { id: deedId2 } })).toBeNull();
    expect((await get(`/api/games/${gameId}/deeds`, adminCookie)).json().deeds.some((d: { id: string }) => d.id === deedId2)).toBe(false);
    expect((await prisma.wreck.findUniqueOrThrow({ where: { id: w.id } })).title).toBe("Снять людей с тонущего корабля");
    expect((await put(`/api/games/${gameId}/deeds/${deedId2}`, adminCookie, { wreckStones: 5 })).statusCode).toBe(404);
  });
});

describe("Взять срочное задание (решения владельца 05.11: как обычное дело, но берёт и сдаёт только капитан, заместитель или летописец; одно на команду)", () => {
  it("рядовой участник не берёт и не сдаёт; капитан берёт — команда и администратор «глазами команды» видят «взял»; отказ; одна работа и один приз на команду; затопление закрывает взятое", async () => {
    const r = await post(`/api/games/${gameId}/deeds`, adminCookie, deedBody("Снять людей с разбитого корабля", { wreck: true, wreckStones: 2, wreckBlocks: 2 }));
    expect(r.statusCode).toBe(201);
    const wreck = await prisma.wreck.findFirstOrThrow({ where: { gameId, deedId: r.json().deed.id, closedAt: null } });
    await setGamePhase(app, gameId, adminCookie, "day");
    // Рядовой участник: ни взять, ни сдать (откат владельца 05.11: только капитан, заместитель или летописец).
    expect((await post(`/api/games/${gameId}/wrecks/${wreck.id}/take`, memCookie)).statusCode).toBe(403);
    expect((await post(`/api/games/${gameId}/wrecks/${wreck.id}/submit`, memCookie, { links: ["https://photos.example/t1"] })).statusCode).toBe(403);
    const take = await post(`/api/games/${gameId}/wrecks/${wreck.id}/take`, capCookie);
    expect(take.statusCode).toBe(200); expect(take.json().work.status).toBe("TAKEN");
    const capId = (await prisma.wreckWork.findUniqueOrThrow({ where: { id: take.json().work.id }, select: { userId: true } })).userId;
    // Второе взятие в той же команде — 409: работа одна на команду.
    expect((await post(`/api/games/${gameId}/wrecks/${wreck.id}/take`, capCookie)).statusCode).toBe(409);
    const w = (await myWrecks(capCookie)).find((x) => x.id === wreck.id)!;
    expect(w.mine).toMatchObject({ status: "TAKEN", userId: capId });
    // Администратор «глазами команды» видит то же; другой команде взятие не видно.
    const tv = (await get(`/api/games/${gameId}/teams/${teamId}/map`, adminCookie)).json();
    expect((tv.wrecks as WreckDto[]).find((x) => x.id === wreck.id)?.mine).toMatchObject({ status: "TAKEN", userId: capId });
    expect((await myWrecks(cap2Cookie)).find((x) => x.id === wreck.id)?.mine).toBeNull();
    // Отказаться: у второй команды не взято — 409; рядовой участник — 403; капитан — можно; потом берёт снова.
    expect((await post(`/api/games/${gameId}/wrecks/${wreck.id}/release`, cap2Cookie)).statusCode).toBe(409);
    expect((await post(`/api/games/${gameId}/wrecks/${wreck.id}/release`, memCookie)).statusCode).toBe(403);
    expect((await post(`/api/games/${gameId}/wrecks/${wreck.id}/release`, capCookie)).statusCode).toBe(200);
    expect((await myWrecks(capCookie)).find((x) => x.id === wreck.id)?.mine).toBeNull();
    expect((await post(`/api/games/${gameId}/wrecks/${wreck.id}/take`, capCookie)).statusCode).toBe(200);
    // Рядовой участник не сдаёт и взятое капитаном; капитан сдаёт — та же запись становится сдачей, «взял» остаётся.
    expect((await post(`/api/games/${gameId}/wrecks/${wreck.id}/submit`, memCookie, { links: ["https://photos.example/t2"] })).statusCode).toBe(403);
    const sub = await post(`/api/games/${gameId}/wrecks/${wreck.id}/submit`, capCookie, { links: ["https://photos.example/t2"], note: "Сняли людей" });
    expect(sub.statusCode).toBe(201);
    const rows = await prisma.wreckWork.findMany({ where: { wreckId: wreck.id, teamId } });
    expect(rows.length).toBe(1); expect(rows[0]!.status).toBe("SUBMITTED"); expect(rows[0]!.userId).toBe(capId); expect(rows[0]!.takenAt).not.toBeNull();
    expect((await myWrecks(capCookie)).find((x) => x.id === wreck.id)?.mine?.status).toBe("SUBMITTED");
    expect((await post(`/api/games/${gameId}/wrecks/${wreck.id}/release`, capCookie)).statusCode).toBe(409);
    // Второй приз той же команде не получить: пока сдача не рассмотрена, ни взять, ни сдать снова.
    expect((await post(`/api/games/${gameId}/wrecks/${wreck.id}/take`, capCookie)).statusCode).toBe(409);
    expect((await post(`/api/games/${gameId}/wrecks/${wreck.id}/submit`, capCookie, { links: ["https://photos.example/t3"] })).statusCode).toBe(409);
    // Вторая команда взяла, но не сдала; дело удалено — корабль тонет, взятое закрывается «Корабль затонул» (06.11: кнопки «Отпустить» нет).
    expect((await post(`/api/games/${gameId}/wrecks/${wreck.id}/take`, cap2Cookie)).statusCode).toBe(200);
    expect((await del(`/api/games/${gameId}/deeds/${r.json().deed.id}`, adminCookie)).statusCode).toBe(200);
    const closed = await prisma.wreckWork.findMany({ where: { wreckId: wreck.id }, select: { status: true, adminComment: true } });
    expect(closed.length).toBe(2);
    expect(closed.every((x) => x.status === "REJECTED" && x.adminComment === "Корабль затонул")).toBe(true);
  });
});
