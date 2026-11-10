import { prisma } from "../db.js";

/**
 * Две команды в одной партии (решение владельца 10.11: «проигравшие по приглашению заходят в другую команду и
 * одновременно находятся в двух командах: в проигравшей ничего не могут делать, в новой играют дальше»).
 * Участник выбывшей команды остаётся в её составе (история, статистика), а «своя» команда в игре — та, что ещё в строю
 * (из нескольких — последняя по вступлению); если все его команды выбыли — последняя из них.
 */
export function pickMembership<T extends { joinedAt: Date; team: { status: string } }>(rows: T[]): T | null {
  const sorted = [...rows].sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime());
  return sorted.find((r) => r.team.status !== "defeated") ?? sorted[0] ?? null;
}

/** «Своя» команда участника в игре (см. pickMembership) с полной записью команды. */
export async function gameMembership(userId: string, gameId: string) {
  return pickMembership(await prisma.membership.findMany({ where: { userId, team: { gameId } }, include: { team: true } }));
}

/** Участники игры по одному на человека: «своя» команда каждого и все его команды в этой игре. */
export function byPerson<T extends { userId: string; teamId: string; joinedAt: Date; team: { status: string } }>(rows: T[]): Array<{ main: T; teamIds: string[] }> {
  const groups = new Map<string, T[]>();
  for (const r of rows) groups.set(r.userId, [...(groups.get(r.userId) ?? []), r]);
  return [...groups.values()].map((g) => ({ main: pickMembership(g)!, teamIds: g.map((x) => x.teamId) }));
}

/** Личные награды человека без повторов: одна и та же награда, полученная в двух командах, считается один раз (по самой ранней). */
export function personalGrants<T extends { userId: string; code: string; key?: string; at: Date }>(grants: T[], userId: string): T[] {
  const seen = new Map<string, T>();
  for (const g of grants) {
    if (g.userId !== userId) continue;
    const k = `${g.code}|${g.key ?? "once"}`, was = seen.get(k);
    if (!was || g.at < was.at) seen.set(k, g);
  }
  return [...seen.values()];
}
