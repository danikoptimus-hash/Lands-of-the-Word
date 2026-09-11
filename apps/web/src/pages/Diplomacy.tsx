import { useEffect, useState } from "react";
import { api, ApiError, type PassageDto, type PassageStatus } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip, type ChipTone } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { EmptyState } from "../components/State";

export interface PassagesDto { canSpeak: boolean; outgoing: PassageDto[]; incoming: PassageDto[] }

/** Статус запроса прохода: подпись и тон по единой палитре (ждём — warn, разрешён — success, отказ/закрыт — danger). */
export function passageStatus(s: PassageStatus): { label: string; tone: ChipTone; icon: string } {
  switch (s) {
    case "PENDING": return { label: t("ждём ответа"), tone: "warn", icon: "clock" };
    case "APPROVED": return { label: t("разрешён"), tone: "ok", icon: "check" };
    case "DECLINED": return { label: t("отказ"), tone: "bad", icon: "x" };
    case "EXPIRED": return { label: t("нет ответа — отказ"), tone: "bad", icon: "clock" };
    default: return { label: t("закрыт"), tone: "bad", icon: "lock" };
  }
}
const PassageChip = ({ s }: { s: PassageStatus }) => { const p = passageStatus(s); return <Chip tone={p.tone} icon={p.icon}>{p.label}</Chip>; };

