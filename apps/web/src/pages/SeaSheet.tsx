import { useCallback, useEffect, useMemo, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, type AdminSeaDto, type MySeaDto, type SeaTaskDto, type TaskLockDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t, getLocale } from "../lib/i18n";
import { fmtDate, fmtLeft } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { Help } from "../components/Help";
import { ErrorState, LoadingState } from "../components/State";
import { BurntScroll, LockChoice, LockRings, PickCooling, findGap } from "./CityForms";
import { Beacon, Passages, SignalFlags, WordPath } from "./SeaForms";

/**
 * Лист моря у команды (решение владельца 06.10): название и имена моря в Писании, десять вахт-головоломок, доля
 * состава, открытие моря и переправа на противоположный берег. Задания решает каждый сам, как в городе.
 */
const WATCH_ICON: Record<string, string> = { beacon: "lighthouse", wordpath: "map", flags: "flag", storm: "wave", count: "anchor", text: "scroll", order: "list", choice: "lock", number: "hint" };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isLocked = (locks: TaskLockDto[], index: number, now: number) => locks.some((l) => l.index === index && l.lockedUntil != null && l.lockedUntil > now);

export function SeaSheet({ gameId, code, container, onClose, onChanged, onCross }: { gameId: string; code: string; container?: HTMLElement | null; onClose: () => void; onChanged: () => void; /** Начать переправу: карта подсветит свой берег, затем противоположный. */ onCross: (from: string[], candidates: Record<string, string[]>) => void }) {
  const { notify } = useUi();
  const [sea, setSea] = useState<MySeaDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskIndex, setTaskIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(() => api<MySeaDto>(`/api/games/${gameId}/my-sea/${code}`).then((s) => { setSea(s); setError(null); }).catch((e) => setError(e instanceof ApiError ? e.message : t("Ошибка сети"))), [gameId, code]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const tm = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tm); }, []);
  const en = getLocale() === "en";
  const name = sea ? (en ? sea.sea.nameEn : sea.sea.name) : "";
  const done = sea?.state.doneTasks ?? [];
  const mine = sea?.state.mySolved ?? [];
  const total = sea?.state.total ?? 0;
  const allDone = total > 0 && done.length >= total;
  const solvers = sea?.state.solvers ?? 0, needSolvers = sea?.state.needSolvers ?? 0, members = sea?.state.members ?? 0, needTasks = sea?.state.needTasks ?? 0;
  const opened = Boolean(sea?.state.openedAt);
  const crossed = Boolean(sea?.state.crossedAt);
  const night = sea?.daytime?.phase === "night";
  const tasksOpen = sea?.daytime?.tasksOpen ?? !night;

  async function answer(index: number, value: unknown): Promise<boolean> {
    setBusy(true); setError(null);
    try {
      const r = await api<{ correct: boolean; personal?: boolean; opened?: boolean; retryAt?: number | null }>(`/api/games/${gameId}/my-sea/${code}/tasks/${index}/answer`, { method: "POST", body: JSON.stringify({ answer: value }) });
      if (r.correct && r.opened) { notify(t("Верно. Все вахты отстояны: море открыто!")); await sleep(600); setTaskIndex(null); }
      else if (r.correct && r.personal) notify(t("Верно: вахта засчитана вам. Решено вами: {a} из {b}", { a: mine.length + 1, b: total }));
      else if (r.correct) { notify(t("Верно. Вахта отстояна")); await sleep(500); setTaskIndex(null); }
      else notify(t("Неверно. Отмычка остывает: следующая попытка через {t}", { t: r.retryAt ? fmtLeft(r.retryAt - Date.now()) : "" }), "bad");
      await load(); onChanged();
      return r.correct;
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); if (e instanceof ApiError && e.status === 429) void load(); return false; }
    finally { setBusy(false); }
  }
  const task = taskIndex != null ? sea?.content?.tasks.find((x) => x.index === taskIndex) ?? null : null;
  const status = !sea ? "" : crossed ? t("Переправа использована") : opened ? t("Море открыто: можно переправиться") : sea.reached ? t("Берег достигнут: вахты открыты") : t("Команда ещё не вышла на этот берег");

  const head = (
    <div className="sea-head">
      <div className="sea-wave" aria-hidden="true"><Icon name="helm" /></div>
      <div className="title">
        <h2>{name}</h2>
        <div className="status">{status}{opened && <Chip tone="solid" icon="check">{t("открыто")}</Chip>}</div>
      </div>
    </div>
  );

  return (
    <Sheet size="md" container={container} onClose={onClose} head={head} className="sea-sheet no-copy">
      {error && <p className="error" role="alert">{error}</p>}
      {!sea && !error && <LoadingState rows={4} />}
      {sea && !task && (
        <>
          {(en ? sea.sea.introEn : sea.sea.intro) && <p className="sea-intro">{en ? sea.sea.introEn : sea.sea.intro}</p>}
          {sea.sea.names.length > 1 && <p className="small muted">{t("В Писании также: {names}", { names: sea.sea.names.join(", ") })}</p>}
          {!sea.hasContent && <div className="note warn"><Icon name="alert" /><span>{t("Вахты этого моря ещё готовятся.")}</span></div>}
          {sea.hasContent && !sea.reached && <div className="note info"><Icon name="anchor" /><span>{t("Вахты открываются, когда команда выходит на берег этого моря: откройте любой перекрёсток у воды.")}</span></div>}
          {sea.hasContent && sea.reached && !tasksOpen && <div className="note info night-note"><Icon name="moon" /><span>{t("Ночью вахты закрыты: море спит до 7:00 по местному времени.")}</span></div>}
          {sea.content && (
            <section className="step-body">
              <h3>{t("Десять вахт")}<Help>{t("Каждая вахта — головоломка по Синодальному тексту: данные для неё появляются только на экране, у каждой команды свои, а ответ нужно найти в Библии. Решает каждый сам; первый верный ответ засчитывает вахту команде.")}</Help></h3>
              <ul className="districts">
                {sea.content.tasks.map((x) => {
                  const ok = mine.includes(x.index), teamOk = done.includes(x.index) && !ok;
                  const locked = isLocked(sea.state.locks, x.index, now);
                  return (
                    <li key={x.index}>
                      <button type="button" className={"district watch" + (ok ? " done" : "") + (teamOk ? " team-done" : "") + (locked ? " locked" : "")} onClick={() => setTaskIndex(x.index)} aria-label={`${x.index + 1}. ${x.title} · ${ok ? t("выполнено") : teamOk ? t("решено командой, вами ещё нет") : locked ? t("закрыто") : t("не выполнено")}`}>
                        <span className="num"><Icon name={WATCH_ICON[x.type] ?? "list"} /></span>
                        <span className="body"><span className="d-title">{x.index + 1}. {x.title}</span><span className="d-sum muted one">{x.prompt.length > 80 ? x.prompt.slice(0, 80) + "…" : x.prompt}</span></span>
                        <span className={"check" + (ok ? " on" : "") + (teamOk ? " half" : "")}><Icon name={ok || teamOk ? "check" : locked ? "lock" : "chevron"} /></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {needSolvers > 0 && !opened && (
                <p className={"meta-line solvers-line" + (allDone && solvers < needSolvers ? " warn" : "")}>
                  <Icon name="users" />{t("Решили свою долю: {a} из {b}", { a: solvers, b: members })} · {solvers >= needSolvers ? t("для моря хватает") : t("для моря нужно {c}", { c: needSolvers })} · {t("вы: {x} из {y}", { x: mine.length, y: total })}
                  <Help>{t("Море открывается, когда все вахты отстояны и не меньше половины команды решили каждый хотя бы {n} вахт. Вахту, которую команда уже отстояла, можно решить и для своего зачёта.", { n: needTasks })}</Help>
                </p>
              )}
              {allDone && !opened && solvers < needSolvers && <div className="note warn"><Icon name="users" /><span>{t("Все вахты отстояны, но море ждёт: не меньше {c} участников должны решить каждый хотя бы {n} вахт, пока таких {a}.", { c: needSolvers, n: needTasks, a: solvers })}</span></div>}
            </section>
          )}
          {opened && !crossed && (
            <section className="step-body sea-cross">
              <h3>{t("Переправа")}</h3>
              <p className="small">{t("Море открыто. Один раз за игру команда переходит его: с любого своего берега на любой перекрёсток противоположного берега. Что там — город или пустая развилка, — заранее не видно.")}</p>
              {sea.crossing.canCross
                ? <div className="actions"><button type="button" disabled={busy || sea.crossing.from.length === 0} onClick={() => { onCross(sea.crossing.from, sea.crossing.candidates); onClose(); }}><Icon name="helm" />{t("Выбрать место переправы")}</button></div>
                : <p className="muted small">{t("Переправу ведёт кормчий: капитан и команда ему советуют.")}</p>}
            </section>
          )}
          {crossed && sea.state.crossedAt && <div className="note ok"><Icon name="ship" /><span>{t("Команда переправилась через это море {d}.", { d: fmtDate(new Date(sea.state.crossedAt).toISOString()) })}</span></div>}
        </>
      )}
      {sea && task && (
        <WatchView task={task} teamDone={done.includes(task.index)} done={mine.includes(task.index)} busy={busy} onBack={() => setTaskIndex(null)} onAnswer={(v) => answer(task.index, v)}
          lock={sea.state.locks.find((l) => l.index === task.index) ?? null} pauseSteps={sea.state.pauseSteps} now={now} draft={sea.state.taskDrafts?.[String(task.index)]} gameId={gameId} code={code} notify={notify} />
      )}
    </Sheet>
  );
}

function WatchView({ task, teamDone, done, busy, onBack, onAnswer, lock, pauseSteps, now, draft, gameId, code, notify }: { task: SeaTaskDto; teamDone: boolean; done: boolean; busy: boolean; onBack: () => void; onAnswer: (v: unknown) => Promise<boolean>; lock: TaskLockDto | null; pauseSteps: number[]; now: number; draft?: string[]; gameId: string; code: string; notify: (text: string, tone?: "bad") => void }) {
  const locked = lock?.lockedUntil != null && lock.lockedUntil > now;
  const nextPause = pauseSteps[Math.min(lock?.wrong ?? 0, pauseSteps.length - 1)] ?? 20;
  const noPaste = (e: React.ClipboardEvent | React.DragEvent) => { e.preventDefault(); notify(t("Вставка отключена: наберите ответ вручную"), "bad"); };
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<number | null>(null);
  const ids = task.type === "order" || task.type === "storm" ? task.items.map((i) => i.id) : [];
  const [order, setOrder] = useState<string[]>(draft && draft.length === ids.length && draft.every((x) => ids.includes(x)) ? draft : ids);
  const [path, setPath] = useState<string[]>([]);
  const [result, setResult] = useState<"ok" | "bad" | null>(null);
  const itemText = useMemo(() => (task.type === "order" || task.type === "storm" ? new Map(task.items.map((i) => [i.id, i.text])) : new Map<string, string>()), [task]);
  const gap = useMemo(() => (task.type === "text" ? findGap(task.prompt) : null), [task]);
  const saveDraft = (ids2: string[]) => { api(`/api/games/${gameId}/my-sea/${code}/draft`, { method: "PUT", body: JSON.stringify({ taskIndex: task.index, ids: ids2 }) }).catch(() => undefined); };
  const value = task.type === "choice" ? choice ?? 0 : task.type === "order" || task.type === "storm" ? order : task.type === "wordpath" ? path : text.trim();
  const filled = task.type === "choice" ? choice != null : task.type === "order" || task.type === "storm" ? order.length > 0 : task.type === "wordpath" ? path.length === task.count : text.trim().length > 0;
  const canSend = !done && !busy && !locked && filled;
  const send = async () => { const ok = await onAnswer(value); setResult(ok ? "ok" : "bad"); if (!ok) setTimeout(() => setResult(null), 900); };
  const lockForm = task.type === "choice" || task.type === "order" || task.type === "storm";
  return (
    <div className="task-view watch-view" onContextMenu={(e) => e.preventDefault()} onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onDragStart={(e) => e.preventDefault()}>
      <div className="row between nowrap">
        <button type="button" className="ghost back-btn" onClick={onBack}><Icon name="back" />{t("К вахтам")}</button>
      </div>
      <h3 className="mt-2">{t("Вахта {n}", { n: task.index + 1 })} · {task.title}</h3>
      {!(task.type === "text" && gap && !done) && <p className="prompt no-copy" onCopy={(e) => e.preventDefault()}>{task.prompt}</p>}
      {task.type === "beacon" && !done && <Beacon signal={task.signal} />}
      {task.type === "flags" && !done && <SignalFlags message={task.message} keyChart={task.key} />}
      <Passages items={task.show} />
      {!done && !locked && (lock?.wrong ?? 0) > 0 && <p className="muted small">{t("Ошибок подряд: {n} · следующая пауза {t}", { n: lock!.wrong, t: fmtLeft(nextPause * 1000) })}</p>}
      {locked && lock && (
        <div className="note bad lock-note">
          <div className="row nowrap"><PickCooling until={lock.lockedUntil!} now={now} label={t("Отмычка остывает")} total={(pauseSteps[Math.min(Math.max(lock.wrong - 1, 0), pauseSteps.length - 1)] ?? 20) * 1000} /></div>
          <span className="small">{t("Следующая попытка через {t}.", { t: fmtLeft(lock.lockedUntil! - now) })}</span>
        </div>
      )}
      {done ? (
        <div className="note ok"><Icon name="check" /><span>{t("Вахта отстояна.")}</span></div>
      ) : (
        <div className="answer">
          {teamDone && <div className="note info"><Icon name="users" /><span>{t("Команда уже отстояла эту вахту. Решите её сами, чтобы она пошла в ваш зачёт.")}</span></div>}
          {(task.type === "number" || task.type === "count") && <div className="field"><label htmlFor="answer-num">{t("Число")}</label><input id="answer-num" type="number" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} onPaste={noPaste} onDrop={noPaste} autoComplete="off" /></div>}
          {task.type === "text" && gap && <BurntScroll gap={gap} value={text} onChange={setText} disabled={locked} onPaste={noPaste} />}
          {((task.type === "text" && !gap) || task.type === "beacon" || task.type === "flags") && <div className="field"><label htmlFor="answer-text">{t("Слово")}</label><input id="answer-text" className="full" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false} onPaste={noPaste} onDrop={noPaste} /></div>}
          {task.type === "choice" && <LockChoice options={task.options} choice={choice} onPick={(i) => { setChoice(i); setResult(null); }} disabled={locked || busy} state={result === "ok" ? "open" : result === "bad" ? "jam" : "idle"} />}
          {(task.type === "order" || task.type === "storm") && <LockRings ids={order} labels={itemText} onChange={(ids2) => { setOrder(ids2); setResult(null); saveDraft(ids2); }} disabled={locked || busy} state={result === "ok" ? "open" : result === "bad" ? "jam" : "idle"} pinsWrong={result === "bad" ? -1 : null} strips hint={task.type === "storm" ? t("Обломки стиха: расставьте слова по порядку, как в книге.") : undefined} />}
          {task.type === "wordpath" && <WordPath rows={task.rows} cols={task.cols} cells={task.cells} count={task.count} value={path} onChange={(p) => { setPath(p); setResult(null); }} disabled={locked || busy} />}
          <div className="actions">
            <button type="button" disabled={!canSend} onClick={() => void send()}><Icon name={lockForm ? "lock" : "send"} />{lockForm ? t("Провернуть замок") : t("Ответить")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Администратор: вахты моря (ответы — только администратору платформы) и ход команд. */
export function AdminSeaSheet({ gameId, code, container, onClose }: { gameId: string; code: string; container: HTMLElement; onClose: () => void }) {
  const [sea, setSea] = useState<AdminSeaDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(() => api<AdminSeaDto>(`/api/games/${gameId}/seas/${code}`).then((s) => { setSea(s); setLoadError(false); }).catch(() => setLoadError(true)), [gameId, code]);
  useEffect(() => { void load(); }, [load]);
  const en = getLocale() === "en";
  const typeLabel: Record<string, string> = { beacon: t("маяк"), wordpath: t("курс по словам"), flags: t("сигнальные флаги"), storm: t("шторм"), count: t("лот"), text: t("слово"), order: t("по порядку"), choice: t("выбор"), number: t("число") };
  const bookName = (code: string) => { const b = BOOKS.find((x) => x.code === code); return b ? (en ? b.nameEn : b.nameRu) : code; };
  const ref = (x: { book?: string; chapter?: number; verse?: number; verses?: number[]; from?: number; to?: number }) => x.book ? `${bookName(x.book)} ${x.chapter ?? ""}${x.verse ? ":" + x.verse : x.verses ? ":" + x.verses.join("/") : x.from ? ":" + x.from + "–" + x.to : ""}` : "";
  return (
    <Sheet container={container} size="md" title={sea ? (en ? sea.sea.nameEn : sea.sea.name) : t("Море")} onClose={onClose}>
      {loadError ? <ErrorState onRetry={() => void load()} /> : !sea ? <LoadingState /> : (
        <div className="stack">
          {sea.sea.intro && <p className="small">{sea.sea.intro}</p>}
          <p className="small muted">{t("Береговых перекрёстков: {n}", { n: sea.sea.shore })}{sea.sea.names.length > 1 ? ` · ${t("в Писании также: {names}", { names: sea.sea.names.join(", ") })}` : ""}</p>
          <section>
            <h3>{t("Команды")}</h3>
            <ul className="list">
              {sea.teams.map((tm) => (
                <li key={tm.id}><div className="main"><span className="title" style={{ color: tm.color }}>{tm.name}</span><span className="meta">{t("вахт: {a} из {b}", { a: tm.doneTasks.length, b: sea.content?.tasks.length ?? 0 })}{tm.openedAt ? ` · ${t("море открыто")}` : ""}{tm.crossedAt ? ` · ${t("переправа {d}", { d: fmtDate(tm.crossedAt) })}` : ""}</span></div></li>
              ))}
            </ul>
          </section>
          {sea.content && (
            <section>
              <h3>{t("Вахты")}{sea.answersHidden && <span className="muted small"> · {t("ответы видит только администратор платформы")}</span>}</h3>
              <ol className="list">
                {sea.content.tasks.map((x, i) => (
                  <li key={i}><div className="main"><span className="title">{i + 1}. {x.title} <span className="muted">· {typeLabel[x.type] ?? x.type}{ref(x) ? " · " + ref(x) : ""}</span></span><span className="meta">{x.prompt}</span>
                    {!sea.answersHidden && (x.answer != null || x.answers || x.correct != null || x.items) && <span className="meta"><b>{t("Ответ")}:</b> {x.answer ?? x.answers?.join(" / ") ?? (x.correct != null && x.options ? x.options[x.correct] : "") ?? ""}{x.items && x.type === "order" ? x.items.join(" → ") : ""}</span>}
                    {!sea.answersHidden && x.stem && <span className="meta"><b>{t("Корень")}:</b> {x.stem}</span>}
                  </div></li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </Sheet>
  );
}
