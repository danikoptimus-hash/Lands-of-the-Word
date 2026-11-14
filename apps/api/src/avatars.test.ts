import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AVATAR_CODES, CREST_CODES, avatarImage } from "@lotw/domain";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { registerVerified } from "./testAuth.js";

/**
 * Аватарки и гербы (решение владельца 14.11): только из готового набора игры. Свою аватарку выбирает любой участник,
 * герб команды — только капитан; кода не из набора сервер не принимает, загрузки файлов нет вовсе.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const adminNick = `av_adm_${stamp}`, capNick = `av_cap_${stamp}`, memNick = `av_mem_${stamp}`;
let adminCookie = "", capCookie = "", memCookie = "", gameId = "", teamId = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const put = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "PUT", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });

beforeAll(async () => {
  await app.ready();
  const register = async (nickname: string) => (await registerVerified(app, { nickname, password: "secret123" })).headers["set-cookie"] as string;
  adminCookie = await register(adminNick); capCookie = await register(capNick); memCookie = await register(memNick);
  const g = await post("/api/games", adminCookie, { name: "Аватарки", teamCount: 2 });
  gameId = g.json().game.id;
  const t1 = await post(`/api/games/${gameId}/teams`, adminCookie, { name: "Лица" });
  teamId = t1.json().team.id;
  const inv = await post(`/api/games/${gameId}/teams/${teamId}/invites`, adminCookie, { role: "CAPTAIN" });
  await post(`/api/invites/${inv.json().invite.token}/accept`, capCookie);
  const inv2 = await post(`/api/games/${gameId}/teams/${teamId}/invites`, capCookie, { role: "MEMBER" });
  await post(`/api/invites/${inv2.json().invite.token}/accept`, memCookie);
});
afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, capNick, memNick] } } });
  await app.close(); await prisma.$disconnect();
});

describe("аватарки и гербы из готового набора", () => {
  it("набор: сто аватарок и пятьдесят гербов, у каждого кода — адрес картинки", () => {
    expect(AVATAR_CODES).toHaveLength(100); expect(CREST_CODES).toHaveLength(50);
    expect(AVATAR_CODES[0]).toBe("a001"); expect(AVATAR_CODES[99]).toBe("a100"); expect(CREST_CODES[49]).toBe("g50");
    expect(avatarImage("a017")).toBe("/img/avatars/s/a017.webp"); expect(avatarImage("a017", "lg")).toBe("/img/avatars/a017.webp");
    expect(avatarImage("g05", "lg")).toBe("/img/crests/g05.webp");
    expect(avatarImage("a101")).toBeNull(); expect(avatarImage("чужое")).toBeNull(); expect(avatarImage(null)).toBeNull();
  });

  it("своя аватарка: выбор из набора, замена, снятие; кода не из набора и герба сервер не принимает", async () => {
    const r = await put("/api/auth/me/avatar", memCookie, { avatarId: "a017" });
    expect(r.statusCode).toBe(200); expect(r.json().avatarId).toBe("a017");
    expect((await get("/api/auth/me", memCookie)).json().user.avatarId).toBe("a017");
    // Двое могут выбрать одну и ту же аватарку.
    expect((await put("/api/auth/me/avatar", capCookie, { avatarId: "a017" })).statusCode).toBe(200);
    expect((await put("/api/auth/me/avatar", memCookie, { avatarId: "a100" })).statusCode).toBe(200);
    for (const bad of ["a101", "a000", "g05", "../x", ""]) {
      const no = await put("/api/auth/me/avatar", memCookie, { avatarId: bad });
      expect(no.statusCode).toBe(400);
    }
    expect((await get("/api/auth/me", memCookie)).json().user.avatarId).toBe("a100");
    // В составе команды аватарку видят товарищи.
    const teams = (await get(`/api/games/${gameId}/teams`, capCookie)).json().teams as Array<{ members: Array<{ user: { nickname: string; avatarId: string | null } }> }>;
    expect(teams.flatMap((t) => t.members).find((m) => m.user.nickname === memNick)?.user.avatarId).toBe("a100");
    expect((await put("/api/auth/me/avatar", memCookie, { avatarId: null })).statusCode).toBe(200);
    expect((await get("/api/auth/me", memCookie)).json().user.avatarId).toBeNull();
  });

  it("герб команды: выбирает только капитан и только из гербов", async () => {
    const no = await put(`/api/games/${gameId}/teams/${teamId}/avatar`, memCookie, { avatarId: "g05" });
    expect(no.statusCode).toBe(403);
    const ok = await put(`/api/games/${gameId}/teams/${teamId}/avatar`, capCookie, { avatarId: "g05" });
    expect(ok.statusCode).toBe(200);
    expect((await prisma.team.findUniqueOrThrow({ where: { id: teamId } })).avatarId).toBe("g05");
    expect((await put(`/api/games/${gameId}/teams/${teamId}/avatar`, capCookie, { avatarId: "a017" })).statusCode).toBe(400);
    expect((await put(`/api/games/${gameId}/teams/${teamId}/avatar`, capCookie, { avatarId: "g51" })).statusCode).toBe(400);
    expect((await get(`/api/games/${gameId}/teams`, memCookie)).json().teams[0].avatarId).toBe("g05");
    expect((await put(`/api/games/${gameId}/teams/${teamId}/avatar`, capCookie, { avatarId: null })).statusCode).toBe(200);
    expect((await prisma.team.findUniqueOrThrow({ where: { id: teamId } })).avatarId).toBeNull();
  });

  it("загрузки файлов и раздачи картинок сервером больше нет", async () => {
    expect((await post("/api/auth/me/avatar", memCookie)).statusCode).toBe(404);
    expect((await get("/api/avatars/whatever", memCookie)).statusCode).toBe(404);
    expect((await get("/api/admin/avatars", adminCookie)).statusCode).toBe(404);
  });
});
