import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { t } from "../lib/i18n";

/**
 * Пояснение «за кнопкой» (решение владельца 18.09: инструкции прячутся, состояние остаётся на виду).
 * Решение владельца 04.10, везде одинаково: значок — только знак вопроса в кружке, без белой подложки; по нажатию
 * пояснение всплывает окошком поверх экрана, а не раскрывается в потоке (раскрытие двигало интерфейс).
 * children — прежние строки t(): новых ключей перевода от компонента не появляется (кроме подписи кнопки).
 * block — не значок, а кнопка-строка «Как это работает» с тем же всплывающим окошком.
 * popup — оставлен для совместимости вызовов: теперь всплывают все.
 */
export function Help({ children, label, block = false, className }: { children: ReactNode; label?: string; block?: boolean; popup?: boolean; className?: string }) {
  const name = label ?? (block ? t("Как это работает") : t("Что это?"));
  return <HelpPopup name={name} block={block} className={className}>{children}</HelpPopup>;
}

const POP_W = 320, GAP = 6, EDGE = 8;

/**
 * Всплывающее окошко (поповер) поверх экрана: по умолчанию кнопка — значок «?», а с trigger — любой свой значок
 * (например, значок дел участника у администратора, решение владельца 04.10). Закрывается нажатием мимо, Esc и прокруткой.
 */
export function HelpPopup({ children, name, block = false, className, trigger }: { children: ReactNode; name: string; block?: boolean; className?: string; trigger?: ReactNode }) {
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  // Окошко стоит под значком (над ним, если внизу не хватает места) и не выходит за края экрана.
  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = Math.min(POP_W, window.innerWidth - EDGE * 2);
    const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - width / 2), window.innerWidth - width - EDGE);
    const h = pop.current.offsetHeight;
    const below = r.bottom + GAP, above = r.top - GAP - h;
    const top = below + h <= window.innerHeight - EDGE || above < EDGE ? below : above;
    setPos({ left, top, width });
  }, [open]);

  // Закрывается нажатием мимо, клавишей Esc и любой прокруткой: окошко не должно уезжать от значка.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { const el = e.target as Node; if (!pop.current?.contains(el) && !btn.current?.contains(el)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <span className={"help-pop-wrap" + (block ? " block" : "") + (className ? " " + className : "")}>
      <button ref={btn} type="button" className={(trigger ? "pop-btn" : "help-btn") + (block ? " block" : "") + (open ? " open" : "")} aria-label={name} title={name} aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}>
        {trigger ?? <><Icon name="help" />{block && <span>{name}</span>}</>}
      </button>
      {open && createPortal(
        <div ref={pop} className="help-pop" role="tooltip" style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { left: EDGE, top: EDGE, width: Math.min(POP_W, window.innerWidth - EDGE * 2), visibility: "hidden" }}>
          {children}
        </div>,
        document.body,
      )}
    </span>
  );
}
