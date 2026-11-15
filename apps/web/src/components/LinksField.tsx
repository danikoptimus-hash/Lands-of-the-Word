import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icon";
import { HelpPopup } from "./Help";
import { t } from "../lib/i18n";

/**
 * Ссылки к делу — одна кнопка (решение владельца 16.10: список под кнопкой «перескакивал», всё в одной кнопке).
 * Пока ссылок нет — «Вставить ссылку»: по нажатию ссылка берётся из буфера обмена (решение владельца 13.10, поля
 * ввода нет). Когда ссылка вставлена — на кнопке галочка в цвете стиля и «Ссылка вставлена» (или «Ссылок: N»);
 * по нажатию над содержимым всплывает окошко со ссылками: каждую можно открыть и убрать, там же «Вставить ещё».
 * Если в буфере не ссылка — рядом с кнопкой красный значок с пояснением по нажатию (как у знака вопроса).
 * Запасной путь (15.10, встроенный браузер Xiaomi без чтения буфера): строка, куда ссылку вставляет клавиатура.
 * Принимаются только адреса с http:// или https://.
 * square — квадратная кнопка со значком ссылки вместо подписи и широкой кнопки (решение владельца 15.11 для формы сдачи
 * дела). Обязательная ссылка помечена красной звёздочкой над правым верхним углом кнопки, по нажатию на неё — объяснение;
 * необязательная — обычным «?». Сколько ссылок вставлено — число в углу; список, ошибка и запасная строка — окошком под кнопкой.
 */
export function LinksField({ label, mark, links, onChange, square }: { label: string; /** Пометка у подписи, например «обязательно». */ mark?: ReactNode; links: string[]; onChange: (links: string[]) => void; square?: { help: string; required?: boolean } }) {
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v);
  const push = (v: string) => { if (!links.includes(v)) onChange([...links, v]); setError(""); setDraft(""); setManual(false); };
  const paste = async () => {
    let text: string | null = null;
    try { text = (await navigator.clipboard.readText()).trim(); } catch { text = null; }
    if (text === null) { setError(""); setManual(true); setOpen(false); return; }
    if (!isUrl(text)) { setError(t("В буфере обмена нет ссылки: скопируйте её и нажмите ещё раз")); return; }
    push(text);
  };
  const add = () => { const v = draft.trim(); if (!isUrl(v)) { setError(t("Ссылка должна начинаться с https://")); return; } push(v); };
  const key = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
  // Окошко закрывается нажатием мимо и Esc.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", esc); };
  }, [open]);
  useEffect(() => { if (links.length === 0) setOpen(false); }, [links.length]);
  // В квадратном режиме пояснение «в буфере нет ссылки» — окошко под кнопкой: гаснет нажатием мимо.
  useEffect(() => {
    if (!square || !error || manual) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node)) setError(""); };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [square, error, manual]);
  const has = links.length > 0;
  if (square) {
    return (
      <div ref={root} className="links-field sq">
        <span className="sq-act">
          <button type="button" className={"secondary sq-btn" + (has ? " on" : "")} aria-label={has ? (links.length === 1 ? t("Ссылка вставлена") : t("Ссылок: {n}", { n: links.length })) : label} title={label} aria-expanded={has ? open : undefined} onClick={() => (has ? setOpen((v) => !v) : void paste())}>
            <Icon name={has ? "check" : "link"} />{links.length > 1 && <span className="count-chip">{links.length}</span>}
          </button>
          {square.required
            ? <HelpPopup name={t("Обязательно")} className="sq-help req-star" trigger={<span aria-hidden="true">*</span>}><p><b>{label}.</b> {square.help}</p></HelpPopup>
            : <HelpPopup name={label} className="sq-help"><p><b>{label}.</b> {square.help}</p></HelpPopup>}
        </span>
        {error && !has && !manual && <div className="link-pop link-err" role="alert"><Icon name="alert" /><span>{error}</span></div>}
        {open && has && (
          <div className="link-pop">
            <ul className="link-list">
              {links.map((l) => (
                <li key={l}><Icon name="link" /><a className="link-text" href={l} target="_blank" rel="noreferrer">{l.replace(/^https?:\/\//i, "")}</a><button type="button" className="secondary sm icon" aria-label={t("Убрать ссылку")} title={t("Убрать ссылку")} onClick={() => onChange(links.filter((x) => x !== l))}><Icon name="x" /></button></li>
              ))}
            </ul>
            <div className="link-pop-foot">
              <button type="button" className="secondary sm" onClick={() => void paste()}><Icon name="link" />{t("Вставить ещё")}</button>
              {error && <HelpPopup name={t("Почему не вставилось")} className="link-warn" trigger={<Icon name="alert" />}>{error}</HelpPopup>}
            </div>
          </div>
        )}
        {manual && (
          <div className="link-pop link-manual">
            <p className="hint">{t("Этот браузер не даёт прочитать буфер обмена. Вставьте ссылку сюда:")}</p>
            <div className="link-add">
              <input type="url" inputMode="url" autoComplete="off" placeholder="https://…" value={draft} onChange={(e) => { setDraft(e.target.value); setError(""); }} onKeyDown={key} autoFocus />
              <button type="button" className="sm" onClick={add} disabled={!draft.trim()}><Icon name="check" />{t("Добавить")}</button>
            </div>
            {error && <p className="error small" role="alert">{error}</p>}
          </div>
        )}
      </div>
    );
  }
  return (
    <div ref={root} className="field links-field">
      <span className="label">{label}{mark && <> {mark}</>}</span>
      <div className="link-add-row">
        <button type="button" className={"secondary sm link-add-btn" + (has ? " has-links" : "")} aria-expanded={has ? open : undefined} onClick={() => (has ? setOpen((v) => !v) : void paste())}>
          <Icon name={has ? "check" : "link"} />{has ? (links.length === 1 ? t("Ссылка вставлена") : t("Ссылок: {n}", { n: links.length })) : t("Вставить ссылку")}
        </button>
        {error && !has && <HelpPopup name={t("Почему не вставилось")} className="link-warn" trigger={<Icon name="alert" />}>{error}</HelpPopup>}
      </div>
      {open && has && (
        <div className="link-pop">
          <ul className="link-list">
            {links.map((l) => (
              <li key={l}><Icon name="link" /><a className="link-text" href={l} target="_blank" rel="noreferrer">{l.replace(/^https?:\/\//i, "")}</a><button type="button" className="secondary sm icon" aria-label={t("Убрать ссылку")} title={t("Убрать ссылку")} onClick={() => onChange(links.filter((x) => x !== l))}><Icon name="x" /></button></li>
            ))}
          </ul>
          <div className="link-pop-foot">
            <button type="button" className="secondary sm" onClick={() => void paste()}><Icon name="link" />{t("Вставить ещё")}</button>
            {error && <HelpPopup name={t("Почему не вставилось")} className="link-warn" trigger={<Icon name="alert" />}>{error}</HelpPopup>}
          </div>
        </div>
      )}
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
