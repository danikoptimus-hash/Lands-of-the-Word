import { prisma } from "../db.js";
import { publish } from "./events.js";
import { journal } from "./journal.js";
import { notifyAdmins, notifyTeam } from "./notify.js";
import { msg } from "./i18n.js";
import { rulesOf } from "./rules.js";
import type { Prisma } from "@prisma/client";

/**
 * Отчёт о визите к адресату конверта (решение владельца 22.10). Команда вводит ключ — город её, но в тот же день
 * (до полуночи по поясу игры) капитан или заместитель сдаёт отчёт: кто ездил (не меньше половины команды), что сделали,
 * ссылки на фото. Отчёт не сдан вовремя или не принят администратором — город становится свободным, команда едет заново.
 * Столица — как любой город. Города, взятые до появления правила, отчёта не требуют: у них нет строки визита.
 */

/** Полночь текущих суток по поясу игры: конец того же дня. */
export function endOfLocalDay(timeZone: string, now = new Date()): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hour12: false }).formatToParts(now);
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const localAsUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second"));
    const offset = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
    return new Date(Date.UTC(n("year"), n("month") - 1, n("day") + 1) - offset);
  } catch {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  }
}

/** Сколько участников должны поехать: половина действующего состава, вверх. */
export const needVisitors = (members: number) => Math.max(1, Math.ceil(members / 2));

/** Город взят ключом: открывается визит, отчёт ждём до полуночи. */
export async function openVisit(gameId: string, teamId: string, nodeKey: string, bookCode: string): Promise<{ id: string; dueAt: Date }> {
  const g = await prisma.game.findUniqueOrThrow({ where: { id: gameId }, select: { settings: true } });
  const dueAt = endOfLocalDay(rulesOf(g.settings).timeZone);
  // Старый незакрытый визит этой команды в этот город (повторное взятие) закрывается как просроченный без последствий.
  await prisma.cityVisit.updateMany({ where: { teamId, nodeKey, status: { in: ["PENDING", "SUBMITTED"] } }, data: { status: "EXPIRED", decidedAt: new Date() } });
  const v = await prisma.cityVisit.create({ data: { gameId, teamId, nodeKey, bookCode, dueAt } });
  return { id: v.id, dueAt };
}

/**
 * Город становится свободным: владение снимается, столица тоже (решение владельца 22.10: «со столицей так же»), команда
 * не выбывает. Проходы через город отзываются, испытания за него закрываются. Задания и дороги команды остаются.
 */
export async function freeCity(gameId: string, teamId: string, nodeKey: string): Promise<boolean> {
  const state = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId, nodeKey } }, select: { capturedAt: true } });
  if (!state?.capturedAt) return false;
  const now = new Date();
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.teamCityState.updateMany({ where: { teamId, nodeKey }, data: { capturedAt: null, isCapital: false, secondCapital: false } }),
    prisma.passageRequest.updateMany({ where: { gameId, nodeKey, status: { in: ["APPROVED", "PENDING"] } }, data: { status: "REVOKED", decidedAt: now } }),
    prisma.battle.updateMany({ where: { gameId, nodeKey, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } }, data: { status: "CANCELLED", resolvedAt: now } }),
    prisma.mapNode.updateMany({ where: { gameId, key: nodeKey }, data: { lockedUntil: null, maxReachedAt: null, fatigueAt: null } }),
  ];
  await prisma.$transaction(ops);
  publish(gameId, { type: "cities" });
  publish(gameId, { type: "map" });
  publish(gameId, { type: "battles" });
  publish(gameId, { type: "teams" });
  return true;
}

/** Отчёт не сдан до полуночи: город свободен. Вызывается из минутной уборки. */
export async function expireVisits(gameId?: string): Promise<number> {
  const late = await prisma.cityVisit.findMany({ where: { ...(gameId ? { gameId } : {}), status: "PENDING", dueAt: { lt: new Date() } }, include: { team: { select: { name: true } } } });
  for (const v of late) {
    await prisma.cityVisit.update({ where: { id: v.id }, data: { status: "EXPIRED", decidedAt: new Date() } });
    const freed = await freeCity(v.gameId, v.teamId, v.nodeKey);
    if (!freed) continue;
    journal(v.gameId, "visit_expired", { everyone: true, teamId: v.teamId, vars: { team: v.team.name, book: v.bookCode } });
    notifyTeam(v.gameId, v.teamId, "отчёт о визите не сдан: город {book} свободен", "Отчёт о визите в город {book} не сдан в тот же день. Город стал свободным: чтобы занять его снова, съездите к адресату ещё раз, введите ключ и сдайте отчёт.", { book: v.bookCode });
  }
  return late.length;
}

export interface VisitReport { members: string[]; text: string; links: string[]; userId: string; userName: string }

