import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";

interface Item { key: string; vars?: Record<string, string | number> }
interface Readiness { canStart: boolean; problems: string[]; warnings: string[]; problemItems: Item[]; warningItems: Item[] }

/** Проверка готовности обновляется сама: при любом изменении на странице (version), при возврате на вкладку и раз в 15 секунд. */
export function StartBlock({ gameId, status, version, onStarted }: { gameId: string; status: string; version: number; onStarted: () => void }) {
  const [r, setR] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ui = useUi();
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
    if (!(await ui.confirm(t("Карту после старта изменить нельзя. Команды получат свои стартовые точки, а дела появятся на сторонах."), { title: t("Начать игру?"), okLabel: t("Начать") }))) return;
    setBusy(true); setError(null);
    try { await api(`/api/games/${gameId}/start`, { method: "POST" }); ui.notify(t("Игра началась")); onStarted(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h2>{t("Старт игры")}</h2>
      {r ? (
        <>
          {r.problemItems.map((p) => <p key={p.key} className="note bad">{t(p.key, p.vars)}</p>)}
          {r.warningItems.map((w) => <p key={w.key} className="note warn">{t(w.key, w.vars)}</p>)}
          {r.canStart && <p className="note ok">{t("Всё готово: карта, команды, дела.")}</p>}
          <div className="actions"><button onClick={() => void start()} disabled={!r.canStart || busy}>{t("Начать игру")}</button></div>
        </>
      ) : <p className="muted">{t("Проверка…")}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
