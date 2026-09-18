import { prisma } from "../db.js";
import { publish } from "./events.js";
import { loadBook, randomPassage } from "./bible.js";
import { loadCityContent } from "./cities.js";
import { notifyTeam } from "./notify.js";
import { fmtDate, fmtDay, msg } from "./i18n.js";
import { checkLastTeam, checkTimeLimits } from "./game.js";
import { expirePassages } from "../routes/diplomacy.js";
import { onCityOwned, returnStaleTasks } from "./teamMap.js";
import { days, rulesOf, type Rules } from "./rules.js";
import { sweepSieges } from "./siege.js";
import { BOOKS } from "@lotw/domain";

const bookName = (code: string) => BOOKS.find((b) => b.code === code)?.nameRu ?? code;
import type { Battle, BattleEntry, Prisma } from "@prisma/client";

/**
 * Испытания городов (правила 2.8, 2.8.1, 2.9 документа; решения владельца 18.09 по экспертному заключению).
 * Ставка N — сколько стихов команда обещает выучить в сумме по участникам. Претендентам при старте выдаётся
 * случайный последовательный отрывок из min(N, стихов в книге); каждый участник отмечает выученные стихи и
 * прикрепляет ссылку на видео; считается СУММА по участникам (один человек 10 + другой 10 = 20).
 * Капитан отправляет вызов на проверку, когда сумма ≥ N; T = от старта до отправки минус время, пока
 * вызов лежал на проверке после возврата записи (стоп-часы). Вызов состоит ровно из N стихов: лишние
 * выученные стихи не считаются, хранители отвечают на N, уровень нового города = N.
 * После одобрения у хранителей ровно T: капитан выбирает последовательный отрывок из всей книги, участники
 * учат, сумма M ≥ N → отражено (ничья за хранителями), уровень = M. Выученные раньше стихи этой книги
 * хранителям засчитываются автоматически. Сгоревший вызов — штраф к минимальной ставке; сгоревшая команда
 * встаёт в очередь после всех, кто встал раньше. Закрепление — только после отбитого максимума (каждый
 * участник хранителей выучил всю книгу) и только на срок. Уровень защиты тает при бездействии (усталость).
 */

export type BattleWithEntries = Battle & { entries: BattleEntry[] };

/** Правила игры, в которой идёт испытание. */
export async function gameRules(gameId: string): Promise<Rules> {
  const g = await prisma.game.findUnique({ where: { id: gameId }, select: { settings: true } });
  return rulesOf(g?.settings);
}

