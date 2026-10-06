import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import type { PanelStateDto, SeaChartDto, SeaTaskDto } from "../lib/api";
import { CHART_H, CHART_W, SeaChart, seaImg } from "./SeaForms";

/**
 * Формы вахт моря, вторая половина: пеленги (командная), счисление пути, разгрузка, прибор и устав (командная),
 * судовая роль. Как и в SeaForms: формы только собирают ответ, проверяет сервер.
 */

/* ---------- Пеленги ---------- */
const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;
/** Линия пеленга: от ориентира под углом (от норда по часовой) до края карты. */
function bearingLine(from: { x: number; y: number }, deg: number) {
  const dx = Math.cos(toRad(deg)), dy = Math.sin(toRad(deg));
  let k = 200;
  for (const [p, d, lo, hi] of [[from.x, dx, 0, CHART_W], [from.y, dy, 0, CHART_H]] as const) {
    if (d > 0) k = Math.min(k, (hi - p) / d); else if (d < 0) k = Math.min(k, (lo - p) / d);
  }
  return { x2: from.x + dx * k, y2: from.y + dy * k };
}
export function Bearings({ code, chart, task }: { code: string; chart: SeaChartDto; task: Extract<SeaTaskDto, { type: "bearings" }> }) {
  const mine = task.screens;
  const [lines, setLines] = useState<Record<string, number>>({});
  const [sel, setSel] = useState<string | null>(null);
  const places = chart.places.filter((p) => task.landmarks.includes(p.id));
  return (
    <div className="bearings">
      {mine.includes("map") && (
        <>
          <SeaChart code={code} chart={chart} grid={task.grid} letters={task.letters}>
            {places.map((p) => { const b = lines[p.id]; if (b == null) return null; const e = bearingLine(p, b); return <line key={p.id} className="c-bearing" x1={p.x} y1={p.y} x2={e.x2} y2={e.y2} />; })}
            {places.map((p) => <circle key={p.id} className={"c-landmark" + (sel === p.id ? " sel" : "")} cx={p.x} cy={p.y} r="2" onPointerDown={() => setSel(p.id)} />)}
          </SeaChart>
          <div className="bearing-tools">
            {places.map((p) => (
              <label key={p.id} className={"row nowrap" + (sel === p.id ? " sel" : "")}>
                <span className="nm" onClick={() => setSel(p.id)}>{p.name}</span>
                <input type="number" inputMode="numeric" min={0} max={359} placeholder="°" value={lines[p.id] ?? ""} onChange={(e) => { const v = e.target.value; setLines((l) => { const n = { ...l }; if (v === "") delete n[p.id]; else n[p.id] = Math.max(0, Math.min(359, Number(v))); return n; }); }} aria-label={t("Пеленг от {name}", { name: p.name })} />
              </label>
            ))}
            <p className="small muted">{t("Введите пеленг от ориентира — на карте появится линия. Там, где линии сойдутся, стоит цель; её клетку называет капитан.")}</p>
          </div>
        </>
      )}
      {mine.includes("table") && (
        <div className="bearing-table">
          <p className="small muted">{t("Таблица пеленгов (от норда по часовой стрелке)")}</p>
          <ul>{task.bearings.map((b) => <li key={b.name}><span className="nm">{b.name}</span><b>{b.bearing}°</b></li>)}</ul>
          {task.hint && <p className="small"><Icon name="hint" />{task.hint}</p>}
        </div>
      )}
      {mine.includes("input") && (
        <div className="bearing-rose">
          <img src={seaImg("common/rose")} alt="" draggable={false} />
          <p className="small muted">{t("Клетки: столбцы {letters}, строки 1–{rows}. Введите клетку, где сошлись пеленги, например «{ex}».", { letters: task.letters.split("").join(" "), rows: task.grid.rows, ex: `${task.letters[2] ?? task.letters[0]}3` })}</p>
        </div>
      )}
    </div>
  );
}

