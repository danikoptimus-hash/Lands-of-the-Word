import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BOOKS, directionBetween, parseVertexKey } from "@lotw/domain";
import { api, ApiError, BATTLE_STATUS_LABEL, GAME_ROLE_LABEL, PROOF_LABEL, TASK_STATUS_LABEL, TEAM_ROLE_LABEL, type BattleDto, type EdgeTaskDto, type GameRole, type MyMapDto, type TeamDto } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useRef } from "react";
import { useGameEvents } from "../lib/useGameEvents";
import { TeamMap } from "./TeamMap";
import { CityPopup } from "./CityPopup";
import { BattleCard } from "./BattlePanel";
import { useUi } from "../lib/ui";

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
      if (!was && mine && b.status === "ATTACK") notify(`На ваш город ${BOOK_BY_CODE.get(b.bookCode)?.nameRu ?? ""} объявлена атака: ${b.bid} стихов!`, "bad");
      else if (was && mine && b.status === "DEFENSE") notify(`Атака на ${BOOK_BY_CODE.get(b.bookCode)?.nameRu ?? "город"} одобрена: пошло время обороны!`, "bad");
      else if (was && (b.status === "WON" || b.status === "REPELLED" || b.status === "EXPIRED")) notify(`Битва за ${BOOK_BY_CODE.get(b.bookCode)?.nameRu ?? "город"}: ${BATTLE_STATUS_LABEL[b.status]}`, b.status === "WON" ? (mine ? "bad" : "ok") : mine ? "ok" : "bad");
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
  const [busy, setBusy] = useState(false);

  const loadTeam = useCallback(() => api<{ isAdmin: boolean; teams: TeamDto[] }>(`/api/games/${id}/teams`).then((r) => { setIsAdmin(r.isAdmin); setTeam(r.teams.find((t) => t.members.some((mm) => mm.user.id === user?.id)) ?? r.teams[0] ?? null); }).catch((e) => setError(e instanceof ApiError ? e.message : "Ошибка сети")), [id, user?.id]);
  const loadMap = useCallback(() => api<MyMapDto & { gameName?: string }>(`/api/games/${id}/my-map`).then((m) => { setMap(m); if (m.gameName) setGameName(m.gameName); }).catch(() => setMap(null)), [id]);
  useEffect(() => { void loadTeam(); void loadMap(); }, [loadTeam, loadMap]);
  useEffect(() => { if (team) void loadBattles(); }, [team, loadBattles]);
  useGameEvents(id, (e) => { if (e.type === "teams" || e.type === "game") void loadTeam(); if (e.type !== "deeds") void loadMap(); if (e.type === "cities" || e.type === "game" || e.type === "battles") setCityVersion((v) => v + 1); if (e.type === "battles" || e.type === "game" || e.type === "submissions") void loadBattles(); });
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
    if (!n) return "открытой развилки";
    if (n.kind === "START") return "стартовой точки";
    if (n.kind === "CITY") return `города ${BOOK_BY_CODE.get(n.bookCode ?? "")?.nameRu ?? ""}`;
    return "развилки";
  }
  const where = (t: EdgeTaskDto) => `из ${describeFrom(t.fromKey)} на ${directionBetween(parseVertexKey(t.fromKey), parseVertexKey(t.toKey))}`;

  async function act(path: string, body?: unknown) {
    setBusy(true); setError(null);
    try { await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }); await loadMap(); }
    catch (e) { setError(e instanceof ApiError ? (e.issues?.map((i) => i.message).join("; ") || e.message) : "Ошибка сети"); }
    finally { setBusy(false); }
  }
  async function setGameRole(userId: string, gameRole: GameRole) {
    setError(null);
    try { await api(`/api/games/${id}/teams/${team!.id}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ gameRole }) }); await loadTeam(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
  }

  if (error && !team) return <p className="error">{error}</p>;
  if (!team) return <p className="muted">Загрузка…</p>;

  if (isAdmin && !me) {
    return (
      <>
        <p><Link to={`/games/${id}`}>← К странице игры</Link></p>
        <div className="card"><h1>{team.name}</h1><p className="muted">Вы администратор этой игры, а не участник команды. Карты команд с туманом видны только их участникам; вся карта и движение всех команд — на странице игры.</p></div>
      </>
    );
  }

  if (!map || map.status !== "ACTIVE") {
    return (
      <>
        <p><Link to="/">← Мои игры</Link></p>
        <div className="card" style={{ borderTop: `4px solid ${team.color}` }}><h1>{team.name}</h1><p className="muted">Игра ещё не начата. Карта откроется, когда администратор нажмёт «Начать игру».</p></div>
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

      <div className="map-hud">
        <span className="avatar" style={{ background: team.color, color: "#fff" }}>{team.name.slice(0, 1)}</span>
        <span className="name">{team.name}</span>
        <span className="muted">· узлов {map.revealed.length} · путей {done}</span>
      </div>
      {/* Кнопка остаётся в DOM (hidden), иначе свайп, начатый на ней, ломается: Chrome теряет цель касания */}
      <div className="edge-handle" role="button" tabIndex={0} hidden={menu} onClick={() => { setMenu(true); setSelectedId(null); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setMenu(true); }} aria-label="Открыть меню">›{takenTasks.length + activeBattles.length > 0 && <span className="count">{takenTasks.length + activeBattles.length}</span>}</div>

      {task && (
        <div className="sheet">
          <button className="ghost sm close" onClick={() => setSelectedId(null)} aria-label="Закрыть">✕</button>
          <div style={{ paddingRight: "2rem" }}><strong>{task.deed.title}</strong> <span className="badge">{task.deed.direction}</span> <span className={"badge" + (task.status === "SUBMITTED" ? " accent" : "")}>{TASK_STATUS_LABEL[task.status]}</span></div>
          <p className="muted" style={{ margin: ".4rem 0" }}>Путь {where(task)}.</p>
          {task.deed.description && <p style={{ margin: ".2rem 0" }}>{task.deed.description}</p>}
          <p className="muted" style={{ margin: ".2rem 0" }}>Сдать: {PROOF_LABEL[task.deed.proofType]} · тяжесть {task.deed.difficulty}</p>
          {task.status === "REJECTED" && task.adminComment && <div className="note bad">Вернули: {task.adminComment}</div>}
          {task.status === "SUBMITTED" && <div className="note ok">Сдано, ждём проверки администратора.</div>}
          {error && <p className="error">{error}</p>}
          {(task.status === "OPEN" || task.status === "REJECTED") && (
            <div className="actions">
              <button disabled={busy} onClick={() => void act(`/api/games/${id}/edge-tasks/${task.id}/take`)}>Беру это дело</button>
              <button className="secondary" onClick={() => setSelectedId(null)}>Не сейчас</button>
            </div>
          )}
          {task.status === "TAKEN" && (
            <>
              <label htmlFor="links">Ссылки на фото или видео <span className="muted">по одной на строку</span></label>
              <textarea id="links" rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" />
              <label htmlFor="note">Что сделали</label>
              <textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="actions">
                <button disabled={busy} onClick={() => void act(`/api/games/${id}/edge-tasks/${task.id}/submit`, { links: links.split(/\s+/).filter(Boolean), note }).then(() => { setLinks(""); setNote(""); })}>Сдать на проверку</button>
                <button className="ghost" disabled={busy} onClick={() => void act(`/api/games/${id}/edge-tasks/${task.id}/release`)}>Отпустить</button>
              </div>
            </>
          )}
        </div>
      )}

      {menu && (
        <>
          <div className="side-backdrop" onClick={() => setMenu(false)} />
          <div className="side-menu">
            <div className="row between">
              <div className="person" style={{ gap: ".7rem" }}>
                <span className="avatar" style={{ background: team.color, color: "#fff", width: 40, height: 40 }}>{team.name.slice(0, 1)}</span>
                <div><strong style={{ fontSize: "1.05rem" }}>{team.name}</strong><div className="muted">{gameName || "Игра"} · вы — {me ? TEAM_ROLE_LABEL[me.role] : "?"}</div></div>
              </div>
              <button className="ghost sm" onClick={() => setMenu(false)} aria-label="Закрыть">✕</button>
            </div>
            <div className="section">
              <h2>Взятые дела <span className="muted">{takenTasks.length}</span></h2>
              {takenTasks.length === 0 && <p className="muted">Пока ничего не взято. Нажми на сторону с меткой на карте.</p>}
              <ul className="list">
                {takenTasks.map((t) => (
                  <li key={t.id} onClick={() => { setSelectedId(t.id); setMenu(false); }} style={{ cursor: "pointer" }}>
                    <div className="main"><strong>{t.deed.title}</strong><div className="muted">{where(t)}{t.status === "REJECTED" && t.adminComment ? ` · вернули: ${t.adminComment}` : ""}</div></div>
                    <span className={"badge" + (t.status === "SUBMITTED" ? " accent" : "")}>{TASK_STATUS_LABEL[t.status]}</span>
                  </li>
                ))}
              </ul>
            </div>
            {activeBattles.length > 0 && (
              <div className="section">
                <h2>Битвы <span className="muted">{activeBattles.length}</span></h2>
                {activeBattles.map((b) => (
                  <div key={b.id} onClick={() => { setCityKey(b.nodeKey); setMenu(false); }} style={{ cursor: "pointer" }}>
                    <BattleCard gameId={id} b={b} teamId={team.id} isCaptain={isCaptain} now={now} onChanged={() => void loadBattles()} compact />
                  </div>
                ))}
              </div>
            )}
            <div className="section"><Roster team={team} isCaptain={isCaptain} onRole={setGameRole} flat /></div>
            <div className="section">
              <Link className="menu-link" to="/">🗺 Мои игры</Link>
              <Link className="menu-link" to="/account">⚙ Настройки аккаунта</Link>
              <a className="menu-link" href="#" onClick={(e) => { e.preventDefault(); void logout(); }}>⏻ Выйти</a>
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
      <h2>Состав <span className="muted">{team.members.length}</span></h2>
      <ul className="list">
        {team.members.map((m) => (
          <li key={m.user.id}>
            <div className="main person">
              <span className="avatar">{(m.user.displayName ?? m.user.nickname).slice(0, 1).toUpperCase()}</span>
              <div>{m.user.displayName ?? m.user.nickname} <span className={"badge" + (m.role === "CAPTAIN" ? " accent" : "")}>{TEAM_ROLE_LABEL[m.role]}</span></div>
            </div>
            {m.role === "MEMBER" && (isCaptain ? (
              <select value={m.gameRole} onChange={(e) => onRole(m.user.id, e.target.value as GameRole)} style={{ width: "auto", minHeight: 34 }}>
                {(Object.keys(GAME_ROLE_LABEL) as GameRole[]).map((r) => <option key={r} value={r}>{r === "NONE" ? "без роли" : GAME_ROLE_LABEL[r]}</option>)}
              </select>
            ) : m.gameRole !== "NONE" ? <span className="badge">{GAME_ROLE_LABEL[m.gameRole]}</span> : null)}
          </li>
        ))}
      </ul>
    </>
  );
  return flat ? body : <div className="card">{body}</div>;
}