/** Минимальная ставка команды на город: max(минимум + штраф, уровень защиты + 1). */
export function minBidFor(defenseLevel: number, penalty: number, rules: Rules): number {
  return Math.max(rules.minBid + penalty, defenseLevel + 1);
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

/** Город закреплён (после отбитого максимума) до этой даты. */
export const isLocked = (node: { lockedUntil: Date | null }, now = Date.now()) => node.lockedUntil !== null && node.lockedUntil.getTime() > now;

/** Запуск вызова: только в этот момент выдаётся случайный отрывок и идёт срок вызова (после очереди — с её конца). */
export async function startAttack(battleId: string): Promise<BattleWithEntries> {
  const b = await prisma.battle.findUniqueOrThrow({ where: { id: battleId } });
  const game = await prisma.game.findUniqueOrThrow({ where: { id: b.gameId }, select: { settings: true } });
  const settings = (game.settings ?? {}) as { includeGenealogies?: boolean };
  const rules = rulesOf(game.settings);
  const book = await loadBook(b.bookCode);
  if (!book) throw new Error("Текст книги не загружен");
  const now = new Date();
  const len = Math.min(b.bid, book.total);
  const passage = randomPassage(book, len, settings.includeGenealogies ?? false) ?? randomPassage(book, len, true)!;
  return prisma.battle.update({
    where: { id: b.id },
    data: { status: "ATTACK", startedAt: now, attackDeadline: new Date(now.getTime() + days(rules.attackDays)), passageStart: passage.start, passageEnd: passage.end },
    include: { entries: true },
  });
}

/**
 * Порядок очереди: по ставке (больше — раньше), но вызов, объявленный после сгорания предыдущего вызова этой
 * команды этому городу, стоит после всех, кто встал в очередь раньше него (решение владельца 18.09).
 */
export function orderQueue<T extends { bid: number; declaredAt: Date; afterBurn: boolean }>(queued: T[]): T[] {
  const out = queued.filter((q) => !q.afterBurn).sort((a, b) => b.bid - a.bid || a.declaredAt.getTime() - b.declaredAt.getTime());
  const burns = queued.filter((q) => q.afterBurn).sort((a, b) => a.declaredAt.getTime() - b.declaredAt.getTime());
  for (const q of burns) {
    // После всех, кто встал в очередь раньше него.
    let pos = 0;
    for (let i = 0; i < out.length; i++) if (out[i]!.declaredAt.getTime() < q.declaredAt.getTime()) pos = i + 1;
    out.splice(pos, 0, q);
  }
  return out;
}

/** После завершения испытания: из очереди стартует следующий по порядку очереди (и не ниже новой минимальной ставки). */
export async function startNextFromQueue(gameId: string, nodeKey: string): Promise<void> {
  const active = await prisma.battle.count({ where: { gameId, nodeKey, status: { in: ["ATTACK", "DEFENSE"] } } });
  if (active > 0) return;
  const node = await nodeOf(gameId, nodeKey);
  const rules = await gameRules(gameId);
  if (isLocked(node)) {
    const queued = await prisma.battle.findMany({ where: { gameId, nodeKey, status: "QUEUED" } });
    await prisma.battle.updateMany({ where: { gameId, nodeKey, status: "QUEUED" }, data: { status: "CANCELLED", resolvedAt: new Date() } });
    for (const q of queued) notifyTeam(gameId, q.attackerId, "вызов городу {book} отменён", (locale) => msg(locale, "Город закреплён до {date}: хранители отбились, выучив всю книгу каждым участником. Вызов из очереди отменён.", { date: fmtDay(node.lockedUntil!, locale) }), { book: node.bookCode ?? "" });
    return;
  }
  const owner = await prisma.teamCityState.findFirst({ where: { gameId, nodeKey, capturedAt: { not: null } } });
  const queued = orderQueue(await prisma.battle.findMany({ where: { gameId, nodeKey, status: "QUEUED" } }));
  for (const q of queued) {
    if (!owner || owner.teamId === q.attackerId) { await prisma.battle.update({ where: { id: q.id }, data: { status: "CANCELLED", resolvedAt: new Date() } }); continue; }
    const st = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: q.attackerId, nodeKey } } });
    const min = minBidFor(node.defenseLevel, st?.attackPenalty ?? 0, rules);
    if (q.bid < min) {
      // Уровень защиты вырос выше ставки в очереди: атака отменяется (решение владельца).
      await prisma.battle.update({ where: { id: q.id }, data: { status: "CANCELLED", resolvedAt: new Date() } });
      notifyTeam(gameId, q.attackerId, "вызов городу {book} отменён", "Пока вы стояли в очереди, уровень испытания города вырос до {level}, а ваша ставка {bid} стала ниже минимальной ({min}). Вызов отменён; можно бросить вызов заново с большей ставкой.", { book: q.bookCode, level: node.defenseLevel, bid: q.bid, min });
      continue;
    }
    await prisma.battle.update({ where: { id: q.id }, data: { defenderId: owner.teamId } });
    const started = await startAttack(q.id);
    publish(gameId, { type: "battles", teamId: q.attackerId });
    publish(gameId, { type: "battles", teamId: owner.teamId });
    notifyTeam(gameId, q.attackerId, "ваш вызов городу {book} начался", (locale) => msg(locale, "Очередь дошла до вас: отрывок выдан, срок вызова — до {date}.", { date: fmtDate(started.attackDeadline!, locale) }), { book: q.bookCode });
    notifyTeam(gameId, owner.teamId, "вызов вашему городу {book}", "Команда «{team}» из очереди начала вызов вашему городу, ставка {bid} стихов.", { book: q.bookCode, team: (await prisma.team.findUnique({ where: { id: q.attackerId }, select: { name: true } }))?.name ?? "", bid: q.bid });
    return;
  }
  if (queued.length) publish(gameId, { type: "battles" });
}

