import { prisma } from "../db.js";
import { publish } from "./events.js";
import { loadBook, randomPassage } from "./bible.js";
import { loadCityContent } from "./cities.js";
import { notifyTeam } from "./notify.js";
import { checkLastTeam, checkTimeLimits } from "./game.js";
import { expirePassages } from "../routes/diplomacy.js";
import { onCityOwned } from "./teamMap.js";
import { BOOKS } from "@lotw/domain";

const bookName = (code: string) => BOOKS.find((b) => b.code === code)?.nameRu ?? code;
import type { Battle, BattleEntry, Prisma } from "@prisma/client";

/**
 * Битвы за города (правила 2.8, 2.8.1, 2.9 документации; учёт стихов — решение владельца).
 * Ставка N — сколько стихов команда обещает выучить в сумме по участникам. Атакующим выдаётся
 * случайный последовательный отрывок из min(N, стихов в книге); каждый участник отмечает выученные
 * стихи и прикрепляет ссылку на видео; считается СУММА выученных стихов по участникам
 * (один человек 10 + другой 10 = 20). Капитан отправляет атаку на проверку, когда сумма ≥ N;
 * T = от старта атаки до отправки. После одобрения админом у защитников ровно T: капитан выбирает
 * последовательный отрывок из всей книги, участники учат, сумма M ≥ одобренной суммы атаки → отражено
 * (ничья за защитниками). Сгоревшая атака (14 дней) — штраф +5. Если N ≥ стихов в книге — «книга
 * исчерпана»: отражённая атака закрепляет город навсегда.
 */

export const MIN_BID = 10;
export const ATTACK_LIMIT_MS = 14 * 86_400_000;
export const BURN_PENALTY = 5;

export type BattleWithEntries = Battle & { entries: BattleEntry[] };

/** Минимальная ставка команды на город: max(10 + штраф, уровень защиты + 1). */
export function minBidFor(defenseLevel: number, penalty: number): number {
  return Math.max(MIN_BID + penalty, defenseLevel + 1);
}

/** Сумма выученных стихов по участникам стороны (внутри участника стих считается один раз). */
export function sumVerses(entries: BattleEntry[], side: "ATTACK" | "DEFENSE", onlyApproved: boolean): number {
  const byUser = new Map<string, Set<number>>();
  for (const e of entries) {
    if (e.side !== side || e.status === "REJECTED" || (onlyApproved && e.status !== "APPROVED")) continue;
    const set = byUser.get(e.userId) ?? new Set<number>();
    for (let i = e.startIdx; i <= e.endIdx; i++) set.add(i);
    byUser.set(e.userId, set);
  }
  let sum = 0;
  for (const set of byUser.values()) sum += set.size;
  return sum;
}

/** Стихи, которые участник уже отметил на этой стороне. */
export function userVerses(entries: BattleEntry[], side: "ATTACK" | "DEFENSE", userId: string): Set<number> {
  const set = new Set<number>();
  for (const e of entries) if (e.side === side && e.userId === userId && e.status !== "REJECTED") for (let i = e.startIdx; i <= e.endIdx; i++) set.add(i);
  return set;
}

/** Группирует отсортированные индексы стихов в последовательные диапазоны. */
export function toRanges(verses: number[]): Array<{ start: number; end: number }> {
  const sorted = [...new Set(verses)].sort((a, b) => a - b);
  const out: Array<{ start: number; end: number }> = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (last && last.end === v - 1) last.end = v; else out.push({ start: v, end: v });
  }
  return out;
}

async function nodeOf(gameId: string, nodeKey: string) {
  return prisma.mapNode.findUniqueOrThrow({ where: { gameId_key: { gameId, key: nodeKey } } });
}

