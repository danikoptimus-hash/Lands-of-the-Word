import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, type CityTaskDto, type MyCityDto, type TaskLockDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { IMG } from "./MapLayers";
import { SortableList } from "./SortableList";
import { WarSection } from "./BattlePanel";
import { PassageSection } from "./Diplomacy";
import { t } from "../lib/i18n";
import { fmtLeft } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { LoadingState } from "../components/State";
import { kindLabel } from "./RecipientsBlock";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

/**
 * Попап города у команды: шапка (иллюстрация, книга, статус, «Столица»), индикатор шагов
 * 1 Порядок · 2 Районы · 3 Конверт, тело текущего шага, ниже свёрнутые секции «Проход» и «Испытание».
 */
export function CityPopup({ gameId, nodeKey, teamId, isCaptain, version, container, onClose, onChanged }: { gameId: string; nodeKey: string; teamId: string; isCaptain: boolean; version: number; container?: HTMLElement | null; onClose: () => void; onChanged: () => void }) {
  const { notify, confirm } = useUi();

  const confirmMove = () => confirm(t("Это единственный перенос за игру."), { title: t("Перенести столицу в этот город?"), okLabel: t("Перенести") });
  const [city, setCity] = useState<MyCityDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [orderResult, setOrderResult] = useState<number | null>(null);
  const [taskIndex, setTaskIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => api<MyCityDto>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}`).then((c) => { setCity(c); setError(null); }).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))), [gameId, nodeKey]);
  useEffect(() => { void load(); }, [load, version]);
  useEffect(() => { const tm = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tm); }, []);
  useEffect(() => { if (city?.content && !city.state.orderSolved && !order) setOrder(city.content.districts.map((d) => d.id)); }, [city, order]);

  const book = city ? BOOK_BY_CODE.get(city.node.bookCode) : undefined;
  const districts = city?.content?.districts ?? [];
  const byId = useMemo(() => new Map(districts.map((d) => [d.id, d])), [districts]);
  const done = city?.state.doneTasks ?? [];
  const total = city?.content?.tasks.length ?? 0;
  const allDone = total > 0 && done.length >= total;
  const cooldown = city?.state.cooldownUntil && city.state.cooldownUntil > now ? Math.ceil((city.state.cooldownUntil - now) / 1000) : 0;

  async function checkOrder() {
    if (!order) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ correct: boolean; wrong: number }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/order`, { method: "POST", body: JSON.stringify({ ids: order }) });
      setOrderResult(r.wrong);
      if (r.correct) { notify(t("Порядок верный: районы открыты")); setOrder(null); }
      await load(); onChanged();
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function answer(index: number, value: unknown): Promise<boolean> {
    setBusy(true); setError(null);
    try {
      const r = await api<{ correct: boolean; fragment?: string; lockedUntil?: number | null; attemptsLeft?: number | null }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/tasks/${index}/answer`, { method: "POST", body: JSON.stringify({ answer: value }) });
      if (r.correct) notify(t("Верно. Знак шифра: {f}", { f: r.fragment ?? "" }));
      else if (r.lockedUntil) notify(t("Неверно. Две попытки истрачены: задание закрыто на сутки"), "bad");
      else if (r.attemptsLeft != null) notify(t("Неверно. Осталась попытка: {n}", { n: r.attemptsLeft }), "bad");
      else notify(t("Неверно. Перечитайте это место в книге"), "bad");
      await load(); onChanged();
      return r.correct;
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); if (e instanceof ApiError && e.status === 423) void load(); return false; }
    finally { setBusy(false); }
  }
  async function dispute(index: number, message: string): Promise<boolean> {
    setBusy(true); setError(null);
    try {
      await api(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/tasks/${index}/dispute`, { method: "POST", body: JSON.stringify({ message }) });
      notify(t("Сообщение отправлено администратору"));
      await load(); return true;
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); return false; }
    finally { setBusy(false); }
  }
  async function makeCapital() {
    if (!(await confirmMove())) return;
    setBusy(true); setError(null);
    try { await api(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/make-capital`, { method: "POST" }); notify(t("Столица перенесена")); await load(); onChanged(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function hint(index: number) {
    setBusy(true); setError(null);
    try { await api(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/hint`, { method: "POST", body: JSON.stringify({ index }) }); notify(t("Подсказка открыта: текст района ниже"), "info"); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function capture() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ ok: boolean; isCapital: boolean }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/capture`, { method: "POST", body: JSON.stringify({ key }) });
      notify(r.isCapital ? t("Город ваш. Это ваша столица") : t("Город ваш"));
      setKey("");
      await load(); onChanged();
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }

  const task = taskIndex != null ? city?.content?.tasks.find((x) => x.index === taskIndex) ?? null : null;
  const foreign = Boolean(city?.owner && !city.state.capturedAt);
  const step = !city?.content ? 0 : !city.state.orderSolved ? 1 : !allDone ? 2 : 3;
  const statusLine = !city ? "" : city.state.capturedAt ? t("Ваш город") : city.owner ? t("Город команды «{team}»", { team: city.owner.name }) : city.node.ruined ? t("Город в руинах") : t("Свободный город");

  const head = (
    <div className="city-head" style={{ ["--city-img" as string]: `url(${IMG.city(city?.node.cityType)})` }}>
      <img src={IMG.city(city?.node.cityType)} alt="" />
      <div className="title">
        <h2 id="city-title">{book?.nameRu ?? t("Город")}</h2>
        <div className="status">{statusLine}{city?.state.isCapital && <Chip tone="solid" icon="crown">{t("Столица")}</Chip>}</div>
      </div>
    </div>
  );

  return (
    <Sheet size="md" container={container} onClose={onClose} head={head} className="city-sheet">
      {error && <p className="error" role="alert">{error}</p>}
      {!city && !error && <LoadingState rows={4} />}
      {city && !city.content && <div className="note warn"><Icon name="alert" /><span>{t("Задания для книги «{book}» ещё готовятся. Город пока нельзя взять.", { book: book?.nameRu ?? "" })}</span></div>}

      {city?.content && !task && (
        <ol className="steps" aria-label={t("Шаги")}>
          {[t("Порядок"), t("Районы"), t("Конверт")].map((label, i) => {
            const n = i + 1;
            const cls = n < step ? "done" : n === step ? "current" : "";
            return <li key={n} className={cls} aria-current={n === step ? "step" : undefined}><span className="num">{n < step ? <Icon name="check" /> : n}</span><span>{label}</span></li>;
          })}
        </ol>
      )}

      {city?.content && step === 1 && order && (
        <section className="step-body">
          <h3>{t("Расставьте районы по порядку книги")}</h3>
          <p className="hint">{t("Тяните за ручку или пользуйтесь стрелками.")}</p>
          {orderResult != null && orderResult > 0 && <div className="note bad"><Icon name="alert" /><span>{t("Не на месте: {n} · попытка {k}", { n: orderResult, k: city.state.orderAttempts })}</span></div>}
          <SortableList ids={order} onChange={setOrder} render={(id) => { const d = byId.get(id)!; return <><div className="d-title">{d.title}</div><div className="d-sum muted">{d.summary}</div></>; }} />
          <div className="actions"><button type="button" disabled={busy} onClick={() => void checkOrder()}><Icon name="check" />{t("Проверить порядок")}</button></div>
        </section>
      )}

      {city?.content && step >= 2 && !task && (
        <section className="step-body">
          {step === 2 && <h3>{t("Решите задание в каждом районе")}</h3>}
          {step === 2 && (
            <ul className="districts">
              {districts.map((d) => {
                const i = d.index ?? 0;
                const ok = done.includes(i);
                const locked = isLocked(city.state.locks, i, now);
                return (
                  <li key={d.id}>
                    <button type="button" className={"district" + (ok ? " done" : "") + (locked ? " locked" : "")} onClick={() => setTaskIndex(i)} aria-label={`${i + 1}. ${d.title} · ${ok ? t("выполнено") : locked ? t("закрыто") : t("не выполнено")}`}>
                      <span className="num">{i + 1}</span>
                      <span className="body"><span className="d-title">{d.title} <span className="muted">{d.verses}</span></span><span className="d-sum muted">{d.summary}</span></span>
                      <span className={"check" + (ok ? " on" : "")}><Icon name={ok ? "check" : locked ? "lock" : "chevron"} /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {step === 2 && city.content.tasks.some((x) => x.index >= districts.length) && (
            <>
              <h3 className="mt-4">{t("Задания по всей книге")}</h3>
              <ul className="districts">
                {city.content.tasks.filter((x) => x.index >= districts.length).map((x) => {
                  const ok = done.includes(x.index);
                  const locked = isLocked(city.state.locks, x.index, now);
                  return (
                    <li key={"x" + x.index}>
                      <button type="button" className={"district extra" + (ok ? " done" : "") + (locked ? " locked" : "")} onClick={() => setTaskIndex(x.index)}>
                        <span className="num">{x.index + 1}</span>
                        <span className="body"><span className="d-title">{x.scope === "book" ? t("По всей книге") : t("По нескольким районам")}</span><span className="d-sum muted">{x.prompt.length > 90 ? x.prompt.slice(0, 90) + "…" : x.prompt}</span></span>
                        <span className={"check" + (ok ? " on" : "")}><Icon name={ok ? "check" : locked ? "lock" : "chevron"} /></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {step === 3 && !city.state.capturedAt && <h3>{t("Получите конверт с ключом")}</h3>}
          <div className="cipher">
            <div className="row between"><span className="strong">{t("Шифр города")}</span>{!allDone && <span className="hint">{t("Соберётся, когда решите все районы")}</span>}</div>
            <div className="letters">{city.content.fragments.map((f, i) => <span key={i} className={f ? "on" : ""}>{f ?? ""}</span>)}</div>
            {allDone && <p className="hint">{city.content.codeRule}</p>}
          </div>

          {allDone && !city.state.capturedAt && city.node.ruined && !city.owner && (
            <div className="capture">
              <div className="note warn"><Icon name="info" /><span>{t("Город в руинах: его можно занять без конверта.")}</span></div>
              <div className="actions"><button type="button" disabled={busy} onClick={() => void capture()}><Icon name="city" />{t("Занять руины")}</button></div>
            </div>
          )}
          {allDone && !city.state.capturedAt && !city.node.ruined && (
            <div className="capture">
              <p className="mt-3"><Icon name="mail" /> {city.recipient ? t("Назовите шифр адресату «{label}» ({kind}) и получите конверт с ключом.", { label: city.recipient.label, kind: kindLabel(city.recipient.kind) }) : t("Назовите шифр адресату, к которому вас направили, и получите конверт с ключом.")}</p>
              <div className="field">
                <label htmlFor="city-key">{t("Ключ из конверта")}</label>
                <div className="row nowrap">
                  <input id="city-key" className="key-input" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} maxLength={12} autoCapitalize="characters" autoComplete="off" />
                  <button type="button" disabled={busy || key.trim().length < 4 || cooldown > 0} onClick={() => void capture()}><Icon name="city" />{t("Взять город")}</button>
                </div>
                <p className="hint">{cooldown > 0 ? t("Подождите {n} с", { n: cooldown }) : t("Ключ напечатан в конверте: не меньше 4 знаков")}</p>
              </div>
            </div>
          )}
          {city.state.capturedAt && <div className="note ok"><Icon name="check" /><span>{city.state.isCapital ? (city.state.secondCapital ? t("Город ваш — это ваша вторая столица.") : t("Город ваш — это ваша столица.")) : t("Город ваш.")}</span></div>}
          {city.state.capturedAt && !city.state.isCapital && isCaptain && (
            <div className="row mt-2">
              <button type="button" className="secondary" disabled={busy || Boolean(city.team.capitalMovedAt)} onClick={() => void makeCapital()}><Icon name="crown" />{t("Перенести столицу сюда")}</button>
              <span className="hint">{city.team.capitalMovedAt ? t("перенос уже использован") : t("один раз за игру, можно и во время испытания")}</span>
            </div>
          )}
        </section>
      )}

      {/* Проход и испытание — свёрнутые секции; в чужом городе «Проход» первой. Запросить проход можно ещё до решения районов. */}
      {city?.content && !task && foreign && (
        <details className="disclose">
          <summary><Icon name="handshake" />{t("Проход")}<Icon name="chevron-down" className="chev" /></summary>
          <PassageSection gameId={gameId} nodeKey={nodeKey} version={version} onChanged={onChanged} />
        </details>
      )}
      {city?.content && !task && (city.owner || city.state.capturedAt) && (
        <details className="disclose">
          <summary><Icon name="wave" />{t("Испытание")}<Icon name="chevron-down" className="chev" /></summary>
          <WarSection gameId={gameId} nodeKey={nodeKey} teamId={teamId} isCaptain={isCaptain} version={version} onChanged={onChanged} />
        </details>
      )}
      {city?.content && task && (
        <TaskView task={task} district={districts.find((d) => d.index === task.index)} groupTitles={task.groupDistricts?.map((n) => districts.find((d) => d.index === n - 1)?.title ?? String(n)) ?? null} done={done.includes(task.index)} fragment={city.content.fragments[task.index] ?? null} busy={busy} cooldown={cooldown} onBack={() => setTaskIndex(null)} onAnswer={(v) => answer(task.index, v)}
          hintOpen={city.state.hintTasks.includes(task.index)} canHint={city.team.gameRole === "PROPHET"} onHint={() => hint(task.index)} gameId={gameId} nodeKey={nodeKey}
          lock={city.state.locks.find((l) => l.index === task.index) ?? null} choiceAttempts={city.state.choiceAttempts} now={now} onDispute={(m) => dispute(task.index, m)} heartbeatMs={city.state.heartbeatMs} notify={notify} />
      )}
    </Sheet>
  );
}

const isLocked = (locks: TaskLockDto[], index: number, now: number) => locks.some((l) => l.index === index && l.lockedUntil != null && l.lockedUntil > now);

/** Время чтения: пока задание открыто и вкладка видна, раз в heartbeatMs шлём серверу «читаю»; между сигналами счётчик идёт локально. */
function useReading(gameId: string, nodeKey: string, index: number, done: boolean, initialMs: number, heartbeatMs: number) {
  const [readMs, setReadMs] = useState(initialMs);
  const base = useRef({ ms: initialMs, at: Date.now() });
  useEffect(() => { base.current = { ms: initialMs, at: Date.now() }; setReadMs(initialMs); }, [initialMs, index]);
  useEffect(() => {
    if (done) return;
    let stopped = false;
    const beat = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const r = await api<{ readMs: number }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/tasks/${index}/reading`, { method: "POST" });
        base.current = { ms: r.readMs, at: Date.now() }; setReadMs(r.readMs);
      } catch { /* сеть: счётчик догонит на следующем сигнале */ }
    };
    void beat();
    const hb = setInterval(() => void beat(), heartbeatMs);
    const tick = setInterval(() => { if (document.visibilityState === "visible") setReadMs(base.current.ms + (Date.now() - base.current.at)); }, 1000);
    // Скрыли вкладку: фиксируем набранное и останавливаем локальный счёт; вернулись: счёт идёт с этого момента.
    const onVis = () => {
      if (document.visibilityState === "visible") { base.current = { ms: base.current.ms, at: Date.now() }; void beat(); }
      else base.current = { ms: base.current.ms + (Date.now() - base.current.at), at: Date.now() };
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { stopped = true; clearInterval(hb); clearInterval(tick); document.removeEventListener("visibilitychange", onVis); };
  }, [gameId, nodeKey, index, done, heartbeatMs]); // eslint-disable-line react-hooks/exhaustive-deps
  return readMs;
}

