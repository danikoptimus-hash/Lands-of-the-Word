import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import { err } from "../services/i18n.js";
import { isLeader, requireActiveMember, requireAdmin } from "./teamMap.js";
import { decideVisit, expireVisits, submitVisit, visitView } from "../services/visits.js";
import { publish } from "../services/events.js";

const reportBody = z.object({
  members: z.array(z.string().min(1)).max(100),
  text: z.string().trim().max(4000),
  links: z.array(z.string().trim().url().max(500)).max(20),
});
const decideBody = z.object({ approve: z.boolean(), comment: z.string().trim().max(1000).default("") });

/** Отчёты о визитах к адресатам конвертов (решение владельца 22.10). */
export async function visitRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  /** Капитан или заместитель сдаёт отчёт о визите; ночью тоже можно — срок до полуночи. */
  app.post("/api/games/:id/visits/:visitId/report", async (request, reply) => {
    const { id, visitId } = request.params as { id: string; visitId: string };
    const m = await requireActiveMember(request, reply, id);
    if (!m) return;
    if (!isLeader(m)) return reply.code(403).send({ error: "forbidden", message: err(request, "Отчёт о визите сдаёт капитан или заместитель") });
    const body = reportBody.parse(request.body);
    const r = await submitVisit(visitId, m.team.id, { ...body, userId: request.user!.id, userName: request.user!.displayName || request.user!.nickname });
    if (!r.ok) return reply.code(r.code === "not_found" ? 404 : 409).send({ error: r.code, message: err(request, r.message, r.vars) });
    return { ok: true };
  });

  /** Администратор: визиты игры — ждущие отчёта, на проверке и решённые. */
  app.get("/api/games/:id/visits", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireAdmin(request, reply, id))) return;
    await expireVisits(id);
    const rows = await prisma.cityVisit.findMany({ where: { gameId: id }, orderBy: { createdAt: "desc" }, take: 200, include: { team: { select: { id: true, index: true, name: true, color: true, avatarId: true } } } });
    const visits = await Promise.all(rows.map(async (v) => ({ ...(await visitView(v)), team: v.team })));
    return { visits };
  });

  /** Администратор: принять или не принять отчёт; не принят — город свободен. */
  app.post("/api/games/:id/visits/:visitId/decide", async (request, reply) => {
    const { id, visitId } = request.params as { id: string; visitId: string };
    if (!(await requireAdmin(request, reply, id))) return;
    const body = decideBody.parse(request.body);
    const r = await decideVisit(visitId, id, body.approve, body.comment);
    if (!r.ok) return reply.code(r.code === "not_found" ? 404 : 409).send({ error: r.code, message: err(request, r.message) });
    publish(id, { type: "cities" });
    return { ok: true };
  });
}
