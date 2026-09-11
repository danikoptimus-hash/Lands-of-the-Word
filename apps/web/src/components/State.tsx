import { Icon } from "./Icon";
import { t } from "../lib/i18n";

/** Состояния блока: загрузка (скелет), пусто (иконка + одна строка), ошибка (текст + «Повторить»). */
export function LoadingState({ rows = 3 }: { rows?: number }) {
  return <div aria-busy="true" className="stack-sm">{Array.from({ length: rows }, (_, i) => <span key={i} className="skeleton" style={{ width: `${88 - i * 14}%` }} />)}</div>;
}
export function EmptyState({ icon = "list", text, action, inline = false }: { icon?: string; text: string; action?: React.ReactNode; inline?: boolean }) {
  return <div className={"state" + (inline ? " inline" : "")}><Icon name={icon} /><span>{text}</span>{action}</div>;
}
export function ErrorState({ text, onRetry }: { text?: string; onRetry?: () => void }) {
  return (
    <div className="state inline" role="alert">
      <Icon name="alert" />
      <span>{text ?? t("Не удалось загрузить")}</span>
      {onRetry && <button type="button" className="ghost sm" onClick={onRetry}>{t("Повторить")}</button>}
    </div>
  );
}
