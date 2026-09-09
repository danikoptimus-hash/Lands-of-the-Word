import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BOOKS, directionBetween, parseVertexKey } from "@lotw/domain";
import { api, ApiError, GAME_ROLE_LABEL, PROOF_LABEL, TASK_STATUS_LABEL, TEAM_ROLE_LABEL, type EdgeTaskDto, type GameRole, type MyMapDto, type TeamDto } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useGameEvents } from "../lib/useGameEvents";
import { TeamMap } from "./TeamMap";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

/** Страница команды: карта во весь экран, всплывающая карточка дела, выдвижная панель с делами и составом. */
export function TeamPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const [team, setTeam] = useState<TeamDto | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [map, setMap] = useState<MyMapDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [links, setLinks] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const loadTeam = useCallback(() => api<{ isAdmin: boolean; teams: TeamDto[] }>(`/api/games/${id}/teams`).then((r) => { setIsAdmin(r.isAdmin); setTeam(r.teams[0] ?? null); }).catch((e) => setError(e instanceof ApiError ? e.message : "Ошибка сети")), [id]);
  const loadMap = useCallback(() => api<MyMapDto>(`/api/games/${id}/my-map`).then(setMap).catch(() => setMap(null)), [id]);
  useEffect(() => { void loadTeam(); void loadMap(); }, [loadTeam, loadMap]);
  useGameEvents(id, (e) => { if (e.type === "teams" || e.type === "game") void loadTeam(); if (e.type !== "deeds") void loadMap(); });
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

  const takenTasks = map.tasks.filter((t) => t.status === "TAKEN" || t.status === "SUBMITTED" || t.status === "REJECTED");
  const done = map.tasks.filter((t) => t.status === "APPROVED").length;

  return (
    <div className="map-screen">
      <TeamMap map={map} teamIndex={team.index} selectedTaskId={selectedId} onSelect={(tid) => { setSelectedId(tid); if (tid) setDrawer(false); }} />

      <div className="map-hud">
        <span className="avatar" style={{ background: team.color, color: "#fff" }}>{team.name.slice(0, 1)}</span>
        <span className="name">{team.name}</span>
        <span className="muted">· узлов {map.revealed.length} · путей {done}</span>
      </div>
      <button className="map-fab" onClick={() => { setDrawer(true); setSelectedId(null); }}>Команда{takenTasks.length ? ` · дел ${takenTasks.length}` : ""}</button>

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

      {drawer && (
        <div className="drawer">
          <button className="ghost sm close" onClick={() => setDrawer(false)} aria-label="Закрыть">✕</button>
          <div className="person" style={{ gap: ".7rem", marginBottom: ".8rem" }}>
            <span className="avatar" style={{ background: team.color, color: "#fff", width: 40, height: 40 }}>{team.name.slice(0, 1)}</span>
            <div><strong style={{ fontSize: "1.1rem" }}>{team.name}</strong><div className="muted">Вы — {me ? TEAM_ROLE_LABEL[me.role] : "?"}</div></div>
          </div>
          <h2>Взятые дела <span className="muted">{takenTasks.length}</span></h2>
          {takenTasks.length === 0 && <p className="muted">Пока ничего не взято. Нажми на сторону с меткой на карте.</p>}
          <ul className="list">
            {takenTasks.map((t) => (
              <li key={t.id} onClick={() => { setSelectedId(t.id); setDrawer(false); }} style={{ cursor: "pointer" }}>
                <div className="main"><strong>{t.deed.title}</strong><div className="muted">{where(t)}{t.status === "REJECTED" && t.adminComment ? ` · вернули: ${t.adminComment}` : ""}</div></div>
                <span className={"badge" + (t.status === "SUBMITTED" ? " accent" : "")}>{TASK_STATUS_LABEL[t.status]}</span>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: "1rem" }}><Roster team={team} isCaptain={isCaptain} onRole={setGameRole} flat /></div>
          <p style={{ marginTop: "1rem" }}><Link to="/">← Мои игры</Link></p>
        </div>
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
