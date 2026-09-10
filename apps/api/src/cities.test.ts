import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `cadm_${stamp}`, p1Nick = `cp1_${stamp}`, p2Nick = `cp2_${stamp}`;
let adminCookie = "", p1Cookie = "", p2Cookie = "", gameId = "", rutKey = "", team1 = "", team2 = "";

async function register(nickname: string) {
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname, password: "secret123" } });
  return res.headers["set-cookie"] as string;
}
async function joinTeam(name: string, cookie: string) {
  const t = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name } });
  const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${t.json().team.id}/invites`, headers: { cookie: adminCookie }, payload: { role: "CAPTAIN" } });
  await app.inject({ method: "POST", url: `/api/invites/${inv.json().invite.token}/accept`, headers: { cookie } });
  return t.json().team.id as string;
}
const content = JSON.parse(await readFile(new URL("../../../content/cities/rut.json", import.meta.url), "utf8")) as {
  districts: Array<{ title: string }>;
  tasks: Array<{ type: string; answer?: number; answers?: string[]; correct?: number; items?: string[] }>;
};

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick);
  p1Cookie = await register(p1Nick);
  p2Cookie = await register(p2Nick);
  const g = await app.inject({ method: "POST", url: "/api/games", headers: { cookie: adminCookie }, payload: { name: "Города", teamCount: 2 } });
  gameId = g.json().game.id;
  await app.inject({ method: "POST", url: `/api/games/${gameId}/generate`, headers: { cookie: adminCookie } });
  team1 = await joinTeam("Львы", p1Cookie);
  team2 = await joinTeam("Орлы", p2Cookie);
  await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds/import-default`, headers: { cookie: adminCookie } });
  const start = await app.inject({ method: "POST", url: `/api/games/${gameId}/start`, headers: { cookie: adminCookie } });
  expect(start.statusCode).toBe(200);
  const rut = await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "rut" } });
  rutKey = rut.key;
  // Обе команды «дошли» до города Руфь.
  await prisma.teamNodeState.createMany({ data: [{ teamId: team1, nodeKey: rutKey }, { teamId: team2, nodeKey: rutKey }] });
});

afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, p1Nick, p2Nick] } } });
  await app.close();
  await prisma.$disconnect();
});

