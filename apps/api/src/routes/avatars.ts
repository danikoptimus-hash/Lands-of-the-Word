import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import { err } from "../services/i18n.js";
import { publish } from "../services/events.js";
import { MAX_UPLOAD_BYTES, moderateImage, moderationEnabled, processAvatar } from "../services/avatars.js";

/**
 * Аватарки (решение владельца 24.10): участник ставит свою, капитан — командную. Загрузка: файл → сжатие → проверка
 * уместности OpenAI → запись в базу; неуместное отклоняется сразу. Суперадмин видит последние аватарки и может убрать
 * любую с запретом загрузившему. Картинки отдаются только вошедшим, с долгим кэшем: у каждой загрузки свой id.
 */
async function readImage(request: FastifyRequest, reply: FastifyReply): Promise<Buffer | null> {
  if (!moderationEnabled()) { await reply.code(503).send({ error: "unavailable", message: err(request, "Проверка фото сейчас недоступна, попробуйте позже") }); return null; }
  const file = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }).catch(() => null);
  if (!file) { await reply.code(400).send({ error: "validation", message: err(request, "Нужен файл с картинкой") }); return null; }
  if (!/^image\//.test(file.mimetype)) { await reply.code(400).send({ error: "validation", message: err(request, "Это не картинка") }); return null; }
  const raw = await file.toBuffer().catch(() => null);
  if (!raw || file.file.truncated) { await reply.code(413).send({ error: "too_large", message: err(request, "Файл больше 6 МБ") }); return null; }
  return raw;
}

/** Сжать, проверить, сохранить. Возвращает id новой аватарки или null (ответ уже отправлен). */
async function storeAvatar(request: FastifyRequest, reply: FastifyReply, raw: Buffer, uploadedById: string): Promise<string | null> {
  let image: Buffer;
  try { image = await processAvatar(raw); }
  catch { await reply.code(400).send({ error: "validation", message: err(request, "Не удалось прочитать картинку") }); return null; }
  let verdict;
  try { verdict = await moderateImage(image); }
  catch (e) { request.log.error(e, "avatar moderation failed"); await reply.code(503).send({ error: "unavailable", message: err(request, "Проверка фото сейчас недоступна, попробуйте позже") }); return null; }
  if (verdict.flagged) { await reply.code(422).send({ error: "inappropriate", message: err(request, "Фото не прошло проверку на уместность. Выберите другое.") }); return null; }
  const a = await prisma.avatar.create({ data: { data: new Uint8Array(image), mime: "image/webp", uploadedById, moderation: verdict.categories }, select: { id: true } });
  return a.id;
}

