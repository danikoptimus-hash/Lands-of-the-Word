import { useCallback, useEffect, useMemo, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, type AdminSeaDto, type MySeaDto, type SeaChartDto, type SeaTaskDto, type TaskLockDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t, getLocale } from "../lib/i18n";
import { fmtDate, fmtLeft } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { Help } from "../components/Help";
import { ErrorState, LoadingState } from "../components/State";
import { PickCooling } from "./CityForms";
import { Crew, Diff, Disc, FontsPage, Lights, Torn, seaImg, tornAssembled, tornStart, useHold, type TornState } from "./SeaForms";
import { Bearings, Panel, Reckoning, Roster, Unload, runUnload, type RosterState } from "./SeaCrew";

/**
 * Лист моря у команды (решение владельца 06.10): название и имена моря в Писании, десять вахт-головоломок, доля
 * состава, открытие моря и переправа на противоположный берег. Одиночные вахты решает каждый сам, командные
 * (пеленги, прибор и устав) — по экранам ролей, зачёт всем, кто держал экран.
 */
const WATCH_ICON: Record<string, string> = { lights: "lighthouse", disc: "settings", fonts: "book", diff: "eye", torn: "map", bearings: "telescope", reckoning: "helm", unload: "anchor", panel: "users", roster: "user" };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isLocked = (locks: TaskLockDto[], index: number, now: number) => locks.some((l) => l.index === index && l.lockedUntil != null && l.lockedUntil > now);

