import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { prisma } from "./db.js";
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

/**
 * Чек-лист старта (решение владельца 3.18): в каждой команде капитан и не меньше двух участников, у каждого города адресат конверта.
 * Добавляет в каждую команду с одним участником рядового (ник fx_<хвост id игры>_<n>, создаётся прямо в базе — регистрация
 * ограничена десятью в минуту) и одного адресата, если адресатов нет. Убрать созданных участников после теста — cleanupFixtures(gameId).
 */
/**
 * Часовой пояс (IANA «Etc/GMT±N»), в котором сейчас местный час равен hour: тесты ставят игре такой пояс, чтобы
 * времена суток (решение владельца 03.10) были предсказуемы — днём всё открыто, утром отправляется вызов, ночью всё закрыто.
 * Знак у Etc/GMT обратный: Etc/GMT-5 — это UTC+5.
 */
export function zoneForLocalHour(hour: number, now = new Date()): string {
  let n = ((hour - now.getUTCHours()) % 24 + 24) % 24; // смещение UTC+n
  if (n > 14) n -= 24;
  return n === 0 ? "Etc/GMT" : n > 0 ? `Etc/GMT-${n}` : `Etc/GMT+${-n}`;
}
/** Ставит игре пояс, в котором сейчас заданное время суток (середина фазы, запас не меньше часа до границы). */
export async function setGamePhase(app: FastifyInstance, gameId: string, adminCookie: string, phase: "morning" | "day" | "evening" | "night"): Promise<void> {
  const hour = { morning: 7, day: 12, evening: 19, night: 23 }[phase];
  const r = await app.inject({ method: "PATCH", url: `/api/games/${gameId}`, headers: { cookie: adminCookie }, payload: { settings: { rules: { timeZone: zoneForLocalHour(hour) } } } });
  if (r.statusCode !== 200) throw new Error(`timeZone not set: ${r.body}`);
}

export async function readyForStart(app: FastifyInstance, gameId: string, adminCookie: string): Promise<void> {
  // По умолчанию в тестах — день: ночью (22–7 по поясу игры) дела, города и испытания закрыты.
  await setGamePhase(app, gameId, adminCookie, "day");
  const teams = await prisma.team.findMany({ where: { gameId }, orderBy: { index: "asc" }, include: { _count: { select: { members: true } } } });
  for (const [i, team] of teams.entries()) {
    if (team._count.members !== 1) continue;
    const nickname = `${fixturePrefix(gameId)}${i}_${Date.now() % 100000}`;
    const user = await prisma.user.create({ data: { nickname, email: `${nickname}@example.com`, passwordHash: "fixture", emailVerified: true } });
    await prisma.membership.create({ data: { teamId: team.id, userId: user.id, role: "MEMBER" } });
  }
  // Старт закрыт, пока у участников нет ролей (23.09): рядовым без роли — разведчик.
  await prisma.membership.updateMany({ where: { team: { gameId }, role: "MEMBER", gameRole: "NONE" }, data: { gameRole: "SCOUT" } });
  if ((await prisma.recipient.count({ where: { gameId } })) === 0) {
    const r = await app.inject({ method: "POST", url: `/api/games/${gameId}/recipients`, headers: { cookie: adminCookie }, payload: { label: "семья у реки", kind: "FAMILY" } });
    if (r.statusCode !== 201) throw new Error(`fixture recipient not created: ${r.body}`);
  }
}
const fixturePrefix = (gameId: string) => `fx_${gameId.slice(-6)}_`;
/** Удаляет участников, созданных readyForStart для этой игры. */
export async function cleanupFixtures(gameId: string): Promise<void> {
  await prisma.user.deleteMany({ where: { nickname: { startsWith: fixturePrefix(gameId) } } });
}
