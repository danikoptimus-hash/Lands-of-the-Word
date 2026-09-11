import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

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
const dateLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

/** Мини-график в плитке: 2px линия в приглушённом цвете, текущая точка — акцент, наведение показывает день и значение. */
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
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="динамика по дням">
        <polyline points={points} fill="none" stroke="var(--border-strong)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad} y2={H - pad} stroke="var(--border)" strokeWidth={1} />}
        <circle cx={x(i)} cy={y(values[i]!)} r={3.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        {values.map((_, k) => <rect key={k} x={x(k) - (W / values.length) / 2} y={0} width={W / values.length} height={H} fill="transparent" onMouseEnter={() => setHover(k)} />)}
      </svg>
      <div className="spark-label">{dateLabel(dates[i]!)}: <strong>{values[i]}</strong></div>
    </div>
  );
}

/** Плитка-фактоид: значение, дельта к предыдущему периоду и динамика по дням. */
function Tile({ label, value, hint, trend, dates, cumulative, delta }: { label: string; value: string; hint?: string; trend?: number[]; dates?: string[]; cumulative?: boolean; delta?: { now: number; prev: number; days: number } }) {
  const diff = delta ? delta.now - delta.prev : null;
  const pct = delta && delta.prev > 0 && diff !== null ? Math.round((diff / delta.prev) * 100) : null;
  return (
    <div className="tile">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
      {delta && diff !== null && (
        <div className={"delta " + (diff > 0 ? "up" : diff < 0 ? "down" : "flat")}>
          {diff > 0 ? "▲" : diff < 0 ? "▼" : "•"} {diff > 0 ? "+" : ""}{diff}{pct !== null ? ` (${pct > 0 ? "+" : ""}${pct}%)` : ""} <span className="muted">к предыдущим {delta.days} дн</span>
        </div>
      )}
      {hint && <div className="hint">{hint}</div>}
      {trend && dates && trend.length > 1 && <Sparkline values={trend} dates={dates} cumulative={cumulative} />}
    </div>
  );
}

