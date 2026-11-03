import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";

/**
 * Тестовый вход за бота (решение владельца 03.11). Главное — защита: на проде (голый домен) маршрутов /api/dev/* нет;
 * даже на стенде войти можно только за тестового бота (tg_*@example.com), не за реальный аккаунт и не за суперадмина;
 * вход подтверждает боту почту (на стенде без SMTP иначе бы висело «Подтвердите почту»).
 */
const local = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" }); // PUBLIC_URL по умолчанию localhost → включено
const prod = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please", PUBLIC_URL: "https://landsoftheword.com" }); // голый домен → выключено

const tag = Date.now();
const bot = `tg_dev${tag}`;
const person = `person${tag}`;
const superBot = `tg_super${tag}`;

async function mkUser(nickname: string, opts: { verified?: boolean; superadmin?: boolean } = {}) {
  await prisma.user.create({ data: { nickname, email: `${nickname}@example.com`, passwordHash: await bcrypt.hash("secret123", 10), emailVerified: opts.verified ?? false, platformRole: opts.superadmin ? "SUPERADMIN" : "USER" } });
}

describe("тестовый вход за бота", () => {
  beforeAll(async () => {
    await local.ready(); await prod.ready();
    await mkUser(bot, { verified: false });
    await mkUser(person, { verified: true });
    await mkUser(superBot, { verified: true, superadmin: true });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { nickname: { in: [bot, person, superBot] } } });
    await local.close(); await prod.close(); await prisma.$disconnect();
  });

  it("на проде маршрутов /api/dev/* нет", async () => {
    expect((await prod.inject({ method: "GET", url: "/api/dev/bots" })).statusCode).toBe(404);
    expect((await prod.inject({ method: "POST", url: "/api/dev/become", payload: { nickname: bot } })).statusCode).toBe(404);
  });

  it("список ботов: есть обычные боты tg_*, нет реальных аккаунтов и нет суперадминов", async () => {
    const list = await local.inject({ method: "GET", url: "/api/dev/bots" });
    expect(list.statusCode).toBe(200);
    const nicks = list.json().bots.map((b: { nickname: string }) => b.nickname);
    expect(nicks).toContain(bot);
    expect(nicks).not.toContain(person);
    expect(nicks).not.toContain(superBot);
  });

  it("вход за бота без пароля подтверждает ему почту; за реальный аккаунт и за суперадмина — отказ", async () => {
    const become = await local.inject({ method: "POST", url: "/api/dev/become", payload: { nickname: bot } });
    expect(become.statusCode).toBe(200);
    expect(become.json().user.nickname).toBe(bot);
    expect(become.json().user.emailVerified).toBe(true); // почта подтверждена входом
    const sc = become.headers["set-cookie"];
    const cookie = (Array.isArray(sc) ? sc : [sc]).map((c) => String(c).split(";")[0]).join("; ");
    const me = await local.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.json().user.nickname).toBe(bot);

    expect((await local.inject({ method: "POST", url: "/api/dev/become", payload: { nickname: person } })).statusCode).toBe(404);
    expect((await local.inject({ method: "POST", url: "/api/dev/become", payload: { nickname: superBot } })).statusCode).toBe(404);
    expect((await local.inject({ method: "POST", url: "/api/dev/become", payload: { nickname: `tg_nope${tag}` } })).statusCode).toBe(404);
  });
});
