import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { t, getLocale } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { Back } from "../components/Back";
import { Tabs } from "../components/Tabs";
import { ErrorState, LoadingState } from "../components/State";

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
  tech: { uptimeHours: number | null; mailEnabled: boolean; mailSent: number; mailFailed: number; node: string; memoryMb: number; requests: number; errors5xx: number; errors4xx: number; lastErrorAt: string | null; lastErrorRoute: string | null; avgMs: number | null; p95Ms: number | null; sample: number };
}
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

/** Аналитика суперадмина: обобщённые метрики платформы по группам, с динамикой по дням; таблица по дням — внизу. */
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
