import { prisma } from "../db.js";
import { purgeRecipients } from "./recipients.js";
import { purgePeople } from "./people.js";
import { publish } from "./events.js";
import { notifyAdmins, notifyTeam } from "./notify.js";
import { msg, type Locale } from "./i18n.js";
import { BOOKS } from "@lotw/domain";
import { journal } from "./journal.js";
import { withLock } from "./lock.js";
import { rulesOf } from "./rules.js";
import { gameEndMs, VICTORY_MS } from "./defeat.js";

const bookName = (code: string) => BOOKS.find((b) => b.code === code)?.nameRu ?? code;

/**
 * Завершение игры (2.9): игра заканчивается, когда в строю осталась одна команда (остальные потеряли
 * столицы), когда вышел срок игры (побеждает команда с наибольшим числом городов) или по кнопке админа.
 */

export interface CityOnPath { nodeKey: string; bookCode: string; name: string; current: boolean; isCapital: boolean; at: string }
export interface Standing {
  teamId: string; name: string; color: string; index: number; status: string;
  /** Численность команды (решение владельца 24.10: участникам видна численность всех команд значком). */
  members: number;
  cities: number; capitals: number;
  /** Статистика пути: города, которые команда брала (в том числе потерянные), дела, узлы, битвы. */
  citiesOnPath: CityOnPath[]; deedsApproved: number; nodesRevealed: number; battlesWon: number; battlesLost: number; battlesRepelled: number;
  /** Сумма уровней защиты нынешних городов команды. */
  defenseSum: number;
}

export async function standings(gameId: string): Promise<Standing[]> {
  const [teams, nodes, battles] = await Promise.all([
    prisma.team.findMany({
      where: { gameId }, orderBy: { index: "asc" },
      select: {
        id: true, name: true, color: true, avatarId: true, index: true, status: true,
        cityStates: { where: { firstCapturedAt: { not: null } }, select: { nodeKey: true, capturedAt: true, firstCapturedAt: true, isCapital: true } },
        _count: { select: { members: true, nodeStates: true, edgeTasks: { where: { status: "APPROVED", paved: false } } } },
      },
    }),
    prisma.mapNode.findMany({ where: { gameId, kind: "CITY" }, select: { key: true, bookCode: true, defenseLevel: true } }),
    prisma.battle.findMany({ where: { gameId, status: { in: ["WON", "REPELLED"] } }, select: { status: true, attackerId: true, defenderId: true } }),
  ]);
  const bookOf = new Map(nodes.map((n) => [n.key, n.bookCode ?? ""]));
  const levelOf = new Map(nodes.map((n) => [n.key, n.defenseLevel]));
  return teams
    .map((t) => {
      const current = t.cityStates.filter((c) => c.capturedAt);
      return {
        teamId: t.id, name: t.name, color: t.color, index: t.index, status: t.status, avatarId: t.avatarId, members: t._count.members,
        cities: current.length, capitals: current.filter((c) => c.isCapital).length,
        citiesOnPath: t.cityStates
          .map((c) => ({ nodeKey: c.nodeKey, bookCode: bookOf.get(c.nodeKey) ?? "", name: bookName(bookOf.get(c.nodeKey) ?? ""), current: c.capturedAt != null, isCapital: c.isCapital, at: (c.firstCapturedAt ?? new Date()).toISOString() }))
          .sort((a, b) => a.at.localeCompare(b.at)),
        deedsApproved: t._count.edgeTasks, nodesRevealed: t._count.nodeStates,
        battlesWon: battles.filter((b) => b.status === "WON" && b.attackerId === t.id).length,
        battlesLost: battles.filter((b) => b.status === "WON" && b.defenderId === t.id).length,
        battlesRepelled: battles.filter((b) => b.status === "REPELLED" && b.defenderId === t.id).length,
        defenseSum: current.reduce((a, c) => a + (levelOf.get(c.nodeKey) ?? 0), 0),
      };
    })
    // Ничья по сроку (решение владельца 18.09): города → столицы → одобренные дела → отражённые вызовы → сумма уровней защиты; номер команды — никогда.
    .sort((a, b) => (a.status === "defeated") !== (b.status === "defeated") ? (a.status === "defeated" ? 1 : -1) : b.cities - a.cities || b.capitals - a.capitals || b.deedsApproved - a.deedsApproved || b.battlesRepelled - a.battlesRepelled || b.defenseSum - a.defenseSum);
}

