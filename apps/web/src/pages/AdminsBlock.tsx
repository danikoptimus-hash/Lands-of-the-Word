import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUi } from "../lib/ui";

interface AdminRow { id: string; nickname: string; displayName: string | null; email: string | null; creator: boolean }

/** Администраторы игры: несколько человек проверяют сдачи и получают письма о новых сдачах. */
export function AdminsBlock({ gameId, version = 0 }: { gameId: string; version?: number }) {
  const { user } = useAuth();
  const { confirm, notify } = useUi();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [login, setLogin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ admins: AdminRow[] }>(`/api/games/${gameId}/admins`).then((r) => setRows(r.admins)).catch(() => setRows([]));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, version]);
  async function add(e: FormEvent) {
    e.preventDefault(); setError(null);
    try { const r = await api<{ nickname: string }>(`/api/games/${gameId}/admins`, { method: "POST", body: JSON.stringify({ login }) }); setLogin(""); notify(`${r.nickname} теперь администратор`); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сети"); }
  }
  async function remove(a: AdminRow) {
    if (!(await confirm(`Убрать ${a.nickname} из администраторов игры?`, { okLabel: "Убрать", danger: true }))) return;
    try { await api(`/api/games/${gameId}/admins/${a.id}`, { method: "DELETE" }); await load(); }
    catch (err) { notify(err instanceof ApiError ? err.message : "Ошибка сети", "bad"); }
  }
  return (
    <div className="card">
      <div className="card-head"><h2>Администраторы <span className="muted">{rows.length}</span></h2></div>
      <ul className="list">
        {rows.map((a) => (
          <li key={a.id}>
            <div className="main person"><span className="avatar">{(a.displayName ?? a.nickname).slice(0, 1).toUpperCase()}</span><div>{a.displayName ?? a.nickname} <span className="muted">{a.nickname}{a.email ? ` · ${a.email}` : " · без почты"}</span> {a.creator && <span className="badge accent">создатель</span>}</div></div>
            {!a.creator && a.id !== user?.id && <button className="ghost sm" onClick={() => void remove(a)}>Убрать</button>}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="row" style={{ marginTop: ".6rem", gap: ".5rem", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 220px" }}><label htmlFor="adm-login">Добавить администратора</label><input id="adm-login" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="никнейм или почта" required minLength={3} /></div>
        <button type="submit" className="secondary">Добавить</button>
      </form>
      <p className="hint">Администраторы видят всю карту, проверяют дела и записи битв и получают письма о новых сдачах (если указана почта). Человек должен быть уже зарегистрирован.</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
