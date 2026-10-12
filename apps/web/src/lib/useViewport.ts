import { useCallback, useEffect, useRef, useState } from "react";
import { seaField } from "@lotw/domain";

export interface View { k: number; tx: number; ty: number }
export interface Bounds { minX: number; minY: number; width: number; height: number }

/**
 * Перетаскивание, колесо, щипок двумя пальцами и кнопки масштаба для карты.
 *
 * Вид (масштаб и сдвиг) живёт в ref и рассылается подписчикам сразу при каждом движении: слои двигает
 * композитор без перерисовки. Состояние React (`view`) — «зафиксированный» масштаб, под который слои
 * растрируются заново: фиксируется в конце жеста и по кнопкам. По ходу жеста детали (толщины линий, подписи,
 * метки) масштабируются CSS-переменными, которые слои ставят на каждый кадр (WorldSvg) — без перерастрирования.
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
  /** Пределы масштаба относительно «вся карта»: отдалить можно вдвое (вокруг острова остаётся широкое море), приблизить — в 8 раз. */
  const clampK = (k: number) => Math.min(fitK.current * 8, Math.max(fitK.current * 0.5, k));

  const clampView = useCallback((v: View): View => {
    const el = ref.current, b = boundsRef.current;
    if (!el || !b) return v;
    const w = el.clientWidth, h = el.clientHeight;
    const k = clampK(v.k);
    const f = k / v.k;
    let tx = w / 2 - (w / 2 - v.tx) * f, ty = h / 2 - (h / 2 - v.ty) * f;
    // Два правила, действует более щедрое из них (объединение диапазонов):
    // 1) поле не уходит из окна дальше, чем на треть экрана (решение владельца) — так при отдалении карту
    //    всё ещё можно чуть сдвинуть; 2) окно не выходит за пояс моря вокруг поля (там островки) — при
    //    приближении можно листать далеко в море, край пояса растёт вместе с масштабом.
    const m = Math.min(w, h) * 0.32;
    const cw = b.width * k, ch = b.height * k;
    const x0 = b.minX * k, y0 = b.minY * k;
    const lx = w - m - (x0 + cw), hx = m - x0, ly = h - m - (y0 + ch), hy = m - y0;
    const sf = seaField(b);
    const sx0 = sf.minX * k, sy0 = sf.minY * k, sw = sf.width * k, sh = sf.height * k;
    // Окно внутри пояса: tx ∈ [w − правый край, −левый край]; если пояс уже окна — по центру.
    const [slx, shx] = sw >= w ? [w - (sx0 + sw), -sx0] : [(w - sw) / 2 - sx0, (w - sw) / 2 - sx0];
    const [sly, shy] = sh >= h ? [h - (sy0 + sh), -sy0] : [(h - sh) / 2 - sy0, (h - sh) / 2 - sy0];
    tx = Math.min(Math.max(tx, Math.min(lx, hx, slx, shx)), Math.max(lx, hx, slx, shx));
    ty = Math.min(Math.max(ty, Math.min(ly, hy, sly, shy)), Math.max(ly, hy, sly, shy));
    return { k, tx, ty };
  }, []);

  /**
   * Применить вид. Подписчики получают его не чаще одного раза за кадр (rAF): мышь с частотой 1000 Гц и колесо
   * присылают десятки событий между кадрами, а двигать слои больше одного раза за кадр бессмысленно (плавность 12.10).
   * В React — только при commit.
   */
  const pending = useRef(false);
  const raf = useRef(0);
  const flush = useCallback(() => {
    raf.current = 0;
    if (!pending.current) return;
    pending.current = false;
    const v = viewRef.current;
    for (const fn of listeners.current) fn(v);
  }, []);
  const setView = useCallback((next: View | ((v: View) => View), commit = false) => {
    const v = clampView(typeof next === "function" ? next(viewRef.current) : next);
    viewRef.current = v;
    if (commit) { pending.current = false; for (const fn of listeners.current) fn(v); setViewState(v); return; }
    pending.current = true;
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  }, [clampView, flush]);
  const lastCommit = useRef(0);
  const commit = useCallback(() => { lastCommit.current = performance.now(); lastCommitView.current = viewRef.current; if (pending.current) flush(); setViewState(viewRef.current); }, [flush]);
  const lastCommitView = useRef<View>({ k: 1, tx: 0, ty: 0 });
  /**
   * По ходу жеста: растр мира построен с запасом вокруг экрана (WorldSvg: 0.4 экрана). Фиксируем раньше отпускания,
   * только когда края растра оголились бы: при отдалении дальше ×0.6 или сдвиге дальше 0.3 экрана. При приближении
   * растр покрывает экран всегда — фиксация посреди жеста лишь дёргала бы картинку (плавность 12.10).
   */
  const commitIfFar = useCallback(() => {
    const v = viewRef.current, b = lastCommitView.current, el = ref.current;
    const r = v.k / b.k;
    const far = el ? Math.abs(v.tx - b.tx) > el.clientWidth * 0.3 || Math.abs(v.ty - b.ty) > el.clientHeight * 0.3 : false;
    if (r < 0.6 || far) commit();
  }, [commit]);
  /** Подписка на каждое изменение вида (вызывается сразу с текущим видом). Возвращает отписку. */
  const subscribe = useCallback((fn: (v: View) => void) => { listeners.current.add(fn); fn(viewRef.current); return () => { listeners.current.delete(fn); }; }, []);

  const pointers = useRef(new Map<number, { x: number; y: number; at: number; type: string }>());
  /** Жест: откуда начался, стал ли перетаскиванием (палец ушёл дальше порога), щипок. */
  const gesture = useRef<{ start: { x: number; y: number }; drag: boolean; pinch: { dist: number; mid: { x: number; y: number } } | null } | null>(null);
  /** Порог перетаскивания: палец при нажатии дрожит на несколько пикселей, это ещё не перетаскивание (мышь точнее). */
  const slop = (type: string) => (type === "mouse" ? 4 : 10);
  const [dragging, setDraggingState] = useState(false);
  // Признак перетаскивания и в ref: обработчики нажатий на метки живут в memo-слоях и должны видеть свежее значение.
  const draggingRef = useRef(false);
  const setDragging = useCallback((v: boolean) => { draggingRef.current = v; setDraggingState(v); }, []);

  /**
   * Плавный зум (12.10): колесо и кнопки не прыгают на шаг, а задают цель; каждый кадр масштаб подтягивается к цели
   * экспоненциально (постоянная времени TAU мс), точка под курсором стоит на месте. Когда цель достигнута и колесо
   * молчит, вид фиксируется один раз — без ступенек и без перерастрирования посреди зума.
   */
  const zoomAnim = useRef<{ target: number; ax: number; ay: number; wx: number; wy: number; tau: number; raf: number; last: number; settle: number } | null>(null);
  const stopZoom = useCallback(() => { const z = zoomAnim.current; if (!z) return; cancelAnimationFrame(z.raf); window.clearTimeout(z.settle); zoomAnim.current = null; }, []);

  /** Слева карту может закрывать стеклянная колонка меню (компьютер): её ширина приходит из CSS (`--map-pad-left`),
   *  «вся карта» и центрирование считаются по свободной части окна. */
  const padLeft = (el: HTMLElement) => parseFloat(getComputedStyle(el).getPropertyValue("--map-pad-left")) || 0;
  const measureFit = useCallback(() => {
    const el = ref.current, b = boundsRef.current;
    if (!el || !b) return 1;
    fitK.current = Math.min((el.clientWidth - padLeft(el)) / b.width, el.clientHeight / b.height) * 0.9;
    return fitK.current;
  }, []);
  const fit = useCallback(() => {
    const el = ref.current, b = boundsRef.current;
    if (!el || !b) return;
    stopZoom();
    const k = measureFit(), pad = padLeft(el);
    setView({ k, tx: pad + (el.clientWidth - pad - b.width * k) / 2 - b.minX * k, ty: (el.clientHeight - b.height * k) / 2 - b.minY * k }, true);
  }, [measureFit, setView]);

  /** Центрировать точку карты (в координатах сцены) с масштабом k. */
  const focusOn = useCallback((x: number, y: number, k = 2.2) => {
    const el = ref.current;
    if (!el) return;
    stopZoom();
    measureFit();
    const pad = padLeft(el);
    setView({ k, tx: pad + (el.clientWidth - pad) / 2 - x * k, ty: el.clientHeight / 2 - y * k }, true);
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

  const zoomStep = useCallback((now: number) => {
    const z = zoomAnim.current; if (!z) return;
    const v = viewRef.current;
    const dt = Math.min(64, now - z.last); z.last = now;
    const a = 1 - Math.exp(-dt / z.tau);
    let k = v.k * Math.exp(Math.log(z.target / v.k) * a);
    const done = Math.abs(Math.log(z.target / k)) < 0.002;
    if (done) k = z.target;
    setView({ k, tx: z.ax - z.wx * k, ty: z.ay - z.wy * k });
    commitIfFar();
    if (done) { zoomAnim.current = null; window.clearTimeout(z.settle); z.settle = window.setTimeout(commit, 60); }
    else z.raf = requestAnimationFrame(zoomStep);
  }, [setView, commitIfFar, commit]);
  /** Сдвинуть цель зума на множитель вокруг точки экрана (cx, cy; по умолчанию — центр). tau — скорость подтягивания. */
  const zoomTo = useCallback((factor: number, cx?: number, cy?: number, tau = 110) => {
    const el = ref.current; if (!el) return;
    const v = viewRef.current;
    const px = cx ?? el.clientWidth / 2, py = cy ?? el.clientHeight / 2;
    const z = zoomAnim.current;
    const target = clampK((z?.target ?? v.k) * factor);
    // Якорь: точка карты под курсором в текущем виде; при смене позиции курсора пересчитывается от текущего вида.
    const wx = (px - v.tx) / v.k, wy = (py - v.ty) / v.k;
    if (z) { window.clearTimeout(z.settle); Object.assign(z, { target, ax: px, ay: py, wx, wy, tau }); return; }
    zoomAnim.current = { target, ax: px, ay: py, wx, wy, tau, raf: requestAnimationFrame(zoomStep), last: performance.now(), settle: 0 };
  }, [zoomStep]);
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => zoomTo(factor, cx, cy), [zoomTo]);

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
        // До порога карта не сдвигается: дрожание пальца при нажатии не превращает нажатие в перетаскивание.
        if (!g.drag && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) <= slop(e.pointerType)) return;
        if (!g.drag) { g.drag = true; setDragging(true); }
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
        commitIfFar();
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
      g.drag = true;
      setDragging(true);
      setView((v) => {
        const k = clampK(v.k * ratio);
        const f = k / v.k;
        return { k, tx: pm.x - (pm.x - v.tx) * f + (mid.x - pm.x), ty: pm.y - (pm.y - v.ty) * f + (mid.y - pm.y) };
      });
      commitIfFar();
    };
    const up = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.delete(e.pointerId);
      if (pointers.current.size === 0) { gesture.current = null; commit(); setTimeout(() => setDragging(false), 0); }
      else if (gesture.current) gesture.current.pinch = null;
    };
    const clear = (e: TouchEvent) => { if (e.touches.length === 0 && pointers.current.size) { pointers.current.clear(); gesture.current = null; commit(); setTimeout(() => setDragging(false), 0); } };
    // Приложение свернули или ушли с вкладки во время касания: pointerup уже не придёт, жест сбрасывается целиком,
    // иначе после возврата каждое нажатие считается перетаскиванием и на карте ничего не нажимается (ошибка 05.10).
    const reset = () => { if (!pointers.current.size && !gesture.current && !draggingRef.current) return; pointers.current.clear(); gesture.current = null; commit(); setDragging(false); };
    const onVisibility = () => { if (document.visibilityState === "hidden") reset(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("touchend", clear);
    window.addEventListener("touchcancel", clear);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("touchend", clear);
      window.removeEventListener("touchcancel", clear);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", reset);
      window.removeEventListener("blur", reset);
    };
  }, [setView, commit, commitIfFar, setDragging]);

  useEffect(() => {
    if (!el) return;
    let trackpadUntil = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey && !e.deltaY) return;
      const r = el.getBoundingClientRect();
      // Нормализация (как в OpenLayers/MapLibre): строки → пиксели, страницы → пиксели; щипок на тачпаде приходит
      // с ctrlKey и мелкими дельтами, его усиливаем. Один щелчок колеса мыши (100–120 px) — ×1.15.
      let d = e.deltaY * (e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? 400 : 1);
      if (e.ctrlKey) d *= 4;
      d = Math.max(-240, Math.min(240, d));
      // Тачпад шлёт много мелких дробных дельт — ему быстрая постоянная времени (ощущение «палец ведёт»),
      // колесу мыши — помедленнее, чтобы щелчки слились в одно плавное движение.
      const now = performance.now();
      const trackpad = Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY) || e.ctrlKey;
      if (trackpad) trackpadUntil = now + 400;
      const tau = now < trackpadUntil ? 45 : 110;
      zoomTo(Math.exp(-d * (Math.log(1.15) / 100)), e.clientX - r.left, e.clientY - r.top, tau);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { el.removeEventListener("wheel", onWheel); };
  }, [el, zoomTo]);
  useEffect(() => () => { stopZoom(); if (raf.current) cancelAnimationFrame(raf.current); }, [stopZoom]);

  const onPointerDown = (e: React.PointerEvent) => {
    // Без setPointerCapture: иначе click уходит контейнеру, а не клетке карты.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const now = Date.now();
    // Забытые указатели (мышь без отпускания дольше секунды, палец без отпускания дольше трёх — так бывает после
    // сворачивания приложения) не считаются: новое касание начинает новый жест.
    for (const [id, pt] of pointers.current) if (now - pt.at > (pt.type === "touch" ? 3000 : 1000)) pointers.current.delete(id);
    if (pointers.current.size >= 2) return; // третий палец не участвует
    // Палец или кнопка мыши прерывают анимацию зума: дальше вид ведёт жест.
    if (zoomAnim.current) { stopZoom(); commit(); }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, at: now, type: e.pointerType });
    const pts = [...pointers.current.values()];
    const r = ref.current?.getBoundingClientRect();
    const pinch = pts.length === 2 && r ? { dist: Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y), mid: { x: (pts[0]!.x + pts[1]!.x) / 2 - r.left, y: (pts[0]!.y + pts[1]!.y) / 2 - r.top } } : null;
    // Один палец — новый жест, перетаскивание с нуля; второй палец продолжает жест первого.
    gesture.current = { start: { x: e.clientX, y: e.clientY }, drag: pts.length > 1 ? (gesture.current?.drag ?? false) : false, pinch };
    if (pts.length === 1 && draggingRef.current) setDragging(false);
  };

  /** true, если последний жест был перетаскиванием или щипком (значит клик по клетке игнорируем). */
  const wasDrag = () => (gesture.current?.drag ?? false) || draggingRef.current;

  return { ref: attach, view, viewRef, subscribe, fit, focusOn, zoomAt: (f: number) => zoomAt(f), wasDrag, handlers: { onPointerDown } };
}
