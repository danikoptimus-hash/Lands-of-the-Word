import { useCallback, useEffect, useRef } from "react";

export type GameEventType = "game" | "map" | "teams" | "deeds" | "tasks" | "submissions" | "cities" | "battles" | "journal" | "peace" | "quarry" | "trades" | "awards" | "wrecks";
export interface GameEvent { type: GameEventType; teamId?: string; at: number }

/**
 * Живые события игры (Server-Sent Events). Браузер сам переподключается при обрыве.
 * handler вызывается на каждое событие; после переподключения — один раз с type "game", чтобы всё перечитать.
 */
/** Изменение карты команды от сервера (решение владельца 24.10): разница в формате JSON Patch от версии base к rev, либо «перечитай». */
export type MapPush = { kind: "patch"; base: number; rev: number; patch: Array<{ op: string; path: string; value?: unknown }> } | { kind: "stale"; rev: number }
  /** Канал только что открылся: стоит один раз свериться с сервером — событие могло прийти, пока канала ещё не было. */
  | { kind: "check" };
type Handler = { current: (e: GameEvent) => void };
type MapHandler = { current: ((m: MapPush) => void) | undefined };
/**
 * Один канал событий на игру для всех, кто его слушает (ревизия скорости, этап 2). Раньше страница команды, лист
 * Каменоломни, обмены и экран администратора открывали каждый своё соединение — у одного игрока их бывало три.
 *
 * «Сторож»: сервер каждые 25 секунд шлёт биение. Пока биение идёт, канал жив и опрашивать сервер по таймеру незачем.
 * Нет биения дольше минуты (или приложение вернулось из фона, а последнему сигналу больше 35 секунд) — канал открывается
 * заново, и после переподключения слушатели получают событие «game»: всё перечитывается один раз. Сторож включается,
 * когда сервер в приветствии назвал период биения (или пришло первое биение) — со старым сервером, который биений не
 * шлёт, канал работает как раньше. Канал, который не поздоровался за полминуты, тоже открывается заново.
 *
 * Отказ вместо потока (ограничитель запросов, перезапуск сервера) браузер считает окончательным и канал закрывает:
 * такой канал открываем сами, с растущей паузой.
 */
interface Stream {
  es: EventSource | null; handlers: Set<Handler>; maps: Set<MapHandler>; lastAt: number; timer: ReturnType<typeof setInterval> | null;
  /** Сервер поздоровался (канал открыт); обрыв; сервер шлёт биения; приветствий за жизнь канала; отказов подряд; отложенная попытка. */
  up: boolean; down: boolean; beats: boolean; hellos: number; fails: number; retry: ReturnType<typeof setTimeout> | null;
}
const streams = new Map<string, Stream>();
const BEAT_LOST = 65_000, RETURN_STALE = 35_000, HELLO_WAIT = 30_000;

function open(gameId: string, s: Stream): void {
  // w=2: «разница» карты — в формате со справочником текстов дел (lib/mapWire.ts).
  const es = new EventSource(`/api/games/${gameId}/events?w=2`);
  s.es = es;
  const seen = () => { s.lastAt = Date.now(); };
  const toMaps = (m: MapPush) => { for (const h of [...s.maps]) { try { h.current?.(m); } catch { /* слушатель не должен ломать канал */ } } };
  const toAll = (e: GameEvent) => { for (const h of [...s.handlers]) { try { h.current(e); } catch { /* слушатель не должен ломать канал */ } } };
  es.addEventListener("change", (ev) => { seen(); try { toAll(JSON.parse((ev as MessageEvent).data)); } catch { /* пропускаем битое */ } });
  es.addEventListener("map-patch", (ev) => { seen(); try { toMaps({ kind: "patch", ...JSON.parse((ev as MessageEvent).data) }); } catch { /* пропускаем битое */ } });
  es.addEventListener("map-stale", (ev) => { seen(); try { toMaps({ kind: "stale", ...JSON.parse((ev as MessageEvent).data) }); } catch { /* пропускаем битое */ } });
  es.addEventListener("hb", () => { seen(); s.beats = true; });
  es.addEventListener("hello", (ev) => {
    seen(); s.up = true; s.fails = 0;
    try { if (Number((JSON.parse((ev as MessageEvent).data) as { hb?: number }).hb) > 0) s.beats = true; } catch { /* старый сервер: пустое приветствие */ }
    const first = s.hellos++ === 0;
    if (s.down) { s.down = false; toAll({ type: "game", at: Date.now() }); }
    // Первое приветствие: карту могли запросить на секунды раньше, чем открылся канал, — событие в этом окне потерялось бы.
    else if (first) toMaps({ kind: "check" });
  });
  es.onerror = () => {
    s.down = true;
    if (es.readyState !== 2 || s.es !== es || s.retry) return;
    const wait = Math.min(60_000, 5000 * 2 ** Math.min(s.fails++, 4));
    s.retry = setTimeout(() => { s.retry = null; if (streams.get(gameId) === s && s.es === es) reopen(gameId, s); }, wait);
  };
}
function reopen(gameId: string, s: Stream): void {
  try { s.es?.close(); } catch { /* уже закрыт */ }
  if (s.retry) { clearTimeout(s.retry); s.retry = null; }
  s.down = true; s.up = false; s.lastAt = Date.now();
  open(gameId, s);
}
/** Открыть канал заново: участника перевели в другую команду — сервер запомнил команду при подключении. */
export function reopenStream(gameId: string | null | undefined): void {
  const s = gameId ? streams.get(gameId) : undefined;
  if (gameId && s) reopen(gameId, s);
}
const awake = () => typeof document === "undefined" || (document.visibilityState === "visible" && navigator.onLine !== false);
function wake(): void { if (!awake()) return; for (const [id, s] of streams) if ((s.beats || !s.up) && Date.now() - s.lastAt > RETURN_STALE) reopen(id, s); }
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
}
/** Жив ли канал событий игры: пока жив, перемены приходят сами и сверяться с сервером по таймеру незачем. */
export function streamAlive(gameId: string | null | undefined): boolean {
  const s = gameId ? streams.get(gameId) : undefined;
  return Boolean(s && s.up && !s.down && (!s.beats || Date.now() - s.lastAt < BEAT_LOST));
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
      const made: Stream = { es: null, handlers: new Set(), maps: new Set(), lastAt: Date.now(), up: false, down: false, beats: false, hellos: 0, fails: 0, retry: null, timer: null };
      made.timer = setInterval(() => {
        if (!awake() || made.retry) return;
        const quiet = Date.now() - made.lastAt;
        if (made.up ? made.beats && quiet > BEAT_LOST : quiet > HELLO_WAIT) reopen(gameId, made);
      }, 15_000);
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
      if (stream.retry) clearTimeout(stream.retry);
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
