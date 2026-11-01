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
 * При «Испытать» принятые блоки нынешних участников команды ложатся в ответ зачтёнными записями — как стихи, выученные
 * в прошлых испытаниях; блок, принятый уже во время ответа, ложится в него сразу. Толщину стены знают только хранители
 * и администратор; остальные команды видят на карте лишь то, что стена есть.
 */

export const WALL_NOTE = "Блок городской стены";

/** Границы блока по номеру k: от k·n до k·n+n−1, последний блок — до конца книги. */
export function brickRange(k: number, n: number, total: number): { start: number; end: number } {
  return { start: k * n, end: Math.min(total - 1, k * n + n - 1) };
}

/** Участники команды сейчас: блоки ушедших не считаются (как и их стихи из прошлых испытаний). */
async function memberIds(teamId: string): Promise<Set<string>> {
  return new Set((await prisma.membership.findMany({ where: { teamId }, select: { userId: true } })).map((m) => m.userId));
}

/** Толщина стены команды в городе: стихи принятых блоков нынешних участников (воин — вдвое) и число блоков. */
export async function wallOf(teamId: string, nodeKey: string): Promise<{ verses: number; blocks: number; pending: number }> {
  const [rows, members] = await Promise.all([
    prisma.wallBlock.findMany({ where: { teamId, nodeKey, status: { in: ["APPROVED", "SUBMITTED"] } }, select: { userId: true, startIdx: true, endIdx: true, weight: true, status: true } }),
    memberIds(teamId),
  ]);
  let verses = 0, blocks = 0, pending = 0;
  for (const r of rows) {
    if (!members.has(r.userId)) continue;
    if (r.status === "SUBMITTED") { pending++; continue; }
    blocks++;
    verses += (r.endIdx - r.startIdx + 1) * r.weight;
  }
  return { verses, blocks, pending };
}

/** Есть ли стена у хранителей каждого из городов (для карты: без толщины). */
export async function wallsAt(gameId: string, owners: Array<{ nodeKey: string; teamId: string }>): Promise<Set<string>> {
  if (owners.length === 0) return new Set();
  const rows = await prisma.wallBlock.findMany({ where: { gameId, status: "APPROVED", nodeKey: { in: owners.map((o) => o.nodeKey) } }, select: { nodeKey: true, teamId: true, userId: true } });
  if (rows.length === 0) return new Set();
  const members = await prisma.membership.findMany({ where: { teamId: { in: [...new Set(rows.map((r) => r.teamId))] } }, select: { teamId: true, userId: true } });
  const inTeam = new Set(members.map((m) => `${m.teamId}|${m.userId}`));
  const ownerOf = new Map(owners.map((o) => [o.nodeKey, o.teamId]));
  const out = new Set<string>();
  for (const r of rows) if (ownerOf.get(r.nodeKey) === r.teamId && inTeam.has(`${r.teamId}|${r.userId}`)) out.add(r.nodeKey);
  return out;
}

/** Стихи книги, которые участник уже сдал блоками стены (кроме возвращённых): в испытании второй раз не засчитываются. */
export async function wallVersesOf(gameId: string, bookCode: string, userId: string): Promise<Set<number>> {
  const rows = await prisma.wallBlock.findMany({ where: { gameId, bookCode, userId, status: { not: "REJECTED" } }, select: { startIdx: true, endIdx: true } });
  const out = new Set<number>();
  for (const r of rows) for (let i = r.startIdx; i <= r.endIdx; i++) out.add(i);
  return out;
}

/**
 * Стена ложится в ответ: принятые блоки нынешних хранителей — зачтённые записи ответа (carried, как стихи прошлых
 * испытаний). Блок, уже лежащий в этом испытании, второй раз не кладётся. Возвращает, сколько стихов добавлено.
 */
export async function applyWall(b: BattleWithEntries): Promise<{ battle: BattleWithEntries; added: number }> {
  if (b.status !== "DEFENSE") return { battle: b, added: 0 };
  const [blocks, members] = await Promise.all([
    prisma.wallBlock.findMany({ where: { teamId: b.defenderId, nodeKey: b.nodeKey, status: "APPROVED" }, orderBy: { createdAt: "asc" } }),
    memberIds(b.defenderId),
  ]);
  const laid = new Set(b.entries.filter((e) => e.side === "DEFENSE" && e.note === WALL_NOTE).map((e) => `${e.userId}|${e.startIdx}|${e.endIdx}`));
  const rows: Prisma.BattleEntryCreateManyInput[] = [];
  for (const w of blocks) {
    if (!members.has(w.userId) || laid.has(`${w.userId}|${w.startIdx}|${w.endIdx}`)) continue;
    rows.push({ battleId: b.id, side: "DEFENSE", teamId: b.defenderId, userId: w.userId, startIdx: w.startIdx, endIdx: w.endIdx, links: w.links.slice(0, 20), weight: w.weight, note: WALL_NOTE, status: "APPROVED", carried: true, decidedAt: new Date() });
  }
  if (rows.length === 0) return { battle: b, added: 0 };
  await prisma.battleEntry.createMany({ data: rows });
  const battle = await prisma.battle.findUniqueOrThrow({ where: { id: b.id }, include: { entries: true } });
  return { battle, added: rows.reduce((a, r) => a + ((r.endIdx as number) - (r.startIdx as number) + 1) * ((r.weight as number) ?? 1), 0) };
}

/**
 * Блок принят, когда по городу уже идёт ответ: кладём его в ответ сразу; если зачтённого теперь хватает — ответ дан
 * без единого нового стиха (как при «Испытать»).
 */
export async function layApprovedBlockIntoDefense(gameId: string, teamId: string, nodeKey: string): Promise<void> {
  const b = await prisma.battle.findFirst({ where: { gameId, nodeKey, defenderId: teamId, status: "DEFENSE", defenseDoneAt: null }, include: { entries: true } });
  if (!b) return;
  const { battle, added } = await applyWall(b);
  if (added === 0) return;
  journal(gameId, "wall_applied", { teamId, vars: { book: b.bookCode, n: added } });
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
