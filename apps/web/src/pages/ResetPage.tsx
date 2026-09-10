import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { t } from "../lib/i18n";

/** Новый пароль по ссылке из письма или от администратора. После смены — сразу вход. */
export function ResetPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [info, setInfo] = useState<{ valid: boolean; nickname: string | null } | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ valid: boolean; nickname: string | null }>(`/api/auth/reset/${encodeURIComponent(token)}`).then(setInfo).catch(() => setInfo({ valid: false, nickname: null })); }, [token]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== again) { setError(t("Пароли не совпадают")); return; }
    setBusy(true); setError(null);
    try { await api<{ user: User }>("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) }); await refresh(); navigate("/"); }
    catch (err) { setError(err instanceof ApiError ? (err.issues?.map((i) => i.message).join("; ") || err.message) : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  return (
    <div className="card auth">
      <h1>{t("Новый пароль")}</h1>
      {!info && <p className="muted">{t("Проверяем ссылку…")}</p>}
      {info && !info.valid && <><p className="note bad">{t("Ссылка недействительна или устарела.")}</p><p><Link to="/forgot">{t("Запросить новую")}</Link></p></>}
      {info?.valid && (
        <form onSubmit={submit}>
          <p className="muted">{t("Учётка:")} <strong>{info.nickname}</strong></p>
          <label htmlFor="pw">{t("Новый пароль")}</label>
          <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} autoFocus />
          <label htmlFor="pw2">{t("Ещё раз")}</label>
          <input id="pw2" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required minLength={8} />
          {error && <p className="error">{error}</p>}
          <div className="actions"><button type="submit" disabled={busy} style={{ width: "100%" }}>{t("Сохранить и войти")}</button></div>
        </form>
      )}
    </div>
  );
}
