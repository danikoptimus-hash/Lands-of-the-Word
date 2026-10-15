import { useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import { HelpPopup } from "./Help";
import { t } from "../lib/i18n";

/**
 * Ссылки к делу (решение владельца 13.10): вместо поля ввода — список добавленных ссылок и кнопка «Вставить ссылку».
 * По нажатию ссылка берётся из буфера обмена; поля для ручного ввода по умолчанию нет (владелец: «убрать поле ввода
 * ссылки вообще»). Если в буфере не ссылка — рядом с кнопкой красный значок; текст всплывает по нажатию на него,
 * как у знака вопроса (решение владельца 13.10). Когда хотя бы одна ссылка уже вставлена, значок не показывается.
 * Запасной путь (15.10, Redmi A5 со встроенным браузером Xiaomi): если браузер вообще не даёт прочитать буфер,
 * под кнопкой открывается одна строка, куда ссылку вставляет клавиатура; ссылка добавляется по «Добавить» или Enter.
 * Принимаются только адреса с http:// или https://.
 */
export function LinksField({ label, links, onChange }: { label: string; links: string[]; onChange: (links: string[]) => void }) {
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState("");
  const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);
  const push = (v: string) => { if (!links.includes(v)) onChange([...links, v]); setError(""); setDraft(""); setManual(false); };
  const paste = async () => {
    let text: string | null = null;
    try { text = (await navigator.clipboard.readText()).trim(); } catch { text = null; }
    if (text === null) { setError(""); setManual(true); return; }
    if (!isUrl(text)) { setError(t("В буфере обмена нет ссылки: скопируйте её и нажмите ещё раз")); return; }
    push(text);
  };
  const add = () => { const v = draft.trim(); if (!isUrl(v)) { setError(t("Ссылка должна начинаться с https://")); return; } push(v); };
  const key = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
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
        {error && links.length === 0 && <HelpPopup name={t("Почему не вставилось")} className="link-warn" trigger={<Icon name="alert" />}>{error}</HelpPopup>}
      </div>
      {manual && (
        <div className="link-manual">
          <p className="hint">{t("Этот браузер не даёт прочитать буфер обмена. Вставьте ссылку сюда:")}</p>
          <div className="link-add">
            <input type="url" inputMode="url" autoComplete="off" placeholder="https://…" value={draft} onChange={(e) => { setDraft(e.target.value); setError(""); }} onKeyDown={key} autoFocus />
            <button type="button" className="sm" onClick={add} disabled={!draft.trim()}><Icon name="check" />{t("Добавить")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
