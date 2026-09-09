import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `adm_${stamp}`, playerNick = `pl_${stamp}`, otherNick = `ot_${stamp}`;
let adminCookie = "", playerCookie = "", otherCookie = "", gameId = "", teamId = "", token = "";

async function register(nickname: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname, password: "secret123" } });
  return res.headers["set-cookie"] as string;
}

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick);
  playerCookie = await register(playerNick);
  otherCookie = await register(otherNick);
  const g = await app.inject({ method: "POST", url: "/api/games", headers: { cookie: adminCookie }, payload: { name: "Командная", teamCount: 2 } });
  gameId = g.json().game.id;
});

afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, playerNick, otherNick] } } });
  await app.close();
  await prisma.$disconnect();
});

describe("команды и приглашения", () => {
  it("админ создаёт команду; не больше teamCount; имена уникальны", async () => {
    const t1 = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name: "Иерусалим" } });
    expect(t1.statusCode).toBe(201);
    teamId = t1.json().team.id;
    expect(t1.json().team.index).toBe(0);
    const dup = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name: "иерусалим" } });
    expect(dup.statusCode).toBe(409);
    const t2 = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name: "Вифлеем" } });
    expect(t2.statusCode).toBe(201);
    const t3 = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name: "Третья" } });
    expect(t3.statusCode).toBe(409);
  });

  it("не админ не может создавать команды", async () => {
    const res = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: playerCookie }, payload: { name: "Чужая" } });
    expect(res.statusCode).toBe(403);
  });

  it("приглашение: создать, посмотреть, принять; повторно — 409", async () => {
    const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${teamId}/invites`, headers: { cookie: adminCookie }, payload: { role: "CAPTAIN", uses: 2 } });
    expect(inv.statusCode).toBe(201);
    token = inv.json().invite.token;
    const info = await app.inject({ method: "GET", url: `/api/invites/${token}`, headers: { cookie: playerCookie } });
    expect(info.statusCode).toBe(200);
    expect(info.json().invite.team.name).toBe("Иерусалим");
    const acc = await app.inject({ method: "POST", url: `/api/invites/${token}/accept`, headers: { cookie: playerCookie } });
    expect(acc.statusCode).toBe(201);
    expect(acc.json().role).toBe("CAPTAIN");
    const again = await app.inject({ method: "POST", url: `/api/invites/${token}/accept`, headers: { cookie: playerCookie } });
    expect(again.statusCode).toBe(409);
    const bad = await app.inject({ method: "GET", url: `/api/invites/nope`, headers: { cookie: playerCookie } });
    expect(bad.statusCode).toBe(404);
  });

  it("участник видит только свою команду, админ — все", async () => {
    const mine = await app.inject({ method: "GET", url: `/api/games/${gameId}/teams`, headers: { cookie: playerCookie } });
    expect(mine.json().isAdmin).toBe(false);
    expect(mine.json().teams).toHaveLength(1);
    const all = await app.inject({ method: "GET", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie } });
    expect(all.json().teams).toHaveLength(2);
    const none = await app.inject({ method: "GET", url: `/api/games/${gameId}/teams`, headers: { cookie: otherCookie } });
    expect(none.statusCode).toBe(403);
  });

  it("капитан раздаёт игровые роли, одна роль — один человек", async () => {
    await app.inject({ method: "POST", url: `/api/invites/${token}/accept`, headers: { cookie: otherCookie } });
    const other = await prisma.user.findUniqueOrThrow({ where: { nickname: otherNick } });
    const player = await prisma.user.findUniqueOrThrow({ where: { nickname: playerNick } });
    const r1 = await app.inject({ method: "PATCH", url: `/api/games/${gameId}/teams/${teamId}/members/${player.id}`, headers: { cookie: playerCookie }, payload: { gameRole: "SCOUT" } });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({ method: "PATCH", url: `/api/games/${gameId}/teams/${teamId}/members/${other.id}`, headers: { cookie: playerCookie }, payload: { gameRole: "SCOUT" } });
    expect(r2.statusCode).toBe(200);
    const teams = await app.inject({ method: "GET", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie } });
    const members = teams.json().teams[0].members as Array<{ user: { nickname: string }; gameRole: string }>;
    expect(members.filter((m) => m.gameRole === "SCOUT")).toHaveLength(1);
    // Рядовой участник не может назначать капитана.
    const forb = await app.inject({ method: "PATCH", url: `/api/games/${gameId}/teams/${teamId}/members/${other.id}`, headers: { cookie: otherCookie }, payload: { role: "CAPTAIN" } });
    expect(forb.statusCode).toBe(403);
  });

  it("мои команды", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/teams", headers: { cookie: playerCookie } });
    expect(res.json().teams[0].team.name).toBe("Иерусалим");
    expect(res.json().teams[0].role).toBe("CAPTAIN");
  });
});
