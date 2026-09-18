import { useCallback, useEffect, useMemo, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, type CityTaskDto, type MyCityDto, type SupportItemDto, type TaskLockDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { IMG } from "./MapLayers";
import { BurntScroll, CipherSeal, Crossword, LockChoice, LockRings, PickCooling, ProphetCandle, WaxEnvelope, findGap } from "./CityForms";
import { WarSection } from "./BattlePanel";
import { PassageSection } from "./Diplomacy";
import { t } from "../lib/i18n";
import { fmtDate, fmtLeft } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { Help } from "../components/Help";
import { LoadingState } from "../components/State";
import { kindLabel } from "./RecipientsBlock";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
/** Пересказы районов (в списке и на кольцах замка) — личное удобство читателя, запоминается в браузере. */
const SUMMARIES_KEY = "lotw.summaries";
const readSummaries = () => { try { return localStorage.getItem(SUMMARIES_KEY) === "1"; } catch { return false; } };

/**
 * Попап города у команды: шапка (иллюстрация, книга, статус, «Столица», свеча пророка), индикатор шагов
 * 1 Порядок · 2 Районы · 3 Конверт, тело текущего шага, ниже свёрнутые секции «Проход» и «Испытание».
 * Шаги оформлены как замок с кольцами (и для порядка, и для выбора ответа), районы с печатью шифра и конверт с сургучом (решения 18.09).
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
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
  /** Сцены форм: замок открылся/заклинило, районы только что встали по порядку, какой сектор печати выбит, сургуч. */
  const [lockState, setLockState] = useState<"idle" | "open" | "jam">("idle");
  const [justSolved, setJustSolved] = useState(false);
  const [struck, setStruck] = useState<number | null>(null);
  const [capResult, setCapResult] = useState<"ok" | "bad" | null>(null);
  const [summaries, setSummaries] = useState(readSummaries);
  const toggleSummaries = () => setSummaries((v) => { const next = !v; try { localStorage.setItem(SUMMARIES_KEY, next ? "1" : "0"); } catch { /* приватный режим */ } return next; });
  const sumToggle = <button type="button" className="ghost sm sum-toggle" aria-pressed={summaries} onClick={toggleSummaries}><Icon name="book" />{summaries ? t("Скрыть пересказ") : t("Пересказ")}</button>;

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
  /** Пауза на ключ конверта (растущая после каждого неверного ключа). */
  const cooldown = city?.state.keyLockedUntil && city.state.keyLockedUntil > now ? Math.ceil((city.state.keyLockedUntil - now) / 1000) : 0;

  async function checkOrder() {
    if (!order) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ correct: boolean; wrong: number }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/order`, { method: "POST", body: JSON.stringify({ ids: order }) });
      setOrderResult(r.wrong);
      if (r.correct) {
        // Дужка открывается, затем районы окрашиваются и застывают по порядку книги.
        setLockState("open"); await sleep(900);
        notify(t("Порядок верный: районы открыты")); setOrder(null); setJustSolved(true);
      } else { setLockState("jam"); setTimeout(() => setLockState("idle"), 700); }
      await load(); onChanged();
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }
  async function answer(index: number, value: unknown): Promise<boolean> {
    setBusy(true); setError(null);
    try {
      const r = await api<{ correct: boolean; fragment?: string; retryAt?: number | null; wrong?: number }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/tasks/${index}/answer`, { method: "POST", body: JSON.stringify({ answer: value }) });
      if (r.correct) { setStruck(index); notify(t("Верно. Знак шифра: {f}", { f: r.fragment ?? "" })); await sleep(900); }
      else notify(t("Неверно. Отмычка остывает: следующая попытка через {t}", { t: r.retryAt ? fmtLeft(r.retryAt - Date.now()) : "" }), "bad");
      await load(); onChanged();
      return r.correct;
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); if (e instanceof ApiError && e.status === 429) void load(); return false; }
    finally { setBusy(false); }
  }
  /** Обращение в поддержку: игрок пишет только текст, город и задание сервер подставляет сам. */
  async function support(index: number, message: string): Promise<boolean> {
    setBusy(true); setError(null);
    try {
      await api(`/api/games/${gameId}/support`, { method: "POST", body: JSON.stringify({ nodeKey, taskIndex: index, message }) });
      notify(t("Обращение отправлено. Ответ придёт уведомлением и письмом."));
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
      setCapResult("ok");
      notify(r.isCapital ? t("Город ваш. Это ваша столица") : t("Город ваш"));
      setKey("");
      await sleep(700);
      await load(); onChanged();
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); setCapResult("bad"); setTimeout(() => setCapResult(null), 800); if (e instanceof ApiError && (e.status === 400 || e.status === 429)) void load(); }
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
        <div className="status">{statusLine}{city?.state.isCapital && <Chip tone="solid" icon="crown">{t("Столица")}</Chip>}{city?.content && <ProphetCandle availableAt={city.state.hintAvailableAt} now={now} />}</div>
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
          <LockRings ids={order} labels={new Map(districts.map((d) => [d.id, d.title]))} sub={summaries ? new Map(districts.map((d) => [d.id, d.summary])) : undefined} onChange={(ids) => { setOrder(ids); setOrderResult(null); }} disabled={busy || lockState === "open"} state={lockState} pinsWrong={orderResult}
            hint={city.state.orderAttempts > 0 ? t("Попыток: {k}", { k: city.state.orderAttempts }) : t("Стрелки листают кольцо. Готово — проверните замок.")}
            help={t("Замок скажет, сколько штифтов не село, но не каких. Для длинного списка есть вид «Список».")} tools={sumToggle} />
          <div className="actions"><button type="button" disabled={busy || lockState === "open"} onClick={() => void checkOrder()}><Icon name="lock" />{t("Провернуть замок")}</button></div>
        </section>
      )}

      {city?.content && step >= 2 && !task && (
        <section className="step-body">
          {step === 2 && <div className="row between nowrap step-head"><h3>{t("Решите задание в каждом районе")}</h3>{sumToggle}</div>}
          {step === 2 && (
            <ul className="districts">
              {districts.map((d) => {
                const i = d.index ?? 0;
                const ok = done.includes(i);
                const locked = isLocked(city.state.locks, i, now);
                const hue = Math.round(20 + (300 * i) / Math.max(districts.length, 1));
                const lit = city.state.hintTasks.includes(i);
                return (
                  <li key={d.id} className={justSolved ? "reveal" : ""} style={{ ["--d-hue" as string]: hue, animationDelay: justSolved ? `${i * 90}ms` : undefined }}>
                    <button type="button" className={"district set" + (ok ? " done" : "") + (locked ? " locked" : "") + (lit ? " lit" : "")} onClick={() => setTaskIndex(i)} aria-label={`${i + 1}. ${d.title} · ${ok ? t("выполнено") : locked ? t("закрыто") : t("не выполнено")}`}>
                      <span className="num">{i + 1}</span>
                      <span className="body"><span className="d-title">{d.title} <span className="muted">{d.verses}</span></span>{summaries && <span className="d-sum muted">{d.summary}</span>}</span>
                      {lit && <span className="window" title={t("Подсказка пророка открыта")} aria-hidden="true" />}
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
                        <span className="body"><span className="d-title">{x.scope === "book" ? t("По всей книге") : t("По нескольким районам")}</span><span className="d-sum muted one">{x.prompt.length > 90 ? x.prompt.slice(0, 90) + "…" : x.prompt}</span></span>
                        <span className={"check" + (ok ? " on" : "")}><Icon name={ok ? "check" : locked ? "lock" : "chevron"} /></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {step === 3 && !city.state.capturedAt && <h3>{t("Получите конверт с ключом")}</h3>}
          {!allDone && (
            <div className="cipher">
              <CipherSeal fragments={city.content.fragments} struck={struck} />
              <div className="cipher-side">
                <span className="strong">{t("Печать города")}<Help>{t("Каждый решённый район выбивает на печати свой знак. Когда соберутся все — откроется конверт.")}</Help></span>
                <span className="hint">{t("Знаков: {a} из {b}", { a: done.length, b: total })}</span>
                <span className="letters sr-only">{city.content.fragments.map((f) => f ?? "·").join(" ")}</span>
              </div>
            </div>
          )}
          {allDone && (
            <div className="capture">
              {city.node.ruined && !city.owner && !city.state.capturedAt && <div className="note warn"><Icon name="info" /><span>{t("Город в руинах: его можно занять без конверта.")}</span></div>}
              <WaxEnvelope fragments={city.content.fragments} cipher={city.content.fragments.map((f) => f ?? "·").join("")}
                recipientText={city.recipient ? t("Кому: «{label}» ({kind}). Назовите шифр — получите конверт.", { label: city.recipient.label, kind: kindLabel(city.recipient.kind) }) : t("Назовите шифр тому, к кому вас направили, — получите конверт.")}
                codeRule={city.content.codeRule} keyValue={key} onKey={setKey} onBreak={() => void capture()} busy={busy} cooldown={cooldown} ruined={city.node.ruined && !city.owner} result={capResult}
                captured={city.state.capturedAt ? { isCapital: city.state.isCapital, secondCapital: city.state.secondCapital } : null}
                ownedBy={city.owner && !city.state.capturedAt ? { name: city.owner.name, color: city.owner.color } : null} />
            </div>
          )}
          {city.state.capturedAt && !city.state.isCapital && isCaptain && (
            <div className="row mt-2">
              <button type="button" className="secondary" disabled={busy || Boolean(city.team.capitalMovedAt)} onClick={() => void makeCapital()}><Icon name="crown" />{t("Перенести столицу сюда")}</button>
              {city.team.capitalMovedAt ? <span className="hint">{t("уже использован")}</span> : <Help>{t("Один раз за игру. Можно и во время испытания.")}</Help>}
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
        <TaskView task={task} fragments={city.content.fragments} district={districts.find((d) => d.index === task.index)} groupTitles={task.groupDistricts?.map((n) => districts.find((d) => d.index === n - 1)?.title ?? String(n)) ?? null} done={done.includes(task.index)} fragment={city.content.fragments[task.index] ?? null} busy={busy} cooldown={cooldown} onBack={() => setTaskIndex(null)} onAnswer={(v) => answer(task.index, v)}
          hintOpen={city.state.hintTasks.includes(task.index)} canHint={city.team.gameRole === "PROPHET"} onHint={() => hint(task.index)} gameId={gameId} nodeKey={nodeKey}
          lock={city.state.locks.find((l) => l.index === task.index) ?? null} support={city.state.support.filter((r) => r.taskIndex === task.index)} pauseSteps={city.state.pauseSteps} now={now} onSupport={(m) => support(task.index, m)} notify={notify} />
      )}
    </Sheet>
  );
}

const isLocked = (locks: TaskLockDto[], index: number, now: number) => locks.some((l) => l.index === index && l.lockedUntil != null && l.lockedUntil > now);

function TaskView({ task, fragments, district, groupTitles, done, fragment, busy, onBack, onAnswer, hintOpen, canHint, onHint, gameId, nodeKey, lock, support, pauseSteps, now, onSupport, notify }: { task: CityTaskDto; fragments: Array<string | null>; district?: { title: string; verses: string; summary?: string }; groupTitles: string[] | null; done: boolean; fragment: string | null; busy: boolean; cooldown: number; onBack: () => void; onAnswer: (v: unknown) => Promise<boolean>; hintOpen: boolean; canHint: boolean; onHint: () => void; gameId: string; nodeKey: string; lock: TaskLockDto | null; support: SupportItemDto[]; pauseSteps: number[]; now: number; onSupport: (message: string) => Promise<boolean>; notify: (text: string, tone?: "bad") => void }) {
  /** Отмычка остывает: растущая пауза на это задание после неверного ответа (решение владельца 18.09). */
  const locked = lock?.lockedUntil != null && lock.lockedUntil > now;
  const cooldown = 0;
  const nextPause = pauseSteps[Math.min(lock?.wrong ?? 0, pauseSteps.length - 1)] ?? 20;
  /** Вставка из буфера отключена (решение владельца): ответ набирается вручную. */
  const noPaste = (e: React.ClipboardEvent | React.DragEvent) => { e.preventDefault(); notify(t("Вставка отключена: наберите ответ вручную"), "bad"); };
  const openRequest = support.find((r) => r.status === "OPEN") ?? null;
  const lastReply = openRequest ? null : support.find((r) => r.status === "CLOSED") ?? null;
  const [supportText, setSupportText] = useState("");
  const [supportForm, setSupportForm] = useState(false);
  const [hintText, setHintText] = useState<string[] | null>(null);
  /** Стихи письма — из ответа сервера: для задания по группе районов это районы группы, а не район с номером задания. */
  const [hintVerses, setHintVerses] = useState("");
  useEffect(() => { if (hintOpen) api<{ text: string[]; verses: string }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/hint/${task.index}`).then((r) => { setHintText(r.text); setHintVerses(r.verses); }).catch(() => setHintText(null)); else setHintText(null); }, [hintOpen, gameId, nodeKey, task.index]);
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<number | null>(null);
  const [order, setOrder] = useState<string[]>(task.type === "order" ? task.items.map((i) => i.id) : []);
  const [words, setWords] = useState<string[] | null>(null);
  /** Итог последней отправки — для сцены формы (весы выравниваются, замок заклинивает); сбрасывается при смене ответа. */
  const [result, setResult] = useState<"ok" | "bad" | null>(null);
  const itemText = useMemo(() => (task.type === "order" ? new Map(task.items.map((i) => [i.id, i.text])) : new Map<string, string>()), [task]);
  const gap = useMemo(() => (task.type === "text" ? findGap(task.prompt) : null), [task]);
  const value = task.type === "choice" ? choice ?? 0 : task.type === "order" ? order : task.type === "crossword" ? words : text.trim();
  const filled = task.type === "choice" ? true : task.type === "order" ? order.length > 0 : task.type === "crossword" ? words != null : text.trim().length > 0;
  const canSend = !done && !busy && cooldown === 0 && !locked && filled;
  const send = async () => { const ok = await onAnswer(value); setResult(ok ? "ok" : "bad"); if (!ok) setTimeout(() => setResult(null), 900); };
  const scope = task.scope === "book" ? t("По всей книге") : task.scope === "group" ? t("По районам: {list}", { list: groupTitles?.join(", ") ?? "" }) : t("По этому району");
  const title = task.scope === "district" && district ? [t("Район {n}", { n: task.index + 1 }), district.title, district.verses].filter(Boolean).join(" · ") : t("Задание {n}", { n: task.index + 1 });
  const why = locked ? t("Отмычка остывает") : null;
  return (
    <div className="task-view" onContextMenu={(e) => e.preventDefault()}>
      <div className="row between nowrap">
        <button type="button" className="ghost back-btn" onClick={onBack}><Icon name="back" />{t("К районам")}</button>
        <CipherSeal fragments={fragments} size={44} className="corner" />
      </div>
      <h3 className="mt-2">{title}</h3>
      <p className="scope">{scope}</p>
      {task.scope === "district" && district?.summary && (
        <details className="disclose sm">
          <summary><Icon name="book" />{t("Пересказ района")}<Icon name="chevron-down" className="chev" /></summary>
          <p className="small muted">{district.summary}</p>
        </details>
      )}
      {!(task.type === "text" && gap && !done) && <p className="prompt no-copy" onCopy={(e) => e.preventDefault()}>{task.prompt}</p>}
      {!done && !locked && (lock?.wrong ?? 0) > 0 && <p className="muted small">{t("Ошибок подряд: {n} · следующая пауза {t}", { n: lock!.wrong, t: fmtLeft(nextPause * 1000) })}</p>}
      {locked && lock && (
        <div className="note bad lock-note">
          <div className="row nowrap"><PickCooling until={lock.lockedUntil!} now={now} label={t("Отмычка остывает")} total={(pauseSteps[Math.min(Math.max(lock.wrong - 1, 0), pauseSteps.length - 1)] ?? 20) * 1000} /></div>
          <span className="small">{t("Следующая попытка через {t}.", { t: fmtLeft(lock.lockedUntil! - now) })}</span>
        </div>
      )}
      {openRequest && <div className="note info"><Icon name="send" /><span>{t("Обращение в поддержку отправлено {d}. Ждём ответа.", { d: fmtDate(new Date(openRequest.createdAt).toISOString()) })}</span></div>}
      {lastReply && !done && <div className={"note " + (lastReply.unlocked ? "ok" : "info")}><Icon name="info" /><span>{t("Ответ поддержки: {a}", { a: lastReply.reply || (lastReply.unlocked ? t("блокировка снята") : t("обращение рассмотрено")) })}</span></div>}
      {!done && !openRequest && !supportForm && <p className="mt-2 support-link"><button type="button" className="ghost sm" onClick={() => setSupportForm(true)}><Icon name="send" />{t("Написать в поддержку")}</button></p>}
      {supportForm && (
        <div className="support-form card flat">
          <p className="small"><strong>{t("Обращение в поддержку")}</strong></p>
          <label htmlFor="support-text">{t("Сообщение")}</label>
          <textarea id="support-text" value={supportText} onChange={(e) => setSupportText(e.target.value)} maxLength={1000} rows={3} autoFocus placeholder={t("Что не так? Город и задание подставятся сами.")} />
          <div className="actions row mt-2">
            <button type="button" disabled={busy || supportText.trim().length < 5} onClick={() => void onSupport(supportText.trim()).then((ok) => { if (ok) { setSupportForm(false); setSupportText(""); } })}><Icon name="send" />{t("Отправить")}</button>
            <button type="button" className="secondary" onClick={() => setSupportForm(false)}>{t("Отмена")}</button>
          </div>
        </div>
      )}
      {hintOpen && hintText && (
        <div className="hint-box prophet-letter no-copy">
          <div className="letter-head"><Icon name="mail" /><span className="strong">{t("Письмо пророка")}</span><span className="muted small">{t("текст района {verses}", { verses: hintVerses || district?.verses || "" })}</span></div>
          {hintText.map((x, i) => <p key={i}>{x}</p>)}
          <div className="muted small letter-sign">{t("Видно только вам — расскажите команде.")}</div>
        </div>
      )}
      {!hintOpen && !done && canHint && <p className="mt-2 row nowrap"><button type="button" className="secondary" disabled={busy} onClick={onHint}><Icon name="sparkle" />{t("Свеча пророка")}</button><Help>{t("Раз в неделю открывает текст района. Видит только пророк.")}</Help></p>}
      {done ? (
        <div className="note ok"><Icon name="check" /><span>{t("Выполнено. Знак шифра: {f}", { f: fragment ?? "" })}</span></div>
      ) : (
        <div className="answer">
          {task.type === "number" && <div className="field"><label htmlFor="answer-num">{t("Число")}</label><input id="answer-num" type="number" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} onPaste={noPaste} onDrop={noPaste} autoComplete="off" /></div>}
          {task.type === "text" && gap && <BurntScroll gap={gap} value={text} onChange={setText} disabled={locked} onPaste={noPaste} />}
          {task.type === "text" && !gap && <div className="field"><label htmlFor="answer-text">{t("Ответ")}</label><input id="answer-text" className="full" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false} onPaste={noPaste} onDrop={noPaste} /></div>}
          {task.type === "choice" && <LockChoice options={task.options} choice={choice} onPick={(i) => { setChoice(i); setResult(null); }} disabled={locked || busy} state={result === "ok" ? "open" : result === "bad" ? "jam" : "idle"} />}
          {task.type === "order" && <LockRings ids={order} labels={itemText} onChange={(ids) => { setOrder(ids); setResult(null); }} disabled={locked || busy} state={result === "ok" ? "open" : result === "bad" ? "jam" : "idle"} pinsWrong={result === "bad" ? -1 : null} strips />}
          {task.type === "crossword" && <Crossword rows={task.rows} cols={task.cols} words={task.words} onChange={setWords} disabled={locked || busy} onPaste={noPaste} />}
          {why && <p className="hint" aria-live="polite">{why}</p>}
          <div className="actions">
            <button type="button" disabled={!canSend} onClick={() => void send()}><Icon name={task.type === "choice" || task.type === "order" ? "lock" : "send"} />{task.type === "choice" || task.type === "order" ? t("Провернуть замок") : t("Ответить")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
