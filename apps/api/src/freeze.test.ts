import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";

/** Заморозка взятия дел участнику администратором (решение владельца 21.10): на N дней, снять можно раньше. */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `fz_adm_${stamp}`, cap: `fz_cap_${stamp}`, a: `fz_a_${stamp}`, cap2: `fz_c2_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap: "", a: "", cap2: "" };
const uid: Record<string, string> = {};
let gameId = "", teamId = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) { const r = await registerVerified(app, { nickname: nicks[k], password: "secret123" }); ck[k] = r.headers["set-cookie"] as string; uid[k] = r.json().user.id; }
  gameId = (await post("/api/games", ck.admin, { name: "Заморозка", teamCount: 2 })).json().game.id;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  teamId = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Стражи" })).json().team.id;
  const team2 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Соседи" })).json().team.id;
  const join = async (tid: string, role: "CAPTAIN" | "MEMBER", cookie: string, by: string) => { const inv = await post(`/api/games/${gameId}/teams/${tid}/invites`, by, { role }); await post(`/api/invites/${inv.json().invite.token}/accept`, cookie); };
  await join(teamId, "CAPTAIN", ck.cap, ck.admin); await join(teamId, "MEMBER", ck.a, ck.cap); await join(team2, "CAPTAIN", ck.cap2, ck.admin);
  await post(`/api/games/${gameId}/deeds/import-default`, ck.admin);
  await readyForStart(app, gameId, ck.admin);
  await setGamePhase(app, gameId, ck.admin, "day");
  const st = await post(`/api/games/${gameId}/start`, ck.admin); expect(st.statusCode, st.body).toBe(200);
});
afterAll(async () => { await cleanupFixtures(gameId); await prisma.game.deleteMany({ where: { id: gameId } }); await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } }); await app.close(); });

describe("заморозка взятия дел", () => {
  it("капитан не может; администратор закрывает на 3 дня — взять нельзя, дата видна команде; открыл — можно", async () => {
    const url = `/api/games/${gameId}/teams/${teamId}/members/${uid.a}/freeze`;
    expect((await post(url, ck.cap, { days: 3 })).statusCode).toBe(403);
    const fr = await post(url, ck.admin, { days: 3 });
    expect(fr.statusCode, fr.body).toBe(200);
    const until = Date.parse(fr.json().until);
    expect(until - Date.now()).toBeGreaterThan(2.9 * 86_400_000);
    // Участник видит причину в карте и не может взять дело.
    const map = (await get(`/api/games/${gameId}/my-map`, ck.a)).json() as { deedsFrozenUntil: string | null; tasks: Array<{ id: string; status: string }> };
    expect(map.deedsFrozenUntil && Date.parse(map.deedsFrozenUntil)).toBe(until);
    const open = map.tasks.find((tk) => tk.status === "OPEN")!;
    const take = await post(`/api/games/${gameId}/edge-tasks/${open.id}/take`, ck.a);
    expect(take.statusCode).toBe(409);
    expect(take.json().error).toBe("frozen");
    // Команда видит дату на значке участника.
    const teams = (await get(`/api/games/${gameId}/teams`, ck.cap)).json().teams as Array<{ id: string; members: Array<{ user: { id: string }; deedsFrozenUntil: string | null }> }>;
    const a = teams.find((tm) => tm.id === teamId)!.members.find((m) => m.user.id === uid.a)!;
    expect(a.deedsFrozenUntil && Date.parse(a.deedsFrozenUntil)).toBe(until);
    // Разморозка раньше срока: капитан не может, администратор — да; после неё дело берётся.
    expect((await app.inject({ method: "DELETE", url, headers: { cookie: ck.cap } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url, headers: { cookie: ck.admin } })).statusCode).toBe(200);
    const take2 = await post(`/api/games/${gameId}/edge-tasks/${open.id}/take`, ck.a);
    expect(take2.statusCode, take2.body).toBe(200);
    expect((await post(url, ck.admin, { days: 0 })).statusCode).toBe(400);
  });
});
