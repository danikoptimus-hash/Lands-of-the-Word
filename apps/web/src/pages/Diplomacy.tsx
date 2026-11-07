import { useEffect, useState } from "react";
import { api, ApiError, apiReady, ready, type PassageDto, type PassageStatus } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { AutoGrow } from "../components/AutoGrow";
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
                <AutoGrow id="passage-msg" className="full" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} />
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
 * «Наши» — наши запросы через чужие города с их состоянием. По умолчанию открыты «К нам» и «Открытые» (решение владельца 07.11:
 * «это самые важные вкладки»), а не та, где больше записей.
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
  const shown: "in" | "out" = tab ?? "in";
  const open = shown === "in" ? inOpen : outOpen, closed = shown === "in" ? inClosed : outClosed;
  const phaseShown: "open" | "closed" = phase ?? "open";
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

/**
 * Администратор: все запросы прохода в игре, только для чтения. Решение владельца 03.11: вкладки «Открытые / Закрытые»;
 * строка как у испытаний — город заголовком, аватарки команд (кто просит → чей город) со стрелкой; текст запроса и ответ
 * скрыты, раскрываются нажатием на строку.
 */
export function PassagesBlock({ gameId, version = 0 }: { gameId: string; version?: number }) {
  const [rows, setRows] = useState<PassageDto[] | null>(() => ready<{ passages: PassageDto[] }>(`/api/games/${gameId}/passages`)?.passages ?? null);
  const [filter, setFilter] = useState<"open" | "closed" | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => { apiReady<{ passages: PassageDto[] }>(`/api/games/${gameId}/passages`).then((r) => setRows(r.passages)).catch(() => setRows([])); }, [gameId, version]);
  const all = rows ?? [];
  const open = all.filter((r) => r.status === "PENDING"), closed = all.filter((r) => r.status !== "PENDING");
  // По умолчанию — «Открытые», даже если открытых нет (решение владельца 04.11).
  const shownTab: "open" | "closed" = filter ?? "open";
  const shown = shownTab === "open" ? open : closed;
  const toggle = (id: string) => setExpanded((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <div className="card">
      <div className="card-head"><h2><span className="ico"><Icon name="handshake" /></span>{t("Проходы")} {all.length > 0 && <span className="count">{all.length}</span>}</h2></div>
      {rows === null ? <div className="skeleton" /> : all.length === 0 ? <EmptyState inline icon="handshake" text={t("Запросов прохода пока не было.")} /> : (
        <>
          <Tabs value={shownTab} onChange={setFilter} ariaLabel={t("Какие проходы показывать")} items={[{ key: "open", label: t("Открытые"), count: open.length || undefined }, { key: "closed", label: t("Закрытые"), count: closed.length || undefined }]} />
          {shown.length === 0 ? <EmptyState inline icon="handshake" text={shownTab === "open" ? t("Открытых запросов нет.") : t("Закрытых запросов нет.")} /> : (
            <ul className="list interactive passages">
              {shown.map((r) => {
                const hasText = Boolean(r.message || r.answer), isOpen = expanded.has(r.id);
                const onToggle = () => { if (hasText) toggle(r.id); };
                return (
                  <li key={r.id} role={hasText ? "button" : undefined} tabIndex={hasText ? 0 : undefined} aria-expanded={hasText ? isOpen : undefined} onClick={onToggle} onKeyDown={(e) => { if (hasText && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(); } }}>
                    <div className="main">
                      <span className="trial-head" onClick={(e) => e.stopPropagation()}>
                        <span className="city"><Icon name="city" />{r.bookName}</span>
                        <TeamAvatar name={r.requester.name} color={r.requester.color} avatarId={r.requester.avatarId} size="sm" title={r.requester.name} teamId={r.requester.id} />
                        <Icon name="chevron" className="muted" />
                        <TeamAvatar name={r.owner.name} color={r.owner.color} avatarId={r.owner.avatarId} size="sm" title={r.owner.name} teamId={r.owner.id} />
                      </span>
                      <span className="meta">{fmtDate(r.createdAt)}</span>
                      {isOpen && r.message && <span className="meta">«{r.message}»</span>}
                      {isOpen && r.answer && <span className="meta">{t("Ответ: «{a}»", { a: r.answer })}</span>}
                    </div>
                    <span className="row nowrap"><PassageChip s={r.status} />{hasText && <Icon name="chevron-down" className={"chev" + (isOpen ? " open" : "")} />}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
