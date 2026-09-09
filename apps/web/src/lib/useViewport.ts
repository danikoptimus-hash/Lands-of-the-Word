import { useCallback, useEffect, useRef, useState } from "react";

export interface View { k: number; tx: number; ty: number }

/**
 * Перетаскивание, колесо, щипок двумя пальцами и кнопки масштаба для SVG-карты.
 * Возвращает view (scale + сдвиг) и обработчики для контейнера.
 */
export function useViewport(bounds: { minX: number; minY: number; width: number; height: number } | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startDist: number; startK: number; moved: number; last: { x: number; y: number } } | null>(null);
  const [dragging, setDragging] = useState(false);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || !bounds) return;
    const w = el.clientWidth, h = el.clientHeight;
    const k = Math.min(w / bounds.width, h / bounds.height) * 0.92;
    const tx = (w - bounds.width * k) / 2 - bounds.minX * k;
    const ty = (h - bounds.height * k) / 2 - bounds.minY * k;
    setView({ k, tx, ty });
  }, [bounds]);

  useEffect(() => { fit(); }, [fit]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const el = ref.current;
      const px = cx ?? (el ? el.clientWidth / 2 : 0), py = cy ?? (el ? el.clientHeight / 2 : 0);
      const k = Math.min(6, Math.max(0.25, v.k * factor));
      const f = k / v.k;
      return { k, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f };
    });
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
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = { startDist: pts.length === 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0, startK: view.k, moved: 0, last: { x: e.clientX, y: e.clientY } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      g.moved += Math.abs(dx) + Math.abs(dy);
      if (g.moved > 4) setDragging(true);
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    } else if (pts.length === 2) {
      const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      if (!g.startDist) { g.startDist = dist; g.startK = view.k; return; }
      const el = ref.current!.getBoundingClientRect();
      const mx = (pts[0]!.x + pts[1]!.x) / 2 - el.left, my = (pts[0]!.y + pts[1]!.y) / 2 - el.top;
      g.moved += 10;
      setView((v) => {
        const k = Math.min(6, Math.max(0.25, g.startK * (dist / g.startDist)));
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

  return { ref, view, fit, zoomAt, wasDrag, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onPointerLeave } };
}
