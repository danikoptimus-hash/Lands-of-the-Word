import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { registerVerified } from "./testAuth.js";

/**
 * Тестовый вход за бота (решение владельца 03.11). Главное — защита: на проде (голый домен) маршрутов /api/dev/* нет,
 * а даже на стенде войти можно только за тестового бота (tg_*@example.com), не за реальный аккаунт.
 */
const local = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" }); // PUBLIC_URL по умолчанию localhost → включено
const prod = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please", PUBLIC_URL: "https://landsoftheword.com" }); // голый домен → выключено

const tag = Date.now();
const bot = `tg_dev${tag}`;
const person = `person${tag}`;

describe("тестовый вход за бота", () => {
  beforeAll(async () => { await local.ready(); await prod.ready(); });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { nickname: { in: [bot, person] } } });
    await local.close(); await prod.close(); await prisma.$disconnect();
  });

  it("на проде маршрутов /api/dev/* нет", async () => {
    expect((await prod.inject({ method: "GET", url: "/api/dev/bots" })).statusCode).toBe(404);
    expect((await prod.inject({ method: "POST", url: "/api/dev/become", payload: { nickname: bot } })).statusCode).toBe(404);
  });

  it("на стенде/локально пускает за тестового бота, но не за реальный аккаунт", async () => {
    expect((await registerVerified(local, { nickname: bot, password: "secret123" })).statusCode).toBe(201);
    expect((await registerVerified(local, { nickname: person, password: "secret123" })).statusCode).toBe(201);

    // В списке ботов есть tg_*-бот и нет обычного аккаунта.
    const list = await local.inject({ method: "GET", url: "/api/dev/bots" });
    expect(list.statusCode).toBe(200);
    const nicks = list.json().bots.map((b: { nickname: string }) => b.nickname);
    expect(nicks).toContain(bot);
    expect(nicks).not.toContain(person);

    // Вход за бота без пароля — выдаётся сессия именно этого бота.
    const become = await local.inject({ method: "POST", url: "/api/dev/become", payload: { nickname: bot } });
    expect(become.statusCode).toBe(200);
    expect(become.json().user.nickname).toBe(bot);
    const me = await local.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: become.headers["set-cookie"] as string } });
    expect(me.json().user.nickname).toBe(bot);

    // За обычный аккаунт и за несуществующий ник — отказ.
    expect((await local.inject({ method: "POST", url: "/api/dev/become", payload: { nickname: person } })).statusCode).toBe(404);
    expect((await local.inject({ method: "POST", url: "/api/dev/become", payload: { nickname: `tg_nope${tag}` } })).statusCode).toBe(404);
  });
});
