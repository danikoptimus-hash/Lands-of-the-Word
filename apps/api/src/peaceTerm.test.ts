import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { invalidateViews } from "./services/views.js";
import { cleanupFixtures, readyForStart, registerVerified, setGamePhase } from "./testAuth.js";
import { expirePeaces, peaceBetween } from "./services/peace.js";

/** Мир на срок (решение владельца 22.10): расторгнуть раньше нельзя, по истечении кончается сам; «до конца игры» — навсегда. */
const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now() % 100000;
const nicks = { admin: `pt_adm_${stamp}`, cap1: `pt_c1_${stamp}`, cap2: `pt_c2_${stamp}`, cap3: `pt_c3_${stamp}` };
const ck: Record<keyof typeof nicks, string> = { admin: "", cap1: "", cap2: "", cap3: "" };
let gameId = "", t1 = "", t2 = "", t3 = "";
const post = (url: string, cookie: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: { cookie }, payload: payload as Record<string, unknown> });
const get = (url: string, cookie: string) => app.inject({ method: "GET", url, headers: { cookie } });
beforeAll(async () => {
  await app.ready();
  for (const k of Object.keys(nicks) as Array<keyof typeof nicks>) { const r = await registerVerified(app, { nickname: nicks[k], password: "secret123" }); ck[k] = r.headers["set-cookie"] as string; }
  gameId = (await post("/api/games", ck.admin, { name: "Мир на срок", teamCount: 3 })).json().game.id;
  await post(`/api/games/${gameId}/generate`, ck.admin);
  const mk = async (name: string, cookie: string) => { const tid = (await post(`/api/games/${gameId}/teams`, ck.admin, { name })).json().team.id; const inv = await post(`/api/games/${gameId}/teams/${tid}/invites`, ck.admin, { role: "CAPTAIN" }); await post(`/api/invites/${inv.json().invite.token}/accept`, cookie); return tid; };
  t1 = await mk("Первые", ck.cap1); t2 = await mk("Вторые", ck.cap2); t3 = await mk("Третьи", ck.cap3);
  await post(`/api/games/${gameId}/deeds/import-default`, ck.admin);
  await readyForStart(app, gameId, ck.admin);
  await setGamePhase(app, gameId, ck.admin, "day");
  const st = await post(`/api/games/${gameId}/start`, ck.admin); expect(st.statusCode, st.body).toBe(200);
});
afterAll(async () => { await cleanupFixtures(gameId); await prisma.game.deleteMany({ where: { id: gameId } }); await prisma.user.deleteMany({ where: { nickname: { in: Object.values(nicks) } } }); await app.close(); });

const viewOf = async (cookie: string, teamId: string) => ((await get(`/api/games/${gameId}/peace`, cookie)).json().teams as Array<{ team: { id: string }; state: string; peaceId: string | null; days: number | null; until: string | null; breakable: boolean }>).find((x) => x.team.id === teamId)!;

describe("мир на срок", () => {
  it("без срока предложить нельзя; мир на 7 дней не расторгается и кончается сам", async () => {
    expect((await post(`/api/games/${gameId}/peace`, ck.cap1, { teamId: t2 })).statusCode).toBe(400);
    expect((await post(`/api/games/${gameId}/peace`, ck.cap1, { teamId: t2, days: 7 })).statusCode).toBe(200);
    const incoming = await viewOf(ck.cap2, t1);
    expect(incoming.state).toBe("incoming"); expect(incoming.days).toBe(7);
    expect((await post(`/api/games/${gameId}/peace/${incoming.peaceId}/accept`, ck.cap2)).statusCode).toBe(200);
    const peace = await viewOf(ck.cap1, t2);
    expect(peace.state).toBe("peace"); expect(peace.breakable).toBe(false);
    expect(peace.until && Date.parse(peace.until) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(await peaceBetween(gameId, t1, t2)).toBe(true);
    // Расторгнуть нельзя ни одной стороне.
    expect((await post(`/api/games/${gameId}/peace/${peace.peaceId}/break`, ck.cap1)).statusCode).toBe(409);
    expect((await post(`/api/games/${gameId}/peace/${peace.peaceId}/break`, ck.cap2)).statusCode).toBe(409);
    // Срок вышел: мир кончается сам, вызовы снова возможны, новость всем.
    await prisma.peace.update({ where: { id: peace.peaceId! }, data: { until: new Date(Date.now() - 1000) } });
    expect(await peaceBetween(gameId, t1, t2)).toBe(false);
    expect(await expirePeaces(gameId)).toBe(1);
    expect((await viewOf(ck.cap1, t2)).state).toBe("none");
    for (let i = 0; i < 20; i++) {
      const items = (await get(`/api/games/${gameId}/journal`, ck.admin)).json().items as Array<{ kind: string }>;
      if (items.some((it) => it.kind === "peace_ended")) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const items = (await get(`/api/games/${gameId}/journal`, ck.admin)).json().items as Array<{ kind: string; everyone: boolean }>;
    expect(items.find((it) => it.kind === "peace_ended")?.everyone).toBe(true);
  });
  it("«до конца игры» предложить нельзя; старый мир без срока расторгается", async () => {
    expect((await post(`/api/games/${gameId}/peace`, ck.cap1, { teamId: t3, days: 0 })).statusCode).toBe(400);
    expect((await post(`/api/games/${gameId}/peace`, ck.cap1, { teamId: t3, days: 30 })).statusCode).toBe(200);
    const inc = await viewOf(ck.cap3, t1);
    expect((await post(`/api/games/${gameId}/peace/${inc.peaceId}/accept`, ck.cap3)).statusCode).toBe(200);
    const forever = await viewOf(ck.cap1, t3);
    expect(forever.state).toBe("peace"); expect(forever.days).toBe(30); expect(forever.breakable).toBe(false);
    expect((await post(`/api/games/${gameId}/peace/${forever.peaceId}/break`, ck.cap3)).statusCode).toBe(409);
    // Старый мир (days = null) расторгается, как раньше.
    await prisma.peace.update({ where: { id: forever.peaceId! }, data: { days: null, until: null } });
    invalidateViews(gameId); // правка прямо в базе, мимо событий: готовый ответ о мире надо сбросить вручную
    expect((await viewOf(ck.cap1, t3)).breakable).toBe(true);
    expect((await post(`/api/games/${gameId}/peace/${forever.peaceId}/break`, ck.cap3)).statusCode).toBe(200);
    expect((await viewOf(ck.cap1, t3)).state).toBe("none");
  });
});
