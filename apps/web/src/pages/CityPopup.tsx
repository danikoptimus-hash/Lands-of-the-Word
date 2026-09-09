import { useCallback, useEffect, useMemo, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { api, ApiError, type CityTaskDto, type MyCityDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { IMG } from "./MapLayers";
import { SortableList } from "./SortableList";
import { WarSection } from "./BattlePanel";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));

/**
 * Попап города у команды. Шаг 1: районы (сцены книги) серые, их надо расставить по порядку —
 * после верного порядка они окрашиваются и застывают. Шаг 2: в каждом районе одно задание,
 * решённое помечается зелёной галочкой справа и даёт букву шифра. Шаг 3: ключ из конверта — город взят.
 */
export function CityPopup({ gameId, nodeKey, teamId, isCaptain, version, onClose, onChanged }: { gameId: string; nodeKey: string; teamId: string; isCaptain: boolean; version: number; onClose: () => void; onChanged: () => void }) {
  const { notify } = useUi();
  const [city, setCity] = useState<MyCityDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [orderResult, setOrderResult] = useState<number | null>(null);
  const [taskIndex, setTaskIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => api<MyCityDto>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}`).then((c) => { setCity(c); setError(null); }).catch((e) => setError(e instanceof ApiError ? e.message : "Ошибка сети")), [gameId, nodeKey]);
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
      if (r.correct) { notify("Порядок верный! Районы открыты"); setOrder(null); }
      await load(); onChanged();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
    finally { setBusy(false); }
  }
  async function answer(index: number, value: unknown): Promise<boolean> {
    setBusy(true); setError(null);
    try {
      const r = await api<{ correct: boolean; fragment?: string }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/tasks/${index}/answer`, { method: "POST", body: JSON.stringify({ answer: value }) });
      if (r.correct) notify(`Верно! Буква шифра: ${r.fragment}`);
      else notify("Неверно. Перечитайте это место в книге", "bad");
      await load(); onChanged();
      return r.correct;
    } catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); return false; }
    finally { setBusy(false); }
  }
  async function capture() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ ok: boolean; isCapital: boolean }>(`/api/games/${gameId}/my-city/${encodeURIComponent(nodeKey)}/capture`, { method: "POST", body: JSON.stringify({ key }) });
      notify(r.isCapital ? "Город ваш! Это ваша столица" : "Город ваш!");
      setKey("");
      await load(); onChanged();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сети"); }
    finally { setBusy(false); }
  }

  const task = taskIndex != null ? city?.content?.tasks.find((t) => t.index === taskIndex) ?? null : null;

  return (
    <div className="city-backdrop" onClick={onClose}>
      <div className="city-popup" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="city-head">
          <img src={IMG.city(city?.node.cityType)} alt="" />
          <div className="title">
            <strong>{book ? `Город ${book.nameRu}` : "Город"}</strong>
            <div className="muted">
              {city?.owner ? <span className="badge" style={{ borderColor: city.owner.color, color: city.owner.color }}>{city.owner.name}</span> : <span className="badge">свободный</span>}
              {city?.state.isCapital && <span className="badge accent"> столица</span>}
              {total > 0 && <span> · районов {done.length}/{total}</span>}
            </div>
          </div>
          <button className="ghost sm" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        {error && <p className="error">{error}</p>}
        {!city && !error && <p className="muted">Загрузка…</p>}
        {city && !city.content && <p className="note warn">Задания для книги «{book?.nameRu}» ещё готовятся. Город пока нельзя взять.</p>}

        {city?.content && !city.state.orderSolved && order && (
          <>
            <p className="muted" style={{ margin: "0 0 .6rem" }}>Расставьте районы в порядке, в котором эти сцены идут в книге. Тяните за ⋮⋮ или пользуйтесь стрелками.</p>
            {orderResult != null && orderResult > 0 && <div className="note bad">Не на своём месте: {orderResult}. Попыток: {city.state.orderAttempts}</div>}
            <SortableList ids={order} onChange={setOrder} render={(id) => { const d = byId.get(id)!; return <><div className="d-title">{d.title}</div><div className="d-sum muted">{d.summary}</div></>; }} />
            <div className="actions"><button disabled={busy} onClick={() => void checkOrder()}>Проверить порядок</button></div>
          </>
        )}

        {city?.content && city.state.orderSolved && !task && (
          <>
            <ul className="districts">
              {districts.map((d) => {
                const i = d.index ?? 0;
                const ok = done.includes(i);
                return (
                  <li key={d.id} className={"district open" + (ok ? " done" : "")} onClick={() => setTaskIndex(i)}>
                    <span className="num">{i + 1}</span>
                    <div className="body"><div className="d-title">{d.title} <span className="muted">{d.verses}</span></div><div className="d-sum muted">{d.summary}</div></div>
                    <span className={"check" + (ok ? " on" : "")} aria-label={ok ? "выполнено" : "не выполнено"}>{ok ? "✓" : "›"}</span>
                  </li>
                );
              })}
            </ul>
            <div className="cipher">
              <div className="muted">Шифр</div>
              <div className="letters">{city.content.fragments.map((f, i) => <span key={i} className={f ? "on" : ""}>{f ?? "·"}</span>)}</div>
              {allDone && <p className="muted" style={{ margin: ".3rem 0 0" }}>{city.content.codeRule}</p>}
            </div>
            {allDone && !city.state.capturedAt && (
              <div className="capture">
                <p>Назовите шифр семье, к которой вас направили, и получите конверт. Введите ключ из конверта:</p>
                <div className="row">
                  <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="Ключ из конверта" maxLength={12} autoCapitalize="characters" />
                  <button disabled={busy || key.trim().length < 4 || cooldown > 0} onClick={() => void capture()}>{cooldown > 0 ? `Подождите ${cooldown} с` : "Взять город"}</button>
                </div>
              </div>
            )}
            {city.state.capturedAt && <div className="note ok">Город ваш{city.state.isCapital ? " — это ваша столица" : ""}.</div>}
            {(city.owner || city.state.capturedAt) && <WarSection gameId={gameId} nodeKey={nodeKey} teamId={teamId} isCaptain={isCaptain} version={version} onChanged={onChanged} />}
          </>
        )}

        {city?.content && task && (
          <TaskView task={task} district={districts.find((d) => d.index === task.index)} done={done.includes(task.index)} fragment={city.content.fragments[task.index] ?? null} busy={busy} cooldown={cooldown} onBack={() => setTaskIndex(null)} onAnswer={(v) => answer(task.index, v)} />
        )}
      </div>
    </div>
  );
}

