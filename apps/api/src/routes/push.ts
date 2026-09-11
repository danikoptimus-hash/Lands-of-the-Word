import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireUser } from "../auth.js";
import { pushPublicKey, sendPush } from "../services/push.js";
import { err, msg, toLocale } from "../services/i18n.js";

const subscribeBody = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(200) }),
});
const endpointBody = z.object({ endpoint: z.string().url().max(2000) });

/** Push-уведомления: публичный ключ, подписка устройства, отписка, пробное уведомление. */
export async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireUser);

  app.get("/api/push/key", async (request, reply) => {
    const key = await pushPublicKey();
    if (!key) return reply.code(503).send({ error: "unavailable", message: err(request, "Уведомления пока недоступны: попробуйте позже") });
    return { key };
  });

  /** Сохраняет подписку браузера за текущим пользователем (endpoint уникален: перелогин переписывает владельца). */
  app.post("/api/push/subscribe", async (request, reply) => {
    const body = subscribeBody.parse(request.body);
    const count = await prisma.pushSubscription.count({ where: { userId: request.user!.id } });
    if (count >= 20) return reply.code(409).send({ error: "conflict", message: err(request, "Слишком много устройств с уведомлениями") });
    const ua = (request.headers["user-agent"] ?? "").slice(0, 200) || null;
    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: { userId: request.user!.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: ua },
      update: { userId: request.user!.id, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: ua },
    });
    return reply.code(201).send({ ok: true });
  });

  app.delete("/api/push/subscribe", async (request) => {
    const body = endpointBody.parse(request.body);
    await prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: request.user!.id } });
    return { ok: true };
  });

  /** Пробное уведомление себе — чтобы человек сразу увидел, что всё работает. */
  app.post("/api/push/test", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
    const locale = toLocale(request.user!.locale);
    await sendPush([request.user!.id], () => ({ title: msg(locale, "Земли Слова"), body: msg(locale, "Уведомления включены: сюда придут вести о делах, испытаниях и проходах."), url: "/", tag: "test" }));
    return { ok: true };
  });
}
