import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";

interface Readiness { canStart: boolean; problems: string[]; warnings: string[] }

export function StartBlock({ gameId, status, onStarted }: { gameId: string; status: string; onStarted: () => void }) {
  const [r, setR] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<Readiness>(`/api/games/${gameId}/readiness`).then(setR).catch(() => setR(null));
  useEffect(() => { if (status === "DRAFT") void load(); }, [gameId, status]);
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
          {r.problems.map((p) => <p key={p} className="error">✕ {p}</p>)}
          {r.warnings.map((w) => <p key={w} className="muted">⚠ {w}</p>)}
          {r.canStart && <p className="muted">Всё готово: карта, команды, дела.</p>}
          <div className="row"><button onClick={() => void start()} disabled={!r.canStart || busy}>Начать игру</button><button className="secondary" onClick={() => void load()}>Обновить проверку</button></div>
        </>
      ) : <p className="muted">Проверка…</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
