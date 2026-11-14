import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { pushOutbox } from "./services/push.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";

/**
 * Поручение дела (решение владельца 14.11: «первый вариант, бронь сутки»): капитан или заместитель поручает свободное
 * дело участнику — сутки взять его может только он; участнику уходит уведомление со ссылкой на это дело. Участник
 * берёт дело или отказывается; истёкшее поручение не действует.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `as_adm_${stamp}`, cap: `as_cap_${stamp}`, dep: `as_dep_${stamp}`, a: `as_a_${stamp}`, b: `as_b_${stamp}`, cap2: `as_c2_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap: "", dep: "", a: "", b: "", cap2: "" };
const uid: Record<string, string> = {};
let gameId = "", teamId = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
type MapTask = { id: string; status: string; takenById: string | null; assignedToId: string | null; assignedById: string | null; assignedUntil: string | null; sea?: boolean };
const tasksOf = async (cookie: string) => ((await get(`/api/games/${gameId}/my-map`, cookie)).json() as { tasks: MapTask[] }).tasks;
const taskOf = async (cookie: string, id: string) => (await tasksOf(cookie)).find((tk) => tk.id === id)!;
const feedKinds = async (cookie: string) => ((await get(`/api/games/${gameId}/feed`, cookie)).json() as { items: Array<{ kind: string; personal?: boolean; taskId?: string | null }> }).items;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Уведомления и записи летописи пишутся после ответа сервера: ждём нужное до двух секунд. */
async function until<T>(read: () => Promise<T | undefined> | T | undefined): Promise<T | undefined> {
  for (let i = 0; i < 40; i++) { const v = await read(); if (v) return v; await wait(50); }
  return undefined;
}
const assignUrl = (id: string) => `/api/games/${gameId}/edge-tasks/${id}/assign`;

beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) { const r = await registerVerified(app, { nickname: nicks[k], password: "secret123" }); ck[k] = r.headers["set-cookie"] as string; uid[k] = r.json().user.id; }
  gameId = (await post("/api/games", ck.admin, { name: "Поручение", teamCount: 2 })).json().game.id;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  teamId = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Стражи" })).json().team.id;
  const team2 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Соседи" })).json().team.id;
  const join = async (tid: string, role: "CAPTAIN" | "MEMBER", cookie: string, by: string) => { const inv = await post(`/api/games/${gameId}/teams/${tid}/invites`, by, { role }); await post(`/api/invites/${inv.json().invite.token}/accept`, cookie); };
  await join(teamId, "CAPTAIN", ck.cap, ck.admin); await join(teamId, "MEMBER", ck.dep, ck.cap); await join(teamId, "MEMBER", ck.a, ck.cap); await join(teamId, "MEMBER", ck.b, ck.cap); await join(team2, "CAPTAIN", ck.cap2, ck.admin);
  await prisma.membership.updateMany({ where: { teamId, userId: uid.dep }, data: { role: "DEPUTY" } });
  await post(`/api/games/${gameId}/deeds/import-default`, ck.admin);
  await readyForStart(app, gameId, ck.admin);
  await setGamePhase(app, gameId, ck.admin, "day");
  const st = await post(`/api/games/${gameId}/start`, ck.admin); expect(st.statusCode, st.body).toBe(200);
});
afterAll(async () => { await cleanupFixtures(gameId); await prisma.game.deleteMany({ where: { id: gameId } }); await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } }); await app.close(); });

