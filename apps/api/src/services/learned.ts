import { prisma } from "../db.js";

/**
 * Стихи, выученные в другой команде (решение владельца 17.11: после проигрыша участники переходят в другие команды и
 * «уже не могли учить те, которые учили будучи в другой команде» — ни для стены, ни для вызова, ни для ответа).
 * Здесь — что считается выученным в другой команде и сколько из-за этого хранители могут ответить на самом деле.
 * Правило для отметки стихов — `learnedVerses` в routes/battles.ts, для блоков стены — routes/wall.ts.
 */

/**
 * Запись возвращена не за качество, а концом хода: сторона проиграла по сроку (ответ не дан — город взят; вызов сгорел),
 * и запись вернулась в ту же минуту — так работает кнопка администратора «Время вышло» (POST …/expire).
 */
const TIMEOUT_RETURN_MS = 5 * 60_000;
export function returnedByTimeout(e: { side: string; decidedAt: Date | null; battle: { status: string; resolvedAt: Date | null } }): boolean {
  const lost = (e.side === "DEFENSE" && e.battle.status === "WON") || (e.side === "ATTACK" && e.battle.status === "EXPIRED");
  return lost && e.decidedAt !== null && e.battle.resolvedAt !== null && Math.abs(e.battle.resolvedAt.getTime() - e.decidedAt.getTime()) <= TIMEOUT_RETURN_MS;
}

/** Запись испытания, сделанная в другой команде, закрывает свои стихи: отмечена и не возвращена как негодная. */
export const closesElsewhere = (e: { status: string; side: string; decidedAt: Date | null; battle: { status: string; resolvedAt: Date | null } }): boolean =>
  e.status === "SUBMITTED" || e.status === "APPROVED" || (e.status === "REJECTED" && returnedByTimeout(e));

/**
 * Предел ответа хранителей (решение владельца 31.10: «столько стихов хранители могут ответить физически» — участники ×
 * стихи книги) за вычетом стихов, которые их участники выучили в другой команде (решение владельца 17.11: «вычитать
 * из предела закрытые для него стихи… это будет справедливо»): сдать их снова участник не может, и новой команде они
 * не засчитываются, так что без вычета команда с перешедшим участником не добирала бы максимум книги и не могла бы
 * ответить на ставку у самого предела. По этому же числу считается закрепление города («каждый выучил всю книгу»).
 * Стих не вычитается, если он у участника всё же есть в своей команде (принят в её испытании или стоит её блоком стены).
 */
export async function answerCap(gameId: string, teamId: string, bookCode: string, total: number): Promise<{ cap: number; members: number; closed: number }> {
  const ids = (await prisma.membership.findMany({ where: { teamId }, select: { userId: true } })).map((m) => m.userId);
  const full = total * Math.max(1, ids.length);
  if (ids.length === 0) return { cap: full, members: 0, closed: 0 };
  const [entries, blocks] = await Promise.all([
    prisma.battleEntry.findMany({ where: { userId: { in: ids }, carried: false, battle: { gameId, bookCode } }, select: { userId: true, teamId: true, status: true, side: true, startIdx: true, endIdx: true, decidedAt: true, battle: { select: { status: true, resolvedAt: true } } } }),
    prisma.wallBlock.findMany({ where: { gameId, bookCode, userId: { in: ids }, cargo: false, status: { not: "REJECTED" } }, select: { userId: true, teamId: true, startIdx: true, endIdx: true } }),
  ]);
  const elsewhere = new Map<string, Set<number>>(), own = new Map<string, Set<number>>();
  const put = (map: Map<string, Set<number>>, userId: string, from: number, to: number) => {
    let set = map.get(userId);
    if (!set) { set = new Set(); map.set(userId, set); }
    for (let i = Math.max(0, from); i <= Math.min(total - 1, to); i++) set.add(i);
  };
  for (const e of entries) {
    if (e.teamId !== teamId) { if (closesElsewhere(e)) put(elsewhere, e.userId, e.startIdx, e.endIdx); }
    else if (e.status === "APPROVED") put(own, e.userId, e.startIdx, e.endIdx);
  }
  for (const b of blocks) put(b.teamId !== teamId ? elsewhere : own, b.userId, b.startIdx, b.endIdx);
  let closed = 0;
  for (const [userId, set] of elsewhere) { const mine = own.get(userId); for (const v of set) if (!mine?.has(v)) closed++; }
  return { cap: Math.max(0, full - closed), members: ids.length, closed };
}
