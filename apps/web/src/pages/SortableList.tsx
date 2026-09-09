import { useRef, useState, type ReactNode } from "react";

/**
 * Список с перестановкой: тянуть за ручку (палец или мышь) либо кнопки ▲▼.
 * Порядок отдаётся наверх массивом id; сам список ничего не хранит.
 */
export function SortableList({ ids, render, onChange, disabled }: { ids: string[]; render: (id: string, i: number) => ReactNode; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length || from === to) return;
    const next = ids.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it!);
    onChange(next);
  };
  const onPointerDown = (e: React.PointerEvent, id: string) => {
    if (disabled) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragId(id);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragId || !listRef.current) return;
    const rows = Array.from(listRef.current.children) as HTMLElement[];
    const from = ids.indexOf(dragId);
    let to = from;
    rows.forEach((row, i) => {
      const r = row.getBoundingClientRect();
      if (i < from && e.clientY < r.top + r.height / 2) to = Math.min(to, i);
      if (i > from && e.clientY > r.top + r.height / 2) to = Math.max(to, i);
    });
    if (to !== from) move(from, to);
  };
  const onPointerUp = () => setDragId(null);
  return (
    <ul ref={listRef} className={"sortable" + (disabled ? " frozen" : "")}>
      {ids.map((id, i) => (
        <li key={id} className={dragId === id ? "dragging" : undefined}>
          {!disabled && (
            <span className="grip" role="button" aria-label="Перетащить" onPointerDown={(e) => onPointerDown(e, id)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>⋮⋮</span>
          )}
          <div className="body">{render(id, i)}</div>
          {!disabled && (
            <span className="arrows">
              <button type="button" className="ghost sm" aria-label="Выше" disabled={i === 0} onClick={() => move(i, i - 1)}>▲</button>
              <button type="button" className="ghost sm" aria-label="Ниже" disabled={i === ids.length - 1} onClick={() => move(i, i + 1)}>▼</button>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
