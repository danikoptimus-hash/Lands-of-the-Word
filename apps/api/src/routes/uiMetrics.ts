import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";

const Body = z.object({
  page: z.enum(["map", "admin-map", "other"]),
  device: z.enum(["phone", "desktop"]),
  browser: z.enum(["chrome", "safari", "firefox", "other"]),
  os: z.enum(["android", "ios", "windows", "mac", "linux", "other"]),
  dpr: z.number().min(0.5).max(5),
  viewW: z.number().int().min(100).max(10000),
  viewH: z.number().int().min(100).max(10000),
  ttfb: z.number().int().min(0).max(120000).nullable().optional(),
  fcp: z.number().int().min(0).max(120000).nullable().optional(),
  lcp: z.number().int().min(0).max(120000).nullable().optional(),
  load: z.number().int().min(0).max(120000).nullable().optional(),
  fps: z.number().min(0).max(240).nullable().optional(),
  jank: z.number().min(0).max(1).nullable().optional(),
  longTasks: z.number().int().min(0).max(10000).nullable().optional(),
  memoryMb: z.number().int().min(0).max(1_000_000).nullable().optional(),
});

/** Приём замеров интерфейса с устройств (sendBeacon). Только от вошедших, не чаще 30 в минуту с адреса. */
export async function uiMetricRoutes(app: FastifyInstance) {
  // sendBeacon шлёт text/plain — разбираем сами.
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_req, body, done) => { try { done(null, JSON.parse(body as string)); } catch (e) { done(e as Error); } });
  app.post("/api/metrics/ui", { preHandler: requireUser, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const b = Body.parse(request.body);
    await prisma.uiMetric.create({ data: { ...b, ttfb: b.ttfb ?? null, fcp: b.fcp ?? null, lcp: b.lcp ?? null, load: b.load ?? null, fps: b.fps ?? null, jank: b.jank ?? null, longTasks: b.longTasks ?? null, memoryMb: b.memoryMb ?? null } });
    return reply.code(204).send();
  });
}