/** Дашборд суперадмина: обобщённые метрики платформы по группам из документации (4.1), с динамикой по дням. */
export function AdminDashboard() {
  const { user } = useAuth();
  const [days, setDays] = useState(30);
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => { if (user?.platformRole === "SUPERADMIN") api<Metrics>(`/api/admin/metrics?days=${days}`).then(setM).catch((e) => setError(e instanceof ApiError ? e.message : "Ошибка сети")); }, [days, user]);
  if (!user) return null;
  if (user.platformRole !== "SUPERADMIN") return <Navigate to="/" replace />;
  const d = m?.period.dates ?? [];
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return (
    <>
      <p><Link to="/">← Мои игры</Link></p>
      <div className="card-head">
        <h1>Аналитика платформы</h1>
        <div className="row">
          <span className="muted">период:</span>
          {[7, 30, 90].map((x) => <button key={x} className={"sm " + (x === days ? "" : "secondary")} onClick={() => setDays(x)}>{x} дн</button>)}
          <button className="ghost sm" onClick={() => setTable((v) => !v)}>{table ? "Скрыть таблицу" : "Таблица по дням"}</button>
        </div>
      </div>
      <p className="muted">Только обобщённые числа: без содержимого игр и без привязки к людям. Наведите на график в плитке, чтобы увидеть день.</p>
      {error && <p className="error">{error}</p>}
      {!m && !error && <p className="muted">Считаем…</p>}
      {m && table && (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="standings">
            <thead><tr><th>День</th><th>Новых</th><th>Всего</th><th>Сдач</th><th>Одобрено</th><th>Узлов</th><th>Городов</th><th>Испытаний</th><th>Игр</th></tr></thead>
            <tbody>{d.map((day, i) => <tr key={day}><td>{dateLabel(day)}</td><td>{m.series.newUsers[i]}</td><td>{m.series.usersTotal[i]}</td><td>{m.series.submissions[i]}</td><td>{m.series.approvals[i]}</td><td>{m.series.nodes[i]}</td><td>{m.series.cities[i]}</td><td>{m.series.battles[i]}</td><td>{m.series.games[i]}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {m && (
        <>
          <div className="card"><h2>Пользователи</h2><div className="tiles">
            <Tile label="всего" value={fmt(m.users.total)} trend={m.series.usersTotal} dates={d} cumulative />
            <Tile label={`новых за ${days} дн`} value={fmt(m.users.newInPeriod)} trend={m.series.newUsers} dates={d} delta={{ now: m.users.newInPeriod, prev: m.previous.newUsers, days }} />
            <Tile label="DAU" value={fmt(m.users.dau)} hint="активны за сутки" /><Tile label="WAU" value={fmt(m.users.wau)} hint="за 7 дней" /><Tile label="MAU" value={fmt(m.users.mau)} hint="за 30 дней" />
            <Tile label="удержание 7 дн" value={fmt(m.users.retention7, "%")} hint="вернулись через неделю" /><Tile label="удержание 30 дн" value={fmt(m.users.retention30, "%")} />
          </div></div>
          <div className="card"><h2>Игры</h2><div className="tiles">
            <Tile label="игр всего" value={fmt(m.games.total)} hint={`черновиков ${m.games.draft}`} /><Tile label="идут" value={fmt(m.games.active)} /><Tile label="завершены" value={fmt(m.games.finished)} />
            <Tile label={`создано за ${days} дн`} value={fmt(m.games.createdInPeriod)} trend={m.series.games} dates={d} delta={{ now: m.games.createdInPeriod, prev: m.previous.games, days }} />
            <Tile label="длительность" value={fmt(m.games.avgDurationDays, " дн")} hint="среднее по завершённым" />
            <Tile label="команд" value={fmt(m.games.teams)} /><Tile label="размер команды" value={fmt(m.games.avgTeamSize)} hint="в среднем" /><Tile label="организаций" value={fmt(m.games.organizations)} />
          </div></div>
          <div className="card"><h2>Активность</h2><div className="tiles">
            <Tile label={`сдач дел за ${days} дн`} value={fmt(m.activity.submissionsInPeriod)} hint={`всего ${m.activity.submissionsTotal}`} trend={m.series.submissions} dates={d} delta={{ now: m.activity.submissionsInPeriod, prev: m.previous.submissions, days }} />
            <Tile label={`одобрено за ${days} дн`} value={fmt(sum(m.series.approvals))} hint={`доля одобренных ${fmt(m.activity.approvedShare, "%")}`} trend={m.series.approvals} dates={d} />
            <Tile label="до решения админа" value={fmt(m.activity.avgDecisionHours, " ч")} hint="в среднем" />
            <Tile label={`открыто узлов за ${days} дн`} value={fmt(m.nodesInPeriod)} hint={`пройдено сторон всего ${m.activity.edgesTraversed}`} trend={m.series.nodes} dates={d} delta={{ now: m.nodesInPeriod, prev: m.previous.nodes, days }} />
            <Tile label={`взято городов за ${days} дн`} value={fmt(m.activity.citiesCapturedInPeriod)} hint={`всего ${m.activity.citiesCaptured}`} trend={m.series.cities} dates={d} delta={{ now: m.activity.citiesCapturedInPeriod, prev: m.previous.cities, days }} />
          </div></div>
          <div className="card"><h2>Испытания городов</h2><div className="tiles">
            <Tile label={`объявлено за ${days} дн`} value={fmt(m.battles.declaredInPeriod)} hint={`всего ${m.battles.declared}`} trend={m.series.battles} dates={d} delta={{ now: m.battles.declaredInPeriod, prev: m.previous.battles, days }} />
            <Tile label="идут" value={fmt(m.battles.active)} /><Tile label="перешло претендентам" value={fmt(m.battles.won)} />
            <Tile label="устояли" value={fmt(m.battles.repelled)} /><Tile label="не завершено" value={fmt(m.battles.expired)} /><Tile label="средняя ставка" value={fmt(m.battles.avgBid, " ст.")} />
            <Tile label="время вызова" value={fmt(m.battles.avgAttackHours, " ч")} hint="в среднем" /><Tile label="суммарный режим" value={fmt(m.battles.sumMode)} hint="исчерпанные книги" />
          </div></div>
          <div className="card"><h2>Дипломатия</h2>{m.diplomacy.implemented ? <div className="tiles"><Tile label="запросов прохода" value={fmt(m.diplomacy.passRequests)} /><Tile label="одобрено" value={fmt(m.diplomacy.passApprovedShare, "%")} /><Tile label="посольств" value={fmt(m.diplomacy.embassies)} /></div> : <p className="muted">Дипломатия ещё не реализована: метрики появятся вместе с ней.</p>}</div>
          <div className="card"><h2>Техника</h2><div className="tiles">
            <Tile label="работает без перезапуска" value={fmt(m.tech.uptimeHours, " ч")} /><Tile label="почта" value={m.tech.mailEnabled ? "настроена" : "выключена"} />
            <Tile label="писем отправлено" value={fmt(m.tech.mailSent)} hint="с момента запуска" /><Tile label="не доставлено" value={fmt(m.tech.mailFailed)} /><Tile label="память" value={fmt(m.tech.memoryMb, " МБ")} hint={m.tech.node} />
            <Tile label="запросов к API" value={fmt(m.tech.requests)} hint="с момента запуска" />
            <Tile label="ошибок сервера (5xx)" value={fmt(m.tech.errors5xx)} hint={m.tech.lastErrorAt ? `последняя ${new Date(m.tech.lastErrorAt).toLocaleString("ru")} · ${m.tech.lastErrorRoute ?? ""}` : "ошибок не было"} />
            <Tile label="отказов клиенту (4xx)" value={fmt(m.tech.errors4xx)} hint="неверные данные, нет прав" />
            <Tile label="время ответа" value={fmt(m.tech.avgMs, " мс")} hint={`p95 ${fmt(m.tech.p95Ms, " мс")} · по ${m.tech.sample} запросам`} />
          </div><p className="hint">Подробности ошибок — в логах контейнера (docker logs lotw-app).</p></div>
        </>
      )}
    </>
  );
}
