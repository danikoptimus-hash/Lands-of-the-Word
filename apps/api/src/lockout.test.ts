import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { outbox } from "./services/mail.js";
import { registerVerified } from "./testAuth.js";
import { LOCK_AFTER } from "./routes/auth.js";

/** Защита от подбора пароля (решение владельца 22.09): 10 неверных подряд → вход закрыт на 15 минут и письмо владельцу. */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });

describe("блокировка входа после неверных попыток", () => {
  const nick = `lock_${Date.now()}`;
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await prisma.user.deleteMany({ where: { nickname: { startsWith: nick } } }); await app.close(); await prisma.$disconnect(); });

  it("после 10 неверных паролей не пускает даже с верным, шлёт письмо; сброс пароля снимает блокировку", async () => {
    expect((await registerVerified(app, { nickname: nick, password: "secret123" })).statusCode).toBe(201);
    // Каждая попытка — с нового адреса (как при переборе с многих машин): лимит по IP (20/мин) не мешает проверить блокировку учётки.
    let ip = 0;
    const login = (password: string) => app.inject({ method: "POST", url: "/api/auth/login", payload: { nickname: nick, password }, headers: { "x-forwarded-for": `10.7.${Math.floor(++ip / 250)}.${ip % 250}` } });
    for (let i = 0; i < LOCK_AFTER - 1; i++) expect((await login("wrong-" + i)).statusCode).toBe(401);
    // Девять неверных — верный ещё проходит и обнуляет счётчик.
    expect((await login("secret123")).statusCode).toBe(200);
    for (let i = 0; i < LOCK_AFTER; i++) expect((await login("wrong-" + i)).statusCode).toBe(401);
    const locked = await login("secret123");
    expect(locked.statusCode).toBe(423);
    expect(locked.json().error).toBe("locked");
    const mail = [...outbox].reverse().find((m) => m.to === `${nick}@example.com` && m.subject.includes("подбирает"));
    expect(mail?.text).toContain(nick);
    // Срок блокировки прошёл — вход снова открыт.
    await prisma.user.update({ where: { nickname: nick }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await login("secret123")).statusCode).toBe(200);
    // Новая блокировка, затем смена пароля по ссылке снимает её.
    for (let i = 0; i < LOCK_AFTER; i++) await login("bad");
    expect((await login("secret123")).statusCode).toBe(423);
    expect((await app.inject({ method: "POST", url: "/api/auth/forgot", payload: { login: nick } })).statusCode).toBe(200);
    const reset = [...outbox].reverse().find((m) => m.to === `${nick}@example.com` && m.subject.includes("восстановление"));
    const token = /\/reset\/([A-Za-z0-9_-]+)/.exec(reset?.text ?? "")?.[1];
    expect(token).toBeTruthy();
    expect((await app.inject({ method: "POST", url: "/api/auth/reset", payload: { token, password: "newsecret123" } })).statusCode).toBe(200);
    expect((await login("newsecret123")).statusCode).toBe(200);
  });
});
