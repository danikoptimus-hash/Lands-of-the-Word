import type { FastifyReply, FastifyRequest } from "fastify";
import { cityTasksOpen, dayLight, stormState, type DayPhase, type StormSlot } from "@lotw/domain";
import { prisma } from "../db.js";
import { rulesOf } from "./rules.js";
import { err } from "./i18n.js";

/**
 * Время суток игры (решение владельца 03.10): утро 7–9, день 9–18, вечер 18–22, ночь 22–7 по поясу игры (`rules.timeZone`).
 * Ночью команда может только смотреть карту: города спят (задания, шифр и конверт скрыты), дела не берутся и не сдаются,
 * испытания и осады не объявляются, стихи не отмечаются и не отправляются, разведка, подсказка пророка и запрос прохода ждут утра.
 * Вызов (атака) отправляется на проверку только утром; ответ хранителей — утром, днём и вечером.
 */
export interface Daytime {
  phase: DayPhase; timeZone: string; now: number;
  /** Задания города открыты (с 7:00 до 0:00; решение владельца 04.10). */
  tasksOpen: boolean;
  /** Шторм (решение владельца 24.10): идёт ли сейчас и когда ближайшая смена (мс эпохи); расписание — клиенту, чтобы он переключался сам, без запроса. */
  storm: { active: boolean; changesAt: number | null };
  storms: StormSlot[];
}

export async function gameDaytime(gameId: string, now = new Date()): Promise<Daytime> {
  const g = await prisma.game.findUnique({ where: { id: gameId }, select: { settings: true } });
  const { timeZone, storms } = rulesOf(g?.settings);
  const st = stormState(storms, timeZone, now);
  return { phase: dayLight(timeZone, now).phase, timeZone, now: now.getTime(), tasksOpen: cityTasksOpen(timeZone, now), storm: { active: st.active, changesAt: st.nextChangeMs === null ? null : now.getTime() + st.nextChangeMs }, storms };
}

export const STORM_MESSAGE = "Шторм: пока идёт буря, можно только смотреть карту.";

/** В шторм (решение владельца 24.10) участники ничего не делают: 409 `storm`. */
async function refuseStorm(request: FastifyRequest, reply: FastifyReply, dt: Daytime): Promise<boolean> {
  if (!dt.storm.active) return false;
  await reply.code(409).send({ error: "storm", message: err(request, STORM_MESSAGE), daytime: dt });
  return true;
}

export const NIGHT_MESSAGE = "Ночь: города спят, дела и испытания ждут утра. До 7:00 по местному времени можно только смотреть карту.";

/** Ночью действие не выполняется: 409 `night`. Возвращает время суток, если действовать можно, иначе null (ответ уже отправлен). */
export async function assertAwake(request: FastifyRequest, reply: FastifyReply, gameId: string): Promise<Daytime | null> {
  const dt = await gameDaytime(gameId);
  if (await refuseStorm(request, reply, dt)) return null;
  if (dt.phase !== "night") return dt;
  await reply.code(409).send({ error: "night", message: err(request, NIGHT_MESSAGE), daytime: dt });
  return null;
}

export const TASKS_CLOSED_MESSAGE = "С 0:00 до 7:00 по местному времени игра спит: задания города и взятие дел откроются утром.";

/** Задания города (порядок, ответы, подсказка) и взятие дела открыты до полуночи (решение владельца 04.10); с 0:00 до 7:00 — 409 `night`. */
export async function assertTasksOpen(request: FastifyRequest, reply: FastifyReply, gameId: string): Promise<Daytime | null> {
  const dt = await gameDaytime(gameId);
  if (await refuseStorm(request, reply, dt)) return null;
  if (dt.tasksOpen) return dt;
  await reply.code(409).send({ error: "night", message: err(request, TASKS_CLOSED_MESSAGE), daytime: dt });
  return null;
}