describe("поручение дела участнику", () => {
  it("поручает капитан или заместитель, только своему участнику и только свободное дело; сутки дело берёт только адресат", async () => {
    const open = (await tasksOf(ck.a)).filter((tk) => tk.status === "OPEN" && !tk.sea);
    expect(open.length).toBeGreaterThan(0);
    const task = open[0]!;
    expect(task.assignedToId).toBeNull();
    // Участник поручить не может; чужой капитан этого дела не видит; себе и чужому участнику не поручают.
    expect((await post(assignUrl(task.id), ck.a, { userId: uid.b })).statusCode).toBe(403);
    expect((await post(assignUrl(task.id), ck.cap2, { userId: uid.a })).statusCode).toBe(404);
    expect((await post(assignUrl(task.id), ck.cap, { userId: uid.cap })).statusCode).toBe(400);
    expect((await post(assignUrl(task.id), ck.cap, { userId: uid.cap2 })).statusCode).toBe(404);
    pushOutbox.length = 0;
    const before = Date.now();
    const done = await post(assignUrl(task.id), ck.cap, { userId: uid.a });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().task).toMatchObject({ assignedToId: uid.a, assignedById: uid.cap });
    // Бронь — ровно сутки от поручения; видит вся команда.
    for (const who of [ck.a, ck.b, ck.cap]) {
      const seen = await taskOf(who, task.id);
      expect(seen).toMatchObject({ status: "OPEN", assignedToId: uid.a, assignedById: uid.cap });
      const left = new Date(seen.assignedUntil!).getTime() - before;
      expect(left).toBeGreaterThan(24 * 3_600_000 - 5_000); expect(left).toBeLessThan(24 * 3_600_000 + 60_000);
    }
    // Адресату — уведомление со ссылкой прямо на это дело и личная запись в летописи.
    const push = await until(() => pushOutbox.find((x) => x.userId === uid.a));
    expect(push?.payload.url).toContain(`/games/${gameId}/team?task=${task.id}`);
    expect(push?.payload.body).toContain("поручил");
    // Личная запись ведёт к этому делу: из летописи открывается его карточка.
    expect((await until(async () => (await feedKinds(ck.a)).find((x) => x.kind === "deed_assigned" && x.personal)))?.taskId).toBe(task.id);
    expect((await feedKinds(ck.b)).some((x) => x.kind === "deed_assigned")).toBe(false);
    // Пока бронь держится, дело не возьмёт никто, кроме адресата, — ни участник, ни заместитель.
    const other = await post(`/api/games/${gameId}/edge-tasks/${task.id}/take`, ck.b);
    expect(other.statusCode).toBe(409); expect(other.json().error).toBe("assigned");
    expect((await post(`/api/games/${gameId}/edge-tasks/${task.id}/take`, ck.dep)).statusCode).toBe(409);
    // Адресат берёт: дело в работе у него, поручение снято.
    const took = await post(`/api/games/${gameId}/edge-tasks/${task.id}/take`, ck.a);
    expect(took.statusCode, took.body).toBe(200);
    expect(await taskOf(ck.cap, task.id)).toMatchObject({ status: "TAKEN", takenById: uid.a, assignedToId: null, assignedUntil: null });
    // Взятое дело поручить нельзя.
    expect((await post(assignUrl(task.id), ck.cap, { userId: uid.b })).statusCode).toBe(409);
  });

  it("отказ снимает бронь и сообщает поручившему; поручение можно переназначить и снять", async () => {
    const task = (await tasksOf(ck.a)).find((tk) => tk.status === "OPEN" && !tk.sea)!;
    // Отказаться может только тот, кому поручено.
    expect((await post(assignUrl(task.id), ck.dep, { userId: uid.a })).statusCode).toBe(200); // заместитель тоже поручает
    expect((await post(`${assignUrl(task.id)}/decline`, ck.b)).statusCode).toBe(409);
    pushOutbox.length = 0;
    const no = await post(`${assignUrl(task.id)}/decline`, ck.a);
    expect(no.statusCode, no.body).toBe(200);
    expect(await taskOf(ck.b, task.id)).toMatchObject({ status: "OPEN", assignedToId: null, assignedUntil: null });
    const push = await until(() => pushOutbox.find((x) => x.userId === uid.dep));
    expect(push?.payload.url).toContain(`?task=${task.id}`);
    expect((await until(async () => (await feedKinds(ck.dep)).find((x) => x.kind === "deed_assign_declined" && x.personal)))?.taskId).toBe(task.id);
    expect((await post(`${assignUrl(task.id)}/decline`, ck.a)).statusCode).toBe(409); // отказываться уже не от чего
    // После отказа дело свободно: его берёт любой. Здесь — переназначение и снятие.
    expect((await post(assignUrl(task.id), ck.cap, { userId: uid.a })).statusCode).toBe(200);
    expect((await post(assignUrl(task.id), ck.cap, { userId: uid.b })).statusCode).toBe(200);
    expect((await taskOf(ck.a, task.id)).assignedToId).toBe(uid.b);
    expect((await post(`/api/games/${gameId}/edge-tasks/${task.id}/take`, ck.a)).statusCode).toBe(409);
    expect((await post(assignUrl(task.id), ck.dep, { userId: null })).statusCode).toBe(200);
    expect((await taskOf(ck.a, task.id)).assignedToId).toBeNull();
    expect((await post(`/api/games/${gameId}/edge-tasks/${task.id}/take`, ck.a)).statusCode).toBe(200);
  });

  it("через сутки бронь истекает сама: поручение не показывается и дело берёт любой", async () => {
    const task = (await tasksOf(ck.a)).find((tk) => tk.status === "OPEN" && !tk.sea)!;
    expect((await post(assignUrl(task.id), ck.cap, { userId: uid.a })).statusCode).toBe(200);
    await prisma.teamEdgeTask.update({ where: { id: task.id }, data: { assignedAt: new Date(Date.now() - 24 * 3_600_000 - 60_000) } });
    // Карта команды пересчитывается по событию: любое действие с делами команды (здесь — отметка приоритета).
    expect((await post(`/api/games/${gameId}/edge-tasks/${task.id}/priority`, ck.cap, { on: true })).statusCode).toBe(200);
    expect(await taskOf(ck.b, task.id)).toMatchObject({ status: "OPEN", assignedToId: null, assignedById: null, assignedUntil: null });
    expect((await post(`${assignUrl(task.id)}/decline`, ck.a)).statusCode).toBe(409);
    expect((await post(`/api/games/${gameId}/edge-tasks/${task.id}/take`, ck.b)).statusCode).toBe(200);
  });
});
