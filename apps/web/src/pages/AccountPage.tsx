import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";

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
    try { await api<{ user: User }>("/api/auth/me", { method: "PATCH", body: JSON.stringify({ displayName, email, locale }) }); await refresh(); ui.notify(t("Сохранено")); }
    catch (err) { setError(err instanceof ApiError ? (err.issues?.map((i) => i.message).join("; ") || err.message) : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function changePassword(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api("/api/auth/password", { method: "POST", body: JSON.stringify({ current, next }) }); setCurrent(""); setNext(""); ui.notify(t("Пароль изменён")); }
    catch (err) { setError(err instanceof ApiError ? (err.issues?.map((i) => i.message).join("; ") || err.message) : t("Ошибка сети")); }
    finally { setBusy(false); }
  }

  return (
    <>
      <p><Link to="/">{t("← Мои игры")}</Link></p>
      <div className="card auth" style={{ margin: "0 auto" }}>
        <h1>{t("Аккаунт")}</h1>
        <p className="muted">{t("Никнейм:")} <strong>{user.nickname}</strong>{user.platformRole === "SUPERADMIN" ? t(" · суперадмин") : ""}</p>
        <form onSubmit={saveProfile}>
          <label htmlFor="a-name">{t("Отображаемое имя")} <span className="muted">{t("необязательно")}</span></label>
          <input id="a-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} placeholder={t("Как вас показывать команде")} />
          <label htmlFor="a-email">Email <span className="muted">{t("необязательно: для уведомлений и восстановления пароля")}</span></label>
          <input id="a-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {!user.email && <p className="hint">{t("Без почты забытый пароль восстановить будет нельзя. Укажите её.")}</p>}
          <label htmlFor="a-locale">{t("Язык")}</label>
          <select id="a-locale" value={locale} onChange={(e) => setLocale(e.target.value)}><option value="ru">{t("Русский")}</option><option value="en">English</option></select>
          {error && <p className="error">{error}</p>}
          <div className="actions"><button type="submit" disabled={busy}>{t("Сохранить")}</button></div>
        </form>
      </div>
      <div className="card auth" style={{ margin: "1rem auto" }}>
        <h2>{t("Сменить пароль")}</h2>
        <form onSubmit={changePassword}>
          <label htmlFor="a-cur">{t("Текущий пароль")}</label>
          <input id="a-cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          <label htmlFor="a-next">{t("Новый пароль")} <span className="muted">{t("не короче 8 символов")}</span></label>
          <input id="a-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={8} />
          <div className="actions"><button type="submit" className="secondary" disabled={busy}>{t("Изменить пароль")}</button></div>
        </form>
      </div>
      {user.platformRole === "SUPERADMIN" && <><MailTest /><ResetLinkTool /></>}
    </>
  );
}

/** Суперадмин: проверка почты (SMTP) с тестовым письмом себе. */
function MailTest() {
  const [result, setResult] = useState<{ ok: boolean; sent: boolean; error?: string; host?: string; port?: number; to?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true); setResult(null);
    try { setResult(await api("/api/auth/mail-test", { method: "POST" })); }
    catch (e) { setResult({ ok: false, sent: false, error: e instanceof ApiError ? e.message : t("Ошибка сети") }); }
    finally { setBusy(false); }
  }
  return (
    <div className="card auth" style={{ margin: "1rem auto 0" }}>
      <h2>{t("Почта сервера")}</h2>
      <p className="muted">{t("Проверяет подключение к SMTP из deploy/.env и шлёт тестовое письмо на вашу почту.")}</p>
      <div className="actions"><button className="secondary" disabled={busy} onClick={() => void run()}>{busy ? t("Проверяем…") : t("Проверить почту")}</button></div>
      {result && (
        <p className={"note " + (result.sent ? "ok" : "bad")} style={{ marginTop: ".6rem" }}>
          {result.host ? `${result.host}:${result.port} · ` : ""}
          {result.sent ? t("письмо отправлено на {to}", { to: result.to ?? "" }) : result.error}
        </p>
      )}
    </div>
  );
}

/** Суперадмин: одноразовая ссылка сброса пароля для пользователя по никнейму (24 часа). */
function ResetLinkTool() {
  const [nickname, setNickname] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  async function run(e: FormEvent) {
    e.preventDefault(); setError(null); setUrl(null);
    try { setUrl((await api<{ url: string }>("/api/auth/reset-link", { method: "POST", body: JSON.stringify({ nickname }) })).url); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
  }
  async function copy() { try { await navigator.clipboard.writeText(url!); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* буфер недоступен */ } }
  return (
    <div className="card auth" style={{ margin: "1rem auto 0" }}>
      <h2>{t("Сброс пароля пользователю")}</h2>
      <p className="muted">{t("Для случаев, когда почта недоступна. Ссылка одноразовая, действует 24 часа; передайте её человеку лично.")}</p>
      <form onSubmit={run}>
        <label htmlFor="rl-nick">{t("Никнейм")}</label>
        <input id="rl-nick" value={nickname} onChange={(e) => setNickname(e.target.value)} required minLength={3} />
        {error && <p className="error">{error}</p>}
        <div className="actions"><button type="submit" className="secondary">{t("Выдать ссылку")}</button></div>
      </form>
      {url && (
        <div className="note warn" style={{ marginTop: ".6rem" }}>
          <div className="row">
            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} style={{ flex: "1 1 240px", minHeight: 38 }} />
            <button className="sm" onClick={() => void copy()}>{copied ? t("Скопировано") : t("Скопировать")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
