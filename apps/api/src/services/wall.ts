import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { publish } from "./events.js";
import { formatRange, loadBook, type BibleBook } from "./bible.js";
import { journal } from "./journal.js";
import { defenseNeed, gameRules, maybeRepel, sumVerses, type BattleWithEntries } from "./battles.js";

/**
 * Городская стена (решение владельца 01.11: «город, которым владеет команда, может быть укреплён стеной»).
 * Блок стены — участник выучил `rules.wallBlockVerses` стихов книги города подряд и сдал запись на проверку (видео).
 * Блоки выровнены по книге (1–10, 11–20, …; последний короче), чтобы кладка на экране совпадала с книгой и участник
 * не сдавал один стих дважды: блок, пересекающий его стихи из испытаний, закрыт.
 * Блоки копятся без предела, но только в мирное время: пока по городу идёт ответ хранителей, сдавать нельзя.
 * Стена ложится в ответ не при «Испытать», а за минуту до конца времени ответа (решение владельца 02.11: «стена должна
 * срабатывать только за минуту до конца таймера, а не в начале»): до этого хранители отвечают сами. В ответ ложатся
 * зачтёнными записями только нужные блоки — старые первыми, пока не перекрыта ставка; легший в ответ блок сгорает
 * (решение владельца 02.11: «стена должна постепенно таять ровно на количество использованных блоков»), его стихи у
 * участника остаются сданными. Блок, принятый во время ответа, ждёт той же минуты (если она уже наступила — ложится сразу).
 * Толщину знают только хранители и администратор; чужим стену показывает разведка (02.11).
 */

export const WALL_NOTE = "Блок городской стены";
/** Блок из груза разбитого корабля (решение владельца 04.11): стихов за ним нет, в ответ ложится условным диапазоном ниже нуля (см. `cargoRange`). */
export const CARGO_NOTE = "Блок стены из груза корабля";
/** Условный диапазон k-го блока из груза в городе: −(k+1)·n … −k·n−1 — не пересекается ни с настоящими стихами (≥ 0), ни с другими блоками груза. */
export function cargoRange(k: number, n: number): { start: number; end: number } {
  return { start: -(k + 1) * n, end: -k * n - 1 };
}

/** Границы блока по номеру k: от k·n до k·n+n−1, последний блок — до конца книги. */
export function brickRange(k: number, n: number, total: number): { start: number; end: number } {
  return { start: k * n, end: Math.min(total - 1, k * n + n - 1) };
}

/** Участники команды сейчас: блоки ушедших не считаются (как и их стихи из прошлых испытаний). */
async function memberIds(teamId: string): Promise<Set<string>> {
  return new Set((await prisma.membership.findMany({ where: { teamId }, select: { userId: true } })).map((m) => m.userId));
}

/** Толщина стены команды в городе: стихи принятых и не сгоревших блоков нынешних участников и число блоков; блок воина — два (02.11). */
export async function wallOf(teamId: string, nodeKey: string): Promise<{ verses: number; blocks: number; pending: number }> {
  const [rows, members] = await Promise.all([
    prisma.wallBlock.findMany({ where: { teamId, nodeKey, status: { in: ["APPROVED", "SUBMITTED"] }, usedAt: null }, select: { userId: true, startIdx: true, endIdx: true, weight: true, status: true, missing: true, repairOfId: true, cargo: true } }),
    memberIds(teamId),
  ]);
  let verses = 0, blocks = 0, pending = 0;
  for (const r of rows) {
    // Блок из груза корабля (04.11) — командный: не зависит от того, кто его положил.
    if (!r.cargo && !members.has(r.userId)) continue;
    if (r.status === "SUBMITTED") { pending += r.weight; continue; }
    if (r.repairOfId) continue; // принятая починка уже вернула стихи исходному блоку
    blocks += r.weight;
    verses += (r.endIdx - r.startIdx + 1 - r.missing) * r.weight;
  }
  return { verses, blocks, pending };
}

