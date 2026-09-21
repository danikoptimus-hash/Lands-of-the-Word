import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.js";
import { createSession, publicUser } from "../auth.js";
import { err } from "../services/i18n.js";
import { exchangeCode, GOOGLE_AUTH_URL, verifyIdToken } from "../services/google.js";

/**
 * Вход через Google (OpenID Connect, authorization-code flow; решение владельца 21.09).
 * Храним только почту и идентификатор Google (sub): имя и фото не запрашиваем. Вход по никнейму и паролю остаётся.
 *
 * Поток: GET /api/auth/google → Google → GET /api/auth/google/callback. Дальше три случая:
 *  - учётка найдена по sub или по почте → сессия, почта считается подтверждённой (её подтвердил Google);
 *  - учётки нет → короткоживущий cookie с почтой и sub, страница /google/nickname → POST /api/auth/google/complete.
 */
export const STATE_COOKIE = "lotw_gstate";
export const PENDING_COOKIE = "lotw_gpending";
const STATE_TTL_MS = 10 * 60_000;
const PENDING_TTL_MS = 15 * 60_000;
const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

const nickname = z.string().trim().min(3).max(24).regex(/^[\p{L}\p{N}_-]+$/u, "Только буквы, цифры, _ и -");
const completeBody = z.object({ nickname, locale: z.enum(["ru", "en"]).optional() });
const stateQuery = z.object({ next: z.string().max(500).optional() });
const callbackQuery = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() });

interface StateData { s: string; next: string }
interface PendingData { sub: string; email: string; exp: number }

/** Только путь на нашем сайте: начинается с «/», но не «//» (иначе это адрес другого сайта). */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

/** Подпись короткого JSON HMAC-SHA256 на SESSION_SECRET: payload.signature (обе части base64url). */
function sign(secret: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function unsign<T>(secret: string, value: string | undefined): T | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot), mac = value.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T; } catch { return null; }
}

