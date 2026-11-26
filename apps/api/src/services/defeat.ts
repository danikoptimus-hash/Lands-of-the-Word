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
    prisma.game.findUnique({ where: { id: gameId }, select: { victoryAt: true } }),
    prisma.team.count({ where: { id: { in: [attackerId, defenderId] }, status: "defeated" } }),
  ]);
  return game?.victoryAt != null || out > 0;
}
