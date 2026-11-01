import { nightBoundary } from "./daytime.js";
import { localWeekMinutes, stormAt, type StormSlot } from "./storm.js";

/**
 * «Сон» игры — ночь (22:00–7:00 по поясу, решение владельца 03.10) и шторм (расписание администратора, решение
 * владельца 24.10): пока игра спит, ничего не делается, значит и таймеры испытаний стоят (проверка владельца 01.11:
 * «во время штормов таймеры ставились на паузу»). Ближайшая граница после `from`, на которой состояние может смениться.
 */
export function sleepBoundary(timeZone: string, storms: ReadonlyArray<StormSlot>, from: Date): { asleep: boolean; at: Date } {
  const n = nightBoundary(timeZone, from);
  if (!storms.length) return { asleep: n.night, at: n.at };
  const st = stormAt(storms, localWeekMinutes(timeZone, from));
  const inMinute = from.getUTCSeconds() * 1000 + from.getUTCMilliseconds();
  const stormEdge = st.untilMin === null ? Infinity : from.getTime() + st.untilMin * 60_000 - inMinute;
  const at = Math.max(Math.min(n.at.getTime(), stormEdge), from.getTime() + 1);
  return { asleep: n.night || st.active, at: new Date(at) };
}

/** Сколько «дневных» миллисекунд между двумя моментами: ночь и шторм не считаются. */
export function awakeMsBetween(timeZone: string, from: Date, to: Date, storms: ReadonlyArray<StormSlot> = []): number {
  let t = from.getTime(), total = 0;
  const end = to.getTime();
  for (let guard = 0; t < end && guard < 20_000; guard++) {
    const b = sleepBoundary(timeZone, storms, new Date(t));
    const stop = Math.min(b.at.getTime(), end);
    if (!b.asleep) total += stop - t;
    t = stop;
  }
  return total;
}

/** Момент через `ms` дневных миллисекунд после `from`: ночь и шторм пропускаются; если `from` во сне — отсчёт с пробуждения. */
export function addAwakeMs(timeZone: string, from: Date, ms: number, storms: ReadonlyArray<StormSlot> = []): Date {
  let t = from.getTime(), left = Math.max(0, ms);
  for (let guard = 0; guard < 20_000; guard++) {
    const b = sleepBoundary(timeZone, storms, new Date(t));
    if (b.asleep) { t = b.at.getTime(); continue; }
    const seg = b.at.getTime() - t;
    if (seg >= left) return new Date(t + left);
    left -= seg;
    t = b.at.getTime();
  }
  return new Date(t);
}