function TaskView({ task, district, done, fragment, busy, cooldown, onBack, onAnswer }: { task: CityTaskDto; district?: { title: string; verses: string }; done: boolean; fragment: string | null; busy: boolean; cooldown: number; onBack: () => void; onAnswer: (v: unknown) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<number | null>(null);
  const [order, setOrder] = useState<string[]>(task.type === "order" ? task.items.map((i) => i.id) : []);
  const itemText = useMemo(() => (task.type === "order" ? new Map(task.items.map((i) => [i.id, i.text])) : new Map<string, string>()), [task]);
  const value = task.type === "choice" ? choice : task.type === "order" ? order : text.trim();
  const canSend = !done && !busy && cooldown === 0 && (task.type === "choice" ? choice != null : task.type === "order" ? order.length > 0 : text.trim().length > 0);
  const scope = task.scope === "book" ? "по всей книге" : task.scope === "group" ? "по нескольким районам" : "по этому району";
  return (
    <div className="task-view">
      <button className="ghost sm" onClick={onBack}>‹ К районам</button>
      <div className="muted" style={{ margin: ".4rem 0 .2rem" }}>Район {task.index + 1}: {district?.title} <span>{district?.verses}</span> · задание {scope}</div>
      <p className="prompt">{task.prompt}</p>
      {done ? (
        <div className="note ok">Выполнено. Буква шифра: <strong>{fragment}</strong></div>
      ) : (
        <>
          {task.type === "number" && <input type="number" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} placeholder="Число" />}
          {task.type === "text" && <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ответ" autoComplete="off" />}
          {task.type === "choice" && (
            <ul className="choices">
              {task.options.map((o, i) => <li key={i} className={choice === i ? "on" : ""} onClick={() => setChoice(i)}><span className="radio" />{o}</li>)}
            </ul>
          )}
          {task.type === "order" && <SortableList ids={order} onChange={setOrder} render={(id) => <div className="d-title">{itemText.get(id)}</div>} />}
          <div className="actions">
            <button disabled={!canSend} onClick={() => void onAnswer(value)}>{cooldown > 0 ? `Подождите ${cooldown} с` : "Ответить"}</button>
          </div>
        </>
      )}
    </div>
  );
}
