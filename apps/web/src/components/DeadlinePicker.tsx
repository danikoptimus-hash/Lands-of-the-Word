import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Stepper } from "./Stepper";
import { t, getLocale } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const withHour = (day: Date, hour: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0);

/**
 * Срок окончания игры без ввода по формату (решение владельца 21.09): число дней со стрелками, час со стрелками,
 * быстрые сроки и календарь на месяц, который раскрывается по кнопке. Значение — ISO-строка или "".
 */
export function DeadlinePicker({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const date = value ? new Date(value) : null;
  const today = startOfDay(new Date());
  const hour = date ? date.getHours() : 21;
  const days = date ? Math.max(1, Math.round((startOfDay(date).getTime() - today.getTime()) / DAY_MS)) : 0;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => { const b = date ?? new Date(); return new Date(b.getFullYear(), b.getMonth(), 1); });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, [open]);

  const set = (day: Date, h = hour) => onChange(withHour(day, h).toISOString());
  const setDays = (n: number) => set(new Date(today.getTime() + Math.max(1, n) * DAY_MS));
  const presets: Array<[string, number]> = [[t("2 недели"), 14], [t("месяц"), 30], [t("6 недель"), 42], [t("2 месяца"), 60]];

  const loc = getLocale() === "en" ? "en-GB" : "ru-RU";
  const raw = month.toLocaleDateString(loc, { month: "long", year: "numeric" }).replace(/\s*г\.$/i, "");
  const monthName = raw.charAt(0).toUpperCase() + raw.slice(1);
  const dayNames = useMemo(() => { const base = new Date(2024, 0, 1); return Array.from({ length: 7 }, (_, i) => new Date(base.getTime() + i * DAY_MS).toLocaleDateString(loc, { weekday: "short" })); }, [loc]);
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // неделя с понедельника
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: Array<Date | null> = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= count; d++) out.push(new Date(month.getFullYear(), month.getMonth(), d));
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);
  const same = (a: Date, b: Date | null) => !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  return (
    <div className="deadline" ref={ref}>
      <div className="deadline-row">
        <span className="deadline-lbl">{t("Через")}</span>
        <Stepper id="ends-days" value={days || ""} min={1} max={365} onChange={(v) => setDays(v === "" ? 1 : v)} ariaLabel={t("Дней до окончания")} />
        <span className="deadline-lbl">{days ? plural(days, ["день", "дня", "дней"]).replace(/^\d+\s*/, "") : t("дней")}</span>
        <span className="deadline-lbl">{t("в")}</span>
        <Stepper id="ends-hour" value={hour} min={0} max={23} onChange={(v) => { if (date) set(startOfDay(date), v === "" ? 21 : v); }} ariaLabel={t("Час окончания")} />
        <span className="deadline-lbl">{t("ч.")}</span>
        <button type="button" className="secondary sm cal-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}><Icon name="calendar" />{t("Календарь")}</button>
      </div>
      <div className="deadline-presets">
        {presets.map(([label, n]) => <button key={n} type="button" className={"ghost sm" + (days === n ? " on" : "")} onClick={() => setDays(n)}>{label}</button>)}
      </div>
      {date && <p className="deadline-when"><Icon name="clock" />{t("Игра закончится {d}", { d: fmtDate(date) })}</p>}
      {open && (
        <div className="calendar" role="dialog" aria-label={t("Календарь")}>
          <div className="cal-head">
            <button type="button" className="ghost icon sm" aria-label={t("Предыдущий месяц")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><Icon name="back" /></button>
            <span className="cal-month">{monthName}</span>
            <button type="button" className="ghost icon sm" aria-label={t("Следующий месяц")} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><Icon name="chevron" /></button>
          </div>
          <div className="cal-grid">
            {dayNames.map((n) => <span key={n} className="cal-dow">{n}</span>)}
            {cells.map((c, i) => c ? (
              <button key={i} type="button" className={"cal-day" + (same(c, date) ? " sel" : "") + (same(c, today) ? " today" : "")} disabled={c.getTime() < today.getTime()} onClick={() => { set(c); setOpen(false); }}>{c.getDate()}</button>
            ) : <span key={i} />)}
          </div>
        </div>
      )}
    </div>
  );
}
