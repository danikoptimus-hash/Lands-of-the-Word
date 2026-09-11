import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BOOKS, directionBetween, parseVertexKey } from "@lotw/domain";
import { api, ApiError, BATTLE_STATUS_LABEL, GAME_ROLE_LABEL, PROOF_LABEL, TASK_STATUS_LABEL, TEAM_ROLE_LABEL, type BattleDto, type EdgeTaskDto, type GameRole, type MyMapDto, type StandingsDto, type TeamDto } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useRef } from "react";
import { useGameEvents } from "../lib/useGameEvents";
import { TeamMap } from "./TeamMap";
import { CityPopup } from "./CityPopup";
import { BattleCard } from "./BattlePanel";
import { DiplomacyMenu } from "./Diplomacy";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

/** Страница команды: карта во весь экран, всплывающая карточка дела, выдвижная панель с делами и составом. */
export function TeamPage() {
  const { id = "" } = useParams();
  const { user, logout } = useAuth();
  const [team, setTeam] = useState<TeamDto | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [map, setMap] = useState<MyMapDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [cityKey, setCityKey] = useState<string | null>(null);
  const [cityVersion, setCityVersion] = useState(0);
  const [battles, setBattles] = useState<BattleDto[]>([]);
  const [standings, setStandings] = useState<StandingsDto | null>(null);
  const loadStandings = useCallback(() => api<StandingsDto>(`/api/games/${id}/standings`).then(setStandings).catch(() => {}), [id]);
  const [now, setNow] = useState(Date.now());
  const { notify } = useUi();
  const seenBattles = useRef<Map<string, string> | null>(null);
  const loadBattles = useCallback(() => api<{ battles: BattleDto[] }>(`/api/games/${id}/my-battles`).then((r) => {
    // Живые оповещения: новая атака на наш город, старт обороны, итог битвы.
    const prev = seenBattles.current;
    if (prev) for (const b of r.battles) {
      const was = prev.get(b.id);
      if (was === b.status) continue;
      const mine = team && b.defender.id === team.id;
      if (!was && mine && b.status === "ATTACK") notify(t("Вашему городу {city} брошен вызов: {n} стихов!", { city: BOOK_BY_CODE.get(b.bookCode)?.nameRu ?? "", n: b.bid }), "bad");
      else if (was && mine && b.status === "DEFENSE") notify(t("Вызов городу {city} одобрен: пошло время ответа!", { city: BOOK_BY_CODE.get(b.bookCode)?.nameRu ?? t("город") }), "bad");
      else if (was && (b.status === "WON" || b.status === "REPELLED" || b.status === "EXPIRED")) notify(t("Испытание города {city}: {status}", { city: BOOK_BY_CODE.get(b.bookCode)?.nameRu ?? t("город"), status: BATTLE_STATUS_LABEL[b.status] }), b.status === "WON" ? (mine ? "bad" : "ok") : mine ? "ok" : "bad");
    }
    seenBattles.current = new Map(r.battles.map((b) => [b.id, b.status]));
    setBattles(r.battles);
  }).catch(() => {}), [id, team, notify]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const swipe = useRef<{ x: number; y: number; edge: boolean } | null>(null);
  // Свайп от края браузер трактует как «назад»; гасим его сами (нужен non-passive слушатель).
  const screenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      const st = swipe.current;
      if (!st) return;
      const t = e.touches[0]!;
      if (st.edge && Math.abs(t.clientX - st.x) > Math.abs(t.clientY - st.y) && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => el.removeEventListener("touchmove", onMove);
  }, [team?.id]);
  const [gameName, setGameName] = useState("");
  const [links, setLinks] = useState("");
  const [note, setNote] = useState("");
  const [donation, setDonation] = useState(false);
  const [amount, setAmount] = useState("");
  const [donationCfg, setDonationCfg] = useState<{ min: number; currency: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadTeam = useCallback(() => api<{ isAdmin: boolean; teams: TeamDto[] }>(`/api/games/${id}/teams`).then((r) => { setIsAdmin(r.isAdmin); setTeam(r.teams.find((t) => t.members.some((mm) => mm.user.id === user?.id)) ?? r.teams[0] ?? null); }).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))), [id, user?.id]);
  const loadMap = useCallback(() => api<MyMapDto & { gameName?: string; donation?: { min: number; currency: string } | null }>(`/api/games/${id}/my-map`).then((m) => { setMap(m); if (m.gameName) setGameName(m.gameName); setDonationCfg(m.donation ?? null); }).catch(() => setMap(null)), [id]);
  useEffect(() => { void loadTeam(); void loadMap(); }, [loadTeam, loadMap]);
  useEffect(() => { if (team) { void loadBattles(); void loadStandings(); } }, [team, loadBattles, loadStandings]);
  useGameEvents(id, (e) => { if (e.type === "teams" || e.type === "game") void loadTeam(); if (e.type !== "deeds") void loadMap(); if (e.type === "cities" || e.type === "game" || e.type === "battles") setCityVersion((v) => v + 1); if (e.type === "battles" || e.type === "game" || e.type === "submissions") void loadBattles(); if (e.type === "game" || e.type === "cities" || e.type === "battles" || e.type === "teams") void loadStandings(); });
  useEffect(() => {
    const t = setInterval(() => void loadMap(), 60000);
    const onFocus = () => void loadMap();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [loadMap]);

  const me = team?.members.find((m) => m.user.id === user?.id);
  const isCaptain = me?.role === "CAPTAIN";
  const task = useMemo(() => (map?.tasks ?? []).find((t) => t.id === selectedId) ?? null, [map, selectedId]);

  function describeFrom(key: string): string {
    const n = map?.revealed.find((r) => r.key === key);
    if (!n) return t("открытой развилки");
    if (n.kind === "START") return t("стартовой точки");
    if (n.kind === "CITY") return t("города {name}", { name: BOOK_BY_CODE.get(n.bookCode ?? "")?.nameRu ?? "" });
    return t("развилки");
  }
  const where = (task: EdgeTaskDto) => t("из {from} на {dir}", { from: describeFrom(task.fromKey), dir: directionBetween(parseVertexKey(task.fromKey), parseVertexKey(task.toKey)) });

  async function act(path: string, body?: unknown) {
    setBusy(true); setError(null);
    try { await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }); await loadMap(); }
    catch (e) { setError(e instanceof ApiError ? (e.issues?.map((i) => i.message).join("; ") || e.message) : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  const peekedKind = (key: string) => map?.peeked?.find((p) => p.key === key)?.kind ?? null;
  async function peek(nodeKey: string) {
    setBusy(true); setError(null);
    try { const r = await api<{ kind: string }>(`/api/games/${id}/my-map/peek`, { method: "POST", body: JSON.stringify({ nodeKey }) }); notify(r.kind === "CITY" ? t("Разведка: там город!") : t("Разведка: там развилка")); await loadMap(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function setGameRole(userId: string, gameRole: GameRole) {
    setError(null);
    try { await api(`/api/games/${id}/teams/${team!.id}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ gameRole }) }); await loadTeam(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
  }

  if (error && !team) return <p className="error">{error}</p>;
  if (!team) return <p className="muted">{t("Загрузка…")}</p>;

  if (isAdmin && !me) {
    return (
      <>
        <p><Link to={`/games/${id}`}>{t("← К странице игры")}</Link></p>
        <div className="card"><h1>{team.name}</h1><p className="muted">{t("Вы администратор этой игры, а не участник команды. Карты команд с туманом видны только их участникам; вся карта и движение всех команд — на странице игры.")}</p></div>
      </>
    );
  }

  if (!map || map.status !== "ACTIVE") {
    return (
      <>
        <p><Link to="/">{t("← Мои игры")}</Link></p>
        <div className="card" style={{ borderTop: `4px solid ${team.color}` }}><h1>{team.name}</h1><p className="muted">{t("Игра ещё не начата. Карта откроется, когда администратор нажмёт «Начать игру».")}</p></div>
        <Roster team={team} isCaptain={isCaptain} onRole={setGameRole} />
      </>
    );
  }

  const activeBattles = battles.filter((b) => b.status === "QUEUED" || b.status === "ATTACK" || b.status === "DEFENSE");
  const takenTasks = map.tasks.filter((t) => t.status === "TAKEN" || t.status === "SUBMITTED" || t.status === "REJECTED");
  const done = map.tasks.filter((t) => t.status === "APPROVED").length;

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]!;
    swipe.current = { x: t.clientX, y: t.clientY, edge: t.clientX < 40 || menu };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const st = swipe.current; swipe.current = null;
    if (!st) return;
    const t = e.changedTouches[0]!;
    const dx = t.clientX - st.x, dy = t.clientY - st.y;
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (!menu && st.edge && dx > 40) setMenu(true);
    if (menu && dx < -60) setMenu(false);
  };

  return (
    <div className="map-screen" ref={screenRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <TeamMap map={map} teamIndex={team.index} selectedTaskId={selectedId} onSelect={(tid) => { setSelectedId(tid); if (tid) setMenu(false); }} onSelectCity={(key) => { setCityKey(key); setSelectedId(null); setMenu(false); }} />
      {cityKey && <CityPopup gameId={id} nodeKey={cityKey} teamId={team.id} isCaptain={isCaptain} version={cityVersion} onClose={() => setCityKey(null)} onChanged={() => { void loadMap(); void loadBattles(); }} />}

      {standings?.status === "FINISHED" && (
        <div className="finish-banner">
          🏆 {t("Игра завершена")}{standings.winnerTeamId ? <>: {t("победила")} <strong>«{standings.standings.find((t) => t.teamId === standings.winnerTeamId)?.name}»</strong></> : ""}
        </div>
      )}
      <div className="map-hud">
        <span className="avatar" style={{ background: team.color, color: "#fff" }}>{team.name.slice(0, 1)}</span>
        <span className="name">{team.name}</span>
        <span className="muted">· {t("узлов")} {map.revealed.length} · {t("путей")} {done}</span>
      </div>
      {/* Кнопка остаётся в DOM (hidden), иначе свайп, начатый на ней, ломается: Chrome теряет цель касания */}
      <div className="edge-handle" role="button" tabIndex={0} hidden={menu} onClick={() => { setMenu(true); setSelectedId(null); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setMenu(true); }} aria-label={t("Открыть меню")}>›{takenTasks.length + activeBattles.length > 0 && <span className="count">{takenTasks.length + activeBattles.length}</span>}</div>

      {task && (
        <div className="sheet">
          <button className="ghost sm close" onClick={() => setSelectedId(null)} aria-label={t("Закрыть")}>✕</button>
          <div style={{ paddingRight: "2rem" }}><strong>{task.deed.title}</strong> <span className="badge">{task.deed.direction}</span> <span className={"badge" + (task.status === "SUBMITTED" ? " accent" : "")}>{TASK_STATUS_LABEL[task.status]}</span></div>
          <p className="muted" style={{ margin: ".4rem 0" }}>{t("Путь")} {where(task)}.</p>
          {task.deed.description && <p style={{ margin: ".2rem 0" }}>{task.deed.description}</p>}
          <p className="muted" style={{ margin: ".2rem 0" }}>{t("Сдать:")} {PROOF_LABEL[task.deed.proofType]} · {t("тяжесть")} {task.deed.difficulty}</p>
          {task.status === "REJECTED" && task.adminComment && <div className="note bad">{t("Вернули:")} {task.adminComment}</div>}
          {task.status === "SUBMITTED" && <div className="note ok">{t("Сдано, ждём проверки администратора.")}</div>}
          {error && <p className="error">{error}</p>}
          {(task.status === "OPEN" || task.status === "REJECTED") && (
            <div className="actions">
              <button disabled={busy} onClick={() => void act(`/api/games/${id}/edge-tasks/${task.id}/take`)}>{t("Беру это дело")}</button>
              <button className="secondary" onClick={() => setSelectedId(null)}>{t("Не сейчас")}</button>
              {me?.gameRole === "SCOUT" && !peekedKind(task.toKey) && <button className="ghost" disabled={busy} onClick={() => void peek(task.toKey)}>{t("🔭 Разведать, что за стороной")}</button>}
            </div>
          )}
          {peekedKind(task.toKey) && <p className="note ok">Разведка: за этой стороной {peekedKind(task.toKey) === "CITY" ? t("город") : t("развилка")}.</p>}
          {task.status === "TAKEN" && (
            <>
              {donationCfg && (
                <label className="check"><input type="checkbox" checked={donation} onChange={(e) => setDonation(e.target.checked)} />{t("Заменить дело пожертвованием (от {min} {cur})", { min: donationCfg.min, cur: donationCfg.currency })}</label>
              )}
              {donation && donationCfg && (
                <>
                  <label htmlFor="amount">{t("Сумма")}, {donationCfg.currency}</label>
                  <input id="amount" type="number" inputMode="numeric" min={donationCfg.min} value={amount} onChange={(e) => setAmount(e.target.value)} />
                </>
              )}
              <label htmlFor="links">{donation ? t("Ссылка на чек или подтверждение перевода") : t("Ссылки на фото или видео")} <span className="muted">{t("по одной на строку")}</span></label>
              <textarea id="links" rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" />
              <label htmlFor="note">{donation ? t("Комментарий") : t("Что сделали")}</label>
              <textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="actions">
                <button disabled={busy || (donation && !amount)} onClick={() => void act(`/api/games/${id}/edge-tasks/${task.id}/submit`, { links: links.split(/\s+/).filter(Boolean), note, donation, donationAmount: donation ? Number(amount) : undefined }).then(() => { setLinks(""); setNote(""); setDonation(false); setAmount(""); })}>{donation ? t("Сдать пожертвование") : t("Сдать на проверку")}</button>
                <button className="ghost" disabled={busy} onClick={() => void act(`/api/games/${id}/edge-tasks/${task.id}/release`)}>{t("Отпустить")}</button>
              </div>
            </>
          )}
        </div>
      )}

      {menu && (
        <>
          <div className="side-backdrop" onClick={() => setMenu(false)} />
          <div className="side-menu" style={{ ["--team" as string]: team.color }}>
            <div className="side-head">
              <span className="avatar">{team.name.slice(0, 1)}</span>
              <div style={{ minWidth: 0 }}><strong style={{ fontSize: "1.1rem" }}>{team.name}</strong><div className="muted">{gameName || t("Игра")} · {t("вы —")} {me ? TEAM_ROLE_LABEL[me.role] : "?"}</div></div>
              <button className="ghost sm close" onClick={() => setMenu(false)} aria-label={t("Закрыть")}><Icon name="x" /></button>
            </div>
            <div className="section">
              <h2><Icon name="scroll" />{t("Взятые дела")} <span className="muted">{takenTasks.length}</span></h2>
              {takenTasks.length === 0 && <p className="muted" style={{ margin: 0 }}>{t("Дела ждут на карте: нажми на метку у дороги.")}</p>}
              <ul className="list">
                {takenTasks.map((tk) => (
                  <li key={tk.id} onClick={() => { setSelectedId(tk.id); setMenu(false); }} style={{ cursor: "pointer" }}>
                    <div className="main"><strong>{tk.deed.title}</strong><div className="muted">{where(tk)}{tk.status === "REJECTED" && tk.adminComment ? ` · ${t("вернули")}: ${tk.adminComment}` : ""}</div></div>
                    <span className={"badge" + (tk.status === "SUBMITTED" ? " accent" : "")}>{TASK_STATUS_LABEL[tk.status]}</span>
                  </li>
                ))}
              </ul>
            </div>
            {activeBattles.length > 0 && (
              <div className="section">
                <h2><Icon name="wave" />{t("Испытания")} <span className="muted">{activeBattles.length}</span></h2>
                {activeBattles.map((b) => (
                  <div key={b.id} onClick={() => { setCityKey(b.nodeKey); setMenu(false); }} style={{ cursor: "pointer" }}>
                    <BattleCard gameId={id} b={b} teamId={team.id} isCaptain={isCaptain} now={now} onChanged={() => void loadBattles()} compact />
                  </div>
                ))}
              </div>
            )}
            {standings && standings.standings.length > 0 && (() => {
              const max = Math.max(1, ...standings.standings.map((st) => st.cities * 3 + st.deedsApproved + st.nodesRevealed));
              return (
                <div className="section">
                  <h2><Icon name="crown" />{t("Положение команд")}</h2>
                  {standings.standings.map((st, i) => {
                    const score = st.cities * 3 + st.deedsApproved + st.nodesRevealed;
                    return (
                      <div key={st.teamId} className="standing" style={{ ["--team" as string]: st.color }}>
                        <span className="rank">{st.teamId === standings.winnerTeamId ? "🏆" : i + 1}</span>
                        <span className="avatar" style={{ background: st.color, color: "#fff" }}>{st.name.slice(0, 1)}</span>
                        <div className="body">
                          <div className="name">{st.name} {st.status === "defeated" ? <span className="badge bad">{t("выбыла")}</span> : st.teamId === standings.winnerTeamId ? <span className="badge ok">{t("победитель")}</span> : st.teamId === team.id ? <span className="badge accent">{t("мы")}</span> : null}</div>
                          <div className="nums">
                            <span title={t("городов")}><Icon name="city" />{st.cities}</span>
                            <span title={t("дел")}><Icon name="scroll" />{st.deedsApproved}</span>
                            <span title={t("узлов")}><Icon name="map" />{st.nodesRevealed}</span>
                            <span title={t("испытания: перешло / устояли / потеряно")}><Icon name="wave" />{st.battlesWon}/{st.battlesRepelled}/{st.battlesLost}</span>
                          </div>
                          {st.citiesOnPath.length > 0 && <div className="muted" style={{ fontSize: ".78rem" }}>{t("путь")}: {st.citiesOnPath.map((c) => c.name + (c.current ? "" : t(" (потерян)"))).join(", ")}</div>}
                          <div className="bar"><span style={{ width: `${Math.round((score / max) * 100)}%` }} /></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <DiplomacyMenu gameId={id} version={cityVersion} />
            <div className="section"><Roster team={team} isCaptain={isCaptain} onRole={setGameRole} flat /></div>
            <div className="menu-links">
              <Link to="/"><Icon name="home" />{t("Мои игры")}</Link>
              <Link to="/account"><Icon name="user" />{t("Аккаунт")}</Link>
              <a href="#" onClick={(e) => { e.preventDefault(); void logout(); }}><Icon name="logout" />{t("Выйти")}</a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Roster({ team, isCaptain, onRole, flat }: { team: TeamDto; isCaptain: boolean; onRole: (userId: string, role: GameRole) => void; flat?: boolean }) {
  const body = (
    <>
      <h2><Icon name="users" />{t("Состав")} <span className="muted">{team.members.length}</span></h2>
      <ul className="list">
        {team.members.map((m) => (
          <li key={m.user.id}>
            <div className="main person">
              <span className="avatar">{(m.user.displayName ?? m.user.nickname).slice(0, 1).toUpperCase()}</span>
              <div>{m.user.displayName ?? m.user.nickname} <span className={"badge" + (m.role === "CAPTAIN" ? " accent" : "")}>{TEAM_ROLE_LABEL[m.role]}</span></div>
            </div>
            {m.role === "MEMBER" && (isCaptain ? (
              <select value={m.gameRole} onChange={(e) => onRole(m.user.id, e.target.value as GameRole)} style={{ width: "auto", minHeight: 34 }}>
                {(Object.keys(GAME_ROLE_LABEL) as GameRole[]).map((r) => <option key={r} value={r}>{r === "NONE" ? t("без роли") : GAME_ROLE_LABEL[r]}</option>)}
              </select>
            ) : m.gameRole !== "NONE" ? <span className="badge">{GAME_ROLE_LABEL[m.gameRole]}</span> : null)}
          </li>
        ))}
      </ul>
    </>
  );
  return flat ? body : <div className="card">{body}</div>;
}