export async function avatarRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  /** Картинка аватарки: только вошедшим; id меняется с каждой загрузкой, поэтому кэш долгий. */
  app.get("/api/avatars/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const a = await prisma.avatar.findUnique({ where: { id }, select: { data: true, mime: true } });
    if (!a) return reply.code(404).send({ error: "not_found", message: "—" });
    return reply.header("content-type", a.mime).header("cache-control", "private, max-age=31536000, immutable").send(Buffer.from(a.data));
  });

  /** Своя аватарка. */
  app.post("/api/auth/me/avatar", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id }, select: { avatarId: true, avatarBlocked: true } });
    if (me.avatarBlocked) return reply.code(403).send({ error: "forbidden", message: err(request, "Загрузка аватарок вам закрыта") });
    const raw = await readImage(request, reply);
    if (!raw) return;
    const id = await storeAvatar(request, reply, raw, request.user!.id);
    if (!id) return;
    await prisma.user.update({ where: { id: request.user!.id }, data: { avatarId: id } });
    if (me.avatarId) await prisma.avatar.delete({ where: { id: me.avatarId } }).catch(() => {});
    await announceUser(request.user!.id);
    return reply.code(201).send({ avatarId: id });
  });
  app.delete("/api/auth/me/avatar", async (request, reply) => {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id }, select: { avatarId: true } });
    if (me.avatarId) { await prisma.user.update({ where: { id: request.user!.id }, data: { avatarId: null } }); await prisma.avatar.delete({ where: { id: me.avatarId } }).catch(() => {}); }
    await announceUser(request.user!.id);
    return reply.code(204).send();
  });

  /** Аватарка команды: только капитан. */
  app.post("/api/games/:id/teams/:teamId/avatar", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { id, teamId } = request.params as { id: string; teamId: string };
    const cap = await captainOf(request, reply, id, teamId);
    if (!cap) return;
    if (cap.blocked) return reply.code(403).send({ error: "forbidden", message: err(request, "Загрузка аватарок вам закрыта") });
    const raw = await readImage(request, reply);
    if (!raw) return;
    const avatarId = await storeAvatar(request, reply, raw, request.user!.id);
    if (!avatarId) return;
    await prisma.team.update({ where: { id: teamId }, data: { avatarId } });
    if (cap.avatarId) await prisma.avatar.delete({ where: { id: cap.avatarId } }).catch(() => {});
    publish(id, { type: "teams" });
    return reply.code(201).send({ avatarId });
  });
  app.delete("/api/games/:id/teams/:teamId/avatar", async (request, reply) => {
    const { id, teamId } = request.params as { id: string; teamId: string };
    const cap = await captainOf(request, reply, id, teamId);
    if (!cap) return;
    if (cap.avatarId) { await prisma.team.update({ where: { id: teamId }, data: { avatarId: null } }); await prisma.avatar.delete({ where: { id: cap.avatarId } }).catch(() => {}); }
    publish(id, { type: "teams" });
    return reply.code(204).send();
  });

  /** Суперадмин: последние аватарки и снятие с запретом. */
  app.get("/api/admin/avatars", async (request, reply) => {
    if (!(await requireSuper(request, reply))) return;
    // Осиротевшие картинки (участник или команда удалены) убираются здесь же, чтобы не копились.
    await prisma.avatar.deleteMany({ where: { user: null, team: null } });
    const rows = await prisma.avatar.findMany({
      orderBy: { createdAt: "desc" }, take: 200,
      select: { id: true, createdAt: true, moderation: true, uploadedBy: { select: { id: true, nickname: true, displayName: true, avatarBlocked: true } }, user: { select: { id: true, nickname: true, displayName: true } }, team: { select: { id: true, name: true, color: true, avatarId: true, game: { select: { id: true, name: true } } } } },
    });
    return { avatars: rows };
  });
  app.delete("/api/admin/avatars/:id", async (request, reply) => {
    if (!(await requireSuper(request, reply))) return;
    const { id } = request.params as { id: string };
    const q = z.object({ block: z.enum(["1", "0"]).default("0") }).parse(request.query ?? {});
    const a = await prisma.avatar.findUnique({ where: { id }, select: { uploadedById: true, user: { select: { id: true } }, team: { select: { id: true, gameId: true } } } });
    if (!a) return reply.code(404).send({ error: "not_found", message: err(request, "Аватарка не найдена") });
    await prisma.avatar.delete({ where: { id } }); // связи с участником и командой обнуляются сами
    if (q.block === "1" && a.uploadedById) await prisma.user.update({ where: { id: a.uploadedById }, data: { avatarBlocked: true } });
    if (a.user) await announceUser(a.user.id);
    if (a.team) publish(a.team.gameId, { type: "teams" });
    return reply.code(204).send();
  });
  app.post("/api/admin/avatars/unblock/:userId", async (request, reply) => {
    if (!(await requireSuper(request, reply))) return;
    const { userId } = request.params as { userId: string };
    await prisma.user.update({ where: { id: userId }, data: { avatarBlocked: false } });
    return { ok: true };
  });
}

async function requireSuper(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (request.user?.platformRole === "SUPERADMIN") return true;
  await reply.code(403).send({ error: "forbidden", message: err(request, "Только администратор платформы") });
  return false;
}
async function captainOf(request: FastifyRequest, reply: FastifyReply, gameId: string, teamId: string): Promise<{ avatarId: string | null; blocked: boolean } | null> {
  const m = await prisma.membership.findFirst({ where: { userId: request.user!.id, teamId, team: { gameId } }, select: { role: true, team: { select: { avatarId: true } }, user: { select: { avatarBlocked: true } } } });
  if (!m) { await reply.code(404).send({ error: "not_found", message: err(request, "Команда не найдена") }); return null; }
  if (m.role !== "CAPTAIN") { await reply.code(403).send({ error: "forbidden", message: err(request, "Аватарку команды ставит капитан") }); return null; }
  return { avatarId: m.team.avatarId, blocked: m.user.avatarBlocked };
}
/** Товарищи по командам видят новую аватарку сразу: событие «состав» в каждой игре участника. */
async function announceUser(userId: string): Promise<void> {
  const ms = await prisma.membership.findMany({ where: { userId }, select: { teamId: true, team: { select: { gameId: true } } } });
  for (const m of ms) publish(m.team.gameId, { type: "teams", teamId: m.teamId });
}
