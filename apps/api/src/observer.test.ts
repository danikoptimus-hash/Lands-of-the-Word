import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, registerVerified } from "./testAuth.js";

/**
 * Наблюдатель (решение владельца 14.10): администратор платформы видит чужую игру глазами администратора,
 * но только на чтение — запросы на изменение отклоняются, в списке администраторов игры его нет.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `ob_adm_${stamp}`, sup: `ob_sup_${stamp}`, user: `ob_usr_${stamp}` };
const ck = { admin: "", sup: "", user: "" };
let gameId = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const patch = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "PATCH", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const register = async (nickname: string) => (await registerVerified(app, { nickname, password: "secret123" })).headers["set-cookie"] as string;
beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) ck[k] = await register(nicks[k]);
  await prisma.user.updateMany({ where: { nickname: nicks.sup }, data: { platformRole: "SUPERADMIN" } });
  const g = await post("/api/games", ck.admin, { name: "Наблюдение", teamCount: 2 });
  gameId = g.json().game.id;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Пахари" });
});
afterAll(async () => {
  await cleanupFixtures(gameId);
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } });
  await app.close();
});

describe("наблюдатель", () => {
  it("администратор платформы читает чужую игру как её администратор, а обычный пользователь — нет", async () => {
    const r = await get(`/api/games/${gameId}`, ck.sup);
    expect(r.statusCode).toBe(200);
    expect(r.json().observer).toBe(true);
    expect((await get(`/api/games/${gameId}`, ck.admin)).json().observer).toBe(false);
    expect((await get(`/api/games/${gameId}`, ck.user)).statusCode).toBe(403);
    const teams = await get(`/api/games/${gameId}/teams`, ck.sup);
    expect(teams.statusCode).toBe(200); expect(teams.json().teams).toHaveLength(1);
    expect((await get(`/api/games/${gameId}/deeds`, ck.sup)).statusCode).toBe(200);
    expect((await get(`/api/games/${gameId}/recipients`, ck.sup)).statusCode).toBe(200);
    expect((await get(`/api/games/${gameId}/progress`, ck.sup)).statusCode).toBe(200);
  });
  it("менять ничего не может и в администраторах игры не значится", async () => {
    expect((await patch(`/api/games/${gameId}`, ck.sup, { name: "Чужое имя" })).statusCode).toBe(403);
    expect((await post(`/api/games/${gameId}/teams`, ck.sup, { name: "Лишняя" })).statusCode).toBe(403);
    expect((await post(`/api/games/${gameId}/deeds/import-default`, ck.sup)).statusCode).toBe(403);
    const admins = (await get(`/api/games/${gameId}/admins`, ck.admin)).json().admins as Array<{ nickname: string }>;
    expect(admins.map((a) => a.nickname)).not.toContain(nicks.sup);
    expect((await get(`/api/games/${gameId}`, ck.admin)).json().game.name).toBe("Наблюдение");
  });
  it("список всех игр: только администратору платформы, игра в списке с числом команд", async () => {
    expect((await get("/api/admin/games", ck.admin)).statusCode).toBe(403);
    const r = await get("/api/admin/games", ck.sup);
    expect(r.statusCode).toBe(200);
    const row = (r.json().games as Array<{ id: string; teams: number; status: string; activity: number }>).find((g) => g.id === gameId);
    expect(row?.teams).toBe(1); expect(row?.status).toBe("DRAFT");
  });
});
