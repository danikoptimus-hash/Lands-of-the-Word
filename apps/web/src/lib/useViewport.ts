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
  const gesture = useRef<{ moved: number; pinch: { dist: number; mid: { x: number; y: number } } | null } | null>(null);
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

  // Пальцы и мышь отслеживаются на window: жест продолжается, даже если палец вышел за край карты
  // (на телефоне карта администратора невелика, и при щипке это случалось постоянно; жест обрывался и
  // превращался в перетаскивание одним пальцем). pointerdown ловится на контейнере, остальное — здесь.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gesture.current;
      const prev = pointers.current.get(e.pointerId);
      if (!prev || !g) return;
      // Мышь без нажатой кнопки — не жест (pointerup мог не прийти после отпускания вне окна).
      if (e.pointerType === "mouse" && e.buttons === 0) { pointers.current.delete(e.pointerId); gesture.current = null; return; }
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
      // Щипок считается пошагово: масштаб вокруг прежней середины между пальцами плюс её смещение,
      // так что двумя пальцами можно и приближать, и двигать карту одновременно.
      const ratio = g.pinch.dist > 0 ? dist / g.pinch.dist : 1;
      const pm = g.pinch.mid;
      g.pinch = { dist, mid };
      g.moved += 10;
      setDragging(true);
      setView((v) => {
        const k = clampK(v.k * ratio);
        const f = k / v.k;
        return { k, tx: pm.x - (pm.x - v.tx) * f + (mid.x - pm.x), ty: pm.y - (pm.y - v.ty) * f + (mid.y - pm.y) };
      });
    };
    const up = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.delete(e.pointerId);
      if (pointers.current.size === 0) { gesture.current = null; setTimeout(() => setDragging(false), 0); }
      else if (gesture.current) gesture.current.pinch = null;
    };
    // Страховка: когда все пальцы подняты, не должно оставаться «зависших» указателей.
    const clear = (e: TouchEvent) => { if (e.touches.length === 0) { pointers.current.clear(); gesture.current = null; setTimeout(() => setDragging(false), 0); } };
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const now = Date.now();
    // Мышь или перо, не двигавшиеся больше секунды, — «потерянные» (браузер не прислал pointerup): выбрасываем.
    // Пальцы не трогаем: их снимает touchend на window, а палец, спокойно лежащий на карте перед щипком, — норма.
    for (const [id, pt] of pointers.current) if (pt.type !== "touch" && now - pt.at > 1000) pointers.current.delete(id);
    if (pointers.current.size >= 2) return; // третий палец не участвует
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, at: now, type: e.pointerType });
    // Второй палец не сбрасывает пройденный путь: тап после щипка не должен считаться кликом по клетке.
    // Точка отсчёта щипка ставится сразу, чтобы не терять первое движение пальцев.
    const pts = [...pointers.current.values()];
    const r = ref.current?.getBoundingClientRect();
    const pinch = pts.length === 2 && r ? { dist: Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y), mid: { x: (pts[0]!.x + pts[1]!.x) / 2 - r.left, y: (pts[0]!.y + pts[1]!.y) / 2 - r.top } } : null;
    gesture.current = { moved: gesture.current?.moved ?? 0, pinch };
  };

  /** true, если последний жест был перетаскиванием или щипком (значит клик по клетке игнорируем). */
  const wasDrag = () => (gesture.current?.moved ?? 0) > 4 || dragging;

  return { ref, view, fit, focusOn, zoomAt, wasDrag, handlers: { onPointerDown } };
}