/** Капитан или заместитель сдаёт отчёт (повторно — пока администратор не решил). */
export async function submitVisit(visitId: string, teamId: string, r: VisitReport): Promise<{ ok: true } | { ok: false; code: string; message: string; vars?: Record<string, string | number> }> {
  await expireVisits();
  const v = await prisma.cityVisit.findFirst({ where: { id: visitId, teamId } });
  if (!v) return { ok: false, code: "not_found", message: "Визит не найден" };
  if (v.status === "EXPIRED") return { ok: false, code: "expired", message: "Срок отчёта вышел: город свободен, съездите к адресату ещё раз" };
  if (v.status !== "PENDING" && v.status !== "SUBMITTED") return { ok: false, code: "decided", message: "Отчёт уже рассмотрен" };
  const team = await prisma.membership.findMany({ where: { teamId }, select: { userId: true } });
  const ids = new Set(team.map((m) => m.userId));
  const went = [...new Set(r.members)].filter((id) => ids.has(id));
  const need = needVisitors(ids.size);
  if (went.length < need) return { ok: false, code: "few", message: "К адресату приезжает не меньше половины команды: нужно {need}, отмечено {n}", vars: { need, n: went.length } };
  if (!r.text.trim()) return { ok: false, code: "empty", message: "Напишите, что сделали у адресата" };
  if (r.links.length === 0) return { ok: false, code: "nolink", message: "Приложите хотя бы одну ссылку на фото" };
  await prisma.cityVisit.update({ where: { id: v.id }, data: { status: "SUBMITTED", members: went, text: r.text.trim(), links: r.links, submittedAt: new Date(), submittedById: r.userId } });
  const t = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { name: true } });
  journal(v.gameId, "visit_submitted", { teamId, userId: r.userId, vars: { user: r.userName, team: t.name, book: v.bookCode } });
  notifyAdmins(v.gameId, "отчёт о визите в город {book}", "Команда «{team}» сдала отчёт о визите к адресату города {book}: ездили {n} из {m}. Нужно принять или не принять — в проверке, раздел «Визиты».", { team: t.name, book: v.bookCode, n: went.length, m: ids.size });
  publish(v.gameId, { type: "cities", teamId });
  return { ok: true };
}

/** Администратор: принять или не принять. Не принят — город свободен. */
export async function decideVisit(visitId: string, gameId: string, approve: boolean, comment: string): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const v = await prisma.cityVisit.findFirst({ where: { id: visitId, gameId }, include: { team: { select: { name: true } } } });
  if (!v) return { ok: false, code: "not_found", message: "Визит не найден" };
  if (v.status !== "SUBMITTED" && v.status !== "PENDING") return { ok: false, code: "decided", message: "Отчёт уже рассмотрен" };
  await prisma.cityVisit.update({ where: { id: v.id }, data: { status: approve ? "APPROVED" : "REJECTED", adminComment: comment, decidedAt: new Date() } });
  if (approve) {
    journal(gameId, "visit_approved", { everyone: true, teamId: v.teamId, vars: { team: v.team.name, book: v.bookCode } });
    notifyTeam(gameId, v.teamId, "отчёт о визите в город {book} принят", (locale) => msg(locale, "Отчёт о визите к адресату города {book} принят.{comment}", { book: v.bookCode, comment: comment ? msg(locale, " Комментарий: {c}", { c: comment }) : "" }));
  } else {
    await freeCity(gameId, v.teamId, v.nodeKey);
    journal(gameId, "visit_rejected", { everyone: true, teamId: v.teamId, vars: { team: v.team.name, book: v.bookCode } });
    notifyTeam(gameId, v.teamId, "отчёт о визите не принят: город {book} свободен", (locale) => msg(locale, "Администратор не принял отчёт о визите в город {book}. Город стал свободным: съездите к адресату ещё раз, введите ключ и сдайте новый отчёт.{comment}", { book: v.bookCode, comment: comment ? msg(locale, " Причина: {c}", { c: comment }) : "" }));
  }
  publish(gameId, { type: "cities", teamId: v.teamId });
  return { ok: true };
}

/** Вид визита для команды и администратора. */
export async function visitView(v: { id: string; teamId: string; nodeKey: string; bookCode: string; status: string; dueAt: Date; members: string[]; text: string; links: string[]; adminComment: string; submittedAt: Date | null; decidedAt: Date | null; createdAt: Date }) {
  const members = await prisma.membership.findMany({ where: { teamId: v.teamId }, select: { userId: true, user: { select: { nickname: true, displayName: true } } }, orderBy: { joinedAt: "asc" } });
  const people = members.map((m) => ({ id: m.userId, name: m.user.displayName || m.user.nickname }));
  return { id: v.id, nodeKey: v.nodeKey, bookCode: v.bookCode, status: v.status, dueAt: v.dueAt, members: v.members, text: v.text, links: v.links, adminComment: v.adminComment, submittedAt: v.submittedAt, decidedAt: v.decidedAt, createdAt: v.createdAt, people, need: needVisitors(people.length) };
}

