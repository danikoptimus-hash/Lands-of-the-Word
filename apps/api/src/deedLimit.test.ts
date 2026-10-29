import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";

/**
 * Лимит дел в сутки без обхода (решение владельца 22.10): дело считается всем, кто в нём отмечен, дело, сданное без
 * взятия, тоже в счёт; летописец или капитан не сдаст дело за участника, у которого лимит уже выбран.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `dl_adm_${stamp}`, cap: `dl_cap_${stamp}`, chron: `dl_ch_${stamp}`, b: `dl_b_${stamp}`, c: `dl_c_${stamp}`, cap2: `dl_c2_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap: "", chron: "", b: "", c: "", cap2: "" };
const uid: Record<string, string> = {};
let gameId = "", teamId = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) { const r = await registerVerified(app, { nickname: nicks[k], password: "secret123" }); ck[k] = r.headers["set-cookie"] as string; uid[k] = r.json().user.id; }
  gameId = (await post("/api/games", ck.admin, { name: "Лимит дел", teamCount: 2 })).json().game.id;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  teamId = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Стражи" })).json().team.id;
  const team2 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Соседи" })).json().team.id;
  const join = async (tid: string, role: "CAPTAIN" | "MEMBER", cookie: string, by: string) => { const inv = await post(`/api/games/${gameId}/teams/${tid}/invites`, by, { role }); await post(`/api/invites/${inv.json().invite.token}/accept`, cookie); };
  await join(teamId, "CAPTAIN", ck.cap, ck.admin); await join(teamId, "MEMBER", ck.chron, ck.cap); await join(teamId, "MEMBER", ck.b, ck.cap); await join(teamId, "MEMBER", ck.c, ck.cap); await join(team2, "CAPTAIN", ck.cap2, ck.admin);
  await post(`/api/games/${gameId}/deeds/import-default`, ck.admin);
  await readyForStart(app, gameId, ck.admin);
  await prisma.membership.updateMany({ where: { teamId, userId: uid.chron }, data: { gameRole: "CHRONICLER" } });
  await setGamePhase(app, gameId, ck.admin, "day");
  const st = await post(`/api/games/${gameId}/start`, ck.admin); expect(st.statusCode, st.body).toBe(200);
  expect((await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: ck.admin }, payload: { settings: { rules: { maxDeedsPerDay: 1 } } } })).statusCode).toBe(200);
});
afterAll(async () => { await cleanupFixtures(gameId); await prisma.game.deleteMany({ where: { id: gameId } }); await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } }); await app.close(); });

const openTasks = async (cookie: string) => ((await get(`/api/games/${gameId}/my-map`, cookie)).json().tasks as Array<{ id: string; status: string; sea?: boolean }>).filter((t) => t.status === "OPEN" && !t.sea);
const limitOf = async (cookie: string, who: string) => ((await get(`/api/games/${gameId}/teams`, cookie)).json().teams as Array<{ id: string; members: Array<{ user: { id: string }; deedLimit: { taken: number } | null }> }>).find((t) => t.id === teamId)!.members.find((m) => m.user.id === who)!.deedLimit;

describe("лимит дел без обхода", () => {
  it("сдача без взятия идёт в лимит сдающего; участие в групповом деле лимит не тратит", async () => {
    // Свободных дел на карте может быть мало: добавим две стороны с делом «по фото» (искусственные ключи, как в people.test).
    const deed = await prisma.deed.findFirstOrThrow({ where: { gameId, proofType: "PHOTO_LINK", quarry: false } });
    for (let i = 0; i < 2; i++) await prisma.teamEdgeTask.create({ data: { gameId, teamId, fromKey: `T:${i}`, toKey: `T:${i + 1}`, deedId: deed.id } });
    const open = await openTasks(ck.b);
    expect(open.length).toBeGreaterThanOrEqual(4);
    const [d1, d2, d3, d4] = open;
    // b взял своё дело — лимит выбран.
    expect((await post(`/api/games/${gameId}/edge-tasks/${d1!.id}/take`, ck.b)).statusCode).toBe(200);
    // Летописец сдаёт свободное дело сразу, без взятия: оно записывается на него и идёт в его лимит.
    expect((await post(`/api/games/${gameId}/edge-tasks/${d2!.id}/submit`, ck.chron, { links: ["https://example.com/1"], note: "Сделал", participants: [] })).statusCode).toBe(200);
    expect((await limitOf(ck.cap, uid.chron))?.taken).toBe(1);
    // Второе такое же — нельзя: лимит летописца выбран. И взять тоже нельзя.
    const direct = await post(`/api/games/${gameId}/edge-tasks/${d3!.id}/submit`, ck.chron, { links: ["https://example.com/2"], note: "Ещё одно", participants: [] });
    expect(direct.statusCode).toBe(409); expect(direct.json().error).toBe("limit");
    expect((await post(`/api/games/${gameId}/edge-tasks/${d3!.id}/take`, ck.chron)).statusCode).toBe(409);
    // Участие в групповом деле (галочки) после своего дела — можно: лимит b и c не тратится.
    expect((await post(`/api/games/${gameId}/edge-tasks/${d3!.id}/submit`, ck.cap, { links: ["https://example.com/3"], note: "Вместе", participants: [uid.b, uid.c] })).statusCode).toBe(200);
    expect((await limitOf(ck.cap, uid.cap))?.taken).toBe(1);
    expect((await limitOf(ck.cap, uid.b))?.taken).toBe(1);
    expect((await limitOf(ck.cap, uid.c))?.taken).toBe(0);
    expect((await post(`/api/games/${gameId}/edge-tasks/${d4!.id}/take`, ck.c)).statusCode).toBe(200);
    // Сдать взятое дело b за него летописец может: это его единственное дело, не новое.
    expect((await post(`/api/games/${gameId}/edge-tasks/${d1!.id}/submit`, ck.chron, { links: ["https://example.com/4"], note: "За b", participants: [] })).statusCode).toBe(200);
    expect((await limitOf(ck.cap, uid.b))?.taken).toBe(1);
  });
  it("летописец записывает дело на основного: оно идёт в его лимит, на выбравшего лимит — нельзя", async () => {
    const deed = await prisma.deed.findFirstOrThrow({ where: { gameId, proofType: "PHOTO_LINK", quarry: false } });
    const d5 = await prisma.teamEdgeTask.create({ data: { gameId, teamId, fromKey: "T:5", toKey: "T:6", deedId: deed.id } });
    const d6 = await prisma.teamEdgeTask.create({ data: { gameId, teamId, fromKey: "T:6", toKey: "T:7", deedId: deed.id } });
    // Новый участник без дел; летописец с выбранным лимитом (прошлый тест).
    const r = await registerVerified(app, { nickname: `dl_d_${stamp}`, password: "secret123" }); const dCookie = r.headers["set-cookie"] as string; const dId = r.json().user.id as string;
    const inv = await post(`/api/games/${gameId}/teams/${teamId}/invites`, ck.cap, { role: "MEMBER" }); await post(`/api/invites/${inv.json().invite.token}/accept`, dCookie);
    // Летописец взять не может (лимит), но капитан берёт и записывает дело на d: считается d, не капитану.
    expect((await post(`/api/games/${gameId}/edge-tasks/${d5.id}/take`, ck.chron)).statusCode).toBe(409);
    await prisma.teamEdgeTask.update({ where: { id: d5.id }, data: { status: "TAKEN", takenById: uid.chron, takenAt: new Date() } });
    // На b записать нельзя: у него лимит выбран. На d — можно; у летописца взятие освобождается.
    const onB = await post(`/api/games/${gameId}/edge-tasks/${d5.id}/submit`, ck.chron, { links: ["https://example.com/5"], note: "Делал b", participants: [uid.b], mainId: uid.b });
    expect(onB.statusCode).toBe(409); expect(onB.json().message).toContain("запишите дело на другого");
    expect((await post(`/api/games/${gameId}/edge-tasks/${d5.id}/submit`, ck.chron, { links: ["https://example.com/5"], note: "Делал d, помогал b", participants: [uid.b, dId], mainId: dId })).statusCode).toBe(200);
    const row = await prisma.teamEdgeTask.findUniqueOrThrow({ where: { id: d5.id } });
    expect(row.takenById).toBe(dId); expect(row.participants).toEqual([dId, uid.b]);
    expect((await limitOf(ck.cap, dId))?.taken).toBe(1);
    // Обычный участник записать дело на другого не может: поле игнорируется, дело остаётся его.
    await prisma.teamEdgeTask.update({ where: { id: d6.id }, data: { status: "TAKEN", takenById: uid.c, takenAt: new Date() } });
    expect((await post(`/api/games/${gameId}/edge-tasks/${d6.id}/submit`, ck.c, { links: ["https://example.com/6"], note: "Сам", participants: [], mainId: dId })).statusCode).toBe(200);
    expect((await prisma.teamEdgeTask.findUniqueOrThrow({ where: { id: d6.id } })).takenById).toBe(uid.c);
    await prisma.user.deleteMany({ where: { id: dId } });
  });
  it("вымощенная камнем сторона в лимит не идёт (ошибка 29.10: у капитана после камня появлялся лимит)", async () => {
    const deed = await prisma.deed.findFirstOrThrow({ where: { gameId, proofType: "PHOTO_LINK", quarry: false } });
    const d7 = await prisma.teamEdgeTask.create({ data: { gameId, teamId, fromKey: "T:7", toKey: "T:8", deedId: deed.id } });
    const d8 = await prisma.teamEdgeTask.create({ data: { gameId, teamId, fromKey: "T:8", toKey: "T:9", deedId: deed.id } });
    // Капитан выбрал лимит прошлым тестом; обнулим: дела прошлых тестов уже сданы, но взяты сегодня — сдвинем их на вчера.
    await prisma.teamEdgeTask.updateMany({ where: { gameId, takenById: uid.cap }, data: { takenAt: new Date(Date.now() - 2 * 86_400_000), submittedAt: new Date(Date.now() - 2 * 86_400_000) } });
    expect((await limitOf(ck.cap, uid.cap))?.taken).toBe(0);
    await prisma.team.update({ where: { id: teamId }, data: { stones: 1 } });
    expect((await post(`/api/games/${gameId}/edge-tasks/${d7.id}/pave`, ck.cap)).statusCode).toBe(200);
    expect((await limitOf(ck.cap, uid.cap))?.taken).toBe(0);
    // После камня дело берётся как обычно.
    expect((await post(`/api/games/${gameId}/edge-tasks/${d8.id}/take`, ck.cap)).statusCode).toBe(200);
    expect((await limitOf(ck.cap, uid.cap))?.taken).toBe(1);
  });
});
