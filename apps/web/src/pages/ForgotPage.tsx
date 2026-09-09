import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";

/** Забыли пароль: по никнейму или почте. Если почта не настроена на сервере — путь через админа игры. */
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
            <p className="muted">Письма нет? Проверьте «Спам». Если почта в учётке не указана, попросите администратора вашей игры: он может выдать ссылку для сброса пароля.</p>
          </>
        ) : (
          <p className="note warn">Отправка писем на сервере пока не настроена. Попросите администратора вашей игры выдать ссылку для сброса пароля: это делается на странице игры, в списке участников команды.</p>
        )
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="login">Никнейм или почта</label>
          <input id="login" value={login} onChange={(e) => setLogin(e.target.value)} required minLength={3} autoFocus autoComplete="username" />
          <p className="hint">Ссылка для нового пароля придёт на почту из настроек аккаунта. Если почта не указана, пароль сбрасывает администратор игры.</p>
          {error && <p className="error">{error}</p>}
          <div className="actions"><button type="submit" disabled={busy} style={{ width: "100%" }}>Отправить ссылку</button></div>
        </form>
      )}
      <p style={{ marginTop: "1rem" }}><Link to="/login">← Ко входу</Link></p>
    </div>
  );
}
