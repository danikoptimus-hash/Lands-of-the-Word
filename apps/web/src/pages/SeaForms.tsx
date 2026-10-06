import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import type { LightKind, SeaChartDto, SeaTaskDto, SpriteDto } from "../lib/api";

/**
 * Формы вахт моря (решение владельца 06.10, вторая редакция): маяк, диск кормчего, две гарнитуры, что изменилось,
 * обрывки карты и общая карта моря. Данные приходят с сервера и у каждой команды свои; формы ничего не проверяют
 * сами — только собирают ответ. Картинки — растр из /img/sea (генерируются отдельно, см. scripts/gen-sea-art.mjs).
 */

const V = typeof __IMG_VERSION__ === "string" ? `?v=${__IMG_VERSION__}` : "";
export const seaImg = (path: string) => `/img/sea/${path}.webp${V}`;
export const CHART_W = 100, CHART_H = 75;

/* ---------- Карта моря ---------- */
/** Карта моря: растровая подложка, береговые линии и места из контента. Координаты — проценты (100 × 75). */
export function SeaChart({ code, chart, children, labels = true, onTap, className, grid, letters }: { code: string; chart: SeaChartDto; children?: ReactNode; labels?: boolean; onTap?: (p: { x: number; y: number }) => void; className?: string; grid?: { cols: number; rows: number }; letters?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const toChart = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * CHART_W, y: ((e.clientY - r.top) / r.height) * CHART_H };
  };
  const poly = (pts: Array<[number, number]>) => pts.map(([x, y]) => `${x},${y}`).join(" ");
  const water = chart.land === "all";
  return (
    <svg ref={ref} className={"sea-chart" + (className ? " " + className : "")} viewBox={`0 0 ${CHART_W} ${CHART_H}`} onPointerDown={onTap ? (e) => onTap(toChart(e)) : undefined} role={onTap ? "button" : undefined}>
      <defs>
        <pattern id="chart-land" patternUnits="userSpaceOnUse" width="100" height="75"><image href={seaImg("common/land")} width="100" height="75" preserveAspectRatio="xMidYMid slice" /></pattern>
        <pattern id="chart-water" patternUnits="userSpaceOnUse" width="100" height="75"><image href={seaImg(`${code}/chart`)} width="100" height="75" preserveAspectRatio="xMidYMid slice" /></pattern>
      </defs>
      <rect width={CHART_W} height={CHART_H} fill={water ? "url(#chart-land)" : "url(#chart-water)"} />
      {water
        ? chart.water?.map((w, i) => <polygon key={i} className="c-water" points={poly(w.points)} fill="url(#chart-water)" />)
        : chart.coast?.map((c, i) => <polygon key={i} className="c-land" points={poly(c.points)} fill="url(#chart-land)" />)}
      {grid && (
        <g className="c-grid">
          {Array.from({ length: grid.cols + 1 }, (_, i) => <line key={"v" + i} x1={(i * CHART_W) / grid.cols} y1={0} x2={(i * CHART_W) / grid.cols} y2={CHART_H} />)}
          {Array.from({ length: grid.rows + 1 }, (_, i) => <line key={"h" + i} x1={0} y1={(i * CHART_H) / grid.rows} x2={CHART_W} y2={(i * CHART_H) / grid.rows} />)}
          {Array.from({ length: grid.cols }, (_, i) => <text key={"l" + i} x={((i + 0.5) * CHART_W) / grid.cols} y={2.6}>{letters?.[i] ?? ""}</text>)}
          {Array.from({ length: grid.rows }, (_, i) => <text key={"n" + i} x={1.6} y={((i + 0.5) * CHART_H) / grid.rows + 1}>{i + 1}</text>)}
        </g>
      )}
      {labels && chart.places.map((p) => (
        <g key={p.id} className={"c-place " + (p.kind ?? "city")} transform={`translate(${p.x} ${p.y})`}>
          {p.kind === "cape" ? <path d="M-1.2 .8 0-1.2 1.2 .8Z" /> : p.kind === "island" ? <circle r=".9" /> : <rect x="-.9" y="-.9" width="1.8" height="1.8" />}
          <text x="1.6" y=".9">{p.name}</text>
        </g>
      ))}
      {chart.rose && <g className="c-rose" transform={`translate(${chart.rose[0]} ${chart.rose[1]})`}><circle r="5" /><path d="M0-5 1-1 5 0 1 1 0 5-1 1-5 0-1-1Z" /><text y="-5.8">N</text></g>}
      {children}
    </svg>
  );
}

