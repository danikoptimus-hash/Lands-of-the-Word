import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { t } from "../lib/i18n";

/**
 * Оверлей: лист снизу на телефоне, диалог по центру на широком экране. Один компонент для попапа города,
 * карточки дела, форм. Esc и клик по фону закрывают; прокрутка страницы под ним блокируется. Фон закрывает только
 * когда нажатие началось на нём: протащили ползунок графика за край окна и отпустили — окно остаётся (жалоба владельца 23.10).
 */
export function Sheet({ title, head, onClose, onDismiss, children, size = "md", foot, container, className, closeLabel }: {
  title?: ReactNode; head?: ReactNode; onClose: () => void; children: ReactNode; size?: "sm" | "md" | "lg"; foot?: ReactNode;
  /** Закрытие ведёт назад (например, в список дел): кнопка — стрелка с этой подписью вместо крестика «Закрыть». */ closeLabel?: string;
  /** Нажатие по фону и Esc: если задано, зовётся вместо onClose (лист дела: стрелка ведёт в список, фон — сразу на карту; жалоба участника 31.10). */ onDismiss?: () => void;
  /** Куда монтировать: по умолчанию в body (fixed). Для карты — контейнер карты (absolute). */
  container?: HTMLElement | null; className?: string;
}) {
  const id = useId();
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    document.body.classList.add("no-scroll");
    const dismiss = onDismiss ?? onClose;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.classList.remove("no-scroll"); };
  }, [onClose, onDismiss]);
  const node = (
    <div className={"overlay-backdrop" + (container ? " absolute" : "")} onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }} onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) (onDismiss ?? onClose)(); downOnBackdrop.current = false; }}>
      <div className={`overlay ${size}${className ? " " + className : ""}`} role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        {(title || head) && (
          <div className="overlay-head">
            {head ?? <h2 id={id}>{title}</h2>}
            <button type="button" className="ghost icon sm" onClick={onClose} aria-label={closeLabel ?? t("Закрыть")} title={closeLabel}><Icon name={closeLabel ? "back" : "x"} /></button>
          </div>
        )}
        <div className="overlay-body">{children}</div>
        {foot && <div className="overlay-foot">{foot}</div>}
      </div>
    </div>
  );
  return createPortal(node, container ?? document.body);
}
