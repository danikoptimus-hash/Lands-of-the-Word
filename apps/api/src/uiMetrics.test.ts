import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { uiMetrics } from "./services/metrics.js";
import { registerVerified } from "./testAuth.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
let cookie = "";

beforeAll(async () => {
  // Сбор замеров по умолчанию выключен (решение владельца 16.11); в этих тестах он включён, кроме проверки ниже.
  process.env.LOTW_MEASURE = "1";
  await app.ready();
  const res = await registerVerified(app, { nickname: `ui_${stamp}`, password: "secret123", locale: "ru" });
  cookie = res.headers["set-cookie"] as string;
});
afterAll(async () => { await app.close(); await prisma.$disconnect(); });

const sample = { page: "map", device: "phone", browser: "chrome", os: "android", dpr: 2.75, viewW: 412, viewH: 860, ttfb: 120, fcp: 900, lcp: 1400, load: 1800, fps: 48.5, jank: 0.12, longTasks: 3, memoryMb: 4096 };

describe("замеры интерфейса", () => {
  it("принимаются только от вошедших, как JSON и как text/plain (sendBeacon)", async () => {
    expect((await app.inject({ method: "POST", url: "/api/metrics/ui", payload: sample })).statusCode).toBe(401);
    const a = await app.inject({ method: "POST", url: "/api/metrics/ui", headers: { cookie }, payload: sample });
    expect(a.statusCode).toBe(204);
    const b = await app.inject({ method: "POST", url: "/api/metrics/ui", headers: { cookie, "content-type": "text/plain" }, payload: JSON.stringify({ ...sample, device: "desktop", fps: 60, jank: 0 }) });
    expect(b.statusCode).toBe(204);
    const bad = await app.inject({ method: "POST", url: "/api/metrics/ui", headers: { cookie }, payload: { ...sample, fps: 999 } });
    expect(bad.statusCode).toBe(400);
  });

  it("при выключенном сборе адрес отвечает «принято» и ничего не записывает", async () => {
    const before = await prisma.uiMetric.count();
    delete process.env.LOTW_MEASURE;
    try {
      expect((await app.inject({ method: "POST", url: "/api/metrics/ui", headers: { cookie }, payload: sample })).statusCode).toBe(204);
      expect((await app.inject({ method: "POST", url: "/api/metrics/action", headers: { cookie }, payload: { action: "map-fit", page: "map", device: "phone" } })).statusCode).toBe(204);
    } finally { process.env.LOTW_MEASURE = "1"; }
    expect(await prisma.uiMetric.count()).toBe(before);
  });

  it("сводка считает медианы, среднее fps и разбивку по устройствам", async () => {
    const m = await uiMetrics(1);
    expect(m.samples).toBeGreaterThanOrEqual(2);
    // База может содержать и другие замеры, поэтому проверяется форма сводки, а не точные числа.
    expect(m.lcp.p50).not.toBeNull();
    expect(m.byDevice.phone?.n).toBeGreaterThanOrEqual(1);
    expect(m.byDevice.desktop?.n).toBeGreaterThanOrEqual(1);
    expect(m.byDevice.desktop?.fps).not.toBeNull();
    expect(m.fps.avg).not.toBeNull();
  });
});

describe("карта глазами команды", () => {
  it("доступна администратору игры и закрыта для чужих", async () => {
    const g = await app.inject({ method: "POST", url: "/api/games", headers: { cookie }, payload: { name: "Взгляд", teamCount: 2 } });
    const gameId = g.json().game.id;
    const tm = await app.inject({ method: "POST", url: `/api/games/${gameId}/teams`, headers: { cookie }, payload: { name: "Первая" } });
    const teamId = tm.json().team.id;
    const r = await app.inject({ method: "GET", url: `/api/games/${gameId}/teams/${teamId}/map`, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().team.name).toBe("Первая");
    expect(r.json().status).toBe("DRAFT");
    const other = await registerVerified(app, { nickname: `ui2_${stamp}`, password: "secret123", locale: "ru" });
    const denied = await app.inject({ method: "GET", url: `/api/games/${gameId}/teams/${teamId}/map`, headers: { cookie: other.headers["set-cookie"] as string } });
    expect(denied.statusCode).toBe(403);
  });
});
