import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

export function LoginPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === "login") await login(nickname, password);
      else await register(nickname, password, email || undefined);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues?.map((i) => i.message).join("; ") || err.message) : "Ошибка сети");
    } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: "2rem auto" }}>
      <h1>{mode === "login" ? "Вход" : "Регистрация"}</h1>
      <form onSubmit={submit}>
        <label htmlFor="nickname">Никнейм</label>
        <input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} autoComplete="username" required minLength={3} maxLength={24} />
        <label htmlFor="password">Пароль</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
        {mode === "register" && (
          <>
            <label htmlFor="email">Email (необязательно, для уведомлений и восстановления пароля)</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ marginTop: "1rem" }}>
          <button type="submit" disabled={busy}>{mode === "login" ? "Войти" : "Создать учётку"}</button>
          <button type="button" className="secondary" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Нет учётки? Зарегистрироваться" : "Уже есть учётка? Войти"}
          </button>
        </div>
      </form>
    </div>
  );
}