/* ---------- Счисление пути ---------- */
export function Reckoning({ code, chart, task, points, onChange, disabled }: { code: string; chart: SeaChartDto; task: Extract<SeaTaskDto, { type: "reckoning" }>; points: Array<{ x: number; y: number }>; onChange: (p: Array<{ x: number; y: number }>) => void; disabled?: boolean }) {
  const [leg, setLeg] = useState(0);
  const [shown, setShown] = useState(true);
  useEffect(() => { setShown(true); const tm = setTimeout(() => setShown(false), 8000); return () => clearTimeout(tm); }, [leg]);
  const path = [{ x: task.start.x, y: task.start.y }, ...points];
  const segInfo = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ course: Math.round(((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI + 360) % 360), miles: Math.hypot(b.x - a.x, b.y - a.y) / task.mile });
  const last = path.length > 1 ? segInfo(path[path.length - 2]!, path[path.length - 1]!) : null;
  const cur = task.legs[leg]!;
  return (
    <div className="reckoning">
      <div className="journal">
        <p className="small muted">{t("Судовой журнал · переход {a} из {b}", { a: leg + 1, b: task.legs.length })}</p>
        {shown ? <p className="leg"><b>{t("Курс {c}°, {m} миль", { c: cur.course, m: cur.miles })}</b><br /><span className="small">{cur.label}</span></p> : <p className="leg faded small muted">{t("Запись скрыта: показывайте переходы по одному и прокладывайте путь.")}</p>}
        <div className="row between nowrap">
          <button type="button" className="ghost sm" disabled={leg === 0} onClick={() => setLeg((l) => l - 1)}><Icon name="back" />{t("Предыдущий")}</button>
          <button type="button" className="ghost sm" onClick={() => setShown(true)}><Icon name="eye" />{t("Показать")}</button>
          <button type="button" className="ghost sm" disabled={leg + 1 >= task.legs.length} onClick={() => setLeg((l) => l + 1)}>{t("Следующий")}<Icon name="chevron" /></button>
        </div>
      </div>
      <SeaChart code={code} chart={chart} onTap={disabled ? undefined : (p) => onChange([...points, p])}>
        <g className="c-scale"><line x1={3} y1={CHART_H - 3} x2={3 + task.mile * 5} y2={CHART_H - 3} />{Array.from({ length: 6 }, (_, i) => <line key={i} x1={3 + task.mile * i} y1={CHART_H - 4.2} x2={3 + task.mile * i} y2={CHART_H - 1.8} />)}<text x={3} y={CHART_H - 5}>{t("5 миль")}</text></g>
        <polyline className="c-track" points={path.map((p) => `${p.x},${p.y}`).join(" ")} />
        {path.map((p, i) => <circle key={i} className={"c-fix" + (i === 0 ? " start" : "")} cx={p.x} cy={p.y} r={i === 0 ? 1.6 : 1.2} />)}
        {last && path.length > 1 && (() => { const a = path[path.length - 2]!, b = path[path.length - 1]!; const r = 9; return <g className="c-protractor" transform={`translate(${a.x} ${a.y})`}><circle r={r} /><line x1={0} y1={-r} x2={0} y2={-r + 2} /><line x1={0} y1={0} x2={(b.x - a.x) * 0.9} y2={(b.y - a.y) * 0.9} /></g>; })()}
      </SeaChart>
      <div className="row between nowrap">
        <span className="small">{last ? t("Последний отрезок: курс {c}°, {m} миль", { c: last.course, m: last.miles.toFixed(1) }) : t("Начало: {name}. Нажмите на карту, чтобы отложить первый переход.", { name: task.start.name })}</span>
        <button type="button" className="ghost sm" disabled={disabled || !points.length} onClick={() => onChange(points.slice(0, -1))}><Icon name="back" />{t("Отменить")}</button>
      </div>
      <p className="small muted">{task.question} {t("Ответом станет последняя точка пути.")}</p>
    </div>
  );
}

