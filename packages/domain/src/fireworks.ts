import { localMinutes } from "./daytime.js";

/**
 * Салют над взятым городом (решение владельца 25.10: «чтобы салют над новым городом до конца дня бил»): с момента взятия
 * и до конца того же календарного дня по поясу игры (местная полночь). Чистая функция: до какого момента (мс эпохи)
 * над городом салют сейчас, или null.
 */

/** Местная дата «ГГГГ-ММ-ДД» по поясу; при неизвестном поясе — по UTC. */
export function localDay(timeZone: string, at: Date): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at); }
  catch { return at.toISOString().slice(0, 10); }
}

export function fireworksUntil(capturedAtMs: number, nowMs: number, timeZone: string): number | null {
  if (!Number.isFinite(capturedAtMs) || nowMs < capturedAtMs) return null;
  const now = new Date(nowMs);
  if (localDay(timeZone, new Date(capturedAtMs)) !== localDay(timeZone, now)) return null;
  // Конец местного дня: от текущей минуты вперёд до 24:00, секунды текущей минуты назад.
  const min = localMinutes(timeZone, now);
  const sec = now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  return nowMs + (24 * 60 - min) * 60_000 - sec;
}