/** Есть ли стена у хранителей каждого из городов (для карты: без толщины). */
export async function wallsAt(gameId: string, owners: Array<{ nodeKey: string; teamId: string }>): Promise<Set<string>> {
  if (owners.length === 0) return new Set();
  const rows = await prisma.wallBlock.findMany({ where: { gameId, status: "APPROVED", usedAt: null, repairOfId: null, nodeKey: { in: owners.map((o) => o.nodeKey) } }, select: { nodeKey: true, teamId: true, userId: true, cargo: true } });
  if (rows.length === 0) return new Set();
  const members = await prisma.membership.findMany({ where: { teamId: { in: [...new Set(rows.map((r) => r.teamId))] } }, select: { teamId: true, userId: true } });
  const inTeam = new Set(members.map((m) => `${m.teamId}|${m.userId}`));
  const ownerOf = new Map(owners.map((o) => [o.nodeKey, o.teamId]));
  const out = new Set<string>();
  for (const r of rows) if (ownerOf.get(r.nodeKey) === r.teamId && (r.cargo || inTeam.has(`${r.teamId}|${r.userId}`))) out.add(r.nodeKey);
  return out;
}

/** Стихи книги, которые участник уже сдал блоками стены (кроме возвращённых): в испытании второй раз не засчитываются. */
export async function wallVersesOf(gameId: string, bookCode: string, userId: string): Promise<Set<number>> {
  const rows = await prisma.wallBlock.findMany({ where: { gameId, bookCode, userId, status: { not: "REJECTED" }, cargo: false }, select: { startIdx: true, endIdx: true } });
  const out = new Set<number>();
  for (const r of rows) for (let i = r.startIdx; i <= r.endIdx; i++) out.add(i);
  return out;
}

/**
 * Стена ложится в ответ: принятые блоки нынешних хранителей — зачтённые записи ответа (carried), старые первыми и только
 * пока ставка не перекрыта. Из блока берутся только недостающие стихи, с его конца (решение владельца 02.11: «игра пусть
 * возьмёт из блока только недостающие стихи»): использованный целиком блок сгорает (usedAt), тронутый частично —
 * надломлен (missing) и стоит дальше без этих стихов, пока хозяин не починит его досдачей. Возвращает, сколько стихов
 * добавлено, сколько блоков сгорело и сколько надломлено.
 */
export async function applyWall(b: BattleWithEntries): Promise<{ battle: BattleWithEntries; added: number; burnt: number; cracked: number }> {
  const none = { battle: b, added: 0, burnt: 0, cracked: 0 };
  if (b.status !== "DEFENSE") return none;
  const need = defenseNeed(b);
  let entries = b.entries;
  if (sumVerses(entries, "DEFENSE", true) >= need) return none;
  const [blocks, members] = await Promise.all([
    prisma.wallBlock.findMany({ where: { teamId: b.defenderId, nodeKey: b.nodeKey, status: "APPROVED", usedAt: null, repairOfId: null }, orderBy: { createdAt: "asc" } }),
    memberIds(b.defenderId),
  ]);
  const now = new Date();
  const rows: Prisma.BattleEntryCreateManyInput[] = [];
  const updates: Prisma.PrismaPromise<unknown>[] = [];
  let burnt = 0, cracked = 0, added = 0;
  for (const w of blocks) {
    if (!w.cargo && !members.has(w.userId)) continue;
    const have = sumVerses(entries, "DEFENSE", true);
    if (have >= need) break;
    const intactEnd = w.endIdx - w.missing, avail = intactEnd - w.startIdx + 1;
    if (avail <= 0) continue;
    const take = Math.min(avail, Math.ceil((need - have) / Math.max(1, w.weight)));
    const s = intactEnd - take + 1, e = intactEnd;
    rows.push({ battleId: b.id, side: "DEFENSE", teamId: b.defenderId, userId: w.userId, startIdx: s, endIdx: e, links: w.links.slice(0, 20), weight: w.weight, note: w.cargo ? CARGO_NOTE : WALL_NOTE, status: "APPROVED", carried: true, decidedAt: now });
    // Сумма считается по людям и стихам: кладём, пока ставка не перекрыта.
    entries = [...entries, { id: w.id, battleId: b.id, side: "DEFENSE", teamId: b.defenderId, userId: w.userId, startIdx: s, endIdx: e, links: w.links, note: w.cargo ? CARGO_NOTE : WALL_NOTE, status: "APPROVED", adminComment: "", weight: w.weight, carried: true, createdAt: now, decidedAt: now }];
    added += take * w.weight;
    if (take === avail) { updates.push(prisma.wallBlock.update({ where: { id: w.id }, data: { usedBattleId: b.id, usedAt: now, missing: w.endIdx - w.startIdx + 1 } })); burnt += w.weight; }
    else { updates.push(prisma.wallBlock.update({ where: { id: w.id }, data: { usedBattleId: b.id, missing: w.missing + take } })); cracked += 1; }
  }
  if (rows.length === 0) return none;
  await prisma.$transaction([prisma.battleEntry.createMany({ data: rows }), ...updates]);
  const battle = await prisma.battle.findUniqueOrThrow({ where: { id: b.id }, include: { entries: true } });
  return { battle, added, burnt, cracked };
}

