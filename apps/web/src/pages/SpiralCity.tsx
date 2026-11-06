import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { Help } from "../components/Help";
import type { CityDistrictDto } from "../lib/api";

/**
 * Круглый город (решение владельца 06.11): замок порядка для книг с планом `spiral`. Районы — трапеции между витками
 * спирали, которая идёт по часовой стрелке от ворот снаружи к площади в центре; между витками дорога и деревья.
 * Нажатие на участок открывает снизу лист с оставшимися районами, выбранный встаёт на участок; нажатие на занятый —
 * можно вернуть район в кучу. Карту можно приближать и двигать (щипок, перетаскивание, колесо). Текст на домах — по дуге.
 * Проверка — та же кнопка «Провернуть замок» снаружи; ответ сервера «не на месте: N» показан под картой.
 */

/** Наборы текстур на выбор (владелец смотрит варианты на стенде: `?cityStyle=a|b|c`). */
export const CITY_STYLES = {
  a: { name: "Пергамент", ground: "/img/props/parchment.webp", road: "/img/city-plan/road-gravel.webp", earth: "/img/city-plan/plot-earth.webp", roof: "/img/city-plan/roof-tiles.webp", wall: "/img/props/brick-sand.webp", outside: "/img/terrain/meadow.webp", field: "/img/terrain/hills.webp", tree: "/img/props/olive.webp", square: "/img/props/well.webp", roofEdge: "#6e3a26", label: "#fff6e6", number: "#b5583c" },
  b: { name: "Оазис", ground: "/img/terrain/oasis.webp", road: "/img/city-plan/road-gravel.webp", earth: "/img/city-plan/plot-earth.webp", roof: "/img/city-plan/roof-flat.webp", wall: "/img/props/brick-chalk.webp", outside: "/img/terrain/meadow.webp", field: "/img/terrain/desert.webp", tree: "/img/props/palm.webp", square: "/img/props/well.webp", roofEdge: "#7a5a36", label: "#3a2d1f", number: "#7a5226" },
  c: { name: "Глина", ground: "/img/terrain/desert.webp", road: "/img/city-plan/road-gravel.webp", earth: "/img/city-plan/plot-earth.webp", roof: "/img/city-plan/roof-slate.webp", wall: "/img/props/brick-umber.webp", outside: "/img/terrain/desert.webp", field: "/img/terrain/mountains.webp", tree: "/img/props/olive.webp", square: "/img/props/well.webp", roofEdge: "#2f343c", label: "#f4f6f8", number: "#4f5a66" },
} as const;
export type CityStyle = keyof typeof CITY_STYLES;
export function cityStyleFromQuery(): CityStyle {
  try { const s = new URLSearchParams(window.location.search).get("cityStyle"); return s && s in CITY_STYLES ? (s as CityStyle) : "a"; } catch { return "a"; }
}

const VB = 560, C = VB / 2, R0 = 182, W = 30, GAP = 11, PITCH = W + GAP, GAPLEN = 7, RMIN = 40, T0 = Math.PI / 2;
type Plot = { a: number; b: number };

/** Спираль Архимеда: шаг витка — глубина участка плюс дорога; длина участка подбирается так, чтобы вместить все районы. */
function spiral(n: number): { plots: Plot[]; r: (th: number) => number } {
  const k = PITCH / (2 * Math.PI);
  const r = (th: number) => R0 - k * (th - T0);
  const build = (len: number) => {
    const out: Plot[] = []; let th = T0;
    while (out.length < n) {
      const mid = r(th) + W / 2;
      if (mid < RMIN + W / 2) break;
      const b = th + len / mid;
      if (r(b) + W / 2 < RMIN) break;
      out.push({ a: th, b }); th = b + GAPLEN / mid;
    }
    return out;
  };
  let lo = 20, hi = 110;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (build(m).length >= n) lo = m; else hi = m; }
  return { plots: build(lo), r };
}
const pt = (th: number, rad: number): [number, number] => [C + rad * Math.cos(th), C + rad * Math.sin(th)];
const fmt = (p: [number, number]) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
function plotPath(p: Plot, r: (th: number) => number): string {
  const n = 6, pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) { const th = p.a + (p.b - p.a) * i / n; pts.push(pt(th, r(th))); }
  for (let i = 0; i <= n; i++) { const th = p.b - (p.b - p.a) * i / n; pts.push(pt(th, r(th) + W)); }
  return "M " + pts.map(fmt).join(" L ") + " Z";
}
/** Дуга для текста: в нижней половине круга — против часовой, чтобы буквы стояли прямо. */
function arcPath(p: Plot, rad: number, reverse: boolean): string {
  const n = 8, pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) { const th = reverse ? p.b - (p.b - p.a) * i / n : p.a + (p.b - p.a) * i / n; pts.push(pt(th, rad)); }
  return "M " + pts.map(fmt).join(" L ");
}
/** Детерминированный «случайный» ряд для деревьев и полей — одинаковый на всех устройствах. */
function rnd(seed: number): () => number { let h = seed >>> 0 || 1; return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; }; }
function twoLines(s: string, limit = 16): [string, string] {
  if (s.length <= limit) return [s, ""];
  const w = s.split(" "); const a: string[] = []; const b: string[] = [];
  for (const x of w) { if (!b.length && [...a, x].join(" ").length <= Math.max(limit, Math.ceil(s.length / 2))) a.push(x); else b.push(x); }
  return [a.join(" "), b.join(" ")];
}

