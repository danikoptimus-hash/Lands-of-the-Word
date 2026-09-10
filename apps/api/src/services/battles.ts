import { prisma } from "../db.js";
import { publish } from "./events.js";
import { notifyTeam } from "./notify.js";
import { loadBook, randomPassage } from "./bible.js";
import { loadCityContent } from "./cities.js";
import type { Battle, BattleEntry, Prisma } from "@prisma/client";

/**
 * Битвы за города (правила 2.8, 2.8.1, 2.9 документации).
 * Атака: случайный отрывок из N стихов; T = от начала атаки до последней ссылки; лимит 14 дней (сгорание: штраф +5).
 * Оборона: после одобрения атаки у защитников ровно T на M ≥ N стихов; ничья — за защитниками.
 * Исчерпание книги (N ≥ стихов в книге): суммарный режим, отражённая атака закрепляет город навсегда.
 */

export const MIN_BID = 10;
export const ATTACK_LIMIT_MS = 14 * 86_400_000;
export const BURN_PENALTY = 5;

export type BattleWithEntries = Battle & { entries: BattleEntry[] };

/** Минимальная ставка команды на город: max(10 + штраф, уровень защиты + 1). */
export function minBidFor(defenseLevel: number, penalty: number): number {
  return Math.max(MIN_BID + penalty, defenseLevel + 1);
}

/** Число различных стихов, покрытых записями (в суммарном режиме — сумма по участникам, внутри участника без повторов). */
export function coverage(entries: BattleEntry[], sumMode: boolean, onlyApproved: boolean): number {
  const rows = entries.filter((e) => e.status !== "REJECTED" && (!onlyApproved || e.status === "APPROVED"));
  if (!sumMode) {
    const set = new Set<number>();
    for (const e of rows) for (let i = e.startIdx; i <= e.endIdx; i++) set.add(i);
    return set.size;
  }
  const byUser = new Map<string, Set<number>>();
  for (const e of rows) {
    const set = byUser.get(e.userId) ?? new Set<number>();
    for (let i = e.startIdx; i <= e.endIdx; i++) set.add(i);
    byUser.set(e.userId, set);
  }
  let sum = 0;
  for (const set of byUser.values()) sum += set.size;
  return sum;
}

/** Есть ли пересечение новой записи с существующими (в обычном режиме — по всей стороне, в суммарном — только у того же участника). */
export function overlaps(entries: BattleEntry[], side: "ATTACK" | "DEFENSE", userId: string, start: number, end: number, sumMode: boolean): boolean {
  return entries.some((e) => e.side === side && e.status !== "REJECTED" && (!sumMode || e.userId === userId) && e.startIdx <= end && e.endIdx >= start);
}

async function nodeOf(gameId: string, nodeKey: string) {
  return prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: nodeKey } } });
}

/** Запуск атаки из очереди/объявления: случайный отрывок, дедлайн 14 дней. */
export async function startAttack(battleId: string): Promise<BattleWithEntries> {
  const b = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
  const game = await prisma.game.findUniqueOrThrow({ where: { id: b.gameId }, select: { settings: true } });
  const settings = (game.settings ?? {}) as { includeGenealogies?: boolean };
  const book = await loadBook(b.bookCode);
  if (!book) throw new Error("Текст книги не загружен");
  const now = new Date();
  let passage: { start: number; end: number } | null = null;
  if (!b.sumMode) {
    passage = randomPassage(book, b.bid, settings.includeGenealogies ?? false);
    if (!passage) passage = randomPassage(book, b.bid, true);
  }
  return prisma.battle.update({
    where: { id: b.id },
    data: { status: "ATTACK", startedAt: now, attackDeadline: new Date(now.getTime() + ATTACK_LIMIT_MS), passageStart: passage?.start ?? null, passageEnd: passage?.end ?? null },
    include: { entries: true },
  });
}

