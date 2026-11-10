import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";

/**
 * Две команды в одной партии (решение владельца 10.11): участник выбывшей команды по приглашению вступает в другую
 * команду той же игры и остаётся в составе выбывшей; играет за новую, в выбывшей ничего не делает.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `rj_adm_${stamp}`, cap1: `rj_c1_${stamp}`, out: `rj_out_${stamp}`, cap2: `rj_c2_${stamp}`, m2: `rj_m2_${stamp}`, cap3: `rj_c3_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap1: "", out: "", cap2: "", m2: "", cap3: "" };
let gameId = "", team1 = "", team2 = "", team3 = "", outId = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const register = async (nickname: string) => (await registerVerified(app, { nickname, password: "secret123" })).headers["set-cookie"] as string;
async function invite(teamId: string, by: string, role: "CAPTAIN" | "MEMBER" = "MEMBER") {
  return (await post(`/api/games/${gameId}/teams/${teamId}/invites`, by, { role })).json().invite.token as string;
}
beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) ck[k] = await register(nicks[k]);
  gameId = (await post("/api/games", ck.admin, { name: "Две команды", teamCount: 3 })).json().game.id;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  team1 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Ковчег" })).json().team.id;
  team2 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Странники" })).json().team.id;
  team3 = (await post(`/api/games/${gameId}/teams`, ck.admin, { name: "Пустыня" })).json().team.id;
  await post(`/api/invites/${await invite(team1, ck.admin, "CAPTAIN")}/accept`, ck.cap1);
  await post(`/api/invites/${await invite(team1, ck.cap1)}/accept`, ck.out);
  await post(`/api/invites/${await invite(team2, ck.admin, "CAPTAIN")}/accept`, ck.cap2);
  await post(`/api/invites/${await invite(team2, ck.cap2)}/accept`, ck.m2);
  await post(`/api/invites/${await invite(team3, ck.admin, "CAPTAIN")}/accept`, ck.cap3);
  outId = (await prisma.user.findUniqueOrThrow({ where: { nickname: nicks.out } })).id;
  await post(`/api/games/${gameId}/deeds/import-default`, ck.admin);
  await readyForStart(app, gameId, ck.admin);
  await setGamePhase(app, gameId, ck.admin, "day");
  expect((await post(`/api/games/${gameId}/start`, ck.admin)).statusCode).toBe(200);
});
afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } });
  await cleanupFixtures(gameId);
  await app.close(); await prisma.$disconnect();
});

describe("две команды в одной партии", () => {
  it("пока своя команда в строю — в другую команду не вступить", async () => {
    const token = await invite(team2, ck.cap2);
    const info = (await get(`/api/invites/${token}`, ck.out)).json();
    expect(info.alreadyIn?.id).toBe(team1);
    expect((await post(`/api/invites/${token}/accept`, ck.out)).statusCode).toBe(409);
  });

  it("выбывшая команда: по приглашению — в новую, в составе выбывшей остаётся, играет за новую", async () => {
    await prisma.team.update({ where: { id: team1 }, data: { status: "defeated" } });
    // До вступления: «своя» — выбывшая, действовать нельзя.
    expect((await get(`/api/games/${gameId}/my-map`, ck.out)).json().team.id).toBe(team1);
    const token = await invite(team2, ck.cap2);
    const info = (await get(`/api/invites/${token}`, ck.out)).json();
    expect(info.alreadyIn).toBeNull();
    expect(info.defeatedTeam?.id).toBe(team1);
    const res = await post(`/api/invites/${token}/accept`, ck.out);
    expect(res.statusCode).toBe(201);
    // Обе записи в составе; игра ведёт в новую команду.
    const rows = await prisma.membership.findMany({ where: { userId: outId, team: { gameId } } });
    expect(rows.map((r) => r.teamId).sort()).toEqual([team1, team2].sort());
    expect((await get(`/api/games/${gameId}/my-map`, ck.out)).json().team.id).toBe(team2);
    expect((await get(`/api/games/${gameId}/teams`, ck.out)).json().teams.map((t: { id: string }) => t.id)).toContain(team2);
    // «Мои игры» — одна строка на игру, новая команда.
    const mine = (await get(`/api/me/teams`, ck.out)).json().teams.filter((x: { game: { id: string } }) => x.game.id === gameId);
    expect(mine).toHaveLength(1); expect(mine[0].team.id).toBe(team2);
    // В рейтинге участников — один раз, с новой командой.
    const top = (await get(`/api/games/${gameId}/top`, ck.out)).json();
    expect(top.rows.filter((r: { userId: string }) => r.userId === outId)).toHaveLength(1);
    expect(top.me.teamId).toBe(team2);
    const awards = (await get(`/api/games/${gameId}/awards`, ck.out)).json();
    expect(awards.teamId).toBe(team2);
    expect(awards.members.filter((r: { userId: string }) => r.userId === outId)).toHaveLength(1);
    // Карточка участника — новая команда.
    expect((await get(`/api/games/${gameId}/members/${outId}/card`, ck.cap2)).json().team.id).toBe(team2);
    // Запись в летописи новой команды.
    let news = null;
    for (let i = 0; i < 20 && !news; i++) { news = await prisma.journal.findFirst({ where: { gameId, kind: "member_rejoined", teamId: team2 } }); if (!news) await new Promise((r) => setTimeout(r, 50)); }
    expect(news).not.toBeNull();
  });

  it("после вступления — ни в третью команду, ни повторно в ту же, ни в выбывшую", async () => {
    expect((await post(`/api/invites/${await invite(team3, ck.cap3)}/accept`, ck.out)).statusCode).toBe(409);
    expect((await post(`/api/invites/${await invite(team2, ck.cap2)}/accept`, ck.out)).statusCode).toBe(409);
  });

  it("в новой команде можно действовать: взять дело", async () => {
    const map = (await get(`/api/games/${gameId}/my-map`, ck.out)).json();
    const task = (map.tasks as Array<{ id: string; status: string; sea?: boolean }>).find((x) => x.status === "OPEN" && !x.sea);
    expect(task).toBeTruthy();
    const take = await post(`/api/games/${gameId}/edge-tasks/${task!.id}/take`, ck.out);
    expect(take.statusCode).toBe(200);
    expect((await prisma.teamEdgeTask.findUniqueOrThrow({ where: { id: task!.id } })).teamId).toBe(team2);
  });
});
