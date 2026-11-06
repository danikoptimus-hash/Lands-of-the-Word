import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { Help } from "../components/Help";
import type { CityDistrictDto } from "../lib/api";

/**
 * Круглый город (решение владельца 06.11): замок порядка для книг с планом `spiral`. Районы — трапеции между витками
 * спирали, которая идёт по часовой стрелке от ворот снаружи к площади в центре; между витками дорога и деревья.
 * Нажатие на участок открывает снизу лист с оставшимися районами, выбранный встаёт на участок; нажатие на занятый —
 * можно вернуть район в кучу. Карту можно приближать и двигать (щипок, перетаскивание, колесо). Текст на домах — по дуге.
 * Проверка — та же кнопка «Провернуть замок» снаружи; ответ сервера «не на месте: N» показан под картой.
 */

const LAND_PRE = "/img/city-plan/landscape.webp";
/** Наборы текстур на выбор (владелец смотрит варианты на стенде: `?cityStyle=a|b|c`); окрестности — один цельный сгенерированный пейзаж,
 *  стена и ворота из песчаника, деревья и черепица — тоже из генератора (06.11, `scripts/img-gen`). */
export const CITY_STYLES = {
  a: { name: "Пергамент", ground: "/img/city-plan/pavement.webp", road: "/img/city-plan/road-gravel.webp", earth: "/img/city-plan/vacant.webp", roof: "/img/city-plan/district.webp", outside: LAND_PRE, roofEdge: "#6e3a26", label: "#fff6e6", number: "#b5583c" },
  b: { name: "Оазис", ground: "/img/terrain/oasis.webp", road: "/img/city-plan/road-gravel.webp", earth: "/img/city-plan/vacant.webp", roof: "/img/city-plan/roof-flat.webp", outside: LAND_PRE, roofEdge: "#7a5a36", label: "#3a2d1f", number: "#7a5226" },
  c: { name: "Глина", ground: "/img/terrain/desert.webp", road: "/img/city-plan/road-gravel.webp", earth: "/img/city-plan/vacant.webp", roof: "/img/city-plan/roof-slate.webp", outside: LAND_PRE, roofEdge: "#2f343c", label: "#f4f6f8", number: "#4f5a66" },
} as const;
export type CityStyle = keyof typeof CITY_STYLES;
export function cityStyleFromQuery(): CityStyle {
  try { const s = new URLSearchParams(window.location.search).get("cityStyle"); return s && s in CITY_STYLES ? (s as CityStyle) : "a"; } catch { return "a"; }
}

/** Геометрия: участок глубиной W, между витками GAP — обочины с травой и дорога шириной ROAD посередине.
 *  Стена стоит за первым витком улицы (WALL_R); ворота внизу, первый участок начинается через GATE_ARC после них. */
const VB = 560, C = VB / 2, R0 = 182, W = 30, GAP = 15, ROAD = 7, PITCH = W + GAP, GAPLEN = 9, RMIN = 38, T0 = Math.PI / 2, GATE_ARC = 0.3;
/** Поперечные дороги между соседними районами (замечание владельца 06.11): дорога и травяная обочина в просвете GAPLEN. */
const LANE = 4.5, LANE_VERGE = 8;
const WALL_R = R0 + W + GAP + 6;
/** Пейзаж — портретная картинка 1024×1536 с пустой площадкой под город (замеры по картинке: центр площадки и её полуось по
 *  ширине — доли ширины/высоты файла). Картинка масштабируется так, чтобы площадка легла под город (LAND_FIT — радиус в единицах
 *  плана, чуть меньше стены), и центрируется по площадке; окно плана бывает выше или шире картинки — тогда по краям её зеркальное
 *  продолжение (площадка далеко от краёв, в отражении не видна). */
const LAND_IMG = { w: 1024, h: 1536, cx: 0.5, cy: 0.47, rx: 0.31 }, LAND_FIT = 226;
const LAND_S = LAND_FIT / (LAND_IMG.rx * LAND_IMG.w), LAND_W = LAND_IMG.w * LAND_S, LAND_H = LAND_IMG.h * LAND_S, LAND_X = C - LAND_IMG.cx * LAND_W, LAND_Y = C - LAND_IMG.cy * LAND_H;
/** Стена — сгенерированный отрезок из песчаника (вид сверху, зубцы по краям, 311×96, бесшовный), выложенный по кругу
 *  WALL_N сегментами шириной WALL_BAND; ворота — отдельный спрайт поверх стены внизу. */
const WALL_SEG = "/img/city-plan/wall-seg.webp", WALL_BAND = 14, WALL_AR = 3.24, WALL_N = Math.round((2 * Math.PI * WALL_R) / (WALL_BAND * WALL_AR));
const GATE = "/img/city-plan/gate.webp", VERGE = "/img/city-plan/grass.webp";
/** Подъездная дорога (замечания владельца 06.11: в пейзаже шла мимо ворот; прямая выглядела топорно): рисуется в плане —
 *  из ворот строго вниз, дальше петляет; пыльная размытая обочина и колеи, чтобы вписаться в пейзаж. */
