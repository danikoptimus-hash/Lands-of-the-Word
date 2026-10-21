import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";
import { assignPeople } from "./services/people.js";

/** Список людей у дела — «кому звонить» (решение владельца 21.10): имена раздаются сторонам равномерно, счётчики по каждому. */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `pp_adm_${stamp}`, cap: `pp_cap_${stamp}`, cap2: `pp_c2_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap: "", cap2: "" };
let gameId = "", teamId = "", deedId = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) { const r = await registerVerified(app, { nickname: nicks[k], password: "secret123" }); ck[k] = r.headers["set-cookie"] as string; }
  gameId = (await post("/api/games", ck.admin, { name: "Звонки", teamCount: 2 })).json().game.id;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  teamId = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Стражи" })).json().team.id;
  const team2 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Соседи" })).json().team.id;
  const join = async (tid: string, role: "CAPTAIN" | "MEMBER", cookie: string, by: string) => { const inv = await post(`/api/games/${gameId}/teams/${tid}/invites`, by, { role }); await post(`/api/invites/${inv.json().invite.token}/accept`, cookie); };
  await join(teamId, "CAPTAIN", ck.cap, ck.admin); await join(team2, "CAPTAIN", ck.cap2, ck.admin);
  await post(`/api/games/${gameId}/deeds/import-default`, ck.admin);
  deedId = (await prisma.deed.findFirstOrThrow({ where: { gameId, title: "Позвонить тому, кого давно не было в собрании" } })).id;
  await readyForStart(app, gameId, ck.admin);
  await setGamePhase(app, gameId, ck.admin, "day");
  const st = await post(`/api/games/${gameId}/start`, ck.admin); expect(st.statusCode, st.body).toBe(200);
});
afterAll(async () => { await cleanupFixtures(gameId); await prisma.game.deleteMany({ where: { id: gameId } }); await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } }); await app.close(); });

describe("кому звонить", () => {
  it("имена раздаются сторонам поровну, счётчики считают принятые, удалённый человек заменяется", async () => {
    const url = `/api/games/${gameId}/deeds/${deedId}/people`;
    expect((await post(url, ck.cap, { name: "Нельзя" })).statusCode).toBe(403);
    // Четыре свободные стороны с этим делом уже на карте (искусственные ключи, чтобы не зависеть от карты), список заполняется после:
    // свободные стороны перераздаются при каждом изменении списка, чтобы один человек не забрал всё.
    for (let i = 0; i < 4; i++) await prisma.teamEdgeTask.create({ data: { gameId, teamId, fromKey: `T:${i}`, toKey: `T:${i + 1}`, deedId } });
    for (const name of ["Первый", "Второй", "Третий"]) expect((await post(url, ck.admin, { name })).statusCode).toBe(200);
    const early = (await get(url, ck.admin)).json().people as Array<{ onMap: number }>;
    expect(Math.max(...early.map((p) => p.onMap)) - Math.min(...early.map((p) => p.onMap))).toBeLessThanOrEqual(1);
    // Ещё три стороны появились позже — раздаются с учётом уже назначенных.
    for (let i = 4; i < 7; i++) await prisma.teamEdgeTask.create({ data: { gameId, teamId, fromKey: `T:${i}`, toKey: `T:${i + 1}`, deedId } });
    await assignPeople(gameId);
    const tasks = await prisma.teamEdgeTask.findMany({ where: { gameId, deedId }, select: { id: true, personId: true, status: true } });
    expect(tasks.every((t) => t.personId)).toBe(true);
    const per = new Map<string, number>();
    for (const t of tasks) per.set(t.personId!, (per.get(t.personId!) ?? 0) + 1);
    expect(per.size).toBe(3);
    expect(Math.max(...per.values()) - Math.min(...per.values())).toBeLessThanOrEqual(1);
    // Участник видит имя в карточке дела.
    const map = (await get(`/api/games/${gameId}/my-map`, ck.cap)).json() as { tasks: Array<{ deedId: string; person: { name: string } | null }> };
    expect(map.tasks.filter((t) => t.deedId === deedId).every((t) => t.person?.name)).toBe(true);
    // Принятое дело считается как «позвонили».
    const first = tasks[0]!;
    await prisma.teamEdgeTask.update({ where: { id: first.id }, data: { status: "APPROVED", takenById: null, submittedAt: new Date(), decidedAt: new Date() } });
    let people = (await get(url, ck.admin)).json().people as Array<{ id: string; name: string; onMap: number; inWork: number; done: number }>;
    expect(people.find((p) => p.id === first.personId)!.done).toBe(1);
    expect(people.reduce((s, p) => s + p.onMap + p.inWork + p.done, 0)).toBe(tasks.length);
    // Удаление человека: его свободные стороны уходят другим, принятая остаётся без имени.
    const victim = people.find((p) => p.id === first.personId)!;
    people = (await app.inject({ method: "DELETE", url: `${url}/${victim.id}`, headers: { cookie: ck.admin } })).json().people;
    expect(people.length).toBe(2);
    const after = await prisma.teamEdgeTask.findMany({ where: { gameId, deedId }, select: { personId: true, status: true } });
    expect(after.filter((t) => t.status !== "APPROVED").every((t) => t.personId)).toBe(true);
    expect(after.find((t) => t.status === "APPROVED")!.personId).toBeNull();
  });
});
