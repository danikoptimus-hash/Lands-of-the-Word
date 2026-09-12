import { api } from "./api";

/**
 * Замер интерфейса на устройстве: скорость открытия страницы (навигация, первая и самая крупная отрисовка)
 * и плавность карты (кадры в секунду, доля долгих кадров, длинные задачи) за 6 секунд после открытия карты.
 * Отправляется один раз на страницу, без пользователя и точной модели устройства. Только для вошедших.
 */
type Page = "map" | "admin-map" | "other";
const sent = new Set<string>();
// Времена навигации относятся к загрузке документа, поэтому уходят только с первым замером в этой вкладке.
let navReported = false;

function device() {
  const ua = navigator.userAgent;
  const phone = /Mobi|Android|iPhone|iPad/.test(ua) || Math.min(window.innerWidth, window.innerHeight) < 700;
  const browser = /Edg\//.test(ua) ? "other" : /Chrome\//.test(ua) ? "chrome" : /Safari\//.test(ua) ? "safari" : /Firefox\//.test(ua) ? "firefox" : "other";
  const os = /Android/.test(ua) ? "android" : /iPhone|iPad|iPod/.test(ua) ? "ios" : /Windows/.test(ua) ? "windows" : /Mac OS/.test(ua) ? "mac" : /Linux/.test(ua) ? "linux" : "other";
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return { device: phone ? "phone" : "desktop", browser, os, dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100, viewW: window.innerWidth, viewH: window.innerHeight, memoryMb: mem ? Math.round(mem * 1024) : null } as const;
}

function navTiming() {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const paint = performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint");
  const r = (v: number | undefined) => (v && v > 0 ? Math.round(v) : null);
  return { ttfb: r(nav?.responseStart), fcp: r(paint?.startTime), load: r(nav?.loadEventEnd) };
}

let lcp: number | null = null;
try {
  new PerformanceObserver((list) => { for (const e of list.getEntries()) lcp = Math.round(e.startTime); }).observe({ type: "largest-contentful-paint", buffered: true });
} catch { /* не поддерживается */ }

/** Замер кадров в течение ms миллисекунд: средние fps, доля кадров дольше 50 мс, длинные задачи. */
function sampleFrames(ms: number): Promise<{ fps: number; jank: number; longTasks: number }> {
  return new Promise((resolve) => {
    let frames = 0, slow = 0, longTasks = 0, last = performance.now();
    const t0 = last;
    let po: PerformanceObserver | null = null;
    try { po = new PerformanceObserver((l) => { longTasks += l.getEntries().length; }); po.observe({ type: "longtask" }); } catch { /* нет longtask */ }
    const tick = (t: number) => {
      frames++;
      if (t - last > 50) slow++;
      last = t;
      if (t - t0 < ms) requestAnimationFrame(tick);
      else { po?.disconnect(); resolve({ fps: Math.round((frames / ((t - t0) / 1000)) * 10) / 10, jank: Math.round((slow / frames) * 1000) / 1000, longTasks }); }
    };
    requestAnimationFrame(tick);
  });
}

/** Вызывается при открытии страницы (карта — после появления карты). Один замер на страницу за сессию вкладки. */
export function reportPage(page: Page): void {
  if (sent.has(page) || document.hidden) return;
  sent.add(page);
  const run = async () => {
    const frames = page === "other" ? null : await sampleFrames(6000);
    const nav = navReported ? { ttfb: null, fcp: null, lcp: null, load: null } : { ...navTiming(), lcp };
    navReported = true;
    const body = { page, ...device(), ...nav, fps: frames?.fps ?? null, jank: frames?.jank ?? null, longTasks: frames?.longTasks ?? null };
    try {
      if (!navigator.sendBeacon || !navigator.sendBeacon("/api/metrics/ui", JSON.stringify(body))) await api("/api/metrics/ui", { method: "POST", body: JSON.stringify(body) });
    } catch { /* замер необязателен */ }
  };
  // Не мешать открытию: замер стартует после первой отрисовки страницы.
  setTimeout(() => { void run(); }, 1500);
}
