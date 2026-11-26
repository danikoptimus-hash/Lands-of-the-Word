import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

/**
 * Запись настроек партии (JSON `settings`) только своими ключами — одной операцией базы, поверх того, что лежит в базе
 * сейчас (разбор празднования победы, 26.11). Раньше каждая запись брала копию настроек, прочитанную в начале запроса,
 * и клала её целиком: запись, начатая до победы, возвращала прежний срок партии — конец празднования (settings.endsAt).
 * Значение undefined ключ не трогает, null записывается как null. Годится и в общую транзакцию ($transaction([...])).
 */
export function setSettings(gameId: string, keys: Record<string, unknown>): Prisma.PrismaPromise<number> {
  return prisma.$executeRaw`UPDATE "Game" SET "settings" = COALESCE("settings", '{}'::jsonb) || ${JSON.stringify(keys)}::jsonb WHERE "id" = ${gameId}`;
}

/** Убрать ключи настроек партии, не трогая остальные. */
export function dropSettings(gameId: string, keys: string[]): Prisma.PrismaPromise<number> {
  return prisma.$executeRaw`UPDATE "Game" SET "settings" = COALESCE("settings", '{}'::jsonb) - ${keys}::text[] WHERE "id" = ${gameId}`;
}
