import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { registerVerified } from "./testAuth.js";
import { exchangeCode, verifyIdToken } from "./services/google.js";

// Сетевые вызовы к Google подменяются: тест управляет тем, что «ответил» Google.
vi.mock("./services/google.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/google.js")>();
  return { ...actual, exchangeCode: vi.fn(), verifyIdToken: vi.fn() };
});
const mockExchange = vi.mocked(exchangeCode);
const mockVerify = vi.mocked(verifyIdToken);

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const plain = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please", GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "test-client-secret" });
// Никнейм не длиннее 24 символов, поэтому хвост из времени укорочен.
const nick = "gt_" + String(Date.now()).slice(-8);
const subs = { fresh: `sub_${nick}_1`, byMail: `sub_${nick}_2` };

beforeAll(async () => { await plain.ready(); await app.ready(); });
afterAll(async () => {
  await prisma.user.deleteMany({ where: { OR: [{ nickname: { startsWith: nick } }, { googleId: { startsWith: `sub_${nick}` } }] } });
  await plain.close(); await app.close();
  await prisma.$disconnect();
});

/** Все cookie из set-cookie в виде заголовка Cookie для следующего запроса. */
function cookiesOf(res: LightMyRequestResponse, extra = ""): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const pairs = list.map((c) => c.split(";")[0]!).filter((c) => !c.endsWith("="));
  return [extra, ...pairs].filter(Boolean).join("; ");
}
/** Начало входа: state из адреса редиректа и cookie состояния. */
async function start(query = "", cookie = "") {
  const res = await app.inject({ method: "GET", url: `/api/auth/google${query}`, headers: cookie ? { cookie } : {} });
  expect(res.statusCode).toBe(302);
  const state = new URL(res.headers.location as string).searchParams.get("state")!;
  return { state, cookie: cookiesOf(res, cookie) };
}
function googleSays(sub: string, email: string, over: Partial<Awaited<ReturnType<typeof verifyIdToken>>> = {}) {
  mockExchange.mockResolvedValueOnce({ id_token: "id-token-" + sub });
  mockVerify.mockResolvedValueOnce({ sub, email, email_verified: "true", aud: CLIENT_ID, iss: "https://accounts.google.com", exp: String(Math.floor(Date.now() / 1000) + 3600), ...over });
}

