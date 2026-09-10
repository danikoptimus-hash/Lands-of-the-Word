import { prisma } from "../db.js";
import { publish } from "./events.js";
import { notifyAdmins, notifyTeam } from "./notify.js";

/**
 * Завершение игры (2.9): игра заканчивается, когда в строю осталась одна команда (остальные потеряли
 * столицы), когда вышел срок игры (побеждает команда с наибольшим числом городов) или по кнопке админа.
 */

export interface Standing { teamId: string; name: string; color: string; index: number; status: string; cities: number; capitals: number }

export async function standings(gameId: string): Promise<Standing[]> {
  const teams = await prisma.team.findMany({ where: { gameId }, orderBy: { index: "asc" }, select: { id: true, name: true, color: true, index: true, status: true, cityStates: { where: { capturedAt: { not: null } }, select: { isCapital: true } } } });
  return teams
    .map((t) => ({ teamId: t.id, name: t.name, color: t.color, index: t.index, status: t.status, cities: t.cityStates.length, capitals: t.cityStates.filter((c) => c.isCapital).length }))
    .sort((a, b) => (a.status === "defeated") !== (b.status === "defeated") ? (a.status === "defeated" ? 1 : -1) : b.cities - a.cities || b.capitals - a.capitals || a.index - b.index);
}

/** Победитель по городам среди команд в строю (при равенстве — больше столиц, затем меньший индекс). */
export async function leader(gameId: string): Promise<Standing | null> {
  const rows = (await standings(gameId)).filter((t) => t.status !== "defeated");
  return rows[0] ?? null;
}

export async function finishGame(gameId: string, reason: "last_team" | "time_limit" | "manual", winnerTeamId: string | null): Promise<void> {
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { status: true, name: true } });
  if (!game || game.status !== "ACTIVE") return;
  const now = new Date();
  await prisma.$transaction([
    prisma.game.update({ where: { id: gameId }, data: { status: "FINISHED", finishedAt: now, winnerTeamId, finishReason: reason } }),
    prisma.battle.updateMany({ where: { gameId, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } }, data: { status: "CANCELLED", resolvedAt: now } }),
  ]);
  publish(gameId, { type: "game" });
  publish(gameId, { type: "battles" });
  const winner = winnerTeamId ? await prisma.team.findUnique({ where: { id: winnerTeamId }, select: { name: true } }) : null;
  const why = reason === "last_team" ? "в строю осталась одна команда" : reason === "time_limit" ? "вышел срок игры" : "администратор завершил игру";
  const text = `Игра «${game.name}» завершена: ${why}.${winner ? ` Победила команда «${winner.name}».` : ""}`;
  const teams = await prisma.team.findMany({ where: { gameId }, select: { id: true } });
  for (const t of teams) notifyTeam(gameId, t.id, "игра завершена", text);
  notifyAdmins(gameId, "игра завершена", text);
}

/** После поражения команды: если в строю осталась одна — она победила. */
export async function checkLastTeam(gameId: string): Promise<void> {
  const alive = await prisma.team.findMany({ where: { gameId, NOT: { status: "defeated" } }, select: { id: true } });
  if (alive.length <= 1) await finishGame(gameId, "last_team", alive[0]?.id ?? null);
}

/** Срок игры из настроек (settings.endsAt): по истечении побеждает команда с наибольшим числом городов. */
export async function checkTimeLimits(gameId?: string): Promise<void> {
  const games = await prisma.game.findMany({ where: { ...(gameId ? { id: gameId } : {}), status: "ACTIVE" }, select: { id: true, settings: true } });
  const now = Date.now();
  for (const g of games) {
    const endsAt = (g.settings as { endsAt?: string } | null)?.endsAt;
    if (!endsAt || Date.parse(endsAt) > now) continue;
    const top = await leader(g.id);
    await finishGame(g.id, "time_limit", top?.teamId ?? null);
  }
}
