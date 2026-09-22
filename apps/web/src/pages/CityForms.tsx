import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "../lib/i18n";
import { fmtDate, fmtLeft } from "../lib/format";
import { Icon } from "../components/Icon";
import { Help } from "../components/Help";
import { SortableList } from "./SortableList";
import type { CrosswordWordDto } from "../lib/api";

/**
 * Формы заданий города (решения владельца 18.09, глава 5 отчёта): замок с кольцами для «по порядку» (C-01),
 * замок с одним кольцом для выбора (вместо весов: решение владельца 18.09), печать из знаков шифра (C-05), конверт с сургучом (C-06), обгоревший свиток для
 * пропуска в цитате (C-08), кроссворд (C-09), остывающая отмычка (C-14) и свеча пророка (C-15).
 * Все формы — только оформление тех же запросов: до ответа сервера ничего не «реагирует» на выбор.
 */

/* ---------- Замок с кольцами ---------- */

/**
 * Кольца замка: столько колец, сколько позиций. Стрелка листает барабан кольца по исходному (перетасованному)
 * списку; пункт, стоявший на другом кольце, меняется местами с текущим — так порядок всегда остаётся перестановкой.
 * «Список» — простой вид с перетаскиванием для длинных списков.
 */
/** Дужка навесного замка: П-образная скоба из стали, пятка (правая нога) длиннее носка, тень и блик — как у настоящего замка. */
function Shackle() {
  return (
    <div className="shackle" aria-hidden="true">
      <svg viewBox="0 0 160 118">
        <defs>
          <linearGradient id="shk" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#5C5A57" /><stop offset=".28" stopColor="#D9D6D0" /><stop offset=".55" stopColor="#8E8B86" /><stop offset=".8" stopColor="#C9C5BE" /><stop offset="1" stopColor="#55534F" />
          </linearGradient>
        </defs>
        <path className="shk-shadow" d="M36 118V62a44 44 0 0 1 88 0v56" />
        <path className="shk-base" d="M34 116V60a44 44 0 0 1 88 0v56" />
        <path className="shk-body" d="M34 116V60a44 44 0 0 1 88 0v56" />
        <path className="shk-hi" d="M40 108V60a38 38 0 0 1 76 0v8" />
      </svg>
    </div>
  );
}

