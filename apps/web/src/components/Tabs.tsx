import { Icon } from "./Icon";

export interface TabItem<K extends string> { key: K; label: string; icon?: string; count?: number; hot?: boolean }
/** Сегментированные вкладки: одинаковы на телефоне и компьютере; при stacked на узком экране — иконка над подписью. */
export function Tabs<K extends string>({ items, value, onChange, stacked = false, sticky = false, ariaLabel }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; stacked?: boolean; sticky?: boolean; ariaLabel?: string }) {
  return (
    <div className={"tabs" + (stacked ? " stacked" : "") + (sticky ? " sticky" : "")} role="tablist" aria-label={ariaLabel}>
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