/* ---------- Разгрузка ---------- */
type Cell = [number, number];
const DIRS: Record<string, Cell> = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
/** Та же модель, что на сервере: прогон ходов от начальной карты; возвращает состояние и нарушение порядка. */
export function runUnload(map: string[], order: string[], kinds: Record<string, unknown>, moves: string) {
  const walls = new Set<string>(); const boxes = new Map<string, string>(); const targets = new Map<string, string>(); let pl: Cell = [0, 0];
  const key = (x: number, y: number) => `${x},${y}`;
  map.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === "#") walls.add(key(x, y)); else if (ch === "@") pl = [x, y]; else if (ch in kinds) boxes.set(key(x, y), ch); else if (ch.toLowerCase() in kinds && ch !== ch.toLowerCase()) targets.set(key(x, y), ch.toLowerCase()); }));
  const kindList = Object.keys(kinds);
  const doneKinds = () => kindList.filter((k) => [...targets].filter(([, kk]) => kk === k).every(([p]) => boxes.get(p) === k));
  let stage = 0, broken = false;
  for (const m of moves) {
    const d = DIRS[m]; if (!d) continue;
    const nx = pl[0] + d[0], ny = pl[1] + d[1];
    if (walls.has(key(nx, ny))) continue;
    if (boxes.has(key(nx, ny))) { const tx = nx + d[0], ty = ny + d[1]; if (walls.has(key(tx, ty)) || boxes.has(key(tx, ty))) continue; boxes.set(key(tx, ty), boxes.get(key(nx, ny))!); boxes.delete(key(nx, ny)); }
    pl = [nx, ny];
    const done = doneKinds();
    if (stage < order.length && done.includes(order[stage]!)) stage++;
    if (order.slice(stage).some((k) => done.includes(k))) { broken = true; break; }
  }
  const complete = !broken && stage === order.length && [...targets].every(([p, k]) => boxes.get(p) === k);
  return { walls, boxes, targets, pl, stage, broken, complete };
}
export function Unload({ code, task, moves, onChange, disabled }: { code: string; task: Extract<SeaTaskDto, { type: "unload" }>; moves: string; onChange: (m: string) => void; disabled?: boolean }) {
  const st = useMemo(() => runUnload(task.map, task.order, task.kinds, moves), [task, moves]);
  const rows = task.map.length, cols = task.map[0]!.length;
  const touch = useRef<{ x: number; y: number } | null>(null);
  const step = (d: string) => {
    if (disabled || st.complete) return;
    const next = runUnload(task.map, task.order, task.kinds, moves + d);
    if (next.broken) { onChange(moves); setFlash(true); setTimeout(() => setFlash(false), 600); return; }
    onChange(moves + d);
  };
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const m = ({ ArrowUp: "U", ArrowDown: "D", ArrowLeft: "L", ArrowRight: "R" } as Record<string, string>)[e.key]; if (m) { e.preventDefault(); step(m); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  const key = (x: number, y: number) => `${x},${y}`;
  return (
    <div className={"unload" + (flash ? " broken" : "")}>
      <div className="unload-board" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, backgroundImage: `url(${seaImg(`${code}/deck`)})` }}
        onPointerDown={(e) => { touch.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => { const s = touch.current; touch.current = null; if (!s) return; const dx = e.clientX - s.x, dy = e.clientY - s.y; if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return; step(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy > 0 ? "D" : "U"); }}>
        {task.map.map((row, y) => [...row].map((ch, x) => {
          const k = key(x, y);
          const wall = st.walls.has(k), target = st.targets.get(k), box = st.boxes.get(k), sailor = st.pl[0] === x && st.pl[1] === y;
          return (
            <div key={k} className={"cell" + (wall ? " wall" : "") + (target ? " target" : "")} title={target ? task.kinds[target]?.name : undefined}>
              {target && !box && <span className="tg">{task.kinds[target]?.name}</span>}
              {box && <img src={seaImg(`sprites/${task.kinds[box]!.sprite}`)} alt={task.kinds[box]!.name} draggable={false} className={target === box ? "placed" : ""} />}
              {sailor && <img src={seaImg("sprites/sailor")} alt="" draggable={false} className="sailor" />}
              {ch === "" ? null : null}
            </div>
          );
        }))}
      </div>
      <div className="row between nowrap">
        <ol className="unload-order small">{task.order.map((k, i) => <li key={k} className={i < st.stage ? "done" : i === st.stage ? "cur" : ""}>{task.kinds[k]?.name}</li>)}</ol>
        <span className="row nowrap">
          <button type="button" className="ghost sm" disabled={disabled || !moves} onClick={() => onChange(moves.slice(0, -1))}><Icon name="back" />{t("Шаг назад")}</button>
          <button type="button" className="ghost sm" disabled={disabled || !moves} onClick={() => onChange("")}><Icon name="refresh" /></button>
        </span>
      </div>
      <div className="dpad" aria-label={t("Ходить")}>
        <button type="button" onClick={() => step("U")} aria-label={t("Вверх")}>▲</button>
        <div><button type="button" onClick={() => step("L")} aria-label={t("Влево")}>◀</button><button type="button" onClick={() => step("D")} aria-label={t("Вниз")}>▼</button><button type="button" onClick={() => step("R")} aria-label={t("Вправо")}>▶</button></div>
      </div>
      <p className="small muted">{st.complete ? t("Все тюки на местах в правильном порядке. Сдайте вахту.") : flash ? t("Нарушен порядок: этот тюк рано ставить на место.") : t("Ходов: {n}. Свайп по палубе, стрелки или кнопки.", { n: moves.length })}</p>
    </div>
  );
}

