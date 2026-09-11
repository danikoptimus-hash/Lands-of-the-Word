import { getLocale, t } from "./i18n";

/** Склонение по числу: plural(3, ["команда", "команды", "команд"]) → «3 команды». Английский — по словарю форм [one, other]. */
export function plural(n: number, forms: [string, string, string] | [string, string]): string {
  if (getLocale() === "en" || forms.length === 2) { const one = forms[0], many = forms[forms.length - 1]!; return `${n} ${n === 1 ? t(one) : t(many)}`; }
  const [one, few, many] = forms;
  const m10 = n % 10, m100 = n % 100;
  const f = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${f}`;
}

/** Дата и время по языку интерфейса: «сегодня 14:05», «вчера 18:30», «5 сент., 14:05». */
export function fmtDate(iso: string | number | Date | null | undefined, opts: { time?: boolean } = { time: true }): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const loc = getLocale() === "en" ? "en-GB" : "ru-RU";
  const time = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return opts.time ? `${t("сегодня")} ${time}` : t("сегодня");
  if (sameDay(d, yesterday)) return opts.time ? `${t("вчера")} ${time}` : t("вчера");
  const date = d.toLocaleDateString(loc, { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
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
