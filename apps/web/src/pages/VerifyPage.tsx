import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { LoadingState } from "../components/State";
import { GuestShell, errorText } from "./LoginPage";

type Info = { valid: boolean; nickname: string | null; email: string | null };

/** Ссылка из письма: подтверждает почту и входит (если открыли на другом устройстве — без пароля). */
export function VerifyPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [state, setState] = useState<"checking" | "invalid" | "done" | "error">("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const info = await api<Info>(`/api/auth/verify/${encodeURIComponent(token)}`);
        if (!alive) return;
        if (!info.valid) { setState("invalid"); return; }
        await api<{ user: User }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
        await refresh();
        if (alive) setState("done");
      } catch (e) { if (alive) { setError(errorText(e)); setState("error"); } }
    })();
    return () => { alive = false; };
  }, [token, refresh]);

  return (
    <GuestShell title={state === "done" ? t("Почта подтверждена") : t("Подтверждение почты")}>
      {state === "checking" && <LoadingState rows={3} />}
      {state === "invalid" && (
        <>
          <p className="note bad" role="alert"><Icon name="alert" />{t("Ссылка недействительна или устарела.")}</p>
          <p className="muted">{t("Войдите в аккаунт и запросите новое письмо: кнопка «Отправить ещё раз».")}</p>
          <div className="actions"><Link to="/login" className="btn block">{t("Ко входу")}</Link></div>
        </>
      )}
      {state === "error" && <p className="error" role="alert">{error}</p>}
      {state === "done" && (
        <div className="stack">
          <p className="note ok"><Icon name="check" />{t("Готово: почта подтверждена, можно играть.")}</p>
          <div className="actions"><button type="button" className="block" onClick={() => navigate("/")}>{t("К моим играм")}</button></div>
        </div>
      )}
    </GuestShell>
  );
}

/**
 * Заглушка вместо любой закрытой страницы, пока почта не подтверждена: куда ушло письмо, «отправить ещё раз»,
 * смена почты (если ошиблись), выход. Раз в несколько секунд проверяет, не подтвердили ли уже с другого устройства.
 */
export function VerifyPendingPage() {
  const { user, refresh, logout } = useAuth();
  const ui = useUi();
  const [email, setEmail] = useState(user?.email ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 8000);
    const onShow = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onShow); };
  }, [refresh]);

  async function resend() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ ok: boolean; mail: "sent" | "auto" | "none" }>("/api/auth/resend", { method: "POST" });
      if (r.mail === "auto") await refresh();
      else ui.notify(t("Письмо отправлено"));
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  async function changeEmail(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await api<{ user: User; mail: string }>("/api/auth/me", { method: "PATCH", body: JSON.stringify({ email }) });
      await refresh();
      setEditing(false);
      if (r.mail === "sent") ui.notify(t("Письмо отправлено"));
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  return (
    <GuestShell title={t("Подтвердите почту")}>
      <div className="stack">
        <p>{t("Мы отправили письмо со ссылкой на")} <strong>{user?.email}</strong>. {t("Откройте ссылку из письма — и эта страница сама сменится на игру.")}</p>
        <p className="muted small">{t("Не пришло — проверьте «Спам» или отправьте письмо ещё раз. Ссылка действует сутки.")}</p>
        {error && <p className="error" role="alert">{error}</p>}
        {editing ? (
          <form onSubmit={changeEmail}>
            <label htmlFor="v-email">{t("Другая почта")}</label>
            <input id="v-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
            <div className="actions">
              <button type="submit" disabled={busy}>{t("Сохранить и выслать письмо")}</button>
              <button type="button" className="ghost" onClick={() => { setEditing(false); setEmail(user?.email ?? ""); }}>{t("Отмена")}</button>
            </div>
          </form>
        ) : (
          <div className="actions">
            <button type="button" className="block" disabled={busy} onClick={() => void resend()}><Icon name="send" />{t("Отправить ещё раз")}</button>
            <button type="button" className="ghost block" onClick={() => setEditing(true)}><Icon name="edit" />{t("Ошиблись в почте? Изменить")}</button>
            <button type="button" className="ghost block" onClick={() => void logout()}><Icon name="logout" />{t("Выйти")}</button>
          </div>
        )}
      </div>
    </GuestShell>
  );
}
