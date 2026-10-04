import { getLocale, t } from "./i18n";

/** Склонение по числу: plural(3, ["команда", "команды", "команд"]) → «3 команды». Английский — по словарю форм [one, other]. */
export function plural(n: number, forms: [string, string, string] | [string, string]): string {
  if (getLocale() === "en" || forms.length === 2) { const one = forms[0], many = forms[forms.length - 1]!; return `${n} ${n === 1 ? t(one) : t(many)}`; }
  const [one, few, many] = forms;
  const m10 = n % 10, m100 = n % 100;
  const f = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${f}`;
}

/**
 * Часовой пояс игры для показа времени (решение владельца 04.10): даты и часы в игре показываются по поясу игры,
 * а не по настройкам устройства участника, чтобы «сегодня», «до 0:00» и время сдачи совпадали у всех. Страницы игры
 * выставляют его, как только узнают правила; до этого — пояс устройства.
 */
let displayZone: string | undefined;
export function setDisplayTimeZone(tz: string | undefined): void { displayZone = tz || undefined; }
export function displayTimeZone(): string | undefined { return displayZone; }
/** Календарный день «ГГГГ-ММ-ДД» по поясу игры (при неизвестном поясе — устройства). */
function dayKey(d: Date): string {
  try { return d.toLocaleDateString("en-CA", { timeZone: displayZone, year: "numeric", month: "2-digit", day: "2-digit" }); }
  catch { return d.toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }); }
}
function zoned<T>(f: (tz: string | undefined) => T): T { try { return f(displayZone); } catch { return f(undefined); } }

/** Дата и время по языку интерфейса и поясу игры: «сегодня 14:05», «вчера 18:30», «5 сент., 14:05». */
export function fmtDate(iso: string | number | Date | null | undefined, opts: { time?: boolean } = { time: true }): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const loc = getLocale() === "en" ? "en-GB" : "ru-RU";
  const time = zoned((tz) => d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", timeZone: tz }));
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey(d) === dayKey(now)) return opts.time ? `${t("сегодня")} ${time}` : t("сегодня");
  if (dayKey(d) === dayKey(yesterday)) return opts.time ? `${t("вчера")} ${time}` : t("вчера");
  const sameYear = dayKey(d).slice(0, 4) === dayKey(now).slice(0, 4);
  const date = zoned((tz) => d.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: tz, ...(sameYear ? {} : { year: "numeric" }) }));
  return opts.time ? `${date}, ${time}` : date;
}

/** Остаток времени: «3 дн 4 ч», «2 ч 10 мин», «45 мин». */
export function fmtLeft(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return t("{d} дн {h} ч", { d, h });
  if (h > 0) return t("{h} ч {m} мин", { h, m: mm });
  return t("{m} мин", { m: mm });
}
