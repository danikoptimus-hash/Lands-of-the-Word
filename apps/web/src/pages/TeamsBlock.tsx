import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, GAME_ROLE_LABEL, TEAM_ROLE_LABEL, type GameRole, type TeamDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { CopyField } from "../components/CopyField";
import { ActionMenu } from "../components/ActionMenu";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { Sheet } from "../components/Sheet";

interface Invite { captain: string; members: string }

/** Вкладка «Команды»: список команд с участниками, приглашения по ссылке, строка добавления снизу. */
export function TeamsBlock({ gameId, teamCount, status, version = 0, onChange, goToSettings }: { gameId: string; teamCount: number; status: string; version?: number; onChange?: () => void; goToSettings?: () => void }) {
  const [teams, setTeams] = useState<TeamDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ teamId: string; links: Invite | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const { confirm, notify } = useUi();
  const close = () => { setOpen(false); setError(null); };
  const fail = (err: unknown) => notify(err instanceof ApiError ? err.message : t("Ошибка сети"), "bad");

  const load = useCallback(() => api<{ teams: TeamDto[] }>(`/api/games/${gameId}/teams`).then((r) => { setTeams(r.teams); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  const reload = async () => { await load(); onChange?.(); };
  useEffect(() => { void load(); }, [load, teamCount, version]);

  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api(`/api/games/${gameId}/teams`, { method: "POST", body: JSON.stringify({ name }) }); setName(""); setOpen(false); notify(t("Команда добавлена")); await reload(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function toggleInvite(teamId: string) {
    if (invite?.teamId === teamId) { setInvite(null); return; }
    setInvite({ teamId, links: null });
    try {
      const mk = (role: "CAPTAIN" | "MEMBER") => api<{ invite: { path: string } }>(`/api/games/${gameId}/teams/${teamId}/invites`, { method: "POST", body: JSON.stringify({ role }) }).then((r) => window.location.origin + r.invite.path);
      const [captain, members] = await Promise.all([mk("CAPTAIN"), mk("MEMBER")]);
      setInvite({ teamId, links: { captain, members } });
    } catch (err) { setInvite(null); fail(err); }
  }
  async function remove(tm: TeamDto) {
    if (!(await confirm(t("Команда «{name}» будет удалена вместе с участниками.", { name: tm.name }), { title: t("Удалить команду?"), okLabel: t("Удалить"), danger: true }))) return;
    try { await api(`/api/games/${gameId}/teams/${tm.id}`, { method: "DELETE" }); notify(t("Команда удалена")); await reload(); }
    catch (err) { fail(err); }
  }
  async function patch(teamId: string, userId: string, body: { role?: "CAPTAIN" | "MEMBER"; gameRole?: GameRole }, done: string) {
    try { await api(`/api/games/${gameId}/teams/${teamId}/members/${userId}`, { method: "PATCH", body: JSON.stringify(body) }); notify(done); await reload(); }
    catch (err) { fail(err); }
  }
  async function kick(teamId: string, userId: string, nick: string) {
    if (!(await confirm(t("{nick} будет убран из команды.", { nick }), { title: t("Убрать участника?"), okLabel: t("Убрать"), danger: true }))) return;
    try { await api(`/api/games/${gameId}/teams/${teamId}/members/${userId}`, { method: "DELETE" }); notify(t("{nick} убран из команды", { nick })); await reload(); }
    catch (err) { fail(err); }
  }

  const full = (teams?.length ?? 0) >= teamCount;
  return (
    <div className="card">
      <div className="card-head">
        <h2><span className="ico"><Icon name="users" /></span>{t("Команды")} {teams && <span className="count">{t("{a} из {b}", { a: teams.length, b: teamCount })}</span>}</h2>
        {!full && <button type="button" className="sm" onClick={() => setOpen(true)} disabled={!teams}><Icon name="plus" />{t("Добавить")}</button>}
      </div>
      {teams && full && <p className="hint">{t("Команд по настройкам: {n}.", { n: teamCount })} {goToSettings && <a href="#settings" onClick={(e) => { e.preventDefault(); goToSettings(); }}>{t("Изменить в настройках")}</a>}</p>}
      {loadError ? <ErrorState onRetry={() => void load()} /> : !teams ? <LoadingState /> : teams.length === 0 ? <EmptyState inline icon="users" text={t("Команд пока нет: добавьте первую.")} /> : teams.map((tm) => (
        <div key={tm.id} className="team-block">
          <div className="row between nowrap">
            <TeamAvatar name={tm.name} color={tm.color} withName />
            <div className="row nowrap">
              <button type="button" className={(invite?.teamId === tm.id ? "" : "secondary ") + "sm"} onClick={() => void toggleInvite(tm.id)} aria-expanded={invite?.teamId === tm.id}><Icon name="link" />{t("Пригласить")}</button>
              {status === "DRAFT" && <ActionMenu label={t("Ещё")} items={[{ label: t("Удалить команду"), icon: "trash", danger: true, onSelect: () => void remove(tm) }]} />}
            </div>
          </div>
          {invite?.teamId === tm.id && (
            <div className="card flat invite-panel">
              {!invite.links ? <LoadingState rows={2} /> : (
                <>
                  <label>{t("Ссылка для капитана")}</label>
                  <CopyField value={invite.links.captain} label={t("Ссылка для капитана")} />
                  <label>{t("Ссылка для участников")}</label>
                  <CopyField value={invite.links.members} label={t("Ссылка для участников")} />
                  <p className="hint">{t("Действует 14 дней, до 20 человек.")}</p>
                </>
              )}
            </div>
          )}
          {tm.members.length === 0 ? <EmptyState inline icon="user" text={t("Пока никого: отправьте ссылку капитану.")} /> : (
            <ul className="list">
              {tm.members.map((m) => {
                const nick = m.user.displayName ?? m.user.nickname;
                return (
                  <li key={m.user.id}>
                    <div className="main"><span className="person"><span className="avatar">{nick.slice(0, 1).toUpperCase()}</span><span className="name">{nick}</span><Chip tone={m.role === "CAPTAIN" ? "accent" : "neutral"}>{TEAM_ROLE_LABEL[m.role]}</Chip></span></div>
                    <div className="side">
                      {m.role === "MEMBER" && (
                        <select value={m.gameRole} aria-label={t("Игровая роль")} onChange={(e) => void patch(tm.id, m.user.id, { gameRole: e.target.value as GameRole }, t("Роль сохранена"))}>
                          {(Object.keys(GAME_ROLE_LABEL) as GameRole[]).map((r) => <option key={r} value={r}>{r === "NONE" ? t("Без роли") : GAME_ROLE_LABEL[r]}</option>)}
                        </select>
                      )}
                      <ActionMenu label={t("Ещё")} items={[
                        m.role === "CAPTAIN"
                          ? { label: t("Снять капитана"), icon: "user", onSelect: () => void patch(tm.id, m.user.id, { role: "MEMBER" }, t("{nick} больше не капитан", { nick })) }
                          : { label: t("Сделать капитаном"), icon: "flag", onSelect: () => void patch(tm.id, m.user.id, { role: "CAPTAIN" }, t("{nick} теперь капитан", { nick })) },
                        { label: t("Убрать из команды"), icon: "trash", danger: true, sep: true, onSelect: () => void kick(tm.id, m.user.id, nick) },
                      ]} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
      {teams && teams.some((tm) => tm.members.length > 0) && <p className="hint">{t("Игровые роли — только у участников: капитан ведёт команду.")}</p>}
      {open && (
        <Sheet title={t("Новая команда")} onClose={close} size="sm"
          foot={<><button type="button" className="secondary" onClick={close}>{t("Отмена")}</button><button type="submit" form="team-form" disabled={busy || name.trim().length < 2}>{t("Добавить")}</button></>}>
          <form id="team-form" onSubmit={create}>
            <label htmlFor="tm-name">{t("Название команды")}</label>
            <input id="tm-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={40} autoFocus />
            <p className="hint">{t("Цвет назначится сам. Участников пригласите по ссылке после добавления.")}</p>
            {error && <p className="error">{error}</p>}
          </form>
        </Sheet>
      )}
    </div>
  );
}
