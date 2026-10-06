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

/* ---------- Сигнальные вымпелы ---------- */
/** Рисунки вымпелов: десять, в духе морских цифровых вымпелов; какой цифре какой — у каждой команды по-своему. */
const RED = "#b8312f", BLUE = "#1f4e8c", YEL = "#e9b949", WHT = "#f6f1e4", BLK = "#2a2a2a";
export function Flag({ pattern, size = 56 }: { pattern: string; size?: number }) {
  const w = size * 1.5, h = size * 0.8;
  // Вымпел: сужается к правому концу; рисунок обрезан по его контуру.
  const shape = `M0 0H${w * 0.55}L${w} ${h / 2}L${w * 0.55} ${h}H0Z`;
  const id = `pf-${pattern}-${size}`;
  let body: React.ReactNode;
  const thirds = (a: string, b: string, c: string) => <><rect width={w / 3} height={h} fill={a} /><rect x={w / 3} width={w / 3} height={h} fill={b} /><rect x={(2 * w) / 3} width={w / 3} height={h} fill={c} /></>;
  switch (pattern) {
    case "disc-red": body = <><rect width={w} height={h} fill={WHT} /><circle cx={w * 0.3} cy={h / 2} r={h * 0.28} fill={RED} /></>; break;
    case "disc-white": body = <><rect width={w} height={h} fill={BLUE} /><circle cx={w * 0.3} cy={h / 2} r={h * 0.28} fill={WHT} /></>; break;
    case "thirds-rwb": body = thirds(RED, WHT, BLUE); break;
    case "cross-red": body = <><rect width={w} height={h} fill={RED} /><rect x={w * 0.22} width={w * 0.14} height={h} fill={WHT} /><rect y={h * 0.4} width={w} height={h * 0.2} fill={WHT} /></>; break;
    case "halves-yb": body = <><rect width={w / 2} height={h} fill={YEL} /><rect x={w / 2} width={w / 2} height={h} fill={BLUE} /></>; break;
    case "halves-bw": body = <><rect width={w} height={h / 2} fill={BLK} /><rect y={h / 2} width={w} height={h / 2} fill={WHT} /></>; break;
    case "halves-yr": body = <><rect width={w / 2} height={h} fill={YEL} /><rect x={w / 2} width={w / 2} height={h} fill={RED} /></>; break;
    case "cross-white": body = <><rect width={w} height={h} fill={WHT} /><rect x={w * 0.22} width={w * 0.14} height={h} fill={RED} /><rect y={h * 0.4} width={w} height={h * 0.2} fill={RED} /></>; break;
    case "quarters": body = <><rect width={w} height={h} fill={WHT} /><rect width={w / 2} height={h / 2} fill={BLK} /><rect x={w / 2} y={h / 2} width={w / 2} height={h / 2} fill={YEL} /><rect x={w / 2} width={w / 2} height={h / 2} fill={RED} /></>; break;
    default: body = thirds(YEL, RED, YEL);
  }
  return (
    <svg className="flag" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs><clipPath id={id}><path d={shape} /></clipPath></defs>
      <g clipPath={`url(#${id})`}>{body}<rect width={w} height={h} fill="url(#flag-shade)" /></g>
      <path d={shape} fill="none" stroke="rgba(30,25,20,.55)" strokeWidth={1.2} />
      <rect x={0} y={-1} width={3} height={h + 2} fill="rgba(60,45,30,.8)" />
    </svg>
  );
}

/**
 * Сигналы на фалах: подписанные (известные ссылки) и последний без подписи. Азбуку команда восстанавливает сама.
 */
export function SignalFlags({ cribs, message }: { cribs: Array<{ label: string; flags: Array<string | null> }>; message: Array<string | null> }) {
  const hoist = (flags: Array<string | null>, size: number) => flags.map((f, i) => (f ? <span key={i} className="hoist"><Flag pattern={f} size={size} /></span> : <span key={i} className="gap" aria-hidden="true">:</span>));
  return (
    <div className="signal">
      <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}><defs><linearGradient id="flag-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".22" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".22" /></linearGradient></defs></svg>
      <p className="small muted">{t("Известные сигналы")}</p>
      <ul className="signal-cribs">
        {cribs.map((c) => (
          <li key={c.label}><span className="crib-label">{c.label}</span><span className="signal-line small">{hoist(c.flags, 34)}</span></li>
        ))}
      </ul>
      <p className="small muted">{t("Сигнал без подписи")}</p>
      <div className="signal-line main" aria-label={t("Сообщение вымпелами")}>
        <span className="halyard" aria-hidden="true" />
        {hoist(message, 52)}
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
