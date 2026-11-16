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
  it("карта по просьбе приложения приходит со справочником текстов дел; без просьбы — в прежнем виде", async () => {
    type Deed = { id: string; title: string; description: string };
    type Wire = { rev: number; tasks: Array<{ id: string; deedKey?: string; deed?: Deed; teamId?: string; gameId?: string }>; deedTexts?: Record<string, Deed>; same?: boolean };
    const url = `/api/games/${gameId}/my-map`;
    const ask = async (wire: boolean, query = "") => (await app.inject({ method: "GET", url: url + query, headers: { cookie: ck.a, ...(wire ? { "x-lotw-wire": "2" } : {}) } })).json() as Wire;
    const legacy = await ask(false), wire = await ask(true);
    // Прежний вид — приложению, которое ещё не обновилось после выкладки: текст дела в каждой стороне.
    expect(legacy.deedTexts).toBeUndefined();
    expect(legacy.tasks.length).toBeGreaterThan(0);
    expect(legacy.tasks[0]!.deed!.title).toBeTruthy();
    // Новый вид: те же стороны, текст — по ключу из справочника; номеров команды и игры у сторон нет.
    expect(wire.rev).toBe(legacy.rev);
    expect(wire.tasks.map((t) => t.id)).toEqual(legacy.tasks.map((t) => t.id));
    for (const [i, t] of wire.tasks.entries()) {
      expect(t.deed).toBeUndefined(); expect(t.teamId).toBeUndefined(); expect(t.gameId).toBeUndefined();
      expect(wire.deedTexts![t.deedKey!]).toEqual(legacy.tasks[i]!.deed);
    }
    expect(Object.keys(wire.deedTexts!).length).toBeLessThanOrEqual(wire.tasks.length);
    // Сверка «карта та же» от формата не зависит.
    expect((await ask(true, `?have=${wire.rev}`)).same).toBe(true);
    expect((await ask(true, `?have=${wire.rev - 1}`)).deedTexts).toBeDefined();
  });
  it("двое берут одно дело в один миг — берёт один, второй получает «уже взято»; двойное «Принять» даёт одну запись", async () => {
    const open = (await tasksOf(ck.a)).filter((tk) => tk.status === "OPEN");
    const task = open[0]!;
    const url = `/api/games/${gameId}/edge-tasks/${task.id}`;
    const [x, y] = await Promise.all([post(url + "/take", ck.cap), post(url + "/take", ck.dep)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    const winner = x.statusCode === 200 ? ck.cap : ck.dep;
    const mine = (await tasksOf(winner)).find((tk) => tk.id === task.id)! as MapTask & { takenById: string };
    expect(mine.status).toBe("TAKEN");
    expect(mine.takenById).toBe(x.statusCode === 200 ? uid.cap : uid.dep);
    // Сдача и два одновременных «Принять»: дело принято один раз — одна запись летописи о принятом деле.
    const sub = await post(url + "/submit", winner, { links: ["https://example.org/otchet"], note: "Сделали вместе" });
    expect(sub.statusCode, sub.body).toBe(200);
    const before = await prisma.journal.count({ where: { gameId, kind: "deed_approved" } });
    const [d1, d2] = await Promise.all([post(url + "/decide", ck.admin, { approve: true, comment: "" }), post(url + "/decide", ck.admin, { approve: true, comment: "" })]);
    expect([d1.statusCode, d2.statusCode].sort()).toEqual([200, 409]);
    await new Promise((r) => setTimeout(r, 150)); // запись летописи пишется в фоне
    expect(await prisma.journal.count({ where: { gameId, kind: "deed_approved" } })).toBe(before + 1);
  });
});
