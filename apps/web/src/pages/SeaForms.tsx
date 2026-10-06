import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";

/**
 * Формы вахт моря (решение владельца 06.10): маяк, сигнальные флаги, курс по словам, показанный отрывок.
 * Данные каждой формы приходят с сервера и у каждой команды свои; формы ничего не проверяют сами — только собирают ответ.
 */

/* ---------- Маяк ---------- */
/**
 * Маяк мигает циклами: долгие вспышки — десятки, короткие — единицы (номер стиха). Между десятками и единицами —
 * пауза, между циклами — длинная пауза. Сигнал нельзя снять с экрана одним снимком: его надо досмотреть.
 */
export function Beacon({ signal }: { signal: { long: number; short: number } }) {
  const [on, setOn] = useState(false);
  const [kind, setKind] = useState<"long" | "short">("long");
  useEffect(() => {
    let alive = true, timer = 0;
    const steps: Array<[boolean, number, "long" | "short"]> = [];
    for (let i = 0; i < signal.long; i++) steps.push([true, 900, "long"], [false, 450, "long"]);
    steps.push([false, 900, "short"]);
    for (let i = 0; i < signal.short; i++) steps.push([true, 280, "short"], [false, 450, "short"]);
    steps.push([false, 2600, "long"]);
    let i = 0;
    const tick = () => {
      if (!alive) return;
      const [lit, ms, k] = steps[i % steps.length]!;
      setOn(lit); setKind(k); i++;
      timer = window.setTimeout(tick, ms);
    };
    tick();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [signal.long, signal.short]);
  return (
    <div className={"beacon" + (on ? " on" : "") + (kind === "short" ? " short" : "")} aria-label={t("Маяк мигает: долгие вспышки — десятки, короткие — единицы")}>
      <svg viewBox="0 0 160 200" aria-hidden="true">
        <defs>
          <radialGradient id="beacon-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#fff4c2" stopOpacity="1" /><stop offset=".4" stopColor="#ffd86b" stopOpacity=".6" /><stop offset="1" stopColor="#ffd86b" stopOpacity="0" /></radialGradient>
        </defs>
        <ellipse className="sea" cx="80" cy="190" rx="78" ry="9" />
        <path className="rock" d="M28 190c6-18 20-26 52-26s46 8 52 26Z" />
        <path className="tower" d="M62 168 70 60h20l8 108Z" />
        <path className="band" d="M66 122h28l1 10H65Z" />
        <path className="band" d="M69 92h22l1 10H68Z" />
        <rect className="gallery" x="60" y="52" width="40" height="8" rx="2" />
        <rect className="lamp-room" x="68" y="34" width="24" height="20" rx="2" />
        <path className="roof" d="M64 34h32l-16-14Z" />
        <circle className="glow" cx="80" cy="44" r="46" fill="url(#beacon-glow)" />
        <circle className="lamp" cx="80" cy="44" r="7" />
        <path className="beam left" d="M72 44 0 20v48Z" />
        <path className="beam right" d="M88 44 160 20v48Z" />
      </svg>
      <p className="small muted beacon-hint"><Icon name="lighthouse" />{t("Долгая вспышка — десять, короткая — один. Пауза отделяет десятки от единиц; длинная пауза — конец цикла.")}</p>
    </div>
  );
}

/* ---------- Сигнальные флаги ---------- */
export function Flag({ pattern, colors, size = 44 }: { pattern: string; colors: string[]; size?: number }) {
  const [a, b] = [colors[0] ?? "#c0392b", colors[1] ?? "#f8f1e0"];
  const w = size, h = Math.round(size * 0.78);
  let body: React.ReactNode;
  switch (pattern) {
    case "halves-h": body = <><rect width={w} height={h / 2} fill={a} /><rect y={h / 2} width={w} height={h / 2} fill={b} /></>; break;
    case "halves-v": body = <><rect width={w / 2} height={h} fill={a} /><rect x={w / 2} width={w / 2} height={h} fill={b} /></>; break;
    case "cross": body = <><rect width={w} height={h} fill={b} /><rect x={w * 0.4} width={w * 0.2} height={h} fill={a} /><rect y={h * 0.38} width={w} height={h * 0.24} fill={a} /></>; break;
    case "diagonal": body = <><rect width={w} height={h} fill={b} /><path d={`M0 0H${w}V${h}Z`} fill={a} /></>; break;
    case "circle": body = <><rect width={w} height={h} fill={b} /><circle cx={w / 2} cy={h / 2} r={h * 0.3} fill={a} /></>; break;
    case "checker": body = <><rect width={w} height={h} fill={b} /><rect width={w / 2} height={h / 2} fill={a} /><rect x={w / 2} y={h / 2} width={w / 2} height={h / 2} fill={a} /></>; break;
    case "triangle": body = <><rect width={w} height={h} fill={b} /><path d={`M0 0L${w * 0.62} ${h / 2}L0 ${h}Z`} fill={a} /></>; break;
    case "stripes": body = <><rect width={w} height={h} fill={b} /><rect width={w} height={h / 3} fill={a} /><rect y={(h * 2) / 3} width={w} height={h / 3} fill={a} /></>; break;
    case "border": body = <><rect width={w} height={h} fill={a} /><rect x={w * 0.2} y={h * 0.2} width={w * 0.6} height={h * 0.6} fill={b} /></>; break;
    default: body = <><rect width={w} height={h} fill={b} /><path d={`M${w / 2} ${h * 0.12}L${w * 0.86} ${h / 2}L${w / 2} ${h * 0.88}L${w * 0.14} ${h / 2}Z`} fill={a} /></>;
  }
  return <svg className="flag" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">{body}<rect width={w} height={h} fill="none" stroke="rgba(0,0,0,.45)" /></svg>;
}

/** Сообщение флагами и азбука команды: цифра → флаг. У каждой команды своя азбука и свои цвета. */
export function SignalFlags({ message, keyChart }: { message: Array<{ pattern: string; colors: string[] } | null>; keyChart: Array<{ digit: number; pattern: string; colors: string[] }> }) {
  return (
    <div className="signal">
      <div className="signal-line" aria-label={t("Сообщение флагами")}>
        <span className="halyard" aria-hidden="true" />
        {message.map((f, i) => (f ? <span key={i} className="hoist"><Flag pattern={f.pattern} colors={f.colors} size={52} /></span> : <span key={i} className="gap" aria-hidden="true">:</span>))}
      </div>
      <p className="small muted">{t("Азбука флагов вашей команды")}</p>
      <div className="signal-key">
        {keyChart.map((k) => <span key={k.digit} className="key-item"><Flag pattern={k.pattern} colors={k.colors} size={36} /><b>{k.digit}</b></span>)}
      </div>
    </div>
  );
}

/* ---------- Курс по словам ---------- */
/**
 * Сетка слов: участник нажимает слова стиха по порядку; каждое следующее — в соседней клетке. Нажатие на последнее
 * выбранное слово снимает его. Проверяет сервер.
 */
export function WordPath({ rows, cols, cells, count, value, onChange, disabled }: { rows: number; cols: number; cells: Array<{ id: string; text: string }>; count: number; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const pos = new Map(cells.map((c, i) => [c.id, i]));
  const last = value[value.length - 1];
  const adjacent = (a: string, b: string) => { const i = pos.get(a)!, j = pos.get(b)!; const ri = Math.floor(i / cols), ci = i % cols, rj = Math.floor(j / cols), cj = j % cols; return Math.abs(ri - rj) + Math.abs(ci - cj) === 1; };
  const tap = (id: string) => {
    if (disabled) return;
    if (id === last) { onChange(value.slice(0, -1)); return; }
    if (value.includes(id)) return;
    if (last && !adjacent(last, id)) return;
    if (value.length >= count) return;
    onChange([...value, id]);
  };
  return (
    <div className="wordpath">
      <div className="wp-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} role="group" aria-label={t("Карта слов")}>
        {cells.map((c) => {
          const k = value.indexOf(c.id);
          const next = !disabled && value.length < count && (k < 0) && (!last || adjacent(last, c.id));
          return (
            <button key={c.id} type="button" className={"wp-cell" + (k >= 0 ? " on" : "") + (c.id === last ? " last" : "") + (next ? " can" : "")} onClick={() => tap(c.id)} disabled={disabled} aria-pressed={k >= 0}>
              <span className="w">{c.text}</span>
              {k >= 0 && <span className="n">{k + 1}</span>}
            </button>
          );
        })}
      </div>
      <div className="row between nowrap mt-2">
        <span className="small muted">{t("Выбрано слов: {a} из {b}", { a: value.length, b: count })}</span>
        <button type="button" className="ghost sm" disabled={disabled || value.length === 0} onClick={() => onChange([])}><Icon name="refresh" />{t("Сначала")}</button>
      </div>
      <p className="small muted">{t("Нажмите на последнее выбранное слово, чтобы снять его.")}</p>
      {rows > 0 && null}
    </div>
  );
}

/* ---------- Показанный отрывок ---------- */
export function Passages({ items }: { items: Array<{ ref: string; verses: Array<{ n: number; text: string }> }> }) {
  if (!items.length) return null;
  return (
    <div className="passages no-copy" onCopy={(e) => e.preventDefault()}>
      {items.map((p) => (
        <section key={p.ref} className="passage">
          <h4><Icon name="book" />{p.ref}</h4>
          {p.verses.map((v) => <p key={v.n}><sup>{v.n}</sup> {v.text}</p>)}
        </section>
      ))}
    </div>
  );
}