const APPROACH = `M ${C} 0 V 40 C ${C} 90 ${C + 10} 120 ${C + 4} 170 S ${C - 24} 250 ${C - 14} 320 S ${C + 18} 420 ${C + 6} 500 S ${C - 20} 640 ${C - 8} 760 S ${C + 12} 920 ${C} 1300`;
/** Спрайты города (сгенерированы, см. docs): h — высота в единицах плана при масштабе 1, ar — высота/ширина файла. */
const P = "/img/city-plan/";
const SPR = {
  tree: { href: P + "tree-green.webp", h: 9, ar: 1.01 }, cypress: { href: P + "tree-green2.webp", h: 11, ar: 2.8 }, olive: { href: "/img/props/olive.webp", h: 8, ar: 0.99 }, bush: { href: P + "bush.webp", h: 4.5, ar: 0.875 },
  "woman-jug": { href: P + "woman-jug.webp", h: 5.2, ar: 2.97 }, shepherd: { href: P + "shepherd.webp", h: 5, ar: 1.96 }, merchant: { href: P + "merchant.webp", h: 5, ar: 2.28 }, child: { href: P + "child.webp", h: 4, ar: 2.71 }, elder: { href: P + "elder.webp", h: 5, ar: 2.25 }, "man-basket": { href: P + "man-basket.webp", h: 5.1, ar: 2.19 },
  donkey: { href: P + "donkey.webp", h: 4.6, ar: 1.06 }, camel: { href: P + "camel.webp", h: 6.2, ar: 1.04 }, sheep: { href: P + "sheep.webp", h: 3, ar: 1.07 }, goat: { href: P + "goat.webp", h: 3.4, ar: 1.23 }, dog: { href: P + "dog.webp", h: 2.8, ar: 0.94 }, hen: { href: P + "hen.webp", h: 1.7, ar: 1.31 },
  stall: { href: P + "stall.webp", h: 7.5, ar: 1.06 }, cart: { href: P + "cart.webp", h: 5, ar: 0.864 }, amphorae: { href: P + "amphorae.webp", h: 4, ar: 1.01 }, tent: { href: P + "tent.webp", h: 6.5, ar: 0.807 }, haystack: { href: P + "haystack.webp", h: 4.5, ar: 1.12 }, "palm-pot": { href: P + "palm-pot.webp", h: 5.5, ar: 1.13 },
  fountain: { href: P + "fountain.webp", h: 23, ar: 0.957 },
} as const;
type SprKey = keyof typeof SPR;
type Decor = { x: number; y: number; k: SprKey; s: number };
const FOLK: SprKey[] = ["woman-jug", "shepherd", "merchant", "child", "elder", "man-basket"], BEASTS: SprKey[] = ["donkey", "camel", "sheep", "goat", "dog", "hen"];
/** Путники, идущие по улице от ворот к площади и обратно (SMIL animateMotion по дороге); при prefers-reduced-motion стоят. */
const MOVERS: Array<{ k: SprKey; dur: number; begin: number }> = [{ k: "camel", dur: 170, begin: -30 }, { k: "donkey", dur: 140, begin: -95 }, { k: "shepherd", dur: 200, begin: -150 }, { k: "sheep", dur: 200, begin: -147 }, { k: "sheep", dur: 200, begin: -145 }, { k: "woman-jug", dur: 120, begin: -20 }];
function Sprite({ d }: { d: Decor }) { const q = SPR[d.k]; const h = q.h * d.s, w = h / q.ar; return <image href={q.href} x={d.x - w / 2} y={d.y - h * 0.9} width={w} height={h} filter="url(#sc-soft)" pointerEvents="none" />; }
type Plot = { a: number; b: number };

