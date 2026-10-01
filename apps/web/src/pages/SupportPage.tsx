import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { Back } from "../components/Back";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { useUi } from "../lib/ui";
import { TeamAvatar } from "../components/TeamAvatar";
import { Help } from "../components/Help";

/** Обращения в поддержку — отдельная страница администратора платформы из меню шапки (решение владельца 01.10: раньше блок жил в «Аналитике»). */
interface SupportRow { id: string; createdAt: string; status: "OPEN" | "CLOSED"; game: string; team: { name: string; color: string } | null; user: string; bookCode: string | null; taskIndex: number | null; message: string; context: { city?: string | null; prompt?: string | null; lockedUntil?: string | null; doneTasks?: number | null; totalTasks?: number | null; org?: string }; reply: string | null; resolvedAt: string | null }

/** Обращения в поддержку: открытые сверху, ответ команде — здесь (пауза задания не снимается). Адрес для писем — в настройке ниже. */
function SupportBlock() {
  const { notify } = useUi();
  const [rows, setRows] = useState<SupportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [settings, setSettings] = useState<{ supportEmail: string | null; fallback: string | null } | null>(null);
  const [email, setEmail] = useState("");
  const load = useCallback(() => {
    api<{ requests: SupportRow[] }>(`/api/admin/support?status=${showClosed ? "ALL" : "OPEN"}`).then((r) => { setRows(r.requests); setError(null); }).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети")));
  }, [showClosed]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api<{ supportEmail: string | null; fallback: string | null }>("/api/admin/settings").then((s) => { setSettings(s); setEmail(s.supportEmail ?? ""); }).catch(() => undefined); }, []);
  async function resolve(r: SupportRow) {
    setBusy(r.id);
    try {
      await api(`/api/admin/support/${r.id}/resolve`, { method: "POST", body: JSON.stringify({ reply: reply[r.id]?.trim() || undefined }) });
      notify(t("Обращение закрыто, команде отправлен ответ"));
      load(); window.dispatchEvent(new Event("lotw:support"));
    } catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(null); }
  }
  async function saveEmail() {
    try { const s = await api<{ supportEmail: string | null; fallback: string | null }>("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ supportEmail: email.trim() || null }) }); setSettings(s); notify(t("Адрес сохранён")); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
  }
  const open = rows?.filter((r) => r.status === "OPEN") ?? [];
  return (
    <div className="card" id="support">
      <div className="card-head">
        <h2><span className="ico"><Icon name="send" /></span>{t("Обращения в поддержку")} {rows && <span className="count">{open.length}</span>}</h2>
        <Help>{t("Игроки пишут из задания: город, задание и текущая пауза подставляются сами. Ответ уходит команде уведомлением и письмом.")}</Help>
        <button type="button" className="secondary sm" onClick={() => setShowClosed((v) => !v)}>{showClosed ? t("Только открытые") : t("Показать закрытые")}</button>
      </div>
      {error ? <ErrorState text={error} onRetry={load} /> : !rows ? <LoadingState rows={2} /> : rows.length === 0 ? <EmptyState inline icon="send" text={t("Обращений нет.")} /> : (
        <ul className="list support-list">
          {rows.map((r) => (
            <li key={r.id} className={r.status === "CLOSED" ? "closed" : ""}>
              <div className="main">
                <span className="title">{r.game}{r.team && <> · <TeamAvatar name={r.team.name} color={r.team.color} size="sm" withName /></>} <span className="muted small">· {r.user} · {fmtDate(r.createdAt)}</span></span>
                {r.context.city && <span className="meta">{r.context.city}{r.taskIndex !== null && <> · {t("задание {n}", { n: r.taskIndex + 1 })}{r.context.lockedUntil && <> · {t("закрыто до {d}", { d: fmtDate(r.context.lockedUntil) })}</>}</>}</span>}
                {r.context.prompt && <span className="muted small">{r.context.prompt}</span>}
                <p className="msg">{r.message}</p>
                {r.status === "CLOSED" ? (
                  <span className="muted small">{t("Закрыто")}{r.reply ? ` · ${t("ответ команде")}: ${r.reply}` : ""}{r.resolvedAt ? ` · ${fmtDate(r.resolvedAt)}` : ""}</span>
                ) : (
                  <div className="support-reply">
                    <textarea value={reply[r.id] ?? ""} onChange={(e) => setReply((m) => ({ ...m, [r.id]: e.target.value }))} placeholder={t("Ответ команде (необязательно)")} maxLength={1000} rows={2} />
                    <div className="row mt-2">
                      <button type="button" className="sm" disabled={busy === r.id} onClick={() => void resolve(r)}><Icon name="check" />{t("Закрыть с ответом")}</button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="add-block mt-4">
        <label htmlFor="support-email">{t("Почта для обращений")}</label>
        <div className="row nowrap">
          <input id="support-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={settings?.fallback ?? ""} maxLength={200} />
          <button type="button" className="secondary sm" onClick={() => void saveEmail()}>{t("Сохранить")}</button>
        </div>
        <p className="hint">{settings?.fallback ? t("Пусто — письма идут на почту администратора платформы: {e}.", { e: settings.fallback }) : t("Пусто — письма никуда не уходят: у администратора платформы нет почты.")}</p>
      </div>
    </div>
  );
}

export function SupportPage() {
  const { user } = useAuth();
  if (user && user.platformRole !== "SUPERADMIN") return <Navigate to="/" replace />;
  return (
    <div className="page admin-dashboard">
      <Back to="/" label={t("Мои игры")} />
      <SupportBlock />
    </div>
  );
}
