import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { BOOKS } from "@lotw/domain";
import { prisma } from "../db.js";
import { publish } from "./events.js";

/**
 * Стандартный набор дел (content/deeds-default.json) и его синхронизация с играми.
 * Решение владельца 16.09: новые и изменённые дела набора попадают в уже идущие игры сами. Правило:
 *  - у дела из набора хранится sourceHash — хеш той версии набора, из которой оно взято; пока администратор
 *    дело не правил, хеш его содержимого совпадает с sourceHash, и сервер обновляет такое дело на новую версию;
 *  - правленное администратором дело (хеш не совпадает) не трогается;
 *  - новые дела набора добавляются в игры, где набор использован (есть хотя бы одно дело набора);
 *  - дело, исчезнувшее из набора, убирается, если оно из набора, не правлено и ещё не выдано командам;
 *  - переименование (поле replaces — прежние названия) обновляет дело на месте вместе с выданными сторонами.
 * Синхронизация запускается при старте сервера (после деплоя) и при импорте набора администратором.
 */
export const DIRECTIONS = [
  "Молитва", "Молодёжные нужды братства", "Благовестие", "Посещение",
  "Помощь миссионерам и большим семьям", "Труд в лагерях и домах молитвы", "Педагогическое служение", "Финансовое участие",
] as const;
const BOOK_CODES = new Set(BOOKS.map((b) => b.code));
export const deedBody = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).default(""),
  direction: z.enum(DIRECTIONS),
  proofType: z.enum(["REPORT", "PHOTO_LINK", "VIDEO_LINK", "CONFIRMATION"]).default("PHOTO_LINK"),
  canRepeat: z.boolean().default(false),
  bookCodes: z.array(z.string().trim().min(3).max(3)).max(66).default([]).transform((a) => [...new Set(a)].filter((c) => BOOK_CODES.has(c))),
  difficulty: z.number().int().min(1).max(3).default(1),
  frequency: z.number().int().min(1).max(3).default(2),
  secret: z.boolean().default(false),
});
export type DeedFields = z.infer<typeof deedBody>;
const setItem = deedBody.extend({ replaces: z.array(z.string().trim().min(2)).default([]) });
export type DefaultDeed = z.infer<typeof setItem>;

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../content/deeds-default.json");
export async function loadDefaultDeeds(): Promise<DefaultDeed[]> {
  return z.array(setItem).parse(JSON.parse(await readFile(FILE, "utf8")));
}

/** Хеш содержимого дела (только поля набора, книги — отсортированы). */
export interface DeedLike { title: string; description: string; direction: string; proofType: string; canRepeat: boolean; bookCodes: string[]; difficulty: number; frequency: number; secret: boolean }
export function deedHash(d: DeedLike): string {
  const canon = JSON.stringify([d.title, d.description, d.direction, d.proofType, d.canRepeat, [...d.bookCodes].sort(), d.difficulty, d.frequency, d.secret]);
  return createHash("sha1").update(canon).digest("base64url");
}
const fields = (d: DefaultDeed): DeedFields => ({ title: d.title, description: d.description, direction: d.direction, proofType: d.proofType, canRepeat: d.canRepeat, bookCodes: d.bookCodes, difficulty: d.difficulty, frequency: d.frequency, secret: d.secret });
const lc = (s: string) => s.trim().toLowerCase();

export interface SyncResult { added: number; updated: number; removed: number }

/**
 * mode=auto — при старте сервера: только игры, где набор использован; правленные дела не трогаются.
 * mode=add — кнопка «Добавить недостающие»: то же плюс добавление в любую игру.
 * mode=replace — кнопка «Заменить»: невыданные дела удаляются, совпадающие по названию перезаписываются набором.
 */
export async function syncGameDeeds(gameId: string, mode: "auto" | "add" | "replace"): Promise<SyncResult> {
  const items = await loadDefaultDeeds();
  const res: SyncResult = { added: 0, updated: 0, removed: 0 };
  let deeds = await prisma.deed.findMany({ where: { gameId }, include: { _count: { select: { edgeTasks: true } } } });
  const inSet = (title: string) => items.some((it) => lc(it.title) === lc(title) || it.replaces.some((r) => lc(r) === lc(title)));
  const usesSet = deeds.some((d) => d.sourceHash !== null || inSet(d.title));
  if (mode === "auto" && !usesSet) return res;
  if (mode === "replace") {
    res.removed = (await prisma.deed.deleteMany({ where: { gameId, edgeTasks: { none: {} } } })).count;
    deeds = await prisma.deed.findMany({ where: { gameId }, include: { _count: { select: { edgeTasks: true } } } });
  }
  const seen = new Set<string>();
  for (const it of items) {
    const want = fields(it), hash = deedHash(want);
    const match = deeds.find((d) => lc(d.title) === lc(it.title)) ?? deeds.find((d) => it.replaces.some((r) => lc(r) === lc(d.title)));
    if (match) {
      seen.add(match.id);
      if (match.sourceHash === hash) continue; // уже эта версия
      // Без хеша — дело набора из старых игр (до появления хеша): считаем нередактированным один раз.
      const untouched = match.sourceHash === null || match.sourceHash === deedHash(match);
      if (mode === "replace" || untouched) { await prisma.deed.update({ where: { id: match.id }, data: { ...want, sourceHash: hash } }); res.updated++; }
    } else {
      await prisma.deed.create({ data: { ...want, gameId, sourceHash: hash } }); res.added++;
    }
  }
  if (mode === "auto") { // исчезнувшие из набора: убрать, если из набора, не правлены и не выданы
    for (const d of deeds) {
      if (seen.has(d.id) || d.sourceHash === null || d._count.edgeTasks > 0 || d.sourceHash !== deedHash(d)) continue;
      await prisma.deed.delete({ where: { id: d.id } }); res.removed++;
    }
  }
  if (res.added || res.updated || res.removed) publish(gameId, { type: "deeds" });
  return res;
}

/** При старте сервера: все незавершённые игры. */
export async function syncAllGames(log: { info: (o: object, msg: string) => void; error: (o: object, msg: string) => void }): Promise<void> {
  const games = await prisma.game.findMany({ where: { status: { not: "FINISHED" } }, select: { id: true } });
  const total: SyncResult = { added: 0, updated: 0, removed: 0 };
  for (const g of games) {
    try { const r = await syncGameDeeds(g.id, "auto"); total.added += r.added; total.updated += r.updated; total.removed += r.removed; }
    catch (e) { log.error({ err: e, gameId: g.id }, "default deeds sync failed"); }
  }
  log.info({ games: games.length, ...total }, "default deeds synced");
}
