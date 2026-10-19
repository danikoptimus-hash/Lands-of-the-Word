import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";

/** Лимит смены роли — на каждого участника (решение владельца 19.10), а не на команду. */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `rc_adm_${stamp}`, cap: `rc_cap_${stamp}`, a: `rc_a_${stamp}`, b: `rc_b_${stamp}`, cap2: `rc_c2_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap: "", a: "", b: "", cap2: "" };
const uid: Record<string, string> = {};
let gameId = "", teamId = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const patch = (url: string, cookie: string, payload: unknown) => app.inject({ method: "PATCH", url, headers: { cookie }, payload: payload as Record<string, unknown> });
beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) { const r = await registerVerified(app, { nickname: nicks[k], password: "secret123" }); ck[k] = r.headers["set-cookie"] as string; uid[k] = r.json().user.id; }
  gameId = (await post("/api/games", ck.admin, { name: "Роли", teamCount: 2 })).json().game.id;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  teamId = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Стражи" })).json().team.id;
  const team2 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Соседи" })).json().team.id;
  const join = async (tid: string, role: "CAPTAIN" | "MEMBER", cookie: string, by: string) => { const inv = await post(`/api/games/${gameId}/teams/${tid}/invites`, by, { role }); await post(`/api/invites/${inv.json().invite.token}/accept`, cookie); };
  await join(teamId, "CAPTAIN", ck.cap, ck.admin); await join(teamId, "MEMBER", ck.a, ck.cap); await join(teamId, "MEMBER", ck.b, ck.cap); await join(team2, "CAPTAIN", ck.cap2, ck.admin);
  await prisma.membership.updateMany({ where: { teamId, userId: uid.a }, data: { gameRole: "SCOUT" } });
  await prisma.membership.updateMany({ where: { teamId, userId: uid.b }, data: { gameRole: "PROPHET" } });
  await post(`/api/games/${gameId}/deeds/import-default`, ck.admin);
  await readyForStart(app, gameId, ck.admin);
  await setGamePhase(app, gameId, ck.admin, "day");
  const st = await post(`/api/games/${gameId}/start`, ck.admin); expect(st.statusCode, st.body).toBe(200);
});
afterAll(async () => { await cleanupFixtures(gameId); await prisma.game.deleteMany({ where: { id: gameId } }); await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } }); await app.close(); });

describe("лимит смены роли", () => {
  it("смена роли одному не мешает сменить роль другому, повторная смена тому же — ждёт", async () => {
    expect((await patch(`/api/games/${gameId}/teams/${teamId}/members/${uid.a}`, ck.cap, { gameRole: "PROPHET" })).statusCode).toBe(200);
    expect((await patch(`/api/games/${gameId}/teams/${teamId}/members/${uid.b}`, ck.cap, { gameRole: "SCOUT" })).statusCode).toBe(200);
    const again = await patch(`/api/games/${gameId}/teams/${teamId}/members/${uid.a}`, ck.cap, { gameRole: "WARRIOR" });
    expect(again.statusCode).toBe(429);
    const teams = (await app.inject({ method: "GET", url: `/api/games/${gameId}/teams`, headers: { cookie: ck.cap } })).json().teams as Array<{ members: Array<{ user: { id: string }; roleChangeAvailableAt: string | null }> }>;
    const a = teams[0]!.members.find((m) => m.user.id === uid.a)!;
    expect(a.roleChangeAvailableAt && Date.parse(a.roleChangeAvailableAt) > Date.now()).toBe(true);
  });
});