/** Запуск атаки: случайный отрывок из min(N, стихов книги), дедлайн 14 дней. */
export async function startAttack(battleId: string): Promise<BattleWithEntries> {
  const b = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
  const game = await prisma.game.findUniqueOrThrow({ where: { id: b.gameId }, select: { settings: true } });
  const settings = (game.settings ?? {}) as { includeGenealogies?: boolean };
  const book = await loadBook(b.bookCode);
  if (!book) throw new Error("Текст книги не загружен");
  const now = new Date();
  const len = Math.min(b.bid, book.total);
  const passage = randomPassage(book, len, settings.includeGenealogies ?? false) ?? randomPassage(book, len, true)!;
  return prisma.battle.update({
    where: { id: b.id },
    data: { status: "ATTACK", startedAt: now, attackDeadline: new Date(now.getTime() + ATTACK_LIMIT_MS), passageStart: passage.start, passageEnd: passage.end },
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
  const queued = await prisma.battle.findMany({ where: { gameId, nodeKey, status: "QUEUED" }, orderBy: [{ bid: "desc" }, { declaredAt: "asc" }] });
  for (const q of queued) {
    if (!owner || owner.teamId === q.attackerId) { await prisma.battle.update({ where: { id: q.id }, data: { status: "CANCELLED", resolvedAt: new Date() } }); continue; }
    const st = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: q.attackerId, nodeKey } } });
    const min = minBidFor(node.defenseLevel, st?.attackPenalty ?? 0);
    if (q.bid < min) {
      // Уровень защиты вырос выше ставки в очереди: атака отменяется (решение владельца).
      await prisma.battle.update({ where: { id: q.id }, data: { status: "CANCELLED", resolvedAt: new Date() } });
      notifyTeam(gameId, q.attackerId, `вызов городу ${bookName(q.bookCode)} отменён`, `Пока вы стояли в очереди, уровень испытания города вырос до ${node.defenseLevel}, а ваша ставка ${q.bid} стала ниже минимальной (${min}). Вызов отменён; можно бросить вызов заново с большей ставкой.`);
      continue;
    }
    await prisma.battle.update({ where: { id: q.id }, data: { defenderId: owner.teamId } });
    await startAttack(q.id);
    publish(gameId, { type: "battles", teamId: q.attackerId });
    publish(gameId, { type: "battles", teamId: owner.teamId });
    return;
  }
  if (queued.length) publish(gameId, { type: "battles" });
}

/** Капитан атакующих отправляет атаку на проверку: сумма выученных ≥ N. T фиксируется этим моментом. */
export async function submitAttack(b: BattleWithEntries): Promise<{ ok: true; battle: BattleWithEntries } | { ok: false; message: string }> {
  if (b.status !== "ATTACK") return { ok: false, message: "Вызов не идёт" };
  if (b.attackDoneAt) return { ok: false, message: "Вызов уже отправлен на проверку" };
  const sum = sumVerses(b.entries, "ATTACK", false);
  if (sum < b.bid) return { ok: false, message: `Выучено ${sum} из ${b.bid} стихов: не хватает ${b.bid - sum}` };
  const upd = await prisma.battle.update({ where: { id: b.id }, data: { attackDoneAt: new Date() }, include: { entries: true } });
  return { ok: true, battle: await maybeStartDefense(upd) };
}

/** Капитан защитников отправляет оборону на проверку до дедлайна: сумма ≥ одобренной суммы атаки. */
export async function submitDefense(b: BattleWithEntries): Promise<{ ok: true; battle: BattleWithEntries } | { ok: false; message: string }> {
  if (b.status !== "DEFENSE") return { ok: false, message: "Ответ не идёт" };
  if (b.defenseDoneAt) return { ok: false, message: "Ответ уже отправлен на проверку" };
  if (b.defenseDeadline && b.defenseDeadline.getTime() < Date.now()) return { ok: false, message: "Время ответа вышло" };
  const need = sumVerses(b.entries, "ATTACK", true);
  const sum = sumVerses(b.entries, "DEFENSE", false);
  if (sum < need) return { ok: false, message: `Выучено ${sum} из ${need} стихов: не хватает ${need - sum}` };
  const upd = await prisma.battle.update({ where: { id: b.id }, data: { defenseDoneAt: new Date(), defenseBid: sum }, include: { entries: true } });
  return { ok: true, battle: await maybeRepel(upd) };
}

/** Все записи стороны одобрены и сумма достаточна. */
function sideApproved(b: BattleWithEntries, side: "ATTACK" | "DEFENSE", need: number): boolean {
  const rows = b.entries.filter((e) => e.side === side && e.status !== "REJECTED");
  if (rows.length === 0 || rows.some((e) => e.status !== "APPROVED")) return false;
  return sumVerses(b.entries, side, true) >= need;
}