/** Капитан претендентов отправляет вызов на проверку: сумма выученных ≥ N. T фиксируется этим моментом. */
export async function submitAttack(b: BattleWithEntries): Promise<{ ok: true; battle: BattleWithEntries } | { ok: false; message: string; vars?: Record<string, number> }> {
  if (b.status !== "ATTACK") return { ok: false, message: "Вызов сейчас не идёт" };
  if (b.attackDoneAt) return { ok: false, message: "Вызов уже отправлен на проверку" };
  const sum = sumVerses(b.entries, "ATTACK", false);
  if (sum < b.bid) return { ok: false, message: "Выучено {sum} из {need} стихов: не хватает {missing}", vars: { sum, need: b.bid, missing: b.bid - sum } };
  const upd = await prisma.battle.update({ where: { id: b.id }, data: { attackDoneAt: new Date() }, include: { entries: true } });
  return { ok: true, battle: await maybeStartDefense(upd) };
}

/** Капитан хранителей отправляет ответ на проверку до дедлайна: сумма ≥ ставки вызова. */
export async function submitDefense(b: BattleWithEntries): Promise<{ ok: true; battle: BattleWithEntries } | { ok: false; message: string; vars?: Record<string, number> }> {
  if (b.status !== "DEFENSE") return { ok: false, message: "Ответ сейчас не идёт" };
  if (b.defenseDoneAt) return { ok: false, message: "Ответ уже отправлен на проверку" };
  if (b.defenseDeadline && b.defenseDeadline.getTime() < Date.now()) return { ok: false, message: "Время ответа вышло" };
  const need = b.bid;
  const sum = sumVerses(b.entries, "DEFENSE", false);
  if (sum < need) return { ok: false, message: "Выучено {sum} из {need} стихов: не хватает {missing}", vars: { sum, need, missing: need - sum } };
  const upd = await prisma.battle.update({ where: { id: b.id }, data: { defenseDoneAt: new Date(), defenseBid: sum }, include: { entries: true } });
  return { ok: true, battle: await maybeRepel(upd) };
}

/** Все записи стороны одобрены и сумма достаточна. */
function sideApproved(b: BattleWithEntries, side: "ATTACK" | "DEFENSE", need: number): boolean {
  const rows = b.entries.filter((e) => e.side === side && e.status !== "REJECTED");
  if (rows.length === 0 || rows.some((e) => e.status !== "APPROVED")) return false;
  return sumVerses(b.entries, side, true) >= need;
}

/**
 * Выученные раньше стихи этой книги (одобренные записи команды в любых испытаниях, любой стороной) засчитываются
 * хранителям автоматически: записи копируются на сторону ответа как принятые (решение владельца 18.09).
 */
async function carryLearnedVerses(b: BattleWithEntries): Promise<BattleWithEntries> {
  const members = new Set((await prisma.membership.findMany({ where: { teamId: b.defenderId }, select: { userId: true } })).map((m) => m.userId));
  const past = await prisma.battleEntry.findMany({
    where: { teamId: b.defenderId, status: "APPROVED", carried: false, battle: { gameId: b.gameId, bookCode: b.bookCode, NOT: { id: b.id } } },
    select: { userId: true, startIdx: true, endIdx: true, links: true },
  });
  const byUser = new Map<string, { verses: Set<number>; links: Set<string> }>();
  for (const e of past) {
    if (!members.has(e.userId)) continue;
    const u = byUser.get(e.userId) ?? { verses: new Set<number>(), links: new Set<string>() };
    for (let i = e.startIdx; i <= e.endIdx; i++) u.verses.add(i);
    for (const l of e.links) u.links.add(l);
    byUser.set(e.userId, u);
  }
  const rows: Prisma.BattleEntryCreateManyInput[] = [];
  for (const [userId, u] of byUser) {
    for (const r of toRanges([...u.verses])) rows.push({ battleId: b.id, side: "DEFENSE", teamId: b.defenderId, userId, startIdx: r.start, endIdx: r.end, links: [...u.links].slice(0, 20), note: "Зачтено из прошлого испытания", status: "APPROVED", carried: true, decidedAt: new Date() });
  }
  if (rows.length) await prisma.battleEntry.createMany({ data: rows });
  return prisma.battle.findUniqueOrThrow({ where: { id: b.id }, include: { entries: true } });
}

