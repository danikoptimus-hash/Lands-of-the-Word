import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { cleanupFixtures, readyForStart, registerVerified } from "./testAuth.js";
import { chronicleLines, sendChronicle } from "./services/journal.js";
import { ruinsTreasure } from "./services/treasure.js";

/**
 * Этап 4 решений владельца 18.09: журнал событий → лента команды и новости для всех (без ставок), «Моё служение»,
 * доска активности, летопись недели, «Книга сезона»; мир между командами закрывает вызовы; руины с сокровищем.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `jadm_${stamp}`, p1Nick = `jp1_${stamp}`, p2Nick = `jp2_${stamp}`;
let adminCookie = "", p1Cookie = "", p2Cookie = "", gameId = "", rutKey = "", genKey = "", team1 = "", team2 = "", p1Id = "";
const content = JSON.parse(await readFile(new URL("../../../content/cities/rut.json", import.meta.url), "utf8")) as { tasks: unknown[] };
const allTasks = content.tasks.map((_, i) => i);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Журнал пишется после ответа сервера: ждём в ленте запись нужного вида (до 5 с), а не фиксированную паузу — на машинах GitHub она не хватала. */
async function feedUntil<T = { kind: string }>(gameId: string, cookie: string, kind: string, ms = 5000): Promise<T[]> {
  const until = Date.now() + ms;
  for (;;) {
    const items = (await get(`/api/games/${gameId}/feed`, cookie)).json().items as Array<T & { kind: string }>;
    if (items.some((f) => f.kind === kind) || Date.now() > until) return items;
    await wait(50);
  }
}