/** После завершения битвы: из очереди стартует та, чья ставка больше (и не ниже новой минимальной). */
export async function startNextFromQueue(gameId: string, nodeKey: string): Promise<void> {
  const active = await prisma.battle.count({ where: { gameId, nodeKey, status: { in: ["ATTACK", "DEFENSE"] } } });
  if (active > 0) return;
  const node = await nodeOf(gameId, nodeKey);
  if (node.lockedForever) {
    await prisma.battle.updateMany({ where: { gameId, nodeKey, status: "QUEUED" }, data: { status: "CANCELLED", resolvedAt: new Date() } });
    return;
  }
  const owner = await prisma.teamCityState.findFirst({ where: { gameId, nodeKey, capturedAt: { not: null } } });
  const queued = await prisma.battle.findMany({ where: { gameId, nodeKey, status: "QUEUED" }, orderBy: [{ bid: "desc" }, { declaredAt: "asc" }], include: { entries: true } });
  for (const q of queued) {
    // Город сменил владельца: атака на свой город не нужна; защитник — новый владелец.
    if (!owner || owner.teamId === q.attackerId) { await prisma.battle.update({ where: { id: q.id }, data: { status: "CANCELLED", resolvedAt: new Date() } }); continue; }
    const st = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: q.attackerId, nodeKey } } });
    const min = minBidFor(node.defenseLevel, st?.attackPenalty ?? 0);
    if (q.bid < min) continue; // ждёт, пока команда поднимет ставку (ей придёт уведомление)
    await prisma.battle.update({ where: { id: q.id }, data: { defenderId: owner.teamId } });
    await startAttack(q.id);
    publish(gameId, { type: "battles", teamId: q.attackerId });
    publish(gameId, { type: "battles", teamId: owner.teamId });
    return;
  }
  if (queued.length) publish(gameId, { type: "battles" });
}

/** Пересчёт момента «последняя ссылка прикреплена» по покрытию отрывка. */
export async function recomputeAttackDone(b: BattleWithEntries): Promise<BattleWithEntries> {
  const covered = coverage(b.entries.filter((e) => e.side === "ATTACK"), b.sumMode, false);
  const complete = covered >= b.bid;
  if (complete && !b.attackDoneAt) {
    const last = b.entries.filter((e) => e.side === "ATTACK" && e.status !== "REJECTED").reduce((m, e) => Math.max(m, e.createdAt.getTime()), 0);
    return prisma.battle.update({ where: { id: b.id }, data: { attackDoneAt: new Date(last || Date.now()) }, include: { entries: true } });
  }
  if (!complete && b.attackDoneAt) return prisma.battle.update({ where: { id: b.id }, data: { attackDoneAt: null }, include: { entries: true } });
  return b;
}

export async function recomputeDefenseDone(b: BattleWithEntries): Promise<BattleWithEntries> {
  const covered = coverage(b.entries.filter((e) => e.side === "DEFENSE"), b.sumMode, false);
  const complete = covered >= b.bid;
  if (complete && !b.defenseDoneAt) {
    const last = b.entries.filter((e) => e.side === "DEFENSE" && e.status !== "REJECTED").reduce((m, e) => Math.max(m, e.createdAt.getTime()), 0);
    return prisma.battle.update({ where: { id: b.id }, data: { defenseDoneAt: new Date(last || Date.now()), defenseBid: covered }, include: { entries: true } });
  }
  if (!complete && b.defenseDoneAt) return prisma.battle.update({ where: { id: b.id }, data: { defenseDoneAt: null, defenseBid: null }, include: { entries: true } });
  if (complete) return prisma.battle.update({ where: { id: b.id }, data: { defenseBid: covered }, include: { entries: true } });
  return b;
}

/** Все записи стороны одобрены и покрытие достаточно. */
function sideApproved(b: BattleWithEntries, side: "ATTACK" | "DEFENSE"): boolean {
  const rows = b.entries.filter((e) => e.side === side && e.status !== "REJECTED");
  if (rows.length === 0 || rows.some((e) => e.status !== "APPROVED")) return false;
  return coverage(rows, b.sumMode, true) >= b.bid;
}

