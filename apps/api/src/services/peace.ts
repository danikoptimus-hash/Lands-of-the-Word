import { prisma } from "../db.js";
import { publish } from "./events.js";
import { notifyTeam } from "./notify.js";
import { journal } from "./journal.js";

/**
 * Мир между командами (решение владельца 18.09, B-12): команда предлагает мир, другая принимает; пока мир действует,
 * команды не бросают вызов городам друг друга и не объявляют осад. Мир не на срок: действует, пока одна из сторон
 * не расторгнет его — расторжение принимается сразу, с новостью для всех команд.
 */

export async function peaceBetween(gameId: string, a: string, b: string): Promise<boolean> {
  const n = await prisma.peace.count({ where: { gameId, status: "ACTIVE", OR: [{ fromId: a, toId: b }, { fromId: b, toId: a }] } });
  return n > 0;
}

/** Мир глазами команды: все команды игры с состоянием отношений. */
export async function peaceView(gameId: string, teamId: string) {
  const [teams, rows] = await Promise.all([
    prisma.team.findMany({ where: { gameId, NOT: { id: teamId } }, select: { id: true, name: true, color: true, status: true }, orderBy: { index: "asc" } }),
    prisma.peace.findMany({ where: { gameId, status: { in: ["PROPOSED", "ACTIVE"] }, OR: [{ fromId: teamId }, { toId: teamId }] }, orderBy: { createdAt: "desc" } }),
  ]);
  return teams.map((t) => {
    const p = rows.find((r) => (r.fromId === t.id && r.toId === teamId) || (r.fromId === teamId && r.toId === t.id));
    const state = !p ? "none" : p.status === "ACTIVE" ? "peace" : p.fromId === teamId ? "offered" : "incoming";
    return { team: t, state, peaceId: p?.id ?? null, since: p?.decidedAt ?? p?.createdAt ?? null };
  });
}

type Result = { ok: true } | { ok: false; message: string; vars?: Record<string, string | number> };

export async function proposePeace(gameId: string, fromId: string, toId: string): Promise<Result> {
  if (fromId === toId) return { ok: false, message: "Нельзя предложить мир своей команде" };
  const to = await prisma.team.findFirst({ where: { id: toId, gameId } });
  if (!to) return { ok: false, message: "Команда не найдена" };
  if (to.status === "defeated") return { ok: false, message: "Команда выбыла из игры" };
  const existing = await prisma.peace.findFirst({ where: { gameId, status: { in: ["PROPOSED", "ACTIVE"] }, OR: [{ fromId, toId }, { fromId: toId, toId: fromId }] } });
  if (existing?.status === "ACTIVE") return { ok: false, message: "Мир с этой командой уже действует" };
  if (existing) return { ok: false, message: "Предложение мира уже ждёт ответа" };
  const from = await prisma.team.findUniqueOrThrow({ where: { id: fromId }, select: { name: true } });
  await prisma.peace.create({ data: { gameId, fromId, toId } });
  journal(gameId, "peace_offered", { teamId: fromId, vars: { team: from.name, other: to.name } });
  journal(gameId, "peace_offered", { teamId: toId, vars: { team: from.name, other: to.name } });
  notifyTeam(gameId, toId, "Предложение мира от команды «{team}»", "Команда «{team}» предлагает мир: пока он действует, команды не бросают вызов городам друг друга. Принять или отклонить можно в меню команды.", { team: from.name });
  publish(gameId, { type: "peace" });
  return { ok: true };
}

export async function decidePeace(gameId: string, peaceId: string, teamId: string, accept: boolean): Promise<Result> {
  const p = await prisma.peace.findFirst({ where: { id: peaceId, gameId }, include: { from: { select: { name: true } }, to: { select: { name: true } } } });
  if (!p || p.toId !== teamId) return { ok: false, message: "Предложение не найдено" };
  if (p.status !== "PROPOSED") return { ok: false, message: "Предложение уже рассмотрено" };
  await prisma.peace.update({ where: { id: p.id }, data: { status: accept ? "ACTIVE" : "DECLINED", decidedAt: new Date() } });
  if (accept) {
    journal(gameId, "peace_made", { everyone: true, teamId: p.fromId, vars: { team: p.from.name, other: p.to.name } });
    notifyTeam(gameId, p.fromId, "мир заключён", "Команда «{team}» приняла мир: города друг друга не вызываются, пока одна из сторон не расторгнет мир.", { team: p.to.name });
  } else {
    journal(gameId, "peace_declined", { teamId: p.fromId, vars: { team: p.from.name, other: p.to.name } });
    notifyTeam(gameId, p.fromId, "мир отклонён", "Команда «{team}» отклонила предложение мира.", { team: p.to.name });
  }
  publish(gameId, { type: "peace" });
  return { ok: true };
}

/** Расторжение: сразу, без ответа второй стороны, с новостью для всех команд. */
export async function breakPeace(gameId: string, peaceId: string, teamId: string): Promise<Result> {
  const p = await prisma.peace.findFirst({ where: { id: peaceId, gameId }, include: { from: { select: { name: true } }, to: { select: { name: true } } } });
  if (!p || (p.fromId !== teamId && p.toId !== teamId)) return { ok: false, message: "Мир не найден" };
  if (p.status !== "ACTIVE") return { ok: false, message: "Мир не действует" };
  await prisma.peace.update({ where: { id: p.id }, data: { status: "ENDED", endedAt: new Date(), endedById: teamId } });
  const me = p.fromId === teamId ? p.from.name : p.to.name, other = p.fromId === teamId ? p.to.name : p.from.name;
  const otherId = p.fromId === teamId ? p.toId : p.fromId;
  journal(gameId, "peace_broken", { everyone: true, teamId, vars: { team: me, other } });
  notifyTeam(gameId, otherId, "мир расторгнут", "Команда «{team}» расторгла мир: с этого момента вызовы снова возможны.", { team: me });
  publish(gameId, { type: "peace" });
  return { ok: true };
}
