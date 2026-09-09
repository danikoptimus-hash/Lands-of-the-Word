import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";

interface Readiness { canStart: boolean; problems: string[]; warnings: string[] }

/** Проверка готовности обновляется сама: при любом изменении на странице (version), при возврате на вкладку и раз в 15 секунд. */
export function StartBlock({ gameId, status, version, onStarted }: { gameId: string; status: string; version: number; onStarted: () => void }) {
  const [r, setR] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<Readiness>(`/api/games/${gameId}/readiness`).then(setR).catch(() => setR(null));
  useEffect(() => {
    if (status !== "DRAFT") return;
    void load();
    const timer = setInterval(() => void load(), 15000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { clearInterval(timer); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [gameId, status, version]);
  if (status !== "DRAFT") return null;

  async function start() {
    if (!confirm("Начать игру? Карту после этого изменить нельзя.")) return;
    setBusy(true); setError(null);
    try { await api(`/api/games/${gameId}/start`, { method: "POST" }); onStarted(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2>Старт игры</h2>
      {r ? (
        <>
          {r.problems.map((p) => <p key={p} className="note bad">{p}</p>)}
          {r.warnings.map((w) => <p key={w} className="note warn">{w}</p>)}
          {r.canStart && <p className="note ok">Всё готово: карта, команды, дела.</p>}
          <div className="actions"><button onClick={() => void start()} disabled={!r.canStart || busy}>Начать игру</button></div>
        </>
      ) : <p className="muted">Проверка…</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
