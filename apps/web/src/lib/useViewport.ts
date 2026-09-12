import { useCallback, useEffect, useRef, useState } from "react";

export interface View { k: number; tx: number; ty: number }
export interface Bounds { minX: number; minY: number; width: number; height: number }

/**
 * Перетаскивание, колесо, щипок двумя пальцами и кнопки масштаба для карты.
 *
 * Вид (масштаб и сдвиг) живёт в ref и рассылается подписчикам сразу при каждом движении: слои двигает
 * композитор без перерисовки. Состояние React (`view`) фиксируется только в конце жеста, после колеса
 * и по кнопкам — это «зафиксированный» масштаб, под который слои растрируются заново один раз.
 * Сдвиг ограничен: остров не уходит из окна, минимальный масштаб — «вся карта», максимальный — в 8 раз крупнее.
 */
export function useViewport(bounds: Bounds | null, focus?: { x: number; y: number; k?: number } | null) {
  // Контейнер может пересоздаваться (например, после режима «глазами команды»): ссылка — колбэк,
  // а эффекты с колесом и наблюдателем размера привязаны к текущему элементу через состояние.
  const ref = useRef<HTMLDivElement | null>(null);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => { ref.current = node; setEl(node); }, []);
  const [view, setViewState] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  const listeners = useRef(new Set<(v: View) => void>());
  const boundsRef = useRef(bounds); boundsRef.current = bounds;
  const fitK = useRef(1);

  const clampView = useCallback((v: View): View => {
    const el = ref.current, b = boundsRef.current;
    if (!el || !b) return v;
    const w = el.clientWidth, h = el.clientHeight;
    const k = Math.min(fitK.current * 8, Math.max(fitK.current, v.k));
    const f = k / v.k;
    let tx = w / 2 - (w / 2 - v.tx) * f, ty = h / 2 - (h / 2 - v.ty) * f;
    // Поле карты не выходит из окна дальше, чем на небольшой запас моря; если поле уже окна — оно по центру.
    const m = Math.min(w, h) * 0.12;
    const cw = b.width * k, ch = b.height * k;
    const x0 = b.minX * k, y0 = b.minY * k;
    tx = cw <= w - 2 * m ? (w - cw) / 2 - x0 : Math.min(m - x0, Math.max(w - m - (x0 + cw), tx));
    ty = ch <= h - 2 * m ? (h - ch) / 2 - y0 : Math.min(m - y0, Math.max(h - m - (y0 + ch), ty));
    return { k, tx, ty };
  }, []);

  /** Применить вид: сразу всем подписчикам; в React — только при commit. */
  const setView = useCallback((next: View | ((v: View) => View), commit = false) => {
    const v = clampView(typeof next === "function" ? next(viewRef.current) : next);
    viewRef.current = v;
    for (const fn of listeners.current) fn(v);
    if (commit) setViewState(v);
  }, [clampView]);
  const commit = useCallback(() => setViewState(viewRef.current), []);
  /** Подписка на каждое изменение вида (вызывается сразу с текущим видом). Возвращает отписку. */
  const subscribe = useCallback((fn: (v: View) => void) => { listeners.current.add(fn); fn(viewRef.current); return () => { listeners.current.delete(fn); }; }, []);

  const pointers = useRef(new Map<number, { x: number; y: number; at: number; type: string }>());
  const gesture = useRef<{ moved: number; pinch: { dist: number; mid: { x: number; y: number } } | null } | null>(null);
  const [dragging, setDragging] = useState(false);

  const measureFit = useCallback(() => {
    const el = ref.current, b = boundsRef.current;
    if (!el || !b) return 1;
    fitK.current = Math.min(el.clientWidth / b.width, el.clientHeight / b.height) * 0.9;
    return fitK.current;
  }, []);
  const fit = useCallback(() => {
    const el = ref.current, b = boundsRef.current;
    if (!el || !b) return;
    const k = measureFit();
    setView({ k, tx: (el.clientWidth - b.width * k) / 2 - b.minX * k, ty: (el.clientHeight - b.height * k) / 2 - b.minY * k }, true);
  }, [measureFit, setView]);

  /** Центрировать точку карты (в координатах сцены) с масштабом k. */
  const focusOn = useCallback((x: number, y: number, k = 2.2) => {
    const el = ref.current;
    if (!el) return;
    measureFit();
    setView({ k, tx: el.clientWidth / 2 - x * k, ty: el.clientHeight / 2 - y * k }, true);
  }, [measureFit, setView]);

  // Начальное положение ставится ровно один раз, когда поле карты впервые известно. Дальше карта живёт
  // только по жестам пользователя. При изменении размера окна пересчитывается предел масштаба.
  const hasBounds = Boolean(bounds);
  const applied = useRef(false);
  useEffect(() => {
    if (!hasBounds || applied.current) return;
    applied.current = true;
    if (focus) focusOn(focus.x, focus.y, focus.k); else fit();
  }, [fit, focusOn, hasBounds]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => { if (!applied.current) return; measureFit(); setView((v) => v, true); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, measureFit, setView]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number, commitNow = true) => {
    setView((v) => {
      const el = ref.current;
      const px = cx ?? (el ? el.clientWidth / 2 : 0), py = cy ?? (el ? el.clientHeight / 2 : 0);
      const k = Math.min(fitK.current * 8, Math.max(fitK.current, v.k * factor));
      const f = k / v.k;
      return { k, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f };
    }, commitNow);
  }, [setView]);

  // Пальцы и мышь отслеживаются на window: жест продолжается, даже если палец вышел за край карты.
  // pointerdown ловится на контейнере, остальное — здесь.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gesture.current;
      const prev = pointers.current.get(e.pointerId);
      if (!prev || !g) return;
      if (e.pointerType === "mouse" && e.buttons === 0) { pointers.current.delete(e.pointerId); gesture.current = null; commit(); return; }
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, at: Date.now(), type: e.pointerType });
      const pts = [...pointers.current.values()];
      if (pts.length === 1) {
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        g.moved += Math.abs(dx) + Math.abs(dy);
        if (g.moved > 4) setDragging(true);
        setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
        return;
      }
      const [a, b] = [pts[0]!, pts[1]!];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      if (!g.pinch) { g.pinch = { dist, mid }; return; }
      // Щипок пошагово: масштаб вокруг прежней середины между пальцами плюс её смещение —
      // двумя пальцами можно и приближать, и двигать карту одновременно.
      const ratio = g.pinch.dist > 0 ? dist / g.pinch.dist : 1;
      const pm = g.pinch.mid;
      g.pinch = { dist, mid };
      g.moved += 10;
      setDragging(true);
      setView((v) => {
        const k = Math.min(fitK.current * 8, Math.max(fitK.current, v.k * ratio));
        const f = k / v.k;
        return { k, tx: pm.x - (pm.x - v.tx) * f + (mid.x - pm.x), ty: pm.y - (pm.y - v.ty) * f + (mid.y - pm.y) };
      });
    };
    const up = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.delete(e.pointerId);
      if (pointers.current.size === 0) { gesture.current = null; commit(); setTimeout(() => setDragging(false), 0); }
      else if (gesture.current) gesture.current.pinch = null;
    };
    const clear = (e: TouchEvent) => { if (e.touches.length === 0 && pointers.current.size) { pointers.current.clear(); gesture.current = null; commit(); setTimeout(() => setDragging(false), 0); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("touchend", clear);
    window.addEventListener("touchcancel", clear);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("touchend", clear);
      window.removeEventListener("touchcancel", clear);
    };
  }, [setView, commit]);

  useEffect(() => {
    if (!el) return;
    let timer = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top, false);
      window.clearTimeout(timer); timer = window.setTimeout(commit, 120);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { el.removeEventListener("wheel", onWheel); window.clearTimeout(timer); };
  }, [el, zoomAt, commit]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Без setPointerCapture: иначе click уходит контейнеру, а не клетке карты.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const now = Date.now();
    for (const [id, pt] of pointers.current) if (pt.type !== "touch" && now - pt.at > 1000) pointers.current.delete(id);
    if (pointers.current.size >= 2) return; // третий палец не участвует
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, at: now, type: e.pointerType });
    const pts = [...pointers.current.values()];
    const r = ref.current?.getBoundingClientRect();
    const pinch = pts.length === 2 && r ? { dist: Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y), mid: { x: (pts[0]!.x + pts[1]!.x) / 2 - r.left, y: (pts[0]!.y + pts[1]!.y) / 2 - r.top } } : null;
    gesture.current = { moved: gesture.current?.moved ?? 0, pinch };
  };

  /** true, если последний жест был перетаскиванием или щипком (значит клик по клетке игнорируем). */
  const wasDrag = () => (gesture.current?.moved ?? 0) > 4 || dragging;

  return { ref: attach, view, viewRef, subscribe, fit, focusOn, zoomAt: (f: number) => zoomAt(f), wasDrag, handlers: { onPointerDown } };
}
