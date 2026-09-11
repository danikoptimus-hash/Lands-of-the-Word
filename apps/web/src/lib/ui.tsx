import { t } from "./i18n";
import { Icon } from "../components/Icon";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ConfirmOptions { title?: string; okLabel?: string; cancelLabel?: string; danger?: boolean }
export type ToastKind = "ok" | "bad" | "info";
interface UiApi {
  /** Подтверждение: заголовок-вопрос, одна строка последствий, кнопка-глагол. Возвращает true, если подтвердили. */
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  /** Тост внизу экрана: ok — сделано, bad — ошибка, info — новость. */
  notify: (text: string, kind?: ToastKind) => void;
}

const Ctx = createContext<UiApi | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<{ message: string; options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; kind: ToastKind }>>([]);
  const seq = useRef(0);
  const okRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((message: string, options: ConfirmOptions = {}) => new Promise<boolean>((resolve) => setDialog({ message, options, resolve })), []);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);
  const notify = useCallback((text: string, kind: ToastKind = "ok") => {
    const id = ++seq.current;
    setToasts((list) => [...list.slice(-2), { id, text, kind }]);
    setTimeout(() => dismiss(id), Math.min(9000, 3000 + text.length * 40));
  }, [dismiss]);
  const close = (v: boolean) => { dialog?.resolve(v); setDialog(null); };

  useEffect(() => {
    if (!dialog) return;
    const prev = document.activeElement as HTMLElement | null;
    okRef.current?.focus();
    document.body.classList.add("no-scroll");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.classList.remove("no-scroll"); prev?.focus?.(); };
  }, [dialog]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider value={{ confirm, notify }}>
      {children}
      {dialog && (
        <div className="modal-backdrop" onClick={() => close(false)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text" onClick={(e) => e.stopPropagation()}>
            <h2 id="confirm-title">{dialog.options.title ?? t("Подтвердите")}</h2>
            <p id="confirm-text">{dialog.message}</p>
            <div className="actions end">
              <button className="secondary" onClick={() => close(false)}>{dialog.options.cancelLabel ?? t("Отмена")}</button>
              <button ref={okRef} className={dialog.options.danger ? "danger" : ""} onClick={() => close(true)}>{dialog.options.okLabel ?? t("Да")}</button>
            </div>
          </div>
        </div>
      )}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={"toast " + x.kind} onClick={() => dismiss(x.id)}>
            <Icon name={x.kind === "bad" ? "alert" : x.kind === "ok" ? "check" : "info"} />
            <span>{x.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useUi(): UiApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUi outside UiProvider");
  return v;
}