/** Одобрена вся атака → таймер обороны: ровно T = attackDoneAt − startedAt. */
export async function maybeStartDefense(b: BattleWithEntries): Promise<BattleWithEntries> {
  if (b.status !== "ATTACK" || !b.attackDoneAt || !b.startedAt || !sideApproved(b, "ATTACK")) return b;
  const now = new Date();
  const T = Math.max(60_000, b.attackDoneAt.getTime() - b.startedAt.getTime());
  const upd = await prisma.battle.update({ where: { id: b.id }, data: { status: "DEFENSE", attackApprovedAt: now, defenseDeadline: new Date(now.getTime() + T) }, include: { entries: true } });
  publish(b.gameId, { type: "battles", teamId: b.defenderId });
  publish(b.gameId, { type: "battles", teamId: b.attackerId });
  const hours = Math.round(T / 360_000) / 10;
  notifyTeam(b.gameId, b.defenderId, "началось время обороны", `Атака на ваш город одобрена. У вас ${hours} ч (до ${upd.defenseDeadline!.toLocaleString("ru-RU")}), чтобы записать ${b.bid} стихов или больше и прикрепить ссылки.`);
  return upd;
}

/** Одобрена вся оборона в срок → атака отражена. */
export async function maybeRepel(b: BattleWithEntries): Promise<BattleWithEntries> {
  if (b.status !== "DEFENSE" || !b.defenseDoneAt || !b.defenseDeadline || !sideApproved(b, "DEFENSE")) return b;
  if (b.defenseDoneAt.getTime() > b.defenseDeadline.getTime()) return b;
  const M = coverage(b.entries.filter((e) => e.side === "DEFENSE"), b.sumMode, true);
  const now = new Date();
  const [upd] = await prisma.$transaction([
    prisma.battle.update({ where: { id: b.id }, data: { status: "REPELLED", defenseBid: M, resolvedAt: now }, include: { entries: true } }),
    prisma.mapNode.update({ where: { gameId_key: { gameId: b.gameId, key: b.nodeKey } }, data: { defenseLevel: M, ...(b.sumMode ? { lockedForever: true } : {}) } }),
  ]);
  publish(b.gameId, { type: "battles" });
  publish(b.gameId, { type: "map" });
  notifyTeam(b.gameId, b.defenderId, "атака отражена", `Ваша оборона одобрена: город остаётся за вами, уровень защиты ${M}.`);
  notifyTeam(b.gameId, b.attackerId, "атака отражена", `Защитники ответили ${M} стихами: город остаётся у них. Следующая атака потребует не меньше ${M + 1}.`);
  await startNextFromQueue(b.gameId, b.nodeKey);
  return upd;
}

/** Город взят: смена владельца, уровень защиты = N; потеря столицы = поражение защитников. */
export async function resolveWon(b: Battle): Promise<void> {
  const now = new Date();
  const defenderState = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: b.defenderId, nodeKey: b.nodeKey } } });
  const wasCapital = defenderState?.isCapital ?? false;
  const attackerHasCapital = (await prisma.teamCityState.count({ where: { teamId: b.attackerId, isCapital: true } })) > 0;
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.battle.update({ where: { id: b.id }, data: { status: "WON", resolvedAt: now } }),
    prisma.mapNode.update({ where: { gameId_key: { gameId: b.gameId, key: b.nodeKey } }, data: { defenseLevel: b.bid } }),
    prisma.teamCityState.updateMany({ where: { teamId: b.defenderId, nodeKey: b.nodeKey }, data: { capturedAt: null, isCapital: false, secondCapital: false } }),
    prisma.teamCityState.upsert({
      where: { teamId_nodeKey: { teamId: b.attackerId, nodeKey: b.nodeKey } },
      create: { gameId: b.gameId, teamId: b.attackerId, nodeKey: b.nodeKey, orderSolved: true, capturedAt: now, isCapital: wasCapital || !attackerHasCapital, secondCapital: wasCapital && attackerHasCapital },
      update: { capturedAt: now, isCapital: wasCapital || !attackerHasCapital, secondCapital: wasCapital && attackerHasCapital },
    }),
  ];
  if (wasCapital) {
    // Поражение: команда выбывает, её остальные города становятся руинами (свободны).
    ops.push(prisma.team.update({ where: { id: b.defenderId }, data: { status: "defeated" } }));
    ops.push(prisma.teamCityState.updateMany({ where: { teamId: b.defenderId, capturedAt: { not: null } }, data: { capturedAt: null, isCapital: false, secondCapital: false } }));
    ops.push(prisma.battle.updateMany({ where: { gameId: b.gameId, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] }, OR: [{ attackerId: b.defenderId }, { defenderId: b.defenderId }], NOT: { id: b.id } }, data: { status: "CANCELLED", resolvedAt: now } }));
  }
  await prisma.$transaction(ops);
  publish(b.gameId, { type: "battles" });
  publish(b.gameId, { type: "map" });
  publish(b.gameId, { type: "cities" });
  publish(b.gameId, { type: "teams" });
  notifyTeam(b.gameId, b.attackerId, "город взят", `Оборона не состоялась в срок: город ваш${wasCapital ? ", это была столица противника" : ""}.`);
  notifyTeam(b.gameId, b.defenderId, wasCapital ? "столица потеряна" : "город потерян", wasCapital ? "Оборона столицы не состоялась в срок: команда выбывает из игры." : "Оборона не состоялась в срок: город перешёл атакующим.");
  await startNextFromQueue(b.gameId, b.nodeKey);
}

