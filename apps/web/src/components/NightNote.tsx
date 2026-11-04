import type { ReactNode } from "react";
import { t } from "../lib/i18n";
import { Icon } from "./Icon";
import { HelpPopup } from "./Help";

/**
 * Ночное предупреждение (решение владельца 04.11: «везде, где стоит такое предупреждение, оставить только знак месяца,
 * ночи, и при нажатии на него текст этой подсказки»): вместо плашки с текстом — круглый знак месяца, текст открывается
 * окошком по нажатию. tone — цвет знака: info (ночь) или warn (ход ждёт утра).
 */
export function NightNote({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div className={"night-sign-row " + tone}>
      <HelpPopup name={t("Ночь")} buttonClassName={"night-sign " + tone} trigger={<Icon name="moon" />}><p>{children}</p></HelpPopup>
    </div>
  );
}
