import { useCallback, useEffect, useState } from "react";
import { Picker } from "../components/Picker";
import { api, ApiError, type TradeDto, type TradesDto, type TradeWallDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate, plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { AutoGrow } from "../components/AutoGrow";
import { Chip } from "../components/Chip";
import { Help } from "../components/Help";
import { Sheet } from "../components/Sheet";
import { useGameEvents } from "../lib/useGameEvents";

/**
 * Обмен городами (решение владельца 04.10): только для послов. Посол выставляет свой город другой команде (у города
 * показано число слов в его книге), посол другой команды предлагает взамен свой; первый меняется или отклоняет
 * встречный город и ждёт другого; если переговоры зашли в тупик, любая сторона отменяет сделку. Раздел в меню
 * «Команды» рядом с проходами, виден только послу.
 * Стена (решение владельца 09.11): выставляя город и предлагая встречный, посол ставит галку «Стена переходит вместе
 * с городом». С галкой вторая команда видит толщину стены и получает её с городом; без галки для неё это город без стены,
 * а стена при обмене сгорает навсегда (выученные стихи остаются в статистике и наградах).
 */
const words = (n: number) => plural(n, [t("слово"), t("слова"), t("слов")]);
const blocksOf = (n: number) => plural(n, [t("блок"), t("блока"), t("блоков")]);
const versesOf = (n: number) => plural(n, [t("стих"), t("стиха"), t("стихов")]);
const CityLine = ({ c }: { c: { bookName: string; words: number } }) => <span className="trade-city"><Icon name="city" /><b>{c.bookName}</b> · {words(c.words)}</span>;
/** Стена города в сделке: переходящую видят обе стороны, не переходящую — только её хозяин, с пометкой «сгорит». */
const WallLine = ({ w }: { w: TradeWallDto }) => w.pass
  ? <span className="trade-wall"><Icon name="wall" />{t("стена переходит с городом: {b}, {v}", { b: blocksOf(w.blocks), v: versesOf(w.verses) })}</span>
  : <span className="trade-wall burn"><Icon name="wall" />{t("стена ({b}) сгорит при обмене", { b: blocksOf(w.blocks) })}</span>;
/** Галка «Стена переходит вместе с городом» — только если у города есть стена (принятая или на проверке). */
function WallCheck({ id, wall, checked, onChange }: { id: string; wall: { blocks: number; verses: number; pending: number } | undefined; checked: boolean; onChange: (v: boolean) => void }) {
  if (!wall || (wall.blocks === 0 && wall.pending === 0)) return null;
  return (
    <div className="trade-wall-check">
      <div className="with-help"><label className="check" htmlFor={id}><input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{t("Стена переходит вместе с городом")} <span className="muted small">({blocksOf(wall.blocks)}, {versesOf(wall.verses)})</span></span></label><Help>{t("С галкой другая команда увидит толщину стены и получит её вместе с городом. Без галки стена при обмене сгорит навсегда, а другая команда её не увидит — для неё это город без стены; выученные стихи останутся в статистике и наградах.")}</Help></div>
    </div>
  );
}

export function TradesSection({ gameId, onChanged }: { gameId: string; onChanged?: () => void; /** Открыть форму предложения этой команде (из меню «⋯» строки команды, решение владельца 24.10). */ openFor?: { teamId: string; nonce: number } | null; /** Сообщить странице, может ли посол предлагать обмен. */ onCanTrade?: (v: boolean) => void }) {
  const { notify, confirm } = useUi();
  const [data, setData] = useState<TradesDto | null>(null);
  const [counter, setCounter] = useState<Record<string, string>>({});
  const [counterWall, setCounterWall] = useState<Record<string, boolean>>({});
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

  async function accept(x: TradeDto) {
    if (!x.counter) return;
    const walls = [
      x.offerWall ? (x.offerWall.pass ? t("Стена города {a} уйдёт вместе с ним.", { a: x.offer.bookName }) : t("Стена города {a} сгорит.", { a: x.offer.bookName })) : "",
      x.counterWall?.pass ? t("Стена города {b} перейдёт вам.", { b: x.counter.bookName }) : "",
    ].filter(Boolean).join(" ");
    if (!(await confirm(t("Город {a} уйдёт команде «{team}», город {b} станет вашим.", { a: x.offer.bookName, team: x.to.name, b: x.counter.bookName }) + (walls ? " " + walls : "") + " " + t("Обменяться?"), { title: t("Обмен городами"), okLabel: t("Обменять") }))) return;
    await call(x.id, `/api/games/${gameId}/trades/${x.id}/accept`, {}, t("Города обменяны"));
  }
  async function cancel(x: TradeDto) {
    if (!(await confirm(t("Сделка с командой «{team}» будет отменена.", { team: x.mine ? x.to.name : x.from.name }), { title: t("Отменить сделку?"), okLabel: t("Отменить сделку"), danger: true }))) return;
    await call(x.id, `/api/games/${gameId}/trades/${x.id}/cancel`, {}, t("Сделка отменена"));
  }

  const nothing = active.length === 0 && closed.length === 0;
  return (
    <section className={"section trades" + (nothing ? " empty" : "")}>
      {!nothing && <h2><Icon name="handshake" />{t("Обмен городами")}{active.length > 0 && <span className="count-chip hot">{active.length}</span>}<Help>{t("Посол выставляет свой город другой команде, её посол предлагает взамен свой. Если город подходит — нажмите «Обменять», и города перейдут друг другу; если нет — отклоните и ждите другое предложение. Если переговоры зашли в тупик, любая сторона отменяет сделку. Столицу обменять нельзя. У каждого города показано, сколько слов в его книге.")}</Help></h2>}
      {active.map((x) => {
        const other = x.mine ? x.to : x.from;
        return (
          <div key={x.id} className="passage-card trade-card">
            <div className="row between"><strong>{x.mine ? t("Наше предложение команде «{team}»", { team: other.name }) : t("Предложение команды «{team}»", { team: other.name })}</strong>{statusChip(x)}</div>
            <div className="trade-sides">
              <div><span className="label">{x.mine ? t("Отдаём") : t("Они отдают")}</span><CityLine c={x.offer} />{x.offerWall && <WallLine w={x.offerWall} />}</div>
              <div><span className="label">{x.mine ? t("Взамен предлагают") : t("Мы предлагаем")}</span>{x.counter ? <><CityLine c={x.counter} />{x.counterWall && <WallLine w={x.counterWall} />}</> : <span className="muted small">{x.mine ? t("ещё ничего") : t("пока ничего")}</span>}</div>
            </div>
            {x.message && <p className="muted small">«{x.message}»</p>}
            {x.declined.length > 0 && <p className="hint">{t("Уже отклонено: {list}", { list: x.declined.map((c) => c.bookName).join(", ") })}</p>}
            {x.mine && x.status === "COUNTERED" && (
              <div className="actions">
                <button type="button" disabled={busy === x.id} onClick={() => void accept(x)}><Icon name="handshake" />{t("Обменять")}</button>
                <button type="button" className="secondary" disabled={busy === x.id} onClick={() => void call(x.id, `/api/games/${gameId}/trades/${x.id}/decline`, {}, t("Отклонено: ждём другой город"))}>{t("Не подходит")}</button>
                <button type="button" className="ghost icon trade-cancel" aria-label={t("Отменить сделку")} title={t("Отменить сделку")} disabled={busy === x.id} onClick={() => void cancel(x)}><Icon name="x" /></button>
              </div>
            )}
            {x.mine && x.status === "OPEN" && <div className="actions"><span className="hint">{t("Ждём, какой город предложат взамен.")}</span><button type="button" className="ghost icon trade-cancel" aria-label={t("Отменить сделку")} title={t("Отменить сделку")} disabled={busy === x.id} onClick={() => void cancel(x)}><Icon name="x" /></button></div>}
            {!x.mine && x.status === "OPEN" && (
              <>
                <div className="field">
                  <label htmlFor={"trade-counter-" + x.id}>{t("Какой город предложить взамен")}</label>
                  <Picker id={"trade-counter-" + x.id} value={counter[x.id] ?? ""} onChange={(v) => setCounter({ ...counter, [x.id]: v })} placeholder={t("Выберите город…")}
                    options={tradable.filter((c) => !x.declined.some((d) => d.nodeKey === c.nodeKey)).map((c) => ({ value: c.nodeKey, label: c.bookName, hint: words(c.words) }))} />
                </div>
                <WallCheck id={"trade-counter-wall-" + x.id} wall={tradable.find((c) => c.nodeKey === counter[x.id])?.wall} checked={Boolean(counterWall[x.id])} onChange={(v) => setCounterWall({ ...counterWall, [x.id]: v })} />
                <div className="actions">
                  <button type="button" disabled={busy === x.id || !counter[x.id]} onClick={() => void call(x.id, `/api/games/${gameId}/trades/${x.id}/counter`, { nodeKey: counter[x.id], withWall: Boolean(counterWall[x.id]) }, t("Встречный город предложен"))}><Icon name="send" />{t("Предложить взамен")}</button>
                  <button type="button" className="ghost icon trade-cancel" aria-label={t("Отказаться от сделки")} title={t("Отказаться от сделки")} disabled={busy === x.id} onClick={() => void cancel(x)}><Icon name="x" /></button>
                </div>
              </>
            )}
            {!x.mine && x.status === "COUNTERED" && <div className="actions"><span className="hint">{t("Ждём решения посла команды «{team}».", { team: other.name })}</span><button type="button" className="ghost icon trade-cancel" aria-label={t("Отменить сделку")} title={t("Отменить сделку")} disabled={busy === x.id} onClick={() => void cancel(x)}><Icon name="x" /></button></div>}
          </div>
        );
      })}
      {/* Кнопки «Предложить обмен» здесь нет: обмен предлагают из карточки своего города (решение владельца 04.11; до того — из меню «⋯» напротив команды). */}
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

/**
 * Предложить обмен из карточки своего города (решение владельца 04.11: «обмен городов… перенести в сами города, когда город
 * выбираешь»): город уже выбран, посол выбирает команду и пишет сообщение. Лист открывается поверх карточки города.
 */
export function TradeProposeSheet({ gameId, offerKey, container, onClose, onDone }: { gameId: string; offerKey: string; container?: HTMLElement | null; onClose: () => void; onDone?: () => void }) {
  const { notify } = useUi();
  const [data, setData] = useState<TradesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toTeamId, setToTeamId] = useState("");
  const [message, setMessage] = useState("");
  const [withWall, setWithWall] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<TradesDto>(`/api/games/${gameId}/my-trades`).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))); }, [gameId]);
  const city = data?.myCities.find((c) => c.nodeKey === offerKey) ?? null;
  const open = data?.trades.find((x) => x.mine && x.offer.nodeKey === offerKey && (x.status === "OPEN" || x.status === "COUNTERED")) ?? null;
  async function propose() {
    if (!toTeamId) { notify(t("Выберите команду"), "bad"); return; }
    setBusy(true);
    try { await api(`/api/games/${gameId}/trades`, { method: "POST", body: JSON.stringify({ toTeamId, offerKey, message, withWall }) }); notify(t("Предложение отправлено")); onDone?.(); onClose(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  const can = Boolean(data?.canTrade && city && !city.reason && !open && data.teams.length > 0);
  return (
    <Sheet size="sm" title={t("Обменять город")} container={container} onClose={onClose} className="trade-form"
      foot={<><button type="button" className="secondary icon" aria-label={t("Отмена")} title={t("Отмена")} onClick={onClose}><Icon name="x" /></button><button type="button" disabled={busy || !can || !toTeamId} onClick={() => void propose()}><Icon name="handshake" />{t("Предложить обмен")}</button></>}>
      {error ? <p className="error" role="alert">{error}</p> : !data ? <p className="muted small">{t("Загружаем…")}</p> : !data.canTrade ? <p className="hint">{t("Обмен городами ведёт посол команды.")}</p> : !city ? <p className="hint">{t("Этот город обменять нельзя: он не ваш.")}</p> : city.reason ? <p className="hint">{city.reason}</p> : open ? <p className="hint">{t("Этот город уже выставлен на обмен команде «{team}»: сделка в «Командах».", { team: open.to.name })}</p> : data.teams.length === 0 ? <p className="hint">{t("Других команд в игре нет.")}</p> : (
        <>
          <p className="trade-offer"><Icon name="city" /><b>{city.bookName}</b> · {words(city.words)}</p>
          <label htmlFor="trade-team">{t("Команда")}</label>
          <Picker id="trade-team" value={toTeamId} onChange={setToTeamId} placeholder={t("Выберите команду…")} options={data.teams.map((tm) => ({ value: tm.id, label: tm.name }))} />
          <div className="field mt-2"><label htmlFor="trade-msg">{t("Сообщение послу")} <span className="opt">{t("необязательно")}</span></label><AutoGrow id="trade-msg" className="full" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} /></div>
          <WallCheck id="trade-wall" wall={city.wall} checked={withWall} onChange={setWithWall} />
          <p className="hint">{t("Посол другой команды увидит город и число слов в его книге и предложит свой город взамен.")}</p>
        </>
      )}
    </Sheet>
  );
}
