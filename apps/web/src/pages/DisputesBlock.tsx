import { useEffect, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError } from "../lib/api";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";

interface Dispute { id: string; team: { id: string; name: string; color: string }; nodeKey: string; bookCode: string; taskIndex: number; prompt: string; correct: string | null; message: string | null; disputedAt: string | null; lockedUntil: string | null }
const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

/** Споры команд по закрытым заданиям: снять блокировку или оставить, с ответом команде. */
export function DisputesBlock({ gameId, version = 0, onDecided }: { gameId: string; version?: number; onDecided: () => void }) {
  const [rows, setRows] = useState<Dispute[]>([]);
  const [answer, setAnswer] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const load = () => api<{ disputes: Dispute[] }>(`/api/games/${gameId}/disputes`).then((r) => setRows(r.disputes)).catch(() => setRows([]));
  useEffect(() => { void load(); }, [gameId, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function resolve(id: string, unlock: boolean) {
    setError(null);
    try { await api(`/api/games/${gameId}/disputes/${id}/resolve`, { method: "POST", body: JSON.stringify({ unlock, answer: answer[id] ?? "" }) }); await load(); onDecided(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
  }

  return (
    <div className="card" data-tone="warn">
      <div className="card-head"><h2><span className="ico"><Icon name="alert" /></span>{t("Споры по заданиям")} <span className={"badge" + (rows.length ? " accent" : "")}>{rows.length}</span></h2></div>
      {error && <p className="error">{error}</p>}
      {rows.length === 0 ? <p className="muted">{t("Споров нет. Команда может оспорить задание, закрытое после двух неверных ответов.")}</p> : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} style={{ alignItems: "flex-start" }}>
              <div className="main">
                <div><span className="badge" style={{ background: r.team.color, color: "#fff", borderColor: "transparent" }}>{r.team.name}</span> <strong>{t("Город {name}", { name: BOOK_BY_CODE.get(r.bookCode)?.nameRu ?? r.bookCode })}</strong> <span className="muted">· {t("задание")} {r.taskIndex + 1}</span></div>
                <div className="muted" style={{ margin: ".3rem 0" }}>{r.prompt}</div>
                {r.correct && <div className="muted">{t("Верный вариант:")} <strong>{r.correct}</strong></div>}
                <div style={{ margin: ".3rem 0" }}>«{r.message}»</div>
                <input placeholder={t("Ответ команде (необязательно)")} value={answer[r.id] ?? ""} onChange={(e) => setAnswer({ ...answer, [r.id]: e.target.value })} style={{ marginTop: ".4rem", minHeight: 36 }} maxLength={500} />
              </div>
              <div className="side">
                <button className="sm" onClick={() => void resolve(r.id, true)}>{t("Открыть задание")}</button>
                <button className="secondary sm" onClick={() => void resolve(r.id, false)}>{t("Оставить закрытым")}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
