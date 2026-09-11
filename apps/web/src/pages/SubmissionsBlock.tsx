import { useEffect, useState } from "react";
import { api, ApiError, PROOF_LABEL, type EdgeTaskDto } from "../lib/api";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";

type Row = EdgeTaskDto & { team: { id: string; name: string; color: string }; takenBy: { nickname: string; displayName: string | null } | null };

/** Очередь сдач для админа. Обновляется сама раз в 15 секунд. */
export function SubmissionsBlock({ gameId, version = 0, onDecided }: { gameId: string; version?: number; onDecided: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [comment, setComment] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ tasks: Row[] }>(`/api/games/${gameId}/submissions`).then((r) => setRows(r.tasks)).catch(() => setRows([]));
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [gameId, version]);

  async function decide(id: string, approve: boolean) {
    setError(null);
    try { await api(`/api/games/${gameId}/edge-tasks/${id}/decide`, { method: "POST", body: JSON.stringify({ approve, comment: comment[id] ?? "" }) }); await load(); onDecided(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
  }

  return (
    <div className="card" data-tone="green">
      <div className="card-head"><h2><span className="ico"><Icon name="check" /></span>{t("Сдачи на проверку")} <span className={"badge" + (rows.length ? " accent" : "")}>{rows.length}</span></h2></div>
      {error && <p className="error">{error}</p>}
      {rows.length === 0 ? <p className="muted">{t("Пока тихо. Как только команда сдаст дело, оно появится здесь.")}</p> : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} style={{ alignItems: "flex-start" }}>
              <div className="main">
                <div><span className="badge" style={{ background: r.team.color, color: "#fff", borderColor: "transparent" }}>{r.team.name}</span> <strong>{r.deed.title}</strong> <span className="muted">· {PROOF_LABEL[r.deed.proofType]}</span>{r.donation && <span className="badge accent" style={{ marginLeft: ".4rem" }}>{t("пожертвование {n}", { n: r.donationAmount ?? "" })}</span>}</div>
                <div className="muted">{r.takenBy ? (r.takenBy.displayName ?? r.takenBy.nickname) : "—"}{r.submittedAt ? ` · ${new Date(r.submittedAt).toLocaleString("ru")}` : ""}</div>
                {r.note && <div style={{ margin: ".3rem 0" }}>{r.note}</div>}
                {r.links.map((l) => <div key={l}><a href={l} target="_blank" rel="noopener noreferrer">{l}</a></div>)}
                <input placeholder={t("Комментарий (необязательно)")} value={comment[r.id] ?? ""} onChange={(e) => setComment({ ...comment, [r.id]: e.target.value })} style={{ marginTop: ".4rem", minHeight: 36 }} />
              </div>
              <div className="side">
                <button className="sm" onClick={() => void decide(r.id, true)}>{t("Одобрить")}</button>
                <button className="secondary sm" onClick={() => void decide(r.id, false)}>{t("Вернуть")}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
