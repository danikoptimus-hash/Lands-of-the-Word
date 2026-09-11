import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { pushOutbox } from "./services/push.js";
import { notifyAdmins } from "./services/notify.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
let cookie = "", gameId = "";
const endpoint = `https://push.example.com/send/${stamp}`;

beforeAll(async () => {
  await app.ready();
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: `push_${stamp}`, password: "secret123", locale: "en" } });
  cookie = res.headers["set-cookie"] as string;
  const g = await app.inject({ method: "POST", url: "/api/games", headers: { cookie }, payload: { name: "Push", teamCount: 2 } });
  gameId = g.json().game.id;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

describe("push-уведомления", () => {
  it("публичный ключ VAPID создаётся сервером и хранится в базе", async () => {
    const r = await app.inject({ method: "GET", url: "/api/push/key", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().key.length).toBeGreaterThan(60);
    expect((await prisma.appSetting.findUnique({ where: { key: "vapid.public" } }))?.value).toBe(r.json().key);
    expect((await app.inject({ method: "GET", url: "/api/push/key" })).statusCode).toBe(401);
  });

  it("подписка сохраняется за пользователем, повтор не дублирует, отписка удаляет", async () => {
    const body = { endpoint, keys: { p256dh: "p256dh-key", auth: "auth-key" } };
    expect((await app.inject({ method: "POST", url: "/api/push/subscribe", headers: { cookie }, payload: body })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/push/subscribe", headers: { cookie }, payload: body })).statusCode).toBe(201);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(1);
    const bad = await app.inject({ method: "POST", url: "/api/push/subscribe", headers: { cookie }, payload: { endpoint: "not-a-url", keys: body.keys } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: "/api/push/subscribe", headers: { cookie }, payload: { endpoint } })).statusCode).toBe(200);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(0);
  });

  it("уведомление уходит push-ем на языке получателя вместе с письмом", async () => {
    pushOutbox.length = 0;
    const me = (await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })).json().user.id as string;
    notifyAdmins(gameId, "новая сдача дела", "Команда «{team}» сдала дело «{deed}»{donation}. Нужно проверить и одобрить или вернуть.", { team: "Львы", deed: "Дрова", donation: "" });
    for (let i = 0; i < 50 && pushOutbox.length < 1; i++) await new Promise((r) => setTimeout(r, 20));
    const p = pushOutbox.find((x) => x.userId === me);
    expect(p?.payload.title).toBe("a new deed submission");
    expect(p?.payload.body).toContain("Team “Львы” submitted the deed “Дрова”");
    expect(p?.payload.url).toContain(`/games/${gameId}`);
    const test = await app.inject({ method: "POST", url: "/api/push/test", headers: { cookie } });
    expect(test.statusCode).toBe(200);
    expect(pushOutbox.at(-1)?.payload.body).toContain("Notifications are on");
  });
});
