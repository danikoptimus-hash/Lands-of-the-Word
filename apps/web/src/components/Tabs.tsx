import { useEffect, useRef, useState, type RefObject } from "react";
import { Icon } from "./Icon";

export interface TabItem<K extends string> { key: K; label: string; icon?: string; count?: number; hot?: boolean }

/** Минимальный сдвиг пальца для переключения вкладки. */
const SWIPE_MIN = 48;
/** Свайп не трогает поля ввода, холсты карты и графиков и то, что само листается вбок (строка значков, чипы команд). */
function swipeBlocked(target: HTMLElement, area: HTMLElement): boolean {
  for (let el: HTMLElement | null = target; el && el !== area; el = el.parentElement) {
    if (/^(INPUT|TEXTAREA|SELECT|CANVAS|SVG)$/i.test(el.tagName) || el.closest(".map-area, .hex-map")) return true;
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

/**
 * Переключение вкладок свайпом (решение владельца 30.10: «везде, где есть табы, между ними можно переключаться свайпом»):
 * сдвиг пальца влево по области вкладок — следующая, вправо — предыдущая, у крайних ничего. Горизонтальный свайп внутри
 * области дальше не идёт (панель раздела от него не закрывается). Только касания: мышь не участвует.
 */
export function useSwipeTabs<K extends string>(area: HTMLElement | null, keys: readonly K[], value: K, onChange: (k: K) => void): void {
  const latest = useRef({ keys, value, onChange });
  latest.current = { keys, value, onChange };
  useEffect(() => {
    if (!area) return;
    let start: { x: number; y: number; ok: boolean } | null = null;
    const onStart = (e: TouchEvent) => {
      const tp = e.touches[0]; if (!tp) return;
      start = { x: tp.clientX, y: tp.clientY, ok: !(e.target instanceof HTMLElement) || !swipeBlocked(e.target, area) };
    };
    const onEnd = (e: TouchEvent) => {
      const st = start; start = null;
      const tp = e.changedTouches[0]; if (!st || !st.ok || !tp) return;
      const dx = tp.clientX - st.x, dy = tp.clientY - st.y;
      // Без ограничения по времени: на слабом телефоне карта рисуется медленно и жест растягивается.
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      e.stopPropagation();
      const { keys, value, onChange } = latest.current;
      const i = keys.indexOf(value), j = dx < 0 ? i + 1 : i - 1;
      if (i >= 0 && j >= 0 && j < keys.length) onChange(keys[j]!);
    };
    area.addEventListener("touchstart", onStart, { passive: true });
    area.addEventListener("touchend", onEnd, { passive: true });
    return () => { area.removeEventListener("touchstart", onStart); area.removeEventListener("touchend", onEnd); };
  }, [area]);
}

/**
 * Сегментированные вкладки: одинаковы на телефоне и компьютере; при stacked на узком экране — иконка над подписью.
 * Свайп по области вкладок переключает их: по умолчанию область — родитель полосы вкладок (в нём же лежит содержимое);
 * `swipeArea` задаёт другую область, `swipe={false}` отключает (вкладки шага у графиков: по холсту водят пальцем).
 */
export function Tabs<K extends string>({ items, value, onChange, stacked = false, sticky = false, ariaLabel, swipe = true, swipeArea }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; stacked?: boolean; sticky?: boolean; ariaLabel?: string; swipe?: boolean; swipeArea?: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<HTMLElement | null>(null);
  useEffect(() => { setArea(swipe ? swipeArea?.current ?? ref.current?.parentElement ?? null : null); }, [swipe, swipeArea]);
  useSwipeTabs(area, items.map((it) => it.key), value, onChange);
  return (
    <div ref={ref} className={"tabs" + (stacked ? " stacked" : "") + (sticky ? " sticky" : "")} role="tablist" aria-label={ariaLabel}>
      {items.map((it) => (
        <button key={it.key} type="button" role="tab" aria-selected={value === it.key} className={value === it.key ? "active" : ""} onClick={() => onChange(it.key)}>
          {it.icon && <Icon name={it.icon} />}
          <span>{it.label}</span>
          {it.count != null && it.count > 0 && <span className={"count-chip" + (it.hot ? " hot" : "")}>{it.count}</span>}
        </button>
      ))}
    </div>
  );
}