/** Атака отправлена и вся одобрена → таймер обороны ровно T = attackDoneAt − startedAt. */
export async function maybeStartDefense(b: BattleWithEntries): Promise<BattleWithEntries> {
  if (b.status !== "ATTACK" || !b.attackDoneAt || !b.startedAt || !sideApproved(b, "ATTACK", b.bid)) return b;
  const now = new Date();
  const T = Math.max(60_000, b.attackDoneAt.getTime() - b.startedAt.getTime());
  const upd = await prisma.battle.update({ where: { id: b.id }, data: { status: "DEFENSE", attackApprovedAt: now, defenseDeadline: new Date(now.getTime() + T) }, include: { entries: true } });
  publish(b.gameId, { type: "battles", teamId: b.defenderId });
  publish(b.gameId, { type: "battles", teamId: b.attackerId });
  const hours = Math.round(T / 360_000) / 10;
  notifyTeam(b.gameId, b.defenderId, `пошло время ответа города ${bookName(b.bookCode)}`, `Вызов одобрен: ${sumVerses(upd.entries, "ATTACK", true)} стихов. У вас ${hours} ч (до ${upd.defenseDeadline!.toLocaleString("ru-RU")}), чтобы выучить не меньше. Капитан выбирает отрывок из книги, участники отмечают выученные стихи и прикрепляют видео.`);
  return upd;
}

/** Оборона отправлена в срок и вся одобрена с суммой ≥ суммы атаки → атака отражена. */
export async function maybeRepel(b: BattleWithEntries): Promise<BattleWithEntries> {
  if (b.status !== "DEFENSE" || !b.defenseDoneAt || !b.defenseDeadline) return b;
  if (b.defenseDoneAt.getTime() > b.defenseDeadline.getTime()) return b;
  const need = sumVerses(b.entries, "ATTACK", true);
  if (!sideApproved(b, "DEFENSE", need)) return b;
  const M = sumVerses(b.entries, "DEFENSE", true);
  const now = new Date();
  const [upd] = await prisma.$transaction([
    prisma.battle.update({ where: { id: b.id }, data: { status: "REPELLED", defenseBid: M, resolvedAt: now }, include: { entries: true } }),
    prisma.mapNode.update({ where: { gameId_key: { gameId: b.gameId, key: b.nodeKey } }, data: { defenseLevel: M, ...(b.sumMode ? { lockedForever: true } : {}) } }),
  ]);
  publish(b.gameId, { type: "battles" });
  publish(b.gameId, { type: "map" });
  notifyTeam(b.gameId, b.defenderId, `город ${bookName(b.bookCode)} устоял`, `Ответ одобрен: ${M} стихов против ${need}. Город остаётся вашим, уровень испытания теперь ${M}.`);
  notifyTeam(b.gameId, b.attackerId, `город ${bookName(b.bookCode)} устоял`, `Хранители ответили ${M} стихами против ваших ${need}. Следующий вызов этому городу потребует не меньше ${M + 1}.`);
  await startNextFromQueue(b.gameId, b.nodeKey);
  return upd;
}

/** После отклонения записи: если суммы уже не хватает, отправка снимается — сторона добирает и отправляет заново. */
export async function afterReject(b: BattleWithEntries, side: "ATTACK" | "DEFENSE"): Promise<BattleWithEntries> {
  if (side === "ATTACK" && b.status === "ATTACK" && b.attackDoneAt && sumVerses(b.entries, "ATTACK", false) < b.bid) {
    return prisma.battle.update({ where: { id: b.id }, data: { attackDoneAt: null }, include: { entries: true } });
  }
  if (side === "DEFENSE" && b.status === "DEFENSE" && b.defenseDoneAt) {
    const need = sumVerses(b.entries, "ATTACK", true);
    if (sumVerses(b.entries, "DEFENSE", false) < need) {
      if (b.defenseDeadline && b.defenseDeadline.getTime() < Date.now()) { await resolveWon(b); return (await prisma.battle.findUniqueOrThrow({ where: { id: b.id }, include: { entries: true } })); }
      return prisma.battle.update({ where: { id: b.id }, data: { defenseDoneAt: null, defenseBid: null }, include: { entries: true } });
    }
  }
  return b;
}

