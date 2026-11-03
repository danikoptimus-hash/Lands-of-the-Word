import { useEffect, useState } from "react";
import { api, ApiError, apiReady, ready, type PassageDto, type PassageStatus } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip, type ChipTone } from "../components/Chip";
import { TeamAvatar } from "../components/TeamAvatar";
import { Help } from "../components/Help";
import { EmptyState } from "../components/State";
import { Tabs } from "../components/Tabs";

export interface PassagesDto { canSpeak: boolean; /** Почему запрос отправить нельзя; null — можно. */ speakWhy?: string | null; outgoing: PassageDto[]; incoming: PassageDto[] }

/** Статус запроса прохода: подпись и тон по единой палитре (ждём — warn, разрешён — success, отказ/сброшен при смене владельца — danger). */
export function passageStatus(s: PassageStatus): { label: string; tone: ChipTone; icon: string } {
  switch (s) {
    case "PENDING": return { label: t("ждём ответа"), tone: "warn", icon: "clock" };
    case "APPROVED": return { label: t("разрешён"), tone: "ok", icon: "check" };
    case "DECLINED": return { label: t("отказ"), tone: "bad", icon: "x" };
    case "EXPIRED": return { label: t("нет ответа — отказ"), tone: "bad", icon: "clock" };
    default: return { label: t("сброшен: город сменил владельца"), tone: "bad", icon: "lock" };
  }
}
const PassageChip = ({ s }: { s: PassageStatus }) => { const p = passageStatus(s); return <Chip tone={p.tone} icon={p.icon}>{p.label}</Chip>; };