/* ---------- Маяк ---------- */
/** Сокращения характеристик огней, как на морских картах (не переводятся). */
const KIND_NAME: Record<LightKind, string> = { fl: "Пр", lfl: "ДлПр", oc: "Зтм", iso: "Изо", fl2: "ГрПр(2)", fl3: "ГрПр(3)" }; // i18n: сокращения карт
export const kindLabel = (k: LightKind) => ({ fl: t("проблесковый"), lfl: t("длительно-проблесковый"), oc: t("затмевающийся"), iso: t("изофазный"), fl2: t("группо-проблесковый, 2 вспышки"), fl3: t("группо-проблесковый, 3 вспышки") })[k];
/** Горит ли огонь в момент времени (секунды): характеристики как на картах. */
function litAt(kind: LightKind, period: number, time: number): boolean {
  const u = ((time % period) + period) % period;
  switch (kind) {
    case "fl": return u < 0.5;
    case "lfl": return u < 2;
    case "oc": return u >= 1;
    case "iso": return u < period / 2;
    case "fl2": return u < 0.5 || (u >= 1.2 && u < 1.7);
    case "fl3": return u < 0.5 || (u >= 1.2 && u < 1.7) || (u >= 2.4 && u < 2.9);
  }
}
export function Lights({ task, picked, onPick, disabled }: { task: Extract<SeaTaskDto, { type: "lights" }>; picked: string | null; onPick: (id: string) => void; disabled?: boolean }) {
  const [now, setNow] = useState(0);
  const [watch, setWatch] = useState<{ from: number | null; laps: number[] }>({ from: null, laps: [] });
  useEffect(() => { let raf = 0; const t0 = performance.now(); const tick = () => { setNow((performance.now() - t0) / 1000); raf = requestAnimationFrame(tick); }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); }, []);
  const elapsed = watch.from == null ? 0 : now - watch.from;
  return (
    <div className="lights">
      <div className="lights-scene" style={{ backgroundImage: `url(${seaImg("common/lighthouse")})` }}>
        {task.lights.map((l) => {
          const on = litAt(l.kind, l.period, now + l.phase * l.period);
          return <button key={l.id} type="button" className={"light" + (on ? " on" : "") + (picked === l.id ? " picked" : "")} style={{ left: `${l.x}%`, top: `${(l.y / CHART_H) * 100}%` }} onClick={() => !disabled && onPick(l.id)} aria-label={t("Огонь")} aria-pressed={picked === l.id}><span /></button>;
        })}
      </div>
      <div className="row between nowrap mt-2">
        <span className="stopwatch"><Icon name="clock" /><b>{elapsed.toFixed(1)}</b> {t("с")}{watch.laps.length > 0 && <span className="small muted"> · {watch.laps.map((x) => x.toFixed(1)).join(" / ")}</span>}</span>
        <span className="row nowrap">
          <button type="button" className="ghost sm" onClick={() => setWatch((w) => (w.from == null ? { from: now, laps: [] } : { ...w, laps: [...w.laps, now - w.from].slice(-4) }))}>{watch.from == null ? t("Пуск") : t("Отсечка")}</button>
          <button type="button" className="ghost sm" onClick={() => setWatch({ from: null, laps: [] })}><Icon name="refresh" /></button>
        </span>
      </div>
      <div className="lights-list">
        <p className="small muted">{t("Огни и знаки")} · {t("какой из огней — {name}?", { name: task.target })}</p>
        <ul>
          {task.list.map((l) => <li key={l.name}><span className="nm">{l.name}</span><span className="ch">{KIND_NAME[l.kind]} {l.period}{t("с")}</span><span className="small muted">{kindLabel(l.kind)}</span></li>)}
        </ul>
        <p className="small muted">{t("Пр — проблесковый (свет короче темноты), ДлПр — долгая вспышка, Зтм — затмевающийся (свет дольше темноты), Изо — поровну, ГрПр — группа вспышек. Период — от начала группы до начала следующей.")}</p>
      </div>
    </div>
  );
}

