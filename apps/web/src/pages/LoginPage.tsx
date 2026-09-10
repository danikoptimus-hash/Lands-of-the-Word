import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

export function LoginPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === "login") await login(nickname, password);
      else await register(nickname, password, email || undefined);
      navigate(next);
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues?.map((i) => i.message).join("; ") || err.message) : "Ошибка сети");
    } finally { setBusy(false); }
  }

  return (
    <div className="card auth">
      <div className="tabs">
        <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Вход</button>
        <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Регистрация</button>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="nickname">{mode === "login" ? "Никнейм или почта" : "Никнейм"}</label>
        <input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} autoComplete="username" required minLength={3} maxLength={mode === "login" ? 120 : 24} autoFocus />
        <label htmlFor="password">Пароль</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
        {mode === "register" && (
          <>
            <label htmlFor="email">Email <span className="muted">необязательно</span></label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <p className="hint">Нужен для восстановления пароля и уведомлений: без почты забытый пароль восстановить нельзя. Имя и фамилия не требуются.</p>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={busy} style={{ width: "100%" }}>{mode === "login" ? "Войти" : "Создать учётку"}</button>
        </div>
        {mode === "login" && <p style={{ marginTop: ".8rem", textAlign: "center" }}><Link to="/forgot" className="muted">Забыли пароль?</Link></p>}
      </form>
    </div>
  );
}
