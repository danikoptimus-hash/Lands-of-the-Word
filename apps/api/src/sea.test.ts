import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { BOOKS } from "@lotw/domain";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { withDeedBook } from "./services/teamMap.js";
import { registerVerified } from "./testAuth.js";

/**
 * Два острова и морской переход (2.3a): порт — береговой город; из взятого порта команде даётся морское дело;
 * после одобрения капитан выбирает пустой береговой узел другого острова, и он открывается.
 */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `sadm_${stamp}`, capNick = `scap_${stamp}`, memNick = `smem_${stamp}`, p2Nick = `sp2_${stamp}`;
let adminCookie = "", capCookie = "", memCookie = "", p2Cookie = "", gameId = "", team1 = "", portKey = "";

async function register(nickname: string) {
  const res = await registerVerified(app, { nickname, password: "secret123" });
  return res.headers["set-cookie"] as string;
}
async function joinTeam(name: string, cookie: string, role: "CAPTAIN" | "MEMBER", teamId?: string) {
  const id = teamId ?? (await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie: adminCookie }, payload: { name } })).json().team.id as string;
  const inv = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams/${id}/invites`, headers: { cookie: adminCookie }, payload: { role } });
  await app.inject({ method: "POST", url: `/api/invites/${inv.json().invite.token}/accept`, headers: { cookie } });
  return id;
}
const myMap = async (cookie = capCookie) => (await app.inject({ method: "GET", url: `/api/games/${gameId}/my-map`, headers: { cookie } })).json();
type Task = { id: string; deedId: string; fromKey: string; toKey: string; status: string; links: string[]; note: string; sea?: boolean; landing?: boolean; candidates?: string[] };

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick); capCookie = await register(capNick); memCookie = await register(memNick); p2Cookie = await register(p2Nick);
  await prisma.user.update({ where: { nickname: adminNick }, data: { platformRole: "SUPERADMIN" } });
  const g = await app.inject({ method: "POST", url: "/api/games", headers: { cookie: adminCookie }, payload: { name: "Море", teamCount: 2 } });
  gameId = g.json().game.id;
  expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/generate`, headers: { cookie: adminCookie } })).statusCode).toBe(200);
  team1 = await joinTeam("Моряки", capCookie, "CAPTAIN");
  await joinTeam("", memCookie, "MEMBER", team1);
  await joinTeam("Берег", p2Cookie, "CAPTAIN");
  await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds/import-default`, headers: { cookie: adminCookie } });
  expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/start`, headers: { cookie: adminCookie } })).statusCode).toBe(200);
});
afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, capNick, memNick, p2Nick] } } });
  await app.close(); await prisma.$disconnect();
});

