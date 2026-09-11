import { useState } from "react";
import { Icon } from "./Icon";
import { t } from "../lib/i18n";
import { useUi } from "../lib/ui";

/** Поле только для чтения с кнопкой «Скопировать» → «Скопировано» и тостом. */
export function CopyField({ value, label }: { value: string; label?: string }) {
  const { notify } = useUi();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); notify(t("Скопировано")); setTimeout(() => setCopied(false), 1500); }
    catch { notify(t("Не удалось скопировать: выделите текст вручную"), "bad"); }
  }
  return (
    <div className="copy-field">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="secondary sm" onClick={() => void copy()}><Icon name={copied ? "check" : "copy"} />{copied ? t("Скопировано") : t("Скопировать")}</button>
    </div>
  );
}
