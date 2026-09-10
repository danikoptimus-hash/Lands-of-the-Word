import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { t } from "../lib/i18n";

/** Забыли пароль: по никнейму или почте. Восстановление только через почту из учётки. */
export function ForgotPage() {
  const [login, setLogin] = useState("");
  const [done, setDone] = useState<null | { mailEnabled: boolean }>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { setDone(await api<{ ok: boolean; mailEnabled: boolean }>("/api/auth/forgot", { method: "POST", body: JSON.stringify({ login }) })); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  return (
    <div className="card auth">
      <h1>{t("Восстановление пароля")}</h1>
      {done ? (
        done.mailEnabled ? (
          <>
            <p>{t("Если у этой учётки указана почта, письмо со ссылкой уже отправлено. Ссылка действует один час.")}</p>
            <p className="muted">{t("Письма нет? Проверьте «Спам». Если почта в учётке не была указана, восстановить пароль нельзя: заведите новую учётку и попросите капитана прислать приглашение в команду.")}</p>
          </>
        ) : (
          <p className="note warn">{t("Отправка писем на сервере пока не настроена, восстановить пароль сейчас нельзя. Обратитесь к владельцу платформы.")}</p>
        )
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="login">{t("Никнейм или почта")}</label>
          <input id="login" value={login} onChange={(e) => setLogin(e.target.value)} required minLength={3} autoFocus autoComplete="username" />
          <p className="hint">{t("Ссылка для нового пароля придёт на почту из настроек аккаунта. Без указанной почты восстановить пароль нельзя.")}</p>
          {error && <p className="error">{error}</p>}
          <div className="actions"><button type="submit" disabled={busy} style={{ width: "100%" }}>{t("Отправить ссылку")}</button></div>
        </form>
      )}
      <p style={{ marginTop: "1rem" }}><Link to="/login">{t("← Ко входу")}</Link></p>
    </div>
  );
}
