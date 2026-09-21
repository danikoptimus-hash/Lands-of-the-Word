import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { LoadingState } from "../components/State";
import { GuestShell, errorText } from "./LoginPage";

/**
 * Последний шаг входа через Google для новой учётки: почта уже подтверждена Google, осталось выбрать никнейм.
 * Почту берём из короткоживущей cookie на сервере; если её нет (устарела или вход не начат) — обратно ко входу.
 */
export function GoogleNicknamePage() {
  const navigate = useNavigate();
  const { refresh, locale } = useAuth();
  const [email, setEmail] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ email: string }>("/api/auth/google/pending")
      .then((r) => { if (alive) setEmail(r.email); })
      .catch((e) => { if (!alive) return; if (e instanceof ApiError && e.status === 404) navigate("/login?google=error", { replace: true }); else setError(errorText(e)); });
    return () => { alive = false; };
  }, [navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api<{ user: User }>("/api/auth/google/complete", { method: "POST", body: JSON.stringify({ nickname, locale }) });
      await refresh();
      navigate("/");
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  return (
    <GuestShell title={t("Почти готово")} back={<Link to="/login" className="btn ghost sm"><Icon name="back" />{t("Ко входу")}</Link>}>
      {email === null && !error && <LoadingState rows={2} />}
      {email !== null && (
        <form onSubmit={submit}>
          <p className="note ok"><Icon name="check" />{t("Почта подтверждена Google:")} <strong>{email}</strong></p>
          <p className="hint">{t("Из Google мы храним только почту: имя и фото не запрашиваем.")}</p>
          <label htmlFor="g-nick">{t("Никнейм")} <span className="opt">· {t("3–24 символа: буквы, цифры, _ и -")}</span></label>
          <input id="g-nick" value={nickname} onChange={(e) => setNickname(e.target.value)} autoComplete="username" required minLength={3} maxLength={24} autoFocus />
          <p className="hint">{t("Никнейм видят другие игроки, потом его не изменить.")}</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions"><button type="submit" className="block" disabled={busy}>{t("Создать аккаунт")}</button></div>
        </form>
      )}
      {email === null && error && <p className="error" role="alert">{error}</p>}
    </GuestShell>
  );
}
