import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { t } from "../lib/i18n";

/**
 * Пояснение «за кнопкой» (решение владельца 18.09: инструкции прячутся, состояние остаётся на виду).
 * Круглая «?» рядом с заголовком или подписью; текст раскрывается на месте, в потоке: на телефоне нет наведения,
 * а внутри прокручиваемых шторок всплывающие окна ненадёжны. Нативный details: клавиатура и состояние даром.
 * children — прежние строки t(): новых ключей перевода от компонента не появляется (кроме подписи кнопки).
 * block — не значок, а строка «Как это работает» с текстом под ней.
 */
export function Help({ children, label, block = false, className }: { children: ReactNode; label?: string; block?: boolean; className?: string }) {
  const name = label ?? (block ? t("Как это работает") : t("Что это?"));
  return (
    <details className={"help" + (block ? " block" : "") + (className ? " " + className : "")}>
      <summary aria-label={name} title={name}>
        <Icon name="help" />{block && <span>{name}</span>}
      </summary>
      <div className="help-body">{children}</div>
    </details>
  );
}
