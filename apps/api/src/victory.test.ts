import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { sweep } from "./services/battles.js";
import { checkLastTeam, leader, startVictory, VICTORY_MS } from "./services/game.js";
import { onPublish } from "./services/events.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";
import { setSettings } from "./services/gameSettings.js";

/** Ярлыки конвертов: между чтением настроек и их записью маршрут рисует PDF — сюда тест ставит победу (гонка из разбора). */
const duringPdf = vi.hoisted(() => ({ hook: null as null | (() => Promise<unknown>) }));
vi.mock("./services/labelsPdf.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./services/labelsPdf.js")>();
  return { ...orig, renderLabelsPdf: async (...a: Parameters<typeof orig.renderLabelsPdf>) => { if (duringPdf.hook) await duringPdf.hook(); return orig.renderLabelsPdf(...a); } };
});

/**
 * Празднование победы (решение владельца 26.11): «если команда захватывает последнюю оставшуюся команду, то им даётся
 * трое суток на празднование победы… срок окончания автоматически сдвигается на трое суток»; «Участники в эти трое суток
 * занимают руины городов». Партия остаётся идущей, срок — момент победы + 72 ч (был раньше, позже или не был вовсе),
 * по сроку обход завершает её с победителем и причиной last_team.
 *
 * Три партии по две команды: «Ковчег» (столица — Иона) и «Странники» (столица — Руфь, ещё у них Есфирь).
 *   A — последняя столица взята вызовом; срок партии был раньше (через час);
 *   B — взята осадой делами; срок был позже (через десять дней);
 *   C — взята осадой; срока не было.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `vi_adm_${stamp}`, cap1: `vi_c1_${stamp}`, cap2: `vi_c2_${stamp}`, m2: `vi_m2_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap1: "", cap2: "", m2: "" };
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers: { cookie, ...headers } });
const patch = (url: string, cookie: string, payload: unknown) => app.inject({ method: "PATCH", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const register = async (nickname: string) => (await registerVerified(app, { nickname, password: "secret123" })).headers["set-cookie"] as string;
const tasksOf = async (code: string) => (JSON.parse(await readFile(new URL(`../../../content/cities/${code}.json`, import.meta.url), "utf8")) as { tasks: unknown[] }).tasks.map((_, i) => i);
const HOUR = 3_600_000;

interface Setup { gameId: string; team1: string; team2: string; rutKey: string; jonKey: string; estKey: string }
const games: Setup[] = [];
const events: Array<{ gameId: string; type: string; teamId?: string }> = [];
onPublish((gameId, ev) => events.push({ gameId, type: ev.type, teamId: ev.teamId }));

async function setupGame(name: string, endsAt: string | null): Promise<Setup> {
  const invite = async (gameId: string, teamId: string, by: string, role: "CAPTAIN" | "MEMBER" = "MEMBER") => (await post(`/api/games/${gameId}/teams/${teamId}/invites`, by, { role })).json().invite.token as string;
  const gameId = (await post("/api/games", ck.admin, { name, teamCount: 2 })).json().game.id as string;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  const team1 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Ковчег" })).json().team.id as string;
  const team2 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Странники" })).json().team.id as string;
  await post(`/api/invites/${await invite(gameId, team1, ck.admin, "CAPTAIN")}/accept`, ck.cap1);
  await post(`/api/invites/${await invite(gameId, team2, ck.admin, "CAPTAIN")}/accept`, ck.cap2);
  await post(`/api/invites/${await invite(gameId, team2, ck.cap2)}/accept`, ck.m2);
  await post(`/api/games/${gameId}/deeds/import-default`, ck.admin);
  await readyForStart(app, gameId, ck.admin);
  await setGamePhase(app, gameId, ck.admin, "morning");
  const rules = await patch(`/api/games/${gameId}`, ck.admin, { settings: { endsAt, rules: { minAnswerSeconds: 3600 } } });
  if (rules.statusCode !== 200) throw new Error(`settings not set: ${rules.body}`);
  expect((await post(`/api/games/${gameId}/start`, ck.admin)).statusCode).toBe(200);
  const keyOf = async (bookCode: string) => (await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode } })).key;
  const [rutKey, jonKey, estKey] = await Promise.all([keyOf("rut"), keyOf("jon"), keyOf("est")]);
  const [rut, jon, est] = await Promise.all([tasksOf("rut"), tasksOf("jon"), tasksOf("est")]);
  // «Ковчег» дошёл до Руфи и Есфири и решил их задания; Есфирь — второй город «Странников».
  await prisma.teamNodeState.createMany({ data: [{ teamId: team1, nodeKey: rutKey }, { teamId: team1, nodeKey: estKey }, { teamId: team2, nodeKey: rutKey }, { teamId: team2, nodeKey: estKey }], skipDuplicates: true });
  await prisma.teamCityState.createMany({ data: [
    { gameId, teamId: team1, nodeKey: jonKey, orderSolved: true, doneTasks: jon, capturedAt: new Date(), firstCapturedAt: new Date(), isCapital: true },
    { gameId, teamId: team1, nodeKey: rutKey, orderSolved: true, doneTasks: rut },
    { gameId, teamId: team1, nodeKey: estKey, orderSolved: true, doneTasks: est },
    { gameId, teamId: team2, nodeKey: rutKey, orderSolved: true, doneTasks: rut, capturedAt: new Date(), firstCapturedAt: new Date(), isCapital: true },
    { gameId, teamId: team2, nodeKey: estKey, orderSolved: true, doneTasks: est, capturedAt: new Date(), firstCapturedAt: new Date() },
  ] });
  const s = { gameId, team1, team2, rutKey, jonKey, estKey };
  games.push(s);
  return s;
}

/** Последняя столица «Странников» берётся осадой делами: у «Ковчега» за время осады два принятых дела, у них — ни одного. */
async function siegeWin(g: Setup): Promise<void> {
  const deed = await prisma.deed.findFirstOrThrow({ where: { gameId: g.gameId } });
  await prisma.siege.create({ data: { gameId: g.gameId, nodeKey: g.rutKey, attackerId: g.team1, defenderId: g.team2, startedAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() - 1000) } });
  const fake = await Promise.all([0, 1].map((i) => prisma.teamEdgeTask.create({ data: { gameId: g.gameId, teamId: g.team1, fromKey: `siege-${i}`, toKey: `siege-to-${i}`, deedId: deed.id, status: "APPROVED", decidedAt: new Date(Date.now() - 5000) } })));
  await sweep(g.gameId);
  await prisma.teamEdgeTask.deleteMany({ where: { id: { in: fake.map((t) => t.id) } } });
  expect((await prisma.siege.findFirstOrThrow({ where: { gameId: g.gameId, nodeKey: g.rutKey } })).status).toBe("WON");
}

