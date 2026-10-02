import { useEffect, useMemo, useState } from "react";
import { dayLight, dayLightAt, type DayLight, type DayPhase } from "@lotw/domain";

/**
 * Освещение карты по времени суток (решение владельца 03.10): утро 7–9, день 9–18, вечер 18–22, ночь 22–7 по поясу игры.
 * Правила переключаются на границе, картинка перетекает плавно: ±15 минут вокруг границы цвета двух фаз смешиваются
 * (`t` — доля второй). Каждый слой карты получает уже смешанный `Light` и рисует себя по нему; слои с готовыми
 * растрами (местность, острова) рисуют картинки обеих фаз с прозрачностью.
 *
 * Палитры подобраны по фотографиям моря: закат — золото и оранжевый у солнца, лиловая и стальная вода в стороне;
 * заря — светлая серебристо-голубая вода, жёлто-розовые света; ночь — тёмная синева, серебряная лунная дорожка
 * и дрожащие отражения звёзд. Солнце вечером на западе (слева), утром на востоке (справа), луна ночью — справа вверху.
 */
export type RGB = [number, number, number];

export interface Light {
  /** Цвета воды по глубине (0..1). */
  shallow: RGB; mid: RGB; deep: RGB;
  /** Цвет бликов каустики. */
  glint: RGB;
  /** Светило: направление на экране (x вправо, y вниз, единичный вектор), сила дорожки и свечения, цвет. */
  sunX: number; sunY: number; sun: number; sunColor: RGB;
  /** Звёзды в воде (0..1). */
  stars: number;
  /** Туман: подложка, тень, масса и верхушки облаков. */
  fogBase: RGB; fogShade: RGB; fogMass: RGB; fogTop: RGB;
  /** Берег: песок, влажная кромка, цвет отмели у дальнего и ближнего края. */
  sand: RGB; wet: RGB; shallowFar: RGB; shallowNear: RGB;
  /** Фон за картой. */
  bg: RGB;
  /** Боковой свет на сушу: цвет и сила со стороны светила и с противоположной (прозрачность 0..1). */
  sideColor: RGB; side: number; farColor: RGB; far: number;
  /** Огни: костры у городов (0..1) и фонари кораблей (0..1). */
  fire: number; lamp: number;
  /** Тени кораблей: длина (1 — как днём) и плотность. */
  shadowLen: number; shadow: number;
}

const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

export const LIGHTS: Record<DayPhase, Light> = {
  day: {
    shallow: [0.36, 0.72, 0.78], mid: [0.20, 0.52, 0.66], deep: [0.08, 0.28, 0.46], glint: [0.82, 0.94, 0.96],
    sunX: 0.55, sunY: 0.83, sun: 0, sunColor: [1, 1, 1], stars: 0,
    fogBase: rgb("#C9C0B0"), fogShade: [176 / 255, 166 / 255, 150 / 255], fogMass: [240 / 255, 236 / 255, 228 / 255], fogTop: [1, 1, 1],
    sand: rgb("#E6D3A6"), wet: rgb("#B8975E"), shallowFar: [207 / 255, 234 / 255, 240 / 255], shallowNear: [226 / 255, 243 / 255, 246 / 255],
    bg: rgb("#2B2724"), sideColor: [1, 1, 1], side: 0, farColor: [1, 1, 1], far: 0, fire: 0, lamp: 0, shadowLen: 1, shadow: 1,
  },
  morning: {
    // Заря: вода серебристо-голубая, у солнца (справа) золотая, в стороне — сизо-розовая.
    shallow: [0.78, 0.86, 0.86], mid: [0.52, 0.68, 0.78], deep: [0.30, 0.44, 0.62], glint: [1.0, 0.96, 0.86],
    sunX: 0.98, sunY: -0.2, sun: 0.75, sunColor: [1.0, 0.86, 0.52], stars: 0,
    fogBase: [0.86, 0.82, 0.80], fogShade: [0.70, 0.64, 0.66], fogMass: [0.97, 0.94, 0.90], fogTop: [1.0, 0.99, 0.96],
    sand: [0.94, 0.86, 0.70], wet: [0.78, 0.66, 0.48], shallowFar: [0.86, 0.92, 0.94], shallowNear: [0.93, 0.96, 0.97],
    bg: rgb("#3A3438"), sideColor: [1.0, 0.92, 0.60], side: 0.18, farColor: [0.72, 0.68, 0.86], far: 0.10, fire: 0.25, lamp: 0.15, shadowLen: 1.9, shadow: 0.7,
  },
  evening: {
    // Закат: у солнца (слева) золото и оранжевый, в стороне лиловая и стальная вода, глубина — индиго.
    shallow: [0.82, 0.60, 0.44], mid: [0.40, 0.36, 0.50], deep: [0.15, 0.14, 0.30], glint: [1.0, 0.86, 0.62],
    sunX: -0.98, sunY: 0.2, sun: 0.95, sunColor: [1.0, 0.60, 0.24], stars: 0,
    fogBase: [0.72, 0.64, 0.66], fogShade: [0.55, 0.45, 0.52], fogMass: [0.90, 0.80, 0.74], fogTop: [1.0, 0.90, 0.78],
    sand: [0.88, 0.70, 0.52], wet: [0.66, 0.50, 0.38], shallowFar: [0.86, 0.74, 0.70], shallowNear: [0.94, 0.82, 0.74],
    bg: rgb("#2A1E26"), sideColor: [1.0, 0.70, 0.38], side: 0.24, farColor: [0.36, 0.30, 0.56], far: 0.14, fire: 0.6, lamp: 0.5, shadowLen: 2.0, shadow: 0.85,
  },
  night: {
    // Ночь: тёмная синева, лунная дорожка справа вверху серебряная, в воде дрожат звёзды; всё различимо.
    // Тени кораблей ночью не рисуются: серый силуэт корпуса рядом с кораблём читался как кит (замечание владельца 03.10).
    shallow: [0.14, 0.32, 0.44], mid: [0.06, 0.17, 0.31], deep: [0.02, 0.07, 0.17], glint: [0.62, 0.72, 0.86],
    sunX: 0.6, sunY: -0.8, sun: 0.7, sunColor: [0.80, 0.84, 0.90], stars: 1,
    fogBase: [0.30, 0.32, 0.40], fogShade: [0.18, 0.20, 0.28], fogMass: [0.42, 0.44, 0.54], fogTop: [0.56, 0.59, 0.69],
    sand: [0.46, 0.48, 0.58], wet: [0.30, 0.32, 0.42], shallowFar: [0.30, 0.42, 0.54], shallowNear: [0.40, 0.50, 0.60],
    bg: rgb("#0B0E18"), sideColor: [0.62, 0.72, 0.92], side: 0.10, farColor: [0.1, 0.12, 0.25], far: 0.12, fire: 1, lamp: 1, shadowLen: 1, shadow: 0,
  },
};

