import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUi } from "../lib/ui";

/** Настройки аккаунта: имя, email, язык, смена пароля. Никнейм не меняется. */
export function AccountPage() {
  const { user, refresh } = useAuth();
  const ui = useUi();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [locale, setLocale] = useState(user?.locale ?? "ru");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  async function saveProfile(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api<{ user: User }>("/api/auth/me", { method: "PATCH", body: JSON.stringify({ displayName, email, locale }) }); await refresh(); ui.notify("Сохранено"); }
    catch (err) { setError(err instanceof ApiError ? (err.issues?.map((i) => i.message).join("; ") || err.message) : "Ошибка сети"); }
    finally { setBusy(false); }
  }
  async function changePassword(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api("/api/auth/password", { method: "POST", body: JSON.stringify({ current, next }) }); setCurrent(""); setNext(""); ui.notify("Пароль изменён"); }
    catch (err) { setError(err instanceof ApiError ? (err.issues?.map((i) => i.message).join("; ") || err.message) : "Ошибка сети"); }
    finally { setBusy(false); }
  }

  return (
    <>
      <p><Link to="/">← Мои игры</Link></p>
      <div className="card auth" style={{ margin: "0 auto" }}>
        <h1>Аккаунт</h1>
        <p className="muted">Никнейм: <strong>{user.nickname}</strong>{user.platformRole === "SUPERADMIN" ? " · суперадмин" : ""}</p>
        <form onSubmit={saveProfile}>
          <label htmlFor="a-name">Отображаемое имя <span className="muted">необязательно</span></label>
          <input id="a-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder="Как вас показывать команде" />
          <label htmlFor="a-email">Email <span className="muted">необязательно: для уведомлений и восстановления пароля</span></label>
          <input id="a-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {!user.email && <p className="hint">Без почты забытый пароль сможет сбросить только администратор игры.</p>}
          <label htmlFor="a-locale">Язык</label>
          <select id="a-locale" value={locale} onChange={(e) => setLocale(e.target.value)}><option value="ru">Русский</option><option value="en">English</option></select>
          {error && <p className="error">{error}</p>}
          <div className="actions"><button type="submit" disabled={busy}>Сохранить</button></div>
        </form>
      </div>
      <div className="card auth" style={{ margin: "1rem auto" }}>
        <h2>Сменить пароль</h2>
        <form onSubmit={changePassword}>
          <label htmlFor="a-cur">Текущий пароль</label>
          <input id="a-cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          <label htmlFor="a-next">Новый пароль <span className="muted">не короче 8 символов</span></label>
          <input id="a-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={8} />
          <div className="actions"><button type="submit" className="secondary" disabled={busy}>Изменить пароль</button></div>
        </form>
      </div>
    </>
  );
}