/* ---------- Диск кормчего ---------- */
export function Disc({ task }: { task: Extract<SeaTaskDto, { type: "disc" }> }) {
  const [turn, setTurn] = useState(0);
  const n = task.outer.length;
  const step = 360 / n;
  const R = 100, rOuter = 86, rInner = 64;
  const pos = (i: number, r: number) => { const a = ((i * step - 90) * Math.PI) / 180; return { x: R + r * Math.cos(a), y: R + r * Math.sin(a), rot: i * step }; };
  return (
    <div className="disc">
      <div className="disc-wrap" style={{ backgroundImage: `url(${seaImg("common/disc")})` }}>
        <svg viewBox="0 0 200 200" aria-label={t("Диск кормчего")}>
          <circle className="ring outer" cx={R} cy={R} r={95} />
          {task.outer.split("").map((ch, i) => { const p = pos(i, rOuter); return <text key={"o" + i} className="o" x={p.x} y={p.y} transform={`rotate(${p.rot} ${p.x} ${p.y})`}>{ch}</text>; })}
          <g className="inner-ring" style={{ transform: `rotate(${turn * step}deg)`, transformOrigin: "100px 100px" }}>
            <circle className="ring inner" cx={R} cy={R} r={74} />
            {task.inner.split("").map((ch, i) => { const p = pos(i, rInner); return <text key={"i" + i} className="n" x={p.x} y={p.y} transform={`rotate(${p.rot} ${p.x} ${p.y})`}>{ch}</text>; })}
            <path className="mark" d="M100 48l-3 6h6Z" />
          </g>
          <circle className="hub" cx={R} cy={R} r={34} />
          <text className="hub-text" x={R} y={R + 4}>{turn}</text>
        </svg>
      </div>
      <div className="row between nowrap">
        <button type="button" className="ghost sm" onClick={() => setTurn((v) => (v - 1 + n) % n)}><Icon name="back" />{t("деление против солнца")}</button>
        <button type="button" className="ghost sm" onClick={() => setTurn((v) => (v + 1) % n)}>{t("деление по солнцу")}<Icon name="chevron" /></button>
      </div>
      <p className="small muted">{t("Метка внутреннего кольца сейчас под буквой «{ch}». Найдите букву шифровки на внутреннем кольце и прочтите ту, что стоит над ней на внешнем.", { ch: task.outer[(n - turn) % n] ?? "" })}</p>
      <div className="cipher-line" aria-label={t("Шифровка")}>
        {task.cipher.map((c, i) => (c ? <span key={i} className="cl">{c}</span> : <span key={i} className="cl gap" aria-label={t("промежуток")}>·</span>))}
      </div>
    </div>
  );
}

