import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import { err } from "../services/i18n.js";
import { streamsClosing, subscribe } from "../services/events.js";
import { gameMembership } from "../services/membership.js";
import { WIRE } from "../services/mapWire.js";

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

    // Сервер уже останавливается (выкладка): поток не открываем — приложение переподключится к новому серверу.
    if (streamsClosing()) return reply.code(503).header("Retry-After", "2").send({ error: "restarting" });
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // Пауза переподключения — случайная, от 2 до 10 секунд (ревизия 15.11): с одинаковой паузой в 3 секунды все приложения
    // после перезапуска сервера возвращались одновременно и разом перечитывали всё на ещё «холодный» сервер.
    // В приветствии — период биения: приложение включает «сторожа» канала сразу, не дожидаясь первого биения (иначе канал,
    // умерший в первые 25 секунд, считался живым до конца сеанса — находка независимого разбора 16.11).
    reply.raw.write(`retry: ${2000 + Math.floor(Math.random() * 8000)}\nevent: hello\ndata: {"hb":25}\n\n`);
    // Команда — всегда своя; «нужно всё» — администратору и наблюдателю. Администратор, играющий в команде, получает и
    // «разницу» карты своей команды, и события всех команд.
    const unsubscribe = subscribe(id, reply, member?.teamId ?? null, Boolean(admin) || request.user!.platformRole === "SUPERADMIN", (request.query as { w?: string }).w === WIRE);
    // Биение — именованным событием (ревизия скорости, этап 2): приложение видит, что канал жив, и пока он жив, не опрашивает
    // сервер по таймеру. Прежние версии приложения незнакомое событие просто пропускают.
    const heartbeat = setInterval(() => { try { reply.raw.write(`event: hb\ndata: {}\n\n`); } catch { /* закрыто */ } }, 25000);
    request.raw.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
    // Ответ отдаём вручную, Fastify его не завершает.
    return reply;
  });
}
