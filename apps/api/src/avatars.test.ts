import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { registerVerified } from "./testAuth.js";
import { setModerationForTests } from "./services/avatars.js";

/**
 * Аватарки (решение владельца 24.10): своя — любой участник, командная — только капитан; каждая проверяется на
 * уместность (здесь проверка подменена), неуместная отклоняется; суперадмин снимает любую и запрещает загрузившему.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const adminNick = `av_adm_${stamp}`, capNick = `av_cap_${stamp}`, memNick = `av_mem_${stamp}`, superNick = `av_sup_${stamp}`;
let adminCookie = "", capCookie = "", memCookie = "", superCookie = "", gameId = "", teamId = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
let flagNext = false;

async function png(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: color } }).png().toBuffer();
}
/** multipart/form-data с одним файлом. */
function upload(url: string, cookie: string, file: Buffer, type = "image/png") {
  const boundary = "----lotw" + stamp;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: ${type}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return app.inject({ method: "POST", url, headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([head, file, tail]) });
}

beforeAll(async () => {
  await app.ready();
  setModerationForTests(async () => ({ flagged: flagNext, categories: flagNext ? { violence: 0.9 } : {} }));
  const register = async (nickname: string) => (await registerVerified(app, { nickname, password: "secret123" })).headers["set-cookie"] as string;
  adminCookie = await register(adminNick); capCookie = await register(capNick); memCookie = await register(memNick); superCookie = await register(superNick);
  await prisma.user.update({ where: { nickname: superNick }, data: { platformRole: "SUPERADMIN" } });
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
  setModerationForTests(null);
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, capNick, memNick, superNick] } } });
  await app.close(); await prisma.$disconnect();
});

describe("аватарки", () => {
  it("своя аватарка: загрузка, сжатие до WebP 256×256, показ, замена, снятие", async () => {
    const r = await upload("/api/auth/me/avatar", memCookie, await png({ r: 200, g: 50, b: 50 }));
    expect(r.statusCode).toBe(201);
    const id = r.json().avatarId as string;
    expect((await get("/api/auth/me", memCookie)).json().user.avatarId).toBe(id);
    const img = await get(`/api/avatars/${id}`, capCookie);
    expect(img.statusCode).toBe(200); expect(img.headers["content-type"]).toBe("image/webp");
    const meta = await sharp(img.rawPayload).metadata();
    expect(meta.width).toBe(256); expect(meta.height).toBe(256);
    // В составе команды у участника виден id аватарки.
    const teams = (await get(`/api/games/${gameId}/teams`, capCookie)).json().teams as Array<{ members: Array<{ user: { nickname: string; avatarId: string | null } }> }>;
    expect(teams[0]!.members.find((m) => m.user.nickname === memNick)!.user.avatarId).toBe(id);
    // Замена: старая картинка удаляется.
    const r2 = await upload("/api/auth/me/avatar", memCookie, await png({ r: 50, g: 200, b: 50 }));
    expect(r2.statusCode).toBe(201);
    expect((await get(`/api/avatars/${id}`, capCookie)).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/api/auth/me/avatar", headers: { cookie: memCookie } })).statusCode).toBe(204);
    expect((await get("/api/auth/me", memCookie)).json().user.avatarId).toBeNull();
  });

  it("неуместное фото отклоняется; не картинка — 400", async () => {
    flagNext = true;
    const r = await upload("/api/auth/me/avatar", memCookie, await png({ r: 0, g: 0, b: 0 }));
    flagNext = false;
    expect(r.statusCode).toBe(422);
    expect((await upload("/api/auth/me/avatar", memCookie, Buffer.from("not an image"), "text/plain")).statusCode).toBe(400);
  });

  it("аватарку команды ставит только капитан", async () => {
    expect((await upload(`/api/games/${gameId}/teams/${teamId}/avatar`, memCookie, await png({ r: 10, g: 10, b: 200 }))).statusCode).toBe(403);
    const r = await upload(`/api/games/${gameId}/teams/${teamId}/avatar`, capCookie, await png({ r: 10, g: 10, b: 200 }));
    expect(r.statusCode).toBe(201);
    const team = (await get(`/api/games/${gameId}/teams`, memCookie)).json().teams[0] as { avatarId: string | null };
    expect(team.avatarId).toBe(r.json().avatarId);
  });

  it("суперадмин видит последние аватарки, снимает командную и запрещает капитану", async () => {
    expect((await get("/api/admin/avatars", capCookie)).statusCode).toBe(403);
    const list = (await get("/api/admin/avatars", superCookie)).json().avatars as Array<{ id: string; team: { id: string } | null; uploadedBy: { nickname: string } | null }>;
    const teamAvatar = list.find((a) => a.team?.id === teamId)!;
    expect(teamAvatar.uploadedBy?.nickname).toBe(capNick);
    expect((await app.inject({ method: "DELETE", url: `/api/admin/avatars/${teamAvatar.id}?block=1`, headers: { cookie: superCookie } })).statusCode).toBe(204);
    expect((await get(`/api/games/${gameId}/teams`, memCookie)).json().teams[0].avatarId).toBeNull();
    expect((await upload(`/api/games/${gameId}/teams/${teamId}/avatar`, capCookie, await png({ r: 1, g: 2, b: 3 }))).statusCode).toBe(403);
    expect((await get("/api/auth/me", capCookie)).json().user.avatarBlocked).toBe(true);
    expect((await post(`/api/admin/avatars/unblock/${(await get("/api/auth/me", capCookie)).json().user.id}`, superCookie)).statusCode).toBe(200);
    expect((await upload(`/api/games/${gameId}/teams/${teamId}/avatar`, capCookie, await png({ r: 1, g: 2, b: 3 }))).statusCode).toBe(201);
  });
});