/** В попапе чужого города: состояние прохода и запрос разрешения (посол или капитан). */
export function PassageSection({ gameId, nodeKey, version, onChanged }: { gameId: string; nodeKey: string; version: number; onChanged: () => void }) {
  const { notify } = useUi();
  const [data, setData] = useState<PassagesDto | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<PassagesDto>(`/api/games/${gameId}/my-passages`).then(setData).catch(() => setData(null));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [gameId, version]);
  const mine = data?.outgoing.filter((r) => r.nodeKey === nodeKey) ?? [];
  const last = mine[0];
  async function request() {
    setError(null); setBusy(true);
    try { await api(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/passage`, { method: "POST", body: JSON.stringify({ message }) }); notify(t("Запрос отправлен: у владельца три дня на ответ")); setMessage(""); await load(); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  return (
    <div className="passage-section">
      <div className="row between"><h3>{t("Проход через город")}</h3>{last && <PassageChip s={last.status} />}</div>
      {last?.status === "APPROVED" ? (
        <p className="muted small mt-2">{t("Проход открыт: стороны за городом доступны. Владелец может закрыть его в любой момент.")}{last.answer ? ` ${t("Ответ: «{a}»", { a: last.answer })}` : ""}</p>
      ) : last?.status === "PENDING" ? (
        <p className="muted small mt-2">{t("Запрос отправлен {d}. Ответ до {until}; молчание — отказ.", { d: fmtDate(last.createdAt), until: fmtDate(last.expiresAt) })}</p>
      ) : (
        <>
          <p className="muted small mt-2">{t("Дальше через чужой город идти нельзя без разрешения владельца.")}{last ? ` ${t("Последний ответ: {s}", { s: passageStatus(last.status).label })}${last.answer ? ` («${last.answer}»)` : ""}.` : ""}</p>
          {data?.canSpeak ? (
            <>
              <div className="field">
                <label htmlFor="passage-msg">{t("Сообщение владельцу")} <span className="opt">{t("необязательно")}</span></label>
                <input id="passage-msg" className="full" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} />
              </div>
              <div className="actions"><button type="button" disabled={busy} onClick={() => void request()}><Icon name="handshake" />{t("Запросить проход")}</button></div>
            </>
          ) : <p className="hint">{t("Запрос отправляет посол команды, а если посла нет — капитан.")}</p>}
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/** В боковом меню «Проходы»: входящие запросы (ответить, можно текстом), выданные разрешения (отозвать), наши запросы. */
export function DiplomacyMenu({ gameId, data, onChanged }: { gameId: string; data: PassagesDto | null; onChanged: () => void }) {
  const { confirm, notify } = useUi();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  async function decide(r: PassageDto, approve: boolean) {
    setBusy(r.id);
    try { await api(`/api/games/${gameId}/passages/${r.id}/decide`, { method: "POST", body: JSON.stringify({ approve, answer: answers[r.id] ?? "" }) }); notify(approve ? t("Проход разрешён") : t("В проходе отказано"), "info"); onChanged(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(null); }
  }
  async function revoke(r: PassageDto) {
    if (!(await confirm(t("Их уже взятые дела останутся, новые дела за городом им не достанутся."), { title: t("Отозвать проход для «{team}» через {book}?", { team: r.requester.name, book: r.bookName }), okLabel: t("Отозвать проход"), danger: true }))) return;
    setBusy(r.id);
    try { await api(`/api/games/${gameId}/passages/${r.id}/revoke`, { method: "POST" }); notify(t("Проход отозван"), "info"); onChanged(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(null); }
  }
  const pending = data?.incoming.filter((r) => r.status === "PENDING") ?? [];
  const granted = data?.incoming.filter((r) => r.status === "APPROVED") ?? [];
  const outgoing = data?.outgoing.slice(0, 5) ?? [];
  const empty = pending.length === 0 && granted.length === 0 && outgoing.length === 0;
  return (
    <section className="section">
      <h2><Icon name="handshake" />{t("Проходы")}{pending.length > 0 && <span className="count-chip hot">{pending.length}</span>}</h2>
      {empty && <EmptyState inline icon="handshake" text={t("Запросов прохода нет.")} />}
      {pending.map((r) => (
        <div key={r.id} className="passage-card">
          <div><strong>«{r.requester.name}»</strong> {t("просит проход через")} <strong>{r.bookName}</strong></div>
          {r.message && <p className="muted small">«{r.message}»</p>}
          <p className="hint">{t("Ответить до {d} · молчание — отказ", { d: fmtDate(r.expiresAt) })}</p>
          {data?.canSpeak ? (
            <>
              <div className="field">
                <label htmlFor={"answer-" + r.id}>{t("Ответ")} <span className="opt">{t("необязательно")}</span></label>
                <input id={"answer-" + r.id} className="full" value={answers[r.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [r.id]: e.target.value })} maxLength={500} />
              </div>
              <div className="actions">
                <button type="button" disabled={busy === r.id} onClick={() => void decide(r, true)}><Icon name="check" />{t("Разрешить")}</button>
                <button type="button" className="secondary" disabled={busy === r.id} onClick={() => void decide(r, false)}>{t("Отказать")}</button>
              </div>
            </>
          ) : <p className="hint">{t("Отвечает посол или капитан.")}</p>}
        </div>
      ))}
      {granted.length > 0 && (
        <ul className="list">
          {granted.map((r) => (
            <li key={r.id}>
              <div className="main"><span className="title">{t("Проход для «{team}»", { team: r.requester.name })}</span><span className="meta">{r.bookName}</span></div>
              {data?.canSpeak && <button type="button" className="ghost sm" disabled={busy === r.id} onClick={() => void revoke(r)}>{t("Отозвать проход")}</button>}
            </li>
          ))}
        </ul>
      )}
      {outgoing.length > 0 && (
        <ul className="list">
          {outgoing.map((r) => (
            <li key={r.id}>
              <div className="main"><span className="title">{t("Наш запрос: {book}", { book: r.bookName })}</span><span className="meta">{t("владелец «{team}»", { team: r.owner.name })}{r.answer ? ` · «${r.answer}»` : ""}</span></div>
              <PassageChip s={r.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Администратор: все запросы прохода в игре, только для чтения. */
export function PassagesBlock({ gameId, version = 0 }: { gameId: string; version?: number }) {
  const [rows, setRows] = useState<PassageDto[] | null>(null);
  useEffect(() => { api<{ passages: PassageDto[] }>(`/api/games/${gameId}/passages`).then((r) => setRows(r.passages)).catch(() => setRows([])); }, [gameId, version]);
  return (
    <div className="card">
      <div className="card-head"><h2><span className="ico"><Icon name="handshake" /></span>{t("Проходы")} {rows && rows.length > 0 && <span className="count">{rows.length}</span>}</h2></div>
      {rows === null ? <div className="skeleton" /> : rows.length === 0 ? <EmptyState inline icon="handshake" text={t("Запросов прохода пока не было.")} /> : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="main">
                <span className="row"><TeamAvatar name={r.requester.name} color={r.requester.color} size="sm" withName /><Icon name="chevron" className="muted" /><TeamAvatar name={r.owner.name} color={r.owner.color} size="sm" withName /></span>
                <span className="meta">{t("проход через {book}", { book: r.bookName })} · {fmtDate(r.createdAt)}</span>
                {r.message && <span className="meta">«{r.message}»</span>}
                {r.answer && <span className="meta">{t("Ответ: «{a}»", { a: r.answer })}</span>}
              </div>
              <PassageChip s={r.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
