import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { registerVerified } from "./testAuth.js";

/** Пояс новой игры — пояс устройства создателя (решение владельца 19.10); чужой или битый пояс не принимается. */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const nick = `tz_adm_${Date.now() % 100000}`;
let ck = ""; const ids: string[] = [];
const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: { cookie: ck }, payload: payload as Record<string, unknown> });
beforeAll(async () => { await app.ready(); ck = (await registerVerified(app, { nickname: nick, password: "secret123" })).headers["set-cookie"] as string; });
afterAll(async () => { await prisma.game.deleteMany({ where: { id: { in: ids } } }); await prisma.user.deleteMany({ where: { nickname: nick } }); await app.close(); });

describe("часовой пояс новой игры", () => {
  it("берётся из запроса создателя", async () => {
    const r = await post("/api/games", { name: "Подольск", teamCount: 2, timeZone: "Europe/Moscow" });
    expect(r.statusCode).toBe(201); ids.push(r.json().game.id);
    const g = await app.inject({ method: "GET", url: `/api/games/${r.json().game.id}`, headers: { cookie: ck } });
    expect(g.json().game.settings.rules.timeZone).toBe("Europe/Moscow");
  });
  it("без пояса или с выдуманным — прежний по умолчанию", async () => {
    for (const body of [{ name: "Без пояса", teamCount: 2 }, { name: "Кривой пояс", teamCount: 2, timeZone: "Mars/Olympus" }]) {
      const r = await post("/api/games", body); expect(r.statusCode).toBe(201); ids.push(r.json().game.id);
      const g = await app.inject({ method: "GET", url: `/api/games/${r.json().game.id}`, headers: { cookie: ck } });
      expect(g.json().game.settings.rules.timeZone).toBe("Asia/Tashkent");
    }
  });
});
