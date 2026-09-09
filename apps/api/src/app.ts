import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { loadEnv, type Env } from "./env.js";
import { attachUser } from "./auth.js";
import { authRoutes } from "./routes/auth.js";
import { gameRoutes } from "./routes/games.js";

declare module "fastify" {
  interface FastifyInstance {
    config: Env;
  }
}

export async function buildApp(envOverrides: Partial<Record<keyof Env, string>> = {}) {
  const config = loadEnv(envOverrides);
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { level: config.NODE_ENV === "production" ? "info" : "debug" },
    trustProxy: true,
  });
  app.decorate("config", config);

  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  app.addHook("preHandler", attachUser);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "validation", message: "Проверьте поля", issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    app.log.error(error);
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode ?? 500;
    return reply.code(status).send({ error: status === 500 ? "internal" : "error", message: status === 500 ? "Внутренняя ошибка" : err.message ?? "Ошибка" });
  });

  app.get("/api/health", async () => ({ ok: true, version: process.env.APP_VERSION ?? "dev" }));
  await app.register(authRoutes);
  await app.register(gameRoutes);

  // Раздача собранного веб-клиента (в продакшене); все не-API пути отдают index.html (SPA).
  if (config.WEB_DIST) {
    const root = path.resolve(config.WEB_DIST);
    await app.register(fastifyStatic, { root, prefix: "/" });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
