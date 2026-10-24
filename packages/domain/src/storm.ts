import { localMinutes } from "./daytime.js";

/**
 * Штормы (решение владельца 24.10): администратор задаёт недельные интервалы по поясу игры — например, время
 * богослужений. В шторм участники видят только карту с бурей: ни дел, ни городов, ни меню; сервер действия не принимает.
 * Интервал — день недели (0 воскресенье … 6 суббота), начало и конец «ЧЧ:ММ» местного времени; конец раньше начала —
 * интервал через полночь.
 */
export interface StormSlot { weekday: number; from: string; to: string }

export interface StormState {
  active: boolean;
  /** Через сколько миллисекунд ближайшая смена (начало или конец шторма); null — интервалов нет. */
  nextChangeMs: number | null;
}

const WEEK = 7 * 1440;
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Минуты от начала недели (воскресенье 0:00) по поясу; при неизвестном поясе — по UTC. */
export function localWeekMinutes(timeZone: string, now: Date = new Date()): number {
  let wd: number;
  try {
    const d = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
    wd = WD[d] ?? now.getUTCDay();
  } catch {
    wd = now.getUTCDay();
  }
  return wd * 1440 + localMinutes(timeZone, now);
}

export function parseHM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** Интервал в минутах недели: начало и длина; пустой или неверный — null. */
function span(slot: StormSlot): { start: number; len: number } | null {
  const from = parseHM(slot.from), to = parseHM(slot.to);
  if (from === null || to === null || slot.weekday < 0 || slot.weekday > 6) return null;
  const len = to > from ? to - from : to < from ? to + 1440 - from : 0;
  if (len === 0) return null;
  return { start: slot.weekday * 1440 + from, len };
}

/** Состояние шторма в минуту недели `wk`: идёт ли и через сколько минут смена. */
export function stormAt(slots: ReadonlyArray<StormSlot>, wk: number): { active: boolean; untilMin: number | null } {
  const w = ((wk % WEEK) + WEEK) % WEEK;
  let active = false, until: number | null = null;
  for (const s of slots) {
    const sp = span(s); if (!sp) continue;
    const since = ((w - sp.start) % WEEK + WEEK) % WEEK;
    if (since < sp.len) { active = true; const left = sp.len - since; if (until === null || left < until) until = left; }
  }
  if (active) {
    // Пока идёт один интервал, может начаться соседний: конец шторма — когда не идёт ни один. Ищем вперёд по минутам границ.
    let end = until!;
    for (let guard = 0; guard < slots.length + 1; guard++) {
      const probe = stormAtOnce(slots, w + end);
      if (!probe.active) break;
      end += probe.untilMin ?? 0;
    }
    return { active: true, untilMin: end };
  }
  for (const s of slots) {
    const sp = span(s); if (!sp) continue;
    const ahead = ((sp.start - w) % WEEK + WEEK) % WEEK || WEEK;
    if (until === null || ahead < until) until = ahead;
  }
  return { active: false, untilMin: until };
}

function stormAtOnce(slots: ReadonlyArray<StormSlot>, wk: number): { active: boolean; untilMin: number | null } {
  const w = ((wk % WEEK) + WEEK) % WEEK;
  let active = false, until: number | null = null;
  for (const s of slots) {
    const sp = span(s); if (!sp) continue;
    const since = ((w - sp.start) % WEEK + WEEK) % WEEK;
    if (since < sp.len) { active = true; const left = sp.len - since; if (until === null || left < until) until = left; }
  }
  return { active, untilMin: until };
}

/** Состояние шторма сейчас по поясу игры. Миллисекунды до смены — по целым минутам границ минус секунды текущей минуты. */
export function stormState(slots: ReadonlyArray<StormSlot>, timeZone: string, now: Date = new Date()): StormState {
  if (!slots.length) return { active: false, nextChangeMs: null };
  const r = stormAt(slots, localWeekMinutes(timeZone, now));
  if (r.untilMin === null) return { active: r.active, nextChangeMs: null };
  const sec = now.getUTCSeconds() + now.getUTCMilliseconds() / 1000;
  return { active: r.active, nextChangeMs: Math.max(1000, Math.round((r.untilMin * 60 - sec) * 1000)) };
}
