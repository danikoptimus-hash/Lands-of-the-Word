import { dayLight, dayPhase, type DayPhase } from "@lotw/domain";
import { previewPhase } from "./daytime";
import type { VictoryDto } from "./api";

/**
 * Салют победы над последней столицей (решение владельца 26.11): трое суток празднования. Первые сутки от момента победы —
 * без остановки, круглые сутки; вторые и третьи — только в игровую ночь (22:00–7:00 по поясу партии). Дальше салюта нет.
 * Окно приходит от сервера (`victory` в ответе карты): `at` — момент победы, `until` — конец празднования. Здесь — только
 * расчёт «бьёт ли салют сейчас» и показ для съёмки; сам салют рисует `pages/VictoryFireworksLayer.tsx`.
 */
export interface VictoryWindow {
  /** Момент победы, мс эпохи. */ at: number;
  /** Конец празднования, мс эпохи. */ until: number;
  /** Только для показа: считать, что сейчас ночь (иначе вторые и третьи сутки в дневные часы молчат). */ forceNight?: boolean;
  /** Окно придумано адресом `?victory=` (съёмка), а не пришло от сервера. */ debug?: boolean;
}

const DAY_MS = 86_400_000;
/** Сколько салют бьёт без остановки после победы. */
export const VICTORY_NONSTOP_MS = DAY_MS;

/** Салют бьёт сейчас: внутри окна; первые сутки — всегда, дальше — только в игровую ночь. */
export function victoryFxOn(w: VictoryWindow, nowMs: number, timeZone: string): boolean {
  if (!(nowMs >= w.at) || nowMs >= w.until) return false;
  if (nowMs - w.at < VICTORY_NONSTOP_MS) return true;
  return w.forceNight === true || dayPhase(timeZone, new Date(nowMs)) === "night";
}

/** Показ для съёмки разрешён только в сборке разработчика, на тестовом стенде и на локальной копии — игрокам прода параметр ничего не включает. */
function debugAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) || h.startsWith("test.") || h === "localhost" || h === "127.0.0.1";
}

/** `?victory=1` — первые сутки празднования, `?victory=night` — вторые-третьи (салют идёт, как будто сейчас игровая ночь). */
function debugWindow(nowMs: number): VictoryWindow | null {
  if (!debugAllowed()) return null;
  const q = /[?&]victory=(\w+)/.exec(window.location.search)?.[1];
  if (q === "1") return { at: nowMs - 3_600_000, until: nowMs + 71 * 3_600_000, debug: true };
  if (q === "night") return { at: nowMs - 30 * 3_600_000, until: nowMs + 42 * 3_600_000, forceNight: true, debug: true };
  return null;
}

/** Окно празднования из ответа сервера (или показ для съёмки); `null` — праздника нет или он давно кончился. */
export function victoryWindow(v: VictoryDto | null | undefined, nowMs: number): VictoryWindow | null {
  const dbg = debugWindow(nowMs);
  if (dbg) return dbg;
  if (!v) return null;
  const at = Date.parse(v.at), until = Date.parse(v.until);
  if (!Number.isFinite(at) || !Number.isFinite(until) || until <= nowMs) return null;
  return { at, until };
}

const LEVEL: Record<DayPhase, number> = { day: 1, morning: 0.55, evening: 0.5, night: 0 };
/**
 * Насколько карта сейчас светлая (0 — ночь, 1 — день): днём искры на светлой воде и песке теряются, и слой слегка
 * притемняет карту; ночью притемнения нет. Переход между фазами плавный, как у света карты. `?tod=` для съёмки учитывается.
 */
export function mapBrightness(timeZone: string, nowMs: number, forceNight?: boolean): number {
  const pv = previewPhase();
  if (pv) return LEVEL[pv];
  if (forceNight) return 0;
  const dl = dayLight(timeZone, new Date(nowMs));
  return LEVEL[dl.from] + (LEVEL[dl.to] - LEVEL[dl.from]) * dl.t;
}
