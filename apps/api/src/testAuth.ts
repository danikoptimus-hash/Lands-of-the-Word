import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { outbox } from "./services/mail.js";

/**
 * Для тестов: регистрация с подтверждением почты по ссылке из «письма» (outbox).
 * Без почты в payload подставляется <nickname>@example.com. Возвращает ответ регистрации (cookie сессии в set-cookie).
 */
export async function registerVerified(app: FastifyInstance, payload: { nickname: string; password: string; email?: string; locale?: "ru" | "en" }): Promise<LightMyRequestResponse> {
  const email = payload.email ?? `${payload.nickname}@example.com`;
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { ...payload, email } });
  if (res.statusCode !== 201) return res;
  const mail = [...outbox].reverse().find((m) => m.to === email);
  const token = mail && /\/verify\/([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
  if (!token) throw new Error(`verification mail not found for ${email}`);
  const v = await app.inject({ method: "POST", url: "/api/auth/verify", headers: { cookie: res.headers["set-cookie"] as string }, payload: { token } });
  if (v.statusCode !== 200) throw new Error(`verify failed: ${v.body}`);
  return res;
}
