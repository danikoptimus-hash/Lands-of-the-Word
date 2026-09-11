import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { t } from "../lib/i18n";
import { Back } from "../components/Back";
import { LoadingState } from "../components/State";
import { GuestShell, errorText } from "./LoginPage";

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

  useEffect(() => {
    api<{ valid: boolean; nickname: string | null }>(`/api/auth/reset/${encodeURIComponent(token)}`).then(setInfo).catch(() => setInfo({ valid: false, nickname: null }));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== again) { setError(t("Пароли не совпадают")); return; }
    setBusy(true); setError(null);
    try { await api<{ user: User }>("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) }); await refresh(); navigate("/"); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  return (
    <GuestShell title={t("Новый пароль")} back={<Back to="/login" label={t("Ко входу")} />}>
      {!info && <LoadingState rows={3} />}
      {info && !info.valid && (
        <>
          <p className="note bad" role="alert">{t("Ссылка недействительна или устарела.")}</p>
          <div className="actions"><Link to="/forgot" className="btn block">{t("Запросить новую")}</Link></div>
        </>
      )}
      {info?.valid && (
        <form onSubmit={submit}>
          {info.nickname && <p className="muted">{t("Аккаунт")} · <strong>{info.nickname}</strong></p>}
          <label htmlFor="pw">{t("Новый пароль")} <span className="opt">· {t("не короче 8 символов")}</span></label>
          <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} autoFocus />
          <label htmlFor="pw2">{t("Повторите пароль")}</label>
          <input id="pw2" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required minLength={8} />
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions"><button type="submit" className="block" disabled={busy}>{t("Сохранить и войти")}</button></div>
        </form>
      )}
    </GuestShell>
  );
}
