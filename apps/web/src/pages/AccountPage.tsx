import { useState, type FormEvent } from "react";
import { api, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { Back } from "../components/Back";
import { Chip } from "../components/Chip";
import { CopyField } from "../components/CopyField";
import { PushToggle } from "../components/PushToggle";
import { errorText } from "./LoginPage";

/** Аккаунт: имя в команде, почта, язык; смена пароля; уведомления. Никнейм не меняется. У каждой формы своя ошибка. */
export function AccountPage() {
  const { user, refresh } = useAuth();
  const ui = useUi();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [locale, setLocale] = useState(user?.locale ?? "ru");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  if (!user) return null;

  async function saveProfile(e: FormEvent) {
    e.preventDefault(); setProfileBusy(true); setProfileError(null);
    try { await api<{ user: User }>("/api/auth/me", { method: "PATCH", body: JSON.stringify({ displayName, email, locale }) }); await refresh(); ui.notify(t("Сохранено")); }
    catch (err) { setProfileError(errorText(err)); }
    finally { setProfileBusy(false); }
  }
  async function changePassword(e: FormEvent) {
    e.preventDefault(); setPasswordBusy(true); setPasswordError(null);
    try { await api("/api/auth/password", { method: "POST", body: JSON.stringify({ current, next }) }); setCurrent(""); setNext(""); ui.notify(t("Пароль изменён")); }
    catch (err) { setPasswordError(errorText(err)); }
    finally { setPasswordBusy(false); }
  }

  return (
    <div className="narrow-page">
      <Back to="/" label={t("Мои игры")} />
      <div className="page-head">
        <h1><span className="ico"><Icon name="user" /></span>{t("Аккаунт")}</h1>
        {user.platformRole === "SUPERADMIN" && <Chip tone="accent" icon="star">{t("суперадмин")}</Chip>}
      </div>

      <div className="card">
        <form onSubmit={saveProfile}>
          <label htmlFor="a-nick">{t("Никнейм")} <span className="opt">· {t("нельзя изменить")}</span></label>
          <input id="a-nick" value={user.nickname} readOnly tabIndex={-1} />
          <label htmlFor="a-name">{t("Имя в команде")} <span className="opt">· {t("необязательно")}</span></label>
          <input id="a-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder={t("Как вас показывать команде")} autoComplete="nickname" />
          <label htmlFor="a-email">{t("Почта")} <span className="opt">· {t("необязательно")}</span></label>
          <input id="a-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <p className="hint">{t("Нужна для восстановления пароля и уведомлений.")}</p>
          <label htmlFor="a-locale">{t("Язык")}</label>
          <select id="a-locale" value={locale} onChange={(e) => setLocale(e.target.value)}><option value="ru">Русский</option><option value="en">English</option></select>
          {profileError && <p className="error" role="alert">{profileError}</p>}
          <div className="actions"><button type="submit" disabled={profileBusy}>{t("Сохранить")}</button></div>
        </form>
      </div>

      <div className="card">
        <h2><span className="ico"><Icon name="lock" /></span>{t("Сменить пароль")}</h2>
        <form onSubmit={changePassword} className="mt-4">
          <label htmlFor="a-cur">{t("Текущий пароль")}</label>
          <input id="a-cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          <label htmlFor="a-next">{t("Новый пароль")} <span className="opt">· {t("не короче 8 символов")}</span></label>
          <input id="a-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={8} />
          {passwordError && <p className="error" role="alert">{passwordError}</p>}
          <div className="actions"><button type="submit" disabled={passwordBusy}>{t("Сменить пароль")}</button></div>
        </form>
      </div>

      <PushToggle />
      {user.platformRole === "SUPERADMIN" && <><MailTest /><ResetLinkTool /></>}
    </div>
  );
}

/** Суперадмин: проверка почты (SMTP) тестовым письмом себе. */
function MailTest() {
  const [result, setResult] = useState<{ ok: boolean; sent: boolean; error?: string; host?: string; port?: number; to?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true); setResult(null);
    try { setResult(await api("/api/auth/mail-test", { method: "POST" })); }
    catch (e) { setResult({ ok: false, sent: false, error: errorText(e) }); }
    finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h2><span className="ico"><Icon name="mail" /></span>{t("Почта сервера")}</h2>
      <p className="hint">{t("Проверяет подключение к SMTP из deploy/.env и шлёт тестовое письмо на вашу почту.")}</p>
      {result && (
        <p className={"note " + (result.sent ? "ok" : "bad")} role="status">
          {result.host ? `${result.host}:${result.port} · ` : ""}
          {result.sent ? t("письмо отправлено на {to}", { to: result.to ?? "" }) : result.error}
        </p>
      )}
      <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={() => void run()}><Icon name="send" />{busy ? t("Проверяем…") : t("Проверить почту")}</button></div>
    </div>
  );
}

/** Суперадмин: одноразовая ссылка сброса пароля по никнейму (24 часа). */
function ResetLinkTool() {
  const [nickname, setNickname] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setUrl(null);
    try { setUrl((await api<{ url: string }>("/api/auth/reset-link", { method: "POST", body: JSON.stringify({ nickname }) })).url); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h2><span className="ico"><Icon name="link" /></span>{t("Сброс пароля пользователю")}</h2>
      <p className="hint">{t("Для случаев, когда почта недоступна. Ссылка одноразовая, действует 24 часа; передайте её человеку лично.")}</p>
      <form onSubmit={run} className="mt-4">
        <label htmlFor="rl-nick">{t("Никнейм")}</label>
        <input id="rl-nick" value={nickname} onChange={(e) => setNickname(e.target.value)} required minLength={3} maxLength={24} autoComplete="off" />
        {error && <p className="error" role="alert">{error}</p>}
        {url && <div className="mt-3"><CopyField value={url} label={t("Ссылка для сброса пароля")} /></div>}
        <div className="actions"><button type="submit" className="secondary" disabled={busy}>{t("Выдать ссылку")}</button></div>
      </form>
    </div>
  );
}
