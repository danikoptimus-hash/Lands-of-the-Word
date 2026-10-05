import type { FastifyReply, FastifyRequest } from "fastify";
import { cityTasksOpen, dayLight, resolveSeason, type DayPhase, type Season } from "@lotw/domain";
import { prisma } from "../db.js";
import { rulesOf } from "./rules.js";
import { err } from "./i18n.js";

/**
 * Время суток игры (решение владельца 03.10): утро 7–9, день 9–18, вечер 18–22, ночь 22–7 по поясу игры (`rules.timeZone`).
 * Ночью команда может только смотреть карту: города спят (задания, шифр и конверт скрыты), дела не берутся и не сдаются,
 * испытания и осады не объявляются, стихи не отмечаются и не отправляются, разведка, подсказка пророка и запрос прохода ждут утра.
 * Вызов (атака) отправляется на проверку только утром; ответ хранителей — утром, днём и вечером.
 */
export interface Daytime { phase: DayPhase; timeZone: string; now: number; /** Время года на карте (решение владельца 05.10): по календарю в поясе игры или закреплённое правилом. */ season: Season; /** Задания города открыты (с 7:00 до 0:00; решение владельца 04.10). */ tasksOpen: boolean }

export async function gameDaytime(gameId: string, now = new Date()): Promise<Daytime> {
  const g = await prisma.game.findUnique({ where: { id: gameId }, select: { settings: true } });
  const { timeZone, season } = rulesOf(g?.settings);
  return { phase: dayLight(timeZone, now).phase, timeZone, now: now.getTime(), season: resolveSeason(season, timeZone, now), tasksOpen: cityTasksOpen(timeZone, now) };
}

export const NIGHT_MESSAGE = "Ночь: города спят, дела и испытания ждут утра. До 7:00 по местному времени можно только смотреть карту.";

/** Ночью действие не выполняется: 409 `night`. Возвращает время суток, если действовать можно, иначе null (ответ уже отправлен). */
export async function assertAwake(request: FastifyRequest, reply: FastifyReply, gameId: string): Promise<Daytime | null> {
  const dt = await gameDaytime(gameId);
  if (dt.phase !== "night") return dt;
  await reply.code(409).send({ error: "night", message: err(request, NIGHT_MESSAGE), daytime: dt });
  return null;
}

export const TASKS_CLOSED_MESSAGE = "С 0:00 до 7:00 по местному времени игра спит: задания города и взятие дел откроются утром.";

/** Задания города (порядок, ответы, подсказка) и взятие дела открыты до полуночи (решение владельца 04.10); с 0:00 до 7:00 — 409 `night`. */
export async function assertTasksOpen(request: FastifyRequest, reply: FastifyReply, gameId: string): Promise<Daytime | null> {
  const dt = await gameDaytime(gameId);
  if (dt.tasksOpen) return dt;
  await reply.code(409).send({ error: "night", message: err(request, TASKS_CLOSED_MESSAGE), daytime: dt });
  return null;
}