/** Вызов отправлен и весь одобрен → время ответа ровно T = (отправка − старт) − время на проверке. */
export async function maybeStartDefense(b: BattleWithEntries): Promise<BattleWithEntries> {
  if (b.status !== "ATTACK" || !b.attackDoneAt || !b.startedAt || !sideApproved(b, "ATTACK", b.bid)) return b;
  const rules = await gameRules(b.gameId);
  const now = new Date();
  const T = Math.max(rules.minAnswerSeconds * 1000, b.attackDoneAt.getTime() - b.startedAt.getTime() - b.attackPausedMs);
  let upd = await prisma.battle.update({ where: { id: b.id }, data: { status: "DEFENSE", attackApprovedAt: now, defenseDeadline: new Date(now.getTime() + T) }, include: { entries: true } });
  upd = await carryLearnedVerses(upd);
  publish(b.gameId, { type: "battles", teamId: b.defenderId });
  publish(b.gameId, { type: "battles", teamId: b.attackerId });
  const hours = Math.round(T / 360_000) / 10;
  const carried = sumVerses(upd.entries, "DEFENSE", true);
  notifyTeam(b.gameId, b.defenderId, "пошло время ответа города {book}", (locale) => msg(locale, "Вызов одобрен: {verses} стихов. У вас {hours} ч (до {deadline}), чтобы выучить не меньше.{carried} Капитан выбирает отрывок из книги, участники отмечают выученные стихи и прикрепляют видео.", { verses: b.bid, hours, deadline: fmtDate(upd.defenseDeadline!, locale), carried: carried ? msg(locale, " Уже зачтено из прошлых испытаний: {n}.", { n: carried }) : "" }), { book: b.bookCode });
  // Если зачтённых стихов уже хватает — ответ дан без единого нового стиха.
  if (carried >= b.bid) {
    upd = await prisma.battle.update({ where: { id: b.id }, data: { defenseDoneAt: now, defenseBid: carried }, include: { entries: true } });
    upd = await maybeRepel(upd);
  }
  return upd;
}

/** Ответ отправлен в срок и весь одобрен с суммой ≥ ставки → вызов отражён. */
export async function maybeRepel(b: BattleWithEntries): Promise<BattleWithEntries> {
  if (b.status !== "DEFENSE" || !b.defenseDoneAt || !b.defenseDeadline) return b;
  if (b.defenseDoneAt.getTime() > b.defenseDeadline.getTime()) return b;
  const need = b.bid;
  if (!sideApproved(b, "DEFENSE", need)) return b;
  const M = sumVerses(b.entries, "DEFENSE", true);
  const now = new Date();
  // Закрепление — только при максимуме: каждый участник хранителей выучил всю книгу (решение владельца 18.09).
  const [book, members, rules] = await Promise.all([loadBook(b.bookCode), prisma.membership.count({ where: { teamId: b.defenderId } }), gameRules(b.gameId)]);
  const max = book ? book.total * Math.max(1, members) : Infinity;
  const lockedUntil = b.sumMode && M >= max && rules.lockWeeks > 0 ? new Date(now.getTime() + days(7 * rules.lockWeeks)) : null;
  const [upd] = await prisma.$transaction([
    prisma.battle.update({ where: { id: b.id }, data: { status: "REPELLED", defenseBid: M, resolvedAt: now }, include: { entries: true } }),
    prisma.mapNode.update({ where: { gameId_key: { gameId: b.gameId, key: b.nodeKey } }, data: { defenseLevel: M, fatigueAt: null, ...(lockedUntil ? { lockedUntil, maxReachedAt: now } : {}) } }),
  ]);
  publish(b.gameId, { type: "battles" });
  publish(b.gameId, { type: "map" });
  notifyTeam(b.gameId, b.defenderId, "город {book} устоял", (locale) => msg(locale, "Ответ одобрен: {m} стихов против {need}. Город остаётся вашим, уровень испытания теперь {m}.", { m: M, need }) + (lockedUntil ? msg(locale, " Каждый участник выучил всю книгу: город закреплён до {date}.", { date: fmtDay(lockedUntil, locale) }) : ""), { book: b.bookCode });
  notifyTeam(b.gameId, b.attackerId, "город {book} устоял", "Хранители ответили {m} стихами против ваших {need}. Следующий вызов этому городу потребует не меньше {next}.", { book: b.bookCode, m: M, need, next: M + 1 });
  await startNextFromQueue(b.gameId, b.nodeKey);
  return upd;
}

/**
 * После возврата записи: отправка снимается, сторона добирает и отправляет заново. Стоп-часы (решение владельца
 * 18.09): время, пока сторона ждала проверки, не считается — дедлайн сдвигается на длительность проверки.
 */
