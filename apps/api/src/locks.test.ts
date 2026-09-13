import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { outbox } from "./services/mail.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `ladm_${stamp}`, p1Nick = `lp1_${stamp}`, p2Nick = `lp2_${stamp}`;
let adminCookie = "", p1Cookie = "", p2Cookie = "", gameId = "", team1 = "", rutKey = "";
const content = JSON.parse(await readFile(new URL("../../../content/cities/rut.json", import.meta.url), "utf8")) as { districts: Array<{ title: string }>; tasks: Array<{ type: string; correct?: number; options?: string[] }> };

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

describe("минимальное время чтения", () => {
  it("норма считается от объёма района; ответ до неё не принимается; время копится только по сигналам «читаю»", async () => {
    const c = await city();
    const t0 = c.content.tasks[0], tBook = c.content.tasks.find((t: { scope: string }) => t.scope === "book");
    expect(t0.readingMs).toBe(3 * 60_000); // Руфь 1:1–5 — 5 стихов, минимум 3 минуты
    expect(tBook.readingMs).toBe(5 * 60_000);
    expect(c.state.heartbeatMs).toBe(10_000);
    const early = await answer(0, (await shown(0)).correct);
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toBe("reading");
    expect(early.json().remainingMs).toBe(3 * 60_000);
    // Первый сигнал ничего не засчитывает (нет предыдущего), второй — не больше 20 с даже после долгой паузы.
    const h1 = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/tasks/0/reading`, headers: { cookie: p1Cookie } });
    expect(h1.json()).toMatchObject({ readMs: 0, requiredMs: 3 * 60_000 });
    await prisma.teamTaskLock.updateMany({ where: { teamId: team1, nodeKey: rutKey, taskIndex: 0 }, data: { readAt: new Date(Date.now() - 5 * 60_000) } });
    const h2 = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/tasks/0/reading`, headers: { cookie: p1Cookie } });
    expect(h2.json().readMs).toBe(20_000);
    await prisma.teamTaskLock.updateMany({ where: { teamId: team1, nodeKey: rutKey, taskIndex: 0 }, data: { readAt: new Date(Date.now() - 10_000) } });
    const h3 = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/tasks/0/reading`, headers: { cookie: p1Cookie } });
    expect(h3.json().readMs).toBeGreaterThanOrEqual(29_000);
    expect((await city()).state.locks.find((l: { index: number }) => l.index === 0).readMs).toBe(h3.json().readMs);
    // Дальше тесты попыток: норма набрана.
    await prisma.teamTaskLock.createMany({ data: content.tasks.map((_, i) => ({ gameId, teamId: team1, nodeKey: rutKey, taskIndex: i, readMs: 60 * 60_000 })), skipDuplicates: true });
    await prisma.teamTaskLock.updateMany({ where: { teamId: team1, nodeKey: rutKey }, data: { readMs: 60 * 60_000 } });
  });
});

describe("две попытки на выбор ответа, блокировка на сутки и обращение в поддержку", () => {
  it("вторая неверная попытка закрывает задание; обращение в поддержку с автозаполнением; суперадмин снимает блокировку", async () => {
    const task = content.tasks[0]!;
    expect(task.type).toBe("choice");
    const { correct, wrong } = await shown(0);
    const first = await answer(0, wrong);
    expect(first.json()).toMatchObject({ correct: false, attemptsLeft: 1, lockedUntil: null });
    await noCooldown();
    const second = await answer(0, wrong);
    expect(second.json().correct).toBe(false);
    expect(second.json().attemptsLeft).toBe(0);
    expect(second.json().lockedUntil).toBeGreaterThan(Date.now() + 23 * 3600_000);
    await noCooldown();
    const locked = await answer(0, correct);
    expect(locked.statusCode).toBe(423);
    expect(locked.json().error).toBe("locked");
    const state = (await city()).state;
    expect(state.choiceAttempts).toBe(2);
    const lock0 = state.locks.find((l: { index: number }) => l.index === 0);
    expect(lock0).toMatchObject({ index: 0, attemptsLeft: 0, unlocked: false });
    expect(lock0.lockedUntil).toBeGreaterThan(Date.now());

    // Другие типы заданий не блокируются: неверный текст только даёт паузу.
    const textIndex = content.tasks.findIndex((t) => t.type === "text");
    const wrongText = await answer(textIndex, "заведомо неверно");
    expect(wrongText.json()).toMatchObject({ correct: false, attemptsLeft: null, lockedUntil: null });
    await noCooldown();

    // Адрес поддержки задаёт суперадмин; обращение уходит письмом с автозаполненным контекстом.
    await prisma.user.update({ where: { nickname: adminNick }, data: { platformRole: "SUPERADMIN" } });
    expect((await app.inject({ method: "PATCH", url: "/api/admin/settings", headers: { cookie: p1Cookie }, payload: { supportEmail: "x@example.com" } })).statusCode).toBe(403);
    const settings = await app.inject({ method: "PATCH", url: "/api/admin/settings", headers: { cookie: adminCookie }, payload: { supportEmail: `support_${stamp}@example.com` } });
    expect(settings.json().supportEmail).toBe(`support_${stamp}@example.com`);
    outbox.length = 0;
    const req = await app.inject({ method: "POST", url: `/api/games/${gameId}/support`, headers: { cookie: p1Cookie }, payload: { nodeKey: rutKey, taskIndex: 0, message: "Мы уверены, что ответ был верный: проверьте, пожалуйста" } });
    expect(req.statusCode).toBe(201);
    await new Promise((r) => setTimeout(r, 50));
    const mail = outbox.find((m) => m.to === `support_${stamp}@example.com`);
    expect(mail).toBeTruthy();
    expect(mail!.subject).toContain("Львы");
    expect(mail!.text).toContain("Задание 1");
    expect(mail!.text).toContain("Мы уверены");
    expect(mail!.text).not.toContain(task.options![task.correct!]!);
    const mine = (await city()).state.support;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ taskIndex: 0, status: "OPEN", reply: null });

    expect((await app.inject({ method: "GET", url: "/api/admin/support", headers: { cookie: p1Cookie } })).statusCode).toBe(403);
    const list = await app.inject({ method: "GET", url: "/api/admin/support", headers: { cookie: adminCookie } });
    const item = list.json().requests.find((r: { message: string }) => r.message.startsWith("Мы уверены"));
    expect(item).toMatchObject({ team: { name: "Львы" }, bookCode: "rut", taskIndex: 0, status: "OPEN" });
    expect(item.context).toMatchObject({ team: "Львы", task: 1, attemptsLeft: 0 });

    const resolve = await app.inject({ method: "POST", url: `/api/admin/support/${item.id}/resolve`, headers: { cookie: adminCookie }, payload: { unlock: true, reply: "Перечитайте первую главу" } });
    expect(resolve.json()).toMatchObject({ ok: true, unlocked: true });
    expect((await app.inject({ method: "POST", url: `/api/admin/support/${item.id}/resolve`, headers: { cookie: adminCookie }, payload: { unlock: true } })).statusCode).toBe(409);
    const after = (await city());
    expect(after.state.locks.find((l: { index: number }) => l.index === 0)).toMatchObject({ lockedUntil: null, attemptsLeft: 2, unlocked: true });
    expect(after.state.support[0]).toMatchObject({ status: "CLOSED", reply: "Перечитайте первую главу", unlocked: true });
    const ok = await answer(0, correct);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().correct).toBe(true);
  });

  it("суперадмин может оставить блокировку: задание закрыто до срока, ответ команде записан", async () => {
    const idx = content.tasks.findIndex((t, i) => t.type === "choice" && i !== 0);
    const { correct, wrong } = await shown(idx);
    await answer(idx, wrong); await noCooldown();
    await answer(idx, wrong); await noCooldown();
    await app.inject({ method: "POST", url: `/api/games/${gameId}/support`, headers: { cookie: p1Cookie }, payload: { nodeKey: rutKey, taskIndex: idx, message: "Не согласны с ответом" } });
    const list = await app.inject({ method: "GET", url: "/api/admin/support", headers: { cookie: adminCookie } });
    const item = list.json().requests.find((r: { message: string }) => r.message === "Не согласны с ответом");
    const r = await app.inject({ method: "POST", url: `/api/admin/support/${item.id}/resolve`, headers: { cookie: adminCookie }, payload: { unlock: false, reply: "Ответ в тексте есть, ищите внимательнее" } });
    expect(r.json()).toMatchObject({ ok: true, unlocked: false });
    const lock = (await city()).state.locks.find((l: { index: number }) => l.index === idx);
    expect(lock.lockedUntil).toBeGreaterThan(Date.now());
    expect((await city()).state.support.find((s: { taskIndex: number }) => s.taskIndex === idx).reply).toBe("Ответ в тексте есть, ищите внимательнее");
    expect((await answer(idx, correct)).statusCode).toBe(423);
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
    expect(asSuper.json().content.tasks[0].correct).toBe(content.tasks[0]!.correct);
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
