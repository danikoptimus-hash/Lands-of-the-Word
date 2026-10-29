import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api, ApiError, GAME_ROLE_LABEL, TEAM_ROLE_LABEL, type GameRole, type TeamRole } from "../lib/api";
import { useAuth } from "../lib/auth";
import { t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Back } from "../components/Back";
import { Chip } from "../components/Chip";
import { Help } from "../components/Help";
import { UserAvatar } from "../components/UserAvatar";
import { TeamAvatar } from "../components/TeamAvatar";
import { EmptyState, ErrorState, LoadingState } from "../components/State";

/**
 * Люди платформы (решение владельца 30.10): все учётки — ник, имя, почта, аватарка, вход через Google, когда
 * зарегистрировался и когда заходил, в каких играх и командах состоит и с какой ролью, где администратор. Только для
 * администратора платформы, только чтение. Поиск по нику, имени и почте.
 */
interface Row {
  id: string; nickname: string; displayName: string | null; email: string | null; emailVerified: boolean; google: boolean; locale: string; platformRole: "USER" | "SUPERADMIN"; avatarId: string | null;
  createdAt: string; lastSeenAt: string | null; locked: boolean; deeds: number;
  memberships: Array<{ role: TeamRole; gameRole: GameRole; joinedAt: string; team: { id: string; name: string; color: string; avatarId?: string | null }; game: { id: string; name: string; status: string } }>;
  admins: Array<{ id: string; name: string; status: string }>;
}

function ago(iso: string | null): string {
  if (!iso) return t("не заходил");
  const d = Date.now() - Date.parse(iso);
  if (d < 60_000) return t("только что");
  if (d < 3_600_000) return t("{n} мин назад", { n: Math.floor(d / 60_000) });
  if (d < 86_400_000) return t("{n} ч назад", { n: Math.floor(d / 3_600_000) });
  if (d < 2 * 86_400_000) return t("вчера");
  if (d < 7 * 86_400_000) return t("{n} дн назад", { n: Math.floor(d / 86_400_000) });
  return fmtDate(iso, { time: false });
}

export function AdminUsersPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const load = () => { setError(null); api<{ users: Row[] }>("/api/admin/users").then((r) => setRows(r.users)).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); };
  useEffect(() => { if (user?.platformRole === "SUPERADMIN") load(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!rows) return [];
    if (!needle) return rows;
    return rows.filter((r) => [r.nickname, r.displayName ?? "", r.email ?? "", ...r.memberships.map((m) => `${m.team.name} ${m.game.name}`)].some((s) => s.toLowerCase().includes(needle)));
  }, [rows, q]);
  if (!user) return null;
  if (user.platformRole !== "SUPERADMIN") return <Navigate to="/" replace />;
  const week = Date.now() - 7 * 86_400_000;
  const stats = rows ? { total: rows.length, week: rows.filter((r) => r.lastSeenAt && Date.parse(r.lastSeenAt) >= week).length, verified: rows.filter((r) => r.emailVerified).length, google: rows.filter((r) => r.google).length } : null;
  return (
    <div className="page admin-dashboard admin-users">
      <Back to="/admin/games" label={t("Все игры")} />
      <div className="page-head">
        <h1><span className="ico"><Icon name="users" /></span>{t("Люди")}</h1>
        <Help>{t("Все учётки платформы: ник, имя, почта, вход через Google, игры и команды. Только просмотр. Сверху те, кто заходил последним.")}</Help>
      </div>
      {stats && (
        <p className="meta users-stats">
          <span><Icon name="users" />{t("Учёток: {n}", { n: stats.total })}</span>
          <span><Icon name="sparkle" />{t("за неделю заходили: {n}", { n: stats.week })}</span>
          <span><Icon name="mail" />{t("почта подтверждена: {n}", { n: stats.verified })}</span>
          <span><Icon name="link" />{t("через Google: {n}", { n: stats.google })}</span>
        </p>
      )}
      <div className="field users-search">
        <label htmlFor="users-q" className="sr-only">{t("Поиск")}</label>
        <input id="users-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Поиск по нику, имени, почте, команде или игре")} autoComplete="off" />
      </div>
      {error && <div className="card"><ErrorState text={error} onRetry={load} /></div>}
      {!rows && !error && <div className="card"><LoadingState rows={3} /></div>}
      {rows && shown.length === 0 && <div className="card"><EmptyState inline icon="users" text={t("Таких учёток нет.")} /></div>}
      {rows && shown.length > 0 && (
        <ul className="list users-list card">
          {shown.map((r) => {
            const name = r.displayName || r.nickname;
            return (
              <li key={r.id} className="user-row">
                <div className="main">
                  <span className="person"><UserAvatar name={name} avatarId={r.avatarId} zoom={Boolean(r.avatarId)} /><span className="name">{r.nickname}{r.displayName && <span className="muted"> · {r.displayName}</span>}</span></span>
                  <span className="meta chips">
                    {r.email
                      ? <Chip tone={r.emailVerified ? "ok" : "warn"} icon="mail" title={r.emailVerified ? t("почта подтверждена") : t("почта не подтверждена")}>{r.email}</Chip>
                      : <Chip tone="neutral" icon="mail">{t("без почты")}</Chip>}
                    {r.google && <Chip tone="info" icon="link">Google</Chip>}
                    {r.platformRole === "SUPERADMIN" && <Chip tone="accent" icon="crown">{t("администратор платформы")}</Chip>}
                    {r.locked && <Chip tone="bad" icon="lock">{t("вход заблокирован")}</Chip>}
                    <Chip tone="neutral" icon="scroll" title={t("Одобренных дел")}>{r.deeds}</Chip>
                    <Chip tone="neutral">{r.locale.toUpperCase()}</Chip>
                  </span>
                  <span className="meta">
                    <span title={t("Зарегистрирован")}><Icon name="edit" />{fmtDate(r.createdAt, { time: false })}</span>
                    <span title={t("Последний вход")}><Icon name="clock" />{ago(r.lastSeenAt)}</span>
                  </span>
                  {(r.memberships.length > 0 || r.admins.length > 0) && (
                    <span className="meta chips user-games">
                      {r.memberships.map((m) => (
                        <Link key={m.team.id} to={`/games/${m.game.id}`} className="chip-link" title={`${m.game.name} · ${TEAM_ROLE_LABEL[m.role]}${m.gameRole !== "NONE" ? ` · ${GAME_ROLE_LABEL[m.gameRole]}` : ""}`}>
                          <TeamAvatar name={m.team.name} color={m.team.color} avatarId={m.team.avatarId} size="sm" zoom={false} />
                          <span>{m.team.name}<span className="muted"> · {m.game.name}</span>{m.role !== "MEMBER" && <span className="muted"> · {TEAM_ROLE_LABEL[m.role]}</span>}{m.gameRole !== "NONE" && <span className="muted"> · {GAME_ROLE_LABEL[m.gameRole]}</span>}</span>
                        </Link>
                      ))}
                      {r.admins.map((g) => <Link key={g.id} to={`/games/${g.id}`} className="chip-link admin" title={t("администратор игры")}><Icon name="settings" /><span>{g.name}</span></Link>)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {rows && <p className="muted small">{plural(shown.length, ["учётка", "учётки", "учёток"])}</p>}
    </div>
  );
}