/** hint — короткая строка состояния под шапкой замка; help — инструкция «за кнопкой» рядом со словом «Замок»; tools — кнопки справа (переключатель пересказа). */
export function LockRings({ ids, labels, sub, onChange, disabled, state, pinsWrong, strips, hint, help, tools }: { ids: string[]; labels: Map<string, string>; sub?: Map<string, string>; onChange: (ids: string[]) => void; disabled?: boolean; state: "idle" | "open" | "jam"; pinsWrong: number | null; strips?: boolean; hint?: string; help?: string; tools?: ReactNode }) {
  const [simple, setSimple] = useState(false);
  const [spin, setSpin] = useState<{ k: number; dir: 1 | -1 } | null>(null);
  const n = ids.length;
  /** Стрелка двигает саму строку: вверх — меняется местами с соседом выше, вниз — с соседом ниже (решение владельца 22.09:
   *  раньше кольцо листало «барабан», и пункт улетал в другое кольцо — это сбивало с толку). */
  const step = (k: number, dir: 1 | -1) => {
    if (disabled) return;
    const j = k + dir;
    if (j < 0 || j >= n) return;
    const out = ids.slice();
    out[k] = ids[j]!; out[j] = ids[k]!;
    setSpin({ k: j, dir });
    onChange(out);
  };
  useEffect(() => { if (!spin) return; const tm = setTimeout(() => setSpin(null), 220); return () => clearTimeout(tm); }, [spin]);
  const label = (id: string) => labels.get(id) ?? "";
  return (
    <div className={"lock" + (state === "open" ? " open" : state === "jam" ? " jam" : "") + (strips ? " strips" : "")}>
      <Shackle />
      <div className="lock-body">
        <div className="row between lock-top">
          <span className="strong"><Icon name="lock" />{t("Замок")}{help && <Help>{help}</Help>}</span>
          <span className="row nowrap lock-tools">{tools}<button type="button" className="ghost sm" onClick={() => setSimple((v) => !v)} aria-pressed={simple}>{simple ? t("Кольца") : t("Список")}</button></span>
        </div>
        {hint && <p className="hint">{hint}</p>}
        {simple ? (
          <SortableList ids={ids} onChange={onChange} disabled={disabled} render={(id) => <><div className="d-title">{label(id)}</div>{sub?.get(id) && <div className="d-sum muted">{sub.get(id)}</div>}</>} />
        ) : (
          <ol className="rings" aria-label={t("Кольца замка")}>
            {ids.map((id, k) => (
              <li key={id} className={"ring" + (spin?.k === k ? (spin.dir === 1 ? " spin-down" : " spin-up") : "")}>
                <span className="pos" aria-hidden="true">{k + 1}</span>
                <button type="button" className="ghost turn" disabled={disabled || k === 0} onClick={() => step(k, -1)} aria-label={t("Поднять «{v}» выше", { v: label(id) })}><Icon name="chevron-up" /></button>
                <div className="drum" role="group" aria-label={t("Кольцо {k}: {v}", { k: k + 1, v: label(id) })}>
                  <span className="cur">{label(id)}{sub?.get(id) && <small className="muted">{sub.get(id)}</small>}</span>
                </div>
                <button type="button" className="ghost turn" disabled={disabled || k === n - 1} onClick={() => step(k, 1)} aria-label={t("Опустить «{v}» ниже", { v: label(id) })}><Icon name="chevron-down" /></button>
              </li>
            ))}
          </ol>
        )}
        {pinsWrong != null && pinsWrong !== 0 && (
          <div className="pins" role="status">
            <span className="pin-row" aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} className={pinsWrong < 0 || i < pinsWrong ? "up" : ""} />)}</span>
            <span className="small">{pinsWrong < 0 ? t("Заклинило: порядок не тот.") : t("Не село штифтов: {n}.", { n: pinsWrong })}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Замок с одним кольцом: выбор ответа ---------- */

/**
 * Выбор ответа — тот же замок, но с одним кольцом: на барабане варианты, стрелки листают, «Провернуть замок»
 * отправляет показанный вариант. До ответа сервера замок ничем не выдаёт правильность; неверно — заклинило.
 */
export function LockChoice({ options, choice, onPick, disabled, state }: { options: string[]; choice: number | null; onPick: (i: number) => void; disabled?: boolean; state: "idle" | "open" | "jam" }) {
  const n = options.length;
  const cur = choice ?? 0;
  const [spin, setSpin] = useState<1 | -1 | null>(null);
  useEffect(() => { if (spin === null) return; const tm = setTimeout(() => setSpin(null), 220); return () => clearTimeout(tm); }, [spin]);
  const step = (dir: 1 | -1) => { if (disabled) return; setSpin(dir); onPick((cur + dir + n) % n); };
  return (
    <div className={"lock" + (state === "open" ? " open" : state === "jam" ? " jam" : "")}>
      <Shackle />
      <div className="lock-body">
        <div className="row between lock-top"><span className="strong"><Icon name="lock" />{t("Замок")}<Help>{t("Стрелки листают варианты. Верный на кольце — проверните замок.")}</Help></span><span className="small">{t("вариант {a} из {b}", { a: cur + 1, b: n })}</span></div>
        <ol className="rings" aria-label={t("Кольцо замка")}>
          <li className={"ring single" + (spin === 1 ? " spin-down" : spin === -1 ? " spin-up" : "")}>
            <span className="pos" aria-hidden="true"><Icon name="lock" /></span>
            <button type="button" className="ghost turn" disabled={disabled} onClick={() => step(-1)} aria-label={t("Предыдущий вариант")}><Icon name="chevron-up" /></button>
            <div className="drum" role="radiogroup" aria-label={t("Варианты ответа")}>
              <span className="ghost-item prev" aria-hidden="true">{options[(cur - 1 + n) % n]}</span>
              <span className="cur" role="radio" aria-checked="true">{options[cur]}</span>
              <span className="ghost-item next" aria-hidden="true">{options[(cur + 1) % n]}</span>
            </div>
            <button type="button" className="ghost turn" disabled={disabled} onClick={() => step(1)} aria-label={t("Следующий вариант")}><Icon name="chevron-down" /></button>
          </li>
        </ol>
        {state === "jam" && <div className="pins" role="status"><span className="pin-row" aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} className="up" />)}</span><span className="small">{t("Заклинило: ответ не тот.")}</span></div>}
      </div>
    </div>
  );
}