/** Сгоревшие атаки (14 дней) и просроченные обороны. Вызывается по таймеру и перед чтением. */
export async function sweep(gameId?: string): Promise<void> {
  const now = new Date();
  const burnt = await prisma.battle.findMany({ where: { ...(gameId ? { gameId } : {}), status: "ATTACK", attackDeadline: { lt: now }, attackDoneAt: null } });
  for (const b of burnt) {
    await prisma.$transaction([
      prisma.battle.update({ where: { id: b.id }, data: { status: "EXPIRED", resolvedAt: now } }),
      prisma.teamCityState.upsert({
        where: { teamId_nodeKey: { teamId: b.attackerId, nodeKey: b.nodeKey } },
        create: { gameId: b.gameId, teamId: b.attackerId, nodeKey: b.nodeKey, attackPenalty: BURN_PENALTY },
        update: { attackPenalty: { increment: BURN_PENALTY } },
      }),
    ]);
    publish(b.gameId, { type: "battles", teamId: b.attackerId });
    publish(b.gameId, { type: "battles", teamId: b.defenderId });
    notifyTeam(b.gameId, b.attackerId, "атака сгорела", `За 14 дней записи не были прикреплены: атака сгорела, минимальная ставка на этот город для вашей команды выросла на ${BURN_PENALTY}.`);
    await startNextFromQueue(b.gameId, b.nodeKey);
  }
  const lost = await prisma.battle.findMany({ where: { ...(gameId ? { gameId } : {}), status: "DEFENSE", defenseDeadline: { lt: now }, defenseDoneAt: null } });
  for (const b of lost) await resolveWon(b);
}

/** Может ли команда объявить войну этому городу, и какая минимальная ставка. */
export async function warOptions(gameId: string, teamId: string, nodeKey: string) {
  const node = await nodeOf(gameId, nodeKey);
  const [book, content, owner, state, team, mine] = await Promise.all([
    loadBook(node.bookCode ?? ""),
    loadCityContent(node.bookCode ?? ""),
    prisma.teamCityState.findFirst({ where: { gameId, nodeKey, capturedAt: { not: null } }, include: { team: { select: { id: true, name: true, color: true } } } }),
    prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId, nodeKey } } }),
    prisma.team.findUniqueOrThrow({ where: { id: teamId } }),
    prisma.battle.findFirst({ where: { gameId, nodeKey, attackerId: teamId, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } } }),
  ]);
  const penalty = state?.attackPenalty ?? 0;
  const minBid = minBidFor(node.defenseLevel, penalty);
  const studied = Boolean(content && state?.orderSolved && content.tasks.every((_, i) => state!.doneTasks.includes(i)));
  let reason: string | null = null;
  if (!owner) reason = "Город свободен: его берут ключом из конверта, а не войной";
  else if (owner.teamId === teamId) reason = "Это ваш город";
  else if (team.status === "defeated") reason = "Команда выбыла из игры";
  else if (node.lockedForever) reason = "Город закреплён навсегда: атака в суммарном режиме отражена";
  else if (!studied) reason = "Сначала решите задания всех районов";
  else if (!book) reason = "Текст этой книги ещё не загружен: войну объявить нельзя";
  else if (mine) reason = mine.status === "QUEUED" ? "Вы уже в очереди на атаку" : "Битва за этот город уже идёт";
  return { defenseLevel: node.defenseLevel, sumMode: node.sumMode, locked: node.lockedForever, bookVerses: book?.total ?? null, penalty, minBid, canDeclare: reason === null, reason, owner: owner?.team ?? null };
}
