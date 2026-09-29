import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { BOOKS } from "@lotw/domain";
import { prisma } from "../db.js";
import { publish } from "../services/events.js";
import { requireUser } from "../auth.js";
import { assignRecipients, ensureCityCodes } from "../services/recipients.js";
import { renderLabelsPdf } from "../services/labelsPdf.js";
import { bookName, err, toLocale } from "../services/i18n.js";

const recipientBody = z.object({ label: z.string().trim().min(2).max(60), kind: z.enum(["FAMILY", "WIDOW", "ELDER", "OTHER"]).default("FAMILY") });

async function requireGameAdmin(request: FastifyRequest, reply: FastifyReply, gameId: string) {
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { admins: { select: { userId: true } } } });
  if (!game) { await reply.code(404).send({ error: "not_found", message: err(request, "Игра не найдена") }); return null; }
  if (!game.admins.some((a) => a.userId === request.user!.id)) { await reply.code(403).send({ error: "forbidden", message: err(request, "Вы не администратор этой игры") }); return null; }
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
    if (game.status === "FINISHED") return reply.code(409).send({ error: "conflict", message: err(request, "Игра завершена: список адресатов очищен") });
    const body = recipientBody.parse(request.body);
    const count = await prisma.recipient.count({ where: { gameId: id } });
    if (count >= 200) return reply.code(409).send({ error: "conflict", message: err(request, "Слишком много адресатов") });
    const r = await prisma.recipient.create({ data: { gameId: id, label: body.label, kind: body.kind } });
    publish(id, { type: "game" });
    return reply.code(201).send({ recipient: { id: r.id, label: r.label, kind: r.kind, envelopes: 0 } });
  });

  /**
   * Перераспределить конверты поровну между всеми адресатами. Нужно, когда адресатов добавили после того,
   * как все города уже разошлись по первым. Напечатанные ранее ярлыки после этого устаревают — интерфейс предупреждает.
   */
  app.post("/api/games/:id/recipients/redistribute", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return;
    if (game.status === "FINISHED") return reply.code(409).send({ error: "conflict", message: err(request, "Игра завершена: список адресатов очищен") });
    const count = await prisma.recipient.count({ where: { gameId: id } });
    if (count === 0) return reply.code(409).send({ error: "conflict", message: err(request, "Сначала добавьте адресатов") });
    await prisma.mapNode.updateMany({ where: { gameId: id, kind: "CITY" }, data: { recipientId: null } });
    const assigned = await assignRecipients(id);
    // Прежние ярлыки устарели: отметка о скачивании снимается, чек-лист старта снова попросит скачать PDF.
    const { labelsPrintedAt: _printed, ...settings } = (game.settings ?? {}) as Record<string, unknown>;
    await prisma.game.update({ where: { id }, data: { settings: settings as object } });
    publish(id, { type: "game" });
    return { ok: true, assigned };
  });

  app.delete("/api/games/:id/recipients/:rid", async (request, reply) => {
    const { id, rid } = request.params as { id: string; rid: string };
    if (!(await requireGameAdmin(request, reply, id))) return;
    const r = await prisma.recipient.findFirst({ where: { id: rid, gameId: id } });
    if (!r) return reply.code(404).send({ error: "not_found", message: err(request, "Адресат не найден") });
    // Города этого адресата освобождаются и при следующей печати ярлыков получат другого.
    await prisma.recipient.delete({ where: { id: rid } });
    publish(id, { type: "game" });
    return { ok: true };
  });

  /** Строки ярлыков: по городу — книга, шифр для семьи, ключ конверта, адресат. Названия книг на языке админа. */
  async function labelRows(request: FastifyRequest, reply: FastifyReply, id: string) {
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return null;
    const recipients = await prisma.recipient.count({ where: { gameId: id } });
    if (recipients === 0) { await reply.code(409).send({ error: "no_recipients", message: err(request, "Сначала добавьте адресатов конвертов на вкладке «Обзор»") }); return null; }
    await ensureCityCodes(id);
    await assignRecipients(id);
    const locale = toLocale(request.user!.locale);
    const nodes = await prisma.mapNode.findMany({ where: { gameId: id, kind: "CITY" }, include: { recipient: { select: { label: true, kind: true } } } });
    const order = new Map(BOOKS.map((b) => [b.code, b]));
    const rows = nodes
      .map((n) => ({ nodeKey: n.key, bookCode: n.bookCode ?? "", number: order.get(n.bookCode ?? "")?.order ?? 0, name: bookName(n.bookCode ?? "", locale), cityKey: n.cityKey ?? "", cityCode: n.cityCode ?? "", recipient: n.recipient }))
      .sort((a, b) => a.number - b.number);
    return { game, rows, locale };
  }

  app.get("/api/games/:id/labels", async (request, reply) => {
    const { id } = request.params as { id: string };
    const r = await labelRows(request, reply, id);
    if (!r) return;
    return { game: { name: r.game.name }, labels: r.rows };
  });

  /** Готовый PDF со всеми ярлыками одним файлом (скачивание). */
  app.get("/api/games/:id/labels.pdf", async (request, reply) => {
    const { id } = request.params as { id: string };
    const r = await labelRows(request, reply, id);
    if (!r) return;
    const pdf = await renderLabelsPdf(r.game.name, r.rows, r.locale);
    // Чек-лист старта (3.18): ярлыки скачаны — отметка в настройках игры, без миграции схемы.
    await prisma.game.update({ where: { id }, data: { settings: { ...((r.game.settings ?? {}) as Record<string, unknown>), labelsPrintedAt: new Date().toISOString() } } });
    publish(id, { type: "game" });
    const file = (r.locale === "en" ? "envelope-labels" : "yarlyki-konvertov") + ".pdf";
    return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="${file}"`).header("Cache-Control", "no-store").send(pdf);
  });
}
