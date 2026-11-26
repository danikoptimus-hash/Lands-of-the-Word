import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

/**
 * Команда потеряла столицу и выбывает — любым путём: вызовом (services/battles.ts) или осадой делами (services/siege.ts).
 * Одна запись на оба пути (празднование победы, решение владельца 26.11, находка разбора): раньше осада снимала только
 * испытания за взятый город, и осада или вызов выбывшей команды, объявленные до её поражения, потом отнимали город
 * у победителя — партия кончалась без победителя.
 *
 * Возвращает операции для общей транзакции вызывающего: команда выбыла; её остальные взятые города пустеют (их берут
 * заданиями, без ключа и испытания); все её идущие испытания и осады — нападающей и обороняющейся стороной — отменены;
 * взятые её участниками дела возвращаются (команда заморожена до перевода участников). Город, который сейчас переходит
 * к победителю (`takenKey`), в руины не идёт; испытание и осада, которые сейчас разрешаются, к этому времени уже не идут.
 */
export async function defeatOps(gameId: string, teamId: string, takenKey: string, now: Date): Promise<Prisma.PrismaPromise<unknown>[]> {
  const others = await prisma.teamCityState.findMany({ where: { teamId, capturedAt: { not: null }, NOT: { nodeKey: takenKey } }, select: { nodeKey: true } });
  const sides = [{ attackerId: teamId }, { defenderId: teamId }];
  return [
    prisma.team.update({ where: { id: teamId }, data: { status: "defeated" } }),
    ...(others.length ? [prisma.mapNode.updateMany({ where: { gameId, key: { in: others.map((o) => o.nodeKey) } }, data: { ruined: true, defenseLevel: 0, lockedUntil: null, maxReachedAt: null } })] : []),
    prisma.teamCityState.updateMany({ where: { teamId, capturedAt: { not: null } }, data: { capturedAt: null, isCapital: false, secondCapital: false } }),
    prisma.battle.updateMany({ where: { gameId, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] }, OR: sides }, data: { status: "CANCELLED", resolvedAt: now } }),
    prisma.siege.updateMany({ where: { gameId, status: "ACTIVE", OR: sides }, data: { status: "CANCELLED", resolvedAt: now } }),
    prisma.teamEdgeTask.updateMany({ where: { teamId, status: "TAKEN" }, data: { status: "OPEN", takenById: null, takenAt: null } }),
  ];
}

/**
 * Страховка (разбор празднования, 26.11): испытание или осаду нельзя разрешить в пользу какой-либо стороны, если
 * партия празднует победу или одна из сторон уже выбыла: в празднование город победителя не отнять никаким путём,
 * а выбывшая команда ничего не берёт и не теряет. Такие испытания и осады отменяются.
 */
export async function contestVoid(gameId: string, attackerId: string, defenderId: string): Promise<boolean> {
  const [game, out] = await Promise.all([
    prisma.game.findUnique({ where: { id: gameId }, select: { status: true, victoryAt: true } }),
    prisma.team.count({ where: { id: { in: [attackerId, defenderId] }, status: "defeated" } }),
  ]);
  // Партия не идёт (завершена, в том числе вручную) — испытаний и осад в ней больше нет (второй круг разбора, 26.11).
  return game?.status !== "ACTIVE" || game.victoryAt != null || out > 0;
}

/** Трое суток празднования победы (решение владельца 26.11). Здесь, а не в game.ts: этот модуль не тянет за собой других. */
export const VICTORY_MS = 72 * 3_600_000;

/**
 * Конец партии по часам (мс) или null — срока нет: срок из настроек, а в празднование без срока — победа + 72 ч
 * (то же, что victoryOf в services/game.ts).
 */
export function gameEndMs(game: { settings: unknown; victoryAt: Date | null }): number | null {
  const endsAt = Date.parse((game.settings as { endsAt?: string | null } | null)?.endsAt ?? "");
  if (Number.isFinite(endsAt)) return endsAt;
  return game.victoryAt ? game.victoryAt.getTime() + VICTORY_MS : null;
}

/**
 * Можно ли разбирать испытание или осаду со сроком `due` (второй круг разбора, 26.11): обход опаздывает, и к нему
 * может выйти уже и срок игры. Тогда разбирается только то, чей срок наступил не позже конца игры; остальное
 * снимет завершение игры (finishGame) — иначе город, «взятый» после конца игры, давал бы празднование вместо конца по сроку.
 */
export function dueBeforeEnd(due: Date, end: number | null, now: Date): boolean {
  if (due.getTime() > now.getTime()) return false;
  return end === null || end > now.getTime() || due.getTime() <= end;
}

/** Идущие партии и их конец по часам — для обхода сроков. */
export async function activeGameEnds(gameId?: string): Promise<Map<string, number | null>> {
  const games = await prisma.game.findMany({ where: { ...(gameId ? { id: gameId } : {}), status: "ACTIVE" }, select: { id: true, settings: true, victoryAt: true } });
  return new Map(games.map((g) => [g.id, gameEndMs(g)]));
}
