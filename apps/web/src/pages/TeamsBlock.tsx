import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, GAME_ROLE_LABEL, TEAM_ROLE_LABEL, type GameRole, type TeamDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { ActionMenu } from "../components/ActionMenu";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { Sheet } from "../components/Sheet";
import { ActivityBoard } from "./Journal";
import { Help } from "../components/Help";


/** Вкладка «Команды»: список команд с участниками, приглашения по ссылке, строка добавления снизу. */
export function TeamsBlock({ gameId, teamCount, status, version = 0, onChange, goToSettings }: { gameId: string; teamCount: number; status: string; version?: number; onChange?: () => void; goToSettings?: () => void }) {
  const [teams, setTeams] = useState<TeamDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Ссылка, которую не удалось положить в буфер: показывается один раз под строкой команды, чтобы выделить вручную. */
  const [fallback, setFallback] = useState<{ teamId: string; url: string } | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  /** Переименование команды: шторка с одним полем (решение владельца 22.09). */
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  /** Кнопка, с которой только что скопировали: полторы секунды показывает галочку (только она, не соседние). */
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
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
  /**
   * Приглашение одной кнопкой (решение владельца 21.09): нажатие создаёт ссылку и сразу кладёт её в буфер, без полей.
   * В Safari буфер доступен только из жеста, поэтому ссылка передаётся обещанием через ClipboardItem; где его нет —
   * дожидаемся ответа и пишем текст (Chrome и Firefox держат разрешение несколько секунд после нажатия).
   */
  async function inviteCopy(teamId: string, role: "CAPTAIN" | "MEMBER") {
    const key = `${teamId}:${role}`;
    setInviting(key); setFallback(null);
    const url = api<{ invite: { path: string } }>(`/api/games/${gameId}/teams/${teamId}/invites`, { method: "POST", body: JSON.stringify({ role }) }).then((r) => window.location.origin + r.invite.path);
    const done = role === "CAPTAIN" ? t("Ссылка для капитана скопирована: действует 14 дней") : t("Ссылка для участников скопирована: действует 14 дней, до 20 человек");
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": url.then((u) => new Blob([u], { type: "text/plain" })) })]);
      } else {
        await navigator.clipboard.writeText(await url);
      }
      notify(done); setCopiedKey(key); setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch (err) {
      if (err instanceof ApiError) { fail(err); return; }
      try { setFallback({ teamId, url: await url }); notify(t("Не удалось скопировать: выделите ссылку вручную"), "bad"); } catch (e) { fail(e); }
    } finally { setInviting(null); }
  }
  async function rename(e: FormEvent) {
    e.preventDefault(); if (!renaming) return;
    setBusy(true); setRenameError(null);
    try { await api(`/api/games/${gameId}/teams/${renaming.id}`, { method: "PATCH", body: JSON.stringify({ name: renaming.name }) }); setRenaming(null); notify(t("Команда переименована")); await reload(); }
    catch (err) { setRenameError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function remove(tm: TeamDto) {
    if (!(await confirm(t("Команда «{name}» будет удалена вместе с участниками.", { name: tm.name }), { title: t("Удалить команду?"), okLabel: t("Удалить"), danger: true }))) return;
    try { await api(`/api/games/${gameId}/teams/${tm.id}`, { method: "DELETE" }); notify(t("Команда удалена")); await reload(); }
    catch (err) { fail(err); }
  }
  async function patch(teamId: string, userId: string, body: { role?: "CAPTAIN" | "DEPUTY" | "MEMBER"; gameRole?: GameRole }, done: string) {
    try { await api(`/api/games/${gameId}/teams/${teamId}/members/${userId}`, { method: "PATCH", body: JSON.stringify(body) }); notify(done); await reload(); }
    catch (err) { fail(err); }
  }
  async function decideRole(teamId: string, userId: string, approve: boolean) {
    try { await api(`/api/games/${gameId}/teams/${teamId}/members/${userId}/role-decide`, { method: "POST", body: JSON.stringify({ approve }) }); notify(approve ? t("Роль одобрена") : t("Запрос роли отклонён")); await reload(); }
    catch (err) { fail(err); }
  }
  /** Перевод участника (по спискам молодёжного совета): выбор команды в собственном листе, без системных диалогов. */
  const [moving, setMoving] = useState<{ teamId: string; userId: string; nick: string } | null>(null);
  async function moveTo(to: TeamDto) {
    if (!moving) return;
    const { teamId, userId, nick } = moving;
    if (!(await confirm(t("{nick} перейдёт в команду «{team}» рядовым участником; взятые дела вернутся в список.", { nick, team: to.name }), { title: t("Перевести участника?"), okLabel: t("Перевести") }))) return;
    try { await api(`/api/games/${gameId}/teams/${teamId}/members/${userId}/move`, { method: "POST", body: JSON.stringify({ toTeamId: to.id }) }); notify(t("{nick} переведён в «{team}»", { nick, team: to.name })); setMoving(null); await reload(); }
    catch (err) { fail(err); }
  }
  async function penalize(tm: TeamDto) {
    if (!(await confirm(t("Игра сама выберет случайный концевой участок пути команды и аннулирует его: перекрёсток или ещё не взятый город за ним закроется (задания города начнутся заново), дело придётся сделать заново. Взятые города и старт не трогаются."), { title: t("Оштрафовать «{name}»?", { name: tm.name }), okLabel: t("Оштрафовать"), danger: true }))) return;
    try { const r = await api<{ message: string }>(`/api/games/${gameId}/teams/${tm.id}/penalty`, { method: "POST" }); notify(r.message); await reload(); }
    catch (err) { fail(err); }
  }
  async function kick(teamId: string, userId: string, nick: string) {
    if (!(await confirm(t("{nick} будет убран из команды.", { nick }), { title: t("Убрать участника?"), okLabel: t("Убрать"), danger: true }))) return;
    try { await api(`/api/games/${gameId}/teams/${teamId}/members/${userId}`, { method: "DELETE" }); notify(t("{nick} убран из команды", { nick })); await reload(); }
    catch (err) { fail(err); }
  }

  const full = (teams?.length ?? 0) >= teamCount;
  // «Лимит: 3 команд · Изменить»: одна строка перевода, последняя часть после « · » — ссылка в настройки.
  const limit = t("Лимит: {n} команд · Изменить", { n: teamCount }).split(" · ");
  return (
    <div className="card">
      <div className="card-head">
        <h2><span className="ico"><Icon name="users" /></span>{t("Команды")} {teams && <span className="count">{t("{a} из {b}", { a: teams.length, b: teamCount })}</span>}</h2>
        {!full && <button type="button" className="sm" onClick={() => setOpen(true)} disabled={!teams}><Icon name="plus" />{t("Добавить")}</button>}
      </div>
      {teams && full && <p className="hint">{limit[0]}{goToSettings && limit[1] && <> · <a href="#settings" onClick={(e) => { e.preventDefault(); goToSettings(); }}>{limit[1]}</a></>}</p>}
      {loadError ? <ErrorState onRetry={() => void load()} /> : !teams ? <LoadingState /> : teams.length === 0 ? <EmptyState inline icon="users" text={t("Команд пока нет: добавьте первую.")} /> : teams.map((tm) => (
        <div key={tm.id} className="team-block">
          <div className="row between nowrap">
            <TeamAvatar name={tm.name} color={tm.color} withName />
            <div className="row nowrap">
              <span className="invite-btns" role="group" aria-label={t("Пригласить")}>
                <button type="button" className="secondary sm" disabled={inviting === `${tm.id}:CAPTAIN`} title={t("Скопировать ссылку для капитана")} onClick={() => void inviteCopy(tm.id, "CAPTAIN")}><Icon name={copiedKey === `${tm.id}:CAPTAIN` ? "check" : "link"} />{t("Капитана")}</button>
                <button type="button" className="secondary sm" disabled={inviting === `${tm.id}:MEMBER`} title={t("Скопировать ссылку для участников")} onClick={() => void inviteCopy(tm.id, "MEMBER")}><Icon name={copiedKey === `${tm.id}:MEMBER` ? "check" : "link"} />{t("Участника")}</button>
              </span>
              <ActionMenu label={t("Ещё")} items={[
                { label: t("Переименовать"), icon: "edit", onSelect: () => { setRenameError(null); setRenaming({ id: tm.id, name: tm.name }); } },
                ...(status === "DRAFT" ? [{ label: t("Удалить команду"), icon: "trash", danger: true, onSelect: () => void remove(tm) }] : []),
                ...(status === "ACTIVE" && tm.status !== "defeated" ? [{ label: t("Оштрафовать: аннулировать участок пути"), icon: "alert", danger: true, onSelect: () => void penalize(tm) }] : []),
              ]} />
              {tm.status === "defeated" && <Chip tone="bad">{t("выбыла")}</Chip>}
            </div>
          </div>
          {fallback?.teamId === tm.id && <p className="hint invite-fallback"><a href={fallback.url}>{fallback.url}</a></p>}
          {tm.members.length === 0 ? <EmptyState inline icon="user" text={t("Пока никого: отправьте ссылку капитану.")} /> : (
            <ul className="list">
              {tm.members.map((m) => {
                const nick = m.user.displayName ?? m.user.nickname;
                return (
                  <li key={m.user.id}>
                    <div className="main"><span className="person"><span className="avatar">{nick.slice(0, 1).toUpperCase()}</span><span className="name">{nick}</span><Chip tone={m.role === "CAPTAIN" || m.role === "DEPUTY" ? "accent" : "neutral"}>{TEAM_ROLE_LABEL[m.role]}</Chip></span>
                      {m.pendingRole && <span className="row nowrap mt-1"><Chip tone="warn">{t("запрос: {role}", { role: m.pendingRole === "NONE" ? t("без роли") : GAME_ROLE_LABEL[m.pendingRole] })}</Chip><button type="button" className="sm" onClick={() => void decideRole(tm.id, m.user.id, true)}>{t("Одобрить")}</button><button type="button" className="ghost sm" onClick={() => void decideRole(tm.id, m.user.id, false)}>{t("Отклонить")}</button></span>}
                    </div>
                    <div className="side">
                      {m.role !== "CAPTAIN" && (
                        <select value={m.gameRole} aria-label={t("Игровая роль")} onChange={(e) => void patch(tm.id, m.user.id, { gameRole: e.target.value as GameRole }, t("Роль сохранена"))}>
                          {(Object.keys(GAME_ROLE_LABEL) as GameRole[]).map((r) => <option key={r} value={r}>{r === "NONE" ? t("Без роли") : GAME_ROLE_LABEL[r]}</option>)}
                        </select>
                      )}
                      <ActionMenu label={t("Ещё")} items={[
                        m.role === "CAPTAIN"
                          ? { label: t("Снять капитана"), icon: "user", onSelect: () => void patch(tm.id, m.user.id, { role: "MEMBER" }, t("{nick} больше не капитан", { nick })) }
                          : { label: t("Сделать капитаном"), icon: "flag", onSelect: () => void patch(tm.id, m.user.id, { role: "CAPTAIN" }, t("{nick} теперь капитан", { nick })) },
                        { label: t("Перевести в другую команду"), icon: "users", onSelect: () => setMoving({ teamId: tm.id, userId: m.user.id, nick }) },
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
      {moving && (
        <Sheet title={t("Перевести {nick}", { nick: moving.nick })} onClose={() => setMoving(null)} size="sm">
          <p className="hint">{t("В какую команду?")}</p>
          <ul className="list">
            {(teams ?? []).filter((tm) => tm.id !== moving.teamId && tm.status !== "defeated").map((tm) => (
              <li key={tm.id}><div className="main"><TeamAvatar name={tm.name} color={tm.color} withName /></div><div className="side"><button type="button" className="sm" onClick={() => void moveTo(tm)}>{t("Перевести")}</button></div></li>
            ))}
          </ul>
        </Sheet>
      )}
      {renaming && (
        <Sheet title={t("Переименовать команду")} onClose={() => setRenaming(null)} size="sm"
          foot={<><button type="button" className="secondary" onClick={() => setRenaming(null)}>{t("Отмена")}</button><button type="submit" form="team-rename" disabled={busy || renaming.name.trim().length < 2}>{t("Сохранить")}</button></>}>
          <form id="team-rename" onSubmit={rename}>
            <label htmlFor="tm-rename">{t("Название команды")}</label>
            <input id="tm-rename" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} required minLength={2} maxLength={40} autoFocus />
            {renameError && <p className="error">{renameError}</p>}
          </form>
        </Sheet>
      )}
      {open && (
        <Sheet title={t("Новая команда")} onClose={close} size="sm"
          foot={<><button type="button" className="secondary" onClick={close}>{t("Отмена")}</button><button type="submit" form="team-form" disabled={busy || name.trim().length < 2}>{t("Добавить")}</button></>}>
          <form id="team-form" onSubmit={create}>
            <label htmlFor="tm-name">{t("Название команды")}</label>
            <input id="tm-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={40} autoFocus />
            <p className="hint">{t("Цвет назначится сам; ссылки для приглашения — после добавления.")}</p>
            {error && <p className="error">{error}</p>}
          </form>
        </Sheet>
      )}
      {status !== "DRAFT" && (
        <details className="card fold-card">
          <summary><Icon name="star" />{t("Активность участников")}<Icon name="chevron-down" className="chev" /></summary>
          <Help block>{t("Дела считаются и участникам групповых дел. Самые активные сверху.")}</Help>
          <ActivityBoard gameId={gameId} version={version} />
        </details>
      )}
    </div>
  );
}
