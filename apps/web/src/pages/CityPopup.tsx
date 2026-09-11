import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, type CityTaskDto, type MyCityDto, type TaskLockDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { IMG } from "./MapLayers";
import { SortableList } from "./SortableList";
import { WarSection } from "./BattlePanel";
import { PassageSection } from "./Diplomacy";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { kindLabel } from "./RecipientsBlock";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

/**
 * Попап города у команды. Шаг 1: районы (сцены книги) серые, их надо расставить по порядку —
 * после верного порядка они окрашиваются и застывают. Шаг 2: в каждом районе одно задание,
 * решённое помечается зелёной галочкой справа и даёт букву шифра. Шаг 3: ключ из конверта — город взят.
 */
export function CityPopup({ gameId, nodeKey, teamId, isCaptain, version, onClose, onChanged }: { gameId: string; nodeKey: string; teamId: string; isCaptain: boolean; version: number; onClose: () => void; onChanged: () => void }) {
  const { notify, confirm } = useUi();

  const confirmMove = () => confirm(t("Перенести столицу в этот город? Это единственный перенос за игру."), { okLabel: t("Перенести") });
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
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
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
      if (r.correct) { notify(t("Порядок верный! Районы открыты")); setOrder(null); }
      await load(); onChanged();
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function answer(index: number, value: unknown): Promise<boolean> {
    setBusy(true); setError(null);
    try {
      const r = await api<{ correct: boolean; fragment?: string; lockedUntil?: number | null; attemptsLeft?: number | null }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/tasks/${index}/answer`, { method: "POST", body: JSON.stringify({ answer: value }) });
      if (r.correct) notify(t("Верно! Знак шифра: {f}", { f: r.fragment ?? "" }));
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
      notify(t("Спор отправлен администратору"));
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
    try { await api(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/hint`, { method: "POST", body: JSON.stringify({ index }) }); notify(t("Подсказка открыта: текст района ниже")); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function capture() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ ok: boolean; isCapital: boolean }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/capture`, { method: "POST", body: JSON.stringify({ key }) });
      notify(r.isCapital ? t("Город ваш! Это ваша столица") : t("Город ваш!"));
      setKey("");
      await load(); onChanged();
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }

  const task = taskIndex != null ? city?.content?.tasks.find((t) => t.index === taskIndex) ?? null : null;

  return (
    <div className="city-backdrop" onClick={onClose}>
      <div className="city-popup" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="city-head" style={{ ["--city-img" as string]: `url(${IMG.city(city?.node.cityType)})` }}>
          <img src={IMG.city(city?.node.cityType)} alt="" />
          <div className="title">
            <strong>{book ? t("Город {name}", { name: book.nameRu }) : t("Город")}</strong>
            <div className="muted">
              {city?.owner ? <span className="badge" style={{ borderColor: city.owner.color, color: city.owner.color }}>{city.owner.name}</span> : city?.node.ruined ? <span className="badge bad">{t("руины")}</span> : <span className="badge">{t("свободный")}</span>}
              {city?.state.isCapital && <span className="badge accent"> {t("столица")}</span>}
              {total > 0 && <span> · {t("заданий")} {done.length}/{total}</span>}
            </div>
          </div>
          <button className="ghost sm close" onClick={onClose} aria-label={t("Закрыть")}><Icon name="x" /></button>
        </div>
        {error && <p className="error">{error}</p>}
        {!city && !error && <p className="muted">{t("Загрузка…")}</p>}
        {city && !city.content && <p className="note warn">{t("Задания для книги «{book}» ещё готовятся. Город пока нельзя взять.", { book: book?.nameRu ?? "" })}</p>}

        {city?.content && !city.state.orderSolved && order && (
          <>
            <p className="muted" style={{ margin: "0 0 .6rem" }}>{t("Расставьте районы в порядке, в котором эти сцены идут в книге. Тяните за ⋮⋮ или пользуйтесь стрелками.")}</p>
            {orderResult != null && orderResult > 0 && <div className="note bad">{t("Не на своём месте: {n}. Попыток: {k}", { n: orderResult, k: city.state.orderAttempts })}</div>}
            <SortableList ids={order} onChange={setOrder} render={(id) => { const d = byId.get(id)!; return <><div className="d-title">{d.title}</div><div className="d-sum muted">{d.summary}</div></>; }} />
            <div className="actions"><button disabled={busy} onClick={() => void checkOrder()}>{t("Проверить порядок")}</button></div>
          </>
        )}

        {city?.content && city.state.orderSolved && !task && (
          <>
            <ul className="districts">
              {districts.map((d) => {
                const i = d.index ?? 0;
                const ok = done.includes(i);
                const locked = isLocked(city.state.locks, i, now);
                return (
                  <li key={d.id} className={"district open" + (ok ? " done" : "")} onClick={() => setTaskIndex(i)}>
                    <span className="num">{i + 1}</span>
                    <div className="body"><div className="d-title">{d.title} <span className="muted">{d.verses}</span></div><div className="d-sum muted">{d.summary}</div></div>
                    <span className={"check" + (ok ? " on" : "")} aria-label={ok ? t("выполнено") : t("не выполнено")}>{ok ? "✓" : locked ? "🔒" : "›"}</span>
                  </li>
                );
              })}
              {city.content.tasks.filter((x) => x.index >= districts.length).map((x) => {
                const ok = done.includes(x.index);
                const locked = isLocked(city.state.locks, x.index, now);
                return (
                  <li key={"x" + x.index} className={"district open extra" + (ok ? " done" : "")} onClick={() => setTaskIndex(x.index)}>
                    <span className="num">{x.index + 1}</span>
                    <div className="body"><div className="d-title">{x.scope === "book" ? t("Задание по всей книге") : t("Задание по нескольким районам")}</div><div className="d-sum muted">{x.prompt.length > 90 ? x.prompt.slice(0, 90) + "…" : x.prompt}</div></div>
                    <span className={"check" + (ok ? " on" : "")} aria-label={ok ? t("выполнено") : t("не выполнено")}>{ok ? "✓" : locked ? "🔒" : "›"}</span>
                  </li>
                );
              })}
            </ul>
            <div className="cipher">
              <div className="muted">{t("Шифр")}</div>
              <div className="letters">{city.content.fragments.map((f, i) => <span key={i} className={f ? "on" : ""}>{f ?? "·"}</span>)}</div>
              {allDone && <p className="muted" style={{ margin: ".3rem 0 0" }}>{city.content.codeRule}</p>}
            </div>
            {allDone && !city.state.capturedAt && city.node.ruined && !city.owner && (
              <div className="capture">
                <p className="note warn">{t("Руины: команда, владевшая городом, выбыла. Задания решены — город можно занять без ключа и без испытания.")}</p>
                <div className="actions"><button disabled={busy} onClick={() => void capture()}>{t("Занять руины")}</button></div>
              </div>
            )}
            {allDone && !city.state.capturedAt && !city.node.ruined && (
              <div className="capture">
                {city.recipient ? (
                  <p className="note ok"><Icon name="mail" /> {t("Отнесите шифр адресату:")} <strong>{city.recipient.label}</strong> <span className="muted">({kindLabel(city.recipient.kind)})</span>. {t("Назовите шифр, получите конверт и введите ключ из него:")}</p>
                ) : (
                  <p>{t("Назовите шифр семье, к которой вас направили, и получите конверт. Введите ключ из конверта:")}</p>
                )}
                <div className="row">
                  <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder={t("Ключ из конверта")} maxLength={12} autoCapitalize="characters" />
                  <button disabled={busy || key.trim().length < 4 || cooldown > 0} onClick={() => void capture()}>{cooldown > 0 ? `Подождите ${cooldown} с` : t("Взять город")}</button>
                </div>
              </div>
            )}
            {city.state.capturedAt && <div className="note ok">Город ваш{city.state.isCapital ? (city.state.secondCapital ? t(" — это ваша вторая столица") : t(" — это ваша столица")) : ""}.</div>}
            {city.state.capturedAt && !city.state.isCapital && isCaptain && (
              <div className="row" style={{ marginTop: ".4rem", alignItems: "center", gap: ".6rem" }}>
                <button className="secondary sm" disabled={busy || Boolean(city.team.capitalMovedAt)} onClick={() => void makeCapital()}>{t("Перенести столицу сюда")}</button>
                <span className="muted" style={{ fontSize: ".85rem" }}>{city.team.capitalMovedAt ? t("перенос уже использован") : t("один раз за игру, можно и во время испытания")}</span>
              </div>
            )}
          </>
        )}

        {/* Проход и война показываются всегда, даже пока районы не собраны: запросить проход можно сразу. */}
        {city?.content && !task && city.owner && !city.state.capturedAt && <PassageSection gameId={gameId} nodeKey={nodeKey} version={version} onChanged={onChanged} />}
        {city?.content && !task && (city.owner || city.state.capturedAt) && <WarSection gameId={gameId} nodeKey={nodeKey} teamId={teamId} isCaptain={isCaptain} version={version} onChanged={onChanged} />}
        {city?.content && task && (
          <TaskView task={task} district={districts.find((d) => d.index === task.index)} groupTitles={task.groupDistricts?.map((n) => districts.find((d) => d.index === n - 1)?.title ?? String(n)) ?? null} done={done.includes(task.index)} fragment={city.content.fragments[task.index] ?? null} busy={busy} cooldown={cooldown} onBack={() => setTaskIndex(null)} onAnswer={(v) => answer(task.index, v)}
            hintOpen={city.state.hintTasks.includes(task.index)} canHint={city.team.gameRole === "PROPHET"} onHint={() => hint(task.index)} gameId={gameId} nodeKey={nodeKey}
            lock={city.state.locks.find((l) => l.index === task.index) ?? null} choiceAttempts={city.state.choiceAttempts} now={now} onDispute={(m) => dispute(task.index, m)} heartbeatMs={city.state.heartbeatMs} notify={notify} />
        )}
      </div>
    </div>
  );
}

const isLocked = (locks: TaskLockDto[], index: number, now: number) => locks.some((l) => l.index === index && l.lockedUntil != null && l.lockedUntil > now);

function untilText(ms: number): string {
  const total = Math.max(1, Math.ceil(ms / 60_000)), h = Math.floor(total / 60), m = total % 60;
  return h > 0 ? t("{h} ч {m} мин", { h, m }) : t("{m} мин", { m });
}

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
  const canSend = !done && !busy && cooldown === 0 && !locked && !reading && (task.type === "choice" ? choice != null : task.type === "order" ? order.length > 0 : text.trim().length > 0);
  const scope = task.scope === "book" ? t("по всей книге") : task.scope === "group" ? t("по нескольким районам") : t("по этому району");
  const where = task.scope === "district" && district ? <>{t("Район")} {task.index + 1}: {district.title} <span>{district.verses}</span></> : task.scope === "group" && groupTitles ? <>{t("Районы")}: {groupTitles.join(", ")}</> : <>{t("Задание")} {task.index + 1}</>;
  return (
    <div className="task-view no-copy" onCopy={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}>
      <button className="ghost sm" onClick={onBack}>{t("‹ К районам")}</button>
      <div className="muted" style={{ margin: ".4rem 0 .2rem" }}>{where} · {t("задание")} {scope}</div>
      <p className="prompt">{task.prompt}</p>
      {!done && (
        <div className={"reading" + (reading ? "" : " ok")} title={t("Время чтения идёт, пока задание открыто на экране")}>
          <Icon name="book" />
          <span>{reading ? t("Чтение: {a} из {b}", { a: mmss(readMs), b: mmss(task.readingMs) }) : t("Время чтения набрано")}</span>
          <i style={{ ["--p" as string]: Math.min(1, readMs / task.readingMs) }} />
        </div>
      )}
      {task.type === "choice" && !done && !locked && lock && lock.attemptsLeft < choiceAttempts && <p className="note warn">{t("Осталась последняя попытка: после неверного ответа задание закроется на сутки.")}</p>}
      {task.type === "choice" && !done && !locked && (!lock || lock.attemptsLeft >= choiceAttempts) && <p className="muted" style={{ fontSize: ".85rem" }}>{t("Попыток: {n}. После них задание закрывается на сутки.", { n: choiceAttempts })}</p>}
      {locked && lock && (
        <div className="note bad lock-note">
          <div><Icon name="clock" /> {t("Задание закрыто после двух неверных ответов. Откроется через {t}.", { t: untilText(lock.lockedUntil! - now) })}</div>
          {disputeOpen && <div className="muted">{t("Спор отправлен администратору: «{m}». Ждите ответа.", { m: lock.dispute ?? "" })}</div>}
          {!disputeOpen && lock.resolvedAt && <div className="muted">{t("Администратор ответил:")} {lock.resolution || t("блокировка оставлена")}</div>}
          {!disputeOpen && !lock.resolvedAt && !disputeForm && <p><button type="button" className="secondary sm" onClick={() => setDisputeForm(true)}><Icon name="send" />{t("Оспорить: написать админу")}</button></p>}
          {!disputeOpen && !lock.resolvedAt && disputeForm && (
            <div className="inline-form">
              <textarea value={disputeText} onChange={(e) => setDisputeText(e.target.value)} placeholder={t("Почему ответ нужно засчитать или задание открыть")} maxLength={500} rows={3} />
              <div className="row">
                <button type="button" className="sm" disabled={busy || disputeText.trim().length < 5} onClick={() => void onDispute(disputeText.trim()).then((ok) => { if (ok) { setDisputeForm(false); setDisputeText(""); } })}><Icon name="send" />{t("Отправить админу")}</button>
                <button type="button" className="ghost sm" onClick={() => setDisputeForm(false)}>{t("Отмена")}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {!locked && lock?.resolvedAt && lock.resolution && !done && <p className="note ok">{t("Администратор ответил:")} {lock.resolution}</p>}
      {hintOpen && hintText && <div className="hint-box"><div className="muted">{t("Подсказка пророка · текст района")} {district?.verses}</div>{hintText.map((t, i) => <p key={i}>{t}</p>)}</div>}
      {!hintOpen && !done && canHint && <p><button type="button" className="ghost sm" disabled={busy} onClick={onHint}>{t("🔮 Открыть подсказку пророка (раз в неделю)")}</button></p>}
      {done ? (
        <div className="note ok">{t("Выполнено. Знак шифра:")} <strong>{fragment}</strong></div>
      ) : (
        <>
          {task.type === "number" && <input type="number" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Число")} onPaste={noPaste} onDrop={noPaste} autoComplete="off" />}
          {task.type === "text" && <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Ответ")} autoComplete="off" autoCorrect="off" spellCheck={false} onPaste={noPaste} onDrop={noPaste} />}
          {task.type === "choice" && (
            <ul className="choices">
              {task.options.map((o, i) => <li key={i} className={choice === i ? "on" : ""} onClick={() => setChoice(i)}><span className="radio" />{o}</li>)}
            </ul>
          )}
          {task.type === "order" && <SortableList ids={order} onChange={setOrder} render={(id) => <div className="d-title">{itemText.get(id)}</div>} />}
          <div className="actions">
            <button disabled={!canSend} onClick={() => void onAnswer(value)}>{locked ? t("Закрыто") : reading ? t("Читайте: {a}", { a: mmss(task.readingMs - readMs) }) : cooldown > 0 ? `Подождите ${cooldown} с` : t("Ответить")}</button>
          </div>
        </>
      )}
    </div>
  );
}
