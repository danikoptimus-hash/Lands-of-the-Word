import { prisma } from "../db.js";
import { purgeRecipients } from "./recipients.js";
import { publish } from "./events.js";
import { notifyAdmins, notifyTeam } from "./notify.js";
import { msg, type Locale } from "./i18n.js";
import { BOOKS } from "@lotw/domain";

const bookName = (code: string) => BOOKS.find((b) => b.code === code)?.nameRu ?? code;

/**
 * Завершение игры (2.9): игра заканчивается, когда в строю осталась одна команда (остальные потеряли
 * столицы), когда вышел срок игры (побеждает команда с наибольшим числом городов) или по кнопке админа.
 */

export interface CityOnPath { nodeKey: string; bookCode: string; name: string; current: boolean; isCapital: boolean; at: string }
export interface Standing {
  teamId: string; name: string; color: string; index: number; status: string;
  cities: number; capitals: number;
  /** Статистика пути: города, которые команда брала (в том числе потерянные), дела, узлы, битвы. */
  citiesOnPath: CityOnPath[]; deedsApproved: number; nodesRevealed: number; battlesWon: number; battlesLost: number; battlesRepelled: number;
}

export async function standings(gameId: string): Promise<Standing[]> {
  const [teams, nodes, battles] = await Promise.all([
    prisma.team.findMany({
      where: { gameId }, orderBy: { index: "asc" },
      select: {
        id: true, name: true, color: true, index: true, status: true,
        cityStates: { where: { firstCapturedAt: { not: null } }, select: { nodeKey: true, capturedAt: true, firstCapturedAt: true, isCapital: true } },
        _count: { select: { nodeStates: true, edgeTasks: { where: { status: "APPROVED" } } } },
      },
    }),
    prisma.mapNode.findMany({ where: { gameId, kind: "CITY" }, select: { key: true, bookCode: true } }),
    prisma.battle.findMany({ where: { gameId, status: { in: ["WON", "REPELLED"] } }, select: { status: true, attackerId: true, defenderId: true } }),
  ]);
  const bookOf = new Map(nodes.map((n) => [n.key, n.bookCode ?? ""]));
  return teams
    .map((t) => {
      const current = t.cityStates.filter((c) => c.capturedAt);
      return {
        teamId: t.id, name: t.name, color: t.color, index: t.index, status: t.status,
        cities: current.length, capitals: current.filter((c) => c.isCapital).length,
        citiesOnPath: t.cityStates
          .map((c) => ({ nodeKey: c.nodeKey, bookCode: bookOf.get(c.nodeKey) ?? "", name: bookName(bookOf.get(c.nodeKey) ?? ""), current: c.capturedAt != null, isCapital: c.isCapital, at: (c.firstCapturedAt ?? new Date()).toISOString() }))
          .sort((a, b) => a.at.localeCompare(b.at)),
        deedsApproved: t._count.edgeTasks, nodesRevealed: t._count.nodeStates,
        battlesWon: battles.filter((b) => b.status === "WON" && b.attackerId === t.id).length,
        battlesLost: battles.filter((b) => b.status === "WON" && b.defenderId === t.id).length,
        battlesRepelled: battles.filter((b) => b.status === "REPELLED" && b.defenderId === t.id).length,
      };
    })
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
  await purgeRecipients(gameId);
  publish(gameId, { type: "game" });
  publish(gameId, { type: "battles" });
  const winner = winnerTeamId ? await prisma.team.findUnique({ where: { id: winnerTeamId }, select: { name: true } }) : null;
  const why = reason === "last_team" ? "в строю осталась одна команда" : reason === "time_limit" ? "вышел срок игры" : "администратор завершил игру";
  const text = (locale: Locale) => msg(locale, "Игра «{game}» завершена: {why}.", { game: game.name, why }) + (winner ? msg(locale, " Победила команда «{team}».", { team: winner.name }) : "");
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