describe("город на перекрёстке", () => {
  it("ключи конвертов созданы при старте; админ видит ключ и ответы, игрок — нет", async () => {
    const adm = await app.inject({ method: "GET", url: `/api/games/${gameId}/cities/${rutKey}`, headers: { cookie: adminCookie } });
    expect(adm.statusCode).toBe(200);
    expect(adm.json().node.cityKey).toMatch(/^[A-Z2-9]{6}$/);
    expect(adm.json().node.cityCode).toMatch(/^[А-Я2-9]{16}$/);
    expect(adm.json().content.tasks[0].correct).toBe(0);
    expect(adm.json().content.tasks[11].answer).toBe(6);
    const forbidden = await app.inject({ method: "GET", url: `/api/games/${gameId}/cities/${rutKey}`, headers: { cookie: p1Cookie } });
    expect(forbidden.statusCode).toBe(403);
  });

  it("до города надо дойти: чужой (не открытый) город недоступен", async () => {
    const other = await prisma.mapNode.findFirstOrThrow({ where: { gameId, kind: "CITY", NOT: { bookCode: "rut" } } });
    const res = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-city/${other.key}`, headers: { cookie: p1Cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("районы перетасованы и без заданий, пока порядок не собран; неверный порядок считает ошибки", async () => {
    const city = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-city/${rutKey}`, headers: { cookie: p1Cookie } });
    expect(city.statusCode).toBe(200);
    const districts = city.json().content.districts as Array<{ id: string; title: string; index: number | null }>;
    expect(districts).toHaveLength(16);
    expect(districts.every((d) => d.index === null)).toBe(true);
    expect(city.json().content.tasks).toHaveLength(0);
    expect(districts.map((d) => d.title)).not.toEqual(content.districts.map((d) => d.title));
    // Тасовка стабильна между запросами.
    const again = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-city/${rutKey}`, headers: { cookie: p1Cookie } });
    expect(again.json().content.districts.map((d: { id: string }) => d.id)).toEqual(districts.map((d) => d.id));

    const wrong = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/order`, headers: { cookie: p1Cookie }, payload: { ids: districts.map((d) => d.id) } });
    expect(wrong.statusCode).toBe(200);
    expect(wrong.json().correct).toBe(false);
    expect(wrong.json().wrong).toBeGreaterThan(0);

    const byTitle = new Map(districts.map((d) => [d.title, d.id]));
    const right = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/order`, headers: { cookie: p1Cookie }, payload: { ids: content.districts.map((d) => byTitle.get(d.title)) } });
    expect(right.json()).toEqual({ correct: true, wrong: 0 });
    const solved = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-city/${rutKey}`, headers: { cookie: p1Cookie } });
    expect(solved.json().state.orderSolved).toBe(true);
    expect(solved.json().content.districts.map((d: { title: string }) => d.title)).toEqual(content.districts.map((d) => d.title));
    expect(solved.json().content.tasks).toHaveLength(16);
    expect(JSON.stringify(solved.json().content.tasks)).not.toContain("\"answer\"");
  });

  it("неверный ответ даёт паузу, верные ответы открывают буквы шифра; ключ берёт город и делает его столицей", async () => {
    const bad = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/tasks/0/answer`, headers: { cookie: p1Cookie }, payload: { answer: 7 } });
    expect(bad.json().correct).toBe(false);
    const paused = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/tasks/0/answer`, headers: { cookie: p1Cookie }, payload: { answer: 10 } });
    expect(paused.statusCode).toBe(429);
    await prisma.teamCityState.updateMany({ where: { teamId: team1, nodeKey: rutKey }, data: { lastWrongAt: null } });

    const city = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-city/${rutKey}`, headers: { cookie: p1Cookie } });
    const tasks = city.json().content.tasks as Array<{ index: number; type: string; items?: Array<{ id: string; text: string }> }>;
    for (const t of tasks) {
      const src = content.tasks[t.index]!;
      let answer: unknown;
      if (src.type === "number") answer = String(src.answer);
      else if (src.type === "text") answer = src.answers![0]!.toUpperCase() + "!";
      else if (src.type === "choice") answer = src.correct;
      else answer = src.items!.map((text) => t.items!.find((i) => i.text === text)!.id);
      const res = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/tasks/${t.index}/answer`, headers: { cookie: p1Cookie }, payload: { answer } });
      expect(res.statusCode, `задание ${t.index}`).toBe(200);
      expect(res.json().fragment).toMatch(/^[А-Я2-9]$/);
    }
    const done = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-city/${rutKey}`, headers: { cookie: p1Cookie } });
    const node0 = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    expect(node0.cityCode).toMatch(/^[А-Я2-9]{16}$/);
    expect((done.json().content.fragments as string[]).join("")).toBe(node0.cityCode);

    const wrongKey = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/capture`, headers: { cookie: p1Cookie }, payload: { key: "NOPE22" } });
    expect(wrongKey.statusCode).toBe(400);
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    const ok = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/capture`, headers: { cookie: p1Cookie }, payload: { key: node.cityKey!.toLowerCase() } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().isCapital).toBe(true);

    const map = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie: p2Cookie } });
    const c = (map.json().cities as Array<{ nodeKey: string; owner: { name: string } | null }>).find((x) => x.nodeKey === rutKey);
    expect(c?.owner?.name).toBe("Львы");
    const progress = await app.inject({ method: "GET", url: `/api/games/${gameId}/progress`, headers: { cookie: adminCookie } });
    expect(progress.json().cities.some((x: { teamId: string; isCapital: boolean }) => x.teamId === team1 && x.isCapital)).toBe(true);
  });

  it("админ открывает узел команде для теста: сторона к нему одобрена, узел открыт", async () => {
    const map = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie: p2Cookie } });
    const frontier = (map.json().tasks as Array<{ toKey: string; status: string }>).find((t) => t.status === "OPEN")!;
    const res = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${team2}/reveal`, headers: { cookie: adminCookie }, payload: { nodeKey: frontier.toKey } });
    expect(res.statusCode).toBe(200);
    expect(res.json().viaTask).toBe(true);
    const after = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie: p2Cookie } });
    expect((after.json().revealed as Array<{ key: string }>).some((n) => n.key === frontier.toKey)).toBe(true);
    const again = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${team2}/reveal`, headers: { cookie: adminCookie }, payload: { nodeKey: frontier.toKey } });
    expect(again.statusCode).toBe(409);
    const notAdmin = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${team2}/reveal`, headers: { cookie: p2Cookie }, payload: { nodeKey: frontier.toKey } });
    expect(notAdmin.statusCode).toBe(403);
  });

  it("админ присваивает город команде для теста: районы решены, город её, прежний владелец теряет", async () => {
    const res = await app.inject({ method: "POST", url: `/api/games/${gameId}/cities/${rutKey}/assign`, headers: { cookie: adminCookie }, payload: { teamId: team2 } });
    expect(res.statusCode).toBe(200);
    const city = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-city/${rutKey}`, headers: { cookie: p2Cookie } });
    expect(city.json().owner.name).toBe("Орлы");
    expect(city.json().state.doneTasks).toHaveLength(16);
    const lost = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-city/${rutKey}`, headers: { cookie: p1Cookie } });
    expect(lost.json().state.capturedAt).toBeNull();
    // вернём как было для следующего теста
    await app.inject({ method: "POST", url: `/api/games/${gameId}/cities/${rutKey}/assign`, headers: { cookie: adminCookie }, payload: { teamId: team1 } });
    await prisma.teamCityState.updateMany({ where: { teamId: team2, nodeKey: rutKey }, data: { doneTasks: content.tasks.map((_, i) => i) } });
  });

  it("вторая команда не может взять уже занятый город", async () => {
    const city = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-city/${rutKey}`, headers: { cookie: p2Cookie } });
    expect(city.json().owner.name).toBe("Львы");
    const byTitle = new Map((city.json().content.districts as Array<{ id: string; title: string }>).map((d) => [d.title, d.id]));
    await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/order`, headers: { cookie: p2Cookie }, payload: { ids: content.districts.map((d) => byTitle.get(d.title)) } });
    await prisma.teamCityState.updateMany({ where: { teamId: team2, nodeKey: rutKey }, data: { doneTasks: content.tasks.map((_, i) => i) } });
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    const res = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/capture`, headers: { cookie: p2Cookie }, payload: { key: node.cityKey! } });
    expect(res.statusCode).toBe(409);
  });
});

describe("дипломатия, роли, столица, руины, пожертвование", () => {
  it("проход через чужой город закрыт без разрешения; запрос → ответ владельца → проход открыт; отзыв убирает свободные дела", async () => {
    // Город Руфь принадлежит Львам (взят выше), Орлы дошли до него: дальше идти нельзя.
    await app.inject({ method: "POST", url: `/api/games/${gameId}/cities/${rutKey}/assign`, headers: { cookie: adminCookie }, payload: { teamId: team1 } });
    const map0 = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie: p2Cookie } });
    const city0 = (map0.json().cities as Array<{ nodeKey: string; blocked: boolean; passage: string | null }>).find((c) => c.nodeKey === rutKey)!;
    expect(city0.blocked).toBe(true);
    const out0 = (map0.json().tasks as Array<{ fromKey: string }>).filter((t) => t.fromKey === rutKey);
    expect(out0).toHaveLength(0);
    const req = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/passage`, headers: { cookie: p2Cookie }, payload: { message: "Пропустите, пожалуйста" } });
    expect(req.statusCode).toBe(201);
    const dup = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/passage`, headers: { cookie: p2Cookie }, payload: {} });
    expect(dup.statusCode).toBe(409);
    const inbox = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-passages`, headers: { cookie: p1Cookie } });
    expect(inbox.json().incoming).toHaveLength(1);
    const reqId = inbox.json().incoming[0].id as string;
    const ok = await app.inject({ method: "POST", url: `/api/games/${gameId}/passages/${reqId}/decide`, headers: { cookie: p1Cookie }, payload: { approve: true, answer: "Проходите" } });
    expect(ok.statusCode).toBe(200);
    const map1 = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie: p2Cookie } });
    const city1 = (map1.json().cities as Array<{ nodeKey: string; blocked: boolean; passage: string | null }>).find((c) => c.nodeKey === rutKey)!;
    expect(city1).toMatchObject({ blocked: false, passage: "APPROVED" });
    const out1 = (map1.json().tasks as Array<{ fromKey: string; status: string }>).filter((t) => t.fromKey === rutKey);
    expect(out1.length).toBeGreaterThan(0);
    const revoke = await app.inject({ method: "POST", url: `/api/games/${gameId}/passages/${reqId}/revoke`, headers: { cookie: p1Cookie } });
    expect(revoke.statusCode).toBe(200);
    const map2 = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie: p2Cookie } });
    expect((map2.json().tasks as Array<{ fromKey: string }>).filter((t) => t.fromKey === rutKey)).toHaveLength(0);
  });

  it("роли: разведчик заглядывает за ребро раз в неделю; не-разведчику нельзя", async () => {
    const map = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie: p2Cookie } });
    const far = (map.json().tasks as Array<{ toKey: string; status: string }>).find((t) => t.status !== "APPROVED")!;
    const denied = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-map/peek`, headers: { cookie: p2Cookie }, payload: { nodeKey: far.toKey } });
    expect(denied.statusCode).toBe(403);
    // Капитан не может иметь игровую роль: добавим участника-разведчика
    const scoutNick = `scout_${stamp}`;
    const scoutCookie = await register(scoutNick);
    const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${team2}/invites`, headers: { cookie: adminCookie }, payload: { role: "MEMBER" } });
    await app.inject({ method: "POST", url: `/api/invites/${inv.json().invite.token}/accept`, headers: { cookie: scoutCookie } });
    const scout = await prisma.user.findFirstOrThrow({ where: { nickname: scoutNick } });
    await app.inject({ method: "PATCH", url: `/api/games/${gameId}/teams/${team2}/members/${scout.id}`, headers: { cookie: adminCookie }, payload: { gameRole: "SCOUT" } });
    const peek = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-map/peek`, headers: { cookie: scoutCookie }, payload: { nodeKey: far.toKey } });
    expect(peek.statusCode).toBe(200);
    expect(["CITY", "EMPTY", "START"]).toContain(peek.json().kind);
    const again = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-map/peek`, headers: { cookie: scoutCookie }, payload: { nodeKey: far.toKey } });
    expect(again.statusCode).toBe(429);
    const after = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie: p2Cookie } });
    expect((after.json().peeked as Array<{ key: string }>).some((p) => p.key === far.toKey)).toBe(true);
    await prisma.user.deleteMany({ where: { nickname: scoutNick } });
  });

  it("пожертвование вместо дела: только при настроенном минимуме и не меньше него", async () => {
    const map = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie: p2Cookie } });
    const t = (map.json().tasks as Array<{ id: string; status: string }>).find((x) => x.status === "OPEN")!;
    await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${t.id}/take`, headers: { cookie: p2Cookie } });
    const off = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${t.id}/submit`, headers: { cookie: p2Cookie }, payload: { donation: true, donationAmount: 500, links: ["https://example.com/receipt"] } });
    expect(off.statusCode).toBe(409);
    const set = await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: adminCookie }, payload: { settings: { donationMin: 1000, donationCurrency: "сум" } } });
    expect(set.statusCode).toBe(200);
    const low = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${t.id}/submit`, headers: { cookie: p2Cookie }, payload: { donation: true, donationAmount: 500, links: ["https://example.com/receipt"] } });
    expect(low.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${t.id}/submit`, headers: { cookie: p2Cookie }, payload: { donation: true, donationAmount: 1500, links: ["https://example.com/receipt"] } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().task).toMatchObject({ status: "SUBMITTED", donation: true, donationAmount: 1500 });
  });

  it("перенос столицы: один раз за игру, только на свой город", async () => {
    const other = await prisma.mapNode.findFirstOrThrow({ where: { gameId, kind: "CITY", NOT: { key: rutKey } } });
    const notMine = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${other.key}/make-capital`, headers: { cookie: p1Cookie } });
    expect(notMine.statusCode).toBe(409);
    await app.inject({ method: "POST", url: `/api/games/${gameId}/cities/${other.key}/assign`, headers: { cookie: adminCookie }, payload: { teamId: team1 } });
    const moved = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${other.key}/make-capital`, headers: { cookie: p1Cookie } });
    expect(moved.statusCode, moved.body).toBe(200);
    const states = await prisma.teamCityState.findMany({ where: { teamId: team1, isCapital: true } });
    expect(states.map((s) => s.nodeKey)).toEqual([other.key]);
    const twice = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/make-capital`, headers: { cookie: p1Cookie } });
    expect(twice.statusCode).toBe(409);
  });

  it("руины берутся без ключа после решённых заданий", async () => {
    await prisma.mapNode.update({ where: { gameId_key: { gameId, key: rutKey } }, data: { ruined: true } });
    await prisma.teamCityState.updateMany({ where: { nodeKey: rutKey, gameId }, data: { capturedAt: null, isCapital: false } });
    const info = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-city/${rutKey}`, headers: { cookie: p2Cookie } });
    expect(info.json().node.ruined).toBe(true);
    const take = await app.inject({ method: "POST", url: `/api/games/${gameId}/my-city/${rutKey}/capture`, headers: { cookie: p2Cookie }, payload: {} });
    expect(take.statusCode).toBe(200);
    const node = await prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: rutKey } } });
    expect(node.ruined).toBe(false);
  });
});
