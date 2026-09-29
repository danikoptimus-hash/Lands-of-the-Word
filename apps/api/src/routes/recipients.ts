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

  /**
   * Возврат шифров и ключей из напечатанных ярлыков (инцидент 29.09: старт игры перегенерировал их после печати).
   * Только администратор платформы. Текст — строки «книга, шифр, ключ» через табуляцию, «|» или два пробела; книга —
   * названием (RU/EN) или кодом. Проверки: книга есть в игре, шифр той же длины, что нынешний (по числу заданий), ключ —
   * 6 знаков A–Z и 2–9. Применяется целиком или никак.
   */
  app.post("/api/games/:id/labels/restore", async (request, reply) => {
    const { id } = request.params as { id: string };
    const game = await requireGameAdmin(request, reply, id);
    if (!game) return;
    if (request.user!.platformRole !== "SUPERADMIN") return reply.code(403).send({ error: "forbidden", message: err(request, "Только администратор платформы") });
    const body = z.object({ text: z.string().max(40_000) }).parse(request.body);
    const nodes = await prisma.mapNode.findMany({ where: { gameId: id, kind: "CITY" }, select: { id: true, bookCode: true, cityCode: true } });
    const byBook = new Map(nodes.map((n) => [n.bookCode ?? "", n]));
    const bookByName = new Map<string, string>();
    for (const b of BOOKS) { bookByName.set(b.code, b.code); bookByName.set(b.nameRu.toLowerCase(), b.code); bookByName.set(b.nameEn.toLowerCase(), b.code); }
    const errors: string[] = []; const updates: Array<{ id: string; key: string; code: string }> = []; const seen = new Set<string>();
    body.text.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim(); if (!line) return;
      const parts = line.split(/\t|\s{2,}|\s*\|\s*|\s*[;,]\s*/).map((x) => x.trim()).filter(Boolean);
      if (parts.length < 3) { errors.push(`${i + 1}: нужно «книга, шифр, ключ»`); return; }
      const key = parts[parts.length - 1]!.toUpperCase(), code = parts[parts.length - 2]!.toUpperCase(), name = parts.slice(0, -2).join(" ").toLowerCase();
      const book = bookByName.get(name), node = book ? byBook.get(book) : undefined;
      if (!node) { errors.push(`${i + 1}: книга «${parts.slice(0, -2).join(" ")}» не найдена`); return; }
      if (seen.has(node.id)) { errors.push(`${i + 1}: книга повторяется`); return; }
      if (!/^[A-Z2-9]{6}$/.test(key)) { errors.push(`${i + 1}: ключ — 6 знаков A–Z и 2–9`); return; }
      if (!/^[А-ЯЁ2-9]+$/.test(code) || (node.cityCode && code.length !== node.cityCode.length)) { errors.push(`${i + 1}: шифр должен быть из ${node.cityCode?.length ?? "?"} знаков (буквы и цифры 2–9)`); return; }
      seen.add(node.id); updates.push({ id: node.id, key, code });
    });
    if (errors.length) return reply.code(400).send({ error: "bad_request", message: err(request, "Ошибки в строках: {list}", { list: errors.slice(0, 6).join("; ") }) });
    if (updates.length === 0) return reply.code(400).send({ error: "bad_request", message: err(request, "Нет ни одной строки") });
    await prisma.$transaction(updates.map((u) => prisma.mapNode.update({ where: { id: u.id }, data: { cityKey: u.key, cityCode: u.code } })));
    publish(id, { type: "cities" });
    return { ok: true, updated: updates.length, total: nodes.length };
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