/* ---------- Две гарнитуры ---------- */
/** Страница рисуется на холсте буква за буквой: обычная гарнитура и «другая» (с наклоном и чуть светлее); текст нельзя выделить. */
export function FontsPage({ task }: { task: Extract<SeaTaskDto, { type: "fonts" }> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const W = 720, pad = 48, lineH = 34, fontPx = 21;
    const ctx = cv.getContext("2d")!;
    const fontA = `${fontPx}px Georgia, "Times New Roman", serif`;
    // Разбиваем на строки по ширине, считая каждую букву отдельно (как наборщик).
    ctx.font = fontA;
    const rows: Array<Array<[string, 0 | 1]>> = [];
    for (const line of task.page) {
      let cur: Array<[string, 0 | 1]> = [[`${line.n} `, 0]];
      let width = ctx.measureText(`${line.n} `).width;
      const words: Array<Array<[string, 0 | 1]>> = [[]];
      for (const g of line.glyphs) { if (g[0] === " ") words.push([]); else words[words.length - 1]!.push(g); }
      for (const w of words) {
        const ww = w.reduce((a, g) => a + ctx.measureText(g[0]).width, 0) + ctx.measureText(" ").width;
        if (width + ww > W - pad * 2 && cur.length > 1) { rows.push(cur); cur = []; width = 0; }
        cur.push(...w, [" ", 0]); width += ww;
      }
      rows.push(cur);
      rows.push([]);
    }
    cv.width = W; cv.height = pad * 2 + rows.length * lineH;
    ctx.fillStyle = "#efe4c8"; ctx.fillRect(0, 0, cv.width, cv.height);
    const bg = new Image(); bg.src = seaImg("common/page");
    const draw = () => {
      if (bg.complete && bg.naturalWidth) { ctx.globalAlpha = 0.9; ctx.drawImage(bg, 0, 0, cv.width, cv.height); ctx.globalAlpha = 1; }
      ctx.fillStyle = "#2b2217"; ctx.textBaseline = "alphabetic";
      rows.forEach((row, ri) => {
        let x = pad; const y = pad + ri * lineH + fontPx;
        for (const [ch, v] of row) {
          ctx.font = fontA;
          const w = ctx.measureText(ch).width;
          if (v) { ctx.save(); ctx.translate(x + w / 2, y); ctx.transform(1, 0, -0.16, 1, 0, 0); ctx.fillStyle = "#3a2f21"; ctx.font = `300 ${fontPx}px Georgia, "Times New Roman", serif`; ctx.fillText(ch, -w / 2, 0); ctx.restore(); }
          else ctx.fillText(ch, x, y);
          x += w;
        }
      });
      // Зерно бумаги: мелкий шум поверх текста, чтобы снимок не читался как текст.
      const img = ctx.getImageData(0, 0, cv.width, cv.height); const d = img.data;
      let s = 1234567;
      for (let i = 0; i < d.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const nz = ((s >> 16) & 15) - 8; d[i] = Math.max(0, Math.min(255, d[i]! + nz)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + nz)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + nz)); }
      ctx.putImageData(img, 0, 0);
    };
    bg.onload = draw; draw();
  }, [task]);
  return (
    <div className="fonts">
      <p className="small muted">{task.ref} · {t("спрятано букв: {n}", { n: task.length })}</p>
      <div className="fonts-scroll"><canvas ref={ref} style={{ width: `${100 * zoom}%` }} aria-label={t("Страница")} /></div>
      <div className="row between nowrap">
        <span className="small muted">{t("Лупа")}</span>
        <span className="row nowrap">{[1, 1.6, 2.4].map((z) => <button key={z} type="button" className={"ghost sm" + (zoom === z ? " on" : "")} onClick={() => setZoom(z)}>×{z}</button>)}</span>
      </div>
    </div>
  );
}

