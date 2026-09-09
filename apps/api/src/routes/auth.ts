import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { createSession, destroySession, publicUser, requireUser } from "../auth.js";

const nickname = z.string().trim().min(3).max(24).regex(/^[\p{L}\p{N}_-]+$/u, "Только буквы, цифры, _ и -");
const password = z.string().min(8).max(128);

const registerBody = z.object({
  nickname,
  password,
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  displayName: z.string().trim().max(60).optional(),
});

const loginBody = z.object({ nickname: z.string().trim(), password: z.string() });

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
}
