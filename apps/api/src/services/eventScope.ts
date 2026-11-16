import { prisma } from "../db.js";
import { publish, setBattlePartners } from "./events.js";

/**
 * Кому, кроме самой команды, нужны её события (ревизия скорости, этап 2: адресная рассылка — см. services/events.ts).
 */

/**
 * Стороны испытаний команды: претенденты, хранители и союзники тех испытаний, что идут сейчас или закрылись в последние
 * две минуты (событие о закрытии приходит уже после смены состояния). Им уходит то же событие `battles`.
 */
setBattlePartners(async (gameId, teamId) => {
  const rows = await prisma.battle.findMany({
    where: {
      gameId,
      AND: [
        { OR: [{ attackerId: teamId }, { defenderId: teamId }, { allies: { some: { allyId: teamId } } }] },
        { OR: [{ status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } }, { resolvedAt: { gte: new Date(Date.now() - 120_000) } }] },
      ],
    },
    select: { attackerId: true, defenderId: true, allies: { select: { allyId: true } } },
  });
  const ids = new Set<string>();
  for (const b of rows) { ids.add(b.attackerId); ids.add(b.defenderId); for (const a of b.allies) ids.add(a.allyId); }
  ids.delete(teamId);
  return [...ids];
});

/**
 * Перемена на стороне карты (принятое дело, высадка, мощение): её видят команды, у которых открыт хотя бы один конец
 * стороны, — у них на карте появляется или исчезает чужая дорога. Каждой такой команде уходит своё событие `map`;
 * остальных оно не будит. `except` — команда, которой событие уже отправлено.
 */
export async function publishRoad(gameId: string, keys: string[], except?: string): Promise<void> {
  try {
    const rows = await prisma.teamNodeState.findMany({ where: { nodeKey: { in: keys }, team: { gameId } }, select: { teamId: true }, distinct: ["teamId"] });
    for (const r of rows) if (r.teamId !== except) publish(gameId, { type: "map", teamId: r.teamId });
  } catch { /* не узнали, кому видно, — их карты догонят сверкой */ }
}
