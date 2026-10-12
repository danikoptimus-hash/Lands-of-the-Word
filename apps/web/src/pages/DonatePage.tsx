import { Back } from "../components/Back";
import { Icon } from "../components/Icon";
import { t } from "../lib/i18n";

/** Ссылка на страницу сбора в Boosty (решение владельца 12.10). Игра ничего не принимает сама: только ссылка и QR. */
const BOOSTY_URL = "https://boosty.to/danikootimus/donate";

/**
 * «Пожертвования» (решение владельца 12.10): одна страница со способами поддержать игру. Первый способ — Boosty:
 * принимает карты в долларах, евро и рублях, подходит для жертвователей из любой страны. Второй (Click для
 * Узбекистана) появится, когда владелец пришлёт QR.
 */
export function DonatePage() {
  return (
    <div className="how-to">
      <Back to="-1" label={t("Назад")} />
      <h1 className="mt-2">{t("Пожертвования")}</h1>
      <p className="muted mt-2">{t("Пожертвования идут на сервер, домен и развитие игры. Спасибо!")}</p>
      <section className="card mt-4 donate-card">
        <h2><span className="ico"><Icon name="star" /></span>{t("Из любой страны: Boosty")}</h2>
        <div className="donate-row mt-3">
          <a className="donate-qr" href={BOOSTY_URL} target="_blank" rel="noopener noreferrer" aria-label={t("Открыть страницу пожертвований в Boosty")}>
            <img src="/img/donate/boosty-qr.svg" alt="" width={180} height={180} />
          </a>
          <div className="stack">
            <p>{t("Нажмите кнопку или наведите камеру телефона на QR-код. На странице Boosty нажмите «Донат», укажите сумму и оплатите картой.")}</p>
            <p className="muted small">{t("Принимаются карты в долларах, евро и рублях. Карта должна поддерживать подтверждение платежа (3-D Secure).")}</p>
            <div className="actions"><a className="btn" href={BOOSTY_URL} target="_blank" rel="noopener noreferrer"><Icon name="star" />{t("Пожертвовать через Boosty")}</a></div>
          </div>
        </div>
      </section>
    </div>
  );
}
