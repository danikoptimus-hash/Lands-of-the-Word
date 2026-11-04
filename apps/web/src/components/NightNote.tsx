import type { ReactNode } from "react";
import { t } from "../lib/i18n";
import { Icon } from "./Icon";
import { HelpPopup } from "./Help";

/**
 * Ночное предупреждение (решение владельца 04.11: «везде, где стоит такое предупреждение, оставить только знак месяца,
 * ночи, и при нажатии на него текст этой подсказки»): вместо плашки с текстом — круглый знак месяца, текст открывается
 * окошком по нажатию. tone — цвет знака: info (ночь) или warn (ход ждёт утра).
 */
export function NightNote({ children, tone = "info", inline = false }: { children: ReactNode; tone?: "info" | "warn"; /** Маленький знак в строке (шапка города, решение владельца 04.11: «сделать меньше и поместить в шапку города»). */ inline?: boolean }) {
  const pop = <HelpPopup name={t("Ночь")} buttonClassName={"night-sign " + tone + (inline ? " sm" : "")} trigger={<Icon name="moon" />}><p>{children}</p></HelpPopup>;
  return inline ? pop : <div className={"night-sign-row " + tone}>{pop}</div>;
}