/** Хвост записи летописи о легшей стене: сколько блоков сгорело и сколько надломлено. */
export const wallBurntText = (burnt: number, cracked: number): string => (burnt > 0 ? ", сгорело блоков: {k}" : "") + (cracked > 0 ? ", надломлен блок: {c}" : "");

/**
 * Последняя минута времени ответа: стена ложится в ответ (обход раз в минуту, services/battles.ts → sweep). Отметка
 * `wallAppliedAt` ставится первой, чтобы два обхода не положили стену дважды; если зачтённого теперь хватает — ответ дан.
 */
export async function layWallBeforeDeadline(b: BattleWithEntries): Promise<void> {
  if (b.status !== "DEFENSE" || b.defenseDoneAt || b.wallAppliedAt) return;
  const marked = await prisma.battle.updateMany({ where: { id: b.id, wallAppliedAt: null }, data: { wallAppliedAt: new Date() } });
  if (marked.count === 0) return;
  const { battle, added, burnt, cracked } = await applyWall({ ...b, wallAppliedAt: new Date() });
  if (added === 0) return;
  journal(b.gameId, "wall_applied", { teamId: b.defenderId, vars: { book: b.bookCode, n: added, burnt: wallBurntText(burnt, cracked), k: burnt, c: cracked } });
  const carried = sumVerses(battle.entries, "DEFENSE", true);
  if (carried >= defenseNeed(battle)) {
    const done = await prisma.battle.update({ where: { id: b.id }, data: { defenseDoneAt: new Date(), defenseBid: carried }, include: { entries: true } });
    await maybeRepel(done);
  }
  publish(b.gameId, { type: "battles", teamId: b.defenderId });
  publish(b.gameId, { type: "battles", teamId: b.attackerId });
}

/**
 * Блок принят, когда по городу уже идёт ответ: если минута стены уже наступила — кладём его в ответ сразу, иначе он
 * дождётся её вместе с остальными; если зачтённого теперь хватает — ответ дан без единого нового стиха.
 */
export async function layApprovedBlockIntoDefense(gameId: string, teamId: string, nodeKey: string): Promise<void> {
  const b = await prisma.battle.findFirst({ where: { gameId, nodeKey, defenderId: teamId, status: "DEFENSE", defenseDoneAt: null }, include: { entries: true } });
  if (!b || !b.wallAppliedAt) return;
  const { battle, added, burnt, cracked } = await applyWall(b);
  if (added === 0) return;
  journal(gameId, "wall_applied", { teamId, vars: { book: b.bookCode, n: added, burnt: wallBurntText(burnt, cracked), k: burnt, c: cracked } });
  const carried = sumVerses(battle.entries, "DEFENSE", true);
  if (carried >= defenseNeed(battle)) {
    const done = await prisma.battle.update({ where: { id: b.id }, data: { defenseDoneAt: new Date(), defenseBid: carried }, include: { entries: true } });
    await maybeRepel(done);
  }
  publish(gameId, { type: "battles", teamId });
  publish(gameId, { type: "battles", teamId: b.attackerId });
}

/** Подпись блока «1:1–1:10» по книге. */
export function brickRef(book: BibleBook, start: number, end: number): string {
  return formatRange(book, start, end);
}

/** Книга и размер блока для города. */
export async function wallBook(gameId: string, bookCode: string): Promise<{ book: BibleBook | null; n: number }> {
  const [book, rules] = await Promise.all([loadBook(bookCode), gameRules(gameId)]);
  return { book, n: rules.wallBlockVerses };
}