const gameRow = (gameId: string) => prisma.game.findUniqueOrThrow({ where: { id: gameId } });
const endsAtOf = async (gameId: string) => ((await gameRow(gameId)).settings as { endsAt?: string | null }).endsAt ?? null;

beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) ck[k] = await register(nicks[k]);
}, 60_000);

afterAll(async () => {
  for (const g of games) {
    await prisma.teamEdgeTask.deleteMany({ where: { gameId: g.gameId } });
    await prisma.siege.deleteMany({ where: { gameId: g.gameId } });
    await prisma.game.deleteMany({ where: { id: g.gameId } });
    await cleanupFixtures(g.gameId);
  }
  await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } });
  await app.close();
  await prisma.$disconnect();
});

describe("празднование победы", () => {
  let A: Setup;
  it("A: последняя столица взята вызовом — партия идёт, срок сдвинут на трое суток от победы (прежний был раньше)", async () => {
    A = await setupGame("Победа A", new Date(Date.now() + HOUR).toISOString());
    // Вызов Руфи: все стихи отрывка сданы и приняты, «Испытать»; хранители не ответили в срок.
    const declared = await post(`/api/games/${A.gameId}/my-city/${A.rutKey}/war`, ck.cap1, { bid: 10 });
    expect(declared.statusCode, declared.body).toBe(201);
    const id = declared.json().id as string;
    const war = await get(`/api/games/${A.gameId}/my-city/${A.rutKey}/war`, ck.cap1);
    const { start, end } = war.json().battles.find((x: { id: string }) => x.id === id).passage as { start: number; end: number };
    expect((await post(`/api/games/${A.gameId}/battles/${id}/entries`, ck.cap1, { verses: Array.from({ length: end - start + 1 }, (_, i) => start + i), links: ["https://example.com/call"] })).statusCode).toBe(201);
    expect((await post(`/api/games/${A.gameId}/battles/${id}/submit`, ck.cap1)).statusCode).toBe(200);
    for (const e of await prisma.battleEntry.findMany({ where: { battleId: id, side: "ATTACK" } })) await post(`/api/games/${A.gameId}/battles/${id}/entries/${e.id}/decide`, ck.admin, { approve: true });
    expect((await post(`/api/games/${A.gameId}/battles/${id}/attack`, ck.cap1)).json().status).toBe("DEFENSE");
    await prisma.battle.update({ where: { id }, data: { defenseDeadline: new Date(Date.now() - 1000) } });
    events.length = 0;
    const before = Date.now();
    await sweep(A.gameId);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id } })).status).toBe("WON");
    expect((await prisma.team.findUniqueOrThrow({ where: { id: A.team2 } })).status).toBe("defeated");
    const g = await gameRow(A.gameId);
    expect(g).toMatchObject({ status: "ACTIVE", victoryTeamId: A.team1, winnerTeamId: null, finishReason: null });
    expect(g.victoryAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await endsAtOf(A.gameId)).toBe(new Date(g.victoryAt!.getTime() + VICTORY_MS).toISOString());
    // Открытые карты всех команд и администраторов перечитываются: событие общее, без команды.
    expect(events.some((e) => e.gameId === A.gameId && e.type === "game" && !e.teamId)).toBe(true);
  });

  it("A: празднование видят победители, выбывшие и администратор — в карте, положении и карте администратора", async () => {
    const g = await gameRow(A.gameId);
    const victory = { teamId: A.team1, at: g.victoryAt!.toISOString(), until: new Date(g.victoryAt!.getTime() + VICTORY_MS).toISOString() };
    const mine = await get(`/api/games/${A.gameId}/my-map`, ck.cap1);
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({ status: "ACTIVE", victory });
    // Прежняя форма ответа на месте (и в новом формате карты), «та же версия» тоже несёт празднование.
    expect(mine.json()).toHaveProperty("tasks");
    expect((await get(`/api/games/${A.gameId}/my-map`, ck.cap1, { "x-lotw-wire": "2" })).json().victory).toEqual(victory);
    expect((await get(`/api/games/${A.gameId}/my-map?have=${mine.json().rev}`, ck.cap1)).json()).toMatchObject({ same: true, victory });
    expect((await get(`/api/games/${A.gameId}/my-map`, ck.cap2)).json().victory).toEqual(victory);
    const st = await get(`/api/games/${A.gameId}/standings`, ck.m2);
    expect(st.json()).toMatchObject({ status: "ACTIVE", winnerTeamId: null, victory });
    expect((await get(`/api/games/${A.gameId}/progress`, ck.admin)).json().victory).toEqual(victory);
    expect((await get(`/api/games/${A.gameId}/teams/${A.team2}/map`, ck.admin)).json().victory).toEqual(victory);
    expect((await get(`/api/games/${A.gameId}`, ck.admin)).json().victory).toEqual(victory);
  });

  it("A: повторный вход в празднование не сдвигает срок", async () => {
    const endsAt = await endsAtOf(A.gameId);
    await checkLastTeam(A.gameId);
    expect(await startVictory(A.gameId, A.team1, new Date(Date.now() + 5 * HOUR))).toBe(false);
    expect(await endsAtOf(A.gameId)).toBe(endsAt);
  });

  it("A: в празднование вызов и осаду объявить нельзя — отказ с кодом victory", async () => {
    const war = await post(`/api/games/${A.gameId}/my-city/${A.rutKey}/war`, ck.cap1, { bid: 10 });
    expect(war.statusCode).toBe(409);
    expect(war.json()).toMatchObject({ error: "victory", message: "Празднование победы: вызовов и осад больше нет" });
    const siege = await post(`/api/games/${A.gameId}/my-city/${A.rutKey}/siege`, ck.cap1);
    expect(siege.statusCode).toBe(409);
    expect(siege.json().error).toBe("victory");
    // И в листе испытаний города кнопка закрыта с той же причиной.
    expect((await get(`/api/games/${A.gameId}/my-city/${A.rutKey}/war`, ck.cap1)).json()).toMatchObject({ canDeclare: false, reason: "Празднование победы: вызовов и осад больше нет" });
  });

  it("A: в празднование победители занимают опустевший город, выбывших переводят в команду-победителя", async () => {
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId: A.gameId, key: A.estKey } } });
    expect(node.ruined).toBe(true);
    const taken = await post(`/api/games/${A.gameId}/my-city/${A.estKey}/capture`, ck.cap1);
    expect(taken.statusCode, taken.body).toBe(200);
    expect((await prisma.teamCityState.findUniqueOrThrow({ where: { teamId_nodeKey: { teamId: A.team1, nodeKey: A.estKey } } })).capturedAt).toBeTruthy();
    const m2 = await prisma.user.findUniqueOrThrow({ where: { nickname: nicks.m2 } });
    expect((await post(`/api/games/${A.gameId}/teams/${A.team2}/members/${m2.id}/move`, ck.admin, { toTeamId: A.team1 })).statusCode).toBe(200);
    expect((await get(`/api/games/${A.gameId}/my-map`, ck.m2)).json().team.id).toBe(A.team1);
    // Обход сроков до конца празднования игру не завершает.
    await sweep(A.gameId);
    expect((await gameRow(A.gameId)).status).toBe("ACTIVE");
  });

  it("A: через трое суток обход завершает игру: победитель — команда-победитель, причина last_team", async () => {
    // Трое суток прошли: момент победы и срок — на 72 ч и секунду назад.
    const g = await gameRow(A.gameId);
    const at = new Date(Date.now() - VICTORY_MS - 1000);
    await prisma.game.update({ where: { id: A.gameId }, data: { victoryAt: at, settings: { ...(g.settings as object), endsAt: new Date(at.getTime() + VICTORY_MS).toISOString() } } });
    await sweep(A.gameId);
    expect(await gameRow(A.gameId)).toMatchObject({ status: "FINISHED", winnerTeamId: A.team1, finishReason: "last_team" });
    expect((await get(`/api/games/${A.gameId}/standings`, ck.cap1)).json()).toMatchObject({ status: "FINISHED", winnerTeamId: A.team1, finishReason: "last_team", victory: null });
  });

  it("B: осада делами даёт то же; срок был позже — тоже становится победа + 72 ч; ручной финиш — с победителем", async () => {
    const B = await setupGame("Победа B", new Date(Date.now() + 10 * 24 * HOUR).toISOString());
    await siegeWin(B);
    const g = await gameRow(B.gameId);
    expect(g).toMatchObject({ status: "ACTIVE", victoryTeamId: B.team1, winnerTeamId: null });
    expect(await endsAtOf(B.gameId)).toBe(new Date(g.victoryAt!.getTime() + VICTORY_MS).toISOString());
    expect((await get(`/api/games/${B.gameId}/my-map`, ck.cap2)).json().victory).toMatchObject({ teamId: B.team1 });
    // В празднование в строю одна команда, и «лидер по городам» — она же: по-честному их не различить. Чтобы проверка
    // отличала одно от другого, состояние искусственное: «Странники» снова в строю, и городов у них больше (3 против 2).
    await prisma.team.update({ where: { id: B.team2 }, data: { status: "active" } });
    await prisma.teamCityState.updateMany({ where: { teamId: B.team2, nodeKey: B.estKey }, data: { capturedAt: new Date() } });
    for (const book of ["gen", "exo"]) await prisma.teamCityState.create({ data: { gameId: B.gameId, teamId: B.team2, nodeKey: (await prisma.mapNode.findFirstOrThrow({ where: { gameId: B.gameId, bookCode: book } })).key, orderSolved: true, capturedAt: new Date(), firstCapturedAt: new Date() } });
    expect((await leader(B.gameId))?.teamId).toBe(B.team2);
    const done = await post(`/api/games/${B.gameId}/finish`, ck.admin);
    expect(done.json()).toMatchObject({ ok: true, winnerTeamId: B.team1 });
    expect(await gameRow(B.gameId)).toMatchObject({ status: "FINISHED", winnerTeamId: B.team1, finishReason: "manual" });
  });

  it("C: срока не было — ставится победа + 72 ч; администратор меняет срок, по нему игра и завершается", async () => {
    const C = await setupGame("Победа C", null);
    expect(await endsAtOf(C.gameId)).toBeNull();
    await siegeWin(C);
    const g = await gameRow(C.gameId);
    expect(g.status).toBe("ACTIVE");
    expect(await endsAtOf(C.gameId)).toBe(new Date(g.victoryAt!.getTime() + VICTORY_MS).toISOString());
    // Срок — право администратора: ставит его на секунду назад, празднование кончается по нему.
    const until = new Date(Date.now() - 1000).toISOString();
    expect((await patch(`/api/games/${C.gameId}`, ck.admin, { settings: { endsAt: until } })).statusCode).toBe(200);
    expect((await get(`/api/games/${C.gameId}/my-map`, ck.cap1)).json().victory).toMatchObject({ teamId: C.team1, until });
    await sweep(C.gameId);
    expect(await gameRow(C.gameId)).toMatchObject({ status: "FINISHED", winnerTeamId: C.team1, finishReason: "last_team" });
  });
  it("D: осада и вызов выбывшей команды против победителя, объявленные до её поражения, снимаются; победитель цел", async () => {
    const D = await setupGame("Победа D", null);
    // До поражения «Странники» осаждают столицу «Ковчега» и ждут ответа на свой вызов ей же; оба срока ещё идут.
    const siege = await prisma.siege.create({ data: { gameId: D.gameId, nodeKey: D.jonKey, attackerId: D.team2, defenderId: D.team1, startedAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + HOUR) } });
    const battle = await prisma.battle.create({ data: { gameId: D.gameId, nodeKey: D.jonKey, bookCode: "jon", attackerId: D.team2, defenderId: D.team1, bid: 10, status: "DEFENSE", startedAt: new Date(), defenseDeadline: new Date(Date.now() + HOUR) } });
    await siegeWin(D);
    expect((await prisma.siege.findUniqueOrThrow({ where: { id: siege.id } })).status).toBe("CANCELLED");
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: battle.id } })).status).toBe("CANCELLED");
    // Страховка: даже если такие испытание и осада остались бы и их срок вышел (с делами у выбывших) — победа их не отдаёт.
    const deed = await prisma.deed.findFirstOrThrow({ where: { gameId: D.gameId } });
    await prisma.siege.update({ where: { id: siege.id }, data: { status: "ACTIVE", endsAt: new Date(Date.now() - 1000) } });
    await prisma.battle.update({ where: { id: battle.id }, data: { status: "DEFENSE", resolvedAt: null, defenseDeadline: new Date(Date.now() - 1000) } });
    const fake = await Promise.all([0, 1, 2].map((i) => prisma.teamEdgeTask.create({ data: { gameId: D.gameId, teamId: D.team2, fromKey: `late-${i}`, toKey: `late-to-${i}`, deedId: deed.id, status: "APPROVED", decidedAt: new Date(Date.now() - 5000) } })));
    await sweep(D.gameId);
    await prisma.teamEdgeTask.deleteMany({ where: { id: { in: fake.map((t) => t.id) } } });
    expect((await prisma.siege.findUniqueOrThrow({ where: { id: siege.id } })).status).toBe("CANCELLED");
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: battle.id } })).status).toBe("CANCELLED");
    const jon = await prisma.teamCityState.findUniqueOrThrow({ where: { teamId_nodeKey: { teamId: D.team1, nodeKey: D.jonKey } } });
    expect(jon).toMatchObject({ isCapital: true });
    expect(jon.capturedAt).toBeTruthy();
    expect((await prisma.team.findUniqueOrThrow({ where: { id: D.team1 } })).status).not.toBe("defeated");
    expect(await gameRow(D.gameId)).toMatchObject({ status: "ACTIVE", victoryTeamId: D.team1 });
    // Через трое суток — конец с победителем.
    const g = await gameRow(D.gameId);
    await prisma.game.update({ where: { id: D.gameId }, data: { settings: { ...(g.settings as object), endsAt: new Date(Date.now() - 1000).toISOString() } } });
    await sweep(D.gameId);
    expect(await gameRow(D.gameId)).toMatchObject({ status: "FINISHED", winnerTeamId: D.team1, finishReason: "last_team" });
  });

  it("E: в празднование идущие испытания и осады партии снимаются при входе", async () => {
    const E = await setupGame("Победа E", null);
    // Вызов «Ковчега» Есфири «Странников» (ещё не начат) — при их выбывании снимается как их испытание.
    const queued = await prisma.battle.create({ data: { gameId: E.gameId, nodeKey: E.estKey, bookCode: "est", attackerId: E.team1, defenderId: E.team2, bid: 10, status: "QUEUED" } });
    await siegeWin(E);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("CANCELLED");
    expect(await prisma.battle.count({ where: { gameId: E.gameId, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } } })).toBe(0);
    expect(await prisma.siege.count({ where: { gameId: E.gameId, status: "ACTIVE" } })).toBe(0);
  });

  it("F: срок празднования не затирается записью настроек, начатой до победы (ярлыки конвертов)", async () => {
    const F = await setupGame("Победа F", null);
    await setSettings(F.gameId, { endsAt: new Date(Date.now() + 10 * 24 * HOUR).toISOString() });
    await prisma.team.update({ where: { id: F.team2 }, data: { status: "defeated" } });
    // Маршрут прочитал настройки (срок через десять дней), и пока рисует PDF, наступает победа.
    duringPdf.hook = () => checkLastTeam(F.gameId);
    try {
      expect((await get(`/api/games/${F.gameId}/labels.pdf`, ck.admin)).statusCode).toBe(200);
    } finally { duringPdf.hook = null; }
    const g = await gameRow(F.gameId);
    expect(g.victoryTeamId).toBe(F.team1);
    expect(await endsAtOf(F.gameId)).toBe(new Date(g.victoryAt!.getTime() + VICTORY_MS).toISOString());
    expect((g.settings as { labelsPrintedAt?: string }).labelsPrintedAt).toBeTruthy();
    // Перераспределение адресатов снимает свою отметку и тоже не трогает срок.
    expect((await post(`/api/games/${F.gameId}/recipients/redistribute`, ck.admin)).statusCode).toBe(200);
    expect(await endsAtOf(F.gameId)).toBe(new Date(g.victoryAt!.getTime() + VICTORY_MS).toISOString());
    expect((await gameRow(F.gameId)).settings).not.toHaveProperty("labelsPrintedAt");
  });

  it("G: срок игры вышел, а ответ на вызов последней столице просрочен раньше — сначала взятие и празднование", async () => {
    const G = await setupGame("Победа G", null);
    // Хранители Руфи не ответили к сроку (за минуту до конца игры); обход пришёл, когда вышел и срок игры.
    const b = await prisma.battle.create({ data: { gameId: G.gameId, nodeKey: G.rutKey, bookCode: "rut", attackerId: G.team1, defenderId: G.team2, bid: 10, status: "DEFENSE", startedAt: new Date(Date.now() - HOUR), defenseDeadline: new Date(Date.now() - 2 * 60_000) } });
    await setSettings(G.gameId, { endsAt: new Date(Date.now() - 60_000).toISOString() });
    await sweep(G.gameId);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("WON");
    const g = await gameRow(G.gameId);
    expect(g).toMatchObject({ status: "ACTIVE", victoryTeamId: G.team1, finishReason: null });
    expect(await endsAtOf(G.gameId)).toBe(new Date(g.victoryAt!.getTime() + VICTORY_MS).toISOString());
  });
  it("H: срок ответа и срок осады позже конца игры, обход опоздал — игра кончается по сроку, празднования нет", async () => {
    const H = await setupGame("Победа H", null);
    // Конец игры — минуту назад; срок ответа хранителей Руфи и срок осады Есфири — 20 с назад, то есть уже после конца.
    const b = await prisma.battle.create({ data: { gameId: H.gameId, nodeKey: H.rutKey, bookCode: "rut", attackerId: H.team1, defenderId: H.team2, bid: 10, status: "DEFENSE", startedAt: new Date(Date.now() - HOUR), defenseDeadline: new Date(Date.now() - 20_000) } });
    const siege = await prisma.siege.create({ data: { gameId: H.gameId, nodeKey: H.estKey, attackerId: H.team1, defenderId: H.team2, startedAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() - 20_000) } });
    const deed = await prisma.deed.findFirstOrThrow({ where: { gameId: H.gameId } });
    await prisma.teamEdgeTask.create({ data: { gameId: H.gameId, teamId: H.team1, fromKey: "h-1", toKey: "h-2", deedId: deed.id, status: "APPROVED", decidedAt: new Date(Date.now() - 30 * 60_000) } });
    await setSettings(H.gameId, { endsAt: new Date(Date.now() - 60_000).toISOString() });
    await sweep(H.gameId);
    expect((await prisma.battle.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("CANCELLED");
    expect((await prisma.siege.findUniqueOrThrow({ where: { id: siege.id } })).status).toBe("CANCELLED");
    // Лидер — без этих городов: у «Странников» два города (Руфь и Есфирь), у «Ковчега» один.
    const g = await gameRow(H.gameId);
    expect(g).toMatchObject({ status: "FINISHED", finishReason: "time_limit", winnerTeamId: H.team2, victoryAt: null });
    expect((await prisma.team.findUniqueOrThrow({ where: { id: H.team2 } })).status).not.toBe("defeated");
  });

  it("I: завершение игры снимает и осады; в завершённой игре осада не разрешается", async () => {
    const I = await setupGame("Победа I", null);
    const deed = await prisma.deed.findFirstOrThrow({ where: { gameId: I.gameId } });
    const siege = await prisma.siege.create({ data: { gameId: I.gameId, nodeKey: I.rutKey, attackerId: I.team1, defenderId: I.team2, startedAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + HOUR) } });
    await prisma.teamEdgeTask.create({ data: { gameId: I.gameId, teamId: I.team1, fromKey: "i-1", toKey: "i-2", deedId: deed.id, status: "APPROVED", decidedAt: new Date(Date.now() - 5000) } });
    expect((await post(`/api/games/${I.gameId}/finish`, ck.admin)).statusCode).toBe(200);
    expect((await prisma.siege.findUniqueOrThrow({ where: { id: siege.id } })).status).toBe("CANCELLED");
    // Страховка: осада, оставшаяся идущей в завершённой игре (как в партиях до правки), так и не разрешается.
    await prisma.siege.update({ where: { id: siege.id }, data: { status: "ACTIVE", resolvedAt: null, endsAt: new Date(Date.now() - 1000) } });
    await sweep(I.gameId);
    expect((await prisma.siege.findUniqueOrThrow({ where: { id: siege.id } })).status).toBe("ACTIVE");
    expect((await prisma.team.findUniqueOrThrow({ where: { id: I.team2 } })).status).not.toBe("defeated");
    expect((await prisma.teamCityState.findUniqueOrThrow({ where: { teamId_nodeKey: { teamId: I.team2, nodeKey: I.rutKey } } })).capturedAt).toBeTruthy();
  });
});