/** Победитель по городам среди команд в строю (при равенстве — столицы, дела, отражённые вызовы, сумма защиты). */
export async function leader(gameId: string): Promise<Standing | null> {
  const rows = (await standings(gameId)).filter((t) => t.status !== "defeated");
  return rows[0] ?? null;
}

export async function finishGame(gameId: string, reason: "last_team" | "time_limit" | "manual", winnerTeamId: string | null): Promise<void> {
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { status: true, name: true } });
  if (!game || game.status !== "ACTIVE") return;
  const now = new Date();
  // Завершает только идущую игру: обход сроков и кнопка администратора в одну секунду не завершают её дважды
  // (с празднованием победы, 26.11, у партии появился второй срок, и такие встречи стали вероятнее).
  const done = await prisma.$transaction(async (tx) => {
    const r = await tx.game.updateMany({ where: { id: gameId, status: "ACTIVE" }, data: { status: "FINISHED", finishedAt: now, winnerTeamId, finishReason: reason } });
    if (r.count === 0) return false;
    await tx.battle.updateMany({ where: { gameId, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } }, data: { status: "CANCELLED", resolvedAt: now } });
    // И осады: раньше они шли и в завершённой игре — город переходил, команда выбывала уже после конца (разбор, 26.11).
    await tx.siege.updateMany({ where: { gameId, status: "ACTIVE" }, data: { status: "CANCELLED", resolvedAt: now } });
    return true;
  });
  if (!done) return;
  await purgeRecipients(gameId);
  await purgePeople(gameId);
  publish(gameId, { type: "game" });
  publish(gameId, { type: "battles" });
  const winner = winnerTeamId ? await prisma.team.findUnique({ where: { id: winnerTeamId }, select: { name: true } }) : null;
  const why = reason === "last_team" ? "в строю осталась одна команда" : reason === "time_limit" ? "вышел срок игры" : "администратор завершил игру";
  const text = (locale: Locale) => msg(locale, "Игра «{game}» завершена: {why}.", { game: game.name, why }) + (winner ? msg(locale, " Победила команда «{team}».", { team: winner.name }) : "");
  // Победитель — подстановкой {team} внутри шаблона {winner}: клиент и письма переводят вложенный шаблон по словарю.
  journal(gameId, "game_finished", { everyone: true, vars: winner ? { winner: ": победила команда «{team}»", team: winner.name } : { winner: "" } });
  const teams = await prisma.team.findMany({ where: { gameId }, select: { id: true } });
  for (const t of teams) notifyTeam(gameId, t.id, "игра завершена", text);
  notifyAdmins(gameId, "игра завершена", text);
}

/**
 * Празднование победы (решение владельца 26.11): «если команда захватывает последнюю оставшуюся команду, то им даётся
 * трое суток на празднование победы. Даже если например дата конца игры стоит на 15:00 1 декабря, а завоевали столицу
 * в 14:30, то даётся всё равно трое суток на празднование победы, срок окончания автоматически сдвигается на трое
 * суток»; «Участники в эти трое суток занимают руины городов». Партия остаётся идущей, срок settings.endsAt ставится
 * на момент победы + 72 ч (раньше он был, позже или не был вовсе); по сроку обход завершает её с этой командой
 * и причиной last_team. winnerTeamId до настоящего конца не ставится: по нему приложение показывает «Итоги».
 */
export { VICTORY_MS } from "./defeat.js";
export interface Victory { teamId: string; at: string; until: string }
/**
 * Празднование, пока оно идёт (партия ACTIVE), иначе null. Конец — срок партии: администратор вправе его поменять;
 * срок убран — трое суток от победы.
 */