/* ---------- Печать из знаков шифра ---------- */

/** Круглая печать: секторов столько, сколько заданий; решённое задание выбивает свой знак в секторе (по часовой, как в правиле шифра). */
export function CipherSeal({ fragments, size = 148, struck, imprint, className }: { fragments: Array<string | null>; size?: number; struck?: number | null; imprint?: boolean; className?: string }) {
  const n = Math.max(fragments.length, 1);
  const R = 50, r = 33;
  const sectors = fragments.map((f, i) => {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const am = (a0 + a1) / 2;
    const p = (rr: number, a: number) => `${(50 + rr * Math.cos(a)).toFixed(2)} ${(50 + rr * Math.sin(a)).toFixed(2)}`;
    const large = 1 / n > 0.5 ? 1 : 0;
    const d = n === 1 ? `M50 ${50 - R} A${R} ${R} 0 1 1 49.99 ${50 - R} Z` : `M${p(R, a0)} A${R} ${R} 0 ${large} 1 ${p(R, a1)} L50 50 Z`;
    return { d, f, x: 50 + ((R + r) / 2) * Math.cos(am), y: 50 + ((R + r) / 2) * Math.sin(am) };
  });
  const done = fragments.filter(Boolean).length;
  return (
    <span className={"seal-wrap" + (imprint ? " imprint" : "") + (className ? " " + className : "")} style={{ width: size, height: size }}>
      {imprint && <><i className="wax-color" /><i className="wax-relief" /></>}
      <svg className={"seal" + (imprint ? " imprint" : "") + (className ? " " + className : "")} viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={t("Печать города: знаков {a} из {b}", { a: done, b: n })}>
        <circle className="rim" cx="50" cy="50" r="49" />
        {sectors.map((s, i) => <path key={i} className={"sector" + (s.f ? " on" : "") + (struck === i ? " struck" : "")} d={s.d} />)}
        {sectors.map((s, i) => <text key={"t" + i} className={"glyph" + (s.f ? " on" : "")} x={s.x} y={s.y} textAnchor="middle" dominantBaseline="central" fontSize={n > 12 ? 8 : n > 8 ? 10 : 12}>{s.f ?? ""}</text>)}
        <circle className="core" cx="50" cy="50" r={r - 2} />
        <text className="core-text" x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="11">{done}/{n}</text>
      </svg>
    </span>
  );
}

/* ---------- Конверт с сургучом ---------- */

export interface EnvelopeProps {
  fragments: Array<string | null>;
  cipher: string;
  recipientText: string;
  /** Правило шифра города — под «?» рядом с шифром. */
  codeRule?: string;
  keyValue: string;
  onKey: (v: string) => void;
  onBreak: () => void;
  busy: boolean;
  cooldown: number;
  ruined: boolean;
  result: "ok" | "bad" | null;
  /** Город уже взят вашей командой: грамота. */
  captured: { isCapital: boolean; secondCapital: boolean } | null;
  /** Город занят другой командой: печать уже сломана. */
  ownedBy: { name: string; color: string } | null;
}

/**
 * Конверт с сургучной печатью (оттиск — печать шифра), шифр для адресата, шесть ячеек ключа и кнопка «Сломать печать».
 * Успех после ответа сервера: сургуч трескается, из конверта выезжает грамота. Руины: печать сухая, ломается без ключа.
 */