/** В попапе чужого города: состояние прохода и запрос разрешения (посол, а без посла — капитан или заместитель). */
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
    try { await api(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/passage`, { method: "POST", body: JSON.stringify({ message }) }); notify(t("Запрос отправлен: ждём ответа владельца, молчание — отказ.")); setMessage(""); await load(); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  return (
    <div className="passage-section">
      <div className="row between"><h3>{t("Проход через город")}<Help>{t("Дальше через чужой город идти нельзя без разрешения владельца.")}</Help></h3>{last && <PassageChip s={last.status} />}</div>
      {last?.status === "APPROVED" ? (
        <p className="muted small mt-2">{t("Проход открыт: стороны за городом доступны.")}{last.answer ? ` ${t("Ответ: «{a}»", { a: last.answer })}` : ""}</p>
      ) : last?.status === "PENDING" ? (
        <p className="muted small mt-2">{t("Запрос отправлен {d}. Ответ до {until}; молчание — отказ.", { d: fmtDate(last.createdAt), until: fmtDate(last.expiresAt) })}</p>
      ) : (
        <>
          {last && <p className="muted small mt-2">{t("Последний ответ: {s}", { s: passageStatus(last.status).label })}{last.answer ? ` («${last.answer}»)` : ""}.</p>}
          {data?.canSpeak ? (
            <>
              <div className="field">
                <label htmlFor="passage-msg">{t("Сообщение владельцу")} <span className="opt">{t("необязательно")}</span></label>
                <input id="passage-msg" className="full" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} />
              </div>
              <div className="actions"><button type="button" disabled={busy} onClick={() => void request()}><Icon name="handshake" />{t("Запросить проход")}</button></div>
            </>
          ) : data ? <p className="hint">{data.speakWhy || t("Запрос отправляет посол, а без посла — капитан или заместитель.")}</p> : null}
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * В боковом меню «Проходы» — две вкладки (решение владельца 01.11: «разделить наши запросы и запросы других команд»):
 * «К нам» — запросы других команд через наши города (ответить, можно текстом) и выданные разрешения (безотзывные);
 * «Наши» — наши запросы через чужие города с их состоянием. Открывается та, где есть что решать.
 * Внутри каждой — «Открытые» и «Закрытые» (решение владельца 03.11).
 */
export function DiplomacyMenu({ gameId, data, onChanged }: { gameId: string; data: PassagesDto | null; onChanged: () => void }) {
  const { notify } = useUi();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"in" | "out" | null>(null);
  async function decide(r: PassageDto, approve: boolean) {
    setBusy(r.id);
    try { await api(`/api/games/${gameId}/passages/${r.id}/decide`, { method: "POST", body: JSON.stringify({ approve, answer: answers[r.id] ?? "" }) }); notify(approve ? t("Проход разрешён") : t("В проходе отказано"), "info"); onChanged(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(null); }
  }
  const incoming = data?.incoming ?? [], outAll = data?.outgoing ?? [];
  // Внутри каждой вкладки — «Открытые» (ждут ответа) и «Закрытые» (разрешены, отказаны, без ответа, сброшены)
  // (решение владельца 03.11: «проходы открытые, которые пока не приняты другой командой, и закрытые»).
  const [phase, setPhase] = useState<"open" | "closed" | null>(null);
  const inOpen = incoming.filter((r) => r.status === "PENDING"), inClosed = incoming.filter((r) => r.status !== "PENDING");
  const outOpen = outAll.filter((r) => r.status === "PENDING"), outClosed = outAll.filter((r) => r.status !== "PENDING").slice(0, 10);
  // Пока запросов нет, блока нет вовсе (решение владельца 21.09): появляется вместе с первым запросом.
  if (incoming.length === 0 && outAll.length === 0) return null;
  const inCount = incoming.length, outCount = outOpen.length + outClosed.length;
  const shown: "in" | "out" = tab ?? (inOpen.length > 0 || (inCount > 0 && outCount === 0) ? "in" : outCount > 0 ? "out" : "in");
  const open = shown === "in" ? inOpen : outOpen, closed = shown === "in" ? inClosed : outClosed;
  const phaseShown: "open" | "closed" = phase ?? (open.length > 0 ? "open" : "closed");
  const row = (r: PassageDto, title: string, meta: string) => (
    <li key={r.id}>
      <div className="main"><span className="title">{title}</span><span className="meta">{meta}</span>{r.message && <span className="meta">«{r.message}»</span>}{r.answer && <span className="meta">{t("Ответ: «{a}»", { a: r.answer })}</span>}</div>
      {r.status === "APPROVED" && shown === "in" ? <span className="muted small">{t("действует, пока город ваш")}</span> : <PassageChip s={r.status} />}
    </li>
  );
  return (
    <section className="section">
      <h2><Icon name="handshake" />{t("Проходы")}{inOpen.length > 0 && <span className="count-chip hot">{inOpen.length}</span>}</h2>
      <Tabs items={[{ key: "in", label: t("К нам"), icon: "city", count: inCount || undefined, hot: inOpen.length > 0 }, { key: "out", label: t("Наши"), icon: "flag", count: outCount || undefined }]} value={shown} onChange={setTab} ariaLabel={t("Проходы")} />
      <Tabs items={[{ key: "open", label: t("Открытые"), count: open.length || undefined, hot: shown === "in" && inOpen.length > 0 }, { key: "closed", label: t("Закрытые"), count: closed.length || undefined }]} value={phaseShown} onChange={setPhase} ariaLabel={t("Какие проходы показывать")} swipe={false} />
      {phaseShown === "open" && open.length === 0 && <EmptyState inline icon="handshake" text={shown === "in" ? t("Открытых запросов к вам нет.") : t("Открытых запросов у вас нет.")} />}
      {phaseShown === "closed" && closed.length === 0 && <EmptyState inline icon="handshake" text={shown === "in" ? t("Закрытых запросов к вам нет.") : t("Закрытых запросов у вас нет.")} />}
      {shown === "in" && phaseShown === "open" && inOpen.map((r) => (
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
          ) : <p className="hint">{t("Отвечает посол, а без посла — капитан или заместитель.")}</p>}
        </div>
      ))}
      {shown === "in" && phaseShown === "closed" && inClosed.length > 0 && (
        <ul className="list">{inClosed.map((r) => row(r, t("Проход для «{team}»", { team: r.requester.name }), r.bookName))}</ul>
      )}
      {/* Во вкладке «Наши» слово «наш запрос» лишнее (правило владельца 01.11: не дублировать): только город и владелец. */}
      {/* Текст своего запроса и ответ владельца (замечание владельца 01.11: «участники не видят текст своего запроса на проход»). */}
      {shown === "out" && (phaseShown === "open" ? outOpen : outClosed).length > 0 && (
        <ul className="list">{(phaseShown === "open" ? outOpen : outClosed).map((r) => row(r, r.bookName, t("владелец «{team}»", { team: r.owner.name })))}</ul>
      )}
    </section>
  );
}

/** Администратор: все запросы прохода в игре, только для чтения. */
export function PassagesBlock({ gameId, version = 0 }: { gameId: string; version?: number }) {
  const [rows, setRows] = useState<PassageDto[] | null>(() => ready<{ passages: PassageDto[] }>(`/api/games/${gameId}/passages`)?.passages ?? null);
  useEffect(() => { apiReady<{ passages: PassageDto[] }>(`/api/games/${gameId}/passages`).then((r) => setRows(r.passages)).catch(() => setRows([])); }, [gameId, version]);
  return (
    <div className="card">
      <div className="card-head"><h2><span className="ico"><Icon name="handshake" /></span>{t("Проходы")} {rows && rows.length > 0 && <span className="count">{rows.length}</span>}</h2></div>
      {rows === null ? <div className="skeleton" /> : rows.length === 0 ? <EmptyState inline icon="handshake" text={t("Запросов прохода пока не было.")} /> : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="main">
                <span className="row"><TeamAvatar name={r.requester.name} color={r.requester.color} avatarId={r.requester.avatarId} size="sm" withName teamId={r.requester.id} /><Icon name="chevron" className="muted" /><TeamAvatar name={r.owner.name} color={r.owner.color} avatarId={r.owner.avatarId} size="sm" withName /></span>
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