/* ---------- Что изменилось ---------- */
const spriteSrc = (name: string) => { const flip = name.endsWith("-flip"); return { src: seaImg(`sprites/${flip ? name.slice(0, -5) : name}`), flip }; };
function Scene({ code, scene, sprites, children, onTap }: { code: string; scene: string; sprites: SpriteDto[]; children?: ReactNode; onTap?: (p: { x: number; y: number }) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="scene" style={{ backgroundImage: `url(${seaImg(`${code}/${scene}`)})` }} onPointerDown={onTap ? (e) => { const r = ref.current!.getBoundingClientRect(); onTap({ x: ((e.clientX - r.left) / r.width) * CHART_W, y: ((e.clientY - r.top) / r.height) * CHART_H }); } : undefined}>
      {sprites.map((s, i) => { const { src, flip } = spriteSrc(s.sprite); return <img key={i} src={src} alt="" draggable={false} className={"sp" + (flip ? " flip" : "")} style={{ left: `${s.x}%`, top: `${(s.y / CHART_H) * 100}%`, width: `${s.w}%` }} />; })}
      {children}
    </div>
  );
}
/** Отличия находит клиент по спискам спрайтов; сервер проверяет те же точки. */
export function Diff({ code, task, found, onFound, disabled }: { code: string; task: Extract<SeaTaskDto, { type: "diff" }>; found: Array<{ x: number; y: number }>; onFound: (pts: Array<{ x: number; y: number }>) => void; disabled?: boolean }) {
  const diffs = useMemo(() => {
    const key = (s: SpriteDto) => `${s.x},${s.y}`;
    const b = new Map(task.before.map((s) => [key(s), s])), a = new Map(task.after.map((s) => [key(s), s]));
    const out: Array<{ x: number; y: number; w: number }> = [];
    for (const [k, s] of a) if (b.get(k)?.sprite !== s.sprite) out.push({ x: s.x, y: s.y, w: s.w });
    for (const [k, s] of b) if (!a.has(k)) out.push({ x: s.x, y: s.y, w: s.w });
    return out;
  }, [task]);
  const [miss, setMiss] = useState<{ x: number; y: number } | null>(null);
  const tap = (p: { x: number; y: number }) => {
    if (disabled) return;
    const hit = diffs.find((d) => Math.hypot(d.x - p.x, d.y - p.y) <= Math.max(6, d.w / 2 + 3));
    if (hit && !found.some((f) => f.x === hit.x && f.y === hit.y)) onFound([...found, { x: hit.x, y: hit.y }]);
    else if (!hit) { setMiss(p); setTimeout(() => setMiss(null), 500); }
  };
  return (
    <div className="diff">
      <p className="small muted">{t("До")}</p>
      <Scene code={code} scene="scene" sprites={task.before} />
      <p className="small muted">{t("После")} · {t("найдено {a} из {b}", { a: found.length, b: task.count })}</p>
      <Scene code={code} scene="scene" sprites={task.after} onTap={tap}>
        {found.map((f, i) => <span key={i} className="mark" style={{ left: `${f.x}%`, top: `${(f.y / CHART_H) * 100}%` }} />)}
        {miss && <span className="mark miss" style={{ left: `${miss.x}%`, top: `${(miss.y / CHART_H) * 100}%` }} />}
      </Scene>
    </div>
  );
}

