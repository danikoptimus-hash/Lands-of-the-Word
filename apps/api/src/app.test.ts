import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { outbox } from "./services/mail.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const nick = "tester_" + Date.now();
let cookie = "";

beforeAll(async () => { await app.ready(); });
afterAll(async () => {
  const users = await prisma.user.findMany({ where: { nickname: { startsWith: nick } } });
  await prisma.game.deleteMany({ where: { createdById: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await app.close();
  await prisma.$disconnect();
});

describe("auth + games", () => {
  it("health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("регистрация по никнейму без email", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: nick, password: "secret123" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.nickname).toBe(nick);
    cookie = res.headers["set-cookie"] as string;
    expect(cookie).toContain("lotw_session");
  });

  it("повторный никнейм — 409, короткий пароль — 400", async () => {
    const dup = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: nick.toUpperCase(), password: "secret123" } });
    expect(dup.statusCode).toBe(409);
    const bad = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: "x_" + nick, password: "short" } });
    expect(bad.statusCode).toBe(400);
  });

  it("me без cookie — 401, с cookie — 200", async () => {
    expect((await app.inject({ method: "GET", url: "/api/auth/me" })).statusCode).toBe(401);
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.nickname).toBe(nick);
  });

  it("логин с неверным паролем — 401, с верным — 200", async () => {
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { nickname: nick, password: "wrong-one" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { nickname: nick, password: "secret123" } })).statusCode).toBe(200);
  });

  it("создание игры и генерация карты: 66 городов, 3 старта", async () => {
    const created = await app.inject({ method: "POST", url: "/api/games", headers: { cookie }, payload: { name: "Тест", teamCount: 3 } });
    expect(created.statusCode).toBe(201);
    const id = created.json().game.id as string;

    const gen = await app.inject({ method: "POST", url: `/api/games/${id}/generate`, headers: { cookie }, payload: { seed: 42 } });
    expect(gen.statusCode).toBe(200);
    expect(gen.json().seed).toBe(42);
    expect(gen.json().stats.cityCount).toBe(66);

    const map = await app.inject({ method: "GET", url: `/api/games/${id}`, headers: { cookie } });
    expect(map.statusCode).toBe(200);
    const nodes = map.json().nodes as Array<{ kind: string }>;
    expect(nodes.filter((n) => n.kind === "CITY")).toHaveLength(66);
    expect(nodes.filter((n) => n.kind === "START")).toHaveLength(3);

    // Перегенерация с другим seed меняет карту.
    const gen2 = await app.inject({ method: "POST", url: `/api/games/${id}/generate`, headers: { cookie }, payload: { seed: 43 } });
    expect(gen2.json().seed).toBe(43);

    // Чужой пользователь не видит игру.
    const other = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: "o_" + nick, password: "secret123" } });
    const forbidden = await app.inject({ method: "GET", url: `/api/games/${id}`, headers: { cookie: other.headers["set-cookie"] as string } });
    expect(forbidden.statusCode).toBe(403);
    await prisma.user.deleteMany({ where: { nickname: "o_" + nick } });
  });
});

describe("аккаунт", () => {
  it("меняет имя и email, меняет пароль только по текущему", async () => {
    const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: "acc_" + nick, password: "secret123" } });
    const c = reg.headers["set-cookie"] as string;
    const upd = await app.inject({ method: "PATCH", url: "/api/auth/me", headers: { cookie: c }, payload: { displayName: "Стражник", email: `acc_${nick}@example.com` } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().user.displayName).toBe("Стражник");
    const bad = await app.inject({ method: "POST", url: "/api/auth/password", headers: { cookie: c }, payload: { current: "wrong-one", next: "newsecret123" } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/api/auth/password", headers: { cookie: c }, payload: { current: "secret123", next: "newsecret123" } });
    expect(ok.statusCode).toBe(200);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { nickname: "acc_" + nick, password: "newsecret123" } });
    expect(login.statusCode).toBe(200);
    await prisma.user.deleteMany({ where: { nickname: "acc_" + nick } });
  });
});

describe("восстановление пароля", () => {
  it("письмо со ссылкой, новый пароль по ссылке, старые сессии закрыты, ссылка одноразовая", async () => {
    const nick = `fp_${Date.now()}`;
    const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: nick, password: "secret123", email: `${nick}@example.com` } });
    const oldCookie = reg.headers["set-cookie"] as string;
    const unknown = await app.inject({ method: "POST", url: "/api/auth/forgot", payload: { login: "nobody_" + nick } });
    expect(unknown.json()).toEqual({ ok: true, mailEnabled: true });
    const before = outbox.length;
    const res = await app.inject({ method: "POST", url: "/api/auth/forgot", payload: { login: nick.toUpperCase() } });
    expect(res.json().ok).toBe(true);
    expect(outbox.length).toBe(before + 1);
    const mail = outbox[outbox.length - 1]!;
    expect(mail.to).toBe(`${nick}@example.com`);
    const token = /\/reset\/([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    const check = await app.inject({ method: "GET", url: `/api/auth/reset/${token}` });
    expect(check.json()).toEqual({ valid: true, nickname: nick });
    const reset = await app.inject({ method: "POST", url: "/api/auth/reset", payload: { token, password: "newpass123" } });
    expect(reset.statusCode).toBe(200);
    const oldMe = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: oldCookie } });
    expect(oldMe.statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { nickname: nick, password: "newpass123" } });
    expect(login.statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: "/api/auth/reset", payload: { token, password: "another123" } });
    expect(again.statusCode).toBe(400);
    await prisma.user.deleteMany({ where: { nickname: nick } });
  });
});

describe("аналитика суперадмина", () => {
  it("метрики отдаются только суперадмину и содержат группы из документации", async () => {
    const first = await prisma.user.findFirst({ where: { platformRole: "SUPERADMIN" }, select: { nickname: true } });
    const nick = `mt_${Date.now()}`;
    const cookie = (await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: nick, password: "secret123" } })).headers["set-cookie"] as string;
    const denied = await app.inject({ method: "GET", url: "/api/admin/metrics", headers: { cookie } });
    expect(denied.statusCode).toBe(403);
    await prisma.user.update({ where: { nickname: nick }, data: { platformRole: "SUPERADMIN" } });
    const res = await app.inject({ method: "GET", url: "/api/admin/metrics?days=7", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json())).toEqual(expect.arrayContaining(["users", "games", "activity", "battles", "diplomacy", "tech"]));
    expect(res.json().users.total).toBeGreaterThan(0);
    expect(res.json().period.days).toBe(7);
    await prisma.user.deleteMany({ where: { nickname: nick } });
    expect(first === null || first.nickname !== nick).toBe(true);
  });
});
