import { useEffect, useState } from "react";
import { api, ApiError, BATTLE_STATUS_LABEL, type BattleDto, type WarDto } from "../lib/api";
import { useUi } from "../lib/ui";

function left(deadline: string | null, now: number): string {
  if (!deadline) return "";
  const ms = Date.parse(deadline) - now;
  if (ms <= 0) return "время вышло";
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
  if (h >= 48) return `${Math.floor(h / 24)} дн ${h % 24} ч`;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин ${s} с`;
}
function dur(from: string | null, to: string | null): string {
  if (!from || !to) return "";
  const ms = Date.parse(to) - Date.parse(from);
  const h = Math.floor(ms / 3_600_000), m = Math.round((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

/**
 * Война за город в попапе города: уровень защиты, объявление войны (только число стихов),
 * записи атаки/обороны со ссылками на видео, таймеры, сдача города.
 */
export function WarSection({ gameId, nodeKey, teamId, isCaptain, version, onChanged }: { gameId: string; nodeKey: string; teamId: string; isCaptain: boolean; version: number; onChanged: () => void }) {
  const { confirm, notify } = useUi();
  const [war, setWar] = useState<WarDto | null>(null);
  const [bid, setBid] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const load = () => api<WarDto>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/war`).then((w) => { setWar(w); setError(null); if (bid === "") setBid(w.minBid); }).catch((e) => setError(e instanceof ApiError ? e.message : "Ошибка сети"));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, nodeKey, version]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!war) return error ? <p className="error">{error}</p> : null;

  async function declare() {
    if (!war || bid === "") return;
    const ok = await confirm(`Объявить войну городу со ставкой ${bid} стихов? Атакующие получат случайный отрывок; с этого момента идёт время атаки (лимит 14 дней).`, { okLabel: "Объявить войну", danger: true });
    if (!ok) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ status: string; sumMode: boolean }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/war`, { method: "POST", body: JSON.stringify({ bid }) });
      notify(r.status === "QUEUED" ? "Вы в очереди: битва за город уже идёт" : "Война объявлена! Отрывок выдан");
      await load(); onChanged();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
    finally { setBusy(false); }
  }

  const active = war.battles.filter((b) => b.status === "QUEUED" || b.status === "ATTACK" || b.status === "DEFENSE");
  const past = war.battles.filter((b) => !active.includes(b)).slice(0, 3);
  return (
    <div className="war">
      <div className="row between" style={{ alignItems: "baseline" }}>
        <strong>Оборона города</strong>
        <span className="muted">уровень {war.defenseLevel}{war.sumMode ? " · суммарный режим" : ""}{war.locked ? " · закреплён навсегда" : ""}{war.bookVerses ? ` · в книге ${war.bookVerses} ст.` : ""}</span>
      </div>
      {error && <p className="error">{error}</p>}
      {war.canDeclare && (
        <div className="declare">
          <p className="muted" style={{ margin: ".3rem 0" }}>Ставка — число стихов, которые команда обязуется выучить и записать. Минимум {war.minBid}{war.penalty ? ` (включая штраф ${war.penalty} за сгоревшие атаки)` : ""}. Стихи выберет игра.{war.queue > 0 ? ` В очереди уже ${war.queue}.` : ""}</p>
          <div className="row">
            <input type="number" min={war.minBid} value={bid} onChange={(e) => setBid(e.target.value === "" ? "" : Number(e.target.value))} style={{ width: 110 }} />
            <button className="danger" disabled={busy || bid === "" || bid < war.minBid} onClick={() => void declare()}>Объявить войну</button>
          </div>
        </div>
      )}
      {!war.canDeclare && war.reason && !active.length && <p className="muted" style={{ margin: ".3rem 0" }}>{war.reason}</p>}
      {active.map((b) => <BattleCard key={b.id} gameId={gameId} b={b} teamId={teamId} isCaptain={isCaptain} now={now} onChanged={() => { void load(); onChanged(); }} />)}
      {past.length > 0 && <ul className="list" style={{ marginTop: ".4rem" }}>{past.map((b) => <li key={b.id}><span className="muted">{new Date(b.declaredAt).toLocaleDateString("ru")} · {b.attacker.name} → {b.defender.name} · {b.bid} ст.</span><span className="badge">{BATTLE_STATUS_LABEL[b.status]}</span></li>)}</ul>}
    </div>
  );
}

/** Карточка активной битвы для участника (атакующего или защитника). */
export function BattleCard({ gameId, b, teamId, isCaptain, now, onChanged, compact }: { gameId: string; b: BattleDto; teamId: string; isCaptain: boolean; now: number; onChanged: () => void; compact?: boolean }) {
  const { confirm, notify } = useUi();
  const attacker = b.attacker.id === teamId;
  const mySide = attacker ? "ATTACK" : "DEFENSE";
  const myTurn = (attacker && b.status === "ATTACK") || (!attacker && b.status === "DEFENSE");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [links, setLinks] = useState(""); const [note, setNote] = useState("");
  const [bid, setBid] = useState(b.bid);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const covered = attacker ? b.attackCovered : b.defenseCovered;
  const mine = b.entries.filter((e) => e.side === mySide);

  async function send() {
    setBusy(true); setError(null);
    try {
      await api(`/api/games/${gameId}/battles/${b.id}/entries`, { method: "POST", body: JSON.stringify({ from, to, links: links.split(/\s+/).filter(Boolean), note }) });
      setFrom(""); setTo(""); setLinks(""); setNote(""); notify("Запись прикреплена"); onChanged();
    } catch (e) { setError(e instanceof ApiError ? (e.issues?.map((i) => i.message).join("; ") || e.message) : "Ошибка сети"); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    try { await api(`/api/games/${gameId}/battles/${b.id}/entries/${id}`, { method: "DELETE" }); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
  }
  async function raise() {
    try { await api(`/api/games/${gameId}/battles/${b.id}/bid`, { method: "POST", body: JSON.stringify({ bid }) }); notify("Ставка обновлена"); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
  }
  async function surrender() {
    if (!(await confirm("Сдать город? Он перейдёт атакующим. Если это столица — команда выбывает из игры.", { okLabel: "Сдать город", danger: true }))) return;
    try { await api(`/api/games/${gameId}/battles/${b.id}/surrender`, { method: "POST" }); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
  }

  const head = attacker ? `Вы атакуете «${b.defender.name}»` : `«${b.attacker.name}» атакует ваш город`;
  return (
    <div className={"battle " + b.status.toLowerCase()}>
      <div className="row between"><strong>{head}</strong><span className={"badge" + (myTurn ? " accent" : "")}>{BATTLE_STATUS_LABEL[b.status]}</span></div>
      <div className="muted" style={{ fontSize: ".9rem" }}>
        Ставка {b.bid} ст.{b.sumMode ? " (сумма по участникам)" : ""}
        {b.status === "ATTACK" && <> · атака до {new Date(b.attackDeadline!).toLocaleDateString("ru")} ({left(b.attackDeadline, now)}){b.attackDoneAt ? " · все ссылки прикреплены, ждём проверки" : ""}</>}
        {b.status === "DEFENSE" && <> · время обороны: {dur(b.startedAt, b.attackDoneAt)} · осталось <strong>{left(b.defenseDeadline, now)}</strong></>}
      </div>
      {attacker && b.passage && (
        <div className="passage">
          <div><strong>Ваш отрывок: {b.passage.ref}</strong> <span className="muted">({b.bid} ст.)</span></div>
          {b.passage.text && !compact && <div className="text">{b.passage.text.map((t, i) => <p key={i}>{t}</p>)}</div>}
        </div>
      )}
      {!attacker && b.status === "ATTACK" && <p className="muted" style={{ margin: ".3rem 0" }}>Атакующие готовят записи. Когда админ их одобрит, у вас будет ровно столько же времени, сколько ушло у них, чтобы записать {b.bid} стихов или больше — отрывок выбираете сами.</p>}
      {b.status === "QUEUED" && attacker && (
        <div className="row" style={{ marginTop: ".3rem" }}>
          <input type="number" value={bid} onChange={(e) => setBid(Number(e.target.value))} style={{ width: 100 }} />
          <button className="secondary sm" onClick={() => void raise()}>Изменить ставку</button>
        </div>
      )}
      {!compact && (myTurn || mine.length > 0) && (
        <>
          <div className="progress"><span style={{ width: `${Math.min(100, (covered / b.bid) * 100)}%` }} /></div>
          <div className="muted" style={{ fontSize: ".85rem" }}>Записано стихов: {covered} из {b.bid}{attacker ? ` · одобрено ${b.attackApproved}` : ` · одобрено ${b.defenseApproved}`}</div>
          {mine.length > 0 && (
            <ul className="list">
              {mine.map((e) => (
                <li key={e.id}>
                  <div className="main"><strong>{e.ref}</strong> <span className="muted">· {e.verses} ст. · {e.nickname}</span>{e.adminComment && <div className="muted">Комментарий: {e.adminComment}</div>}<div>{e.links.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer" style={{ marginRight: ".5rem" }}>видео</a>)}</div></div>
                  <span className={"badge" + (e.status === "APPROVED" ? " ok" : e.status === "REJECTED" ? " bad" : "")}>{e.status === "APPROVED" ? "одобрено" : e.status === "REJECTED" ? "вернули" : "на проверке"}</span>
                  {e.status !== "APPROVED" && myTurn && <button className="ghost sm" onClick={() => void remove(e.id)}>убрать</button>}
                </li>
              ))}
            </ul>
          )}
          {myTurn && (
            <div className="entry-form">
              <div className="row">
                <input placeholder="с (глава:стих)" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 130 }} />
                <input placeholder="по (глава:стих)" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 130 }} />
              </div>
              <textarea rows={2} placeholder="Ссылки на видео (по одной на строку)" value={links} onChange={(e) => setLinks(e.target.value)} />
              <input placeholder="Кто рассказывает (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
              {error && <p className="error">{error}</p>}
              <div className="actions">
                <button disabled={busy || !from || !to || !links.trim()} onClick={() => void send()}>Прикрепить ссылки</button>
                {!attacker && isCaptain && <button className="ghost" onClick={() => void surrender()}>Сдать город</button>}
              </div>
            </div>
          )}
        </>
      )}
      {compact && error && <p className="error">{error}</p>}
    </div>
  );
}