export async function afterReject(b: BattleWithEntries, side: "ATTACK" | "DEFENSE"): Promise<BattleWithEntries> {
  const now = Date.now();
  if (side === "ATTACK" && b.status === "ATTACK" && b.attackDoneAt) {
    const paused = Math.max(0, now - b.attackDoneAt.getTime());
    return prisma.battle.update({ where: { id: b.id }, data: { attackDoneAt: null, attackPausedMs: { increment: paused }, ...(b.attackDeadline ? { attackDeadline: new Date(b.attackDeadline.getTime() + paused) } : {}) }, include: { entries: true } });
  }
  if (side === "DEFENSE" && b.status === "DEFENSE" && b.defenseDoneAt) {
    const paused = Math.max(0, now - b.defenseDoneAt.getTime());
    return prisma.battle.update({ where: { id: b.id }, data: { defenseDoneAt: null, defenseBid: null, ...(b.defenseDeadline ? { defenseDeadline: new Date(b.defenseDeadline.getTime() + paused) } : {}) }, include: { entries: true } });
  }
  return b;
}

/** Город взят: смена владельца, уровень защиты = ставка; потеря столицы = поражение хранителей. */
export async function resolveWon(b: Battle): Promise<void> {
  const now = new Date();
  const level = b.bid;
  const defenderState = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: b.defenderId, nodeKey: b.nodeKey } } });
  const attackerState = await prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId: b.attackerId, nodeKey: b.nodeKey } } });
  const wasCapital = defenderState?.isCapital ?? false;
  const attackerHasCapital = (await prisma.teamCityState.count({ where: { teamId: b.attackerId, isCapital: true } })) > 0;
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.battle.update({ where: { id: b.id }, data: { status: "WON", resolvedAt: now } }),
    prisma.mapNode.update({ where: { gameId_key: { gameId: b.gameId, key: b.nodeKey } }, data: { defenseLevel: level, fatigueAt: null, lockedUntil: null, maxReachedAt: null } }),
    prisma.teamCityState.updateMany({ where: { teamId: b.defenderId, nodeKey: b.nodeKey }, data: { capturedAt: null, isCapital: false, secondCapital: false } }),
    prisma.teamCityState.upsert({
      where: { teamId_nodeKey: { teamId: b.attackerId, nodeKey: b.nodeKey } },
      create: { gameId: b.gameId, teamId: b.attackerId, nodeKey: b.nodeKey, orderSolved: true, capturedAt: now, firstCapturedAt: now, isCapital: wasCapital || !attackerHasCapital, secondCapital: wasCapital && attackerHasCapital },
      update: { capturedAt: now, firstCapturedAt: attackerState?.firstCapturedAt ?? now, isCapital: wasCapital || !attackerHasCapital, secondCapital: wasCapital && attackerHasCapital },
    }),
    // Разрешения на проход, выданные прежним владельцем, со сменой владельца сбрасываются (решение владельца 18.09).
    prisma.passageRequest.updateMany({ where: { gameId: b.gameId, nodeKey: b.nodeKey, status: { in: ["APPROVED", "PENDING"] } }, data: { status: "REVOKED", decidedAt: now } }),
  ];
  if (wasCapital) {
    ops.push(prisma.team.update({ where: { id: b.defenderId }, data: { status: "defeated" } }));
    // Остальные города выбывшей команды — руины: их берут выполнением заданий, без ключа и без испытания.
    const others = await prisma.teamCityState.findMany({ where: { teamId: b.defenderId, capturedAt: { not: null }, NOT: { nodeKey: b.nodeKey } }, select: { nodeKey: true } });
    if (others.length) ops.push(prisma.mapNode.updateMany({ where: { gameId: b.gameId, key: { in: others.map((o) => o.nodeKey) } }, data: { ruined: true, defenseLevel: 0, lockedUntil: null } }));
    ops.push(prisma.teamCityState.updateMany({ where: { teamId: b.defenderId, capturedAt: { not: null } }, data: { capturedAt: null, isCapital: false, secondCapital: false } }));
    ops.push(prisma.battle.updateMany({ where: { gameId: b.gameId, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] }, OR: [{ attackerId: b.defenderId }, { defenderId: b.defenderId }], NOT: { id: b.id } }, data: { status: "CANCELLED", resolvedAt: now } }));
    // Взятые дела выбывшей команды возвращаются: команда заморожена до перевода участников.
    ops.push(prisma.teamEdgeTask.updateMany({ where: { teamId: b.defenderId, status: "TAKEN" }, data: { status: "OPEN", takenById: null, takenAt: null } }));
  }
  await prisma.$transaction(ops);
  await onCityOwned(b.gameId, b.nodeKey, b.attackerId);
  publish(b.gameId, { type: "battles" });
  publish(b.gameId, { type: "map" });
  publish(b.gameId, { type: "cities" });
  publish(b.gameId, { type: "teams" });
  notifyTeam(b.gameId, b.attackerId, "город {book} взят", wasCapital ? "Это была столица противника: команда противника выбыла, город стал вашей второй столицей." : "Город теперь ваш.", { book: b.bookCode });
  notifyTeam(b.gameId, b.defenderId, "город {book} потерян", wasCapital ? "Потеряна столица: команда выбывает из игры. Администратор переведёт участников в другие команды." : "Ответ не дан в срок. Город перешёл претендентам; его можно вернуть по тем же правилам.", { book: b.bookCode });
  await startNextFromQueue(b.gameId, b.nodeKey);
  if (wasCapital) await checkLastTeam(b.gameId);
}

