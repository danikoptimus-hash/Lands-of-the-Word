import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type TradeDto, type TradesDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { Help } from "../components/Help";
import { useGameEvents } from "../lib/useGameEvents";

/**
 * Обмен городами (решение владельца 04.10): только для послов. Посол выставляет свой город другой команде (у города
 * показано число слов в его книге), посол другой команды предлагает взамен свой; первый меняется или отклоняет
 * встречный город и ждёт другого; если переговоры зашли в тупик, любая сторона отменяет сделку. Раздел в меню
 * «Команды» рядом с проходами, виден только послу.
 */
const words = (n: number) => plural(n, [t("слово"), t("слова"), t("слов")]);
const CityLine = ({ c }: { c: { bookName: string; words: number } }) => <span className="trade-city"><Icon name="city" /><b>{c.bookName}</b> · {words(c.words)}</span>;

export function TradesSection({ gameId, onChanged }: { gameId: string; onChanged?: () => void }) {
  const { notify, confirm } = useUi();
  const [data, setData] = useState<TradesDto | null>(null);
  const [toTeamId, setToTeamId] = useState("");
  const [offerKey, setOfferKey] = useState("");
  const [message, setMessage] = useState("");
  const [counter, setCounter] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api<TradesDto>(`/api/games/${gameId}/my-trades`).then(setData).catch(() => {}), [gameId]);
  useEffect(() => { void load(); }, [load]);
  useGameEvents(gameId, (e) => { if (e.type === "trades" || e.type === "cities" || e.type === "teams") void load(); });
  if (!data || !data.canTrade) return null;

  async function call(key: string, url: string, body?: unknown, done?: string) {
    setBusy(key);
    try { await api(url, { method: "POST", body: JSON.stringify(body ?? {}) }); if (done) notify(done); await load(); onChanged?.(); return true; }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); return false; }
    finally { setBusy(null); }
  }
  const tradable = data.myCities.filter((c) => !c.reason);
  const active = data.trades.filter((x) => x.status === "OPEN" || x.status === "COUNTERED");
  const closed = data.trades.filter((x) => x.status === "DONE" || x.status === "CANCELLED");
  const statusChip = (x: TradeDto) => x.status === "DONE" ? <Chip tone="ok" icon="check">{t("обмен состоялся")}</Chip> : x.status === "CANCELLED" ? <Chip tone="bad" icon="x">{t("отменена")}</Chip> : x.status === "COUNTERED" ? <Chip tone="info" icon="handshake">{t("есть встречный город")}</Chip> : <Chip tone="warn" icon="clock">{t("ждём встречный город")}</Chip>;

  async function propose() {
    if (!toTeamId || !offerKey) { notify(t("Выберите команду и город"), "bad"); return; }
    if (await call("new", `/api/games/${gameId}/trades`, { toTeamId, offerKey, message }, t("Предложение отправлено"))) { setOfferKey(""); setMessage(""); }
  }
  async function accept(x: TradeDto) {
    if (!x.counter) return;
    if (!(await confirm(t("Город {a} уйдёт команде «{team}», город {b} станет вашим. Обменяться?", { a: x.offer.bookName, team: x.to.name, b: x.counter.bookName }), { title: t("Обмен городами"), okLabel: t("Обменять") }))) return;
    await call(x.id, `/api/games/${gameId}/trades/${x.id}/accept`, {}, t("Города обменяны"));
  }
  async function cancel(x: TradeDto) {
    if (!(await confirm(t("Сделка с командой «{team}» будет отменена.", { team: x.mine ? x.to.name : x.from.name }), { title: t("Отменить сделку?"), okLabel: t("Отменить сделку"), danger: true }))) return;
    await call(x.id, `/api/games/${gameId}/trades/${x.id}/cancel`, {}, t("Сделка отменена"));
  }

  return (
    <section className="section trades">
      <h2><Icon name="handshake" />{t("Обмен городами")}{active.length > 0 && <span className="count-chip hot">{active.length}</span>}<Help>{t("Посол выставляет свой город другой команде, её посол предлагает взамен свой. Если город подходит — нажмите «Обменять», и города перейдут друг другу; если нет — отклоните и ждите другое предложение. Если переговоры зашли в тупик, любая сторона отменяет сделку. Столицу обменять нельзя. У каждого города показано, сколько слов в его книге.")}</Help></h2>
      {active.map((x) => {
        const other = x.mine ? x.to : x.from;
        return (
          <div key={x.id} className="passage-card trade-card">
            <div className="row between"><strong>{x.mine ? t("Наше предложение команде «{team}»", { team: other.name }) : t("Предложение команды «{team}»", { team: other.name })}</strong>{statusChip(x)}</div>
            <div className="trade-sides">
              <div><span className="label">{x.mine ? t("Отдаём") : t("Они отдают")}</span><CityLine c={x.offer} /></div>
              <div><span className="label">{x.mine ? t("Взамен предлагают") : t("Мы предлагаем")}</span>{x.counter ? <CityLine c={x.counter} /> : <span className="muted small">{x.mine ? t("ещё ничего") : t("пока ничего")}</span>}</div>
            </div>
            {x.message && <p className="muted small">«{x.message}»</p>}
            {x.declined.length > 0 && <p className="hint">{t("Уже отклонено: {list}", { list: x.declined.map((c) => c.bookName).join(", ") })}</p>}
            {x.mine && x.status === "COUNTERED" && (
              <div className="actions">
                <button type="button" disabled={busy === x.id} onClick={() => void accept(x)}><Icon name="handshake" />{t("Обменять")}</button>
                <button type="button" className="secondary" disabled={busy === x.id} onClick={() => void call(x.id, `/api/games/${gameId}/trades/${x.id}/decline`, {}, t("Отклонено: ждём другой город"))}>{t("Не подходит")}</button>
                <button type="button" className="ghost" disabled={busy === x.id} onClick={() => void cancel(x)}>{t("Отменить сделку")}</button>
              </div>
            )}
            {x.mine && x.status === "OPEN" && <div className="actions"><span className="hint">{t("Ждём, какой город предложат взамен.")}</span><button type="button" className="ghost" disabled={busy === x.id} onClick={() => void cancel(x)}>{t("Отменить сделку")}</button></div>}
            {!x.mine && x.status === "OPEN" && (
              <>
                <div className="field">
                  <label htmlFor={"trade-counter-" + x.id}>{t("Какой город предложить взамен")}</label>
                  <select id={"trade-counter-" + x.id} value={counter[x.id] ?? ""} onChange={(e) => setCounter({ ...counter, [x.id]: e.target.value })}>
                    <option value="">{t("Выберите город…")}</option>
                    {tradable.filter((c) => !x.declined.some((d) => d.nodeKey === c.nodeKey)).map((c) => <option key={c.nodeKey} value={c.nodeKey}>{c.bookName} · {words(c.words)}</option>)}
                  </select>
                </div>
                <div className="actions">
                  <button type="button" disabled={busy === x.id || !counter[x.id]} onClick={() => void call(x.id, `/api/games/${gameId}/trades/${x.id}/counter`, { nodeKey: counter[x.id] }, t("Встречный город предложен"))}><Icon name="send" />{t("Предложить взамен")}</button>
                  <button type="button" className="ghost" disabled={busy === x.id} onClick={() => void cancel(x)}>{t("Отказаться от сделки")}</button>
                </div>
              </>
            )}
            {!x.mine && x.status === "COUNTERED" && <div className="actions"><span className="hint">{t("Ждём решения посла команды «{team}».", { team: other.name })}</span><button type="button" className="ghost" disabled={busy === x.id} onClick={() => void cancel(x)}>{t("Отменить сделку")}</button></div>}
          </div>
        );
      })}
      <div className="trade-new">
        <h3>{t("Предложить обмен")}</h3>
        {data.teams.length === 0 ? <p className="hint">{t("Других команд в игре нет.")}</p> : tradable.length === 0 ? <p className="hint">{t("Пока нечего предложить: нужен взятый город, кроме столицы.")}</p> : (
          <>
            <div className="grid cols-2">
              <div>
                <label htmlFor="trade-team">{t("Команда")}</label>
                <select id="trade-team" value={toTeamId} onChange={(e) => setToTeamId(e.target.value)}><option value="">{t("Выберите команду…")}</option>{data.teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}</select>
              </div>
              <div>
                <label htmlFor="trade-city">{t("Наш город")}</label>
                <select id="trade-city" value={offerKey} onChange={(e) => setOfferKey(e.target.value)}><option value="">{t("Выберите город…")}</option>{tradable.map((c) => <option key={c.nodeKey} value={c.nodeKey}>{c.bookName} · {words(c.words)}</option>)}</select>
              </div>
            </div>
            <div className="field"><label htmlFor="trade-msg">{t("Сообщение послу")} <span className="opt">{t("необязательно")}</span></label><input id="trade-msg" className="full" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} /></div>
            <div className="actions"><button type="button" disabled={busy === "new"} onClick={() => void propose()}><Icon name="handshake" />{t("Предложить обмен")}</button></div>
          </>
        )}
      </div>
      {closed.length > 0 && (
        <ul className="list">
          {closed.map((x) => (
            <li key={x.id}>
              <div className="main"><span className="title">{x.offer.bookName}{x.counter ? ` ⇄ ${x.counter.bookName}` : ""}</span><span className="meta">{x.mine ? t("команде «{team}»", { team: x.to.name }) : t("от команды «{team}»", { team: x.from.name })} · {fmtDate(x.closedAt ?? x.updatedAt)}</span></div>
              {statusChip(x)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
