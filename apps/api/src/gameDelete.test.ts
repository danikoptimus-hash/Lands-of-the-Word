import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, registerVerified } from "./testAuth.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `gda_${stamp}`, playerNick = `gdp_${stamp}`;
let adminCookie = "", playerCookie = "", gameId = "", draftId = "";

async function register(nickname: string) {
  const res = await registerVerified(app, { nickname, password: "secret123" });
  return res.headers["set-cookie"] as string;
}

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick);
  playerCookie = await register(playerNick);
  const g = await app.inject({ method: "POST", url: "/api/games", headers: { cookie: adminCookie }, payload: { name: "Завершённая", teamCount: 2 } });
  gameId = g.json().game.id;
  const t = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name: "Команда" } });
  const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${t.json().team.id}/invites`, headers: { cookie: adminCookie }, payload: { role: "CAPTAIN" } });
  await app.inject({ method: "POST", url: `/api/invites/${inv.json().invite.token}/accept`, headers: { cookie: playerCookie } });
  const d = await app.inject({ method: "POST", url: "/api/games", headers: { cookie: adminCookie }, payload: { name: "Черновик", teamCount: 2 } });
  draftId = d.json().game.id;
});

afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: { in: [gameId, draftId] } } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, playerNick] } } });
  await cleanupFixtures(gameId);
  await app.close();
  await prisma.$disconnect();
});

describe("удаление игры администратором", () => {
  it("завершённая игра исчезает у администратора, но остаётся у участника (решение владельца 03.11)", async () => {
    await prisma.game.update({ where: { id: gameId }, data: { status: "FINISHED", finishedAt: new Date() } });
    const del = await app.inject({ method: "DELETE", url: `/api/games/${gameId}`, headers: { cookie: adminCookie } });
    expect(del.statusCode).toBe(204);
    const mine = await app.inject({ method: "GET", url: "/api/games", headers: { cookie: adminCookie } });
    expect((mine.json().games as Array<{ id: string }>).some((g) => g.id === gameId)).toBe(false);
    expect((await app.inject({ method: "GET", url: `/api/games/${gameId}`, headers: { cookie: adminCookie } })).statusCode).toBe(404);
    const teams = await app.inject({ method: "GET", url: "/api/me/teams", headers: { cookie: playerCookie } });
    expect((teams.json().teams as Array<{ game: { id: string; status: string } }>).find((x) => x.game.id === gameId)?.game.status).toBe("FINISHED");
    const row = await prisma.game.findUnique({ where: { id: gameId }, select: { deletedAt: true } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("черновик стирается целиком", async () => {
    const del = await app.inject({ method: "DELETE", url: `/api/games/${draftId}`, headers: { cookie: adminCookie } });
    expect(del.statusCode).toBe(204);
    expect(await prisma.game.findUnique({ where: { id: draftId } })).toBeNull();
  });
});
