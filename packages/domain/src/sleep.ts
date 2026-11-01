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

/**
 * Реальное время обеим сторонам (решение владельца 01.11, вечер: «считать обеим сторонам реальное время, включая ночь…
 * ночь входит в счёт претендентам и ровно так же отдаётся хранителям; шторм как пауза остаётся у обеих сторон»).
 * Ночь в расчёте сроков испытания больше не пауза — пауза только шторм. Граница состояния шторма после `from`.
 */
export function stormBoundary(timeZone: string, storms: ReadonlyArray<StormSlot>, from: Date): { asleep: boolean; at: Date } {
  if (!storms.length) return { asleep: false, at: new Date(from.getTime() + 7 * 86_400_000) };
  const st = stormAt(storms, localWeekMinutes(timeZone, from));
  const inMinute = from.getUTCSeconds() * 1000 + from.getUTCMilliseconds();
  const at = st.untilMin === null ? from.getTime() + 7 * 86_400_000 : Math.max(from.getTime() + st.untilMin * 60_000 - inMinute, from.getTime() + 1);
  return { asleep: st.active, at: new Date(at) };
}

/** Сколько миллисекунд между двумя моментами по часам, без штормов (ночь считается). */
export function activeMsBetween(timeZone: string, from: Date, to: Date, storms: ReadonlyArray<StormSlot> = []): number {
  let t = from.getTime(), total = 0;
  const end = to.getTime();
  for (let guard = 0; t < end && guard < 20_000; guard++) {
    const b = stormBoundary(timeZone, storms, new Date(t));
    const stop = Math.min(b.at.getTime(), end);
    if (!b.asleep) total += stop - t;
    t = stop;
  }
  return total;
}

/** Момент через `ms` миллисекунд по часам после `from`, штормы пропускаются; если `from` в шторм — отсчёт с его конца. */
export function addActiveMs(timeZone: string, from: Date, ms: number, storms: ReadonlyArray<StormSlot> = []): Date {
  let t = from.getTime(), left = Math.max(0, ms);
  for (let guard = 0; guard < 20_000; guard++) {
    const b = stormBoundary(timeZone, storms, new Date(t));
    if (b.asleep) { t = b.at.getTime(); continue; }
    const seg = b.at.getTime() - t;
    if (seg >= left) return new Date(t + left);
    left -= seg;
    t = b.at.getTime();
  }
  return new Date(t);
}

/** Срок, выпавший на ночь или шторм, переносится на пробуждение (7:00 или конец шторма): ночью и в шторм сдать нельзя. */
export function wakeUp(timeZone: string, at: Date, storms: ReadonlyArray<StormSlot> = []): Date {
  let t = at;
  for (let guard = 0; guard < 100; guard++) {
    const b = sleepBoundary(timeZone, storms, t);
    if (!b.asleep) return t;
    t = b.at;
  }
  return t;
}
