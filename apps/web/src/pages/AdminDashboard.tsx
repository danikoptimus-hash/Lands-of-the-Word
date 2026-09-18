import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { t, getLocale } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { Back } from "../components/Back";
import { Tabs } from "../components/Tabs";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { useUi } from "../lib/ui";
import { TeamAvatar } from "../components/TeamAvatar";

interface Metrics {
  period: { days: number; since: string; dates: string[] };
  series: Record<"newUsers" | "usersTotal" | "submissions" | "approvals" | "battles" | "cities" | "games" | "nodes", number[]>;
  previous: Record<"newUsers" | "submissions" | "battles" | "cities" | "games" | "nodes", number>;
  nodesInPeriod: number;
  users: { total: number; newInPeriod: number; dau: number; wau: number; mau: number; retention7: number | null; retention30: number | null };
  games: { total: number; draft: number; active: number; finished: number; createdInPeriod: number; avgDurationDays: number | null; teams: number; avgTeamSize: number | null; organizations: number };
  activity: { submissionsInPeriod: number; submissionsTotal: number; approvedShare: number | null; avgDecisionHours: number | null; edgesTraversed: number; citiesCaptured: number; citiesCapturedInPeriod: number };
  battles: { declared: number; declaredInPeriod: number; expired: number; won: number; repelled: number; active: number; avgBid: number | null; avgAttackHours: number | null; sumMode: number };
  diplomacy: { implemented: boolean; passRequests: number; passApprovedShare: number | null; embassies: number };
  ui: { samples: number; ttfb: Pct; fcp: Pct; lcp: Pct; load: Pct; fps: { avg: number | null; p25: number | null; samples: number }; jank: { avg: number | null; bad: number | null }; longTasks: { avg: number | null }; byDevice: Groups; byBrowser: Groups; byOs: Groups; byPage: Groups };
  tech: { uptimeHours: number | null; mailEnabled: boolean; mailSent: number; mailFailed: number; node: string; memoryMb: number; requests: number; errors5xx: number; errors4xx: number; lastErrorAt: string | null; lastErrorRoute: string | null; avgMs: number | null; p95Ms: number | null; sample: number };
}
interface Pct { p50: number | null; p75: number | null }
type Groups = Record<string, { n: number; fps: number | null; jank: number | null; lcp: number | null; load: number | null }>;
const fmt = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v}${suffix}`);
const dateLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(getLocale() === "en" ? "en-GB" : "ru-RU", { day: "numeric", month: "short" });
type Period = "7" | "30" | "90";

/** Мини-график в плитке: линия в приглушённом цвете, текущая точка — акцент, наведение показывает день и значение. */
function Sparkline({ values, dates, cumulative }: { values: number[]; dates: string[]; cumulative?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 140, H = 36, pad = 3;
  const max = Math.max(1, ...values), min = cumulative ? Math.min(...values) : 0;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, values.length - 1);
  const y = (v: number) => H - pad - ((v - min) * (H - 2 * pad)) / Math.max(1, max - min);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = values.length - 1;
  const i = hover ?? last;
  return (
    <div className="spark" onMouseLeave={() => setHover(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("динамика по дням")}>
        <polyline points={points} fill="none" stroke="var(--border-strong)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad} y2={H - pad} stroke="var(--border)" strokeWidth={1} />}
        <circle cx={x(i)} cy={y(values[i]!)} r={3.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        {values.map((_, k) => <rect key={k} x={x(k) - (W / values.length) / 2} y={0} width={W / values.length} height={H} fill="transparent" onMouseEnter={() => setHover(k)} />)}
      </svg>
      <div className="spark-label">{dateLabel(dates[i]!)}: <strong>{values[i]}</strong></div>
    </div>
  );
}

/** Плитка-фактоид: значение, дельта к предыдущему периоду (знак и цвет, без стрелок) и динамика по дням. */
function Tile({ label, value, hint, trend, dates, cumulative, delta }: { label: string; value: string; hint?: string; trend?: number[]; dates?: string[]; cumulative?: boolean; delta?: { now: number; prev: number; days: number } }) {
  const diff = delta ? delta.now - delta.prev : null;
  const pct = delta && delta.prev > 0 && diff !== null ? Math.round((diff / delta.prev) * 100) : null;
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");
  return (
    <div className="tile">
      <div className="value">{value}</div>
      <div className="cap">{label}</div>
      {delta && diff !== null && (
        <div className={"delta " + (diff > 0 ? "up" : diff < 0 ? "down" : "flat")}>
          {sign(diff)}{Math.abs(diff)}{pct !== null ? ` (${sign(pct)}${Math.abs(pct)}%)` : ""} <span className="muted">{t("к предыдущим {n} дн", { n: delta.days })}</span>
        </div>
      )}
      {hint && <div className="hint">{hint}</div>}
      {trend && dates && trend.length > 1 && <Sparkline values={trend} dates={dates} cumulative={cumulative} />}
    </div>
  );
}


interface SupportRow { id: string; createdAt: string; status: "OPEN" | "CLOSED"; game: string; team: { name: string; color: string } | null; user: string; bookCode: string | null; taskIndex: number | null; message: string; context: { city?: string | null; prompt?: string | null; attemptsLeft?: number | null; lockedUntil?: string | null;  doneTasks?: number | null; totalTasks?: number | null; org?: string }; reply: string | null; resolvedAt: string | null; unlocked: boolean }

/** Обращения в поддержку: открытые сверху, ответ и снятие блокировки — здесь. Адрес для писем — в настройке ниже. */
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
  async function resolve(r: SupportRow, unlock: boolean) {
    setBusy(r.id);
    try {
      await api(`/api/admin/support/${r.id}/resolve`, { method: "POST", body: JSON.stringify({ unlock, reply: reply[r.id]?.trim() || undefined }) });
      notify(unlock ? t("Блокировка снята, команде отправлен ответ") : t("Обращение закрыто, команде отправлен ответ"));
      load();
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
        <button type="button" className="secondary sm" onClick={() => setShowClosed((v) => !v)}>{showClosed ? t("Только открытые") : t("Показать закрытые")}</button>
      </div>
      <p className="muted small">{t("Игроки пишут из задания: город, задание и состояние попыток подставляются сами. Ответ уходит команде уведомлением и письмом.")}</p>
      {error ? <ErrorState text={error} onRetry={load} /> : !rows ? <LoadingState rows={2} /> : rows.length === 0 ? <EmptyState inline icon="send" text={t("Обращений нет.")} /> : (
        <ul className="list support-list">
          {rows.map((r) => (
            <li key={r.id} className={r.status === "CLOSED" ? "closed" : ""}>
              <div className="main">
                <span className="title">{r.game}{r.team && <> · <TeamAvatar name={r.team.name} color={r.team.color} size="sm" withName /></>} <span className="muted small">· {r.user} · {fmtDate(r.createdAt)}</span></span>
                {r.context.city && <span className="meta">{r.context.city}{r.taskIndex !== null && <> · {t("задание {n}", { n: r.taskIndex + 1 })}{r.context.attemptsLeft !== null && r.context.attemptsLeft !== undefined && <> · {t("попыток осталось {n}", { n: r.context.attemptsLeft })}</>}{r.context.lockedUntil && <> · {t("закрыто до {d}", { d: fmtDate(r.context.lockedUntil) })}</>}</>}</span>}
                {r.context.prompt && <span className="muted small">{r.context.prompt}</span>}
                <p className="msg">{r.message}</p>
                {r.status === "CLOSED" ? (
                  <span className="muted small">{r.unlocked ? t("Блокировка снята") : t("Закрыто")}{r.reply ? ` · ${t("ответ команде")}: ${r.reply}` : ""}{r.resolvedAt ? ` · ${fmtDate(r.resolvedAt)}` : ""}</span>
                ) : (
                  <div className="support-reply">
                    <textarea value={reply[r.id] ?? ""} onChange={(e) => setReply((m) => ({ ...m, [r.id]: e.target.value }))} placeholder={t("Ответ команде (необязательно)")} maxLength={1000} rows={2} />
                    <div className="row mt-2">
                      {r.taskIndex !== null && <button type="button" className="sm" disabled={busy === r.id} onClick={() => void resolve(r, true)}><Icon name="check" />{t("Снять блокировку и закрыть")}</button>}
                      <button type="button" className="secondary sm" disabled={busy === r.id} onClick={() => void resolve(r, false)}>{t("Закрыть с ответом")}</button>
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

/** Аналитика суперадмина: обобщённые метрики платформы по группам, с динамикой по дням; таблица по дням — внизу. */
/** Тестовые аккаунты (боты тестовой партии): подтвердить почту вручную; только для адресов на example.com. */
function TestAccountsBlock() {
  const { notify } = useUi();
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);
  async function verify() {
    setBusy(true);
    try {
      const names = nick.split(/[\s,;]+/).filter(Boolean);
      let ok = 0;
      for (const n of names) { await api("/api/auth/verify-user", { method: "POST", body: JSON.stringify({ nickname: n }) }); ok++; }
      notify(t("Подтверждено аккаунтов: {n}", { n: ok })); setNick("");
    } catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h2><span className="ico"><Icon name="users" /></span>{t("Тестовые аккаунты")}</h2>
      <p className="hint">{t("Для тестовой партии с ботами: подтвердить почту аккаунтов с адресом на example.com (письмо туда не доходит). Никнеймы через пробел или запятую.")}</p>
      <div className="row nowrap">
        <input value={nick} onChange={(e) => setNick(e.target.value)} placeholder="tg_m1 tg_m2 …" aria-label={t("Никнеймы")} />
        <button type="button" disabled={busy || !nick.trim()} onClick={() => void verify()}><Icon name="check" />{t("Подтвердить")}</button>
      </div>
    </div>
  );
}

export function AdminDashboard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("30");
  const days = Number(period);
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const load = () => { setM(null); setError(null); api<Metrics>(`/api/admin/metrics?days=${days}`).then(setM).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); };
  useEffect(() => { if (user?.platformRole === "SUPERADMIN") load(); }, [days, user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null;
  if (user.platformRole !== "SUPERADMIN") return <Navigate to="/" replace />;
  const d = m?.period.dates ?? [];
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const forDays = (n: number) => t("{n} дней", { n });
  return (
    <>
      <Back to="/" label={t("Мои игры")} />
      <div className="page-head">
        <h1><span className="ico"><Icon name="check" /></span>{t("Аналитика")}</h1>
      </div>
      <Tabs<Period> value={period} onChange={setPeriod} ariaLabel={t("Период")} items={[{ key: "7", label: forDays(7) }, { key: "30", label: forDays(30) }, { key: "90", label: forDays(90) }]} />
      <p className="muted small mt-3">{t("Только обобщённые числа: без содержимого игр и без привязки к людям. Наведите на график в плитке, чтобы увидеть день.")}</p>
      <SupportBlock />
      <TestAccountsBlock />
      {error && <div className="card"><ErrorState text={error} onRetry={load} /></div>}
      {!m && !error && <div className="card"><LoadingState /></div>}
      {m && (
        <>
          <div className="card"><h2>{t("Пользователи")}</h2><div className="tiles mt-3">
            <Tile label={t("всего")} value={fmt(m.users.total)} trend={m.series.usersTotal} dates={d} cumulative />
            <Tile label={t("новых за {n} дн", { n: days })} value={fmt(m.users.newInPeriod)} trend={m.series.newUsers} dates={d} delta={{ now: m.users.newInPeriod, prev: m.previous.newUsers, days }} />
            <Tile label={t("активны за день")} value={fmt(m.users.dau)} /><Tile label={t("активны за неделю")} value={fmt(m.users.wau)} /><Tile label={t("активны за месяц")} value={fmt(m.users.mau)} />
            <Tile label={t("удержание 7 дн")} value={fmt(m.users.retention7, "%")} hint={t("вернулись через неделю")} /><Tile label={t("удержание 30 дн")} value={fmt(m.users.retention30, "%")} hint={t("вернулись через месяц")} />
          </div></div>
          <div className="card"><h2>{t("Игры")}</h2><div className="tiles mt-3">
            <Tile label={t("игр всего")} value={fmt(m.games.total)} hint={t("черновиков {n}", { n: m.games.draft })} /><Tile label={t("идут")} value={fmt(m.games.active)} /><Tile label={t("завершены")} value={fmt(m.games.finished)} />
            <Tile label={t("создано за {n} дн", { n: days })} value={fmt(m.games.createdInPeriod)} trend={m.series.games} dates={d} delta={{ now: m.games.createdInPeriod, prev: m.previous.games, days }} />
            <Tile label={t("длительность")} value={fmt(m.games.avgDurationDays, " " + t("дн"))} hint={t("среднее по завершённым")} />
            <Tile label={t("команд")} value={fmt(m.games.teams)} /><Tile label={t("размер команды")} value={fmt(m.games.avgTeamSize)} hint={t("в среднем")} /><Tile label={t("церквей")} value={fmt(m.games.organizations)} />
          </div></div>
          <div className="card"><h2>{t("Активность")}</h2><div className="tiles mt-3">
            <Tile label={t("сдач дел за {n} дн", { n: days })} value={fmt(m.activity.submissionsInPeriod)} hint={t("всего {n}", { n: m.activity.submissionsTotal })} trend={m.series.submissions} dates={d} delta={{ now: m.activity.submissionsInPeriod, prev: m.previous.submissions, days }} />
            <Tile label={t("принято за {n} дн", { n: days })} value={fmt(sum(m.series.approvals))} hint={t("доля принятых {p}", { p: fmt(m.activity.approvedShare, "%") })} trend={m.series.approvals} dates={d} />
            <Tile label={t("до решения администратора")} value={fmt(m.activity.avgDecisionHours, " " + t("ч"))} hint={t("в среднем")} />
            <Tile label={t("открыто перекрёстков за {n} дн", { n: days })} value={fmt(m.nodesInPeriod)} hint={t("пройдено сторон всего {n}", { n: m.activity.edgesTraversed })} trend={m.series.nodes} dates={d} delta={{ now: m.nodesInPeriod, prev: m.previous.nodes, days }} />
            <Tile label={t("взято городов за {n} дн", { n: days })} value={fmt(m.activity.citiesCapturedInPeriod)} hint={t("всего {n}", { n: m.activity.citiesCaptured })} trend={m.series.cities} dates={d} delta={{ now: m.activity.citiesCapturedInPeriod, prev: m.previous.cities, days }} />
          </div></div>
          <div className="card"><h2>{t("Испытания")}</h2><div className="tiles mt-3">
            <Tile label={t("объявлено за {n} дн", { n: days })} value={fmt(m.battles.declaredInPeriod)} hint={t("всего {n}", { n: m.battles.declared })} trend={m.series.battles} dates={d} delta={{ now: m.battles.declaredInPeriod, prev: m.previous.battles, days }} />
            <Tile label={t("идут")} value={fmt(m.battles.active)} /><Tile label={t("город перешёл")} value={fmt(m.battles.won)} />
            <Tile label={t("город устоял")} value={fmt(m.battles.repelled)} /><Tile label={t("вызов не завершён")} value={fmt(m.battles.expired)} /><Tile label={t("средняя ставка")} value={fmt(m.battles.avgBid, " " + t("стихов"))} />
            <Tile label={t("время вызова")} value={fmt(m.battles.avgAttackHours, " " + t("ч"))} hint={t("в среднем")} /><Tile label={t("суммарный режим")} value={fmt(m.battles.sumMode)} hint={t("исчерпанные книги")} />
          </div></div>
          <div className="card"><h2>{t("Проходы")}</h2>{m.diplomacy.implemented ? <div className="tiles mt-3"><Tile label={t("запросов прохода")} value={fmt(m.diplomacy.passRequests)} /><Tile label={t("разрешено")} value={fmt(m.diplomacy.passApprovedShare, "%")} /><Tile label={t("посольств")} value={fmt(m.diplomacy.embassies)} /></div> : <p className="muted small mt-2">{t("Метрики проходов появятся позже.")}</p>}</div>
          <div className="card"><h2>{t("Интерфейс")}</h2>
            <p className="muted small mt-2">{t("Замеры с устройств игроков за период: скорость открытия страницы и плавность карты за первые 6 секунд. Без привязки к людям.")}</p>
            {m.ui.samples === 0 ? <p className="muted small mt-2">{t("Замеров пока нет: они появляются после открытия карты на устройствах.")}</p> : (
              <>
                <div className="tiles mt-3">
                  <Tile label={t("замеров")} value={fmt(m.ui.samples)} />
                  <Tile label={t("первый байт")} value={fmt(m.ui.ttfb.p50, " " + t("мс"))} hint={t("p75 {p}", { p: fmt(m.ui.ttfb.p75, " " + t("мс")) })} />
                  <Tile label={t("первая отрисовка")} value={fmt(m.ui.fcp.p50, " " + t("мс"))} hint={t("p75 {p}", { p: fmt(m.ui.fcp.p75, " " + t("мс")) })} />
                  <Tile label={t("крупная отрисовка")} value={fmt(m.ui.lcp.p50, " " + t("мс"))} hint={t("p75 {p}", { p: fmt(m.ui.lcp.p75, " " + t("мс")) })} />
                  <Tile label={t("страница загружена")} value={fmt(m.ui.load.p50, " " + t("мс"))} hint={t("p75 {p}", { p: fmt(m.ui.load.p75, " " + t("мс")) })} />
                  <Tile label={t("кадров в секунду")} value={fmt(m.ui.fps.avg)} hint={t("худшая четверть {p} · замеров {n}", { p: fmt(m.ui.fps.p25), n: m.ui.fps.samples })} />
                  <Tile label={t("долгих кадров")} value={fmt(m.ui.jank.avg, "%")} hint={t("замеров с рывками {p}", { p: fmt(m.ui.jank.bad, "%") })} />
                  <Tile label={t("длинных задач")} value={fmt(m.ui.longTasks.avg)} hint={t("за замер, дольше 50 мс")} />
                </div>
                <div className="table-wrap mt-3">
                  <table className="data-table">
                    <thead><tr><th>{t("Срез")}</th><th>{t("Замеров")}</th><th>{t("Кадров/с")}</th><th>{t("Долгих кадров")}</th><th>{t("Крупная отрисовка")}</th><th>{t("Загружена")}</th></tr></thead>
                    <tbody>
                      {([["byDevice", { phone: t("телефон"), desktop: t("компьютер") }], ["byPage", { map: t("карта команды"), "admin-map": t("карта администратора"), other: t("другие страницы") }], ["byBrowser", {}], ["byOs", {}]] as const).map(([key, names]) =>
                        Object.entries(m.ui[key]).map(([k, g]) => <tr key={key + k}><td>{(names as Record<string, string>)[k] ?? k}</td><td>{g.n}</td><td>{fmt(g.fps)}</td><td>{fmt(g.jank, "%")}</td><td>{fmt(g.lcp, " " + t("мс"))}</td><td>{fmt(g.load, " " + t("мс"))}</td></tr>))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
          <div className="card"><h2>{t("Сервер")}</h2><div className="tiles mt-3">
            <Tile label={t("работает без перезапуска")} value={fmt(m.tech.uptimeHours, " " + t("ч"))} /><Tile label={t("почта")} value={m.tech.mailEnabled ? t("настроена") : t("выключена")} />
            <Tile label={t("писем отправлено")} value={fmt(m.tech.mailSent)} hint={t("с момента запуска")} /><Tile label={t("не доставлено")} value={fmt(m.tech.mailFailed)} /><Tile label={t("память")} value={fmt(m.tech.memoryMb, " " + t("МБ"))} hint={m.tech.node} />
            <Tile label={t("запросов к API")} value={fmt(m.tech.requests)} hint={t("с момента запуска")} />
            <Tile label={t("ошибок сервера (5xx)")} value={fmt(m.tech.errors5xx)} hint={m.tech.lastErrorAt ? `${t("последняя")} ${fmtDate(m.tech.lastErrorAt)} · ${m.tech.lastErrorRoute ?? ""}` : t("ошибок не было")} />
            <Tile label={t("отказов клиенту (4xx)")} value={fmt(m.tech.errors4xx)} hint={t("неверные данные, нет прав")} />
            <Tile label={t("время ответа")} value={fmt(m.tech.avgMs, " " + t("мс"))} hint={t("p95 {p} · по {n} запросам", { p: fmt(m.tech.p95Ms, " " + t("мс")), n: m.tech.sample })} />
          </div><p className="hint">{t("Подробности ошибок — в логах сервера.")}</p></div>
          <div className="card">
            <div className="card-head">
              <h2>{t("По дням")}</h2>
              <button type="button" className="secondary sm" onClick={() => setTable((v) => !v)} aria-expanded={table}><Icon name={table ? "x" : "list"} />{table ? t("Скрыть") : t("Показать таблицу")}</button>
            </div>
            {table && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>{t("День")}</th><th>{t("Новых")}</th><th>{t("Всего")}</th><th>{t("Сдач")}</th><th>{t("Принято")}</th><th>{t("Перекрёстков")}</th><th>{t("Городов")}</th><th>{t("Испытаний")}</th><th>{t("Игр")}</th></tr></thead>
                  <tbody>{d.map((day, i) => <tr key={day}><td>{dateLabel(day)}</td><td>{m.series.newUsers[i]}</td><td>{m.series.usersTotal[i]}</td><td>{m.series.submissions[i]}</td><td>{m.series.approvals[i]}</td><td>{m.series.nodes[i]}</td><td>{m.series.cities[i]}</td><td>{m.series.battles[i]}</td><td>{m.series.games[i]}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
