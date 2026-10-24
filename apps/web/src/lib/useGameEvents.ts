import { useCallback, useEffect, useRef } from "react";

export type GameEventType = "game" | "map" | "teams" | "deeds" | "tasks" | "submissions" | "cities" | "battles" | "journal" | "peace" | "quarry" | "trades";
export interface GameEvent { type: GameEventType; teamId?: string; at: number }

/**
 * Живые события игры (Server-Sent Events). Браузер сам переподключается при обрыве.
 * handler вызывается на каждое событие; после переподключения — один раз с type "game", чтобы всё перечитать.
 */
/** Изменение карты команды от сервера (решение владельца 24.10): разница в формате JSON Patch от версии base к rev, либо «перечитай». */
export type MapPush = { kind: "patch"; base: number; rev: number; patch: Array<{ op: string; path: string; value?: unknown }> } | { kind: "stale"; rev: number };
export function useGameEvents(gameId: string | null, handler: (e: GameEvent) => void, onMap?: (m: MapPush) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  const mapRef = useRef(onMap);
  mapRef.current = onMap;
  useEffect(() => {
    if (!gameId) return;
    const es = new EventSource(`/api/games/${gameId}/events`);
    let wasDown = false;
    es.addEventListener("change", (ev) => { try { ref.current(JSON.parse((ev as MessageEvent).data)); } catch { /* пропускаем битое */ } });
    es.addEventListener("map-patch", (ev) => { try { mapRef.current?.({ kind: "patch", ...JSON.parse((ev as MessageEvent).data) }); } catch { /* пропускаем битое */ } });
    es.addEventListener("map-stale", (ev) => { try { mapRef.current?.({ kind: "stale", ...JSON.parse((ev as MessageEvent).data) }); } catch { /* пропускаем битое */ } });
    es.addEventListener("hello", () => { if (wasDown) { wasDown = false; ref.current({ type: "game", at: Date.now() }); } });
    es.onerror = () => { wasDown = true; };
    return () => es.close();
  }, [gameId]);
}

/**
 * Склейка перечитываний (решение владельца 23.10 после нагрузочного прогона): несколько событий за окно дают одно
 * перечитывание, не позже чем через ms + jitter после первого. Задержка ограничена, отмены нет — данные свежие, запросов меньше.
 */
export function useCoalesced(fn: () => unknown, ms = 2500, jitter = 1500): () => void {
  const ref = useRef(fn);
  ref.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return useCallback(() => {
    if (timer.current) return;
    // Случайная добавка размазывает волну: после события сотни клиентов перечитывают не в одну секунду (прогон 24.10).
    timer.current = setTimeout(() => { timer.current = null; void ref.current(); }, ms + Math.random() * jitter);
  }, [ms, jitter]);
}
