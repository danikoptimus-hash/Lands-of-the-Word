import { useCallback, useEffect, useRef } from "react";

export type GameEventType = "game" | "map" | "teams" | "deeds" | "tasks" | "submissions" | "cities" | "battles" | "journal" | "peace" | "quarry" | "trades" | "awards" | "wrecks";
export interface GameEvent { type: GameEventType; teamId?: string; at: number }

/**
 * Живые события игры (Server-Sent Events). Браузер сам переподключается при обрыве.
 * handler вызывается на каждое событие; после переподключения — один раз с type "game", чтобы всё перечитать.
 */
/** Изменение карты команды от сервера (решение владельца 24.10): разница в формате JSON Patch от версии base к rev, либо «перечитай». */
export type MapPush = { kind: "patch"; base: number; rev: number; patch: Array<{ op: string; path: string; value?: unknown }> } | { kind: "stale"; rev: number };
type Handler = { current: (e: GameEvent) => void };
type MapHandler = { current: ((m: MapPush) => void) | undefined };
/**
 * Один канал событий на игру для всех, кто его слушает (ревизия скорости, этап 2). Раньше страница команды, лист
 * Каменоломни, обмены и экран администратора открывали каждый своё соединение — у одного игрока их бывало три.
 *
 * «Сторож»: сервер каждые 25 секунд шлёт биение. Пока биение идёт, канал жив и опрашивать сервер по таймеру незачем.
 * Нет биения дольше минуты (или приложение вернулось из фона, а последнему сигналу больше 35 секунд) — канал открывается
 * заново, и после переподключения слушатели получают событие «game»: всё перечитывается один раз. Сторож включается
 * только после первого биения — со старым сервером, который биений не шлёт, канал работает как раньше.
 */
interface Stream { es: EventSource | null; handlers: Set<Handler>; maps: Set<MapHandler>; lastAt: number; down: boolean; beats: boolean; timer: ReturnType<typeof setInterval> | null }
const streams = new Map<string, Stream>();
const BEAT_LOST = 65_000, RETURN_STALE = 35_000;

function open(gameId: string, s: Stream): void {
  const es = new EventSource(`/api/games/${gameId}/events`);
  s.es = es;
  const seen = () => { s.lastAt = Date.now(); };
  const toMaps = (m: MapPush) => { for (const h of [...s.maps]) { try { h.current?.(m); } catch { /* слушатель не должен ломать канал */ } } };
  const toAll = (e: GameEvent) => { for (const h of [...s.handlers]) { try { h.current(e); } catch { /* слушатель не должен ломать канал */ } } };
  es.addEventListener("change", (ev) => { seen(); try { toAll(JSON.parse((ev as MessageEvent).data)); } catch { /* пропускаем битое */ } });
  es.addEventListener("map-patch", (ev) => { seen(); try { toMaps({ kind: "patch", ...JSON.parse((ev as MessageEvent).data) }); } catch { /* пропускаем битое */ } });
  es.addEventListener("map-stale", (ev) => { seen(); try { toMaps({ kind: "stale", ...JSON.parse((ev as MessageEvent).data) }); } catch { /* пропускаем битое */ } });
  es.addEventListener("hb", () => { seen(); s.beats = true; });
  es.addEventListener("hello", () => { seen(); if (s.down) { s.down = false; toAll({ type: "game", at: Date.now() }); } });
  es.onerror = () => { s.down = true; };
}
function reopen(gameId: string, s: Stream): void {
  try { s.es?.close(); } catch { /* уже закрыт */ }
  s.down = true; s.lastAt = Date.now();
  open(gameId, s);
}
const awake = () => typeof document === "undefined" || (document.visibilityState === "visible" && navigator.onLine !== false);
function wake(): void { if (!awake()) return; for (const [id, s] of streams) if (s.beats && Date.now() - s.lastAt > RETURN_STALE) reopen(id, s); }
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
}
/** Жив ли канал событий игры: пока жив, перемены приходят сами и сверяться с сервером по таймеру незачем. */
export function streamAlive(gameId: string | null | undefined): boolean {
  const s = gameId ? streams.get(gameId) : undefined;
  return Boolean(s && !s.down && (!s.beats || Date.now() - s.lastAt < BEAT_LOST));
}

export function useGameEvents(gameId: string | null, handler: (e: GameEvent) => void, onMap?: (m: MapPush) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  const mapRef = useRef(onMap);
  mapRef.current = onMap;
  useEffect(() => {
    if (!gameId) return;
    let s = streams.get(gameId);
    if (!s) {
      const made: Stream = { es: null, handlers: new Set(), maps: new Set(), lastAt: Date.now(), down: false, beats: false, timer: null };
      made.timer = setInterval(() => { if (made.beats && awake() && Date.now() - made.lastAt > BEAT_LOST) reopen(gameId, made); }, 15_000);
      streams.set(gameId, made);
      open(gameId, made);
      s = made;
    }
    const stream = s;
    stream.handlers.add(ref); stream.maps.add(mapRef);
    return () => {
      stream.handlers.delete(ref); stream.maps.delete(mapRef);
      if (stream.handlers.size > 0) return;
      try { stream.es?.close(); } catch { /* уже закрыт */ }
      if (stream.timer) clearInterval(stream.timer);
      if (streams.get(gameId) === stream) streams.delete(gameId);
    };
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