describe("стандартный набор дел", () => {
  it("удаление дела в запущенной игре: свободные стороны получают другое дело, взятое дело удалить нельзя", async () => {
    const tasks = (await myMap()).tasks as Task[];
    const open = tasks.filter((t) => t.status === "OPEN" && !t.sea);
    expect(open.length).toBeGreaterThanOrEqual(2);
    const victim = open[0]!;
    const del = await app.inject({ method: "DELETE", url: `/api/games/${gameId}/deeds/${victim.deedId}`, headers: { cookie: adminCookie } });
    expect(del.statusCode).toBe(200);
    expect(del.json().replaced).toBeGreaterThanOrEqual(1);
    const after = ((await myMap()).tasks as Task[]).find((t) => t.id === victim.id)!;
    expect(after.deedId).not.toBe(victim.deedId);
    // Взятое дело удалить нельзя.
    const taken = open[1]!;
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${taken.id}/take`, headers: { cookie: capCookie } })).statusCode).toBe(200);
    const no = await app.inject({ method: "DELETE", url: `/api/games/${gameId}/deeds/${taken.deedId}`, headers: { cookie: adminCookie } });
    expect(no.statusCode).toBe(409);
    await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${taken.id}/release`, headers: { cookie: capCookie } });
  });

  it("переименованное дело набора обновляется в игре на месте, а не дублируется", async () => {
    // Игра, где набор импортировали до переименования: есть только старое название.
    const had = (await app.inject({ method: "GET", url: `/api/games/${gameId}/deeds`, headers: { cookie: adminCookie } })).json().deeds as Array<{ id: string; title: string }>;
    for (const d of had.filter((x) => /молитвенный час/i.test(x.title))) expect((await app.inject({ method: "DELETE", url: `/api/games/${gameId}/deeds/${d.id}`, headers: { cookie: adminCookie } })).statusCode).toBe(200);
    const mk = await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds`, headers: { cookie: adminCookie }, payload: { title: "Час молитвы за нужды братства", direction: "Молитва" } });
    expect(mk.statusCode).toBe(201);
    const oldId = mk.json().deed.id as string;
    const r = await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds/import-default`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().updated).toBeGreaterThanOrEqual(1);
    const deeds = (await app.inject({ method: "GET", url: `/api/games/${gameId}/deeds`, headers: { cookie: adminCookie } })).json().deeds as Array<{ id: string; title: string }>;
    expect(deeds.find((d) => d.id === oldId)?.title).toBe("Прийти на молитвенный час и поучаствовать молитвой");
    expect(deeds.filter((d) => /молитвенный час/i.test(d.title))).toHaveLength(1);
    expect(deeds.some((d) => d.title === "Помочь с подготовкой проповеди")).toBe(false);
  });

  it("заменить: неиспользованные дела убираются, список равен набору", async () => {
    await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds`, headers: { cookie: adminCookie }, payload: { title: "Своё дело", direction: "Посещение" } });
    const r = await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds/import-default`, headers: { cookie: adminCookie }, payload: { mode: "replace" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().removed).toBeGreaterThan(0);
    const set = JSON.parse(await readFile(path.resolve(process.cwd(), "../../content/deeds-default.json"), "utf8")) as unknown[];
    const deeds = (await app.inject({ method: "GET", url: `/api/games/${gameId}/deeds`, headers: { cookie: adminCookie } })).json().deeds as Array<{ title: string }>;
    expect(deeds).toHaveLength(set.length);
    expect(deeds.some((d) => d.title === "Своё дело")).toBe(false);
  });
});

describe("два острова", () => {
  it("карта: гексы и узлы обоих островов, береговые города — порты, старты на Ветхом Завете", async () => {
    const r = await app.inject({ method: "GET", url: `/api/games/${gameId}`, headers: { cookie: adminCookie } });
    const { hexes, nodes } = r.json() as { hexes: Array<{ island: string }>; nodes: Array<{ kind: string; island: string; coastal: boolean; cityType: string | null }> };
    expect(hexes.some((h) => h.island === "OT") && hexes.some((h) => h.island === "NT")).toBe(true);
    for (const n of nodes.filter((x) => x.kind === "CITY")) expect(n.cityType === "port").toBe(n.coastal);
    for (const n of nodes.filter((x) => x.kind === "START")) expect(n.island).toBe("OT");
    expect(nodes.filter((n) => n.kind === "CITY" && n.island === "NT")).toHaveLength(27);
  });
});

