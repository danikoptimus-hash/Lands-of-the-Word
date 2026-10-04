import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified } from "./testAuth.js";

/**
 * Каменоломня (решение владельца 04.10): общие дела команды сдаёт капитан, заместитель или летописец; администратор
 * принимает — команде камни; камень мостит свободную сторону; общие дела на дороги не ставятся.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const adminNick = `qa_adm_${stamp}`, capNick = `qa_cap_${stamp}`, memNick = `qa_mem_${stamp}`, cap2Nick = `qa_cap2_${stamp}`;
let adminCookie = "", capCookie = "", memCookie = "", cap2Cookie = "", gameId = "", teamId = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });

const register = async (nickname: string) => (await registerVerified(app, { nickname, password: "secret123" })).headers["set-cookie"] as string;
beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick);
  capCookie = await register(capNick);
  memCookie = await register(memNick);
  cap2Cookie = await register(cap2Nick);
  const g = await post("/api/games", adminCookie, { name: "Каменоломня", teamCount: 2 });
  gameId = g.json().game.id;
  await post(`/api/games/${gameId}/generate`, adminCookie);
  const t1 = await post(`/api/games/${gameId}/teams`, adminCookie, { name: "Каменщики" });
  teamId = t1.json().team.id;
  const inv = await post(`/api/games/${gameId}/teams/${teamId}/invites`, adminCookie, { role: "CAPTAIN" });
  await post(`/api/invites/${inv.json().invite.token}/accept`, capCookie);
  const inv2 = await post(`/api/games/${gameId}/teams/${teamId}/invites`, capCookie, { role: "MEMBER" });
  await post(`/api/invites/${inv2.json().invite.token}/accept`, memCookie);
  const t2 = await post(`/api/games/${gameId}/teams`, adminCookie, { name: "Вторая" });
  const inv3 = await post(`/api/games/${gameId}/teams/${t2.json().team.id}/invites`, adminCookie, { role: "CAPTAIN" });
  await post(`/api/invites/${inv3.json().invite.token}/accept`, cap2Cookie);
  await post(`/api/games/${gameId}/deeds/import-default`, adminCookie);
  await readyForStart(app, gameId, adminCookie);
  expect((await post(`/api/games/${gameId}/start`, adminCookie)).statusCode).toBe(200);
});
afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, capNick, memNick, cap2Nick] } } });
  await cleanupFixtures(gameId);
  await app.close(); await prisma.$disconnect();
});

describe("Каменоломня", () => {
  it("общие дела из набора не попадают на дороги и видны в листе Каменоломни", async () => {
    const map = (await get(`/api/games/${gameId}/my-map`, capCookie)).json();
    const ids = new Set((map.tasks as Array<{ deedId: string }>).map((t) => t.deedId));
    const quarryDeeds = await prisma.deed.findMany({ where: { gameId, quarry: true }, select: { id: true, title: true, stones: true } });
    expect(quarryDeeds.length).toBeGreaterThanOrEqual(4);
    expect(quarryDeeds.some((d) => ids.has(d.id))).toBe(false);
    const q = (await get(`/api/games/${gameId}/quarry`, capCookie)).json();
    expect(q.stones).toBe(0); expect(q.canWork).toBe(true);
    expect(q.deeds.map((d: { title: string }) => d.title)).toContain("Вся команда на стройке дома молитвы");
    expect((await get(`/api/games/${gameId}/quarry`, memCookie)).json().canWork).toBe(false);
  });

  it("сдача → приём администратором → камни; камень мостит свободную сторону и открывает перекрёсток", async () => {
    const build = await prisma.deed.findFirstOrThrow({ where: { gameId, quarry: true, title: "Вся команда на стройке дома молитвы" } });
    expect(build.stones).toBe(3);
    // Рядовой участник сдать не может, капитан — может; повторная сдача, пока первая на проверке, — 409.
    expect((await post(`/api/games/${gameId}/quarry/${build.id}/submit`, memCookie, { links: ["https://photos.example/team"] })).statusCode).toBe(403);
    const sub = await post(`/api/games/${gameId}/quarry/${build.id}/submit`, capCookie, { links: ["https://photos.example/team"], note: "Все были" });
    expect(sub.statusCode).toBe(201);
    expect((await post(`/api/games/${gameId}/quarry/${build.id}/submit`, capCookie, { links: ["https://photos.example/team2"] })).statusCode).toBe(409);
    // Пока камней нет — вымостить нельзя.
    const map0 = (await get(`/api/games/${gameId}/my-map`, capCookie)).json();
    const open = (map0.tasks as Array<{ id: string; status: string; sea: boolean; toKey: string }>).find((t) => t.status === "OPEN" && !t.sea)!;
    expect((await post(`/api/games/${gameId}/edge-tasks/${open.id}/pave`, capCookie)).statusCode).toBe(409);
    // Администратор видит сдачу и принимает: команде три камня.
    const queue = (await get(`/api/games/${gameId}/quarry/submissions`, adminCookie)).json().works;
    expect(queue.map((w: { id: string }) => w.id)).toContain(sub.json().work.id);
    const dec = await post(`/api/games/${gameId}/quarry/works/${sub.json().work.id}/decide`, adminCookie, { approve: true });
    expect(dec.statusCode).toBe(200); expect(dec.json().stones).toBe(3);
    expect((await get(`/api/games/${gameId}/quarry`, capCookie)).json().stones).toBe(3);
    expect((await get(`/api/games/${gameId}/my-map`, capCookie)).json().team.stones).toBe(3);
    // Вымостить: сторона принята как вымощенная, перекрёсток открыт, камней на один меньше; рядовому — нельзя.
    expect((await post(`/api/games/${gameId}/edge-tasks/${open.id}/pave`, memCookie)).statusCode).toBe(403);
    const paved = await post(`/api/games/${gameId}/edge-tasks/${open.id}/pave`, capCookie);
    expect(paved.statusCode).toBe(200); expect(paved.json().stones).toBe(2);
    const task = await prisma.teamEdgeTask.findUniqueOrThrow({ where: { id: open.id } });
    expect(task.status).toBe("APPROVED"); expect(task.paved).toBe(true);
    const map1 = (await get(`/api/games/${gameId}/my-map`, capCookie)).json();
    expect((map1.revealed as Array<{ key: string }>).some((n) => n.key === open.toKey)).toBe(true);
    expect(map1.team.stones).toBe(2);
    // Вымощенная сторона в счёт дел не идёт.
    const st = (await get(`/api/games/${gameId}/standings`, capCookie)).json();
    const mine = (st.standings as Array<{ teamId: string; deedsApproved: number }>).find((x) => x.teamId === teamId);
    expect(mine?.deedsApproved ?? 0).toBe(0);
    // Повторно ту же сторону не вымостить.
    expect((await post(`/api/games/${gameId}/edge-tasks/${open.id}/pave`, capCookie)).statusCode).toBe(409);
  });
});
