import { Back } from "../components/Back";
import { t } from "../lib/i18n";

/** Создание игры на отдельной странице (заглушка: реализуется в редизайне главной). */
export function NewGamePage() {
  return (
    <>
      <Back to="/" label={t("Мои игры")} />
      <h1>{t("Новая игра")}</h1>
    </>
  );
}