export function WaxEnvelope(p: EnvelopeProps) {
  const cells = 6;
  const chars = Array.from({ length: cells }, (_, i) => p.keyValue[i] ?? "");
  const cls = "envelope" + (p.result === "ok" || p.captured ? " broken" : "") + (p.result === "bad" ? " scratched" : "") + (p.ruined ? " dry" : "") + (p.ownedBy ? " taken" : "");
  return (
    <div className={cls}>
      <div className="paper" aria-hidden="true">
        <div className="flap" />
        <div className="wax" style={p.ownedBy ? { ["--wax" as string]: p.ownedBy.color } : undefined}><CipherSeal fragments={p.fragments} size={86} imprint /></div>
      </div>
      {p.captured ? (
        <div className="charter" role="status">
          <div className="crowns" aria-hidden="true">{p.captured.isCapital && <Icon name="crown" />}{p.captured.secondCapital && <Icon name="crown" />}</div>
          <div className="strong">{t("Город ваш")}</div>
          <div className="small">{p.captured.isCapital ? (p.captured.secondCapital ? t("Это ваша вторая столица.") : t("Это ваша столица.")) : t("Один из городов вашей команды.")}</div>
        </div>
      ) : p.ownedBy ? (
        <div className="charter foreign" role="status">
          <div className="strong">{t("Печать уже сломана")}</div>
          <div className="small">{t("Город принадлежит команде «{team}». Взять его можно испытанием.", { team: p.ownedBy.name })}</div>
        </div>
      ) : (
        <>
          <div className="cipher-line"><span className="small muted">{t("Шифр для адресата")}{p.codeRule && <Help>{p.codeRule}</Help>}</span><b className="cipher-text">{p.cipher}</b></div>
          <p className="small"><Icon name="mail" /> {p.recipientText}</p>
          {p.ruined ? (
            <div className="actions"><button type="button" disabled={p.busy} onClick={p.onBreak}><Icon name="city" />{t("Занять руины")}</button></div>
          ) : (
            <div className="field">
              <label htmlFor="city-key">{t("Ключ из конверта")}</label>
              <div className="key-cells" onClick={() => document.getElementById("city-key")?.focus()}>
                {chars.map((c, i) => <span key={i} className={"cell" + (c ? " on" : "") + (i === Math.min(p.keyValue.length, cells - 1) ? " cursor" : "")} aria-hidden="true">{c}</span>)}
                <input id="city-key" className="key-input" value={p.keyValue} onChange={(e) => p.onKey(e.target.value.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, cells))} maxLength={cells} autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} aria-label={t("Ключ из конверта")} />
              </div>
              <div className="actions row">
                <button type="button" disabled={p.busy || p.keyValue.trim().length < 4 || p.cooldown > 0} onClick={p.onBreak}><Icon name="city" />{t("Сломать печать")}</button>
                {p.cooldown > 0 ? <PickCooling until={Date.now() + p.cooldown * 1000} now={Date.now()} label={t("Печать остывает после неверного ключа")} /> : <span className="hint">{t("4–6 знаков")}</span>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Обгоревший свиток ---------- */

/** Цитата в «…» с пропуском внутри — иначе форма не применяется. */
export function findGap(prompt: string): { before: string; a: string; b: string; after: string } | null {
  const m = /«([^»]*?)(…|\.\.\.)([^»]*)»/.exec(prompt);
  if (!m) return null;
  // Знак препинания сразу после цитаты остаётся при ней, а не открывает следующий абзац.
  const rest = prompt.slice(m.index + m[0].length);
  const punct = /^[.,;:!?…]+/.exec(rest)?.[0] ?? "";
  return { before: prompt.slice(0, m.index), a: m[1] ?? "", b: (m[3] ?? "") + "»" + punct, after: rest.slice(punct.length) };
}

/**
 * Стих на обгоревшем свитке: на месте пропуска — дыра с полем фиксированной ширины (длина ответа не утекает).
 * Ввод «проявляет чернила». Проверка — тот же запрос со строкой.
 */
export function BurntScroll({ gap, value, onChange, disabled, onPaste }: { gap: NonNullable<ReturnType<typeof findGap>>; value: string; onChange: (v: string) => void; disabled?: boolean; onPaste: (e: React.ClipboardEvent | React.DragEvent) => void }) {
  return (
    <div className="burnt">
      {gap.before.trim() && <p className="prompt no-copy">{gap.before.trim()}</p>}
      <div className="scroll-paper no-copy" onCopy={(e) => e.preventDefault()}>
        <span className="quote">«{gap.a}</span>
        <span className="hole"><input id="answer-text" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} autoComplete="off" autoCorrect="off" spellCheck={false} autoCapitalize="off" onPaste={onPaste} onDrop={onPaste} aria-label={t("Пропущенное слово")} /></span>
        <span className="quote">{gap.b}</span>
      </div>
      {gap.after.trim() && <p className="prompt no-copy">{gap.after.trim()}</p>}
    </div>
  );
}

/* ---------- Кроссворд ---------- */

/**
 * Кроссворд района: сетка из позиций слов (букв сервер не отдаёт), подсказки по горизонтали и вертикали.
 * Ответ — слова в порядке списка; отправить можно, когда заполнены все клетки.
 */
export function Crossword({ rows, cols, words, onChange, disabled, onPaste }: { rows: number; cols: number; words: CrosswordWordDto[]; onChange: (words: string[] | null) => void; disabled?: boolean; onPaste: (e: React.ClipboardEvent | React.DragEvent) => void }) {
  const [cells, setCells] = useState<Record<string, string>>({});
  const [active, setActive] = useState<number>(0);
  const key = (r: number, c: number) => `${r},${c}`;
  const coords = useMemo(() => words.map((w) => Array.from({ length: w.len }, (_, i) => ({ r: w.row + (w.dir === "down" ? i : 0), c: w.col + (w.dir === "across" ? i : 0) }))), [words]);
  const starts = useMemo(() => { const m = new Map<string, number>(); words.forEach((w) => { const k = key(w.row, w.col); if (!m.has(k)) m.set(k, w.n); }); return m; }, [words]);
  const cellWords = useMemo(() => { const m = new Map<string, number[]>(); coords.forEach((cs, wi) => cs.forEach(({ r, c }) => { const k = key(r, c); m.set(k, [...(m.get(k) ?? []), wi]); })); return m; }, [coords]);
  useEffect(() => {
    const out = coords.map((cs) => cs.map(({ r, c }) => cells[key(r, c)] ?? "").join(""));
    onChange(out.every((s, i) => s.length === words[i]!.len) ? out : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, coords]);
  const focusCell = (r: number, c: number) => (document.querySelector(`[data-cell="${key(r, c)}"]`) as HTMLInputElement | null)?.focus();
  const onInput = (r: number, c: number, raw: string) => {
    const v = raw.toUpperCase().replace(/Ё/g, "Е").replace(/[^\p{L}]/gu, "").slice(-1);
    setCells((m) => ({ ...m, [key(r, c)]: v }));
    if (!v) return;
    // Дальше по активному слову.
    const w = words[active]; const cs = coords[active];
    if (!w || !cs) return;
    const i = cs.findIndex((x) => x.r === r && x.c === c);
    if (i >= 0 && i + 1 < cs.length) focusCell(cs[i + 1]!.r, cs[i + 1]!.c);
  };
  const onKeyDown = (r: number, c: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Backspace" || cells[key(r, c)]) return;
    const cs = coords[active]; if (!cs) return;
    const i = cs.findIndex((x) => x.r === r && x.c === c);
    if (i > 0) { e.preventDefault(); const p = cs[i - 1]!; setCells((m) => ({ ...m, [key(p.r, p.c)]: "" })); focusCell(p.r, p.c); }
  };
  const onFocus = (r: number, c: number) => {
    const ws = cellWords.get(key(r, c)) ?? [];
    if (ws.length && !ws.includes(active)) setActive(ws[0]!);
  };
  const activeCells = new Set((coords[active] ?? []).map(({ r, c }) => key(r, c)));
  const grid: Array<Array<{ k: string; n?: number } | null>> = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (cellWords.has(key(r, c)) ? { k: key(r, c), n: starts.get(key(r, c)) } : null)));
  const across = words.map((w, i) => ({ w, i })).filter((x) => x.w.dir === "across"), down = words.map((w, i) => ({ w, i })).filter((x) => x.w.dir === "down");
  return (
    <div className="crossword">
      <div className="cw-grid" style={{ ["--cols" as string]: cols }} role="group" aria-label={t("Сетка кроссворда")}>
        {grid.map((row, r) => row.map((cell, c) => cell ? (
          <div key={cell.k} className={"cw-cell" + (activeCells.has(cell.k) ? " active" : "")}>
            {cell.n != null && <span className="cw-n" aria-hidden="true">{cell.n}</span>}
            <input data-cell={cell.k} value={cells[cell.k] ?? ""} maxLength={2} disabled={disabled} autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} inputMode="text" aria-label={t("Клетка {r}:{c}", { r: r + 1, c: c + 1 })}
              onChange={(e) => onInput(r, c, e.target.value)} onKeyDown={(e) => onKeyDown(r, c, e)} onFocus={() => onFocus(r, c)} onPaste={onPaste} onDrop={onPaste} />
          </div>
        ) : <div key={`${r},${c}`} className="cw-cell empty" aria-hidden="true" />))}
      </div>
      <div className="cw-clues">
        {[{ title: t("По горизонтали"), list: across }, { title: t("По вертикали"), list: down }].map((g) => g.list.length > 0 && (
          <div key={g.title}>
            <div className="strong small">{g.title}</div>
            <ol className="cw-list">
              {g.list.map(({ w, i }) => <li key={i} className={i === active ? "active" : ""}><button type="button" className="ghost sm" onClick={() => { setActive(i); focusCell(w.row, w.col); }}><b>{w.n}.</b> {w.clue} <span className="muted">({w.len})</span></button></li>)}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Отмычка остывает и свеча пророка ---------- */

/** Остывающая отмычка: кольцо-таймер с точным временем рядом (метафора не прячет время). */
export function PickCooling({ until, now, label, total }: { until: number; now: number; label: string; total?: number }) {
  const left = Math.max(0, until - now);
  const span = total && total > 0 ? total : Math.max(left, 1);
  const frac = Math.min(1, left / span);
  const C = 2 * Math.PI * 14;
  return (
    <span className="pick-cooling" role="status">
      <svg viewBox="0 0 36 36" width="32" height="32" aria-hidden="true">
        <circle className="track" cx="18" cy="18" r="14" />
        <circle className="heat" cx="18" cy="18" r="14" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
        <path className="pick" d="M13 23l7-7m0 0 2-2m-2 2 1.5 1.5M20 16l-1.5-1.5" />
      </svg>
      <span className="small">{label}: <b>{fmtLeft(left)}</b></span>
    </span>
  );
}

/** Свеча пророка в шапке города: горит — подсказка доступна; огарок — до даты. Видит только пророк. */
export function ProphetCandle({ availableAt, now }: { availableAt: number | null; now: number }) {
  if (availableAt == null) return null;
  const lit = availableAt <= now;
  return (
    <span className={"candle" + (lit ? " lit" : " stub")} title={lit ? t("Свеча пророка: подсказка доступна") : t("Огарок: следующая подсказка {d}", { d: fmtDate(availableAt, { time: false }) })}>
      <img src={lit ? "/img/props/candle-lit.webp" : "/img/props/candle-stub.webp"} alt="" width={lit ? 30 : 27} height={30} aria-hidden="true" />
      <span className="small">{lit ? t("подсказка доступна") : t("до {d}", { d: fmtDate(availableAt, { time: false }) })}</span>
    </span>
  );
}
