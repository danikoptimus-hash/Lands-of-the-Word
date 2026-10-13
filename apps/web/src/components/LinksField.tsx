import { useState } from "react";
import { Icon } from "./Icon";
import { HelpPopup } from "./Help";
import { t } from "../lib/i18n";

/**
 * Ссылки к делу (решение владельца 13.10): вместо поля ввода — список добавленных ссылок и кнопка «Вставить ссылку».
 * По нажатию ссылка берётся из буфера обмена; поля для ручного ввода нет (владелец: «убрать поле ввода ссылки вообще»).
 * Если в буфере не ссылка или браузер не дал его прочитать — рядом с кнопкой красный значок; текст всплывает
 * по нажатию на него, как у знака вопроса (решение владельца 13.10).
 * Принимаются только адреса с http:// или https://.
 */
export function LinksField({ label, links, onChange }: { label: string; links: string[]; onChange: (links: string[]) => void }) {
  const [error, setError] = useState("");
  const paste = async () => {
    let text: string | null = null;
    try { text = (await navigator.clipboard.readText()).trim(); } catch { text = null; }
    if (text === null) { setError(t("Браузер не дал прочитать буфер обмена: разрешите доступ и нажмите ещё раз")); return; }
    if (!/^https?:\/\/\S+$/i.test(text)) { setError(t("В буфере обмена нет ссылки: скопируйте её и нажмите ещё раз")); return; }
    setError("");
    if (!links.includes(text)) onChange([...links, text]);
  };
  return (
    <div className="field links-field">
      <span className="label">{label}</span>
      {links.length > 0 && (
        <ul className="link-list">
          {links.map((l) => (
            <li key={l}><Icon name="link" /><span className="link-text">{l.replace(/^https?:\/\//i, "")}</span><button type="button" className="secondary sm icon" aria-label={t("Убрать ссылку")} title={t("Убрать ссылку")} onClick={() => onChange(links.filter((x) => x !== l))}><Icon name="x" /></button></li>
          ))}
        </ul>
      )}
      <div className="link-add-row">
        <button type="button" className="secondary sm link-add-btn" onClick={() => void paste()}><Icon name="link" />{t("Вставить ссылку")}</button>
        {error && <HelpPopup name={t("Почему не вставилось")} className="link-warn" trigger={<Icon name="alert" />}>{error}</HelpPopup>}
      </div>
    </div>
  );
}
