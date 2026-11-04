/**
 * Нажатия на карте в коде (этап Э1 плана docs/proposals/map-gpu.md): вместо невидимых широких линий и путей в SVG
 * (`line.hit`, `path.hit`, `.edge-hit`) точка нажатия проверяется по геометрии. Области и приоритет — те же, что были у
 * элементов SVG: картинка города — её прямоугольник; морской путь и сторона — полоса шириной `band` экранных пикселей
 * с круглыми концами и стыками (`stroke-linecap: round`), в единицах карты `band / k_стилей`; верхний элемент выигрывает:
 * города → морские пути → стороны, внутри слоя — последний по порядку (он в SVG был выше).
 */
export interface Pt { x: number; y: number }
export interface HitRect<T> { x: number; y: number; w: number; h: number; id: T }
export interface HitLine<T> { pts: ReadonlyArray<Pt>; id: T }
export interface HitModel<T> { rects: ReadonlyArray<HitRect<T>>; routes: ReadonlyArray<HitLine<T>>; edges: ReadonlyArray<HitLine<T>> }

/** Расстояние от точки до отрезка (с круглыми концами — просто до ближайшей точки отрезка). */
export function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
/** Расстояние от точки до ломаной. */
export function polylineDistance(p: Pt, pts: ReadonlyArray<Pt>): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segmentDistance(p, pts[i - 1]!, pts[i]!));
  return best;
}
/**
 * Что нажато в точке карты p. band — ширина полосы нажатия в экранных пикселях (22 у команды, 18 у администратора),
 * kStyles — масштаб, под который сейчас посчитаны толщины (`--k`): полоса на экране всегда band пикселей.
 */
export function hitTest<T>(p: Pt, model: HitModel<T>, band: number, kStyles: number): T | null {
  for (let i = model.rects.length - 1; i >= 0; i--) { const r = model.rects[i]!; if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return r.id; }
  const half = band / 2 / kStyles;
  for (let i = model.routes.length - 1; i >= 0; i--) { const l = model.routes[i]!; if (l.pts.length && polylineDistance(p, l.pts) <= half) return l.id; }
  for (let i = model.edges.length - 1; i >= 0; i--) { const l = model.edges[i]!; if (l.pts.length && polylineDistance(p, l.pts) <= half) return l.id; }
  return null;
}
/**
 * Точка карты по координатам нажатия: host — контейнер карты, view — текущий вид (ref, не зафиксированный).
 * kStyles — `--k` мирового SVG (ступенька толщин); до первой установки — масштаб вида.
 */
export function mapPoint(host: Element, view: { k: number; tx: number; ty: number }, clientX: number, clientY: number): Pt {
  const r = host.getBoundingClientRect();
  return { x: (clientX - r.left - view.tx) / view.k, y: (clientY - r.top - view.ty) / view.k };
}
export function stylesK(svg: SVGSVGElement | null, fallback: number): number {
  const v = svg ? parseFloat(svg.style.getPropertyValue("--k")) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