const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

function TaskView({ task, district, groupTitles, done, fragment, busy, cooldown, onBack, onAnswer, hintOpen, canHint, onHint, gameId, nodeKey, lock, choiceAttempts, now, onDispute, heartbeatMs, notify }: { task: CityTaskDto; district?: { title: string; verses: string }; groupTitles: string[] | null; done: boolean; fragment: string | null; busy: boolean; cooldown: number; onBack: () => void; onAnswer: (v: unknown) => Promise<boolean>; hintOpen: boolean; canHint: boolean; onHint: () => void; gameId: string; nodeKey: string; lock: TaskLockDto | null; choiceAttempts: number; now: number; onDispute: (message: string) => Promise<boolean>; heartbeatMs: number; notify: (text: string, tone?: "bad") => void }) {
  const locked = lock?.lockedUntil != null && lock.lockedUntil > now;
  const readMs = useReading(gameId, nodeKey, task.index, done, lock?.readMs ?? 0, heartbeatMs || 10_000);
  const reading = !done && readMs < task.readingMs;
  /** Вставка из буфера отключена (решение владельца): ответ набирается вручную. */
  const noPaste = (e: React.ClipboardEvent | React.DragEvent) => { e.preventDefault(); notify(t("Вставка отключена: наберите ответ вручную"), "bad"); };
  const disputeOpen = Boolean(lock?.disputedAt && !lock.resolvedAt);
  const [disputeText, setDisputeText] = useState("");
  const [disputeForm, setDisputeForm] = useState(false);
  const [hintText, setHintText] = useState<string[] | null>(null);
  useEffect(() => { if (hintOpen) api<{ text: string[] }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/hint/${task.index}`).then((r) => setHintText(r.text)).catch(() => setHintText(null)); else setHintText(null); }, [hintOpen, gameId, nodeKey, task.index]);
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<number | null>(null);
  const [order, setOrder] = useState<string[]>(task.type === "order" ? task.items.map((i) => i.id) : []);
  const itemText = useMemo(() => (task.type === "order" ? new Map(task.items.map((i) => [i.id, i.text])) : new Map<string, string>()), [task]);
  const value = task.type === "choice" ? choice : task.type === "order" ? order : text.trim();
  const filled = task.type === "choice" ? choice != null : task.type === "order" ? order.length > 0 : text.trim().length > 0;
  const canSend = !done && !busy && cooldown === 0 && !locked && !reading && filled;
  const scope = task.scope === "book" ? t("По всей книге") : task.scope === "group" ? t("По районам: {list}", { list: groupTitles?.join(", ") ?? "" }) : t("По этому району");
  const title = task.scope === "district" && district ? [t("Район {n}", { n: task.index + 1 }), district.title, district.verses].filter(Boolean).join(" · ") : t("Задание {n}", { n: task.index + 1 });
  const attemptsTotal = Math.max(1, choiceAttempts), attemptsLeft = lock ? lock.attemptsLeft : attemptsTotal;
  const attemptNo = Math.min(attemptsTotal, attemptsTotal - attemptsLeft + 1);
  const why = locked ? t("Задание закрыто") : reading ? t("Дочитайте: ещё {a}", { a: mmss(task.readingMs - readMs) }) : cooldown > 0 ? t("Подождите {n} с", { n: cooldown }) : null;
  return (
    <div className="task-view" onContextMenu={(e) => e.preventDefault()}>
      <button type="button" className="ghost back-btn" onClick={onBack}><Icon name="back" />{t("К районам")}</button>
      <h3 className="mt-2">{title}</h3>
      <p className="muted small">{scope}</p>
      <p className="prompt no-copy" onCopy={(e) => e.preventDefault()}>{task.prompt}</p>
      {!done && (
        <div className={"reading" + (reading ? "" : " ok")} style={{ ["--p" as string]: Math.min(1, readMs / task.readingMs) }}>
          <Icon name="book" />
          <span>{reading ? t("Чтение {a} / {b} · счёт идёт, пока задание открыто", { a: mmss(readMs), b: mmss(task.readingMs) }) : t("Время чтения набрано")}</span>
          <i />
        </div>
      )}
      {task.type === "choice" && !done && !locked && (
        attemptsLeft <= 1
          ? <div className="note warn"><Icon name="alert" /><span>{t("Попытка {a} из {b}: после неверного ответа задание закроется на сутки.", { a: attemptNo, b: attemptsTotal })}</span></div>
          : <p className="muted small">{t("Попытка {a} из {b}", { a: attemptNo, b: attemptsTotal })}</p>
      )}
      {locked && lock && (
        <div className="note bad lock-note">
          <div className="row nowrap"><Icon name="clock" /><span>{t("Задание закрыто после двух неверных ответов. Откроется через {t}.", { t: fmtLeft(lock.lockedUntil! - now) })}</span></div>
          {disputeOpen && <div>{t("Вы написали администратору: «{m}». Ждём ответа.", { m: lock.dispute ?? "" })}</div>}
          {!disputeOpen && lock.resolvedAt && <div>{t("Администратор ответил: {a}", { a: lock.resolution || t("задание оставлено закрытым") })}</div>}
          {!disputeOpen && !lock.resolvedAt && !disputeForm && <div><button type="button" className="secondary" onClick={() => setDisputeForm(true)}><Icon name="send" />{t("Написать администратору")}</button></div>}
          {!disputeOpen && !lock.resolvedAt && disputeForm && (
            <div className="dispute-form">
              <label htmlFor="dispute-text">{t("Почему ответ нужно засчитать или задание открыть")}</label>
              <textarea id="dispute-text" value={disputeText} onChange={(e) => setDisputeText(e.target.value)} maxLength={500} rows={3} />
              <div className="actions">
                <button type="button" disabled={busy || disputeText.trim().length < 5} onClick={() => void onDispute(disputeText.trim()).then((ok) => { if (ok) { setDisputeForm(false); setDisputeText(""); } })}><Icon name="send" />{t("Отправить")}</button>
                <button type="button" className="secondary" onClick={() => setDisputeForm(false)}>{t("Отмена")}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {!locked && lock?.resolvedAt && lock.resolution && !done && <div className="note ok"><Icon name="info" /><span>{t("Администратор ответил: {a}", { a: lock.resolution })}</span></div>}
      {hintOpen && hintText && <div className="hint-box no-copy"><div className="muted small">{t("Подсказка пророка · текст района {verses}", { verses: district?.verses ?? "" })}</div>{hintText.map((x, i) => <p key={i}>{x}</p>)}</div>}
      {!hintOpen && !done && canHint && <p className="mt-2"><button type="button" className="secondary" disabled={busy} onClick={onHint}><Icon name="sparkle" />{t("Подсказка пророка · раз в неделю")}</button></p>}
      {done ? (
        <div className="note ok"><Icon name="check" /><span>{t("Выполнено. Знак шифра: {f}", { f: fragment ?? "" })}</span></div>
      ) : (
        <div className="answer">
          {task.type === "number" && <div className="field"><label htmlFor="answer-num">{t("Число")}</label><input id="answer-num" type="number" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} onPaste={noPaste} onDrop={noPaste} autoComplete="off" /></div>}
          {task.type === "text" && <div className="field"><label htmlFor="answer-text">{t("Ответ")}</label><input id="answer-text" className="full" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false} onPaste={noPaste} onDrop={noPaste} /></div>}
          {task.type === "choice" && (
            <ul className="choices" role="radiogroup" aria-label={t("Варианты ответа")}>
              {task.options.map((o, i) => <li key={i}><button type="button" role="radio" aria-checked={choice === i} className={choice === i ? "on" : ""} onClick={() => setChoice(i)}><span className="radio" />{o}</button></li>)}
            </ul>
          )}
          {task.type === "order" && <SortableList ids={order} onChange={setOrder} render={(id) => <div className="d-title">{itemText.get(id)}</div>} />}
          {why && <p className="hint" aria-live="polite">{why}</p>}
          <div className="actions">
            <button type="button" disabled={!canSend} onClick={() => void onAnswer(value)}><Icon name="send" />{t("Ответить")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
