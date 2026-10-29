import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Back } from "../components/Back";
import { Chip } from "../components/Chip";
import { Tabs } from "../components/Tabs";
import { Help } from "../components/Help";
import { EmptyState, ErrorState, LoadingState } from "../components/State";

/**
 * Все игры платформы (решение владельца 14.10): администратор платформы видит каждую игру и заходит в неё
 * наблюдателем — глазами администратора, только чтение, участники и администраторы его не видят.
 * Сверху самые живые: сортировка по активности за 7 дней (записи журнала и сдачи дел), потом по последнему событию.
 */
interface Row {
  id: string; name: string; status: "DRAFT" | "ACTIVE" | "FINISHED"; timeZone: string; teamCount: number; teams: number; admins: number; mapReady: boolean;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  players: number; playersDay: number; playersWeek: number; activity: number; pending: number; lastActivityAt: string | null;
}
type Filter = "all" | "ACTIVE" | "DRAFT" | "FINISHED";

/** «5 мин назад», «3 ч назад», «вчера», дальше — дата. */
/** Текущее время в поясе игры («14:32»); незнакомый пояс — прочерк. */
function zoneNow(zone: string): string {
  try { return new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()); } catch { return "—"; }
}
function ago(iso: string | null): string {
  if (!iso) return t("событий не было");
  const d = Date.now() - Date.parse(iso);
  if (d < 60_000) return t("только что");
  if (d < 3_600_000) return t("{n} мин назад", { n: Math.floor(d / 60_000) });
  if (d < 86_400_000) return t("{n} ч назад", { n: Math.floor(d / 3_600_000) });
  if (d < 2 * 86_400_000) return t("вчера");
  if (d < 7 * 86_400_000) return t("{n} дн назад", { n: Math.floor(d / 86_400_000) });
  return fmtDate(iso, { time: false });
}

export function AllGamesPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const load = () => { setError(null); api<{ games: Row[] }>("/api/admin/games").then((r) => setRows(r.games)).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); };
  useEffect(() => { if (user?.platformRole === "SUPERADMIN") load(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null;
  if (user.platformRole !== "SUPERADMIN") return <Navigate to="/" replace />;
  const shown = (rows ?? []).filter((r) => filter === "all" || r.status === filter);
  const n = (st: Filter) => (rows ?? []).filter((r) => st === "all" || r.status === st).length;
  return (
    <div className="page admin-dashboard all-games">
      <Back to="/" label={t("Мои игры")} />
      <div className="page-head">
        <h1><span className="ico"><Icon name="eye" /></span>{t("Все игры")}</h1>
        <Link to="/admin/users" className="btn secondary sm"><Icon name="users" />{t("Люди")}</Link>
        <Help>{t("Каждая игра открывается глазами её администратора, но только для просмотра: изменить ничего нельзя, участники и администраторы вашего присутствия не видят. Сверху самые живые игры: активность — записи летописи и сдачи дел за 7 дней.")}</Help>
      </div>
      <Tabs<Filter> value={filter} onChange={setFilter} ariaLabel={t("Состояние")} items={[
        { key: "all", label: `${t("Все")} · ${n("all")}` }, { key: "ACTIVE", label: `${t("Идут")} · ${n("ACTIVE")}` }, { key: "DRAFT", label: `${t("Черновики")} · ${n("DRAFT")}` }, { key: "FINISHED", label: `${t("Завершены")} · ${n("FINISHED")}` },
      ]} />
      {error && <div className="card"><ErrorState text={error} onRetry={load} /></div>}
      {!rows && !error && <div className="card"><LoadingState rows={3} /></div>}
      {rows && shown.length === 0 && <div className="card"><EmptyState inline icon="map" text={t("Таких игр нет.")} /></div>}
      {rows && shown.length > 0 && (
        <div className="cards">
          {shown.map((g) => (
            <Link key={g.id} to={`/games/${g.id}`} className="home-card game-card all-games-card">
              <div className="main">
                <div className="title">
                  <span className="name">{g.name}</span>
                  <Chip tone={g.status === "DRAFT" ? "warn" : g.status === "ACTIVE" ? "ok" : "neutral"}>{g.status === "DRAFT" ? t("черновик") : g.status === "ACTIVE" ? t("идёт") : t("завершена")}</Chip>
                  {g.activity > 0 && <Chip tone="accent" icon="sparkle" title={t("Событий за 7 дней")}>{g.activity}</Chip>}
                  {g.pending > 0 && <Chip tone="info" icon="clock" title={t("Сдач ждёт проверки")}>{g.pending}</Chip>}
                </div>
                <div className="meta">
                  <span title={t("Часовой пояс игры и время в нём сейчас")}><Icon name="clock" />{g.timeZone} · {zoneNow(g.timeZone)}</span>
                  <span title={t("Команд")}><Icon name="shield" />{g.teams}</span>
                  <span title={t("Игроков")}><Icon name="users" />{g.players}</span>
                  <span title={t("Последнее событие")}><Icon name="sparkle" />{g.lastActivityAt ? ago(g.lastActivityAt) : "—"}</span>
                  <span title={g.status === "DRAFT" ? t("Создана") : g.status === "ACTIVE" ? t("Начата") : t("Завершена")}><Icon name={g.status === "DRAFT" ? "edit" : g.status === "ACTIVE" ? "play" : "trophy"} />{fmtDate(g.status === "DRAFT" ? g.createdAt : g.status === "ACTIVE" ? g.startedAt ?? g.createdAt : g.finishedAt ?? g.createdAt, { time: false })}</span>
                  {g.status === "DRAFT" && !g.mapReady && <span className="warn" title={t("Карта не создана")}><Icon name="map" /><Icon name="x" /></span>}
                </div>
              </div>
              <div className="side"><Icon name="chevron" /></div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
