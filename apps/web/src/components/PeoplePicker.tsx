import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/**
 * Выбор участников раскрывающимся списком (решение владельца 16.10: ряд кнопок-чипов занимал много места).
 * Снаружи — строка как у поля ввода: выбранные имена или «никого», стрелка. По нажатию под строкой раскрывается
 * список с галочками; закрывается той же стрелкой, нажатием мимо или Esc (владелец: лишних кнопок не надо). Выбор сохраняется сразу.
 */
export function PeoplePicker({ id, people, value, onChange, empty }: { id: string; people: Array<{ id: string; name: string }>; value: string[]; onChange: (ids: string[]) => void; /** Подпись, когда никто не выбран. */ empty: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key); };
  }, [open]);
  const chosen = people.filter((p) => value.includes(p.id)).map((p) => p.name);
  return (
    <div ref={root} className={"people-picker" + (open ? " open" : "")}>
      <button id={id} type="button" className="pp-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={"pp-value" + (chosen.length ? "" : " muted")}>{chosen.length ? chosen.join(", ") : empty}</span>
        {chosen.length > 0 && <span className="count-chip">{chosen.length}</span>}
        <Icon name="chevron-down" className="chev" />
      </button>
      {open && (
        <div className="pp-list" role="listbox" aria-multiselectable="true">
          {people.map((p) => {
            const on = value.includes(p.id);
            return (
              <label key={p.id} className="check pp-item" role="option" aria-selected={on}>
                <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))} />
                <span>{p.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