export function victoryOf(game: { status: string; victoryAt: Date | null; victoryTeamId: string | null; settings: unknown }): Victory | null {
  if (game.status !== "ACTIVE" || !game.victoryAt || !game.victoryTeamId) return null;
  const until = gameEndMs(game)!;
  return { teamId: game.victoryTeamId, at: game.victoryAt.toISOString(), until: new Date(until).toISOString() };
}
const fmtIn = (d: Date, locale: Locale, timeZone: string) => d.toLocaleString(locale === "en" ? "en-GB" : "ru-RU", { timeZone, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/**
 * Вход в празднование: один раз за партию (под замком игры и условием «ещё не праздновали»). true — вошли сейчас.
 * Срок пишется в настройки одним ключом поверх того, что в базе (services/gameSettings.ts). Все идущие испытания и осады
 * партии снимаются, новых в празднование нет: город победителя отнять нельзя никаким путём (разбор, 26.11).
 */
export async function startVictory(gameId: string, teamId: string, now = new Date()): Promise<boolean> {
  const until = new Date(now.getTime() + VICTORY_MS);
  const entered = await withLock("game:" + gameId, () => prisma.$transaction(async (tx) => {
    const r = await tx.game.updateMany({ where: { id: gameId, status: "ACTIVE", victoryAt: null }, data: { victoryAt: now, victoryTeamId: teamId } });
    if (r.count !== 1) return null;
    await tx.$executeRaw`UPDATE "Game" SET "settings" = COALESCE("settings", '{}'::jsonb) || ${JSON.stringify({ endsAt: until.toISOString() })}::jsonb WHERE "id" = ${gameId}`;
    await tx.battle.updateMany({ where: { gameId, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } }, data: { status: "CANCELLED", resolvedAt: now } });
    await tx.siege.updateMany({ where: { gameId, status: "ACTIVE" }, data: { status: "CANCELLED", resolvedAt: now } });
    const game = await tx.game.findUniqueOrThrow({ where: { id: gameId }, select: { name: true, settings: true } });
    return { name: game.name, timeZone: rulesOf(game.settings).timeZone };
  }));
  if (!entered) return false;
  // Салют видят все — победители, выбывшие и администраторы: событие общее, открытые карты перечитываются сразу.
  publish(gameId, { type: "game" });
  publish(gameId, { type: "battles" });
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { name: true } });
  notifyTeam(gameId, teamId, "победа", (locale) => msg(locale, "Победа! Последняя чужая столица взята. Трое суток празднования — до {date}: занимайте опустевшие города", { date: fmtIn(until, locale, entered.timeZone) }));
  notifyAdmins(gameId, "победа команды «{team}»", (locale) => msg(locale, "Игра «{game}»: взята последняя чужая столица, победила команда «{team}». Трое суток празднования — до {date}, затем игра завершится сама.", { game: entered.name, team: team?.name ?? "", date: fmtIn(until, locale, entered.timeZone) }), { team: team?.name ?? "" });
  return true;
}

/** После поражения команды: если в строю осталась одна — она победила, начинается празднование (26.11). */
export async function checkLastTeam(gameId: string): Promise<void> {
  const alive = await prisma.team.findMany({ where: { gameId, NOT: { status: "defeated" } }, select: { id: true } });
  if (alive.length === 1) await startVictory(gameId, alive[0]!.id);
  else if (alive.length === 0) await finishGame(gameId, "last_team", null);
}

/**
 * Срок игры из настроек (settings.endsAt): по истечении побеждает команда с наибольшим числом городов. Срок празднования
 * победы (26.11) завершает игру с командой-победителем и причиной last_team.
 */
export async function checkTimeLimits(gameId?: string): Promise<void> {
  const games = await prisma.game.findMany({ where: { ...(gameId ? { id: gameId } : {}), status: "ACTIVE" }, select: { id: true, status: true, settings: true, victoryAt: true, victoryTeamId: true } });
  const now = Date.now();
  for (const g of games) {
    const v = victoryOf(g);
    if (v) {
      if (Date.parse(v.until) <= now) await finishGame(g.id, "last_team", v.teamId);
      continue;
    }
    const endsAt = (g.settings as { endsAt?: string } | null)?.endsAt;
    if (!endsAt || Date.parse(endsAt) > now) continue;
    const top = await leader(g.id);
    await finishGame(g.id, "time_limit", top?.teamId ?? null);
  }
}
