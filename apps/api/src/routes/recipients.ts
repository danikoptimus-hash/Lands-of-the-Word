import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { BOOKS } from "@lotw/domain";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { assignRecipients, ensureCityCodes } from "../services/recipients.js";

const recipientBody = z.object({ label: z.string().trim().min(2).max(60), kind: z.enum(["FAMILY", "WIDOW", "ELDER", "OTHER"]).default("FAMILY") });

async function requireGameAdmin(request: FastifyRequest, reply: FastifyReply, gameId: string) {
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { admins: { select: { userId: true } } } });
  if (!game) { await reply.code(404).send({ error: "not_found", message: "Игра не найдена" }); return null; }
  if (!game.admins.some((a) => a.userId === request.user!.id)) { await reply.code(403).send({ error: "forbidden", message: "Вы не администратор этой игры" }); return null; }
  return game;
}

/** Адресаты конвертов (админ) и ярлыки для печати. */
export async function recipientRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  app.get("/api/games/:id/recipients", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const rows = await prisma.recipient.findMany({ where: { gameId: id }, orderBy: { createdAt: "asc" }, include: { _count: { select: { nodes: true } } } });
    const cities = await prisma.mapNode.count({ where: { gameId: id, kind: "CITY" } });
    return { recipients: rows.map((r) => ({ id: r.id, label: r.label, kind: r.kind, envelopes: r._count.nodes })), cities };
  });

  app.post("/api/games/:id/recipients", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return;
    if (game.status === "FINISHED") return reply.code(409).send({ error: "conflict", message: "Игра завершена: список адресатов очищен" });
    const body = recipientBody.parse(request.body);
    const count = await prisma.recipient.count({ where: { gameId: id } });
    if (count >= 200) return reply.code(409).send({ error: "conflict", message: "Слишком много адресатов" });
    const r = await prisma.recipient.create({ data: { gameId: id, label: body.label, kind: body.kind } });
    publish(id, { type: "game" });
    return reply.code(201).send({ recipient: { id: r.id, label: r.label, kind: r.kind, envelopes: 0 } });
  });

  app.delete("/api/games/:id/recipients/:rid", async (request, reply) => {
    const { id, rid } = request.params as { id: string; rid: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const r = await prisma.recipient.findFirst({ where: { id: rid, gameId: id } });
    if (!r) return reply.code(404).send({ error: "not_found", message: "Адресат не найден" });
    // Города этого адресата освобождаются и при следующей печати ярлыков получат другого.
    await prisma.recipient.delete({ where: { id: rid } });
    publish(id, { type: "game" });
    return { ok: true };
  });

  /** Данные для ярлыков: по городу — книга, шифр для семьи, ключ конверта, адресат. Только для админа. */
  app.get("/api/games/:id/labels", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return;
    const recipients = await prisma.recipient.count({ where: { gameId: id } });
    if (recipients === 0) return reply.code(409).send({ error: "no_recipients", message: "Сначала добавьте адресатов конвертов на вкладке «Дела»" });
    await ensureCityCodes(id);
    await assignRecipients(id);
    const nodes = await prisma.mapNode.findMany({ where: { gameId: id, kind: "CITY" }, include: { recipient: { select: { label: true, kind: true } } } });
    const order = new Map(BOOKS.map((b) => [b.code, b]));
    const rows = nodes
      .map((n) => ({ nodeKey: n.key, bookCode: n.bookCode ?? "", number: order.get(n.bookCode ?? "")?.order ?? 0, name: order.get(n.bookCode ?? "")?.nameRu ?? n.bookCode ?? "", cityKey: n.cityKey ?? "", cityCode: n.cityCode ?? "", recipient: n.recipient }))
      .sort((a, b) => a.number - b.number);
    return { game: { name: game.name }, labels: rows };
  });
}