export async function googleRoutes(app: FastifyInstance): Promise<void> {
  const cfg = app.config;
  const secure = cfg.NODE_ENV === "production";
  const enabled = Boolean(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET);
  const redirectUri = `${cfg.PUBLIC_URL.replace(/\/$/, "")}/api/auth/google/callback`;
  const cookieBase = { path: "/", httpOnly: true, sameSite: "lax" as const, secure };

  const readPending = (request: FastifyRequest): PendingData | null => {
    const p = unsign<PendingData>(cfg.SESSION_SECRET, request.cookies[PENDING_COOKIE]);
    return p && p.exp > Date.now() && p.sub && p.email ? p : null;
  };
  const clearPending = (reply: FastifyReply) => reply.clearCookie(PENDING_COOKIE, { path: "/" });

  /** Какие способы входа включены: веб показывает кнопку Google, только если Google настроен. */
  app.get("/api/auth/providers", async () => ({ google: enabled }));

  /** Начало входа: случайный state в подписанном cookie, редирект к Google. */
  app.get("/api/auth/google", async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "not_configured", message: err(request, "Вход через Google не настроен") });
    const q = stateQuery.parse(request.query ?? {});
    const state = randomBytes(32).toString("base64url");
    const data: StateData = { s: state, next: safeNext(q.next) };
    reply.setCookie(STATE_COOKIE, JSON.stringify(data), { ...cookieBase, signed: true, maxAge: STATE_TTL_MS / 1000 });
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", cfg.GOOGLE_CLIENT_ID!);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "select_account");
    return reply.redirect(url.toString(), 302);
  });

  /** Возврат от Google: проверка state, обмен кода, проверка id_token, дальше — привязка, вход или выбор ника. */
  app.get("/api/auth/google/callback", async (request, reply) => {
    if (!enabled) return reply.code(404).send({ error: "not_configured", message: err(request, "Вход через Google не настроен") });
    const q = callbackQuery.parse(request.query ?? {});
    reply.clearCookie(STATE_COOKIE, { path: "/" });
    const raw = request.cookies[STATE_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    let st: StateData | null = null;
    try { st = unsigned?.valid && unsigned.value ? (JSON.parse(unsigned.value) as StateData) : null; } catch { st = null; }
    const fail = (code: string) => reply.redirect(`/login?google=${code}`, 302);
    if (!st || !q.state || q.state !== st.s) return fail("state");
    if (!q.code) return fail("error");

    let sub: string, email: string;
    try {
      const tokens = await exchangeCode(q.code, cfg.GOOGLE_CLIENT_ID!, cfg.GOOGLE_CLIENT_SECRET!, redirectUri);
      const claims = await verifyIdToken(tokens.id_token!);
      const exp = Number(claims.exp);
      const ok = claims.aud === cfg.GOOGLE_CLIENT_ID && claims.iss && ISSUERS.has(claims.iss) && claims.email_verified === "true"
        && Number.isFinite(exp) && exp * 1000 > Date.now() && claims.sub && claims.email;
      if (!ok) { request.log.warn({ aud: claims.aud, iss: claims.iss, verified: claims.email_verified }, "google id_token rejected"); return fail("error"); }
      sub = claims.sub!; email = claims.email!.trim().toLowerCase();
    } catch (e) {
      request.log.error(e, "google sign-in failed");
      return fail("error");
    }

    // а) Учётка уже есть: по sub или по почте (Google подтвердил, что почта принадлежит человеку).
    let user = await prisma.user.findUnique({ where: { googleId: sub } });
    if (!user) {
      const byEmail = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
      if (byEmail) user = await prisma.user.update({ where: { id: byEmail.id }, data: { googleId: sub, emailVerified: true } });
    }
    if (user) {
      await createSession(reply, user.id, secure);
      return reply.redirect(st.next, 302);
    }

    // б) Учётки нет: осталось выбрать никнейм.
    const pending: PendingData = { sub, email, exp: Date.now() + PENDING_TTL_MS };
    reply.setCookie(PENDING_COOKIE, sign(cfg.SESSION_SECRET, pending), { ...cookieBase, maxAge: PENDING_TTL_MS / 1000 });
    return reply.redirect("/google/nickname", 302);
  });

  /** Почта из незавершённого входа через Google (для страницы выбора ника). */
  app.get("/api/auth/google/pending", async (request, reply) => {
    const p = readPending(request);
    if (!p) return reply.code(404).send({ error: "not_found", message: err(request, "Вход через Google не начат или устарел. Начните заново") });
    return { email: p.email };
  });

  /** Завершение регистрации через Google: никнейм по тем же правилам, что при обычной регистрации. */
  app.post("/api/auth/google/complete", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const p = readPending(request);
    if (!p) return reply.code(404).send({ error: "not_found", message: err(request, "Вход через Google не начат или устарел. Начните заново") });
    const body = completeBody.parse(request.body);
    const exists = await prisma.user.findFirst({
      where: { OR: [{ nickname: { equals: body.nickname, mode: "insensitive" } }, { email: { equals: p.email, mode: "insensitive" } }, { googleId: p.sub }] },
    });
    if (exists) return reply.code(409).send({ error: "conflict", message: err(request, "Такой никнейм или почта уже заняты") });
    const userCount = await prisma.user.count();
    const user = await prisma.user.create({
      data: {
        nickname: body.nickname,
        // Пароля у такой учётки нет: хеш случайных байт, войти по нему нельзя; пароль можно задать через «Забыли пароль?».
        passwordHash: await bcrypt.hash(randomBytes(32).toString("base64url"), 10),
        email: p.email,
        emailVerified: true,
        googleId: p.sub,
        locale: body.locale ?? "ru",
        platformRole: userCount === 0 ? "SUPERADMIN" : "USER",
      },
    });
    clearPending(reply);
    await createSession(reply, user.id, secure);
    return reply.code(201).send({ user: publicUser(user) });
  });
}