describe("морской переход", () => {
  it("взятый порт даёт морское дело; до одобрения высадки нет", async () => {
    const before = (await myMap()).tasks as Task[];
    expect(before.some((t) => t.sea)).toBe(false);
    const port = await prisma.mapNode.findFirstOrThrow({ where: { gameId, kind: "CITY", coastal: true, island: "OT" } });
    portKey = port.key;
    // Дело по книге порта с [Книга] в тексте: на сторонах из взятого порта выпадает первым, книга подставляется.
    const themed = await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds`, headers: { cookie: adminCookie }, payload: { title: "Проповедь по книге [Книга]", description: "Текст из книги [книга].", direction: "Благовестие", bookCodes: [port.bookCode, "zzz"], frequency: 3, canRepeat: true } });
    expect(themed.statusCode).toBe(201);
    expect(themed.json().deed.bookCodes).toEqual([port.bookCode]);
    expect(themed.json().deed.frequency).toBe(3);
    const assign = await app.inject({ method: "POST", url: `/api/games/${gameId}/cities/${portKey}/assign`, headers: { cookie: adminCookie }, payload: { teamId: team1 } });
    expect(assign.statusCode).toBe(200);
    const tasks = (await myMap()).tasks as Task[];
    const sea = tasks.filter((t) => t.sea);
    expect(sea).toHaveLength(1);
    expect(sea[0]!.fromKey).toBe(portKey);
    expect(sea[0]!.status).toBe("OPEN");
    expect(sea[0]!.landing).toBe(false);
    expect(sea[0]!.candidates).toBeUndefined();
    // Все стороны из порта — дела по книге порта (тематический пул), [Книга] заменена на название книги.
    const fromPort = tasks.filter((t) => t.fromKey === portKey) as Array<Task & { deed: { id: string; title: string; description: string } }>;
    expect(fromPort.length).toBeGreaterThan(0);
    const name = BOOKS.find((b) => b.code === port.bookCode)!.nameRu;
    const all = (await app.inject({ method: "GET", url: `/api/games/${gameId}/deeds`, headers: { cookie: adminCookie } })).json().deeds as Array<{ id: string; bookCodes: string[] }>;
    const themedIds = new Set(all.filter((d) => d.bookCodes.includes(port.bookCode!)).map((d) => d.id));
    for (const t of fromPort) { expect(themedIds.has(t.deed.id)).toBe(true); expect(t.deed.title.includes("[")).toBe(false); }
    expect(withDeedBook({ title: "По книге [Книга]", description: "[книга]!" }, port.bookCode).title).toBe(`По книге ${name}`);
    expect(withDeedBook({ title: "По книге [Книга]", description: "[книга]!" }, port.bookCode).description).toBe(`${name}!`);
    expect(withDeedBook({ title: "По книге [Книга]", description: "" }, null).title).toBe("По книге на выбор");
    // Внутренний город морского дела не даёт.
    const inland = await prisma.mapNode.findFirstOrThrow({ where: { gameId, kind: "CITY", coastal: false, island: "OT" } });
    await app.inject({ method: "POST", url: `/api/games/${gameId}/cities/${inland.key}/assign`, headers: { cookie: adminCookie }, payload: { teamId: team1 } });
    expect(((await myMap()).tasks as Task[]).filter((t) => t.sea)).toHaveLength(1);
  });

  it("одобрение → капитан выбирает пустой береговой узел другого острова → узел открыт, фронтир на Новом Завете", async () => {
    const sea = ((await myMap()).tasks as Task[]).find((t) => t.sea)!;
    expect((await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${sea.id}/take`, headers: { cookie: memCookie } })).statusCode).toBe(200);
    const sub = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${sea.id}/submit`, headers: { cookie: memCookie }, payload: { links: ["https://example.com/ship"], note: "Собрали команду корабля" } });
    expect(sub.statusCode).toBe(200);
    // Тайное дело: ссылки и описание сдачи видит только взявший (и администратор), капитану они не показываются.
    await prisma.deed.update({ where: { id: sea.deedId }, data: { secret: true } });
    const forCap = ((await myMap(capCookie)).tasks as Task[]).find((t) => t.id === sea.id)!;
    expect(forCap.links).toEqual([]); expect(forCap.note).toBe("");
    const forMem = ((await myMap(memCookie)).tasks as Task[]).find((t) => t.id === sea.id)!;
    expect(forMem.links).toEqual(["https://example.com/ship"]); expect(forMem.note).toBe("Собрали команду корабля");
    const adminView = (await app.inject({ method: "GET", url: `/api/games/${gameId}/submissions?status=SUBMITTED`, headers: { cookie: adminCookie } })).json().tasks as Task[];
    expect(adminView.find((t) => t.id === sea.id)!.links).toEqual(["https://example.com/ship"]);
    // Высадка до одобрения невозможна.
    const early = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${sea.id}/land`, headers: { cookie: capCookie }, payload: { nodeKey: portKey } });
    expect(early.statusCode).toBe(409);
    const ok = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${sea.id}/decide`, headers: { cookie: adminCookie }, payload: { approve: true } });
    expect(ok.json().task.status).toBe("APPROVED");
    // Одобрение морского дела ничего не открывает само по себе.
    const m1 = await myMap();
    const approved = (m1.tasks as Task[]).find((t) => t.id === sea.id)!;
    expect(approved.landing).toBe(true);
    expect(approved.candidates!.length).toBeGreaterThan(5);
    const cand = await prisma.mapNode.findMany({ where: { gameId, key: { in: approved.candidates } } });
    for (const c of cand) { expect(c.island).toBe("NT"); expect(c.coastal).toBe(true); expect(c.kind).toBe("EMPTY"); }
    expect((m1.revealed as Array<{ key: string }>).some((n) => n.key === cand[0]!.key)).toBe(false);
    // Не капитан не может; не кандидат (береговой узел своего острова) — нельзя.
    const member = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${sea.id}/land`, headers: { cookie: memCookie }, payload: { nodeKey: cand[0]!.key } });
    expect(member.statusCode).toBe(403);
    const own = await prisma.mapNode.findFirstOrThrow({ where: { gameId, kind: "EMPTY", coastal: true, island: "OT" } });
    const wrong = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${sea.id}/land`, headers: { cookie: capCookie }, payload: { nodeKey: own.key } });
    expect(wrong.statusCode).toBe(409);
    const land = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${sea.id}/land`, headers: { cookie: capCookie }, payload: { nodeKey: cand[0]!.key } });
    expect(land.statusCode).toBe(200);
    const m2 = await myMap();
    expect((m2.revealed as Array<{ key: string; island: string }>).find((n) => n.key === cand[0]!.key)?.island).toBe("NT");
    const landed = (m2.tasks as Task[]).find((t) => t.id === sea.id)!;
    expect(landed.toKey).toBe(cand[0]!.key);
    expect(landed.landing).toBe(false);
    // С места высадки уходят обычные стороны с делами.
    expect((m2.tasks as Task[]).filter((t) => t.fromKey === cand[0]!.key && t.status === "OPEN").length).toBeGreaterThanOrEqual(2);
    // Второй раз с того же порта не уплыть, повторная высадка невозможна.
    const again = await app.inject({ method: "POST", url: `/api/games/${gameId}/edge-tasks/${sea.id}/land`, headers: { cookie: capCookie }, payload: { nodeKey: cand[1]!.key } });
    expect(again.statusCode).toBe(409);
    expect((m2.tasks as Task[]).filter((t) => t.sea)).toHaveLength(1);
    // В прогрессе для админа переправа — пройденная сторона от порта к месту высадки.
    const progress = await app.inject({ method: "GET", url: `/api/games/${gameId}/progress`, headers: { cookie: adminCookie } });
    const t1 = (progress.json().teams as Array<{ id: string; traversed: Array<{ fromKey: string; toKey: string }> }>).find((x) => x.id === team1)!;
    expect(t1.traversed.some((e) => e.fromKey === portKey && e.toKey === cand[0]!.key)).toBe(true);
    expect(t1.traversed.every((e) => !e.toKey.startsWith("sea:"))).toBe(true);
  });

  it("взятый порт на Новом Завете даёт обратный морской путь", async () => {
    const ntPort = await prisma.mapNode.findFirstOrThrow({ where: { gameId, kind: "CITY", coastal: true, island: "NT" } });
    await app.inject({ method: "POST", url: `/api/games/${gameId}/cities/${ntPort.key}/assign`, headers: { cookie: adminCookie }, payload: { teamId: team1 } });
    const sea = ((await myMap()).tasks as Task[]).filter((t) => t.sea && t.status === "OPEN");
    expect(sea.map((t) => t.fromKey)).toContain(ntPort.key);
  });
});
