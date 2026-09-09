import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { createSession, destroySession, publicUser, requireUser } from "../auth.js";
import { createHash, randomBytes } from "node:crypto";
import { mailEnabled, sendMail } from "../services/mail.js";

const nickname = z.string().trim().min(3).max(24).regex(/^[\p{L}\p{N}_-]+$/u, "Только буквы, цифры, _ и -");
const password = z.string().min(8).max(128);

const registerBody = z.object({
  nickname,
  password,
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  displayName: z.string().trim().max(60).optional(),
});

const loginBody = z.object({ nickname: z.string().trim(), password: z.string() });
const profileBody = z.object({
  displayName: z.string().trim().max(60).nullable().optional(),
  email: z.string().trim().email().nullable().optional().or(z.literal("").transform(() => null)),
  locale: z.enum(["ru", "en"]).optional(),
});
const passwordBody = z.object({ current: z.string(), next: password });
const forgotBody = z.object({ login: z.string().trim().min(3).max(120) });
const resetBody = z.object({ token: z.string().min(20).max(120), password });

export const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

/** Выпускает одноразовую ссылку сброса пароля. Токен хранится только в виде хеша. */
export async function issueResetLink(userId: string, kind: "EMAIL" | "ADMIN", ttlMs: number, publicUrl: string, issuedBy?: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs);
  await prisma.passwordReset.create({ data: { id: hashToken(token), userId, kind, issuedBy: issuedBy ?? null, expiresAt } });
  return { url: `${publicUrl.replace(/\/$/, "")}/reset/${token}`, expiresAt };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const secure = app.config.NODE_ENV === "production";

  app.post("/api/auth/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = registerBody.parse(request.body);
    const exists = await prisma.user.findFirst({
      where: { OR: [{ nickname: { equals: body.nickname, mode: "insensitive" } }, ...(body.email ? [{ email: body.email }] : [])] },
    });
    if (exists) return reply.code(409).send({ error: "conflict", message: "Такой никнейм или email уже занят" });
    const userCount = await prisma.user.count();
    const user = await prisma.user.create({
      data: {
        nickname: body.nickname,
        passwordHash: await bcrypt.hash(body.password, 10),
        email: body.email ?? null,
        displayName: body.displayName ?? null,
        // Первый зарегистрированный пользователь платформы — суперадмин.
        platformRole: userCount === 0 ? "SUPERADMIN" : "USER",
      },
    });
    await createSession(reply, user.id, secure);
    return reply.code(201).send({ user: publicUser(user) });
  });

  app.post("/api/auth/login", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = loginBody.parse(request.body);
    const user = await prisma.user.findFirst({ where: { nickname: { equals: body.nickname, mode: "insensitive" } } });
    const ok = user ? await bcrypt.compare(body.password, user.passwordHash) : false;
    if (!user || !ok) return reply.code(401).send({ error: "unauthorized", message: "Неверный никнейм или пароль" });
    await createSession(reply, user.id, secure);
    return { user: publicUser(user) };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await destroySession(request, reply);
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireUser }, async (request) => ({ user: publicUser(request.user!) }));

  /** Настройки аккаунта: отображаемое имя, email, язык. Никнейм не меняется. */
  app.patch("/api/auth/me", { preHandler: requireUser }, async (request, reply) => {
    const body = profileBody.parse(request.body);
    if (body.email) {
      const taken = await prisma.user.findFirst({ where: { email: body.email, NOT: { id: request.user!.id } } });
      if (taken) return reply.code(409).send({ error: "conflict", message: "Этот email уже занят" });
    }
    const user = await prisma.user.update({ where: { id: request.user!.id }, data: { displayName: body.displayName === undefined ? undefined : body.displayName || null, email: body.email === undefined ? undefined : body.email, locale: body.locale } });
    return { user: publicUser(user) };
  });

  app.post("/api/auth/password", { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = passwordBody.parse(request.body);
    const ok = await bcrypt.compare(body.current, request.user!.passwordHash);
    if (!ok) return reply.code(401).send({ error: "unauthorized", message: "Текущий пароль неверный" });
    await prisma.user.update({ where: { id: request.user!.id }, data: { passwordHash: await bcrypt.hash(body.next, 10) } });
    return { ok: true };
  });

  /**
   * Забыли пароль: по никнейму или почте. Ответ одинаковый независимо от того, есть ли такой аккаунт,
   * чтобы по ответу нельзя было перебирать никнеймы. Ссылка живёт 1 час.
   */
  app.post("/api/auth/forgot", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request) => {
    const body = forgotBody.parse(request.body);
    if (!mailEnabled()) return { ok: true, mailEnabled: false };
    const user = await prisma.user.findFirst({ where: { OR: [{ nickname: { equals: body.login, mode: "insensitive" } }, { email: { equals: body.login, mode: "insensitive" } }] } });
    if (user?.email) {
      const { url } = await issueResetLink(user.id, "EMAIL", 3_600_000, app.config.PUBLIC_URL);
      await sendMail({
        to: user.email,
        subject: "Земли Слова: восстановление пароля",
        text: `Здравствуйте!\n\nКто-то (надеемся, вы) запросил восстановление пароля для учётки «${user.nickname}» на сайте Земли Слова.\n\nЧтобы задать новый пароль, откройте ссылку (действует 1 час):\n${url}\n\nЕсли это были не вы, просто не открывайте ссылку: пароль не изменится.`,
      });
    }
    return { ok: true, mailEnabled: true };
  });

  /** Проверка ссылки: жива ли, для какого никнейма. */
  app.get("/api/auth/reset/:token", async (request) => {
    const { token } = request.params as { token: string };
    const r = await prisma.passwordReset.findUnique({ where: { id: hashToken(token) }, include: { user: { select: { nickname: true } } } });
    const valid = Boolean(r && !r.usedAt && r.expiresAt.getTime() > Date.now());
    return { valid, nickname: valid ? r!.user.nickname : null };
  });

  /** Новый пароль по ссылке. Все старые сессии закрываются, пользователь входит сразу. */
  app.post("/api/auth/reset", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const body = resetBody.parse(request.body);
    const r = await prisma.passwordReset.findUnique({ where: { id: hashToken(body.token) } });
    if (!r || r.usedAt || r.expiresAt.getTime() < Date.now()) return reply.code(400).send({ error: "invalid_token", message: "Ссылка недействительна или устарела. Запросите новую" });
    await prisma.$transaction([
      prisma.passwordReset.update({ where: { id: r.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: r.userId }, data: { passwordHash: await bcrypt.hash(body.password, 10) } }),
      prisma.session.deleteMany({ where: { userId: r.userId } }),
    ]);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: r.userId } });
    await createSession(reply, user.id, secure);
    return { user: publicUser(user) };
  });

  /** Суперадмин: ссылка сброса для любого пользователя (по никнейму), 24 часа. */
  app.post("/api/auth/reset-link", { preHandler: requireUser }, async (request, reply) => {
    if (request.user!.platformRole !== "SUPERADMIN") return reply.code(403).send({ error: "forbidden", message: "Только для суперадмина" });
    const body = z.object({ nickname: z.string().trim().min(3).max(24) }).parse(request.body);
    const user = await prisma.user.findFirst({ where: { nickname: { equals: body.nickname, mode: "insensitive" } } });
    if (!user) return reply.code(404).send({ error: "not_found", message: "Пользователь не найден" });
    return issueResetLink(user.id, "ADMIN", 86_400_000, app.config.PUBLIC_URL, request.user!.id);
  });
}