export function SeaSheet({ gameId, code, container, onClose, onChanged, onCross }: { gameId: string; code: string; container?: HTMLElement | null; onClose: () => void; onChanged: () => void; /** Начать переправу: карта подсветит свой берег, затем противоположный. */ onCross: (from: string[], candidates: Record<string, string[]>) => void }) {
  const { notify } = useUi();
  const [sea, setSea] = useState<MySeaDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskIndex, setTaskIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [info, setInfo] = useState<Record<string, unknown>>({});
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

  async function answer(index: number, value: unknown): Promise<"ok" | "accepted" | "bad"> {
    setBusy(true); setError(null);
    try {
      const r = await api<{ correct: boolean; accepted?: boolean; personal?: boolean; opened?: boolean; retryAt?: number | null; credited?: number; round?: number; confirmed?: string[] }>(`/api/games/${gameId}/my-sea/${code}/tasks/${index}/answer`, { method: "POST", body: JSON.stringify({ answer: value }) });
      if (r.correct && r.opened) { notify(t("Верно. Все вахты отстояны: море открыто!")); await sleep(600); setTaskIndex(null); }
      else if (r.correct && r.personal) notify(t("Верно: вахта засчитана вам. Решено вами: {a} из {b}", { a: mine.length + 1, b: total }));
      else if (r.correct) { notify(r.credited && r.credited > 1 ? t("Верно. Вахта отстояна, зачтена {n} участникам", { n: r.credited }) : t("Верно. Вахта отстояна")); await sleep(500); setTaskIndex(null); }
      else if (r.accepted) { setInfo({ round: r.round, confirmed: r.confirmed }); notify(r.round != null ? t("Верно. Раунд {n}", { n: r.round + 1 }) : t("Подтверждено карточек: {n}", { n: r.confirmed?.length ?? 0 })); }
      else notify(t("Неверно. Отмычка остывает: следующая попытка через {t}", { t: r.retryAt ? fmtLeft(r.retryAt - Date.now()) : "" }), "bad");
      await load(); onChanged();
      return r.correct ? "ok" : r.accepted ? "accepted" : "bad";
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Ошибка сети")); if (e instanceof ApiError && e.status === 429) void load(); return "bad"; }
    finally { setBusy(false); }
  }
  const task = taskIndex != null ? sea?.content?.tasks.find((x) => x.index === taskIndex) ?? null : null;
  const status = !sea ? "" : crossed ? t("Переправа использована") : opened ? t("Море открыто: можно переправиться") : sea.reached ? t("Берег достигнут: вахты открыты") : t("Команда ещё не вышла на этот берег");

  const head = (
    <div className="sea-head" style={{ backgroundImage: `linear-gradient(100deg, rgba(23,58,87,.85), rgba(44,110,145,.55) 55%, rgba(63,134,166,.35)), url(${seaImg(`${code}/header`)})` }}>
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
              <h3>{t("Десять вахт")}<Help>{t("Каждая вахта — головоломка по Синодальному тексту: данные для неё появляются только на экране, у каждой команды свои, а ответ нужно найти в Библии. Одиночные решает каждый сам; командные (пеленги, прибор и устав) идут по экранам ролей и зачитываются всем, кто держал свой экран.")}</Help></h3>
              <ul className="districts">
                {sea.content.tasks.map((x) => {
                  const ok = mine.includes(x.index), teamOk = done.includes(x.index) && !ok;
                  const locked = isLocked(sea.state.locks, x.index, now);
                  return (
                    <li key={x.index}>
                      <button type="button" className={"district watch" + (ok ? " done" : "") + (teamOk ? " team-done" : "") + (locked ? " locked" : "")} onClick={() => setTaskIndex(x.index)} aria-label={`${x.index + 1}. ${x.title} · ${ok ? t("выполнено") : teamOk ? t("решено командой, вами ещё нет") : locked ? t("закрыто") : t("не выполнено")}`}>
                        <span className="num"><Icon name={WATCH_ICON[x.type] ?? "list"} /></span>
                        <span className="body"><span className="d-title">{x.index + 1}. {x.title}{x.team && <Chip icon="users">{t("командная")}</Chip>}</span><span className="d-sum muted one">{x.prompt.length > 80 ? x.prompt.slice(0, 80) + "…" : x.prompt}</span></span>
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
      {sea && task && sea.sea.chart && (
        <WatchView key={`${task.index}-${task.type === "panel" ? task.round : ""}`} code={code} chart={sea.sea.chart} task={task} teamDone={done.includes(task.index)} done={mine.includes(task.index)} busy={busy} onBack={() => setTaskIndex(null)} onAnswer={(v) => answer(task.index, v)}
          lock={sea.state.locks.find((l) => l.index === task.index) ?? null} pauseSteps={sea.state.pauseSteps} now={now} gameId={gameId} notify={notify} info={info} />
      )}
    </Sheet>
  );
}

function WatchView({ code, chart, task, teamDone, done, busy, onBack, onAnswer, lock, pauseSteps, now, gameId, notify, info }: { code: string; chart: SeaChartDto; task: SeaTaskDto; teamDone: boolean; done: boolean; busy: boolean; onBack: () => void; onAnswer: (v: unknown) => Promise<"ok" | "accepted" | "bad">; lock: TaskLockDto | null; pauseSteps: number[]; now: number; gameId: string; notify: (text: string, tone?: "bad") => void; info: Record<string, unknown> }) {
  const locked = lock?.lockedUntil != null && lock.lockedUntil > now;
  const nextPause = pauseSteps[Math.min(lock?.wrong ?? 0, pauseSteps.length - 1)] ?? 20;
  const noPaste = (e: React.ClipboardEvent | React.DragEvent) => { e.preventDefault(); notify(t("Вставка отключена: наберите ответ вручную"), "bad"); };
  const [text, setText] = useState("");
  const [light, setLight] = useState<string | null>(null);
  const [found, setFound] = useState<Array<{ x: number; y: number }>>([]);
  const [torn, setTorn] = useState<TornState>(() => (task.type === "torn" ? tornStart(task) : {}));
  const [tornTap, setTornTap] = useState<{ x: number; y: number } | null>(null);
  const [points, setPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [moves, setMoves] = useState("");
  const [roster, setRoster] = useState<RosterState>({});
  const [result, setResult] = useState<"ok" | "bad" | null>(null);
  const team = task.team;
  const screens = task.type === "bearings" || task.type === "panel" ? task.screens : [];
  const canInput = !team || screens.includes("input");
  // «Держу экран»: на командной вахте отмечаемся раз в полминуты, пока вахта открыта.
  useHold(team && !done && !teamDone, useCallback(() => { api(`/api/games/${gameId}/my-sea/${code}/hold`, { method: "PUT", body: JSON.stringify({ taskIndex: task.index }) }).catch(() => undefined); }, [gameId, code, task.index]));
  const assembled = task.type === "torn" ? tornAssembled(task, torn) : false;
  const unloadDone = task.type === "unload" ? runUnload(task.map, task.order, task.kinds, moves).complete : false;
  const value = useMemo((): unknown => {
    switch (task.type) {
      case "lights": return { light, word: text.trim() };
      case "diff": return { taps: found };
      case "torn": return { pieces: torn, tap: tornTap };
      case "bearings": return { cell: text.trim().toUpperCase() };
      case "reckoning": return points.length ? points[points.length - 1] : null;
      case "unload": return { moves };
      case "panel": return { word: text.trim() };
      case "roster": return { assign: roster };
      default: return text.trim();
    }
  }, [task.type, light, text, found, torn, tornTap, points, moves, roster]);
  const filled = (() => {
    switch (task.type) {
      case "lights": return Boolean(light) && text.trim().length > 0;
      case "diff": return found.length >= task.count;
      case "torn": return assembled && tornTap != null;
      case "reckoning": return points.length > 0;
      case "unload": return unloadDone;
      case "roster": return task.cards.filter((c) => !c.confirmed).every((c) => roster[c.id]?.who && roster[c.id]?.then);
      case "bearings": return /^[А-ЯA-Z]\d{1,2}$/.test(text.trim().toUpperCase());
      default: return text.trim().length > 0;
    }
  })();
  const canSend = !done && !busy && !locked && filled && canInput;
  const send = async () => { const r = await onAnswer(value); setResult(r === "ok" ? "ok" : r === "bad" ? "bad" : null); if (r === "bad") setTimeout(() => setResult(null), 900); if (r === "accepted" && task.type === "panel") setText(""); };
  const justConfirmed = Array.isArray(info.confirmed) ? (info.confirmed as string[]) : [];
  const inputLabel = task.type === "bearings" ? t("Клетка") : t("Слово");
  const showText = task.type === "disc" || task.type === "fonts" || task.type === "lights" || task.type === "panel" || task.type === "bearings";
  const crew = task.type === "bearings" || task.type === "panel" ? task.crew : [];
  return (
    <div className={"task-view watch-view" + (result === "bad" ? " jam" : "")} onContextMenu={(e) => e.preventDefault()} onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onDragStart={(e) => e.preventDefault()}>
      <div className="row between nowrap">
        <button type="button" className="ghost back-btn" onClick={onBack}><Icon name="back" />{t("К вахтам")}</button>
      </div>
      <h3 className="mt-2">{t("Вахта {n}", { n: task.index + 1 })} · {task.title}{team && <Chip icon="users">{t("командная")}</Chip>}</h3>
      <p className="prompt no-copy" onCopy={(e) => e.preventDefault()}>{task.prompt}</p>
      {team && (task.type === "bearings" || task.type === "panel") && <Crew crew={task.crew} holders={task.holders} mine={task.screens} />}
      {!done && task.type === "lights" && <Lights task={task} picked={light} onPick={setLight} disabled={locked || busy} />}
      {!done && task.type === "disc" && <Disc task={task} />}
      {!done && task.type === "fonts" && <FontsPage task={task} />}
      {!done && task.type === "diff" && <Diff code={code} task={task} found={found} onFound={setFound} disabled={locked || busy} />}
      {!done && task.type === "torn" && <Torn code={code} chart={chart} task={task} state={torn} onChange={setTorn} assembled={assembled} tap={tornTap} onTap={setTornTap} disabled={locked || busy} />}
      {!done && task.type === "bearings" && <Bearings code={code} chart={chart} task={task} />}
      {!done && task.type === "reckoning" && <Reckoning code={code} chart={chart} task={task} points={points} onChange={setPoints} disabled={locked || busy} />}
      {!done && task.type === "unload" && <Unload code={code} task={task} moves={moves} onChange={setMoves} disabled={locked || busy} />}
      {!done && task.type === "panel" && <Panel task={task} />}
      {!done && task.type === "roster" && <Roster task={task} state={roster} onChange={setRoster} disabled={locked || busy} justConfirmed={justConfirmed} />}
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
          {teamDone && !team && <div className="note info"><Icon name="users" /><span>{t("Команда уже отстояла эту вахту. Решите её сами, чтобы она пошла в ваш зачёт.")}</span></div>}
          {teamDone && team && <div className="note info"><Icon name="users" /><span>{t("Командная вахта отстояна: зачёт получили все, кто держал экран.")}</span></div>}
          {!teamDone && team && !canInput && <div className="note info"><Icon name="users" /><span>{t("Ответ вводит держатель экрана ввода: {names}.", { names: crew.filter((c) => c.screens.includes("input")).map((c) => c.nickname).join(", ") })}</span></div>}
          {showText && canInput && !(teamDone && team) && <div className="field"><label htmlFor="answer-text">{inputLabel}</label><input id="answer-text" className="full" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" autoCorrect="off" spellCheck={false} onPaste={noPaste} onDrop={noPaste} /></div>}
          {canInput && !(teamDone && team) && (
            <div className="actions">
              <button type="button" disabled={!canSend} onClick={() => void send()}><Icon name={task.type === "roster" ? "lock" : "send"} />{task.type === "roster" ? t("Проверить") : task.type === "unload" ? t("Сдать вахту") : task.type === "diff" ? t("Все найдены") : t("Ответить")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type AdminTask = NonNullable<AdminSeaDto["content"]>["tasks"][number];
/** Администратор: вахты моря (ответы — только администратору платформы) и ход команд. */
export function AdminSeaSheet({ gameId, code, container, onClose }: { gameId: string; code: string; container: HTMLElement; onClose: () => void }) {
  const [sea, setSea] = useState<AdminSeaDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(() => api<AdminSeaDto>(`/api/games/${gameId}/seas/${code}`).then((s) => { setSea(s); setLoadError(false); }).catch(() => setLoadError(true)), [gameId, code]);
  useEffect(() => { void load(); }, [load]);
  const en = getLocale() === "en";
  const typeLabel: Record<string, string> = { lights: t("маяк"), disc: t("диск кормчего"), fonts: t("две гарнитуры"), diff: t("что изменилось"), torn: t("обрывки карты"), bearings: t("пеленги"), reckoning: t("счисление пути"), unload: t("разгрузка"), panel: t("прибор и устав"), roster: t("судовая роль") };
  const bookName = (code: string) => { const b = BOOKS.find((x) => x.code === code); return b ? (en ? b.nameEn : b.nameRu) : code; };
  const ref = (x: AdminTask) => x.book ? `${bookName(x.book)} ${x.chapter ?? ""}${x.from ? ":" + x.from + "–" + x.to : ""}` : "";
  const answerOf = (x: AdminTask): string => {
    if (x.answers) return x.answers.join(" / ");
    if (x.word && x.type === "fonts") return x.word;
    if (x.rules && x.rules.length && typeof x.rules[0] !== "string") return (x.rules as Array<{ text: string; word: string }>).map((r) => r.word).join(" / ");
    if (x.cards) return x.cards.map((c) => `${c.who} — ${c.then}`).join("; ");
    return "";
  };
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
                    {!sea.answersHidden && answerOf(x) && <span className="meta"><b>{t("Ответ")}:</b> {answerOf(x)}</span>}
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
