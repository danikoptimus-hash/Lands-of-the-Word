import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";

/**
 * Нарушение мира и защитный союз (решение владельца 22.10): вызов при мире разрешён, но кончает мир;
 * при трёх и более командах хранители зовут третью команду в союз, её участники учат стихи ответа;
 * при двух командах защита города вдвое.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `al_adm_${stamp}`, cap1: `al_c1_${stamp}`, cap2: `al_c2_${stamp}`, cap3: `al_c3_${stamp}`, m3: `al_m3_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap1: "", cap2: "", cap3: "", m3: "" };
let gameId = "", t1 = "", t2 = "", t3 = "", rutKey = "", genKey = "";
const content = JSON.parse(await readFile(new URL("../../../content/cities/rut.json", import.meta.url), "utf8")) as { tasks: unknown[] };
const allTasks = content.tasks.map((_, i) => i);
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function feedUntil(cookie: string, kind: string, ms = 5000): Promise<Array<{ kind: string; everyone: boolean; vars: Record<string, string | number> }>> {
  const until = Date.now() + ms;
  for (;;) {
    const items = (await get(`/api/games/${gameId}/feed`, cookie)).json().items as Array<{ kind: string; everyone: boolean; vars: Record<string, string | number> }>;
    if (items.some((f) => f.kind === kind) || Date.now() > until) return items;
    await wait(50);
  }
}
type BattleView = { id: string; status: string; violation: boolean; defenseFactor: number; defenseNeed: number; mySide: string | null; defenseSum: number; allies: Array<{ id: string; status: string; team: { id: string } }>; allyCandidates: Array<{ id: string }>; myAlliance: { id: string; status: string } | null };
const battlesOf = async (cookie: string) => (await get(`/api/games/${gameId}/my-battles`, cookie)).json().battles as BattleView[];

beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) { const r = await registerVerified(app, { nickname: nicks[k], password: "secret123" }); ck[k] = r.headers["set-cookie"] as string; }
  gameId = (await post("/api/games", ck.admin, { name: "Нарушение мира", teamCount: 3 })).json().game.id;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  const mk = async (name: string, cookie: string) => { const tid = (await post(`/api/games/${gameId}/teams`, ck.admin, { name })).json().team.id; const inv = await post(`/api/games/${gameId}/teams/${tid}/invites`, ck.admin, { role: "CAPTAIN" }); await post(`/api/invites/${inv.json().invite.token}/accept`, cookie); return tid; };
  t1 = await mk("Хранители", ck.cap1); t2 = await mk("Нарушители", ck.cap2); t3 = await mk("Соседи", ck.cap3);
  const inv = await post(`/api/games/${gameId}/teams/${t3}/invites`, ck.admin, { role: "MEMBER" }); await post(`/api/invites/${inv.json().invite.token}/accept`, ck.m3);
  await post(`/api/games/${gameId}/deeds/import-default`, ck.admin);
  await readyForStart(app, gameId, ck.admin);
  await setGamePhase(app, gameId, ck.admin, "morning");
  const st = await post(`/api/games/${gameId}/start`, ck.admin); expect(st.statusCode, st.body).toBe(200);
  rutKey = (await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "rut" } })).key;
  genKey = (await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "gen" } })).key;
  await prisma.teamNodeState.createMany({ data: [{ teamId: t1, nodeKey: rutKey }, { teamId: t2, nodeKey: rutKey }, { teamId: t1, nodeKey: genKey }] });
  // «Хранители» владеют Руфью (столица — Бытие), «Нарушители» изучили Руфь и могут бросить вызов.
  await prisma.teamCityState.createMany({ data: [
    { gameId, teamId: t1, nodeKey: genKey, orderSolved: true, doneTasks: [], capturedAt: new Date(), isCapital: true },
    { gameId, teamId: t1, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks, capturedAt: new Date() },
    { gameId, teamId: t2, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks },
  ] });
});
afterAll(async () => { await cleanupFixtures(gameId); await prisma.game.deleteMany({ where: { id: gameId } }); await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } }); await app.close(); });

async function makePeace(fromCookie: string, toCookie: string, toId: string, fromId: string) {
  expect((await post(`/api/games/${gameId}/peace`, fromCookie, { teamId: toId, days: 7 })).statusCode).toBe(200);
  const inc = ((await get(`/api/games/${gameId}/peace`, toCookie)).json().teams as Array<{ team: { id: string }; peaceId: string }>).find((x) => x.team.id === fromId)!;
  expect((await post(`/api/games/${gameId}/peace/${inc.peaceId}/accept`, toCookie)).statusCode).toBe(200);
  return inc.peaceId;
}

describe("нарушение мира", () => {
  it("три команды: вызов при мире кончает мир, хранители зовут союзника, его стихи идут в ответ", async () => {
    const peaceId = await makePeace(ck.cap2, ck.cap1, t1, t2);
    // Мир не запрещает вызов, но интерфейс знает, что вызов его нарушит.
    const war = (await get(`/api/games/${gameId}/my-city/${rutKey}/war`, ck.cap2)).json();
    expect(war.canDeclare).toBe(true);
    expect(war.peace?.until).toBeTruthy();
    const declared = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, ck.cap2, { bid: 10 });
    expect(declared.statusCode, declared.body).toBe(201);
    const peace = await prisma.peace.findUniqueOrThrow({ where: { id: peaceId } });
    expect(peace.status).toBe("ENDED"); expect(peace.violated).toBe(true); expect(peace.endedById).toBe(t2);
    expect((await feedUntil(ck.cap3, "peace_violated")).find((f) => f.kind === "peace_violated")).toMatchObject({ everyone: true, vars: { team: "Нарушители", other: "Хранители", book: "rut" } });
    // Три команды: защита не удваивается, зато хранители видят, кого позвать.
    const mine = (await battlesOf(ck.cap1))[0]!;
    expect(mine).toMatchObject({ violation: true, defenseFactor: 1, defenseNeed: 10, mySide: "DEFENSE" });
    expect(mine.allyCandidates.map((t) => t.id)).toEqual([t3]);
    expect((await battlesOf(ck.cap2))[0]!.allyCandidates).toEqual([]);
    expect((await battlesOf(ck.cap3)).length).toBe(0);
    // Просить может капитан хранителей; претендентов и себя позвать нельзя.
    const url = `/api/games/${gameId}/battles/${mine.id}/allies`;
    expect((await post(url, ck.cap2, { teamId: t3 })).statusCode).toBe(404);
    expect((await post(url, ck.cap1, { teamId: t2 })).statusCode).toBe(409);
    const asked = await post(url, ck.cap1, { teamId: t3 });
    expect(asked.statusCode, asked.body).toBe(201);
    expect((await post(url, ck.cap1, { teamId: t3 })).statusCode).toBe(409);
    expect((await feedUntil(ck.cap3, "ally_requested")).find((f) => f.kind === "ally_requested")?.vars).toMatchObject({ team: "Хранители", other: "Соседи", third: "Нарушители" });
    // Третья команда видит испытание с просьбой; участник принять не может, капитан — да.
    const forAlly = (await battlesOf(ck.cap3))[0]!;
    expect(forAlly.myAlliance).toMatchObject({ status: "PROPOSED" }); expect(forAlly.mySide).toBeNull();
    const decide = `${url}/${forAlly.myAlliance!.id}`;
    expect((await post(`${decide}/accept`, ck.m3)).statusCode).toBe(403);
    expect((await post(`${decide}/accept`, ck.cap1)).statusCode).toBe(404);
    expect((await post(`${decide}/accept`, ck.cap3)).statusCode).toBe(200);
    expect((await post(`${decide}/accept`, ck.cap3)).statusCode).toBe(409);
    expect((await feedUntil(ck.cap2, "ally_joined")).find((f) => f.kind === "ally_joined")).toMatchObject({ everyone: true, vars: { team: "Соседи", other: "Хранители", third: "Нарушители", book: "rut" } });
    expect((await battlesOf(ck.cap1))[0]!.allies).toMatchObject([{ status: "ACTIVE", team: { id: t3 } }]);
    // Ответ: капитан хранителей выбирает отрывок, участник союзников учит стихи — они идут в сумму хранителей.
    await prisma.battle.update({ where: { id: mine.id }, data: { status: "DEFENSE", startedAt: new Date(), attackDoneAt: new Date(), attackApprovedAt: new Date(), defenseDeadline: new Date(Date.now() + 3_600_000) } });
    expect((await post(`/api/games/${gameId}/battles/${mine.id}/defense-passage`, ck.cap3, { from: "2:1", to: "2:6" })).statusCode).toBe(404);
    expect((await post(`/api/games/${gameId}/battles/${mine.id}/defense-passage`, ck.cap1, { from: "2:1", to: "2:6" })).statusCode).toBe(200);
    expect((await get(`/api/games/${gameId}/battles/${mine.id}/book`, ck.m3)).statusCode).toBe(200);
    const learned = await post(`/api/games/${gameId}/battles/${mine.id}/entries`, ck.m3, { verses: [22, 23, 24, 25, 26, 27], links: ["https://example.com/ally"] });
    expect(learned.statusCode, learned.body).toBe(201);
    expect(learned.json().sum).toBe(6);
    const after = (await battlesOf(ck.cap1))[0]!;
    expect(after.defenseSum).toBe(6);
    const allyView = (await battlesOf(ck.m3))[0]!;
    expect(allyView.mySide).toBe("DEFENSE"); expect(allyView.myAlliance?.status).toBe("ACTIVE");
    // Союзник не отправляет ответ на проверку: это право хранителей.
    expect((await post(`/api/games/${gameId}/battles/${mine.id}/submit`, ck.cap3)).statusCode).not.toBe(200);
  });
  it("две команды: вызов при мире удваивает защиту города", async () => {
    await prisma.team.update({ where: { id: t3 }, data: { status: "defeated" } });
    await makePeace(ck.cap2, ck.cap1, t1, t2); // идущее испытание мир закрывает
    const declared = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, ck.cap2, { bid: 10 });
    expect(declared.statusCode, declared.body).toBe(201);
    const b = (await battlesOf(ck.cap1)).find((x) => x.status === "QUEUED" || x.status === "ATTACK")!;
    expect(b).toMatchObject({ violation: false, defenseFactor: 2, defenseNeed: 20 });
    expect(b.allyCandidates).toEqual([]);
    expect((await post(`/api/games/${gameId}/battles/${b.id}/allies`, ck.cap1, { teamId: t3 })).statusCode).toBe(409);
  });
});
