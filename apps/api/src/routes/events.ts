import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import { err } from "../services/i18n.js";
import { subscribe } from "../services/events.js";
import { gameMembership } from "../services/membership.js";

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  /** Поток событий игры для админов и участников. */
  app.get("/api/games/:id/events", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [admin, member] = await Promise.all([
      prisma.gameAdmin.findUnique({ where: { gameId_userId: { gameId: id, userId: request.user!.id } } }),
      // События «своей» команды: из двух (выбывшая и новая, 10.11) — той, что в строю.
      gameMembership(request.user!.id, id),
    ]);
    // Наблюдатель (администратор платформы) тоже слушает события: поток только читает.
    if (!admin && !member && request.user!.platformRole !== "SUPERADMIN") return reply.code(403).send({ error: "forbidden", message: err(request, "Нет доступа к игре") });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`retry: 3000\nevent: hello\ndata: {}\n\n`);
    const unsubscribe = subscribe(id, reply, admin || request.user!.platformRole === "SUPERADMIN" ? null : member?.teamId ?? null);
    const heartbeat = setInterval(() => { try { reply.raw.write(`: ping\n\n`); } catch { /* закрыто */ } }, 25000);
    request.raw.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
    // Ответ отдаём вручную, Fastify его не завершает.
    return reply;
  });
}