/** Спираль Архимеда: шаг витка — глубина участка плюс дорога; длина участка подбирается так, чтобы вместить все районы. */
function spiral(n: number): { plots: Plot[]; r: (th: number) => number } {
  const k = PITCH / (2 * Math.PI);
  const r = (th: number) => R0 - k * (th - T0);
  const build = (len: number) => {
    const out: Plot[] = []; let th = T0 + GATE_ARC;
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
const KMAX = 4;
type Win = { x: number; y: number; w: number; h: number };
/** Вписать окно в новые границы, сохранив центр и масштаб (контейнер поменял размер — карусель открылась). */
function fitWin(prev: Win, bs: Win): Win {
  const zoom = Math.min(KMAX, Math.max(1, prev.w > 0 ? bs.w / prev.w : 1));
  const w = bs.w / zoom, h = bs.h / zoom;
  const cx = prev.x + prev.w / 2, cy = prev.y + prev.h / 2;
  const x = Math.min(bs.x + bs.w - w, Math.max(bs.x, cx - w / 2)), y = Math.min(bs.y + bs.h - h, Math.max(bs.y, cy - h / 2));
  return { x, y, w, h };
}
/** Одна строка подписи: кегль до 5.2, если не влезает даже 3.4 — обрезаем по словам с многоточием. */
function oneLine(title: string, usable: number, fmax = 5.2): { f: number; text: string } {
  for (let f = fmax; f >= 3.4; f -= 0.2) if (textW(title) * f <= usable) return { f, text: title };
  const words = title.split(" "); let cut = "";
  for (const w of words) { const t = (cut ? cut + " " : "") + w; if (textW(t + "…") * 3.4 > usable) break; cut = t; }
  return { f: 3.4, text: (cut || title.slice(0, 8)) + "…" };
}
/** Короткое имя района: первые слова до 14 знаков. */
function shortTitle(title: string): string {
  const words = title.replace(/[.:,;].*$/, "").split(" "); let out = "";
  for (const w of words) { const t = (out ? out + " " : "") + w; if (t.length > 14 && out) break; out = t; }
  return out;
}
/** Подпись района: владелец выбрал из десяти вариант 4 — пергаментный свиток по центру (06.11); остальные доступны по `?label=1..10`. */
function labelStyleFromQuery(): number {
  try { const n = Number(new URLSearchParams(window.location.search).get("label")); return n >= 1 && n <= 10 ? n : 4; } catch { return 4; }
}
/** Детерминированный «случайный» ряд для деревьев и полей — одинаковый на всех устройствах. */
function rnd(seed: number): () => number { let h = seed >>> 0 || 1; return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; }; }
/** Ширина строки при кегле 1 — замер тем же шрифтом через canvas (подписи раньше обрезались по оценке «0,62 на букву»). */
let measurer: CanvasRenderingContext2D | null | undefined;
function textW(s: string): number {
  if (measurer === undefined) { try { measurer = document.createElement("canvas").getContext("2d"); if (measurer) measurer.font = "100px Georgia, serif"; } catch { measurer = null; } }
  return measurer ? measurer.measureText(s).width / 100 : s.length * 0.58;
}
/** Подпись района: один кегль на все строки, до четырёх строк; строки выровнены по ширине (минимальная самая длинная). */
function fitTitle(title: string, usable: number, depth: number): { f: number; lines: string[] } {
  const words = title.split(" ");
  const split = (L: number, f: number): string[] | null => {
    if (L === 1) return textW(title) * f <= usable ? [title] : null;
    let best: string[] | null = null, bestW = Infinity;
    const rec = (from: number, left: number, acc: string[]) => {
      if (left === 1) { const line = words.slice(from).join(" "); const w = Math.max(...acc.map((l) => textW(l)), textW(line)) * f; if (w <= usable && w < bestW) { bestW = w; best = [...acc, line]; } return; }
      for (let i = from + 1; i <= words.length - left + 1; i++) { const line = words.slice(from, i).join(" "); if (textW(line) * f > usable) break; rec(i, left - 1, [...acc, line]); }
    };
    rec(0, L, []); return best;
  };
  for (let f = 7.2; f >= 3.4; f -= 0.2) {
    for (let L = 1; L <= Math.min(4, words.length); L++) {
      if (L * f * 1.12 > depth - 5) break;
      const lines = split(L, f); if (lines) return { f, lines };
    }
  }
  return { f: 3.4, lines: [title] };
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

  // Озеленение и жизнь улиц (замечания владельца 06.11): трава на обочинах, кусты и деревья, жители и животные на дороге,
  // телеги, амфоры и стога у обочин, лотки, шатёр и фонтан на площади — всё по фиксированному зерну, одинаково на всех устройствах.
  const decor = useMemo(() => {
    const g = rnd(47 + n);
    const k = PITCH / (2 * Math.PI);
    const roadR = (th: number) => R0 - k * (th - T0) + W + GAP / 2;
    const out: Decor[] = [];
    const put = (th: number, rad: number, kind: SprKey, s = 0.85 + g() * 0.3) => { const [x, y] = pt(th, rad); out.push({ x, y, k: kind, s }); };
    for (let th = T0 + 0.1; roadR(th) > RMIN + 2; th += 0.11) {
      if (g() > 0.62) continue;
      const side = g() < 0.5 ? -1 : 1;
      const tree = g() < 0.3;
      put(th, roadR(th) + side * (GAP / 2 - 1.2), tree ? (["tree", "cypress", "olive"] as const)[Math.floor(g() * 3)]! : "bush");
    }
    for (let th = T0 + 0.4; roadR(th) > RMIN + 4; th += 0.19) {
      if (g() > 0.42) continue;
      const kind = g() < 0.55 ? FOLK[Math.floor(g() * FOLK.length)]! : BEASTS[Math.floor(g() * BEASTS.length)]!;
      put(th, roadR(th) + (g() - 0.5) * (ROAD - 2.5), kind);
      if (kind === "sheep" || kind === "goat") for (let j = 0, m = 1 + Math.floor(g() * 2); j < m; j++) put(th + (g() - 0.5) * 0.06, roadR(th) + (g() - 0.5) * (ROAD - 2), kind);
    }
    for (let th = T0 + 0.6; roadR(th) > RMIN + 6; th += 0.33) {
      if (g() > 0.3) continue;
      const side = g() < 0.5 ? -1 : 1;
      put(th, roadR(th) + side * (GAP / 2 - 1.6), (["cart", "amphorae", "haystack", "palm-pot"] as const)[Math.floor(g() * 4)]!);
    }
    // площадь: фонтан в центре, вокруг — лотки, шатёр, пальма, амфоры и люди
    out.push({ x: C, y: C + 9, k: "fountain", s: 1 });
    put(0.45, 20, "stall", 1); put(2.5, 20, "stall", 1); put(4.1, 19, "tent", 1); put(5.35, 19, "palm-pot", 1); put(1.55, 20, "amphorae", 1); put(3.3, 18, "haystack", 0.9);
    for (let i = 0; i < 7; i++) put(g() * Math.PI * 2, 13.5 + g() * 4, i < 5 ? FOLK[Math.floor(g() * FOLK.length)]! : (["dog", "hen"] as const)[i - 5]!);
    out.sort((a, b) => a.y - b.y);
    return out;
  }, [n]);
  const motion = useMemo(() => { try { return !window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return true; } }, []);
  const LABEL = useMemo(() => labelStyleFromQuery(), []);

  // Окно плана на весь экран (решение владельца 06.11): видовое окно повторяет пропорции контейнера, город по центру,
  // сверху и снизу (или по бокам) — пейзаж, а не пустые поля.
  const [aspect, setAspect] = useState(1);
  useEffect(() => {
    const el = view.current; if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => { const r = es[0]?.contentRect; if (r && r.width > 0 && r.height > 0) setAspect(Math.round((r.height / r.width) * 100) / 100); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const base = useMemo(() => (aspect >= 1 ? { x: 0, y: C - (VB * aspect) / 2, w: VB, h: VB * aspect } : { x: C - VB / aspect / 2, y: 0, w: VB / aspect, h: VB }), [aspect]);
  const vb = base;

  // Приближение и перетаскивание: один палец — двигает, два — масштаб, колесо — масштаб у курсора.
  // Во время жеста план двигает CSS-трансформация (быстро), по окончании масштаб и сдвиг «запекаются» в видовое окно SVG
  // (win) — тогда браузер рисует векторы и текстуры в полном разрешении, а не растягивает растр (замечание владельца 06.11:
  // при самом сильном приближении всё было размыто).
  const view = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState({ k: 1, tx: 0, ty: 0 });
  const camRef = useRef(cam); camRef.current = cam;
  const [win, setWin] = useState(base);
  const winRef = useRef(win); winRef.current = win;
  const baseRef = useRef(base); baseRef.current = base;
  useEffect(() => { setWin((prev) => fitWin(prev, base)); }, [base]);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ k: number; tx: number; ty: number; mx: number; my: number; dist: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const tapTimer = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);
  const bakeTimer = useRef<number | null>(null);
  const boxPx = () => { const b = view.current?.getBoundingClientRect(); return { w: b?.width ?? 1, h: b?.height ?? 1 }; };
  const clampCam = (c: { k: number; tx: number; ty: number }) => {
    const { w } = boxPx(); const wn = winRef.current, bs = baseRef.current; const sc = w / wn.w;
    const kMin = wn.w / bs.w, kMax = (KMAX * wn.w) / bs.w;
    const k = Math.min(kMax, Math.max(kMin, c.k));
    const txMax = (wn.x - bs.x) * k * sc, txMin = -(bs.x + bs.w - wn.x - wn.w / k) * k * sc;
    const tyMax = (wn.y - bs.y) * k * sc, tyMin = -(bs.y + bs.h - wn.y - wn.h / k) * k * sc;
    return { k, tx: Math.min(txMax, Math.max(txMin, c.tx)), ty: Math.min(tyMax, Math.max(tyMin, c.ty)) };
  };
  /** Запечь трансформацию в видовое окно: картинка не меняется, но дальше рисуется в полном разрешении. */
  const bake = () => {
    const c = camRef.current; if (c.k === 1 && c.tx === 0 && c.ty === 0) return;
    const { w } = boxPx(); const wn = winRef.current; const sc = w / wn.w;
    const next = { x: wn.x - c.tx / (c.k * sc), y: wn.y - c.ty / (c.k * sc), w: wn.w / c.k, h: wn.h / c.k };
    setWin(fitWin(next, baseRef.current)); setCam({ k: 1, tx: 0, ty: 0 });
  };
  const scheduleBake = (ms = 90) => { if (bakeTimer.current) window.clearTimeout(bakeTimer.current); bakeTimer.current = window.setTimeout(() => { bakeTimer.current = null; if (ptrs.current.size === 0) bake(); }, ms); };
  const zoom = (baseRef.current.w / win.w) * cam.k; // общий масштаб относительно «весь город»
  const zoomAt = (factor: number, px: number, py: number) => {
    const c = camRef.current; const next = clampCam({ k: c.k * factor, tx: 0, ty: 0 }); const f = next.k / c.k;
    setCam(clampCam({ k: next.k, tx: px - (px - c.tx) * f, ty: py - (py - c.ty) * f })); scheduleBake();
  };
  const local = (e: { clientX: number; clientY: number }) => { const b = view.current!.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  const cancelHold = () => { if (holdTimer.current) { window.clearTimeout(holdTimer.current); holdTimer.current = null; } };
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    view.current?.setPointerCapture(e.pointerId);
    const p = local(e); ptrs.current.set(e.pointerId, p);
    const all = [...ptrs.current.values()]; const c = camRef.current;
    if (bakeTimer.current) { window.clearTimeout(bakeTimer.current); bakeTimer.current = null; }
    cancelHold(); held.current = false;
    if (all.length === 1) {
      gesture.current = { ...c, mx: p.x, my: p.y, dist: 0, moved: false };
      // Долгое нажатие на занятый участок возвращает район в кучу (решение владельца 06.11).
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-plot]") as HTMLElement | null;
      if (el && !disabled) {
        const idx = Number(el.dataset.plot);
        holdTimer.current = window.setTimeout(() => {
          holdTimer.current = null; if (!gesture.current || gesture.current.moved || slots[idx] == null) return;
          held.current = true; const out = slots.slice(); out[idx] = null; onChange(out); setPick(null);
          try { navigator.vibrate?.(30); } catch { /* не везде есть */ }
        }, 550);
      }
    } else if (all.length === 2) { const [a, b] = all as [{ x: number; y: number }, { x: number; y: number }]; gesture.current = { ...c, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y), moved: true }; }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId) || !gesture.current) return;
    const p = local(e); ptrs.current.set(e.pointerId, p);
    const all = [...ptrs.current.values()]; const g = gesture.current;
    if (all.length === 1) {
      const dx = p.x - g.mx, dy = p.y - g.my;
      if (Math.hypot(dx, dy) > 6) { g.moved = true; cancelHold(); }
      if (g.moved) setCam(clampCam({ k: g.k, tx: g.tx + dx, ty: g.ty + dy }));
    } else if (all.length >= 2) {
      cancelHold();
      const [a, b] = all as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y); const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const next = clampCam({ k: g.k * (dist / Math.max(1, g.dist)), tx: 0, ty: 0 }); const f = next.k / g.k;
      setCam(clampCam({ k: next.k, tx: mx - (g.mx - g.tx) * f, ty: my - (g.my - g.ty) * f }));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current; ptrs.current.delete(e.pointerId); cancelHold();
    if (ptrs.current.size === 0) {
      gesture.current = null;
      if (held.current) { held.current = false; scheduleBake(); return; }
      if (g && !g.moved) {
        // Двойное нажатие приближает (кнопок нет — решение владельца 06.11), одиночное открывает участок после короткой паузы.
        const p = local(e); const now = Date.now(); const last = lastTap.current;
        if (last && now - last.t < 320 && Math.hypot(p.x - last.x, p.y - last.y) < 24) {
          lastTap.current = null; if (tapTimer.current) { window.clearTimeout(tapTimer.current); tapTimer.current = null; }
          const z = (baseRef.current.w / winRef.current.w) * camRef.current.k;
          if (z > 1.5) { setWin(baseRef.current); setCam({ k: 1, tx: 0, ty: 0 }); } else zoomAt(2.4 / z, p.x, p.y);
        } else {
          lastTap.current = { t: now, x: p.x, y: p.y };
          const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-plot]") as HTMLElement | null;
          if (el && !disabled) { const idx = Number(el.dataset.plot); tapTimer.current = window.setTimeout(() => { tapTimer.current = null; setPick(idx); setFilter(""); }, 280); }
        }
      } else scheduleBake();
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
  const ids = { ground: "sc-ground", road: "sc-road", earth: "sc-earth", verge: "sc-verge" };
  const gateXY = pt(T0, WALL_R);

  return (
    <div className="plan-wrap">
      {hint && <p className="hint">{hint}{help && <Help>{help}</Help>}</p>}
      <div ref={view} className={"plan-view" + (state === "jam" ? " jam" : state === "open" ? " open" : "")} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onContextMenu={(e) => e.preventDefault()} role="group" aria-label={t("План города: участки по спирали от ворот к площади")}>
        <svg viewBox={`${win.x.toFixed(2)} ${win.y.toFixed(2)} ${win.w.toFixed(2)} ${win.h.toFixed(2)}`} style={{ transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.k})` }} aria-hidden="true">
          <defs>
            {/* Текстуры 1024 px (сгенерированы, вид строго сверху): тайлы крупные, чтобы при приближении ×4 не мылились */}
            <pattern id={ids.verge} patternUnits="userSpaceOnUse" width="40" height="40"><image href={VERGE} width="40" height="40" /></pattern>
            <pattern id={ids.ground} patternUnits="userSpaceOnUse" width="80" height="80"><image href={st.ground} width="80" height="80" /></pattern>
            <pattern id={ids.road} patternUnits="userSpaceOnUse" width="30" height="30"><image href={st.road} width="30" height="30" /></pattern>
            <pattern id={ids.earth} patternUnits="userSpaceOnUse" width="48" height="48"><image href={st.earth} width="48" height="48" /></pattern>
            {/* Квартал (дома и улочки, вид сверху) на каждом занятом участке повёрнут вдоль участка, чтобы улочки шли по дуге и по радиусу */}
            {plots.map((p, i) => slots[i] ? <pattern key={i} id={`sc-dist-${i}`} patternUnits="userSpaceOnUse" width="60" height="60" patternTransform={`rotate(${((((p.a + p.b) / 2) * 180) / Math.PI + 90).toFixed(1)})`}><image href={st.roof} width="60" height="60" /></pattern> : null)}
            <filter id="sc-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="1.2" dy="1.8" stdDeviation="1.2" floodColor="#2a1d10" floodOpacity=".45" /></filter>
            <filter id="sc-soft" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#2a1d10" floodOpacity=".35" /></filter>
            <filter id="sc-dust" x="-60%" y="-5%" width="220%" height="110%"><feGaussianBlur stdDeviation="3.2" /></filter>
            <filter id="sc-glow" x="-20%" y="-40%" width="140%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="1.1" floodColor="#1a0f06" floodOpacity=".95" /></filter>
            <filter id="sc-edge" x="-60%" y="-5%" width="220%" height="110%"><feGaussianBlur stdDeviation=".6" /></filter>
            <radialGradient id="sc-vignette" cx="50%" cy="50%" r="50%"><stop offset=".75" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".18" /></radialGradient>
          </defs>
          {/* Окрестности — один цельный пейзаж (06.11): в центре пустая площадка под город, вокруг луга, рощи, поля, холмы;
              дорога к воротам нарисована в нём. За краями картинки — её зеркальное продолжение. */}
          <image href={st.outside} x={LAND_X} y={LAND_Y} width={LAND_W} height={LAND_H} preserveAspectRatio="none" />
          {vb.y < LAND_Y && <image href={st.outside} x={LAND_X} y={-LAND_Y} width={LAND_W} height={LAND_H} transform="scale(1 -1)" preserveAspectRatio="none" />}
          {vb.y + vb.h > LAND_Y + LAND_H && <image href={st.outside} x={LAND_X} y={-LAND_Y - 2 * LAND_H} width={LAND_W} height={LAND_H} transform="scale(1 -1)" preserveAspectRatio="none" />}
          {vb.x < LAND_X && <image href={st.outside} x={-LAND_X} y={LAND_Y} width={LAND_W} height={LAND_H} transform="scale(-1 1)" preserveAspectRatio="none" />}
          {vb.x + vb.w > LAND_X + LAND_W && <image href={st.outside} x={-LAND_X - 2 * LAND_W} y={LAND_Y} width={LAND_W} height={LAND_H} transform="scale(-1 1)" preserveAspectRatio="none" />}
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={`url(#${ids.verge})`} opacity=".16" pointerEvents="none" />
          {/* Подъездная дорога от ворот вниз: начало под воротами, дальше — за край окна */}
          <g transform={`translate(0 ${WALL_R + C - 8})`} pointerEvents="none">
            <path d={APPROACH} fill="none" stroke="#c9ad6e" strokeWidth={ROAD + 16} strokeLinecap="round" opacity=".45" filter="url(#sc-dust)" />
            <path d={APPROACH} fill="none" stroke="#5a4628" strokeWidth={ROAD + 4} strokeLinecap="round" opacity=".2" filter="url(#sc-edge)" />
            <path d={APPROACH} fill="none" stroke={`url(#${ids.road})`} strokeWidth={ROAD + 2} strokeLinecap="round" filter="url(#sc-edge)" />
            <path d={APPROACH} fill="none" stroke="#4a3a22" strokeWidth="5" strokeLinecap="round" opacity=".16" />
            <path d={APPROACH} fill="none" stroke="#d8bf84" strokeWidth="2.4" strokeLinecap="round" opacity=".3" />
          </g>
          {/* Город: земля, стена, дорога-спираль */}
          <circle cx={C} cy={C} r={WALL_R + 2} fill={`url(#${ids.ground})`} />
          <circle cx={C} cy={C} r={WALL_R + 2} fill="url(#sc-vignette)" />
          <circle cx={C} cy={C} r={WALL_R} fill="none" stroke="#3b2a1b" strokeWidth={WALL_BAND + 3} opacity=".45" />
          {Array.from({ length: WALL_N }, (_, i) => {
            const th = (i / WALL_N) * 2 * Math.PI, [x, y] = pt(th, WALL_R), len = (2 * Math.PI * WALL_R) / WALL_N + 0.8;
            return <image key={i} href={WALL_SEG} x={-len / 2} y={-WALL_BAND / 2} width={len} height={WALL_BAND} preserveAspectRatio="none" transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${((th * 180) / Math.PI + 90).toFixed(1)})`} pointerEvents="none" />;
          })}
          {(() => { const k = PITCH / (2 * Math.PI); const pts: [number, number][] = []; for (let th = T0 - 0.05; R0 - k * (th - T0) + W + GAP / 2 > RMIN - 8; th += 0.05) pts.push(pt(th, R0 - k * (th - T0) + W + GAP / 2)); const d = "M " + pts.map(fmt).join(" L "); return (<>
            <path id="sc-roadpath" d={d} fill="none" stroke={`url(#${ids.verge})`} strokeWidth={GAP + 2} strokeLinecap="round" />
            <path d={d} fill="none" stroke="#6b5a3a" strokeWidth={ROAD + 1.2} strokeLinecap="round" opacity=".35" />
            <path d={d} fill="none" stroke={`url(#${ids.road})`} strokeWidth={ROAD} strokeLinecap="round" />
          </>); })()}
          {/* Переулки между соседними районами: от улицы снаружи к улице внутри, под участками */}
          {plots.slice(0, -1).map((p, i) => {
            const th = (p.b + plots[i + 1]!.a) / 2, a = pt(th, r(th) - GAP / 2 + 1), b = pt(th, r(th) + W + GAP / 2 - 1);
            return (<g key={i} pointerEvents="none">
              <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={`url(#${ids.verge})`} strokeWidth={LANE_VERGE} />
              <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#6b5a3a" strokeWidth={LANE + 1} opacity=".3" />
              <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={`url(#${ids.road})`} strokeWidth={LANE} />
            </g>);
          })}
          {/* Участки */}
          {plots.map((p, i) => {
            const id = slots[i] ?? null; const d = id ? byId.get(id) : undefined;
            const mid = (p.a + p.b) / 2; const rm = r(mid) + W / 2; const bottom = Math.sin(mid) > 0;
            const active = !disabled && (pick === i || (pick === null && i === nextFree));
            // Подпись: значок номера занимает начало дуги (у p.a), текст — по центру остатка; строки одним кеглем, замер шириной.
            const phiM = 3 / rm, span = p.b - p.a - 2 * phiM;
            const fit = d ? fitTitle(d.title, span * (rm - 6), W) : null;
            const off = 50;
            // Номер — мелко в наружном уголке у начала участка (решение владельца 06.11: не засорять вид, пусть приближают)
            const [nx, ny] = pt(p.a + 4.2 / (r(p.a) + W), r(p.a) + W - 4.2);
            return (
              <g key={i} data-plot={i} className="plot">
                {d
                  ? <path d={plotPath(p, r)} fill={`url(#sc-dist-${i})`} stroke={st.roofEdge} strokeWidth="1.4" filter="url(#sc-shadow)" />
                  : <path d={plotPath(p, r)} fill={`url(#${ids.earth})`} stroke={active ? "#e0a64a" : "#8a7048"} strokeWidth={active ? 2.4 : 1.1} strokeDasharray={active ? undefined : "3 2"} />}
                {d && active && <path d={plotPath(p, r)} fill="none" stroke="#e0a64a" strokeWidth="2.4" />}
                {d && fit ? (<>
                  {LABEL === 10 && <path d={plotPath(p, r)} fill="#1a0f06" opacity=".32" pointerEvents="none" />}
                  {(() => {
                    const L = fit.lines.length, lh = fit.f * 1.12;
                    const lineR = (li: number) => (bottom ? rm - ((L - 1) / 2 - li) * lh : rm + ((L - 1) / 2 - li) * lh);
                    const outline = { stroke: "rgba(40,25,10,.6)", strokeWidth: ".9", style: { paintOrder: "stroke" as const } };
                    const arcText = (text: string, f: number, rho: number, key: string, extra: Record<string, unknown> = {}, fill: string = st.label) => (
                      <g key={key}><path id={`sc-t${i}-${key}`} d={arcPath(p, rho, bottom)} fill="none" />
                        <text fontSize={f} fontFamily="Georgia, serif" fill={fill} {...extra}><textPath href={`#sc-t${i}-${key}`} startOffset="50%" textAnchor="middle">{text}</textPath></text></g>);
                    const bandOf = (w: number, c: number) => Math.min(100, ((w + 3) / ((p.b - p.a) * c)) * 100);
                    const rhoOf = (c: number, f: number) => (bottom ? c + f * 0.35 : c - f * 0.35);
                    if (LABEL === 3) { // табличка у наружного края: светлая полоса, тёмный текст, одна строка
                      const c = r(mid) + W - 3.4, one = oneLine(d.title, span * c, 4.4), w = textW(one.text) * one.f, band = bandOf(w, c);
                      return (<g key="l3"><path d={arcPath(p, c, bottom)} pathLength={100} fill="none" stroke="#f3e6c4" opacity=".9" strokeWidth={one.f * 1.3} strokeLinecap="round" strokeDasharray={`${band.toFixed(1)} ${(100 - band).toFixed(1)}`} strokeDashoffset={-(50 - band / 2)} />
                        {arcText(one.text, one.f, rhoOf(c, one.f), "a", {}, "#3a2a14")}</g>);
                    }
                    if (LABEL === 4) { // свиток по центру: пергаментный прямоугольник по касательной, строки прямые
                      const [cx, cy] = pt(mid, rm); let deg = (mid * 180) / Math.PI + 90; while (deg > 90) deg -= 180; while (deg <= -90) deg += 180;
                      const lines = fit.lines, f = Math.min(fit.f, 4.6), lw = Math.max(...lines.map((l) => textW(l) * f)), bw = lw + 4, bh = lines.length * f * 1.15 + 2.2;
                      return (<g key="l4" transform={`translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${deg.toFixed(1)})`}>
                        <rect x={-bw / 2} y={-bh / 2} width={bw} height={bh} rx="1.4" fill="#f3e6c4" stroke="#8a6a3a" strokeWidth=".5" opacity=".93" />
                        {lines.map((l, li) => <text key={li} x="0" y={-bh / 2 + 1.1 + f * 0.95 + li * f * 1.15} textAnchor="middle" fontSize={f} fontFamily="Georgia, serif" fill="#3a2a14">{l}</text>)}</g>);
                    }
                    if (LABEL === 5 && zoom < 1.8) return null; // только при приближении: вблизи — контур, вдали — лишь номер
                    if (LABEL === 6) { // имя на улице: вдоль дороги снаружи участка, участок не тронут
                      const c = r(mid) + W + GAP / 2, one = oneLine(d.title, (p.b - p.a) * c - 4, 4.2);
                      return arcText(one.text, one.f, rhoOf(c, one.f), "s", { stroke: "rgba(243,230,196,.85)", strokeWidth: ".8", style: { paintOrder: "stroke" as const } }, "#2b1d10");
                    }
                    if (LABEL === 8) { // короткое имя одной строкой
                      const one = oneLine(shortTitle(d.title), span * rm, 5.2);
                      return arcText(one.text, one.f, rhoOf(rm, one.f), "k", outline);
                    }
                    return fit.lines.map((line, li) => {
                      const c = lineR(li), rho = rhoOf(c, fit.f), w = textW(line) * fit.f;
                      if (LABEL === 1) return (<g key={li}>
                        <path d={arcPath(p, c, bottom)} pathLength={100} fill="none" stroke="rgba(30,18,8,.5)" strokeWidth={fit.f * 1.22} strokeLinecap="round" strokeDasharray={`${bandOf(w, c).toFixed(1)} ${(100 - bandOf(w, c)).toFixed(1)}`} strokeDashoffset={-(50 - bandOf(w, c) / 2)} />
                        {arcText(line, fit.f, rho, `${li}`, outline)}</g>);
                      if (LABEL === 7) return arcText(line, fit.f, rho, `${li}`, { filter: "url(#sc-glow)" }, "#fff6e6");
                      if (LABEL === 9) return (<g key={li}>{arcText(line, fit.f, rho, `${li}d`, { transform: "translate(.45 .55)" }, "#2a170a")}{arcText(line, fit.f, rho, `${li}`, {}, "#fff3dc")}</g>);
                      return arcText(line, fit.f, rho, `${li}`, outline); // 2, 5 (вблизи), 10
                    });
                  })()}
                  <circle cx={nx} cy={ny} r={LABEL === 5 && zoom < 1.8 ? 3.6 : 2.7} fill={st.number} stroke="#fff6e6" strokeWidth=".5" />
                  <text x={nx} y={ny + (LABEL === 5 && zoom < 1.8 ? 1.4 : 1.1)} textAnchor="middle" fontSize={LABEL === 5 && zoom < 1.8 ? 4 : 3.1} fontWeight="700" fontFamily="system-ui, sans-serif" fill="#fff">{i + 1}</text>
                </>) : (<>
                  <circle cx={nx} cy={ny} r="2.7" fill={active ? "#e0a64a" : "#a89270"} stroke="#fff6e6" strokeWidth=".5" />
                  <text x={nx} y={ny + 1.1} textAnchor="middle" fontSize="3.1" fontWeight="700" fontFamily="system-ui, sans-serif" fill="#fff">{i + 1}</text>
                </>)}
              </g>
            );
          })}
          {/* Жизнь города: растения, жители, животные, предметы, фонтан — по порядку сверху вниз, чтобы ближние перекрывали дальних */}
          {decor.map((q, i) => <Sprite key={i} d={q} />)}
          {/* Ворота (сгенерированы, фронтально, 640×459) стоят на стене внизу: основание чуть снаружи стены, башни над ней */}
          <image href={GATE} x={gateXY[0] - 32} y={gateXY[1] - 37} width="64" height="45.9" filter="url(#sc-soft)" pointerEvents="none" />
          {/* Путники идут по улице от ворот к площади и обратно; птицы кружат над городом */}
          {motion && MOVERS.map((m, i) => { const q = SPR[m.k]; const h = q.h, w = h / q.ar; return (
            <g key={i} pointerEvents="none">
              <image href={q.href} x={-w / 2} y={-h * 0.9} width={w} height={h} filter="url(#sc-soft)" />
              <animateMotion dur={`${m.dur}s`} begin={`${m.begin}s`} repeatCount="indefinite" keyPoints="0;1;0" keyTimes="0;0.5;1" calcMode="linear"><mpath href="#sc-roadpath" /></animateMotion>
            </g>); })}
          {motion && [[0, 118, 76, 52], [0.9, 150, 95, 67], [2.1, 96, 62, 44]].map(([ph, rx, ry, dur], i) => (
            <g key={i} pointerEvents="none" opacity=".75">
              <path d="M-1.3 -2.2 Q0 -0.9 0.1 0 Q0 0.9 -1.3 2.2" fill="none" stroke="#2b2118" strokeWidth=".6" strokeLinecap="round" />
              <animateMotion dur={`${dur}s`} begin={`${-ph! * 10}s`} repeatCount="indefinite" rotate="auto" path={`M ${C - rx!} ${C} A ${rx} ${ry} 0 1 1 ${C + rx!} ${C} A ${rx} ${ry} 0 1 1 ${C - rx!} ${C}`} />
            </g>))}
        </svg>
      </div>
      <div className="plan-foot">
        <span className="small muted">{pile.length ? t("Осталось районов: {n}", { n: pile.length }) : t("Все районы на местах. Проверните замок.")}</span>
        {pinsWrong != null && pinsWrong !== 0 && <span className="small ch-bad" role="status">{pinsWrong < 0 ? t("Заклинило: порядок не тот.") : t("Не на своём месте: {n}.", { n: pinsWrong })}</span>}
      </div>
      {pick !== null && (
        <div className="plan-strip" role="region" aria-label={t("Участок {n}", { n: pick + 1 })}>
          {/* Карусель плиток (решение владельца 06.11): миниатюрная, под картой, а не лист на полэкрана */}
          <div className="strip-head">
            <b>{t("Участок {n}", { n: pick + 1 })}</b>
            <input id="plan-find" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("Найти район")} aria-label={t("Найти район")} autoComplete="off" />
            <button type="button" className="ghost icon sm" onClick={() => setPick(null)} aria-label={t("Закрыть")}><Icon name="x" /></button>
          </div>
          <div className="plan-pile" role="list">
            {current && byId.get(current) && (
              <div className="tile current" role="listitem">
                <b>{byId.get(current)!.title}</b><span className="muted">{byId.get(current)!.verses}</span>
                <button type="button" className="ghost sm" onClick={clear}>{t("Вернуть в кучу")}</button>
              </div>
            )}
            {shown.map((d) => (
              <button key={d.id} type="button" className="secondary tile pick" role="listitem" onClick={() => put(d.id)}>
                <b>{d.title}</b><span className="muted">{d.verses}</span>
              </button>
            ))}
            {!shown.length && <p className="muted small">{pile.length ? t("Ничего не найдено") : t("Все районы уже стоят на участках.")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
