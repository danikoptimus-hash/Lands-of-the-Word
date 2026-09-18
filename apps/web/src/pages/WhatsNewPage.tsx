import { Link } from "react-router-dom";
import { Back } from "../components/Back";
import { Icon } from "../components/Icon";
import { t, getLocale } from "../lib/i18n";
import { CHANGELOG } from "../content/changelog";

/** Дата выкладки словами, без «сегодня/вчера»: список должен читаться одинаково и через месяц. */
const dayLabel = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString(getLocale() === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "long", year: "numeric" });

/** «Что нового»: изменения игры по датам, кратко. Данные — content/changelog.ts. */
export function WhatsNewPage() {
  return (
    <div className="how-to">
      <Back to="-1" label={t("Назад")} />
      <h1 className="mt-2">{t("Что нового")}</h1>
      <p className="muted mt-2">{t("Изменения по датам. Подробности —")} <Link to="/how-to-play">{t("Как играть?")}</Link></p>
      {CHANGELOG.map((day) => (
        <section key={day.date} className="card mt-4">
          <h2><span className="ico"><Icon name="sparkle" /></span>{dayLabel(day.date)}</h2>
          <ul className="stack mt-3 changelog">
            {day.items.map((s) => <li key={s}>{t(s)}</li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