/* ---------- Прибор и устав ---------- */
const PENNANT: Record<PanelStateDto["pennant"], string> = { red: "#B8312F", white: "#F3EEE2", blue: "#1F4E8C", yellow: "#E9B949" };
function Lantern({ n }: { n: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true, timer = 0, i = 0;
    const steps: Array<[boolean, number]> = [];
    for (let k = 0; k < n; k++) steps.push([true, 350], [false, 450]);
    steps.push([false, 2200]);
    const tick = () => { if (!alive) return; const [lit, ms] = steps[i % steps.length]!; setOn(lit); i++; timer = window.setTimeout(tick, ms); };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [n]);
  return <span className={"lantern" + (on ? " on" : "")} aria-label={t("Фонарь")} />;
}
export function Panel({ task }: { task: Extract<SeaTaskDto, { type: "panel" }> }) {
  const mine = task.screens;
  const s = task.state;
  const needleDeg = s ? { N: 0, E: 90, S: 180, W: 270 }[s.needle] : 0;
  return (
    <div className="panel-watch">
      <p className="small muted">{t("Раунд {a} из {b}", { a: task.round + 1, b: task.rounds })}</p>
      {mine.includes("panel") && s && (
        <div className="brass" style={{ backgroundImage: `url(${seaImg("common/panel")})` }} aria-label={t("Панель кормчего")}>
          <div className="gauge pennant"><svg viewBox="0 0 60 44"><path d="M4 4h44l-8 18 8 18H4Z" fill={PENNANT[s.pennant]} stroke="rgba(0,0,0,.45)" /><rect x="2" y="2" width="3" height="40" fill="#5a4630" /></svg></div>
          <div className="gauge lamp"><Lantern n={s.flashes} /></div>
          <div className="gauge symbol"><Icon name={s.symbol} /></div>
          <div className="gauge compass"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" fill="#f3eadb" stroke="#5a4630" strokeWidth="2" /><text x="30" y="11" textAnchor="middle" fontSize="8" fill="#3a2f21">N</text><text x="52" y="33" textAnchor="middle" fontSize="8" fill="#3a2f21">E</text><text x="30" y="56" textAnchor="middle" fontSize="8" fill="#3a2f21">S</text><text x="8" y="33" textAnchor="middle" fontSize="8" fill="#3a2f21">W</text><g transform={`rotate(${needleDeg} 30 30)`}><path d="M30 8l4 22-4 4-4-4Z" fill="#B8312F" /><path d="M30 52l-4-22 4-4 4 4Z" fill="#3a2f21" /></g></svg></div>
        </div>
      )}
      {mine.includes("panel") && <p className="small muted">{t("Опишите приборы словами: цвет вымпела, сколько раз мигает фонарь, знак на табличке, куда смотрит стрелка. Устав у команды, ответ у капитана.")}</p>}
      {mine.includes("manual") && task.manual && (
        <div className="manual" style={{ backgroundImage: `url(${seaImg("common/page")})` }}>
          <h4><Icon name="scroll" />{t("Устав кормчего")}</h4>
          <p className="small">{task.manual.intro}</p>
          <ol>{task.manual.rules.map((r, i) => <li key={i}>{r}</li>)}</ol>
        </div>
      )}
      {mine.includes("input") && <p className="small muted">{t("Капитан вводит слово из стиха, которое назвала команда по уставу.")}</p>}
    </div>
  );
}

/* ---------- Судовая роль ---------- */
export type RosterState = Record<string, { who: string; then: string }>;
export function Roster({ task, state, onChange, disabled, justConfirmed }: { task: Extract<SeaTaskDto, { type: "roster" }>; state: RosterState; onChange: (s: RosterState) => void; disabled?: boolean; justConfirmed: string[] }) {
  return (
    <div className="roster">
      {task.cards.map((c) => {
        const v = c.confirmed ?? state[c.id] ?? { who: "", then: "" };
        const locked = Boolean(c.confirmed);
        return (
          <div key={c.id} className={"card" + (locked ? " confirmed" : "") + (justConfirmed.includes(c.id) ? " just" : "")}>
            <div className="figure" style={{ backgroundImage: `url(${seaImg(`figures/${c.figure}`)})` }} aria-hidden="true" />
            <div className="body">
              <p className="clue">{c.clue}</p>
              <label className="small muted">{t("Кто это")}
                <select value={v.who} disabled={disabled || locked} onChange={(e) => onChange({ ...state, [c.id]: { ...v, who: e.target.value } })}>
                  <option value="">—</option>{task.whos.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </label>
              <label className="small muted">{t("Что было дальше")}
                <select value={v.then} disabled={disabled || locked} onChange={(e) => onChange({ ...state, [c.id]: { ...v, then: e.target.value } })}>
                  <option value="">—</option>{task.thens.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </label>
              {locked && <span className="small ok"><Icon name="check" />{t("подтверждено")}</span>}
            </div>
          </div>
        );
      })}
      <p className="small muted">{t("Подтверждаются сразу три верные карточки: заполните хотя бы три, в которых уверены, и проверьте.")}</p>
    </div>
  );
}
