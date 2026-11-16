import { prisma } from "../db.js";
import { measuring } from "./measure.js";

/**
 * Счётчик выходов (решение владельца 02.10): игра запоминает открытие задания города, выход из приложения с открытым
 * заданием (и на сколько), верный и неверный ответ. Никаких выгрузок через игру (решение владельца 02.10): данные лежат
 * в таблице TaskEvent и читаются только из базы.
 */
export type TaskEventKind = "open" | "away" | "ok" | "wrong";

export async function taskEvent(gameId: string, teamId: string, userId: string, nodeKey: string, taskIndex: number | null, kind: TaskEventKind, awayMs: number | null = null): Promise<void> {
  // «Открыл» и «выходил» — только замеры; пока сбор выключен (решение владельца 16.11), они не пишутся. Ответы пишутся всегда.
  if ((kind === "open" || kind === "away") && !measuring()) return;
  try { await prisma.taskEvent.create({ data: { gameId, teamId, userId, nodeKey, taskIndex, kind, awayMs } }); } catch { /* сбор событий не должен ломать ответ */ }
}
