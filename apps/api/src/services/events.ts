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
const TEAM_ONLY: ReadonlySet<GameEventType> = new Set(["tasks", "submissions", "journal"]);

export function subscribe(gameId: string, reply: FastifyReply, teamId: string | null = null): () => void {
  let set = subscribers.get(gameId);
  if (!set) { set = new Set(); subscribers.set(gameId, set); }
  const sub: Subscriber = { reply, teamId };
  set.add(sub);
  return () => { set!.delete(sub); if (set!.size === 0) subscribers.delete(gameId); };
}

export function publish(gameId: string, event: Omit<GameEvent, "at">): void {
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
