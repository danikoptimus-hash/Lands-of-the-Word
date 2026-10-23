import { useCallback, useEffect, useRef } from "react";

export type GameEventType = "game" | "map" | "teams" | "deeds" | "tasks" | "submissions" | "cities" | "battles" | "journal" | "peace" | "quarry" | "trades";
export interface GameEvent { type: GameEventType; teamId?: string; at: number }

/**
 * Живые события игры (Server-Sent Events). Браузер сам переподключается при обрыве.
 * handler вызывается на каждое событие; после переподключения — один раз с type "game", чтобы всё перечитать.
 */
export function useGameEvents(gameId: string | null, handler: (e: GameEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!gameId) return;
    const es = new EventSource(`/api/games/${gameId}/events`);
    let wasDown = false;
    es.addEventListener("change", (ev) => { try { ref.current(JSON.parse((ev as MessageEvent).data)); } catch { /* пропускаем битое */ } });
    es.addEventListener("hello", () => { if (wasDown) { wasDown = false; ref.current({ type: "game", at: Date.now() }); } });
    es.onerror = () => { wasDown = true; };
    return () => es.close();
  }, [gameId]);
}

/**
 * Склейка перечитываний (решение владельца 23.10 после нагрузочного прогона): несколько событий за окно дают одно
 * перечитывание, не позже чем через ms после первого. Задержка ограничена, отмены нет — данные свежие, запросов меньше.
 */
export function useCoalesced(fn: () => unknown, ms = 2500): () => void {
  const ref = useRef(fn);
  ref.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => { timer.current = null; void ref.current(); }, ms);
  }, [ms]);
}
