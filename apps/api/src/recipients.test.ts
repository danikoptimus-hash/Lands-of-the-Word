import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
const adminNick = `radm_${stamp}`, p1Nick = `rp1_${stamp}`, p2Nick = `rp2_${stamp}`;
let adminCookie = "", p1Cookie = "", p2Cookie = "", gameId = "", team1 = "", rutKey = "";

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

beforeAll(async () => {
  await app.ready();
  adminCookie = await register(adminNick); p1Cookie = await register(p1Nick); p2Cookie = await register(p2Nick);
  const g = await app.inject({ method: "POST", url: "/api/games", headers: { cookie: adminCookie }, payload: { name: "Конверты", teamCount: 2 } });
  gameId = g.json().game.id;
  await app.inject({ method: "POST", url: `/api/games/${gameId}/generate`, headers: { cookie: adminCookie } });
  team1 = await joinTeam("Львы", p1Cookie);
  await joinTeam("Орлы", p2Cookie);
  await app.inject({ method: "POST", url: `/api/games/${gameId}/deeds/import-default`, headers: { cookie: adminCookie } });
  rutKey = (await prisma.mapNode.findFirstOrThrow({ where: { gameId, bookCode: "rut" } })).key;
});

afterAll(async () => {
  await prisma.game.deleteMany({ where: { id: gameId } });
  await prisma.user.deleteMany({ where: { nickname: { in: [adminNick, p1Nick, p2Nick] } } });
  await app.close();
  await prisma.$disconnect();
});

describe("адресаты конвертов", () => {
  it("без адресатов ярлыки не выдаются; игрок к списку не допущен", async () => {
    const r = await app.inject({ method: "GET", url: `/api/games/${gameId}/labels`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(409);
    const f = await app.inject({ method: "GET", url: `/api/games/${gameId}/recipients`, headers: { cookie: p1Cookie } });
    expect(f.statusCode).toBe(403);
  });

  it("адресаты раздаются по кругу всем 66 городам, ключи и шифры есть уже до старта", async () => {
    for (const [label, kind] of [["семья у реки", "FAMILY"], ["бабушка с Садовой", "WIDOW"], ["дедушка-сторож", "ELDER"]]) {
      const c = await app.inject({ method: "POST", url: `/api/games/${gameId}/recipients`, headers: { cookie: adminCookie }, payload: { label, kind } });
      expect(c.statusCode).toBe(201);
    }
    const r = await app.inject({ method: "GET", url: `/api/games/${gameId}/labels`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(200);
    const labels = r.json().labels as Array<{ number: number; cityKey: string; cityCode: string; recipient: { label: string } | null }>;
    expect(labels).toHaveLength(66);
    expect(labels[0]!.number).toBe(1);
    expect(labels.every((l) => /^[A-Z2-9]{6}$/.test(l.cityKey) && l.cityCode.length >= 4 && l.recipient)).toBe(true);
    const counts = new Map<string, number>();
    for (const l of labels) counts.set(l.recipient!.label, (counts.get(l.recipient!.label) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([22, 22, 22]);
    // Повторный запрос ничего не перераспределяет.
    const again = await app.inject({ method: "GET", url: `/api/games/${gameId}/labels`, headers: { cookie: adminCookie } });
    expect(again.json().labels.map((l: { recipient: { label: string } }) => l.recipient.label)).toEqual(labels.map((l) => l.recipient!.label));
    const list = await app.inject({ method: "GET", url: `/api/games/${gameId}/recipients`, headers: { cookie: adminCookie } });
    expect(list.json().recipients.map((x: { envelopes: number }) => x.envelopes)).toEqual([22, 22, 22]);
  });

  it("один PDF со всеми ярлыками: скачивание, кириллический шрифт, только для админа", async () => {
    const denied = await app.inject({ method: "GET", url: `/api/games/${gameId}/labels.pdf`, headers: { cookie: p1Cookie } });
    expect(denied.statusCode).toBe(403);
    const r = await app.inject({ method: "GET", url: `/api/games/${gameId}/labels.pdf`, headers: { cookie: adminCookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect(r.headers["content-disposition"]).toContain("attachment");
    expect(r.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.rawPayload.length).toBeGreaterThan(20_000);
  });

  it("команда видит адресата только когда все задания города решены; после финиша список стёрт", async () => {
    const start = await app.inject({ method: "POST", url: `/api/games/${gameId}/start`, headers: { cookie: adminCookie } });
    expect(start.statusCode).toBe(200);
    await prisma.teamNodeState.create({ data: { teamId: team1, nodeKey: rutKey } });
    const before = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-city/${encodeURIComponent(rutKey)}`, headers: { cookie: p1Cookie } });
    expect(before.json().recipient).toBeNull();
    await app.inject({ method: "POST", url: `/api/games/${gameId}/cities/${encodeURIComponent(rutKey)}/study`, headers: { cookie: adminCookie }, payload: { teamId: team1 } });
    const after = await app.inject({ method: "GET", url: `/api/games/${gameId}/my-city/${encodeURIComponent(rutKey)}`, headers: { cookie: p1Cookie } });
    expect(after.json().recipient?.label).toBeTruthy();
    const fin = await app.inject({ method: "POST", url: `/api/games/${gameId}/finish`, headers: { cookie: adminCookie }, payload: {} });
    expect(fin.statusCode).toBe(200);
    expect(await prisma.recipient.count({ where: { gameId } })).toBe(0);
    expect(await prisma.mapNode.count({ where: { gameId, recipientId: { not: null } } })).toBe(0);
  });
});
