import { useEffect } from "react";

/**
 * Карта под листом (ревизия скорости, этап 2, тема 8). Карта — одиннадцать слоёв во весь экран, шесть из них перерисовываются
 * в каждом кадре. Когда карту закрывает большой лист (город, раздел панели), происходит то же самое: игрок читает дело,
 * а телефон рисует воду и зверей, которых почти не видно под матовым стеклом, и стекло пересчитывает размытие с каждым
 * их кадром.
 *
 * Три режима, выбирает владелец по образцу на стенде (в игру — только после его слова; до тех пор — «как сейчас»):
 *   now   — как сейчас: слои рисуют всегда;
 *   slow  — редко: под листом слои рисуют около трёх раз в секунду;
 *   pause — пауза: под листом слои не рисуют.
 * Во всех режимах мир живности под листом продолжает идти по часам сервера (без рисования): когда лист закрывается и карта
 * снова видна, звери сразу стоят там, где должны, — без догона (условие владельца 16.11). Запрет 04.11 — не останавливать
 * живность во время жестов — не затронут: при движении карты листа над ней нет, и слои рисуют как всегда.
 */
export type UnderMode = "now" | "slow" | "pause";
const KEY = "lotw.under", SLOW_MS = 330;
const valid = (v: unknown): v is UnderMode => v === "now" || v === "slow" || v === "pause";
function initial(): UnderMode {
  if (typeof window === "undefined") return "now";
  try {
    // ?under=pause|slow|now — выбрать режим ссылкой (запоминается на этом устройстве).
    const q = /[?&]under=(\w+)/.exec(window.location.search)?.[1];
    if (valid(q)) { window.localStorage.setItem(KEY, q); return q; }
    const saved = window.localStorage.getItem(KEY);
    return valid(saved) ? saved : "now";
  } catch { return "now"; }
}
let mode: UnderMode = initial();
let covered = false;

export const underMode = (): UnderMode => mode;
/** Замер «закрыта ли карта» текущей страницы: его зовёт смена режима (в режиме «как сейчас» замеры не ведутся). */
let remeasure: (() => void) | null = null;
export function setUnderMode(m: UnderMode): void { mode = m; try { window.localStorage.setItem(KEY, m); } catch { /* хранилище недоступно */ } remeasure?.(); }
/** Карта закрыта листом, и режим просит её не рисовать (или рисовать редко). */
export const mapCovered = (): boolean => covered && mode !== "now";
/** Только для проверок: закрыта ли карта листом (без учёта режима). */
export const mapIsCovered = (): boolean => covered;

/**
 * Затвор слоя: `true` — этот кадр пропустить. У каждого слоя свой затвор (он помнит, когда слой рисовал в режиме «редко»).
 * Ставится в начале цикла кадров слоя, рядом с проверкой «вкладка скрыта».
 */
export function coverGate(): (now: number) => boolean {
  let last = 0;
  return (now: number) => {
    if (!covered || mode === "now") return false;
    if (mode === "pause") return true;
    if (now - last < SLOW_MS) return true;
    last = now;
    return false;
  };
}

/**
 * Следит, закрыта ли карта: лист или раздел панели перекрывает не меньше 70 % её площади. Меряется по настоящим
 * размерам на экране, а не по списку «какие листы большие»: лист дела на телефоне занимает низ экрана и карту не закрывает,
 * лист города — закрывает. Пересчёт — после изменений страницы и по окончании движения листа.
 */
export function useMapCover(host: HTMLElement | null): void {
  useEffect(() => {
    if (!host || typeof MutationObserver === "undefined") return;
    let timer = 0, later = 0;
    const measure = () => {
      timer = 0;
      const m = host.getBoundingClientRect(), area = m.width * m.height;
      if (area <= 0) { covered = false; return; }
      let most = 0;
      for (const el of document.querySelectorAll<HTMLElement>(".overlay, .side-menu")) {
        const r = el.getBoundingClientRect();
        const w = Math.min(r.right, m.right) - Math.max(r.left, m.left), h = Math.min(r.bottom, m.bottom) - Math.max(r.top, m.top);
        if (w > 0 && h > 0) most = Math.max(most, (w * h) / area);
      }
      covered = most >= 0.7;
    };
    // Карта закрыта, а страница изменилась — возможно, лист убрали: меряем сразу, ещё до отрисовки кадра без листа, чтобы слои
    // ожили в том же кадре, в котором карта снова видна. В обратную сторону спешить не нужно: пока лист выезжает, карта живёт.
    // В режиме «как сейчас» (он в игре по умолчанию) слои рисуют всегда и замер не нужен: страница при открытом листе
    // меняется часто, а каждый замер — это запрос размеров у браузера.
    const soon = () => { if (mode === "now") return; if (covered) { window.clearTimeout(timer); measure(); } else if (!timer) timer = window.setTimeout(measure, 60); window.clearTimeout(later); later = window.setTimeout(measure, 450); };
    const mo = new MutationObserver(soon);
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("transitionend", soon, true);
    document.addEventListener("animationend", soon, true);
    window.addEventListener("resize", soon);
    measure();
    remeasure = measure;
    return () => { remeasure = null; mo.disconnect(); document.removeEventListener("transitionend", soon, true); document.removeEventListener("animationend", soon, true); window.removeEventListener("resize", soon); window.clearTimeout(timer); window.clearTimeout(later); covered = false; };
  }, [host]);
}
