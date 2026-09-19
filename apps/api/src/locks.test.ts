import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { outbox } from "./services/mail.js";
import { cleanupFixtures, readyForStart, registerVerified } from "./testAuth.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `ladm_${stamp}`, p1Nick = `lp1_${stamp}`, p2Nick = `lp2_${stamp}`;
let adminCookie = "", p1Cookie = "", p2Cookie = "", gameId = "", team1 = "", rutKey = "";
const content = JSON.parse(await readFile(new URL("../../../content/cities/rut.json", import.meta.url), "utf8")) as { districts: Array<{ title: string }>; tasks: Array<{ type: string; correct?: number; options?: string[] }> };

async function register(nickname: string) {
  const res = await registerVerified(app, { nickname, password: "secret123" });
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
/** Первое задание с выбором (район 1 Руфи теперь кроссворд). */
const c0 = content.tasks.findIndex((t) => t.type === "choice");
const noCooldown = () => prisma.teamTaskLock.updateMany({ where: { teamId: team1, nodeKey: rutKey }, data: { lockedUntil: null } });
/** Показанный номер верного варианта: варианты у команды перетасованы, поэтому ищем по тексту. */
async function shown(index: number): Promise<{ correct: number; wrong: number }> {
  const task = content.tasks[index]! as { options: string[]; correct: number };
  const options = (await city()).content.tasks[index].options as string[];
  const correct = options.indexOf(task.options[task.correct]!);
  expect(correct).toBeGreaterThanOrEqual(0);
  return { correct, wrong: (correct + 1) % options.length };
}

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick); p1Cookie = await register(p1Nick); p2Cookie = await register(p2Nick);
  const g = await app.inject({ method: "POST", url: "/api/games", headers: { cookie: adminCookie }, payload: { name: "Попытки", teamCount: 2 } });
  gameId = g.json().game.id;
  await app.inject({ method: "POST", url: `/api/games/${gameId}/generate`, headers: { cookie: adminCookie } });
  team1 = await joinTeam("Львы", p1Cookie);
  await joinTeam("Орлы", p2Cookie);
  await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds/import-default`, headers: { cookie: adminCookie } });
  await readyForStart(app, gameId, adminCookie);
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
  await cleanupFixtures(gameId);
  await app.close(); await prisma.$disconnect();
});

describe("растущая пауза после неверных ответов и обращение в поддержку", () => {
  it("каждая неверная попытка удлиняет паузу; обращение в поддержку с автозаполнением; ответ поддержки не трогает паузу", async () => {
    const task = content.tasks[c0]!;
    expect(task.type).toBe("choice");
    const { correct, wrong } = await shown(c0);
    const first = await answer(c0, wrong);
    expect(first.json()).toMatchObject({ correct: false, wrong: 1 });
    expect(first.json().retryAt).toBeGreaterThan(Date.now() + 15_000);
    // Пока пауза идёт — ответ не принимается.
    const early = await answer(c0, correct);
    expect(early.statusCode).toBe(429);
    await noCooldown();
    const second = await answer(c0, wrong);
    expect(second.json()).toMatchObject({ correct: false, wrong: 2 });
    expect(second.json().retryAt).toBeGreaterThan(Date.now() + 50_000);
    const state = (await city()).state;
    expect(state.pauseSteps[0]).toBe(20);
    const lock0 = state.locks.find((l: { index: number }) => l.index === c0);
    expect(lock0).toMatchObject({ index: c0, wrong: 2 });
    expect(lock0).not.toHaveProperty("unlocked");
    expect(lock0.lockedUntil).toBeGreaterThan(Date.now());

    // Пауза считается на задание: неверный текст в другом задании — своя пауза.
    const textIndex = content.tasks.findIndex((t) => t.type === "text");
    const wrongText = await answer(textIndex, "заведомо неверно");
    expect(wrongText.json()).toMatchObject({ correct: false, wrong: 1 });
    await noCooldown();

    // Адрес поддержки задаёт суперадмин; обращение уходит письмом с автозаполненным контекстом.
    await prisma.user.update({ where: { nickname: adminNick }, data: { platformRole: "SUPERADMIN" } });
    expect((await app.inject({ method: "PATCH", url: "/api/admin/settings", headers: { cookie: p1Cookie }, payload: { supportEmail: "x@example.com" } })).statusCode).toBe(403);
    const settings = await app.inject({ method: "PATCH", url: "/api/admin/settings", headers: { cookie: adminCookie }, payload: { supportEmail: `support_${stamp}@example.com` } });
    expect(settings.json().supportEmail).toBe(`support_${stamp}@example.com`);
    // Перед обращением — свежая пауза на задание (третья ошибка подряд), чтобы проверить, что ответ поддержки её не трогает.
    const third = await answer(c0, wrong);
    expect(third.json()).toMatchObject({ correct: false, wrong: 3 });
    outbox.length = 0;
    const req = await app.inject({ method: "POST", url: `/api/games/${gameId}/support`, headers: { cookie: p1Cookie }, payload: { nodeKey: rutKey, taskIndex: c0, message: "Мы уверены, что ответ был верный: проверьте, пожалуйста" } });
    expect(req.statusCode).toBe(201);
    await new Promise((r) => setTimeout(r, 50));
    const mail = outbox.find((m) => m.to === `support_${stamp}@example.com`);
    expect(mail).toBeTruthy();
    expect(mail!.subject).toContain("Львы");
    expect(mail!.text).toContain(`Задание ${c0 + 1}`);
    expect(mail!.text).toContain("Мы уверены");
    expect(mail!.text).not.toContain(task.options![task.correct!]!);
    const mine = (await city()).state.support;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ taskIndex: c0, status: "OPEN", reply: null });

    expect((await app.inject({ method: "GET", url: "/api/admin/support", headers: { cookie: p1Cookie } })).statusCode).toBe(403);
    const list = await app.inject({ method: "GET", url: "/api/admin/support", headers: { cookie: adminCookie } });
    const item = list.json().requests.find((r: { message: string }) => r.message.startsWith("Мы уверены"));
    expect(item).toMatchObject({ team: { name: "Львы" }, bookCode: "rut", taskIndex: c0, status: "OPEN" });
    expect(item.context).toMatchObject({ team: "Львы", task: c0 + 1 });
    expect(item.context).not.toHaveProperty("attemptsLeft");
    expect(item).not.toHaveProperty("unlocked");

    // Ответ поддержки только отвечает: пауза задания идёт своим чередом (решение владельца 3.19), «снять блокировку» больше нет.
    const resolve = await app.inject({ method: "POST", url: `/api/admin/support/${item.id}/resolve`, headers: { cookie: adminCookie }, payload: { unlock: true, reply: "Перечитайте первую главу" } });
    expect(resolve.json()).toEqual({ ok: true });
    expect((await app.inject({ method: "POST", url: `/api/admin/support/${item.id}/resolve`, headers: { cookie: adminCookie }, payload: {} })).statusCode).toBe(409);
    const after = (await city());
    const lockAfter = after.state.locks.find((l: { index: number }) => l.index === c0);
    expect(lockAfter).toMatchObject({ index: c0, wrong: 3 });
    expect(lockAfter.lockedUntil).toBeGreaterThan(Date.now());
    expect(after.state.support[0]).toMatchObject({ status: "CLOSED", reply: "Перечитайте первую главу" });
    expect(after.state.support[0]).not.toHaveProperty("unlocked");
    expect((await answer(c0, correct)).statusCode).toBe(429);
    // Когда пауза прошла — верный ответ принимается, счёт ошибок сброшен.
    await noCooldown();
    const ok = await answer(c0, correct);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().correct).toBe(true);
  });

  it("ответ поддержки без текста: обращение закрыто, пауза задания остаётся до срока", async () => {
    const idx = content.tasks.findIndex((t, i) => t.type === "choice" && i !== c0);
    const { correct, wrong } = await shown(idx);
    await answer(idx, wrong); await noCooldown();
    await answer(idx, wrong);
    await app.inject({ method: "POST", url: `/api/games/${gameId}/support`, headers: { cookie: p1Cookie }, payload: { nodeKey: rutKey, taskIndex: idx, message: "Не согласны с ответом" } });
    const list = await app.inject({ method: "GET", url: "/api/admin/support", headers: { cookie: adminCookie } });
    const item = list.json().requests.find((r: { message: string }) => r.message === "Не согласны с ответом");
    const r = await app.inject({ method: "POST", url: `/api/admin/support/${item.id}/resolve`, headers: { cookie: adminCookie }, payload: {} });
    expect(r.json()).toEqual({ ok: true });
    const lock = (await city()).state.locks.find((l: { index: number }) => l.index === idx);
    expect(lock.lockedUntil).toBeGreaterThan(Date.now());
    expect((await city()).state.support.find((s: { taskIndex: number }) => s.taskIndex === idx)).toMatchObject({ status: "CLOSED", reply: null });
    expect((await answer(idx, correct)).statusCode).toBe(429);
  });

  it("ответы видит только администратор платформы; тестовые действия закрыты администратору игры", async () => {
    // Обычный администратор игры — отдельный пользователь, добавленный в игру.
    const plainNick = `lplain_${stamp}`;
    const plainCookie = await register(plainNick);
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/admins`, headers: { cookie: adminCookie }, payload: { login: plainNick } })).statusCode).toBe(201);
    const asPlain = await app.inject({ method: "GET", url: `/api/games/${gameId}/cities/${rutKey}`, headers: { cookie: plainCookie } });
    expect(asPlain.statusCode).toBe(200);
    expect(asPlain.json().answersHidden).toBe(true);
    for (const t of asPlain.json().content.tasks) { expect(t.answer).toBeUndefined(); expect(t.answers).toBeUndefined(); expect(t.correct).toBeUndefined(); expect(t.items).toBeUndefined(); expect(t.prompt).toBeTruthy(); }
    const asSuper = await app.inject({ method: "GET", url: `/api/games/${gameId}/cities/${rutKey}`, headers: { cookie: adminCookie } });
    expect(asSuper.json().answersHidden).toBe(false);
    expect(asSuper.json().content.tasks[c0].correct).toBe(content.tasks[c0]!.correct);
    const denied = await app.inject({ method: "POST", url: `/api/games/${gameId}/cities/${rutKey}/assign`, headers: { cookie: plainCookie }, payload: { teamId: team1 } });
    expect(denied.statusCode).toBe(403);
    const deniedStudy = await app.inject({ method: "POST", url: `/api/games/${gameId}/cities/${rutKey}/study`, headers: { cookie: plainCookie }, payload: { teamId: team1 } });
    expect(deniedStudy.statusCode).toBe(403);
    const deniedReveal = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${team1}/reveal`, headers: { cookie: plainCookie }, payload: { nodeKey: rutKey } });
    expect(deniedReveal.statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/cities/${rutKey}/study`, headers: { cookie: adminCookie }, payload: { teamId: team1 } })).statusCode).toBe(200);
    await prisma.user.deleteMany({ where: { nickname: plainNick } });
  });
});
