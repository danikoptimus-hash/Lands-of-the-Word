import { useEffect, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, BATTLE_STATUS_LABEL, type BattleDto } from "../lib/api";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

/** Админ: битвы игры и проверка записей (ссылки на видео) обеих сторон. */
export function BattlesBlock({ gameId, version = 0, onDecided }: { gameId: string; version?: number; onDecided: () => void }) {
  const [rows, setRows] = useState<BattleDto[]>([]);
  const [comment, setComment] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const load = () => api<{ battles: BattleDto[] }>(`/api/games/${gameId}/battles`).then((r) => setRows(r.battles)).catch(() => setRows([]));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, version]);

  async function decide(battleId: string, entryId: string, approve: boolean) {
    setError(null);
    try { await api(`/api/games/${gameId}/battles/${battleId}/entries/${entryId}/decide`, { method: "POST", body: JSON.stringify({ approve, comment: comment[entryId] ?? "" }) }); await load(); onDecided(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
  }
  const active = rows.filter((b) => b.status === "ATTACK" || b.status === "DEFENSE" || b.status === "QUEUED");
  const pending = rows.reduce((n, b) => n + b.entries.filter((e) => e.status === "SUBMITTED").length, 0);
  const shown = showAll ? rows : active;
  return (
    <div className="card">
      <div className="card-head">
        <h2>Битвы <span className={"badge" + (pending ? " accent" : "")}>{pending ? `${pending} на проверке` : active.length}</span></h2>
        {rows.length > active.length && <button className="secondary sm" onClick={() => setShowAll((v) => !v)}>{showAll ? "Только активные" : `Все (${rows.length})`}</button>}
      </div>
      {error && <p className="error">{error}</p>}
      {shown.length === 0 ? <p className="muted">Битв нет.</p> : shown.map((b) => (
        <div key={b.id} className={"battle admin " + b.status.toLowerCase()}>
          <div className="row between">
            <div><span className="badge" style={{ background: b.attacker.color, color: "#fff", borderColor: "transparent" }}>{b.attacker.name}</span> → <span className="badge" style={{ background: b.defender.color, color: "#fff", borderColor: "transparent" }}>{b.defender.name}</span> <strong>город {BOOK_BY_CODE.get(b.bookCode)?.nameRu}</strong></div>
            <span className="badge">{BATTLE_STATUS_LABEL[b.status]}</span>
          </div>
          <div className="muted" style={{ fontSize: ".9rem" }}>
            ставка {b.bid} ст.{b.passage ? ` · отрывок атаки ${b.passage.ref}` : ""} · атака: выучено {b.attackSum}, одобрено {b.attackApproved}{b.attackDoneAt ? " · отправлена" : ""}
            {b.attackDeadline && b.status === "ATTACK" ? ` · до ${new Date(b.attackDeadline).toLocaleString("ru")}` : ""}
            {b.defensePassage ? ` · отрывок обороны ${b.defensePassage.ref}` : ""}
            {b.status === "DEFENSE" || b.defenseSum > 0 ? ` · оборона: выучено ${b.defenseSum}, одобрено ${b.defenseApproved} (нужно ${b.attackApproved})${b.defenseDoneAt ? " · отправлена" : ""}` : ""}
            {b.defenseDeadline ? ` · оборона до ${new Date(b.defenseDeadline).toLocaleString("ru")}` : ""}
            {b.defenseBid != null && b.status === "REPELLED" ? ` · отражено ${b.defenseBid} ст.` : ""}
          </div>
          {b.entries.length > 0 && (
            <ul className="list">
              {b.entries.map((e) => (
                <li key={e.id} style={{ alignItems: "flex-start" }}>
                  <div className="main">
                    <div><span className="badge">{e.side === "ATTACK" ? "атака" : "оборона"}</span> <strong>{e.ref}</strong> <span className="muted">· {e.verses} ст. · {e.nickname} · {new Date(e.createdAt).toLocaleString("ru")}</span></div>
                    {e.note && <div className="muted">{e.note}</div>}
                    {e.links.map((l) => <div key={l}><a href={l} target="_blank" rel="noopener noreferrer">{l}</a></div>)}
                    {e.status === "SUBMITTED" && <input placeholder="Комментарий (необязательно)" value={comment[e.id] ?? ""} onChange={(ev) => setComment({ ...comment, [e.id]: ev.target.value })} style={{ marginTop: ".4rem", minHeight: 36 }} />}
                  </div>
                  <div className="side">
                    {e.status === "SUBMITTED" ? (
                      <>
                        <button className="sm" onClick={() => void decide(b.id, e.id, true)}>Одобрить</button>
                        <button className="secondary sm" onClick={() => void decide(b.id, e.id, false)}>Вернуть</button>
                      </>
                    ) : <span className={"badge" + (e.status === "APPROVED" ? " ok" : " bad")}>{e.status === "APPROVED" ? "одобрено" : "вернули"}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
