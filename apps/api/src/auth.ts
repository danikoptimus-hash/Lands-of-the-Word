import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@prisma/client";
import { prisma } from "./db.js";

export const SESSION_COOKIE = "lotw_session";
const SESSION_DAYS = 30;

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

/**
 * Несколько аккаунтов на одном устройстве (решение владельца 05.10): активная сессия — в cookie `lotw_session`,
 * остальные («припаркованные») — списком id в подписанном cookie `lotw_sessions`, не больше MAX_ACCOUNTS.
 * Переключение меняет активную сессию местами с припаркованной; выход закрывает только активную и включает следующую.
 */
export const PARKED_COOKIE = "lotw_sessions";
export const MAX_ACCOUNTS = 5;

const cookieOpts = (secure: boolean, expires: Date) => ({ path: "/", httpOnly: true, sameSite: "lax" as const, secure, expires, signed: true });

/** Id активной сессии из cookie (проверка подписи; существование в базе не проверяется). */
export function activeSessionId(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const u = request.unsignCookie(raw);
  return u.valid && u.value ? u.value : null;
}
export function readParked(request: FastifyRequest): string[] {
  const raw = request.cookies[PARKED_COOKIE];
  if (!raw) return [];
  const u = request.unsignCookie(raw);
  if (!u.valid || !u.value) return [];
  try { const arr = JSON.parse(u.value) as unknown; return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, MAX_ACCOUNTS) : []; } catch { return []; }
}
export function writeParked(reply: FastifyReply, ids: string[], secure: boolean): void {
  if (!ids.length) { reply.clearCookie(PARKED_COOKIE, { path: "/" }); return; }
  reply.setCookie(PARKED_COOKIE, JSON.stringify(ids.slice(0, MAX_ACCOUNTS)), cookieOpts(secure, new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000)));
}
export function setActiveCookie(reply: FastifyReply, id: string, secure: boolean, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, id, cookieOpts(secure, expiresAt));
}

/**
 * Новая сессия; с `park` текущая активная сессия другого пользователя не закрывается, а паркуется (добавление
 * аккаунта). Припаркованные сессии того же пользователя закрываются, чтобы аккаунт не числился дважды.
 */
export async function createSession(reply: FastifyReply, userId: string, secure: boolean, park?: { request: FastifyRequest }): Promise<void> {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await prisma.session.create({ data: { id, userId, expiresAt } });
  if (park) {
    const current = activeSessionId(park.request);
    const ids = [...(current ? [current] : []), ...readParked(park.request)].filter((x, i, arr) => arr.indexOf(x) === i && x !== id);
    const rows = await prisma.session.findMany({ where: { id: { in: ids }, expiresAt: { gt: new Date() } }, select: { id: true, userId: true } });
    const same = rows.filter((r) => r.userId === userId).map((r) => r.id);
    if (same.length) await prisma.session.deleteMany({ where: { id: { in: same } } });
    const keep = ids.filter((x) => rows.some((r) => r.id === x && r.userId !== userId)).slice(0, MAX_ACCOUNTS - 1);
    writeParked(reply, keep, secure);
  }
  setActiveCookie(reply, id, secure, expiresAt);
}

/** Выход из активного аккаунта: сессия закрывается; если есть припаркованные, первая живая становится активной. */
export async function destroySession(request: FastifyRequest, reply: FastifyReply, secure = false): Promise<{ userId: string; id: string } | null> {
  const current = activeSessionId(request);
  if (current) await prisma.session.deleteMany({ where: { id: current } });
  const parked = readParked(request).filter((x) => x !== current);
  const rows = parked.length ? await prisma.session.findMany({ where: { id: { in: parked }, expiresAt: { gt: new Date() } }, select: { id: true, userId: true, expiresAt: true } }) : [];
  const next = parked.map((id) => rows.find((r) => r.id === id)).find((r): r is NonNullable<typeof r> => Boolean(r));
  if (!next) { reply.clearCookie(SESSION_COOKIE, { path: "/" }); writeParked(reply, [], secure); return null; }
  setActiveCookie(reply, next.id, secure, next.expiresAt);
  writeParked(reply, parked.filter((x) => x !== next.id && rows.some((r) => r.id === x)), secure);
  return { userId: next.userId, id: next.id };
}

/** Выход из всех аккаунтов на этом устройстве. */
export async function destroyAllSessions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ids = [activeSessionId(request), ...readParked(request)].filter((x): x is string => Boolean(x));
  if (ids.length) await prisma.session.deleteMany({ where: { id: { in: ids } } });
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
  reply.clearCookie(PARKED_COOKIE, { path: "/" });
}

/** Подставляет request.user по cookie сессии (или null). */
export async function attachUser(request: FastifyRequest): Promise<void> {
  request.user = null;
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return;
  const session = await prisma.session.findUnique({ where: { id: unsigned.value }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return;
  request.user = session.user;
  // Последняя активность для аналитики (DAU/WAU/MAU), не чаще раза в 10 минут и в фоне.
  const seen = session.user.lastSeenAt?.getTime() ?? 0;
  if (Date.now() - seen > 600_000) prisma.user.update({ where: { id: session.user.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
}

/** Маршруты, доступные с неподтверждённой почтой: аккаунт, выход, смена пароля и само подтверждение. */
const UNVERIFIED_OK = /^\/api\/auth\/(me|logout|password|verify|resend)(\/|\?|$)/;

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.code(401).send({ error: "unauthorized", message: "Нужно войти" });
    return;
  }
  // Пока почта не подтверждена, играть нельзя: только подтвердить, сменить почту или выйти.
  if (!request.user.emailVerified && !UNVERIFIED_OK.test(request.url)) {
    await reply.code(403).send({ error: "email_unverified", message: "Сначала подтвердите почту: ссылка в письме" });
  }
}

export function publicUser(u: User) {
  return { id: u.id, nickname: u.nickname, displayName: u.displayName, email: u.email, emailVerified: u.emailVerified, locale: u.locale, platformRole: u.platformRole, googleLinked: Boolean(u.googleId) };
}
