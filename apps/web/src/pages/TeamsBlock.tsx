import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, GAME_ROLE_ICON, GAME_ROLE_LABEL, TEAM_ROLE_LABEL, type GameRole, type StandingRow, type StandingsDto, type TeamDto } from "../lib/api";
import { Link } from "react-router-dom";
import { plural } from "../lib/format";
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
  /** Кому раскрыт ряд игровых ролей (пилюли вместо системного списка, 23.09). */
  const [pick, setPick] = useState<string | null>(null);
  /** Положение команд и список участников — один раздел (решение владельца 23.09): строка команды с местом и цифрами,
   * по нажатию раскрываются участники, приглашения и меню. */
  const [standings, setStandings] = useState<StandingsDto | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const { confirm, notify } = useUi();
  const close = () => { setOpen(false); setError(null); };
  const fail = (err: unknown) => notify(err instanceof ApiError ? err.message : t("Ошибка сети"), "bad");

  const load = useCallback(() => api<{ teams: TeamDto[] }>(`/api/games/${gameId}/teams`).then((r) => { setTeams(r.teams); setLoadError(false); }).catch(() => setLoadError(true)), [gameId]);
  useEffect(() => { if (status === "DRAFT") { setStandings(null); return; } api<StandingsDto>(`/api/games/${gameId}/standings`).then(setStandings).catch(() => {}); }, [gameId, status, version]);
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
        {standings && <Link to={`/games/${gameId}/book`} className="btn secondary sm"><Icon name="book" />{t("Книга сезона")}</Link>}
        {!full && <button type="button" className="sm" onClick={() => setOpen(true)} disabled={!teams}><Icon name="plus" />{t("Добавить")}</button>}
      </div>
      {teams && full && <p className="hint">{limit[0]}{goToSettings && limit[1] && <> · <a href="#settings" onClick={(e) => { e.preventDefault(); goToSettings(); }}>{limit[1]}</a></>}</p>}
      {standings && <p className="hint">{t("Нажмите на команду, чтобы увидеть участников. Испытания: выиграли · устояли · потеряли.")}</p>}
      {loadError ? <ErrorState onRetry={() => void load()} /> : !teams ? <LoadingState /> : teams.length === 0 ? <EmptyState inline icon="users" text={t("Команд пока нет: добавьте первую.")} /> : ordered(teams, standings).map(({ tm, st, rank }) => {
        const isOpen = expanded === tm.id;
        const toggle = () => setExpanded(isOpen ? null : tm.id);
        return (
        <div key={tm.id} className={"team-block" + (isOpen ? " open" : "") + (st?.status === "defeated" ? " out" : "")}>
          <div className="team-head" role="button" tabIndex={0} aria-expanded={isOpen} onClick={toggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
            {st && <span className="rank">{rank}</span>}
            <TeamAvatar name={tm.name} color={tm.color} />
            <div className="body">
              <div className="name">{tm.name}
                {st?.status === "defeated" ? <Chip tone="bad">{t("выбыла")}</Chip> : standings?.leaderTeamId === tm.id ? <Chip tone="accent">{t("лидер")}</Chip> : null}
                <span className="team-menu" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <ActionMenu label={t("Ещё")} items={[
                { label: t("Переименовать"), icon: "edit", onSelect: () => { setRenameError(null); setRenaming({ id: tm.id, name: tm.name }); } },
                ...(status === "DRAFT" ? [{ label: t("Удалить команду"), icon: "trash", danger: true, onSelect: () => void remove(tm) }] : []),
                ...(status === "ACTIVE" && tm.status !== "defeated" ? [{ label: t("Оштрафовать"), icon: "alert", danger: true, onSelect: () => void penalize(tm) }] : []),
              ]} />
                </span>
              </div>
              <div className="nums">{plural(tm.members.length, ["участник", "участника", "участников"])}{st && <> · {plural(st.cities, ["город", "города", "городов"])} · {plural(st.capitals, ["столица", "столицы", "столиц"])} · {plural(st.deedsApproved, ["дело", "дела", "дел"])}</>}</div>
              {st && <div className="nums">{t("Испытания {a} · {b} · {c}", { a: st.battlesWon, b: st.battlesRepelled, c: st.battlesLost })}</div>}
            </div>
            <Icon name="chevron" className="chev" />
          </div>
          {isOpen && (<>
          <div className="row team-invites">
            <span className="muted small">{t("Пригласить")}:</span>
            <span className="invite-btns" role="group" aria-label={t("Пригласить")}>
              <button type="button" className="secondary sm" disabled={inviting === `${tm.id}:CAPTAIN`} title={t("Скопировать ссылку для капитана")} onClick={() => void inviteCopy(tm.id, "CAPTAIN")}><Icon name={copiedKey === `${tm.id}:CAPTAIN` ? "check" : "link"} />{t("Капитана")}</button>
              <button type="button" className="secondary sm" disabled={inviting === `${tm.id}:MEMBER`} title={t("Скопировать ссылку для участников")} onClick={() => void inviteCopy(tm.id, "MEMBER")}><Icon name={copiedKey === `${tm.id}:MEMBER` ? "check" : "link"} />{t("Участника")}</button>
            </span>
          </div>
          {fallback?.teamId === tm.id && <p className="hint invite-fallback"><a href={fallback.url}>{fallback.url}</a></p>}
          {tm.members.length === 0 ? <EmptyState inline icon="user" text={t("Пока никого: отправьте ссылку капитану.")} /> : (
            <ul className="list">
              {tm.members.map((m) => {
                const nick = m.user.displayName ?? m.user.nickname;
                const picking = pick === m.user.id;
                return (
                  <li key={m.user.id} className="member-row">
                    <div className="main"><span className="person"><span className="avatar">{nick.slice(0, 1).toUpperCase()}</span><span className="name">{nick}</span>{(m.role === "CAPTAIN" || m.role === "DEPUTY") && <Chip tone="accent" icon={m.role === "CAPTAIN" ? "crown" : "star"}>{TEAM_ROLE_LABEL[m.role]}</Chip>}</span>
                    </div>
                    <div className="side">
                      {m.role !== "CAPTAIN" && (
                        <button type="button" className={"chip-btn role-pick" + (m.gameRole === "NONE" ? " none" : "")} aria-label={t("Игровая роль")} aria-expanded={picking} onClick={() => setPick(picking ? null : m.user.id)}>
                          <Chip tone={m.gameRole === "NONE" ? "neutral" : "info"} icon={m.gameRole === "NONE" ? undefined : GAME_ROLE_ICON[m.gameRole]}>{m.gameRole === "NONE" ? t("без роли") : GAME_ROLE_LABEL[m.gameRole]}<Icon name="chevron" className="chev" /></Chip>
                        </button>
                      )}
                      <ActionMenu label={t("Ещё")} items={[
                        m.role === "CAPTAIN"
                          ? { label: t("Снять капитана"), icon: "user", onSelect: () => void patch(tm.id, m.user.id, { role: "MEMBER" }, t("{nick} больше не капитан", { nick })) }
                          : { label: t("Сделать капитаном"), icon: "flag", onSelect: () => void patch(tm.id, m.user.id, { role: "CAPTAIN" }, t("{nick} теперь капитан", { nick })) },
                        { label: t("Перевести в другую команду"), icon: "users", onSelect: () => setMoving({ teamId: tm.id, userId: m.user.id, nick }) },
                        { label: t("Убрать из команды"), icon: "trash", danger: true, sep: true, onSelect: () => void kick(tm.id, m.user.id, nick) },
                      ]} />
                    </div>
                    {picking && (
                      <div className="role-tray compact" role="group" aria-label={t("Игровая роль")}>
                        {(Object.keys(GAME_ROLE_LABEL).filter((r) => r !== "NONE") as GameRole[]).map((r) => (
                          <button key={r} type="button" className={"chip-btn" + (r === m.gameRole ? " on" : "")} aria-pressed={r === m.gameRole} onClick={() => { setPick(null); void patch(tm.id, m.user.id, { gameRole: r === m.gameRole ? "NONE" : r }, t("Роль сохранена")); }}>
                            <Chip tone={r === m.gameRole ? "solid" : "neutral"} icon={GAME_ROLE_ICON[r]}>{GAME_ROLE_LABEL[r]}</Chip>
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          </>)}
        </div>
        );
      })}
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

/** Команды в порядке положения (когда игра идёт), иначе по номеру; вместе со строкой положения и местом. */
function ordered(teams: TeamDto[], standings: StandingsDto | null): Array<{ tm: TeamDto; st: StandingRow | null; rank: number }> {
  if (!standings) return teams.map((tm, i) => ({ tm, st: null, rank: i + 1 }));
  const byId = new Map(standings.standings.map((st, i) => [st.teamId, { st, rank: i + 1 }]));
  return [...teams].sort((a, b) => (byId.get(a.id)?.rank ?? 99) - (byId.get(b.id)?.rank ?? 99)).map((tm) => ({ tm, st: byId.get(tm.id)?.st ?? null, rank: byId.get(tm.id)?.rank ?? 0 }));
}
