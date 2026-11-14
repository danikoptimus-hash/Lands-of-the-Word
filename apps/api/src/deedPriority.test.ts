import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";

/**
 * Приоритет капитана (решение владельца 14.11): капитан или заместитель отмечает дело команды приоритетным — свиток
 * на карте у всей команды горит. Участник отметить не может; принятое дело отметку теряет.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `pr_adm_${stamp}`, cap: `pr_cap_${stamp}`, dep: `pr_dep_${stamp}`, a: `pr_a_${stamp}`, cap2: `pr_c2_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap: "", dep: "", a: "", cap2: "" };
const uid: Record<string, string> = {};
let gameId = "", teamId = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
type MapTask = { id: string; status: string; priorityAt: string | null; priorityById: string | null };
const tasksOf = async (cookie: string) => ((await get(`/api/games/${gameId}/my-map`, cookie)).json() as { tasks: MapTask[] }).tasks;
beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) { const r = await registerVerified(app, { nickname: nicks[k], password: "secret123" }); ck[k] = r.headers["set-cookie"] as string; uid[k] = r.json().user.id; }
  gameId = (await post("/api/games", ck.admin, { name: "Приоритет", teamCount: 2 })).json().game.id;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  teamId = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Стражи" })).json().team.id;
  const team2 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Соседи" })).json().team.id;
  const join = async (tid: string, role: "CAPTAIN" | "MEMBER", cookie: string, by: string) => { const inv = await post(`/api/games/${gameId}/teams/${tid}/invites`, by, { role }); await post(`/api/invites/${inv.json().invite.token}/accept`, cookie); };
  await join(teamId, "CAPTAIN", ck.cap, ck.admin); await join(teamId, "MEMBER", ck.dep, ck.cap); await join(teamId, "MEMBER", ck.a, ck.cap); await join(team2, "CAPTAIN", ck.cap2, ck.admin);
  await prisma.membership.updateMany({ where: { teamId, userId: uid.dep }, data: { role: "DEPUTY" } });
  await post(`/api/games/${gameId}/deeds/import-default`, ck.admin);
  await readyForStart(app, gameId, ck.admin);
  await setGamePhase(app, gameId, ck.admin, "day");
  const st = await post(`/api/games/${gameId}/start`, ck.admin); expect(st.statusCode, st.body).toBe(200);
});
afterAll(async () => { await cleanupFixtures(gameId); await prisma.game.deleteMany({ where: { id: gameId } }); await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } }); await app.close(); });

describe("приоритет капитана у дела", () => {
  it("участник не может; капитан отмечает — видит вся команда; заместитель снимает; чужая команда не может", async () => {
    const open = (await tasksOf(ck.a)).filter((tk) => tk.status === "OPEN");
    expect(open.length).toBeGreaterThan(0);
    const task = open[0]!;
    expect(task.priorityAt).toBeNull();
    const url = `/api/games/${gameId}/edge-tasks/${task.id}/priority`;
    expect((await post(url, ck.a, { on: true })).statusCode).toBe(403);
    expect((await post(url, ck.cap2, { on: true })).statusCode).toBe(404); // дело чужой команды
    const on = await post(url, ck.cap, { on: true });
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json().task.priorityById).toBe(uid.cap);
    // Участник видит отметку в своей карте; взять дело может как обычно.
    const seen = (await tasksOf(ck.a)).find((tk) => tk.id === task.id)!;
    expect(seen.priorityAt).not.toBeNull();
    expect(seen.priorityById).toBe(uid.cap);
    expect((await post(`/api/games/${gameId}/edge-tasks/${task.id}/take`, ck.a)).statusCode).toBe(200);
    expect((await tasksOf(ck.a)).find((tk) => tk.id === task.id)!.priorityAt).not.toBeNull(); // взятое дело остаётся приоритетным
    // Заместитель снимает отметку.
    const off = await post(url, ck.dep, { on: false });
    expect(off.statusCode, off.body).toBe(200);
    expect((await tasksOf(ck.a)).find((tk) => tk.id === task.id)!.priorityAt).toBeNull();
  });

  it("принятое дело отметку теряет, и отметить его заново нельзя", async () => {
    const task = (await tasksOf(ck.a)).find((tk) => tk.status === "TAKEN")!;
    const url = `/api/games/${gameId}/edge-tasks/${task.id}/priority`;
    expect((await post(url, ck.dep, { on: true })).statusCode).toBe(200);
    const sub = await post(`/api/games/${gameId}/edge-tasks/${task.id}/submit`, ck.a, { links: ["https://example.com/photo.jpg"], note: "Сделано" });
    expect(sub.statusCode, sub.body).toBe(200);
    expect((await tasksOf(ck.a)).find((tk) => tk.id === task.id)!.priorityAt).not.toBeNull(); // на проверке — ещё приоритет
    const dec = await post(`/api/games/${gameId}/edge-tasks/${task.id}/decide`, ck.admin, { approve: true, comment: "" });
    expect(dec.statusCode, dec.body).toBe(200);
    const done = (await tasksOf(ck.a)).find((tk) => tk.id === task.id)!;
    expect(done.status).toBe("APPROVED");
    expect(done.priorityAt).toBeNull();
    expect((await post(url, ck.cap, { on: true })).statusCode).toBe(409);
  });
});