export function SpiralCity({ districts, slots, onChange, disabled, state, pinsWrong, hint, help, style }: {
  districts: CityDistrictDto[];
  /** Участок → id района или null (пусто); длина — число районов. */
  slots: Array<string | null>;
  onChange: (slots: Array<string | null>) => void;
  disabled?: boolean;
  state: "idle" | "open" | "jam";
  /** Ответ замка: сколько районов не на месте (0 — собрано, −1 — заклинило без счёта), null — ещё не проверяли. */
  pinsWrong: number | null;
  hint?: string;
  help?: ReactNode;
  style?: CityStyle;
}) {
  const n = districts.length;
  const st = CITY_STYLES[style ?? "a"];
  const { plots, r } = useMemo(() => spiral(n), [n]);
  const byId = useMemo(() => new Map(districts.map((d) => [d.id, d])), [districts]);
  const placed = new Set(slots.filter(Boolean) as string[]);
  const pile = districts.filter((d) => !placed.has(d.id));
  const [pick, setPick] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const nextFree = slots.findIndex((x) => x === null);

  // Декорации: деревья вдоль дороги и за стеной, поля снаружи — по фиксированному зерну.
  const deco = useMemo(() => {
    const g = rnd(47 + n);
    const k = PITCH / (2 * Math.PI);
    const inner: Array<[number, number, number]> = [];
    for (let th = T0; R0 - k * (th - T0) + W + GAP / 2 > RMIN; th += 0.24) {
      if (g() < 0.5) { const rad = R0 - k * (th - T0) + W + GAP / 2 + (g() - 0.5) * 3; const [x, y] = pt(th, rad); inner.push([x, y, 7 + g() * 4]); }
    }
    const outer: Array<[number, number, number]> = [];
    for (let i = 0; i < 90; i++) {
      const th = g() * Math.PI * 2, rad = R0 + W + 22 + g() * 60; const [x, y] = pt(th, rad);
      if (x > 4 && x < VB - 4 && y > 4 && y < VB - 4 && Math.abs(th - T0) > 0.25) outer.push([x, y, 10 + g() * 9]);
    }
    const fields = [0, 1, 2, 3].map((q) => { const th = q * Math.PI / 2 + Math.PI / 4 + (g() - 0.5) * 0.3; const [x, y] = pt(th, R0 + W + 75); return { x, y, rx: 70 + g() * 30, ry: 40 + g() * 20, rot: (th * 180) / Math.PI }; });
    return { inner, outer, fields };
  }, [n]);

  // Приближение и перетаскивание: один палец — двигает, два — масштаб, колесо — масштаб у курсора.
  const view = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState({ k: 1, tx: 0, ty: 0 });
  const camRef = useRef(cam); camRef.current = cam;
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ k: number; tx: number; ty: number; mx: number; my: number; dist: number; moved: boolean } | null>(null);
  const clampCam = (c: { k: number; tx: number; ty: number }) => {
    const box = view.current?.getBoundingClientRect(); const w = box?.width ?? 1, h = box?.height ?? 1;
    const k = Math.min(4, Math.max(1, c.k));
    return { k, tx: Math.min(0, Math.max(w * (1 - k), c.tx)), ty: Math.min(0, Math.max(h * (1 - k), c.ty)) };
  };
  const zoomAt = (factor: number, px: number, py: number) => {
    const c = camRef.current; const k = Math.min(4, Math.max(1, c.k * factor)); const f = k / c.k;
    setCam(clampCam({ k, tx: px - (px - c.tx) * f, ty: py - (py - c.ty) * f }));
  };
  const local = (e: { clientX: number; clientY: number }) => { const b = view.current!.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    view.current?.setPointerCapture(e.pointerId);
    const p = local(e); ptrs.current.set(e.pointerId, p);
    const all = [...ptrs.current.values()]; const c = camRef.current;
    if (all.length === 1) gesture.current = { ...c, mx: p.x, my: p.y, dist: 0, moved: false };
    else if (all.length === 2) { const [a, b] = all as [{ x: number; y: number }, { x: number; y: number }]; gesture.current = { ...c, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y), moved: true }; }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId) || !gesture.current) return;
    const p = local(e); ptrs.current.set(e.pointerId, p);
    const all = [...ptrs.current.values()]; const g = gesture.current;
    if (all.length === 1) {
      const dx = p.x - g.mx, dy = p.y - g.my;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (g.moved) setCam(clampCam({ k: g.k, tx: g.tx + dx, ty: g.ty + dy }));
    } else if (all.length >= 2) {
      const [a, b] = all as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y); const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const k = Math.min(4, Math.max(1, g.k * (dist / Math.max(1, g.dist)))); const f = k / g.k;
      setCam(clampCam({ k, tx: mx - (g.mx - g.tx) * f, ty: my - (g.my - g.ty) * f }));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current; ptrs.current.delete(e.pointerId);
    if (ptrs.current.size === 0) {
      gesture.current = null;
      if (g && !g.moved && !disabled) {
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-plot]") as HTMLElement | null;
        if (el) { setPick(Number(el.dataset.plot)); setFilter(""); }
      }
    } else if (ptrs.current.size === 1) { const [p] = [...ptrs.current.values()] as [{ x: number; y: number }]; const c = camRef.current; gesture.current = { ...c, mx: p.x, my: p.y, dist: 0, moved: true }; }
  };
  useEffect(() => {
    const el = view.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const p = local(e); zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, p.x, p.y); };
    el.addEventListener("wheel", onWheel, { passive: false }); return () => el.removeEventListener("wheel", onWheel);
  });

  const put = (id: string) => { if (pick === null) return; const out = slots.slice(); const prev = out.indexOf(id); if (prev >= 0) out[prev] = null; out[pick] = id; onChange(out); setPick(null); };
  const clear = () => { if (pick === null) return; const out = slots.slice(); out[pick] = null; onChange(out); setPick(null); };
  const current = pick !== null ? slots[pick] ?? null : null;
  const shown = pile.filter((d) => !filter.trim() || d.title.toLowerCase().includes(filter.trim().toLowerCase()));
  const ids = { ground: "sc-ground", road: "sc-road", earth: "sc-earth", roof: "sc-roof", wall: "sc-wall", outside: "sc-outside", field: "sc-field" };
  const gateXY = pt(T0, R0 + W + 10);

  return (
    <div className="plan-wrap">
      {hint && <p className="hint">{hint}{help && <Help>{help}</Help>}</p>}
      <div ref={view} className={"plan-view" + (state === "jam" ? " jam" : state === "open" ? " open" : "")} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="group" aria-label={t("План города: участки по спирали от ворот к площади")}>
        <svg viewBox={`0 0 ${VB} ${VB}`} style={{ transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.k})` }} aria-hidden="true">
          <defs>
            <pattern id={ids.outside} patternUnits="userSpaceOnUse" width="200" height="200"><image href={st.outside} width="200" height="200" /></pattern>
            <pattern id={ids.field} patternUnits="userSpaceOnUse" width="180" height="180"><image href={st.field} width="180" height="180" /></pattern>
            <pattern id={ids.ground} patternUnits="userSpaceOnUse" width="220" height="220"><image href={st.ground} width="220" height="220" /></pattern>
            <pattern id={ids.road} patternUnits="userSpaceOnUse" width="56" height="56"><image href={st.road} width="56" height="56" /></pattern>
            <pattern id={ids.earth} patternUnits="userSpaceOnUse" width="56" height="56"><image href={st.earth} width="56" height="56" /></pattern>
            <pattern id={ids.roof} patternUnits="userSpaceOnUse" width="26" height="26"><image href={st.roof} width="26" height="26" /></pattern>
            <pattern id={ids.wall} patternUnits="userSpaceOnUse" width="30" height="16"><image href={st.wall} width="30" height="16" /></pattern>
            <filter id="sc-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="1.2" dy="1.8" stdDeviation="1.2" floodColor="#2a1d10" floodOpacity=".45" /></filter>
            <filter id="sc-soft" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#2a1d10" floodOpacity=".35" /></filter>
            <radialGradient id="sc-vignette" cx="50%" cy="50%" r="50%"><stop offset=".75" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".18" /></radialGradient>
          </defs>
          {/* Окрестности: луга, поля и опушка */}
          <rect width={VB} height={VB} fill={`url(#${ids.outside})`} />
          {deco.fields.map((f, i) => <ellipse key={i} cx={f.x} cy={f.y} rx={f.rx} ry={f.ry} transform={`rotate(${f.rot.toFixed(1)} ${f.x.toFixed(1)} ${f.y.toFixed(1)})`} fill={`url(#${ids.field})`} opacity=".9" />)}
          {deco.outer.map(([x, y, s], i) => <image key={i} href={st.tree} x={x - s / 2} y={y - s} width={s} height={s} filter="url(#sc-soft)" />)}
          {/* Город: земля, стена, дорога-спираль */}
          <circle cx={C} cy={C} r={R0 + W + 8} fill={`url(#${ids.ground})`} />
          <circle cx={C} cy={C} r={R0 + W + 8} fill="url(#sc-vignette)" />
          <circle cx={C} cy={C} r={R0 + W + 10} fill="none" stroke="#3b2a1b" strokeWidth="14" opacity=".55" />
          <circle cx={C} cy={C} r={R0 + W + 10} fill="none" stroke={`url(#${ids.wall})`} strokeWidth="11" />
          <circle cx={C} cy={C} r={R0 + W + 10} fill="none" stroke="#2a1d10" strokeWidth="1" opacity=".7" />
          <path d={(() => { const k = PITCH / (2 * Math.PI); const pts: [number, number][] = []; for (let th = T0 - 0.4; R0 - k * (th - T0) + W + GAP / 2 > RMIN - 8; th += 0.05) pts.push(pt(th, R0 - k * (th - T0) + W + GAP / 2)); return "M " + pts.map(fmt).join(" L "); })()} fill="none" stroke={`url(#${ids.road})`} strokeWidth={GAP + 1} strokeLinecap="round" />
          {deco.inner.map(([x, y, s], i) => <image key={i} href={st.tree} x={x - s / 2} y={y - s * 0.9} width={s} height={s} filter="url(#sc-soft)" />)}
          {/* Участки */}
          {plots.map((p, i) => {
            const id = slots[i] ?? null; const d = id ? byId.get(id) : undefined;
            const mid = (p.a + p.b) / 2; const rm = r(mid) + W / 2; const bottom = Math.sin(mid) > 0;
            const arcLen = (p.b - p.a) * rm;
            const active = !disabled && (pick === i || (pick === null && i === nextFree));
            const [l1, l2] = d ? twoLines(d.title) : ["", ""];
            const fs = (s: string) => Math.max(4.2, Math.min(7.2, arcLen / (Math.max(6, s.length) * 0.62)));
            const f1 = fs(l1), f2 = l2 ? fs(l2) : 0;
            const r1 = l2 ? (bottom ? rm - W * 0.08 + f1 * 0.35 : rm - W * 0.22 - 0) : (bottom ? rm + f1 * 0.35 : rm - f1 * 0.35);
            const r2 = bottom ? rm + W * 0.22 + f2 * 0.35 : rm + W * 0.08 - 0;
            const [nx, ny] = pt(p.a + (p.b - p.a) * 0.14, r(p.a) + W * 0.5);
            return (
              <g key={i} data-plot={i} className="plot">
                {d
                  ? <path d={plotPath(p, r)} fill={`url(#${ids.roof})`} stroke={st.roofEdge} strokeWidth="1.6" filter="url(#sc-shadow)" />
                  : <path d={plotPath(p, r)} fill={`url(#${ids.earth})`} stroke={active ? "#e0a64a" : "#7a6342"} strokeWidth={active ? 2.4 : 1} strokeDasharray={active ? undefined : "3 2"} opacity={active ? 1 : 0.92} />}
                {d && active && <path d={plotPath(p, r)} fill="none" stroke="#e0a64a" strokeWidth="2.4" />}
                {d ? (<>
                  <path id={`sc-t${i}a`} d={arcPath(p, r1, bottom)} fill="none" />
                  {l2 && <path id={`sc-t${i}b`} d={arcPath(p, r2, bottom)} fill="none" />}
                  <text fontSize={f1} fontFamily="Georgia, serif" fill={st.label} style={{ paintOrder: "stroke" }} stroke="rgba(40,25,10,.55)" strokeWidth=".9"><textPath href={`#sc-t${i}a`} startOffset="54%" textAnchor="middle">{l1}</textPath></text>
                  {l2 && <text fontSize={f2} fontFamily="Georgia, serif" fill={st.label} style={{ paintOrder: "stroke" }} stroke="rgba(40,25,10,.55)" strokeWidth=".9"><textPath href={`#sc-t${i}b`} startOffset="54%" textAnchor="middle">{l2}</textPath></text>}
                  <circle cx={nx} cy={ny} r="4.6" fill={st.number} stroke="#fff6e6" strokeWidth=".8" />
                  <text x={nx} y={ny + 1.9} textAnchor="middle" fontSize="5.4" fontWeight="700" fontFamily="system-ui, sans-serif" fill="#fff">{i + 1}</text>
                </>) : (<>
                  <text x={pt(mid, rm)[0]} y={pt(mid, rm)[1] + 2.6} textAnchor="middle" fontSize={active ? 8 : 7} fontWeight="700" fontFamily="system-ui, sans-serif" fill={active ? "#a8722e" : "#6e5a3e"}>{i + 1}</text>
                </>)}
              </g>
            );
          })}
          {/* Ворота и площадь */}
          <rect x={gateXY[0] - 13} y={gateXY[1] - 8} width="26" height="16" rx="2" fill={`url(#${ids.wall})`} stroke="#2a1d10" strokeWidth=".8" />
          <path d={`M ${gateXY[0] - 5} ${gateXY[1] + 8} v -7 a 5 5 0 0 1 10 0 v 7 z`} fill="#3b2a1b" />
          <text x={gateXY[0]} y={gateXY[1] + 17} textAnchor="middle" fontSize="6" fontWeight="700" fontFamily="system-ui, sans-serif" fill="#fff6e6" stroke="rgba(40,25,10,.6)" strokeWidth=".8" style={{ paintOrder: "stroke" }}>{t("Ворота")}</text>
          <circle cx={C} cy={C} r={RMIN - 5} fill={`url(#${ids.road})`} stroke="#7a5a36" strokeWidth="1.2" />
          <image href={st.square} x={C - 12} y={C - 17} width="24" height="24" filter="url(#sc-soft)" />
          <text x={C} y={C + 15} textAnchor="middle" fontSize="6" fontWeight="700" fontFamily="system-ui, sans-serif" fill="#3a2d1f">{t("Площадь")}</text>
        </svg>
        <div className="plan-tools">
          <button type="button" className="secondary" aria-label={t("Приблизить")} onClick={() => { const b = view.current!.getBoundingClientRect(); zoomAt(1.4, b.width / 2, b.height / 2); }}><Icon name="plus" /></button>
          <button type="button" className="secondary" aria-label={t("Отдалить")} onClick={() => { const b = view.current!.getBoundingClientRect(); zoomAt(1 / 1.4, b.width / 2, b.height / 2); }}><Icon name="minus" /></button>
          <button type="button" className="secondary" aria-label={t("Весь город")} onClick={() => setCam({ k: 1, tx: 0, ty: 0 })}><Icon name="map" /></button>
        </div>
      </div>
      <div className="plan-foot">
        <span className="small muted">{pile.length ? t("Осталось районов: {n}", { n: pile.length }) : t("Все районы на местах. Проверните замок.")}</span>
        {pinsWrong != null && pinsWrong !== 0 && <span className="small ch-bad" role="status">{pinsWrong < 0 ? t("Заклинило: порядок не тот.") : t("Не на своём месте: {n}.", { n: pinsWrong })}</span>}
      </div>
      {pick !== null && (
        <Sheet size="md" title={t("Участок {n}", { n: pick + 1 })} onClose={() => setPick(null)}>
          {current && byId.get(current) && (
            <div className="card flat mb-2">
              <p className="small muted">{t("На участке")}</p>
              <p><b>{byId.get(current)!.title}</b> <span className="muted">{byId.get(current)!.verses}</span></p>
              <p className="small muted">{byId.get(current)!.summary}</p>
              <div className="actions"><button type="button" className="secondary" onClick={clear}><Icon name="x" />{t("Вернуть в кучу")}</button></div>
            </div>
          )}
          {pile.length > 8 && <div className="field"><label htmlFor="plan-find">{t("Найти район")}</label><input id="plan-find" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" /></div>}
          <div className="plan-pile" role="list">
            {shown.map((d) => (
              <button key={d.id} type="button" className="secondary pick" role="listitem" onClick={() => put(d.id)}>
                <b>{d.title} <span className="muted">{d.verses}</span></b>
                <small>{d.summary}</small>
              </button>
            ))}
            {!shown.length && <p className="muted small">{pile.length ? t("Ничего не найдено") : t("Все районы уже стоят на участках.")}</p>}
          </div>
        </Sheet>
      )}
    </div>
  );
}
