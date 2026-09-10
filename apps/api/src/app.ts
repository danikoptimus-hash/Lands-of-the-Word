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
import { teamRoutes } from "./routes/teams.js";
import { deedRoutes } from "./routes/deeds.js";
import { teamMapRoutes } from "./routes/teamMap.js";
import { cityRoutes } from "./routes/cities.js";
import { battleRoutes } from "./routes/battles.js";
import { diplomacyRoutes } from "./routes/diplomacy.js";
import { sweep } from "./services/battles.js";
import { initMail } from "./services/mail.js";
import { initNotify } from "./services/notify.js";
import { recordResponse } from "./services/stats.js";
import { eventRoutes } from "./routes/events.js";

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
  initMail(config);
  initNotify(config.PUBLIC_URL, (e, msg) => app.log.error(e, msg));

  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, { global: false });
  app.addHook("preHandler", attachUser);
  // Время ответа и ошибки для дашборда суперадмина (только /api, без содержимого запросов).
  app.addHook("onResponse", (request, reply, done) => {
    if (request.url.startsWith("/api/")) recordResponse(reply.statusCode, reply.elapsedTime, request.routeOptions?.url ?? request.url.split("?")[0] ?? "");
    done();
  });

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
  await app.register(teamRoutes);
  await app.register(deedRoutes);
  await app.register(teamMapRoutes);
  await app.register(cityRoutes);
  await app.register(battleRoutes);
  await app.register(diplomacyRoutes);
  // Таймеры битв: сгоревшие атаки и просроченные обороны проверяются раз в минуту.
  if (config.NODE_ENV !== "test") {
    const timer = setInterval(() => { sweep().catch((e) => app.log.error(e, "battle sweep failed")); }, 60_000);
    app.addHook("onClose", async () => clearInterval(timer));
  }
  await app.register(eventRoutes);

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