/**
 * Усталость города (S-07, решение владельца 18.09): если из города владельца 28 дней не одобрено ни одного дела на
 * выходящих сторонах, уровень защиты уменьшается на 1 стих каждые 14 дней. Город без свободных сторон не устаёт.
 */
export async function applyFatigue(gameId: string, rules: Rules, now = new Date()): Promise<void> {
  if (rules.fatigueStep <= 0) return;
  const owned = await prisma.teamCityState.findMany({ where: { gameId, capturedAt: { not: null } }, select: { teamId: true, nodeKey: true, capturedAt: true } });
  for (const c of owned) {
    const node = await prisma.mapNode.findUnique({ where: { gameId_key: { gameId, key: c.nodeKey } }, select: { id: true, defenseLevel: true, fatigueAt: true, bookCode: true } });
    if (!node || node.defenseLevel <= 0) continue;
    const [open, lastDeed] = await Promise.all([
      prisma.teamEdgeTask.count({ where: { teamId: c.teamId, fromKey: c.nodeKey, status: { in: ["OPEN", "TAKEN", "SUBMITTED", "REJECTED"] } } }),
      prisma.teamEdgeTask.findFirst({ where: { teamId: c.teamId, fromKey: c.nodeKey, status: "APPROVED" }, orderBy: { decidedAt: "desc" }, select: { decidedAt: true } }),
    ]);
    if (open === 0) continue; // нечего делать — нет и усталости
    const last = Math.max(c.capturedAt!.getTime(), lastDeed?.decidedAt?.getTime() ?? 0);
    const nextAt = node.fatigueAt ? node.fatigueAt.getTime() + days(rules.fatigueStepDays) : last + days(rules.fatigueAfterDays);
    if (now.getTime() < nextAt) continue;
    await prisma.mapNode.update({ where: { id: node.id }, data: { defenseLevel: Math.max(0, node.defenseLevel - rules.fatigueStep), fatigueAt: now } });
    publish(gameId, { type: "map", teamId: c.teamId });
    notifyTeam(gameId, c.teamId, "город {book} слабеет", "Из города давно не делали дел: уровень испытания снизился на {n}. Одно одобренное дело на стороне из города остановит убыль.", { book: node.bookCode ?? "", n: rules.fatigueStep });
  }
}

