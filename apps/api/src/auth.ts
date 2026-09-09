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

export async function createSession(reply: FastifyReply, userId: string, secure: boolean): Promise<void> {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await prisma.session.create({ data: { id, userId, expiresAt } });
  reply.setCookie(SESSION_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    expires: expiresAt,
    signed: true,
  });
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = request.cookies[SESSION_COOKIE];
  if (raw) {
    const unsigned = request.unsignCookie(raw);
    if (unsigned.valid && unsigned.value) await prisma.session.deleteMany({ where: { id: unsigned.value } });
  }
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
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
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.code(401).send({ error: "unauthorized", message: "Нужно войти" });
  }
}

export function publicUser(u: User) {
  return { id: u.id, nickname: u.nickname, displayName: u.displayName, email: u.email, locale: u.locale, platformRole: u.platformRole };
}
