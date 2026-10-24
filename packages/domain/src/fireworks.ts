import { localMinutes, PHASE_START } from "./daytime.js";

/**
 * Салют над взятым городом (решение владельца 24.10): пять минут с момента взятия, и ещё пять минут с наступления ночи
 * того же дня по поясу игры — чтобы участники увидели салют и на ночной карте. Чистая функция: до какого момента (мс эпохи)
 * над городом салют сейчас, или null.
 */
export const FIREWORKS_MS = 5 * 60_000;

/** Местная дата «ГГГГ-ММ-ДД» по поясу; при неизвестном поясе — по UTC. */
export function localDay(timeZone: string, at: Date): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at); }
  catch { return at.toISOString().slice(0, 10); }
}

export function fireworksUntil(capturedAtMs: number, nowMs: number, timeZone: string): number | null {
  if (!Number.isFinite(capturedAtMs) || nowMs < capturedAtMs) return null;
  if (nowMs - capturedAtMs < FIREWORKS_MS) return capturedAtMs + FIREWORKS_MS;
  const now = new Date(nowMs);
  const min = localMinutes(timeZone, now);
  if (min < PHASE_START.night) return null;
  // Начало сегодняшней ночи: от текущей минуты назад до 22:00, секунды текущей минуты тоже назад.
  const sec = now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  const nightStart = nowMs - (min - PHASE_START.night) * 60_000 - sec;
  if (capturedAtMs >= nightStart) return null; // взят уже ночью: салют был сразу после взятия
  if (localDay(timeZone, new Date(capturedAtMs)) !== localDay(timeZone, now)) return null;
  return nowMs < nightStart + FIREWORKS_MS ? nightStart + FIREWORKS_MS : null;
}