const mixN = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: RGB, b: RGB, t: number): RGB => [mixN(a[0], b[0], t), mixN(a[1], b[1], t), mixN(a[2], b[2], t)];

/** Смешение двух палитр: все числа и цвета — линейно. */
export function mixLight(a: Light, b: Light, t: number): Light {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out = {} as Record<keyof Light, number | RGB>;
  for (const k of Object.keys(a) as Array<keyof Light>) {
    const va = a[k], vb = b[k];
    out[k] = typeof va === "number" ? mixN(va, vb as number, t) : mix3(va, vb as RGB, t);
  }
  return out as unknown as Light;
}

export const css = (c: RGB, alpha = 1) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${alpha})`;

/** Освещение в момент `dl`: две фазы перехода и доля второй. */
export function lightOf(dl: Pick<DayLight, "from" | "to" | "t">): Light { return mixLight(LIGHTS[dl.from], LIGHTS[dl.to], dl.t); }

export interface Daytime extends DayLight { light: Light; /** Предпросмотр через ?tod= — правила не трогает, только картинку. */ preview: boolean }

/**
 * Предпросмотр времени суток: `?tod=evening`, `?tod=night`, `?tod=morning`, `?tod=day` или `?tod=18:05` (минуты
 * местного времени, с плавным переходом). Только картинка; правила считает сервер.
 */
function previewMinutes(): number | null {
  if (typeof location === "undefined") return null;
  const m = /[?&]tod=([^&]+)/.exec(location.search);
  if (!m) return null;
  const v = decodeURIComponent(m[1]!);
  const fixed: Record<string, number> = { morning: 8 * 60, day: 13 * 60, evening: 20 * 60, night: 1 * 60 };
  if (v in fixed) return fixed[v]!;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(v);
  return hm ? Number(hm[1]) * 60 + Number(hm[2]) : null;
}

/**
 * Время суток игры на клиенте: по поясу игры и часам сервера (`serverNow` — отметка сервера на момент ответа).
 * Пересчитывается раз в 30 секунд и ровно на границе фазы; `phase` — фаза правил, `light` — смешанное освещение.
 */
export function useDaytime(timeZone: string | undefined, serverNow?: number): Daytime {
  const [tick, setTick] = useState(0);
  const offset = useMemo(() => (serverNow ? serverNow - Date.now() : 0), [serverNow]);
  const preview = useMemo(previewMinutes, []);
  const dl = useMemo<DayLight>(() => {
    if (preview !== null) return { ...dayLightAt(preview), nextChangeMs: 3_600_000 };
    return dayLight(timeZone || "Asia/Tashkent", new Date(Date.now() + offset));
  }, [timeZone, offset, preview, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (preview !== null) return;
    const tm = setTimeout(() => setTick((n) => n + 1), Math.min(30_000, dl.nextChangeMs + 500));
    return () => clearTimeout(tm);
  }, [dl, preview]);
  return useMemo(() => ({ ...dl, light: lightOf(dl), preview: preview !== null }), [dl, preview]);
}

/** Освещение, одинаковое для обеих фаз без перехода: удобно слоям, которым нужен один набор картинок. */
export const DAY_LIGHT = LIGHTS.day;