/** Город взят: смена владельца, уровень защиты = одобренная сумма атаки; потеря столицы = поражение защитников. */
export async function resolveWon(b: Battle): Promise<void> {
  const now = new Date();
  const full = await prisma.battle.findUniqueOrThrow({ where: { id: b.id }, include: { entries: true } });
  const level = Math.max(b.bid, sumVerses(full.entries, "ATTACK", true));
  const defenderState = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: b.defenderId, nodeKey: b.nodeKey } } });
  const attackerState = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: b.attackerId, nodeKey: b.nodeKey } } });
  const wasCapital = defenderState?.isCapital ?? false;
  const attackerHasCapital = (await prisma.teamCityState.count({ where: { teamId: b.attackerId, isCapital: true } })) > 0;
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.battle.update({ where: { id: b.id }, data: { status: "WON", resolvedAt: now } }),
    prisma.mapNode.update({ where: { gameId_key: { gameId: b.gameId, key: b.nodeKey } }, data: { defenseLevel: level } }),
    prisma.teamCityState.updateMany({ where: { teamId: b.defenderId, nodeKey: b.nodeKey }, data: { capturedAt: null, isCapital: false, secondCapital: false } }),
    prisma.teamCityState.upsert({
      where: { teamId_nodeKey: { teamId: b.attackerId, nodeKey: b.nodeKey } },
      create: { gameId: b.gameId, teamId: b.attackerId, nodeKey: b.nodeKey, orderSolved: true, capturedAt: now, firstCapturedAt: now, isCapital: wasCapital || !attackerHasCapital, secondCapital: wasCapital && attackerHasCapital },
      update: { capturedAt: now, firstCapturedAt: attackerState?.firstCapturedAt ?? now, isCapital: wasCapital || !attackerHasCapital, secondCapital: wasCapital && attackerHasCapital },
    }),
  ];
  if (wasCapital) {
    ops.push(prisma.team.update({ where: { id: b.defenderId }, data: { status: "defeated" } }));
    // Остальные города выбывшей команды — руины: их берут выполнением заданий, без ключа и без испытания.
    const others = await prisma.teamCityState.findMany({ where: { teamId: b.defenderId, capturedAt: { not: null }, NOT: { nodeKey: b.nodeKey } }, select: { nodeKey: true } });
    if (others.length) ops.push(prisma.mapNode.updateMany({ where: { gameId: b.gameId, key: { in: others.map((o) => o.nodeKey) } }, data: { ruined: true, defenseLevel: 0 } }));
    ops.push(prisma.teamCityState.updateMany({ where: { teamId: b.defenderId, capturedAt: { not: null } }, data: { capturedAt: null, isCapital: false, secondCapital: false } }));
    ops.push(prisma.battle.updateMany({ where: { gameId: b.gameId, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] }, OR: [{ attackerId: b.defenderId }, { defenderId: b.defenderId }], NOT: { id: b.id } }, data: { status: "CANCELLED", resolvedAt: now } }));
  }
  await prisma.$transaction(ops);
  await onCityOwned(b.gameId, b.nodeKey, b.attackerId);
  publish(b.gameId, { type: "battles" });
  publish(b.gameId, { type: "map" });
  publish(b.gameId, { type: "cities" });
  publish(b.gameId, { type: "teams" });
  notifyTeam(b.gameId, b.attackerId, `город ${bookName(b.bookCode)} взят`, wasCapital ? "Это была столица противника: команда противника выбыла, город стал вашей второй столицей." : "Город теперь ваш.");
  notifyTeam(b.gameId, b.defenderId, `город ${bookName(b.bookCode)} потерян`, wasCapital ? "Потеряна столица: команда выбывает из игры." : "Ответ не дан в срок или город уступлен. Город перешёл претендентам; его можно вернуть по тем же правилам.");
  await startNextFromQueue(b.gameId, b.nodeKey);
  if (wasCapital) await checkLastTeam(b.gameId);
}

/** Сгоревшие атаки (14 дней без отправки) и просроченные обороны. Вызывается по таймеру и перед чтением. */
export async function sweep(gameId?: string): Promise<void> {
  const now = new Date();
  await checkTimeLimits(gameId);
  await expirePassages(gameId);
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
    notifyTeam(b.gameId, b.attackerId, `вызов городу ${bookName(b.bookCode)} не завершён`, `За 14 дней вызов не был отправлен на проверку. Штраф: минимальная ставка на этот город для вашей команды выросла на ${BURN_PENALTY}.`);
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
  if (node.ruined) reason = "Руины: город берут выполнением заданий, без ключа и без испытания";
  else if (!owner) reason = "Город свободен: его берут ключом из конверта, а не испытанием";
  else if (owner.teamId === teamId) reason = "Это ваш город";
  else if (team.status === "defeated") reason = "Команда выбыла из игры";
  else if (node.lockedForever) reason = "Город закреплён навсегда: он устоял в суммарном режиме";
  else if (!studied) reason = "Сначала решите задания всех районов";
  else if (!book) reason = "Текст этой книги ещё не загружен: бросить вызов нельзя";
  else if (mine) reason = mine.status === "QUEUED" ? "Вы уже в очереди на вызов" : "Испытание этого города уже идёт";
  return { defenseLevel: node.defenseLevel, sumMode: node.sumMode, locked: node.lockedForever, bookVerses: book?.total ?? null, penalty, minBid, canDeclare: reason === null, reason, owner: owner?.team ?? null };
}
