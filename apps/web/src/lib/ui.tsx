import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ConfirmOptions { title?: string; okLabel?: string; cancelLabel?: string; danger?: boolean }
interface UiApi {
  /** Модальное подтверждение внутри сайта. Возвращает true, если нажали «ОК». */
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  /** Короткое уведомление внизу экрана. */
  notify: (text: string, kind?: "ok" | "bad") => void;
}

const Ctx = createContext<UiApi | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<{ message: string; options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; kind: "ok" | "bad" }>>([]);
  const seq = useRef(0);
  const okRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((message: string, options: ConfirmOptions = {}) => new Promise<boolean>((resolve) => setDialog({ message, options, resolve })), []);
  const notify = useCallback((text: string, kind: "ok" | "bad" = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  const close = (v: boolean) => { dialog?.resolve(v); setDialog(null); };

  useEffect(() => {
    if (!dialog) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider value={{ confirm, notify }}>
      {children}
      {dialog && (
        <div className="modal-backdrop" onClick={() => close(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {dialog.options.title && <h2>{dialog.options.title}</h2>}
            <p>{dialog.message}</p>
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button className="secondary" onClick={() => close(false)}>{dialog.options.cancelLabel ?? "Отмена"}</button>
              <button ref={okRef} className={dialog.options.danger ? "danger" : ""} onClick={() => close(true)}>{dialog.options.okLabel ?? "Да"}</button>
            </div>
          </div>
        </div>
      )}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={"toast " + t.kind}>{t.text}</div>)}</div>
    </Ctx.Provider>
  );
}

export function useUi(): UiApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUi outside UiProvider");
  return v;
}
