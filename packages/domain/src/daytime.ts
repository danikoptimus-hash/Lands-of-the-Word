/**
 * Времена суток игры (решение владельца 03.10): утро 7:00–9:00, день 9:00–18:00, вечер 18:00–22:00, ночь 22:00–7:00
 * по часовому поясу игры. Правила переключаются ровно на границе (ночью города спят, дела и испытания ждут утра,
 * вызов отправляют на проверку только утром); карта перекрашивается плавно — вокруг каждой границы BLEND_MIN минут
 * в обе стороны цвета двух соседних фаз смешиваются по доле t.
 */
export type DayPhase = "morning" | "day" | "evening" | "night";

export const PHASES: readonly DayPhase[] = ["morning", "day", "evening", "night"];
/** Начало каждой фазы в минутах от полуночи местного времени. */
export const PHASE_START: Record<DayPhase, number> = { morning: 7 * 60, day: 9 * 60, evening: 18 * 60, night: 22 * 60 };
/** Полуширина плавного перехода на карте, минут. */
export const BLEND_MIN = 15;

/** Минуты от полуночи по поясу; при неизвестном поясе — по UTC, без падения. */
export function localMinutes(timeZone: string, now: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hour12: false }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + m;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/** Фаза по минутам от полуночи. */
export function phaseAt(minutes: number): DayPhase {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m >= PHASE_START.night || m < PHASE_START.morning) return "night";
  if (m < PHASE_START.day) return "morning";
  if (m < PHASE_START.evening) return "day";
  return "evening";
}

export function dayPhase(timeZone: string, now: Date = new Date()): DayPhase {
  return phaseAt(localMinutes(timeZone, now));
}

/**
 * Задания города — порядок районов, ответы, подсказка пророка — решаются до полуночи (решение владельца 04.10):
 * закрыты только с 0:00 до 7:00. Знаки шифра, адресат и конверт спят всю ночь, с 22:00 до 7:00, как раньше.
 */
export function cityTasksOpenAt(minutes: number): boolean {
  const m = ((minutes % 1440) + 1440) % 1440;
  return m >= PHASE_START.morning;
}
export function cityTasksOpen(timeZone: string, now: Date = new Date()): boolean {
  return cityTasksOpenAt(localMinutes(timeZone, now));
}

export interface DayLight {
  /** Фаза правил (резкая граница). */
  phase: DayPhase;
  /** Пара фаз для перекраски карты и доля второй: вне перехода from = to = phase, t = 0. */
  from: DayPhase;
  to: DayPhase;
  t: number;
  /** Минуты от полуночи местного времени. */
  minutes: number;
  /** Через сколько миллисекунд ближайшее изменение фазы правил. */
  nextChangeMs: number;
}

const next = (p: DayPhase): DayPhase => PHASES[(PHASES.indexOf(p) + 1) % PHASES.length]!;
const prev = (p: DayPhase): DayPhase => PHASES[(PHASES.indexOf(p) + PHASES.length - 1) % PHASES.length]!;

/** Освещение карты в данный момент: фаза, пара фаз перехода и его доля. */
export function dayLightAt(minutes: number): Omit<DayLight, "nextChangeMs"> {
  const m = ((minutes % 1440) + 1440) % 1440;
  const phase = phaseAt(m);
  // Расстояние до границы: начало этой фазы (переход ещё идёт) или начало следующей (переход уже начался).
  const start = PHASE_START[phase], end = PHASE_START[next(phase)];
  const since = ((m - start) % 1440 + 1440) % 1440, until = ((end - m) % 1440 + 1440) % 1440;
  if (since < BLEND_MIN) return { phase, from: prev(phase), to: phase, t: 0.5 + since / (2 * BLEND_MIN), minutes: m };
  if (until <= BLEND_MIN) return { phase, from: phase, to: next(phase), t: (BLEND_MIN - until) / (2 * BLEND_MIN), minutes: m };
  return { phase, from: phase, to: phase, t: 0, minutes: m };
}

export function dayLight(timeZone: string, now: Date = new Date()): DayLight {
  const m = localMinutes(timeZone, now);
  const base = dayLightAt(m);
  const end = PHASE_START[next(base.phase)];
  const untilMin = ((end - m) % 1440 + 1440) % 1440 || 1440;
  // До границы — целые минуты от текущей, плюс остаток текущей минуты (секунды не известны: берём секунды часов).
  const sec = now.getUTCSeconds() + now.getUTCMilliseconds() / 1000;
  return { ...base, nextChangeMs: Math.max(1000, Math.round((untilMin * 60 - sec) * 1000)) };
}

/** Подпись фазы по-русски (для интерфейса; перевод — через t()). */
export const PHASE_LABEL_RU: Record<DayPhase, string> = { morning: "Утро", day: "День", evening: "Вечер", night: "Ночь" };
/** Границы фаз «ч:мм» для подсказок. */
export const PHASE_HOURS: Record<DayPhase, { from: string; to: string }> = { morning: { from: "7:00", to: "9:00" }, day: { from: "9:00", to: "18:00" }, evening: { from: "18:00", to: "22:00" }, night: { from: "22:00", to: "7:00" } };

/**
 * Ночью таймеры испытаний стоят (решение владельца 03.10): ночью ничего не делается, значит и время не идёт.
 * Ближайшая граница «ночь ↔ не ночь» после момента `from`: ночь ли сейчас и когда она кончится (или начнётся).
 */
export function nightBoundary(timeZone: string, from: Date): { night: boolean; at: Date } {
  const m = localMinutes(timeZone, from);
  const night = m >= PHASE_START.night || m < PHASE_START.morning;
  const until = night ? ((PHASE_START.morning - m) % 1440 + 1440) % 1440 || 1440 : PHASE_START.night - m;
  const inMinute = from.getUTCSeconds() * 1000 + from.getUTCMilliseconds();
  return { night, at: new Date(from.getTime() + until * 60_000 - inMinute) };
}

/** Сколько «дневных» миллисекунд между двумя моментами: ночь (22:00–7:00 по поясу) не считается. */
export function awakeMsBetween(timeZone: string, from: Date, to: Date): number {
  let t = from.getTime(), total = 0;
  const end = to.getTime();
  for (let guard = 0; t < end && guard < 10_000; guard++) {
    const b = nightBoundary(timeZone, new Date(t));
    const stop = Math.min(b.at.getTime(), end);
    if (!b.night) total += stop - t;
    t = stop;
  }
  return total;
}

/** Момент через `ms` дневных миллисекунд после `from`: ночь пропускается; если `from` ночью — отсчёт с 7:00. */
export function addAwakeMs(timeZone: string, from: Date, ms: number): Date {
  let t = from.getTime(), left = Math.max(0, ms);
  for (let guard = 0; guard < 10_000; guard++) {
    const b = nightBoundary(timeZone, new Date(t));
    if (b.night) { t = b.at.getTime(); continue; }
    const seg = b.at.getTime() - t;
    if (seg >= left) return new Date(t + left);
    left -= seg;
    t = b.at.getTime();
  }
  return new Date(t);
}
