import type { FastifyReply } from "fastify";

/**
 * Живые события по игре (Server-Sent Events). Один процесс — подписчики в памяти.
 * Любая мутация в игре вызывает publish(gameId, { type }), клиенты перезагружают нужные данные.
 */
export type GameEventType = "game" | "map" | "teams" | "deeds" | "tasks" | "submissions";
export interface GameEvent { type: GameEventType; teamId?: string; at: number }

const subscribers = new Map<string, Set<FastifyReply>>();

export function subscribe(gameId: string, reply: FastifyReply): () => void {
  let set = subscribers.get(gameId);
  if (!set) { set = new Set(); subscribers.set(gameId, set); }
  set.add(reply);
  return () => { set!.delete(reply); if (set!.size === 0) subscribers.delete(gameId); };
}

export function publish(gameId: string, event: Omit<GameEvent, "at">): void {
  const set = subscribers.get(gameId);
  if (!set) return;
  const data = `event: change\ndata: ${JSON.stringify({ ...event, at: Date.now() })}\n\n`;
  for (const reply of set) {
    try { reply.raw.write(data); } catch { set.delete(reply); }
  }
}

export function subscriberCount(gameId: string): number { return subscribers.get(gameId)?.size ?? 0; }
