/**
 * Времена года (решение владельца 05.10): зима — декабрь–февраль, весна — март–май, лето — июнь–август, осень — сентябрь–ноябрь
 * по календарю в часовом поясе игры. Сезон меняет картинки карты (местность, островки, города, старты), палитру моря и погоду;
 * правила игры от него не зависят. Администратор может закрепить сезон правилом `season` (auto — по календарю).
 */
export type Season = "winter" | "spring" | "summer" | "autumn";
export type SeasonRule = "auto" | Season;

export const SEASONS: readonly Season[] = ["winter", "spring", "summer", "autumn"];

/** Сезон по номеру месяца (1–12). */
export function seasonOfMonth(month: number): Season {
  const m = ((Math.round(month) - 1) % 12 + 12) % 12 + 1;
  if (m === 12 || m <= 2) return "winter";
  if (m <= 5) return "spring";
  if (m <= 8) return "summer";
  return "autumn";
}

/** Номер месяца (1–12) в поясе; при неизвестном поясе — по UTC, без падения. */
export function monthIn(timeZone: string, now: Date = new Date()): number {
  try {
    const v = new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric" }).format(now);
    return Number(v) || now.getUTCMonth() + 1;
  } catch {
    return now.getUTCMonth() + 1;
  }
}

export function seasonAt(timeZone: string, now: Date = new Date()): Season {
  return seasonOfMonth(monthIn(timeZone, now));
}

/** Сезон с учётом правила администратора: auto — по календарю, иначе закреплённый. */
export function resolveSeason(rule: SeasonRule | string | undefined, timeZone: string, now: Date = new Date()): Season {
  return rule && rule !== "auto" && (SEASONS as readonly string[]).includes(rule) ? (rule as Season) : seasonAt(timeZone, now);
}
