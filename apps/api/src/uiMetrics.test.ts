import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { prisma } from "./db.js";
import { uiMetrics } from "./services/metrics.js";

const app = await buildApp({ NODE_ENV: "test", SESSION_SECRET: "test-secret-please" });
const stamp = Date.now();
let cookie = "";

beforeAll(async () => {
  await app.ready();
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: `ui_${stamp}`, password: "secret123", locale: "ru" } });
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
