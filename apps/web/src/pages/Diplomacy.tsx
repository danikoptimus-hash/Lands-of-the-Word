import { useEffect, useState } from "react";
import { api, ApiError, PASSAGE_LABEL, type PassageDto } from "../lib/api";
import { useUi } from "../lib/ui";

interface PassagesDto { canSpeak: boolean; outgoing: PassageDto[]; incoming: PassageDto[] }

/** В попапе чужого города: состояние прохода и запрос разрешения (посол или капитан). */
export function PassageSection({ gameId, nodeKey, version, onChanged }: { gameId: string; nodeKey: string; version: number; onChanged: () => void }) {
  const { notify } = useUi();
  const [data, setData] = useState<PassagesDto | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => api<PassagesDto>(`/api/games/${gameId}/my-passages`).then(setData).catch(() => setData(null));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, version]);
  const mine = data?.outgoing.filter((r) => r.nodeKey === nodeKey) ?? [];
  const last = mine[0];
  async function request() {
    setError(null);
    try { await api(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/passage`, { method: "POST", body: JSON.stringify({ message }) }); notify("Запрос отправлен: у владельца три дня на ответ"); setMessage(""); await load(); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
  }
  return (
    <div className="war" style={{ marginTop: ".8rem" }}>
      <div className="row between" style={{ alignItems: "baseline" }}><strong>Проход через город</strong>{last && <span className={"badge" + (last.status === "APPROVED" ? " ok" : last.status === "PENDING" ? " accent" : " bad")}>{PASSAGE_LABEL[last.status]}</span>}</div>
      {last?.status === "APPROVED" ? <p className="muted" style={{ margin: ".3rem 0" }}>Владелец разрешил проход: стороны за городом открыты. Владелец может закрыть проход в любой момент.{last.answer ? ` Ответ: ${last.answer}` : ""}</p>
        : last?.status === "PENDING" ? <p className="muted" style={{ margin: ".3rem 0" }}>Запрос отправлен {new Date(last.createdAt).toLocaleString("ru")}. Ответ до {new Date(last.expiresAt).toLocaleString("ru")}; молчание — отказ.</p>
        : (
          <>
            <p className="muted" style={{ margin: ".3rem 0" }}>Дальше через чужой город идти нельзя без разрешения владельца.{last ? ` Последний ответ: ${PASSAGE_LABEL[last.status]}${last.answer ? ` (${last.answer})` : ""}.` : ""}</p>
            {data?.canSpeak ? (
              <>
                <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Сообщение владельцу (необязательно)" maxLength={500} />
                <div className="actions"><button className="secondary" onClick={() => void request()}>Запросить проход</button></div>
              </>
            ) : <p className="hint">Запрос отправляет посол команды, а если посла нет — капитан.</p>}
          </>
        )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** В боковом меню: входящие запросы (ответить), выданные разрешения (закрыть), мои запросы. */
export function DiplomacyMenu({ gameId, version }: { gameId: string; version: number }) {
  const { confirm, notify } = useUi();
  const [data, setData] = useState<PassagesDto | null>(null);
  const load = () => api<PassagesDto>(`/api/games/${gameId}/my-passages`).then(setData).catch(() => setData(null));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, version]);
  if (!data || (data.incoming.length === 0 && data.outgoing.length === 0)) return null;
  async function decide(r: PassageDto, approve: boolean) {
    const answer = "";
    try { await api(`/api/games/${gameId}/passages/${r.id}/decide`, { method: "POST", body: JSON.stringify({ approve, answer }) }); notify(approve ? "Проход разрешён" : "Отказано"); await load(); }
    catch (e) { notify(e instanceof ApiError ? e.message : "Ошибка сети", "bad"); }
  }
  async function revoke(r: PassageDto) {
    if (!(await confirm(`Закрыть проход для «${r.requester.name}» через ${r.bookName}? Их уже взятые дела останутся.`, { okLabel: "Закрыть проход", danger: true }))) return;
    try { await api(`/api/games/${gameId}/passages/${r.id}/revoke`, { method: "POST" }); await load(); }
    catch (e) { notify(e instanceof ApiError ? e.message : "Ошибка сети", "bad"); }
  }
  const pending = data.incoming.filter((r) => r.status === "PENDING");
  const granted = data.incoming.filter((r) => r.status === "APPROVED");
  return (
    <div className="section">
      <h2>Дипломатия {pending.length > 0 && <span className="badge accent">{pending.length}</span>}</h2>
      {pending.map((r) => (
        <div key={r.id} className="battle def">
          <div><strong>«{r.requester.name}»</strong> просит проход через <strong>{r.bookName}</strong></div>
          {r.message && <div className="muted">«{r.message}»</div>}
          <div className="muted" style={{ fontSize: ".85rem" }}>ответить до {new Date(r.expiresAt).toLocaleString("ru")}, молчание — отказ</div>
          {data.canSpeak ? <div className="actions"><button className="sm" onClick={() => void decide(r, true)}>Разрешить</button><button className="secondary sm" onClick={() => void decide(r, false)}>Отказать</button></div> : <p className="hint">Отвечает посол или капитан.</p>}
        </div>
      ))}
      {granted.length > 0 && <ul className="list">{granted.map((r) => <li key={r.id}><span>Проход для «{r.requester.name}» через {r.bookName}</span>{data.canSpeak && <button className="ghost sm" onClick={() => void revoke(r)}>Закрыть</button>}</li>)}</ul>}
      {data.outgoing.length > 0 && <ul className="list">{data.outgoing.slice(0, 5).map((r) => <li key={r.id}><span className="muted">Наш запрос: {r.bookName} у «{r.owner.name}»</span><span className={"badge" + (r.status === "APPROVED" ? " ok" : r.status === "PENDING" ? " accent" : " bad")}>{PASSAGE_LABEL[r.status]}</span></li>)}</ul>}
    </div>
  );
}

/** Админ: запросы прохода в игре. */
export function PassagesBlock({ gameId, version = 0 }: { gameId: string; version?: number }) {
  const [rows, setRows] = useState<PassageDto[]>([]);
  useEffect(() => { api<{ passages: PassageDto[] }>(`/api/games/${gameId}/passages`).then((r) => setRows(r.passages)).catch(() => setRows([])); }, [gameId, version]);
  if (rows.length === 0) return null;
  return (
    <div className="card">
      <div className="card-head"><h2>Дипломатия <span className="muted">{rows.length}</span></h2></div>
      <ul className="list">
        {rows.map((r) => (
          <li key={r.id}>
            <div className="main"><span className="badge" style={{ background: r.requester.color, color: "#fff", borderColor: "transparent" }}>{r.requester.name}</span> → <span className="badge" style={{ background: r.owner.color, color: "#fff", borderColor: "transparent" }}>{r.owner.name}</span> проход через <strong>{r.bookName}</strong>{r.message && <div className="muted">«{r.message}»</div>}{r.answer && <div className="muted">Ответ: {r.answer}</div>}</div>
            <span className={"badge" + (r.status === "APPROVED" ? " ok" : r.status === "PENDING" ? " accent" : " bad")}>{PASSAGE_LABEL[r.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
