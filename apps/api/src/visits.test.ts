import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";
import { endOfLocalDay, expireVisits, openVisit } from "./services/visits.js";

/**
 * Отчёт о визите к адресату (решение владельца 22.10): в тот же день, хотя бы один ездивший, фото ссылкой;
 * не сдан до полуночи или не принят — город свободен, столица тоже.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `vz_adm_${stamp}`, cap: `vz_cap_${stamp}`, a: `vz_a_${stamp}`, b: `vz_b_${stamp}`, cap2: `vz_c2_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap: "", a: "", b: "", cap2: "" };
const uid: Record<string, string> = {};
let gameId = "", teamId = "", rutKey = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) { const r = await registerVerified(app, { nickname: nicks[k], password: "secret123" }); ck[k] = r.headers["set-cookie"] as string; uid[k] = r.json().user.id; }
  gameId = (await post("/api/games", ck.admin, { name: "Визиты", teamCount: 2 })).json().game.id;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  teamId = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Гости" })).json().team.id;
  const team2 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Соседи" })).json().team.id;
  const join = async (tid: string, role: "CAPTAIN" | "MEMBER", cookie: string, by: string) => { const inv = await post(`/api/games/${gameId}/teams/${tid}/invites`, by, { role }); await post(`/api/invites/${inv.json().invite.token}/accept`, cookie); };
  await join(teamId, "CAPTAIN", ck.cap, ck.admin); await join(teamId, "MEMBER", ck.a, ck.cap); await join(teamId, "MEMBER", ck.b, ck.cap); await join(team2, "CAPTAIN", ck.cap2, ck.admin);
  await post(`/api/games/${gameId}/deeds/import-default`, ck.admin);
  await readyForStart(app, gameId, ck.admin);
  await setGamePhase(app, gameId, ck.admin, "day");
  const st = await post(`/api/games/${gameId}/start`, ck.admin); expect(st.statusCode, st.body).toBe(200);
  rutKey = (await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "rut" } })).key;
  await prisma.teamNodeState.upsert({ where: { teamId_nodeKey: { teamId, nodeKey: rutKey } }, create: { teamId, nodeKey: rutKey }, update: {} });
});
afterAll(async () => { await cleanupFixtures(gameId); await prisma.game.deleteMany({ where: { id: gameId } }); await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } }); await app.close(); });

/** Город взят ключом (состояние как после ввода ключа) и открыт визит. */
async function capture() {
  await prisma.teamCityState.upsert({ where: { teamId_nodeKey: { teamId, nodeKey: rutKey } }, create: { gameId, teamId, nodeKey: rutKey, orderSolved: true, capturedAt: new Date(), isCapital: true }, update: { capturedAt: new Date(), isCapital: true } });
  return openVisit(gameId, teamId, rutKey, "rut");
}
const cityOf = async (cookie: string) => (await get(`/api/games/${gameId}/my-city/${rutKey}`, cookie)).json() as { state: { capturedAt: string | null; isCapital: boolean }; visit: { id: string; status: string; need: number; people: Array<{ id: string }>; adminComment: string } | null };

