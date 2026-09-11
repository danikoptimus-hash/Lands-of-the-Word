import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { Back } from "../components/Back";
import { Icon } from "../components/Icon";
import { GuestShell, errorText } from "./LoginPage";

/** Забыли пароль: по никнейму или почте. Ссылка приходит только на почту, указанную в аккаунте. */
export function ForgotPage() {
  const [login, setLogin] = useState("");
  const [done, setDone] = useState<null | { mailEnabled: boolean }>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { setDone(await api<{ ok: boolean; mailEnabled: boolean }>("/api/auth/forgot", { method: "POST", body: JSON.stringify({ login }) })); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  const sent = done?.mailEnabled === true;
  return (
    <GuestShell title={sent ? t("Письмо отправлено") : t("Восстановление пароля")} back={<Back to="/login" label={t("Ко входу")} />}>
      {done ? (
        sent ? (
          <div className="stack">
            <p>{t("Ссылка действует час. Не пришло — проверьте «Спам».")}</p>
            <details className="disclosure">
              <summary><Icon name="chevron-down" />{t("Почты в аккаунте не было?")}</summary>
              <p className="muted small">{t("Создайте новый аккаунт и попросите капитана прислать приглашение в команду.")}</p>
            </details>
            <div className="actions"><Link to="/login" className="btn block">{t("Ко входу")}</Link></div>
          </div>
        ) : (
          <p className="note warn" role="alert">{t("Отправка писем на сервере пока не настроена, восстановить пароль сейчас нельзя. Обратитесь к администратору игры.")}</p>
        )
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="login">{t("Никнейм или почта")}</label>
          <input id="login" value={login} onChange={(e) => setLogin(e.target.value)} required minLength={3} autoFocus autoComplete="username" />
          <p className="hint">{t("Пришлём ссылку на почту, указанную в аккаунте.")}</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions"><button type="submit" className="block" disabled={busy}>{t("Отправить ссылку")}</button></div>
        </form>
      )}
    </GuestShell>
  );
}
