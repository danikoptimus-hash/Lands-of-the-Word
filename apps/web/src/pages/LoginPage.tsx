import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api, ApiError, type ProvidersDto, type User } from "../lib/api";
import { t, type Locale } from "../lib/i18n";
import { Tabs } from "../components/Tabs";
import { Icon } from "../components/Icon";
import { GoogleMark } from "../components/GoogleMark";

/** Включён ли вход через Google на сервере: спрашиваем один раз, до ответа (и при ошибке) кнопку не показываем. */
let providersCache: Promise<ProvidersDto> | null = null;
export function useProviders(): ProvidersDto | null {
  const [p, setP] = useState<ProvidersDto | null>(null);
  useEffect(() => {
    let alive = true;
    (providersCache ??= api<ProvidersDto>("/api/auth/providers")).then((r) => { if (alive) setP(r); }).catch(() => { providersCache = null; });
    return () => { alive = false; };
  }, []);
  return p;
}

/**
 * Гостевой лэйаут: панорама на фоне, карточка 420px, в верхней строке «назад» (если есть) и переключатель RU/EN,
 * под ним логотип и единственный h1 страницы. Один и тот же для входа, восстановления, нового пароля и приглашения.
 * Для гостя язык запоминается в браузере; для вошедшего (приглашение) — сохраняется в аккаунте.
 */
export function GuestShell({ title, back, children }: { title: string; back?: ReactNode; children: ReactNode }) {
  const { user, locale, setGuestLocale, refresh } = useAuth();
  async function pick(l: Locale) {
    if (l === locale) return;
    setGuestLocale(l);
    if (user) {
      try { await api<{ user: User }>("/api/auth/me", { method: "PATCH", body: JSON.stringify({ locale: l }) }); await refresh(); }
      catch { /* язык поменяется при следующем сохранении аккаунта */ }
    }
  }
  return (
    <div className="login-page">
      <div className="card auth">
        <div className="guest-bar">
          {back ?? <Link to="/how-to-play" className="btn ghost sm"><Icon name="help" />{t("Как играть?")}</Link>}
          <div className="lang-switch" role="group" aria-label={t("Язык")}>
            <button type="button" className={locale === "ru" ? "active" : ""} aria-pressed={locale === "ru"} onClick={() => void pick("ru")}>RU</button>
            <button type="button" className={locale === "en" ? "active" : ""} aria-pressed={locale === "en"} onClick={() => void pick("en")}>EN</button>
          </div>
        </div>
        <div className="auth-logo">
          <img src="/img/brand/logo-256.png" alt="" width={72} height={72} />
          <h1>{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Текст ошибки запроса: сообщение сервера или «Ошибка сети». */
export function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : t("Ошибка сети");
}

type Mode = "login" | "register";

export function LoginPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";
  const [mode, setMode] = useState<Mode>("login");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  // ?google=state|error — сюда вернул сервер после неудачного входа через Google.
  const [error, setError] = useState<string | null>(params.get("google") ? t("Не удалось войти через Google, попробуйте ещё раз") : null);
  const [busy, setBusy] = useState(false);
  const providers = useProviders();

  if (user) return <Navigate to={next} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === "login") await login(nickname, password);
      else await register(nickname, password, email);
      navigate(next);
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  return (
    <GuestShell title={t("Земли Слова")}>
      <Tabs<Mode> ariaLabel={t("Вход или регистрация")} items={[{ key: "login", label: t("Вход") }, { key: "register", label: t("Регистрация") }]} value={mode} onChange={(m) => { setMode(m); setError(null); }} />
      {providers?.google && (
        <>
          <a className="btn secondary block google-btn" href={"/api/auth/google?next=" + encodeURIComponent(next)}><GoogleMark />{t("Войти через Google")}</a>
          <div className="or-divider" role="separator"><span>{t("или")}</span></div>
        </>
      )}
      <form onSubmit={submit}>
        <label htmlFor="nickname">{mode === "login" ? t("Никнейм или почта") : t("Никнейм")}</label>
        <input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} autoComplete="username" required minLength={3} maxLength={mode === "login" ? 120 : 24} autoFocus />
        <label htmlFor="password">{t("Пароль")}{mode === "register" && <span className="opt"> · {t("не короче 8 символов")}</span>}</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={8} />
        {mode === "register" && (
          <>
            <label htmlFor="email">{t("Почта")}</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            <p className="hint">{t("Пришлём письмо со ссылкой — без неё играть нельзя. По этой почте восстанавливают пароль.")}</p>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="block" disabled={busy}>{mode === "login" ? t("Войти") : t("Создать аккаунт")}</button>
          {mode === "login" && <Link to="/forgot" className="btn ghost block">{t("Забыли пароль?")}</Link>}
        </div>
      </form>
      <p className="auth-foot"><Link to="/privacy">{t("О персональных данных")}</Link></p>
    </GuestShell>
  );
}
