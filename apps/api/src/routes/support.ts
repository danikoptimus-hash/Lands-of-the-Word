import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import { requireMember, requireSuperadmin } from "./teamMap.js";
import { loadCityContent } from "../services/cities.js";
import { sendMail } from "../services/mail.js";
import { getPublicUrl, notifyTeam } from "../services/notify.js";
import { publish } from "../services/events.js";
import { bookName, err, msg, type Locale } from "../services/i18n.js";
import { setSupportEmail, supportEmail, supportSettings } from "../services/support.js";

const requestBody = z.object({
  nodeKey: z.string().min(3).max(40).optional(),
  taskIndex: z.number().int().min(0).max(200).optional(),
  message: z.string().trim().min(5).max(1000),
});
const resolveBody = z.object({ reply: z.string().trim().max(1000).optional() });

interface Context { game: string; org: string; team: string | null; user: string; book: string | null; city: string | null; task: number | null; taskType: string | null; prompt: string | null; lockedUntil: string | null; readMin: number | null; doneTasks: number | null; totalTasks: number | null }

/**
 * Обращения в поддержку. Игрок пишет только текст; игра, команда, город, задание и текущая пауза
 * подставляются сервером. Письмо уходит на адрес поддержки, обращение остаётся в дашборде суперадмина.
 * Суперадмин отвечает; пауза после неверных ответов идёт своим чередом, снимать её нечем (решение владельца 3.19).
 */
