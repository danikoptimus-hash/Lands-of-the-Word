import type { FastifyReply } from "fastify";

/**
 * Живые события по игре (Server-Sent Events). Один процесс — подписчики в памяти.
 * Любая мутация в игре вызывает publish(gameId, { type }), клиенты перезагружают нужные данные.
 */
export type GameEventType = "game" | "map" | "teams" | "deeds" | "tasks" | "submissions" | "cities" | "battles" | "journal" | "peace" | "quarry" | "trades";
export interface GameEvent { type: GameEventType; teamId?: string; at: number }

/** Кто слушает: команда участника (null — администратор или наблюдатель, им нужно всё). */
interface Subscriber { reply: FastifyReply; teamId: string | null }
const subscribers = new Map<string, Set<Subscriber>>();
/** События только для своей команды: чужие взятия и сдачи дел на карте других команд не видны (нагрузочный прогон 23.10: веерная рассылка всем клала сервер). */
export const TEAM_ONLY: ReadonlySet<GameEventType> = new Set(["tasks", "submissions", "journal"]);
/** Слушатели публикаций внутри процесса (кэш карты команды сбрасывается по тем же событиям, что обновляют экраны). */
type Listener = (gameId: string, event: Omit<GameEvent, "at">) => void;
const listeners: Listener[] = [];
export function onPublish(fn: Listener): void { listeners.push(fn); }

export function subscribe(gameId: string, reply: FastifyReply, teamId: string | null = null): () => void {
  let set = subscribers.get(gameId);
  if (!set) { set = new Set(); subscribers.set(gameId, set); }
  const sub: Subscriber = { reply, teamId };
  set.add(sub);
  return () => { set!.delete(sub); if (set!.size === 0) subscribers.delete(gameId); };
}

export function publish(gameId: string, event: Omit<GameEvent, "at">): void {
  for (const fn of listeners) { try { fn(gameId, event); } catch { /* слушатель не должен ломать публикацию */ } }
  const set = subscribers.get(gameId);
  if (!set) return;
  const data = `event: change\ndata: ${JSON.stringify({ ...event, at: Date.now() })}\n\n`;
  const teamOnly = event.teamId && TEAM_ONLY.has(event.type) ? event.teamId : null;
  for (const sub of set) {
    if (teamOnly && sub.teamId && sub.teamId !== teamOnly) continue;
    try { sub.reply.raw.write(data); } catch { set.delete(sub); }
  }
}

export function subscriberCount(gameId: string): number { return subscribers.get(gameId)?.size ?? 0; }
/** Слушает ли карту кто-то из этой команды (администраторы и наблюдатели не считаются: им карта команды не рассылается). */
export function hasTeamSubscribers(gameId: string, teamId: string): boolean {
  const set = subscribers.get(gameId);
  if (!set) return false;
  for (const sub of set) if (sub.teamId === teamId) return true;
  return false;
}
/**
 * Именованное событие только подписчикам команды — так рассылаются изменения карты (решение владельца 24.10:
 * «пункт 2 тоже делай»): клиент правит карту у себя, не перечитывая её.
 */
export function pushToTeam(gameId: string, teamId: string, name: string, payload: unknown): void {
  const set = subscribers.get(gameId);
  if (!set) return;
  const data = `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const sub of set) {
    if (sub.teamId !== teamId) continue;
    try { sub.reply.raw.write(data); } catch { set.delete(sub); }
  }
}
