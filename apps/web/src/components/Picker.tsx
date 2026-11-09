import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { t } from "../lib/i18n";

export interface PickerOption { value: string; label: string; /** Серая приписка справа (например, число слов в книге). */ hint?: string }

const GAP = 6, EDGE = 8, MAX_H = 320;

/**
 * Выпадающий список в стиле игры вместо системного <select> (просьба участника 08.11: «сделать выпадающие списки
 * интегрированными в игру, а не системными»). Кнопка выглядит как поле ввода, список — пергаментное окошко поверх экрана
 * (портал, как у подсказки «?»): не режется листами с прокруткой, на телефоне не открывает системное колесо.
 * Клавиатура: стрелки — по пунктам, Enter — выбрать, Esc — закрыть; нажатие мимо и прокрутка закрывают.
 */
export function Picker({ id, value, options, onChange, placeholder, disabled, className, ariaLabel }: {
  id?: string; value: string; options: PickerOption[]; onChange: (value: string) => void;
  /** Пункт «ничего не выбрано» (значение ""): показывается первым и выбирается как обычный. */ placeholder?: string;
  disabled?: boolean; className?: string; ariaLabel?: string;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const all: PickerOption[] = placeholder !== undefined ? [{ value: "", label: placeholder }, ...options] : options;
  const current = all.find((o) => o.value === value);
  const [cursor, setCursor] = useState(0);

  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = Math.max(r.width, Math.min(280, window.innerWidth - EDGE * 2));
    const left = Math.min(Math.max(EDGE, r.left), window.innerWidth - width - EDGE);
    const h = pop.current.offsetHeight;
    const below = r.bottom + GAP, up = below + h > window.innerHeight - EDGE && r.top - GAP - h >= EDGE;
    setPos({ left, top: up ? r.top - GAP - h : below, width, up });
    // Выбранный пункт — в поле зрения списка.
    const sel = pop.current.querySelector<HTMLElement>("[aria-selected=true]");
    if (sel) sel.scrollIntoView({ block: "nearest" });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { const el = e.target as Node; if (!pop.current?.contains(el) && !btn.current?.contains(el)) setOpen(false); };
    const close = () => setOpen(false);
    const onScroll = (e: Event) => { if (pop.current?.contains(e.target as Node)) return; close(); };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", close); };
  }, [open]);

  const toggle = () => { if (disabled) return; setCursor(Math.max(0, all.findIndex((o) => o.value === value))); setOpen((v) => !v); };
  const pick = (v: string) => { setOpen(false); if (v !== value) onChange(v); btn.current?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { if (open) { e.preventDefault(); setOpen(false); } return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { toggle(); return; }
      setCursor((c) => Math.min(all.length - 1, Math.max(0, c + (e.key === "ArrowDown" ? 1 : -1))));
    } else if ((e.key === "Enter" || e.key === " ") && open) { e.preventDefault(); const o = all[cursor]; if (o) pick(o.value); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
  };
  useEffect(() => { if (!open || !pop.current) return; pop.current.querySelectorAll<HTMLElement>("[role=option]")[cursor]?.scrollIntoView({ block: "nearest" }); }, [cursor, open]);

  const listId = (id ?? "picker") + "-list";
  return (
    <>
      <button ref={btn} id={id} type="button" className={"picker" + (open ? " open" : "") + (!current || current.value === "" ? " empty" : "") + (className ? " " + className : "")}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={ariaLabel} disabled={disabled} onClick={toggle} onKeyDown={onKey}>
        <span className="picker-text">{current?.label ?? placeholder ?? t("Выберите…")}</span>
        {current?.hint && <span className="picker-hint">{current.hint}</span>}
        <Icon name="chevron-down" className="picker-chev" />
      </button>
      {open && createPortal(
        <div ref={pop} id={listId} className={"picker-pop" + (pos?.up ? " up" : "")} role="listbox" aria-activedescendant={all[cursor] ? `${listId}-${cursor}` : undefined}
          style={pos ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: MAX_H } : { left: EDGE, top: EDGE, visibility: "hidden", maxHeight: MAX_H }}>
          {all.map((o, i) => (
            <div key={o.value || "∅"} id={`${listId}-${i}`} role="option" aria-selected={o.value === value} className={"picker-opt" + (o.value === value ? " sel" : "") + (i === cursor ? " cur" : "") + (o.value === "" ? " none" : "")}
              onPointerEnter={() => setCursor(i)} onClick={() => pick(o.value)}>
              <span className="picker-check">{o.value === value && o.value !== "" && <Icon name="check" />}</span>
              <span className="picker-label">{o.label}</span>
              {o.hint && <span className="picker-hint">{o.hint}</span>}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