describe("вход через Google", () => {
  it("без настройки: providers.google=false, старт входа — 404", async () => {
    expect((await plain.inject({ method: "GET", url: "/api/auth/providers" })).json()).toEqual({ google: false });
    const res = await plain.inject({ method: "GET", url: "/api/auth/google" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_configured");
  });

  it("с настройкой: providers.google=true, старт — 302 к Google с state в подписанном cookie", async () => {
    expect((await app.inject({ method: "GET", url: "/api/auth/providers" })).json()).toEqual({ google: true });
    const res = await app.inject({ method: "GET", url: "/api/auth/google?next=%2Fgames%2Fabc" });
    expect(res.statusCode).toBe(302);
    const url = new URL(res.headers.location as string);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/google/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toContain("lotw_gstate=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("callback с чужим state — редирект /login?google=state; без cookie — тоже", async () => {
    const { cookie } = await start();
    const res = await app.inject({ method: "GET", url: "/api/auth/google/callback?code=abc&state=wrong", headers: { cookie } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/login?google=state");
    const noCookie = await app.inject({ method: "GET", url: "/api/auth/google/callback?code=abc&state=wrong" });
    expect(noCookie.headers.location).toBe("/login?google=state");
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("id_token с чужим aud или неподтверждённой почтой отклоняется", async () => {
    const s1 = await start();
    googleSays(subs.fresh, `${nick}@example.com`, { aud: "other-client" });
    expect((await app.inject({ method: "GET", url: `/api/auth/google/callback?code=c&state=${s1.state}`, headers: { cookie: s1.cookie } })).headers.location).toBe("/login?google=error");
    const s2 = await start();
    googleSays(subs.fresh, `${nick}@example.com`, { email_verified: "false" });
    expect((await app.inject({ method: "GET", url: `/api/auth/google/callback?code=c&state=${s2.state}`, headers: { cookie: s2.cookie } })).headers.location).toBe("/login?google=error");
    expect(await prisma.user.findUnique({ where: { googleId: subs.fresh } })).toBeNull();
  });

  it("новая почта: /google/nickname с pending-cookie, затем complete создаёт учётку с googleId и подтверждённой почтой", async () => {
    const email = `${nick}@example.com`;
    const { state, cookie } = await start("?next=%2F");
    googleSays(subs.fresh, email.toUpperCase());
    const cb = await app.inject({ method: "GET", url: `/api/auth/google/callback?code=the-code&state=${state}`, headers: { cookie } });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe("/google/nickname");
    expect(mockExchange).toHaveBeenCalledWith("the-code", CLIENT_ID, "test-client-secret", "http://localhost:3000/api/auth/google/callback");
    const pendingCookie = cookiesOf(cb);
    expect(pendingCookie).toContain("lotw_gpending=");
    expect(pendingCookie).not.toContain("lotw_session=");
    // Без cookie — 404; с cookie — почта.
    expect((await app.inject({ method: "GET", url: "/api/auth/google/pending" })).statusCode).toBe(404);
    const pending = await app.inject({ method: "GET", url: "/api/auth/google/pending", headers: { cookie: pendingCookie } });
    expect(pending.statusCode).toBe(200);
    expect(pending.json()).toEqual({ email });
    // Плохой ник — 400, занятый — 409 (проверяется в отдельном тесте), нормальный — 201 с сессией.
    expect((await app.inject({ method: "POST", url: "/api/auth/google/complete", headers: { cookie: pendingCookie }, payload: { nickname: "a b" } })).statusCode).toBe(400);
    const done = await app.inject({ method: "POST", url: "/api/auth/google/complete", headers: { cookie: pendingCookie }, payload: { nickname: nick, locale: "en" } });
    expect(done.statusCode).toBe(201);
    expect(done.json().user).toMatchObject({ nickname: nick, email, emailVerified: true, googleLinked: true, locale: "en" });
    const session = cookiesOf(done);
    expect(session).toContain("lotw_session=");
    expect(session).not.toContain("lotw_gpending=");
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: session } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.googleLinked).toBe(true);
    const db = await prisma.user.findUniqueOrThrow({ where: { googleId: subs.fresh } });
    expect(db.nickname).toBe(nick);
    expect(db.emailVerified).toBe(true);
    // Играть можно сразу: почта подтверждена Google.
    expect((await app.inject({ method: "GET", url: "/api/games", headers: { cookie: session } })).statusCode).toBe(200);
    // Повторный complete с той же pending-cookie — уже занято.
    expect((await app.inject({ method: "POST", url: "/api/auth/google/complete", headers: { cookie: pendingCookie }, payload: { nickname: nick + "_x" } })).statusCode).toBe(409);
  });

  it("повторный вход по тому же sub — сразу сессия и редирект на next; чужой next режется до «/»", async () => {
    const { state, cookie } = await start("?next=https%3A%2F%2Fevil.example%2Fx");
    googleSays(subs.fresh, `${nick}@example.com`);
    const cb = await app.inject({ method: "GET", url: `/api/auth/google/callback?code=c&state=${state}`, headers: { cookie } });
    expect(cb.headers.location).toBe("/");
    expect(cookiesOf(cb)).toContain("lotw_session=");
    const { state: s2, cookie: c2 } = await start("?next=%2Fgames%2Fnew");
    googleSays(subs.fresh, `${nick}@example.com`);
    expect((await app.inject({ method: "GET", url: `/api/auth/google/callback?code=c&state=${s2}`, headers: { cookie: c2 } })).headers.location).toBe("/games/new");
  });

  it("занятый никнейм при complete — 409", async () => {
    const { state, cookie } = await start();
    googleSays(`sub_${nick}_9`, `${nick}_other@example.com`);
    const cb = await app.inject({ method: "GET", url: `/api/auth/google/callback?code=c&state=${state}`, headers: { cookie } });
    expect(cb.headers.location).toBe("/google/nickname");
    const res = await app.inject({ method: "POST", url: "/api/auth/google/complete", headers: { cookie: cookiesOf(cb) }, payload: { nickname: nick.toUpperCase() } });
    expect(res.statusCode).toBe(409);
  });

  it("учётка с такой почтой уже есть: вход и привязка googleId, почта становится подтверждённой", async () => {
    const n2 = `${nick}_mail`;
    const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: n2, password: "secret123", email: `${n2}@example.com` } });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().user.emailVerified).toBe(false);
    const { state, cookie } = await start("?next=%2Fgames");
    googleSays(subs.byMail, `${n2.toUpperCase()}@Example.com`);
    const cb = await app.inject({ method: "GET", url: `/api/auth/google/callback?code=c&state=${state}`, headers: { cookie } });
    expect(cb.headers.location).toBe("/games");
    const session = cookiesOf(cb);
    expect(session).toContain("lotw_session=");
    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: session } });
    expect(me.json().user).toMatchObject({ nickname: n2, emailVerified: true, googleLinked: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { googleId: subs.byMail } })).nickname).toBe(n2);
    // Вход по паролю остаётся.
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { nickname: n2, password: "secret123" } })).statusCode).toBe(200);
  });
});
