import { useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import { t } from "../lib/i18n";

/**
 * Ссылки к делу (решение владельца 13.10): вместо поля на несколько строк — список добавленных ссылок и кнопка
 * «Вставить ссылку». По нажатию ссылка берётся из буфера обмена сама; если буфер прочитать нельзя или в нём
 * не ссылка — открывается одна строка ввода, ссылка добавляется по «Добавить» или Enter.
 * Принимаются только адреса с http:// или https://.
 */
export function LinksField({ id, label, links, onChange }: { id: string; label: string; links: string[]; onChange: (links: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);
  const push = (v: string) => { onChange(links.includes(v) ? links : [...links, v]); setDraft(""); setError(""); setOpen(false); };
  const add = () => {
    const v = draft.trim();
    if (!isUrl(v)) { setError(t("Ссылка должна начинаться с https://")); return; }
    push(v);
  };
  /** Сначала буфер обмена: если там ссылка — она добавляется сразу; иначе открывается строка ввода. */
  const paste = async () => {
    let text = "";
    try { text = (await navigator.clipboard.readText()).trim(); } catch { text = ""; }
    if (isUrl(text)) { push(text); return; }
    setOpen(true);
    if (text) setError(t("В буфере обмена нет ссылки — вставьте её в поле"));
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); add(); } else if (e.key === "Escape") { setOpen(false); setDraft(""); setError(""); } };
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
      {open ? (
        <div className="link-add">
          <input id={id} ref={ref} type="url" inputMode="url" autoComplete="off" placeholder="https://…" value={draft} onChange={(e) => { setDraft(e.target.value); setError(""); }} onKeyDown={key} autoFocus />
          <button type="button" className="sm" onClick={add} disabled={!draft.trim()}><Icon name="check" />{t("Добавить")}</button>
          <button type="button" className="secondary sm icon" aria-label={t("Отмена")} title={t("Отмена")} onClick={() => { setOpen(false); setDraft(""); setError(""); }}><Icon name="x" /></button>
        </div>
      ) : (
        <button type="button" className="secondary sm link-add-btn" onClick={() => void paste()}><Icon name="link" />{t("Вставить ссылку")}</button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