/* ---------- Обрывки карты ---------- */
/** Рваные края: волнистые линии между клочками, одинаковые у соседей (семя с сервера). */
function tornEdges(seed: number, cols: number, rows: number) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const wave = (len: number, segs: number) => Array.from({ length: segs + 1 }, (_, i) => [(i / segs) * len, i === 0 || i === segs ? 0 : (rnd() - 0.5) * 5] as [number, number]);
  const h = Array.from({ length: rows + 1 }, () => Array.from({ length: cols }, () => wave(CHART_W / cols, 6)));
  const v = Array.from({ length: cols + 1 }, () => Array.from({ length: rows }, () => wave(CHART_H / rows, 6)));
  return { h, v };
}
function piecePath(edges: ReturnType<typeof tornEdges>, cols: number, rows: number, col: number, row: number): string {
  const cw = CHART_W / cols, rh = CHART_H / rows, x0 = col * cw, y0 = row * rh;
  const top = edges.h[row]![col]!.map(([dx, dy]) => [x0 + dx, row === 0 ? y0 : y0 + dy]);
  const right = edges.v[col + 1]![row]!.map(([dy, dx]) => [col + 1 === cols ? x0 + cw : x0 + cw + dx, y0 + dy]);
  const bottom = edges.h[row + 1]![col]!.map(([dx, dy]) => [x0 + dx, row + 1 === rows ? y0 + rh : y0 + rh + dy]).reverse();
  const left = edges.v[col]![row]!.map(([dy, dx]) => [col === 0 ? x0 : x0 + dx, y0 + dy]).reverse();
  return "M" + [...top, ...right, ...bottom, ...left].map(([x, y]) => `${x!.toFixed(2)} ${y!.toFixed(2)}`).join(" L") + "Z";
}
export type TornState = Record<string, { x: number; y: number; rot: number }>;
export function Torn({ code, chart, task, state, onChange, assembled, tap, onTap, disabled }: { code: string; chart: SeaChartDto; task: Extract<SeaTaskDto, { type: "torn" }>; state: TornState; onChange: (s: TornState) => void; assembled: boolean; tap: { x: number; y: number } | null; onTap: (p: { x: number; y: number }) => void; disabled?: boolean }) {
  const edges = useMemo(() => tornEdges(task.seed, task.cols, task.rows), [task.seed, task.cols, task.rows]);
  const board = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const cw = CHART_W / task.cols, rh = CHART_H / task.rows;
  const toBoard = (e: React.PointerEvent) => { const r = board.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * CHART_W, y: ((e.clientY - r.top) / r.height) * CHART_H }; };
  const snap = (p: { id: string; col: number; row: number }, s: { x: number; y: number; rot: number }) => {
    const cx = (p.col + 0.5) * cw, cy = (p.row + 0.5) * rh;
    const rot = ((s.rot % 360) + 360) % 360;
    return Math.abs(s.x - cx) <= 4 && Math.abs(s.y - cy) <= 4 && (rot <= 15 || rot >= 345) ? { x: cx, y: cy, rot: 0 } : s;
  };
  const down = (e: React.PointerEvent, id: string) => { if (disabled || assembled) return; const p = toBoard(e); const s = state[id]!; drag.current = { id, dx: s.x - p.x, dy: s.y - p.y, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => { const d = drag.current; if (!d) return; const p = toBoard(e); const s = state[d.id]!; const nx = p.x + d.dx, ny = p.y + d.dy; if (Math.hypot(nx - s.x, ny - s.y) > 0.6) d.moved = true; if (d.moved) onChange({ ...state, [d.id]: { ...s, x: Math.max(0, Math.min(CHART_W, nx)), y: Math.max(0, Math.min(CHART_H, ny)) } }); };
  const up = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return; drag.current = null;
    const piece = task.pieces.find((p) => p.id === d.id)!;
    const s = state[d.id]!;
    const next = d.moved ? s : { ...s, rot: (s.rot + 30) % 360 };
    onChange({ ...state, [d.id]: snap(piece, next) });
    void e;
  };
  return (
    <div className="torn">
      <div ref={board} className={"torn-board" + (assembled ? " done" : "")} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerDown={assembled && !disabled ? (e) => onTap(toBoard(e)) : undefined}>
        {assembled && <SeaChart code={code} chart={chart} className="under">{tap && <circle className="c-tap" cx={tap.x} cy={tap.y} r="2.2" />}</SeaChart>}
        {!assembled && task.pieces.map((p) => {
          const s = state[p.id]!;
          const cx = (p.col + 0.5) * cw, cy = (p.row + 0.5) * rh;
          return (
            <div key={p.id} className="piece" style={{ left: `${s.x}%`, top: `${(s.y / CHART_H) * 100}%`, width: `${cw + 6}%`, transform: `translate(-50%, -50%) rotate(${s.rot}deg)` }} onPointerDown={(e) => down(e, p.id)}>
              <svg viewBox={`${cx - cw / 2 - 3} ${cy - rh / 2 - 3} ${cw + 6} ${rh + 6}`}>
                <defs><clipPath id={`clip-${p.id}`}><path d={piecePath(edges, task.cols, task.rows, p.col, p.row)} /></clipPath></defs>
                <g clipPath={`url(#clip-${p.id})`}><SeaChartInner code={code} chart={chart} /></g>
                <path className="piece-edge" d={piecePath(edges, task.cols, task.rows, p.col, p.row)} />
              </svg>
            </div>
          );
        })}
      </div>
      <p className="small muted">{assembled ? task.question : t("Перетащите клочок на место; нажатие без движения поворачивает его на 30°. Собрано: {a} из {b}", { a: task.pieces.filter((p) => { const s = state[p.id]!; return s.rot === 0 && s.x === (p.col + 0.5) * cw && s.y === (p.row + 0.5) * rh; }).length, b: task.pieces.length })}</p>
    </div>
  );
}
/** Содержимое карты без собственного svg — для клочков (внутри clipPath). */
function SeaChartInner({ code, chart }: { code: string; chart: SeaChartDto }) {
  const poly = (pts: Array<[number, number]>) => pts.map(([x, y]) => `${x},${y}`).join(" ");
  const water = chart.land === "all";
  return (
    <g className="sea-chart">
      <image href={seaImg(water ? "common/land" : `${code}/chart`)} width={CHART_W} height={CHART_H} preserveAspectRatio="xMidYMid slice" />
      {water
        ? chart.water?.map((w, i) => <g key={i}><clipPath id={`w-${code}-${i}`}><polygon points={poly(w.points)} /></clipPath><image href={seaImg(`${code}/chart`)} width={CHART_W} height={CHART_H} preserveAspectRatio="xMidYMid slice" clipPath={`url(#w-${code}-${i})`} /><polygon className="c-water" points={poly(w.points)} fill="none" /></g>)
        : chart.coast?.map((c, i) => <g key={i}><clipPath id={`l-${code}-${i}`}><polygon points={poly(c.points)} /></clipPath><image href={seaImg("common/land")} width={CHART_W} height={CHART_H} preserveAspectRatio="xMidYMid slice" clipPath={`url(#l-${code}-${i})`} /><polygon className="c-land" points={poly(c.points)} fill="none" /></g>)}
      {chart.places.map((p) => (
        <g key={p.id} className={"c-place " + (p.kind ?? "city")} transform={`translate(${p.x} ${p.y})`}>
          {p.kind === "cape" ? <path d="M-1.2 .8 0-1.2 1.2 .8Z" /> : p.kind === "island" ? <circle r=".9" /> : <rect x="-.9" y="-.9" width="1.8" height="1.8" />}
          <text x="1.6" y=".9">{p.name}</text>
        </g>
      ))}
      {chart.rose && <g className="c-rose" transform={`translate(${chart.rose[0]} ${chart.rose[1]})`}><circle r="5" /><path d="M0-5 1-1 5 0 1 1 0 5-1 1-5 0-1-1Z" /><text y="-5.8">N</text></g>}
    </g>
  );
}
export const tornStart = (task: Extract<SeaTaskDto, { type: "torn" }>): TornState => Object.fromEntries(task.pieces.map((p) => [p.id, { x: p.sx, y: p.sy, rot: p.rot }]));
export const tornAssembled = (task: Extract<SeaTaskDto, { type: "torn" }>, s: TornState) => task.pieces.every((p) => { const v = s[p.id]; return v && v.rot === 0 && v.x === (p.col + 0.5) * (CHART_W / task.cols) && v.y === (p.row + 0.5) * (CHART_H / task.rows); });

/* ---------- Команда на вахте ---------- */
export function Crew({ crew, holders, mine }: { crew: Array<{ nickname: string; screens: string[] }>; holders: string[]; mine: string[] }) {
  const name = (s: string) => ({ map: t("карта"), table: t("пеленги"), input: t("ввод"), panel: t("прибор"), manual: t("устав") })[s] ?? s;
  return (
    <div className="crew">
      <p className="small"><Icon name="users" />{t("Ваш экран: {s}", { s: mine.map(name).join(" + ") })}</p>
      <ul className="small muted">
        {crew.map((c) => <li key={c.nickname}><span className={holders.includes(c.nickname) ? "on" : ""}>{c.nickname}</span> — {c.screens.map(name).join(" + ")}{holders.includes(c.nickname) ? ` · ${t("на вахте")}` : ""}</li>)}
      </ul>
    </div>
  );
}
export const useHold = (enabled: boolean, send: () => void) => {
  const cb = useCallback(send, [send]);
  useEffect(() => { if (!enabled) return; cb(); const tm = setInterval(cb, 30000); return () => clearInterval(tm); }, [enabled, cb]);
};
