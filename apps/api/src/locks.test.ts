import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `ladm_${stamp}`, p1Nick = `lp1_${stamp}`, p2Nick = `lp2_${stamp}`;
let adminCookie = "", p1Cookie = "", p2Cookie = "", gameId = "", team1 = "", rutKey = "";
const content = JSON.parse(await readFile(new URL("../../../content/cities/rut.json", import.meta.url), "utf8")) as { districts: Array<{ title: string }>; tasks: Array<{ type: string; correct?: number }> };

async function register(nickname: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname, password: "secret123" } });
  return res.headers["set-cookie"] as string;
}
async function joinTeam(name: string, cookie: string) {
  const t = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name } });
  const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${t.json().team.id}/invites`, headers: { cookie: adminCookie }, payload: { role: "CAPTAIN" } });
  await app.inject({ method: "POST", url: `/api/invites/${inv.json().invite.token}/accept`, headers: { cookie } });
  return t.json().team.id as string;
}
const answer = (index: number, value: unknown) => app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/tasks/${index}/answer`, headers: { cookie: p1Cookie }, payload: { answer: value } });
const city = async () => (await app.inject({ method: "GET", url: `/api/games/${gameId}/my-city/${rutKey}`, headers: { cookie: p1Cookie } })).json();
const noCooldown = () => prisma.teamCityState.updateMany({ where: { teamId: team1, nodeKey: rutKey }, data: { lastWrongAt: null } });

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick); p1Cookie = await register(p1Nick); p2Cookie = await register(p2Nick);
  const g = await app.inject({ method: "POST", url: "/api/games", headers: { cookie: adminCookie }, payload: { name: "Попытки", teamCount: 2 } });
  gameId = g.json().game.id;
  await app.inject({ method: "POST", url: `/api/games/${gameId}/generate`, headers: { cookie: adminCookie } });
  team1 = await joinTeam("Львы", p1Cookie);
  await joinTeam("Орлы", p2Cookie);
  await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds/import-default`, headers: { cookie: adminCookie } });
  expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/start`, headers: { cookie: adminCookie } })).statusCode).toBe(200);
  rutKey = (await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "rut" } })).key;
  await prisma.teamNodeState.create({ data: { teamId: team1, nodeKey: rutKey } });
  // Районы по порядку книги — по названиям из контента.
  const c = await city();
  const ids = (c.content.districts as Array<{ id: string; title: string }>).slice().sort((a, b) => content.districts.findIndex((d) => d.title === a.title) - content.districts.findIndex((d) => d.title === b.title)).map((d) => d.id);
  expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/order`, headers: { cookie: p1Cookie }, payload: { ids } })).json().correct).toBe(true);
});
afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, p1Nick, p2Nick] } } });
  await app.close(); await prisma.$disconnect();
});

describe("две попытки на выбор ответа, блокировка на сутки и спор", () => {
  it("вторая неверная попытка закрывает задание; спор уходит админу; админ снимает блокировку", async () => {
    const task = content.tasks[0]!;
    expect(task.type).toBe("choice");
    const wrongOption = (task.correct! + 1) % 4;
    const first = await answer(0, wrongOption);
    expect(first.json()).toMatchObject({ correct: false, attemptsLeft: 1, lockedUntil: null });
    await noCooldown();
    const second = await answer(0, wrongOption);
    expect(second.json().correct).toBe(false);
    expect(second.json().attemptsLeft).toBe(0);
    expect(second.json().lockedUntil).toBeGreaterThan(Date.now() + 23 * 3600_000);
    await noCooldown();
    const locked = await answer(0, task.correct);
    expect(locked.statusCode).toBe(423);
    expect(locked.json().error).toBe("locked");
    const state = (await city()).state;
    expect(state.choiceAttempts).toBe(2);
    expect(state.locks[0]).toMatchObject({ index: 0, attemptsLeft: 0, dispute: null });
    expect(state.locks[0].lockedUntil).toBeGreaterThan(Date.now());

    // Другие типы заданий не блокируются: неверный текст только даёт паузу.
    const textIndex = content.tasks.findIndex((t) => t.type === "text");
    const wrongText = await answer(textIndex, "заведомо неверно");
    expect(wrongText.json()).toMatchObject({ correct: false, attemptsLeft: null, lockedUntil: null });
    await noCooldown();

    const dispute = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/tasks/0/dispute`, headers: { cookie: p1Cookie }, payload: { message: "Мы уверены, что ответ был верный: проверьте, пожалуйста" } });
    expect(dispute.statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/tasks/0/dispute`, headers: { cookie: p1Cookie }, payload: { message: "И ещё раз" } });
    expect(again.statusCode).toBe(409);
    const notLocked = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/tasks/${textIndex}/dispute`, headers: { cookie: p1Cookie }, payload: { message: "Это задание не закрыто" } });
    expect(notLocked.statusCode).toBe(409);

    const forbidden = await app.inject({ method: "GET", url: `/api/games/${gameId}/disputes`, headers: { cookie: p1Cookie } });
    expect(forbidden.statusCode).toBe(403);
    const list = await app.inject({ method: "GET", url: `/api/games/${gameId}/disputes`, headers: { cookie: adminCookie } });
    expect(list.json().disputes).toHaveLength(1);
    expect(list.json().disputes[0]).toMatchObject({ team: { name: "Львы" }, bookCode: "rut", taskIndex: 0, message: "Мы уверены, что ответ был верный: проверьте, пожалуйста" });
    expect(list.json().disputes[0].correct).toBeTruthy();

    const resolve = await app.inject({ method: "POST", url: `/api/games/${gameId}/disputes/${list.json().disputes[0].id}/resolve`, headers: { cookie: adminCookie }, payload: { unlock: true, answer: "Перечитайте первую главу" } });
    expect(resolve.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/games/${gameId}/disputes`, headers: { cookie: adminCookie } })).json().disputes).toHaveLength(0);
    const after = (await city()).state.locks[0];
    expect(after).toMatchObject({ lockedUntil: null, attemptsLeft: 2, resolution: "Перечитайте первую главу" });
    expect(after.resolvedAt).toBeGreaterThan(0);
    const ok = await answer(0, task.correct);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().correct).toBe(true);
    expect((await city()).state.locks).toHaveLength(0);
  });

  it("админ может оставить блокировку: задание закрыто до срока, ответ команде записан", async () => {
    const idx = content.tasks.findIndex((t, i) => t.type === "choice" && i !== 0);
    const wrongOption = (content.tasks[idx]!.correct! + 1) % 4;
    await answer(idx, wrongOption); await noCooldown();
    await answer(idx, wrongOption); await noCooldown();
    await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/tasks/${idx}/dispute`, headers: { cookie: p1Cookie }, payload: { message: "Не согласны с ответом" } });
    const list = await app.inject({ method: "GET", url: `/api/games/${gameId}/disputes`, headers: { cookie: adminCookie } });
    const r = await app.inject({ method: "POST", url: `/api/games/${gameId}/disputes/${list.json().disputes[0].id}/resolve`, headers: { cookie: adminCookie }, payload: { unlock: false, answer: "Ответ в тексте есть, ищите внимательнее" } });
    expect(r.statusCode).toBe(200);
    const lock = (await city()).state.locks.find((l: { index: number }) => l.index === idx);
    expect(lock.lockedUntil).toBeGreaterThan(Date.now());
    expect(lock.resolution).toBe("Ответ в тексте есть, ищите внимательнее");
    expect((await answer(idx, content.tasks[idx]!.correct)).statusCode).toBe(423);
  });
});
