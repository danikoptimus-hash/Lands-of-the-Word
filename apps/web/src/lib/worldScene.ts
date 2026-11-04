/**
 * Сборка сцены для мира на WebGL (WorldGL, этап Э2): общие для обеих карт помощники — разбор пути берега (квадратичные
 * кривые `coastPath` разбиваются на отрезки), цвета из CSS-переменных темы и переключатель режима.
 * Режим: по умолчанию WebGL (решение владельца 05.11 после теста на стенде: «с этой штукой работает просто шикарно»);
 * `?map=svg` — прежний SVG (запоминается на устройстве в localStorage `lotw.map`, `?map=gl` возвращает). Без WebGL или при
 * потере контекста карта сама возвращается к SVG.
 */
import { parseColor, type Pt, type RGBA } from "./glLines";

export function worldMode(): "gl" | "svg" {
  if (typeof location === "undefined") return "svg";
  const m = /[?&]map=(gl|svg)/.exec(location.search)?.[1];
  try {
    if (m) { localStorage.setItem("lotw.map", m); return m as "gl" | "svg"; }
    return localStorage.getItem("lotw.map") === "svg" ? "svg" : "gl";
  } catch { return m === "svg" ? "svg" : "gl"; }
}

/** Путь берега `M x,y Q cx,cy x,y …` (несколько петель) → ломаные; каждая кривая — STEPS отрезков. */
export function coastLoops(d: string, steps = 6): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [], last: Pt | null = null;
  const re = /([MQ])\s*(-?[\d.]+),(-?[\d.]+)(?:\s+(-?[\d.]+),(-?[\d.]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    if (m[1] === "M") { if (cur.length > 1) out.push(cur); cur = [{ x: +m[2]!, y: +m[3]! }]; last = cur[0]!; continue; }
    if (!last) continue;
    const c = { x: +m[2]!, y: +m[3]! }, e = { x: +m[4]!, y: +m[5]! };
    for (let i = 1; i <= steps; i++) { const t = i / steps, u = 1 - t; cur.push({ x: u * u * last.x + 2 * u * t * c.x + t * t * e.x, y: u * u * last.y + 2 * u * t * c.y + t * t * e.y }); }
    last = e;
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Цвет CSS-переменной темы (с запасным значением) в [r, g, b, a]. */
export function themeColor(name: string, fallback: string, alpha?: number): RGBA {
  const v = typeof document !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : "";
  const c = parseColor(v || fallback);
  return alpha === undefined ? c : [c[0], c[1], c[2], alpha];
}
export const rgb = (c: readonly number[], a = 1): RGBA => [c[0]!, c[1]!, c[2]!, a];
