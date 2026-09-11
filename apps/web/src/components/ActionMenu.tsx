import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { t } from "../lib/i18n";

export interface MenuItem { label: string; icon?: string; onSelect: () => void; danger?: boolean; sep?: boolean }
/** Меню «⋯»: одно видимое действие в строке, остальные здесь. trigger — своя кнопка (по умолчанию иконка more). */
export function ActionMenu({ items, trigger, align = "right", label }: { items: MenuItem[]; trigger?: ReactNode; align?: "left" | "right"; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc); window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <span onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        {trigger ?? <button type="button" className="ghost icon sm" aria-label={label ?? t("Ещё")}><Icon name="more" /></button>}
      </span>
      {open && (
        <div className={"menu" + (align === "left" ? " left" : "")} role="menu">
          {items.map((it, i) => (
            <div key={i}>
              {it.sep && <div className="sep" />}
              <button type="button" role="menuitem" className={it.danger ? "danger" : ""} onClick={() => { setOpen(false); it.onSelect(); }}>{it.icon && <Icon name={it.icon} />}{it.label}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
