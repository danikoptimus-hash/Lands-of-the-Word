import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { t } from "../lib/i18n";

/**
 * Оверлей: лист снизу на телефоне, диалог по центру на широком экране. Один компонент для попапа города,
 * карточки дела, форм. Esc и клик по фону закрывают; прокрутка страницы под ним блокируется.
 */
export function Sheet({ title, head, onClose, children, size = "md", foot, container, className }: {
  title?: ReactNode; head?: ReactNode; onClose: () => void; children: ReactNode; size?: "sm" | "md" | "lg"; foot?: ReactNode;
  /** Куда монтировать: по умолчанию в body (fixed). Для карты — контейнер карты (absolute). */
  container?: HTMLElement | null; className?: string;
}) {
  const id = useId();
  useEffect(() => {
    document.body.classList.add("no-scroll");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.classList.remove("no-scroll"); };
  }, [onClose]);
  const node = (
    <div className={"overlay-backdrop" + (container ? " absolute" : "")} onClick={onClose}>
      <div className={`overlay ${size}${className ? " " + className : ""}`} role="dialog" aria-modal="true" aria-labelledby={title ? id : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        {(title || head) && (
          <div className="overlay-head">
            {head ?? <h2 id={id}>{title}</h2>}
            <button type="button" className="ghost icon sm" onClick={onClose} aria-label={t("Закрыть")}><Icon name="x" /></button>
          </div>
        )}
        <div className="overlay-body">{children}</div>
        {foot && <div className="overlay-foot">{foot}</div>}
      </div>
    </div>
  );
  return createPortal(node, container ?? document.body);
}
