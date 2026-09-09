import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, GAME_ROLE_LABEL, PROOF_LABEL, TASK_STATUS_LABEL, TEAM_ROLE_LABEL, type EdgeTaskDto, type GameRole, type MyMapDto, type TeamDto } from "../lib/api";
import { useAuth } from "../lib/auth";
import { TeamMap } from "./TeamMap";

/** Страница команды: карта с туманом, дела на рёбрах, состав. */
export function TeamPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const [team, setTeam] = useState<TeamDto | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [map, setMap] = useState<MyMapDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [links, setLinks] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const loadTeam = useCallback(() => api<{ isAdmin: boolean; teams: TeamDto[] }>(`/api/games/${id}/teams`).then((r) => { setIsAdmin(r.isAdmin); setTeam(r.teams[0] ?? null); }).catch((e) => setError(e instanceof ApiError ? e.message : "Ошибка сети")), [id]);
  const loadMap = useCallback(() => api<MyMapDto>(`/api/games/${id}/my-map`).then(setMap).catch(() => setMap(null)), [id]);
  useEffect(() => { void loadTeam(); void loadMap(); }, [loadTeam, loadMap]);
  useEffect(() => {
    const t = setInterval(() => void loadMap(), 20000);
    const onFocus = () => void loadMap();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [loadMap]);

  const me = team?.members.find((m) => m.user.id === user?.id);
  const isCaptain = me?.role === "CAPTAIN";
  const task = map?.tasks.find((t) => t.id === selected) ?? null;

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

  const openTasks = map?.tasks.filter((t) => t.status !== "APPROVED") ?? [];
  const done = map?.tasks.filter((t) => t.status === "APPROVED").length ?? 0;

  return (
    <>
      <p><Link to="/">← Мои игры</Link></p>
      <div className="card" style={{ borderTop: `4px solid ${team.color}` }}>
        <div className="card-head">
          <div className="person" style={{ gap: ".8rem" }}>
            <span className="avatar" style={{ background: team.color, color: "#fff", width: 44, height: 44, fontSize: "1.1rem" }}>{team.name.slice(0, 1)}</span>
            <div><h1 style={{ margin: 0 }}>{team.name}</h1><div className="muted">Вы — {me ? TEAM_ROLE_LABEL[me.role] : "?"}{me && me.role === "MEMBER" && me.gameRole !== "NONE" ? `, ${GAME_ROLE_LABEL[me.gameRole].toLowerCase()}` : ""}</div></div>
          </div>
          {map && map.status === "ACTIVE" && <span className="muted">открыто узлов: {map.revealed.length} · пройдено рёбер: {done}</span>}
        </div>
      </div>

      {map && map.status === "ACTIVE" ? (
        <>
          <div className="card">
            <div className="card-head"><h2>Карта</h2><span className="muted">? — туман; пунктир — путь с делом; цвет команды — пройдено</span></div>
            <TeamMap map={map} selectedTask={selected} onSelectTask={setSelected} />
          </div>
          <div className="card">
            <div className="card-head"><h2>Дела рядом <span className="muted">{openTasks.length}</span></h2></div>
            {error && <p className="error">{error}</p>}
            {openTasks.length === 0 && <p className="muted">Открытых путей нет.</p>}
            <ul className="list">
              {openTasks.map((t) => <TaskRow key={t.id} t={t} selected={t.id === selected} onSelect={() => setSelected(t.id === selected ? null : t.id)} />)}
            </ul>
            {task && (
              <div className="note ok" style={{ marginTop: ".75rem" }}>
                <strong>{task.deed.title}</strong> <span className="badge">{task.deed.direction}</span>
                <div className="muted" style={{ margin: ".3rem 0" }}>{task.deed.description || "Без описания."} · Сдать: {PROOF_LABEL[task.deed.proofType]}.</div>
                {task.status === "REJECTED" && task.adminComment && <div className="note bad">Вернули: {task.adminComment}</div>}
                {task.status === "SUBMITTED" && <div className="muted">Сдано, ждём проверки администратора.</div>}
                {(task.status === "OPEN" || task.status === "REJECTED") && <div className="actions"><button className="sm" disabled={busy} onClick={() => void act(`/api/games/${id}/edge-tasks/${task.id}/take`)}>Беру это дело</button></div>}
                {(task.status === "TAKEN" || task.status === "REJECTED") && (
                  <div style={{ marginTop: ".5rem" }}>
                    <label htmlFor="links">Ссылки на фото или видео <span className="muted">по одной на строку</span></label>
                    <textarea id="links" rows={3} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" />
                    <label htmlFor="note">Что сделали</label>
                    <textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    <div className="actions">
                      <button className="sm" disabled={busy} onClick={() => void act(`/api/games/${id}/edge-tasks/${task.id}/submit`, { links: links.split(/\s+/).filter(Boolean), note }).then(() => { setLinks(""); setNote(""); })}>Сдать на проверку</button>
                      {task.status === "TAKEN" && <button className="ghost sm" disabled={busy} onClick={() => void act(`/api/games/${id}/edge-tasks/${task.id}/release`)}>Отпустить</button>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="card"><p className="muted">Игра ещё не начата. Карта откроется, когда администратор нажмёт «Начать игру».</p></div>
      )}

      <div className="card">
        <div className="card-head"><h2>Состав <span className="muted">{team.members.length}</span></h2></div>
        <ul className="list">
          {team.members.map((m) => (
            <li key={m.user.id}>
              <div className="main person">
                <span className="avatar">{(m.user.displayName ?? m.user.nickname).slice(0, 1).toUpperCase()}</span>
                <div>{m.user.displayName ?? m.user.nickname} <span className={"badge" + (m.role === "CAPTAIN" ? " accent" : "")}>{TEAM_ROLE_LABEL[m.role]}</span></div>
              </div>
              {m.role === "MEMBER" && (isCaptain ? (
                <select value={m.gameRole} onChange={(e) => void setGameRole(m.user.id, e.target.value as GameRole)} style={{ width: "auto", minHeight: 34 }}>
                  {(Object.keys(GAME_ROLE_LABEL) as GameRole[]).map((r) => <option key={r} value={r}>{r === "NONE" ? "без роли" : GAME_ROLE_LABEL[r]}</option>)}
                </select>
              ) : m.gameRole !== "NONE" ? <span className="badge">{GAME_ROLE_LABEL[m.gameRole]}</span> : null)}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function TaskRow({ t, selected, onSelect }: { t: EdgeTaskDto; selected: boolean; onSelect: () => void }) {
  const tone = t.status === "SUBMITTED" ? " accent" : "";
  return (
    <li onClick={onSelect} style={{ cursor: "pointer", background: selected ? "var(--surface-2)" : undefined, borderRadius: 8, padding: ".6rem .4rem" }}>
      <div className="main"><strong>{t.deed.title}</strong> <span className="badge">{t.deed.direction}</span><div className="muted">{PROOF_LABEL[t.deed.proofType]} · тяжесть {t.deed.difficulty}</div></div>
      <span className={"badge" + tone}>{TASK_STATUS_LABEL[t.status]}</span>
    </li>
  );
}
