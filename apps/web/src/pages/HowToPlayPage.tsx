import { Back } from "../components/Back";
import { t } from "../lib/i18n";

/** Краткие правила для игрока (заглушка: реализуется в редизайне экранов игрока). */
export function HowToPlayPage() {
  return (
    <>
      <Back to="-1" label={t("Назад")} />
      <h1>{t("Как играть")}</h1>
    </>
  );
}
