import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";

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
    catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
    finally { setBusy(false); }
  }
  return (
    <div className="card auth">
      <h1>Восстановление пароля</h1>
      {done ? (
        done.mailEnabled ? (
          <>
            <p>Если у этой учётки указана почта, письмо со ссылкой уже отправлено. Ссылка действует один час.</p>
            <p className="muted">Письма нет? Проверьте «Спам». Если почта в учётке не была указана, восстановить пароль нельзя: заведите новую учётку и попросите капитана прислать приглашение в команду.</p>
          </>
        ) : (
          <p className="note warn">Отправка писем на сервере пока не настроена, восстановить пароль сейчас нельзя. Обратитесь к владельцу платформы.</p>
        )
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="login">Никнейм или почта</label>
          <input id="login" value={login} onChange={(e) => setLogin(e.target.value)} required minLength={3} autoFocus autoComplete="username" />
          <p className="hint">Ссылка для нового пароля придёт на почту из настроек аккаунта. Без указанной почты восстановить пароль нельзя.</p>
          {error && <p className="error">{error}</p>}
          <div className="actions"><button type="submit" disabled={busy} style={{ width: "100%" }}>Отправить ссылку</button></div>
        </form>
      )}
      <p style={{ marginTop: "1rem" }}><Link to="/login">← Ко входу</Link></p>
    </div>
  );
}
