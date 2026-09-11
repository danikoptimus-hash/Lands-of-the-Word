import { useCallback, useEffect, useRef, useState } from "react";

export interface View { k: number; tx: number; ty: number }

/**
 * Перетаскивание, колесо, щипок двумя пальцами и кнопки масштаба для SVG-карты.
 * Возвращает view (scale + сдвиг) и обработчики для контейнера.
 */
export function useViewport(bounds: { minX: number; minY: number; width: number; height: number } | null, focus?: { x: number; y: number; k?: number } | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number; at: number; type: string }>());
  const gesture = useRef<{ startDist: number; startK: number; moved: number; last: { x: number; y: number } } | null>(null);
  const [dragging, setDragging] = useState(false);

  /** Масштаб «вся карта в окне»: от него считаются пределы зума, иначе на телефоне минимум 0.25 оказывался крупнее исходного вида. */
  const fitK = useRef(1);
  const clampK = (k: number) => Math.min(fitK.current * 8, Math.max(fitK.current * 0.5, k));
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || !bounds) return;
    const w = el.clientWidth, h = el.clientHeight;
    const k = Math.min(w / bounds.width, h / bounds.height) * 0.92;
    fitK.current = k;
    const tx = (w - bounds.width * k) / 2 - bounds.minX * k;
    const ty = (h - bounds.height * k) / 2 - bounds.minY * k;
    setView({ k, tx, ty });
  }, [bounds]);

  /** Центрировать точку карты (в координатах сцены) с масштабом k. */
  const focusOn = useCallback((x: number, y: number, k = 2.2) => {
    const el = ref.current;
    if (!el) return;
    if (bounds) fitK.current = Math.min(el.clientWidth / bounds.width, el.clientHeight / bounds.height) * 0.92;
    setView({ k, tx: el.clientWidth / 2 - x * k, ty: el.clientHeight / 2 - y * k });
  }, [bounds]);

  // Начальное положение ставится ровно один раз, когда поле карты впервые известно. Дальше карта живёт
  // только по жестам пользователя: границы поля растут с каждым открытым узлом, и раньше это возвращало
  // и приближало карту «само по себе».
  const hasBounds = Boolean(bounds);
  const applied = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (!hasBounds || applied.current) return;
    applied.current = true;
    if (focus) focusOn(focus.x, focus.y, focus.k); else fit();
  }, [fit, focusOn, hasBounds]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const el = ref.current;
      const px = cx ?? (el ? el.clientWidth / 2 : 0), py = cy ?? (el ? el.clientHeight / 2 : 0);
      const k = clampK(v.k * factor);
      const f = k / v.k;
      return { k, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f };
    });
  }, []);

  useEffect(() => {
    const clear = (e: TouchEvent) => { if (e.touches.length === 0) { pointers.current.clear(); gesture.current = null; setTimeout(() => setDragging(false), 0); } };
    window.addEventListener("touchend", clear); window.addEventListener("touchcancel", clear);
    return () => { window.removeEventListener("touchend", clear); window.removeEventListener("touchcancel", clear); };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Без setPointerCapture: иначе click уходит контейнеру, а не клетке карты.
    const now = Date.now();
    // Мышь или перо, не двигавшиеся больше секунды, — «потерянные» (браузер не прислал pointerup): выбрасываем.
    // Пальцы не трогаем: их снимает touchend на window, а палец, спокойно лежащий на карте перед щипком, — норма.
    for (const [id, pt] of pointers.current) if (pt.type !== "touch" && now - pt.at > 1000) pointers.current.delete(id);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, at: now, type: e.pointerType });
    const pts = [...pointers.current.values()];
    gesture.current = { startDist: pts.length === 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0, startK: viewRef.current.k, moved: 0, last: { x: e.clientX, y: e.clientY } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    const prev = pointers.current.get(e.pointerId)!;
    // Мышь без нажатой кнопки — не жест (после отпускания за пределами окна pointerup мог не прийти).
    if (e.pointerType === "mouse" && e.buttons === 0) { pointers.current.delete(e.pointerId); gesture.current = null; return; }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, at: Date.now(), type: e.pointerType });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      g.moved += Math.abs(dx) + Math.abs(dy);
      if (g.moved > 4) setDragging(true);
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    } else if (pts.length === 2) {
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      if (!g.startDist) { g.startDist = dist; g.startK = viewRef.current.k; return; }
      const el = ref.current!.getBoundingClientRect();
      const mx = (pts[0]!.x + pts[1]!.x) / 2 - el.left, my = (pts[0]!.y + pts[1]!.y) / 2 - el.top;
      g.moved += 10;
      setView((v) => {
        const k = clampK(g.startK * (dist / g.startDist));
        const f = k / v.k;
        return { k, tx: mx - (mx - v.tx) * f, ty: my - (my - v.ty) * f };
      });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) { setTimeout(() => setDragging(false), 0); gesture.current = null; }
    else if (gesture.current) gesture.current.startDist = 0;
  };

  /** true, если последний жест был перетаскиванием (значит клик по клетке игнорируем). */
  const wasDrag = () => (gesture.current?.moved ?? 0) > 4 || dragging;

  const onPointerLeave = (e: React.PointerEvent) => { if (pointers.current.has(e.pointerId)) onPointerUp(e); };

  return { ref, view, fit, focusOn, zoomAt, wasDrag, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onPointerLeave } };
}