/** Сгоревшие вызовы, просроченные ответы, усталость, возврат зависших дел. Вызывается по таймеру и перед чтением. */
export async function sweep(gameId?: string): Promise<void> {
  const now = new Date();
  await checkTimeLimits(gameId);
  await expirePassages(gameId);
  const burnt = await prisma.battle.findMany({ where: { ...(gameId ? { gameId } : {}), status: "ATTACK", attackDeadline: { lt: now }, attackDoneAt: null } });
  for (const b of burnt) {
    const rules = await gameRules(b.gameId);
    await prisma.$transaction([
      prisma.battle.update({ where: { id: b.id }, data: { status: "EXPIRED", resolvedAt: now } }),
      prisma.teamCityState.upsert({
        where: { teamId_nodeKey: { teamId: b.attackerId, nodeKey: b.nodeKey } },
        create: { gameId: b.gameId, teamId: b.attackerId, nodeKey: b.nodeKey, attackPenalty: rules.burnPenalty },
        update: { attackPenalty: { increment: rules.burnPenalty } },
      }),
    ]);
    publish(b.gameId, { type: "battles", teamId: b.attackerId });
    publish(b.gameId, { type: "battles", teamId: b.defenderId });
    publish(b.gameId, { type: "map", teamId: b.attackerId });
    publish(b.gameId, { type: "map", teamId: b.defenderId });
    notifyTeam(b.gameId, b.attackerId, "вызов городу {book} не завершён", "За {days} дней вызов не был отправлен на проверку. Штраф: минимальная ставка на этот город для вашей команды выросла на {penalty}.", { book: b.bookCode, days: rules.attackDays, penalty: rules.burnPenalty });
    notifyTeam(b.gameId, b.defenderId, "вызов вашему городу {book} сгорел", "Претенденты не уложились в срок: вызов снят, город остаётся вашим.", { book: b.bookCode });
    await startNextFromQueue(b.gameId, b.nodeKey);
  }
  const lost = await prisma.battle.findMany({ where: { ...(gameId ? { gameId } : {}), status: "DEFENSE", defenseDeadline: { lt: now }, defenseDoneAt: null } });
  for (const b of lost) await resolveWon(b);
  await sweepSieges(gameId, now);
  // Усталость городов и возврат зависших дел — по идущим играм.
  const games = await prisma.game.findMany({ where: { ...(gameId ? { id: gameId } : {}), status: "ACTIVE" }, select: { id: true, settings: true } });
  for (const g of games) {
    const rules = rulesOf(g.settings);
    await applyFatigue(g.id, rules, now);
    await returnStaleTasks(g.id, rules, now);
  }
}

/** Может ли команда бросить вызов этому городу, и какая минимальная ставка. */
export async function warOptions(gameId: string, teamId: string, nodeKey: string) {
  const node = await nodeOf(gameId, nodeKey);
  const [book, content, owner, state, team, mine, rules] = await Promise.all([
    loadBook(node.bookCode ?? ""),
    loadCityContent(node.bookCode ?? ""),
    prisma.teamCityState.findFirst({ where: { gameId, nodeKey, capturedAt: { not: null } }, include: { team: { select: { id: true, name: true, color: true } } } }),
    prisma.teamCityState.findUnique({ where: { teamId_nodeKey: { teamId, nodeKey } } }),
    prisma.team.findUniqueOrThrow({ where: { id: teamId } }),
    prisma.battle.findFirst({ where: { gameId, nodeKey, attackerId: teamId, status: { in: ["QUEUED", "ATTACK", "DEFENSE"] } } }),
    gameRules(gameId),
  ]);
  const penalty = state?.attackPenalty ?? 0;
  const minBid = minBidFor(node.defenseLevel, penalty, rules);
  const studied = Boolean(content && state?.orderSolved && content.tasks.every((_, i) => state!.doneTasks.includes(i)));
  const locked = isLocked(node);
  let reason: string | null = null;
  if (node.ruined) reason = "Это руины: город берут, решив задания, без ключа и без испытания";
  else if (!owner) reason = "Город свободен: его берут ключом из конверта, а не испытанием";
  else if (owner.teamId === teamId) reason = "Это ваш город";
  else if (team.status === "defeated") reason = "Ваша команда выбыла из игры";
  else if (locked) reason = "Город закреплён: хранители выучили всю книгу каждым участником. После срока закрепления город берётся осадой делами";
  else if (node.maxReachedAt) reason = "Хранители выучили всю книгу каждым участником: город берётся не стихами, а осадой делами";
  else if (!studied) reason = "Сначала решите задания всех районов";
  else if (!book) reason = "Текст этой книги ещё не загружен: бросить вызов нельзя";
  else if (mine) reason = mine.status === "QUEUED" ? "Ваш вызов уже в очереди" : "Ваш вызов этому городу уже идёт";
  return { defenseLevel: node.defenseLevel, sumMode: node.sumMode, locked, lockedUntil: locked ? node.lockedUntil : null, maxed: node.maxReachedAt !== null, bookVerses: book?.total ?? null, penalty, minBid, attackDays: rules.attackDays, burnPenalty: rules.burnPenalty, canDeclare: reason === null, reason, owner: owner?.team ?? null };
}

void bookName;