export async function supportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  app.post("/api/games/:id/support", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const m = await requireMember(request, reply, id);
    if (!m) return;
    const body = requestBody.parse(request.body);
    const game = await prisma.game.findUniqueOrThrow({ where: { id }, select: { name: true, org: { select: { name: true } } } });
    const ctx: Context = { game: game.name, org: game.org.name, team: m.team.name, user: request.user!.nickname, book: null, city: null, task: null, taskType: null, prompt: null, lockedUntil: null, readMin: null, doneTasks: null, totalTasks: null };
    let bookCode: string | null = null;
    if (body.nodeKey) {
      const node = await prisma.mapNode.findUnique({ where: { gameId_key: { gameId: id, key: body.nodeKey } }, select: { bookCode: true, kind: true } });
      if (!node || node.kind !== "CITY") return reply.code(404).send({ error: "not_found", message: err(request, "Город не найден") });
      bookCode = node.bookCode;
      ctx.book = bookCode; ctx.city = bookName(bookCode ?? "", "ru");
      const content = bookCode ? await loadCityContent(bookCode) : null;
      const state = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: m.team.id, nodeKey: body.nodeKey } } });
      ctx.doneTasks = state?.doneTasks.length ?? 0; ctx.totalTasks = content?.tasks.length ?? null;
      if (body.taskIndex !== undefined) {
        const task = content?.tasks[body.taskIndex];
        if (!task) return reply.code(404).send({ error: "not_found", message: err(request, "Задание не найдено") });
        ctx.task = body.taskIndex + 1; ctx.taskType = task.type; ctx.prompt = task.prompt;
        const lock = await prisma.teamTaskLock.findUnique({ where: { teamId_nodeKey_taskIndex: { teamId: m.team.id, nodeKey: body.nodeKey, taskIndex: body.taskIndex } } });
        const locked = lock?.lockedUntil && lock.lockedUntil.getTime() > Date.now();
        ctx.lockedUntil = locked ? lock!.lockedUntil!.toISOString() : null;
      }
    }
    const row = await prisma.supportRequest.create({ data: { gameId: id, teamId: m.team.id, userId: request.user!.id, nodeKey: body.nodeKey ?? null, bookCode, taskIndex: body.taskIndex ?? null, message: body.message, context: ctx as object } });
    const to = await supportEmail();
    if (to) {
      const lines = [
        `Игра: ${ctx.game} (${ctx.org})`, `Команда: ${ctx.team ?? "—"}`, `Написал: ${ctx.user}`,
        ctx.city ? `Город: ${ctx.city} (${ctx.book})` : null,
        ctx.task ? `Задание ${ctx.task} (${ctx.taskType}): ${ctx.prompt}` : null,
        ctx.task ? `Состояние: решено ${ctx.doneTasks}/${ctx.totalTasks}, ${ctx.lockedUntil ? "пауза до " + new Date(ctx.lockedUntil).toLocaleString("ru-RU") : "без паузы"}` : null,
        "", "Сообщение:", body.message, "",
        `Ответить: ${getPublicUrl()}/admin#support`,
      ].filter((l): l is string => l !== null);
      void sendMail({ to, subject: `Поддержка: ${ctx.game} · ${ctx.team ?? ctx.user}${ctx.city ? " · " + ctx.city : ""}${ctx.task ? " · задание " + ctx.task : ""}`, text: lines.join("\n") }).catch(() => undefined);
    }
    publish(id, { type: "cities", teamId: m.team.id });
    return reply.code(201).send({ ok: true, id: row.id });
  });

  /** Суперадмин: обращения (открытые первыми). */
  app.get("/api/admin/support", async (request, reply) => {
    if (!requireSuperadmin(request, reply)) return;
    const q = z.object({ status: z.enum(["OPEN", "CLOSED", "ALL"]).default("OPEN") }).parse(request.query ?? {});
    const rows = await prisma.supportRequest.findMany({
      where: q.status === "ALL" ? {} : { status: q.status },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200,
      include: { game: { select: { name: true } }, team: { select: { name: true, color: true } }, user: { select: { nickname: true } } },
    });
    return { requests: rows.map((r) => ({ id: r.id, createdAt: r.createdAt, status: r.status, game: r.game.name, team: r.team ? { name: r.team.name, color: r.team.color } : null, user: r.user.nickname, bookCode: r.bookCode, taskIndex: r.taskIndex, message: r.message, context: r.context, reply: r.reply, resolvedAt: r.resolvedAt })) };
  });

  /** Суперадмин: ответ по обращению. Команда получает уведомление; пауза задания не трогается. */
  app.post("/api/admin/support/:id/resolve", async (request, reply) => {
    if (!requireSuperadmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = resolveBody.parse(request.body);
    const r = await prisma.supportRequest.findUnique({ where: { id } });
    if (!r) return reply.code(404).send({ error: "not_found", message: err(request, "Обращение не найдено") });
    if (r.status === "CLOSED") return reply.code(409).send({ error: "conflict", message: err(request, "Обращение уже закрыто") });
    await prisma.supportRequest.update({ where: { id }, data: { status: "CLOSED", reply: body.reply || null, resolvedAt: new Date() } });
    if (r.teamId) {
      const vars = { book: r.bookCode ?? "" };
      const answer = (locale: Locale) => body.reply || msg(locale, "обращение рассмотрено");
      if (r.taskIndex !== null) {
        notifyTeam(r.gameId, r.teamId, r.bookCode ? "ответ поддержки по заданию города {book}" : "ответ поддержки", (locale) => msg(locale, "Задание {n}. Ответ поддержки: {answer}", { n: r.taskIndex! + 1, answer: answer(locale) }), vars);
      } else {
        notifyTeam(r.gameId, r.teamId, "ответ поддержки", (locale) => msg(locale, "Ответ поддержки: {answer}", { answer: answer(locale) }));
      }
      publish(r.gameId, { type: "cities", teamId: r.teamId });
    }
    return { ok: true };
  });

  /** Суперадмин: адрес для обращений. Пусто — почта первого администратора платформы. */
  app.get("/api/admin/settings", async (request, reply) => {
    if (!requireSuperadmin(request, reply)) return;
    return supportSettings();
  });
  app.patch("/api/admin/settings", async (request, reply) => {
    if (!requireSuperadmin(request, reply)) return;
    const body = z.object({ supportEmail: z.string().trim().email().max(200).or(z.literal("")).nullable() }).parse(request.body);
    await setSupportEmail(body.supportEmail || null);
    return supportSettings();
  });
}
