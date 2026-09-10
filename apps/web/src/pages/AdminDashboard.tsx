import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";

interface Metrics {
  period: { days: number; since: string };
  users: { total: number; newInPeriod: number; dau: number; wau: number; mau: number; retention7: number | null; retention30: number | null };
  games: { total: number; draft: number; active: number; finished: number; createdInPeriod: number; avgDurationDays: number | null; teams: number; avgTeamSize: number | null; organizations: number };
  activity: { submissionsInPeriod: number; submissionsTotal: number; approvedShare: number | null; avgDecisionHours: number | null; edgesTraversed: number; citiesCaptured: number; citiesCapturedInPeriod: number };
  battles: { declared: number; declaredInPeriod: number; expired: number; won: number; repelled: number; active: number; avgBid: number | null; avgAttackHours: number | null; sumMode: number };
  diplomacy: { implemented: boolean; passRequests: number; passApprovedShare: number | null; embassies: number };
  tech: { uptimeHours: number | null; mailEnabled: boolean; mailSent: number; mailFailed: number; node: string; memoryMb: number };
}
const fmt = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v}${suffix}`);

/** Дашборд суперадмина: обобщённые метрики платформы по группам из документации (4.1). Без содержимого игр и без людей. */
export function AdminDashboard() {
  const { user } = useAuth();
  const [days, setDays] = useState(30);
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (user?.platformRole === "SUPERADMIN") api<Metrics>(`/api/admin/metrics?days=${days}`).then(setM).catch((e) => setError(e instanceof ApiError ? e.message : "Ошибка сети")); }, [days, user]);
  if (!user) return null;
  if (user.platformRole !== "SUPERADMIN") return <Navigate to="/" replace />;
  const Tile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => <div className="tile"><div className="value">{value}</div><div className="label">{label}</div>{hint && <div className="hint">{hint}</div>}</div>;
  return (
    <>
      <p><Link to="/">← Мои игры</Link></p>
      <div className="card-head">
        <h1>Аналитика платформы</h1>
        <div className="row">
          <span className="muted">период:</span>
          {[7, 30, 90].map((d) => <button key={d} className={"sm " + (d === days ? "" : "secondary")} onClick={() => setDays(d)}>{d} дн</button>)}
        </div>
      </div>
      <p className="muted">Только обобщённые числа: без содержимого игр и без привязки к людям.</p>
      {error && <p className="error">{error}</p>}
      {!m && !error && <p className="muted">Считаем…</p>}
      {m && (
        <>
          <div className="card"><h2>Пользователи</h2><div className="tiles">
            <Tile label="всего" value={fmt(m.users.total)} /><Tile label={`новых за ${days} дн`} value={fmt(m.users.newInPeriod)} />
            <Tile label="DAU" value={fmt(m.users.dau)} hint="активны за сутки" /><Tile label="WAU" value={fmt(m.users.wau)} hint="за 7 дней" /><Tile label="MAU" value={fmt(m.users.mau)} hint="за 30 дней" />
            <Tile label="удержание 7 дн" value={fmt(m.users.retention7, "%")} hint="вернулись через неделю" /><Tile label="удержание 30 дн" value={fmt(m.users.retention30, "%")} />
          </div></div>
          <div className="card"><h2>Игры</h2><div className="tiles">
            <Tile label="игр всего" value={fmt(m.games.total)} hint={`черновиков ${m.games.draft}`} /><Tile label="идут" value={fmt(m.games.active)} /><Tile label="завершены" value={fmt(m.games.finished)} />
            <Tile label={`создано за ${days} дн`} value={fmt(m.games.createdInPeriod)} /><Tile label="длительность" value={fmt(m.games.avgDurationDays, " дн")} hint="среднее по завершённым" />
            <Tile label="команд" value={fmt(m.games.teams)} /><Tile label="размер команды" value={fmt(m.games.avgTeamSize)} hint="в среднем" /><Tile label="организаций" value={fmt(m.games.organizations)} />
          </div></div>
          <div className="card"><h2>Активность</h2><div className="tiles">
            <Tile label={`сдач дел за ${days} дн`} value={fmt(m.activity.submissionsInPeriod)} hint={`всего ${m.activity.submissionsTotal}`} /><Tile label="доля одобренных" value={fmt(m.activity.approvedShare, "%")} />
            <Tile label="до решения админа" value={fmt(m.activity.avgDecisionHours, " ч")} hint="в среднем" /><Tile label="пройдено сторон" value={fmt(m.activity.edgesTraversed)} />
            <Tile label="взято городов" value={fmt(m.activity.citiesCaptured)} hint={`за ${days} дн: ${m.activity.citiesCapturedInPeriod}`} />
          </div></div>
          <div className="card"><h2>Битвы</h2><div className="tiles">
            <Tile label="объявлено" value={fmt(m.battles.declared)} hint={`за ${days} дн: ${m.battles.declaredInPeriod}`} /><Tile label="идут" value={fmt(m.battles.active)} /><Tile label="взято атакой" value={fmt(m.battles.won)} />
            <Tile label="отбито" value={fmt(m.battles.repelled)} /><Tile label="сгорело" value={fmt(m.battles.expired)} /><Tile label="средняя ставка" value={fmt(m.battles.avgBid, " ст.")} />
            <Tile label="время атаки" value={fmt(m.battles.avgAttackHours, " ч")} hint="в среднем" /><Tile label="суммарный режим" value={fmt(m.battles.sumMode)} hint="исчерпанные книги" />
          </div></div>
          <div className="card"><h2>Дипломатия</h2>{m.diplomacy.implemented ? <div className="tiles"><Tile label="запросов прохода" value={fmt(m.diplomacy.passRequests)} /><Tile label="одобрено" value={fmt(m.diplomacy.passApprovedShare, "%")} /><Tile label="посольств" value={fmt(m.diplomacy.embassies)} /></div> : <p className="muted">Дипломатия ещё не реализована: метрики появятся вместе с ней.</p>}</div>
          <div className="card"><h2>Техника</h2><div className="tiles">
            <Tile label="работает без перезапуска" value={fmt(m.tech.uptimeHours, " ч")} /><Tile label="почта" value={m.tech.mailEnabled ? "настроена" : "выключена"} />
            <Tile label="писем отправлено" value={fmt(m.tech.mailSent)} hint="с момента запуска" /><Tile label="не доставлено" value={fmt(m.tech.mailFailed)} /><Tile label="память" value={fmt(m.tech.memoryMb, " МБ")} hint={m.tech.node} />
          </div><p className="hint">Ошибки и время ответа сервера — в логах контейнера (`docker logs lotw-app`); отдельного сбора пока нет.</p></div>
        </>
      )}
    </>
  );
}