async function register(nickname: string) {
  const res = await registerVerified(app, { nickname, password: "secret123" });
  return res.headers["set-cookie"] as string;
}
async function joinTeam(name: string, cookie: string) {
  const t = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name } });
  const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${t.json().team.id}/invites`, headers: { cookie: adminCookie }, payload: { role: "CAPTAIN" } });
  await app.inject({ method: "POST", url: `/api/invites/${inv.json().invite.token}/accept`, headers: { cookie } });
  return t.json().team.id as string;
}
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
const post = (url: string, cookie: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie }, payload });

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick);
  p1Cookie = await register(p1Nick);
  p2Cookie = await register(p2Nick);
  p1Id = (await prisma.user.findUniqueOrThrow({ where: { nickname: p1Nick } })).id;
  const g = await post("/api/games", adminCookie, { name: "Журнал 18.09", teamCount: 2 });
  gameId = g.json().game.id;
  await post(`/api/games/${gameId}/generate`, adminCookie);
  team1 = await joinTeam("Моряки", p1Cookie);
  team2 = await joinTeam("Берег", p2Cookie);
  await post(`/api/games/${gameId}/deeds/import-default`, adminCookie);
  await readyForStart(app, gameId, adminCookie);
  await post(`/api/games/${gameId}/start`, adminCookie);
  rutKey = (await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "rut" } })).key;
  genKey = (await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "gen" } })).key;
  await prisma.teamNodeState.createMany({ data: [{ teamId: team1, nodeKey: rutKey }, { teamId: team2, nodeKey: rutKey }, { teamId: team1, nodeKey: genKey }] });
  // «Моряки» владеют Руфью (столица — Бытие), «Берег» изучил Руфь и может бросить вызов.
  await prisma.teamCityState.createMany({ data: [
    { gameId, teamId: team1, nodeKey: genKey, orderSolved: true, doneTasks: [], capturedAt: new Date(), isCapital: true },
    { gameId, teamId: team1, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks, capturedAt: new Date() },
    { gameId, teamId: team2, nodeKey: rutKey, orderSolved: true, doneTasks: allTasks },
  ] });
});

afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, p1Nick, p2Nick] } } });
  await cleanupFixtures(gameId);
  await app.close();
  await prisma.$disconnect();
});

describe("журнал событий: лента, новости, служение, летопись, книга сезона", () => {
  it("сдача и одобрение дела попадают в ленту команды и в «Моё служение»; чужая команда их не видит", async () => {
    const m = await get(`/api/games/${gameId}/my-map`, p1Cookie);
    const task = m.json().tasks.find((x: { status: string; sea?: boolean }) => x.status === "OPEN" && !x.sea);
    expect(task).toBeTruthy();
    expect((await post(`/api/games/${gameId}/edge-tasks/${task.id}/take`, p1Cookie)).statusCode).toBe(200);
    const sub = await post(`/api/games/${gameId}/edge-tasks/${task.id}/submit`, p1Cookie, { links: ["https://example.com/photo1"], note: "Сделали всё как надо" });
    expect(sub.statusCode).toBe(200);
    expect((await post(`/api/games/${gameId}/edge-tasks/${task.id}/decide`, adminCookie, { approve: true })).statusCode).toBe(200);
    const feed = await feedUntil<{ kind: string; vars: Record<string, string>; mine: boolean; everyone: boolean }>(gameId, p1Cookie, "deed_approved");
    expect(feed.some((f) => f.kind === "deed_submitted" && f.mine)).toBe(true);
    const approved = feed.find((f) => f.kind === "deed_approved");
    expect(approved?.vars.deed).toBe(task.deed.title);
    // Дело — событие команды, не новость: другая команда его не видит.
    const other = (await get(`/api/games/${gameId}/feed`, p2Cookie)).json().items as Array<{ kind: string }>;
    expect(other.some((f) => f.kind === "deed_approved")).toBe(false);
    const svc = (await get(`/api/games/${gameId}/my-service`, p1Cookie)).json();
    expect(svc.deeds).toBe(1);
    expect(svc.lastActiveAt).toBeGreaterThan(0);
    // Доска активности администратора: сдавший — первый.
    const board = (await get(`/api/games/${gameId}/activity`, adminCookie)).json().rows as Array<{ userId: string; deeds: number }>;
    expect(board[0]?.userId).toBe(p1Id);
    expect(board[0]?.deeds).toBe(1);
    expect((await get(`/api/games/${gameId}/activity`, p1Cookie)).statusCode).toBe(403);
  });

  it("вызов городу — новость для всех команд без ставки; мир закрывает вызовы, расторжение — сразу", async () => {
    // Мир: «Берег» предлагает, «Моряки» принимают → вызов невозможен.
    expect((await post(`/api/games/${gameId}/peace`, p2Cookie, { teamId: team1 })).statusCode).toBe(200);
    const view1 = (await get(`/api/games/${gameId}/peace`, p1Cookie)).json();
    const incoming = view1.teams.find((x: { team: { id: string } }) => x.team.id === team2);
    expect(incoming.state).toBe("incoming");
    expect((await post(`/api/games/${gameId}/peace/${incoming.peaceId}/accept`, p1Cookie)).statusCode).toBe(200);
    const war = (await get(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie)).json();
    expect(war.canDeclare).toBe(false);
    expect(war.reason).toMatch(/мир/i);
    const blocked = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie, { bid: 10 });
    expect(blocked.statusCode).toBe(409);
    const news = await feedUntil<{ kind: string; everyone: boolean }>(gameId, p2Cookie, "peace_made");
    expect(news.find((f) => f.kind === "peace_made")?.everyone).toBe(true);
    // Расторжение — сразу, и вызов снова возможен.
    expect((await post(`/api/games/${gameId}/peace/${incoming.peaceId}/break`, p2Cookie)).statusCode).toBe(200);
    const declared = await post(`/api/games/${gameId}/my-city/${rutKey}/war`, p2Cookie, { bid: 10 });
    expect(declared.statusCode).toBe(201);
    const feed1 = await feedUntil<{ kind: string; vars: Record<string, string | number>; everyone: boolean }>(gameId, p1Cookie, "trial_declared");
    const trial = feed1.find((f) => f.kind === "trial_declared");
    expect(trial?.everyone).toBe(true);
    expect(trial?.vars).toMatchObject({ team: "Берег", other: "Моряки", book: "rut" });
    // Ставка в новости не показывается.
    expect(trial?.vars.bid).toBeUndefined();
    expect(feed1.some((f) => f.kind === "peace_broken" && f.everyone)).toBe(true);
  });

  it("летопись недели собирается из журнала и записывается новостью; книга сезона — командам администратор", async () => {
    const lines = await chronicleLines(gameId, new Date(Date.now() - 86_400_000), new Date(), "ru");
    expect(lines.some((l) => l.startsWith("Дела за неделю"))).toBe(true);
    expect(lines.some((l) => l.includes("Испытания"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Положение"))).toBe(true);
    // Ставок и чисел стихов в летописи нет.
    expect(lines.join("\n")).not.toMatch(/ставк|стих/i);
    const sent = await sendChronicle(gameId);
    expect(sent.length).toBeGreaterThan(1);
    const feed = await feedUntil<{ kind: string; text: string }>(gameId, p2Cookie, "chronicle");
    expect(feed.find((f) => f.kind === "chronicle")?.text).toContain("Положение");
    const viaRoute = await post(`/api/games/${gameId}/chronicle`, adminCookie);
    expect(viaRoute.statusCode).toBe(200);
    const book = await get(`/api/games/${gameId}/season-book`, adminCookie);
    expect(book.statusCode).toBe(200);
    const b = book.json();
    expect(b.teams.map((x: { name: string }) => x.name)).toEqual(["Моряки", "Берег"]);
    expect(b.teams[0].deeds.length).toBe(1);
    expect(b.teams[0].members[0].deeds).toBe(1);
    expect(b.events.some((e: { kind: string }) => e.kind === "trial_declared")).toBe(true);
    expect((await get(`/api/games/${gameId}/season-book`, p1Cookie)).statusCode).toBe(403);
  });

  it("руины с сокровищем: первая команда, изучившая руины, получает район ближайшего города", async () => {
    // Руфь — руины (владелец снят), «Берег» решил все задания: находка — район ближайшего города, второй раз не выдаётся.
    await prisma.mapNode.update({ where: { gameId_key: { gameId, key: rutKey } }, data: { ruined: true } });
    await ruinsTreasure(gameId, team2, rutKey, "rut");
    await ruinsTreasure(gameId, team2, rutKey, "rut");
    await feedUntil(gameId, p2Cookie, "treasure");
    const found = await prisma.teamCityState.findMany({ where: { teamId: team2, NOT: { nodeKey: rutKey } } });
    expect(found.length).toBe(1);
    expect(found[0]!.doneTasks).toEqual([0]);
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    expect(node.treasureTeamId).toBe(team2);
    const feed = (await get(`/api/games/${gameId}/feed`, p2Cookie)).json().items as Array<{ kind: string; vars: Record<string, string | number> }>;
    const tr = feed.filter((f) => f.kind === "treasure");
    expect(tr.length).toBe(1);
    expect(tr[0]!.vars.n).toBe(1);
  });
});