describe("отчёт о визите", () => {
  it("конец дня по поясу — следующая полночь", () => {
    const d = endOfLocalDay("Asia/Tashkent", new Date("2026-10-22T10:00:00Z"));
    expect(d.toISOString()).toBe("2026-10-22T19:00:00.000Z"); // полночь 23.10 по UTC+5
    expect(endOfLocalDay("Europe/Moscow", new Date("2026-10-22T22:30:00Z")).toISOString()).toBe("2026-10-23T21:00:00.000Z");
  });
  it("нужен хотя бы один ездивший, участник сдать не может, принятый отчёт оставляет город", async () => {
    const v = await capture();
    expect(v.dueAt.getTime()).toBeGreaterThan(Date.now());
    const city = await cityOf(ck.cap);
    expect(city.visit).toMatchObject({ id: v.id, status: "PENDING", need: 1 });
    expect(city.visit!.people.length).toBe(3);
    const url = `/api/games/${gameId}/visits/${v.id}/report`;
    expect((await post(url, ck.a, { members: [uid.cap, uid.a], text: "Молились", links: ["https://example.com/p"] })).statusCode).toBe(403);
    const few = await post(url, ck.cap, { members: [], text: "Молились", links: ["https://example.com/p"] });
    expect(few.statusCode).toBe(409); expect(few.json().error).toBe("few");
    expect((await post(url, ck.cap, { members: [uid.cap, uid.a], text: "", links: ["https://example.com/p"] })).json().error).toBe("empty");
    expect((await post(url, ck.cap, { members: [uid.cap, uid.a], text: "Молились", links: [] })).json().error).toBe("nolink");
    // Чужой id в списке не считается.
    expect((await post(url, ck.cap, { members: [uid.cap2], text: "Молились", links: ["https://example.com/p"] })).json().error).toBe("few");
    const ok = await post(url, ck.cap, { members: [uid.cap, uid.a, uid.a], text: "Помогли по дому, помолились", links: ["https://example.com/p"] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await cityOf(ck.a)).visit?.status).toBe("SUBMITTED");
    // Администратор видит отчёт и принимает его.
    const list = (await get(`/api/games/${gameId}/visits`, ck.admin)).json().visits as Array<{ id: string; status: string; members: string[]; team: { id: string } }>;
    expect(list.find((x) => x.id === v.id)).toMatchObject({ status: "SUBMITTED", members: [uid.cap, uid.a], team: { id: teamId } });
    expect((await post(`/api/games/${gameId}/visits/${v.id}/decide`, ck.cap, { approve: true })).statusCode).toBe(403);
    expect((await post(`/api/games/${gameId}/visits/${v.id}/decide`, ck.admin, { approve: true })).statusCode).toBe(200);
    expect((await post(`/api/games/${gameId}/visits/${v.id}/decide`, ck.admin, { approve: true })).statusCode).toBe(409);
    const after = await cityOf(ck.cap);
    expect(after.state.capturedAt).toBeTruthy(); expect(after.visit?.status).toBe("APPROVED");
  });
  it("не принят — город свободен, столица тоже; команда не выбывает и может взять город снова", async () => {
    const v = await capture();
    await post(`/api/games/${gameId}/visits/${v.id}/report`, ck.cap, { members: [uid.cap, uid.b], text: "Заехали на минуту", links: ["https://example.com/p"] });
    expect((await post(`/api/games/${gameId}/visits/${v.id}/decide`, ck.admin, { approve: false, comment: "Фото без команды" })).statusCode).toBe(200);
    const city = await cityOf(ck.cap);
    expect(city.state.capturedAt).toBeNull(); expect(city.state.isCapital).toBe(false);
    expect(city.visit).toMatchObject({ status: "REJECTED", adminComment: "Фото без команды" });
    expect((await prisma.team.findUniqueOrThrow({ where: { id: teamId } })).status).toBe("active");
    expect((await prisma.teamCityState.findFirst({ where: { gameId, nodeKey: rutKey, capturedAt: { not: null } } }))).toBeNull();
    // Новости: отказ — всем.
    for (let i = 0; i < 20; i++) { const items = (await get(`/api/games/${gameId}/feed`, ck.cap2)).json().items as Array<{ kind: string }>; if (items.some((x) => x.kind === "visit_rejected")) break; await new Promise((r) => setTimeout(r, 100)); }
    expect(((await get(`/api/games/${gameId}/feed`, ck.cap2)).json().items as Array<{ kind: string }>).some((x) => x.kind === "visit_rejected")).toBe(true);
  });
  it("не сдан до полуночи — город свободен сам", async () => {
    const v = await capture();
    await prisma.cityVisit.update({ where: { id: v.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    expect(await expireVisits(gameId)).toBe(1);
    const city = await cityOf(ck.cap);
    expect(city.state.capturedAt).toBeNull(); expect(city.visit?.status).toBe("EXPIRED");
    const late = await post(`/api/games/${gameId}/visits/${v.id}/report`, ck.cap, { members: [uid.cap, uid.b], text: "Поздно", links: ["https://example.com/p"] });
    expect(late.statusCode).toBe(409); expect(late.json().error).toBe("expired");
    const map = (await get(`/api/games/${gameId}/my-map`, ck.cap)).json() as { visits: unknown[] };
    expect(map.visits).toEqual([]);
  });
});
